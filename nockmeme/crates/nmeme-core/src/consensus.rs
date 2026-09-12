//! The token rule as consensus applies it on the fork, in Rust.
//!
//! `++  meme` in `upstream/amm-covenant.patch` refuses a transaction
//! (`v1-token-claims`) unless every one of these holds:
//!
//! - **W.** Every output note whose note-data carries a `meme` entry carries
//!   a well-formed claim: `[%0 %t tid amount]` with `1 <= amount <=
//!   MAX_SUPPLY`, or `[%0 %c ticker decimals amount tid]` with a valid ticker
//!   (`Ticker::from_limbs`), `decimals <= 18` and the same bound on the
//!   amount. Anything else under the key is refused, not ignored.
//! - **G.** If any output carries a genesis claim: no input carries a `meme`
//!   entry at all; every genesis claim in the transaction has the same
//!   ticker and decimals; each names the id derived from the transaction's
//!   anchor input (its smallest input name), that ticker and those decimals;
//!   and the claimed amounts sum to at most `MAX_SUPPLY`.
//! - **T.** For every token id named by a transfer claim on an output, the
//!   transfer claims of that id on the outputs sum to at most the transfer
//!   and genesis claims of that id on the inputs. The shortfall is
//!   destroyed.
//!
//! [`check`] is that rule over decoded claims; the indexer
//! ([`crate::Indexer`]) applies the same rule to accepted transactions and
//! the tests in `tests/oracle.rs` hold the two to each other. The one thing
//! the oracle cannot express over decoded claims is a malformed entry — the
//! codec ([`crate::Claim::from_noun`]) is the well-formedness rule, and
//! `Entry::Malformed` stands for anything it refuses.

use std::collections::BTreeMap;

use nockchain_types::tx_engine::common::Name;

use crate::claim::MAX_SUPPLY;
use crate::{Claim, Ticker, TokenId};

/// What an output note carries under the `meme` key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    /// No `meme` entry.
    Absent,
    /// A well-formed claim.
    Claim(Claim),
    /// An entry the codec refuses (wrong shape, zero or oversized amount, a
    /// bad ticker, decimals over 18, a bad version or tag).
    Malformed,
}

/// The per-token effect of an accepted transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Effect {
    pub token: TokenId,
    /// Units the outputs carry on.
    pub transferred: u64,
    /// Units the inputs carried that no output claims: destroyed.
    pub burned: u64,
}

/// Why consensus refuses a transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    MalformedOutputClaim,
    GenesisConsumesTokens,
    GenesisInconsistent,
    NoAnchor,
    GenesisWrongId,
    GenesisOverCap,
    OutputsExceedInputs(TokenId),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Accepted {
        /// The token a genesis created, with its supply.
        created: Option<(TokenId, u64)>,
        /// Per token consumed, in ascending id order.
        effects: Vec<Effect>,
    },
    Refused(Refusal),
    /// The token rule did not apply: the transaction is before the
    /// activation height, or activation is disabled (`phase` is `~` in
    /// `nmeme-policy.hoon`). Consensus accepts the transaction as it did
    /// before the upgrade; a `meme` entry on it is arbitrary metadata.
    Inactive,
}

impl Verdict {
    /// Consensus does not refuse the transaction on account of tokens: it is
    /// accepted under the rule, or the rule does not apply to it.
    pub fn accepted(&self) -> bool {
        !matches!(self, Verdict::Refused(_))
    }
}

fn sum(amounts: impl IntoIterator<Item = u64>) -> u128 {
    amounts.into_iter().map(u128::from).sum()
}

/// The activation policy of the consensus upgrade candidate
/// (`hoon/common/nmeme-policy.hoon`, `upstream/activation.patch`): the rule
/// is active at and after the activation height; `None` is disabled, not
/// height zero.
pub fn active(activation: Option<u64>, page: u64) -> bool {
    matches!(activation, Some(h) if page >= h)
}

/// `creditable:nmeme-policy`: an input note's claim carries token credit
/// only if the note's origin is at or after activation (and not in the
/// future). A claim written before activation was arbitrary metadata and
/// never becomes token weight by surviving the upgrade.
pub fn creditable(activation: Option<u64>, page: u64, origin: u64) -> bool {
    matches!(activation, Some(h) if page >= h && origin >= h && origin <= page)
}

/// Applies the rule as it stands on the pack 9 fork, where it is always
/// active: `inputs` are the input notes with the claim each carries (as
/// consensus reads it from the note), `outputs` the entries on the output
/// notes as consensus builds them.
pub fn check(inputs: &[(Name, Option<Claim>)], outputs: &[Entry]) -> Verdict {
    evaluate(inputs, inputs, outputs)
}

/// Applies the rule under the activation policy: `inputs` carry each note's
/// origin page, `page` is the transaction's. Before activation (or with
/// none) the verdict is `Inactive`. At and after it, a legacy input (origin
/// before activation) gives no credit (`creditable`), while for the genesis
/// rule its entry still counts as an entry — exactly as `conserved:meme`
/// reads it after `activation-on-pack9.patch`: only the credit is gated.
pub fn check_at(inputs: &[(Name, Option<Claim>, u64)], outputs: &[Entry], page: u64, activation: Option<u64>) -> Verdict {
    if !active(activation, page) {
        return Verdict::Inactive;
    }
    let all: Vec<(Name, Option<Claim>)> = inputs.iter().map(|(n, c, _)| (n.clone(), c.clone())).collect();
    let credited: Vec<(Name, Option<Claim>)> = inputs
        .iter()
        .map(|(n, c, origin)| (n.clone(), if creditable(activation, page, *origin) { c.clone() } else { None }))
        .collect();
    evaluate(&all, &credited, outputs)
}

/// The rule over two views of the inputs: `all` for what the inputs carry
/// (the genesis rule), `credited` for what counts as token weight going in
/// (the transfer rule). On the always-active fork the two are the same.
fn evaluate(all: &[(Name, Option<Claim>)], credited: &[(Name, Option<Claim>)], outputs: &[Entry]) -> Verdict {
    let inputs = all;
    // W
    if outputs.iter().any(|e| matches!(e, Entry::Malformed)) {
        return Verdict::Refused(Refusal::MalformedOutputClaim);
    }
    let claims: Vec<&Claim> = outputs
        .iter()
        .filter_map(|e| match e {
            Entry::Claim(c) => Some(c),
            _ => None,
        })
        .collect();

    // what goes in, per id: transfer and genesis claims alike
    let mut going_in: BTreeMap<TokenId, u128> = BTreeMap::new();
    for (_, claim) in credited {
        if let Some(claim) = claim {
            let (token, amount) = match claim {
                Claim::Transfer { token, amount } => (token, *amount),
                Claim::Genesis { token, amount, .. } => (token, *amount),
            };
            *going_in.entry(token.clone()).or_default() += u128::from(amount);
        }
    }

    // G
    let genesis: Vec<(&Ticker, u64, u64, &TokenId)> = claims
        .iter()
        .filter_map(|c| match c {
            Claim::Genesis {
                ticker,
                decimals,
                amount,
                token,
            } => Some((ticker, *decimals, *amount, token)),
            Claim::Transfer { .. } => None,
        })
        .collect();
    let mut created = None;
    if let Some((ticker, decimals, _, _)) = genesis.first() {
        if inputs.iter().any(|(_, c)| c.is_some()) {
            return Verdict::Refused(Refusal::GenesisConsumesTokens);
        }
        if genesis.iter().any(|(t, d, _, _)| *t != *ticker || *d != *decimals) {
            return Verdict::Refused(Refusal::GenesisInconsistent);
        }
        let names: Vec<Name> = inputs.iter().map(|(n, _)| n.clone()).collect();
        let Ok(derived) = TokenId::derive(&names, ticker, *decimals) else {
            return Verdict::Refused(Refusal::NoAnchor);
        };
        if genesis.iter().any(|(_, _, _, t)| **t != derived) {
            return Verdict::Refused(Refusal::GenesisWrongId);
        }
        let supply = sum(genesis.iter().map(|(_, _, a, _)| *a));
        if supply > u128::from(MAX_SUPPLY) {
            return Verdict::Refused(Refusal::GenesisOverCap);
        }
        created = Some((derived, supply as u64));
    }

    // T
    let mut going_out: BTreeMap<TokenId, u128> = BTreeMap::new();
    for claim in &claims {
        if let Claim::Transfer { token, amount } = claim {
            *going_out.entry(token.clone()).or_default() += u128::from(*amount);
        }
    }
    for (token, out) in &going_out {
        let inn = going_in.get(token).copied().unwrap_or(0);
        if *out > inn {
            return Verdict::Refused(Refusal::OutputsExceedInputs(token.clone()));
        }
    }
    let effects = going_in
        .iter()
        .map(|(token, inn)| {
            let out = going_out.get(token).copied().unwrap_or(0);
            Effect {
                token: token.clone(),
                transferred: out as u64,
                burned: (inn - out) as u64,
            }
        })
        .collect();
    Verdict::Accepted { created, effects }
}
