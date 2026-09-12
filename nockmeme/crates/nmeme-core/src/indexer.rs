//! Token accounting over notes a node has already accepted.
//!
//! The unit of input here is a *note*, not a synthetic event. That is the
//! important difference from a per-output allocation model: consensus merges
//! seeds sharing a lock-root into one note and unions their note-data
//! (FINDINGS §3), so by the time the indexer sees a transaction there is at
//! most one `meme` entry per output note, already merged. The indexer never has
//! to reconstruct which seed supplied it.
//!
//! This layer assumes signatures, double-spends and canonical ordering were
//! settled by the node. It does not re-verify them.
//!
//! The rule applied here is the consensus rule of the fork, stated in
//! [`crate::consensus`]: per token, a transaction's outputs may claim at most
//! what its inputs carried, and the shortfall is destroyed; a genesis names
//! its derived id, agrees on ticker and decimals across its claims, consumes
//! no tokens and fits the supply cap. Consensus refuses what breaks the rule;
//! the indexer, which reads transactions a node already accepted, records the
//! same effects — and for a chain without the rule (the shipped node), it
//! records the refusable cases as burns, never as weight (SPEC §7).

use std::collections::{BTreeMap, BTreeSet};

use nockchain_types::tx_engine::common::{Hash as NockHash, Name};

use crate::consensus::Effect;
use crate::{Claim, Ticker, TokenId};

/// One output note as the chain produced it, after merging.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteView {
    pub name: Name,
    /// The lock-root that controls the note. This is the identity the indexer
    /// reports balances against — a `meme` payload never names its own owner,
    /// because the chain already does (SPEC §2, FINDINGS §2).
    pub lock_root: NockHash,
    /// The decoded `meme` entry, if the note carried one that parsed.
    pub claim: Option<Claim>,
}

/// One accepted transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxView {
    pub id: NockHash,
    pub inputs: Vec<Name>,
    pub outputs: Vec<NoteView>,
}

/// Registered token metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenMeta {
    pub ticker: Ticker,
    pub decimals: u64,
    /// Fixed at genesis. There is no mint operation in v0.
    pub supply: u64,
    pub genesis_tx: NockHash,
}

/// What the overlay decided about one transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// No token weight was consumed and none was created.
    Untouched,
    Created(TokenId),
    /// One token consumed, every unit carried on to the outputs.
    Transferred(TokenId),
    /// Every unit consumed was destroyed. Carries why, for auditability.
    Burned { units: u64, reason: &'static str },
    /// The general case: several tokens consumed, or some units carried on
    /// and the rest destroyed (a partial burn), per token.
    Settled(Vec<Effect>),
    /// The token rule did not apply to this transaction: it is before the
    /// activation height, or activation is disabled. Nothing is indexed —
    /// a `meme` entry written then is arbitrary metadata, never credit
    /// (`consensus::creditable`).
    Inactive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditEntry {
    pub tx: NockHash,
    pub outcome: Outcome,
}

#[derive(Debug, Clone)]
pub struct Indexer {
    /// Unspent notes that carry token weight.
    holdings: BTreeMap<Vec<u8>, (TokenId, u64, NockHash)>,
    tokens: BTreeMap<TokenId, TokenMeta>,
    seen: BTreeSet<Vec<u8>>,
    audit: Vec<AuditEntry>,
    /// The activation height the indexed node enforces (`nmeme-policy.hoon`
    /// in `upstream/activation.patch`): `Some(0)` is the pack 9 fork, always
    /// active; `None` is disabled.
    activation: Option<u64>,
}

impl Default for Indexer {
    fn default() -> Self {
        Self::new()
    }
}

/// Sums amounts, refusing to wrap.
///
/// Every accumulation of token amounts in this module goes through here.
/// Amounts are bounded only by the field prime, which sits just below
/// `u64::MAX`, so two valid amounts can sum past it. A wrapped total can be
/// made to satisfy the conservation check in `interpret_transfer` while handing
/// out arbitrary weight, so overflow must be a rejection rather than a wrap —
/// and must not panic the indexer either, which is what plain `+` would do in a
/// debug build.
fn checked_total<I: IntoIterator<Item = u64>>(amounts: I) -> Option<u64> {
    amounts
        .into_iter()
        .try_fold(0u64, |acc, amount| acc.checked_add(amount))
        .filter(|total| *total <= crate::claim::MAX_SUPPLY)
}

fn name_key(name: &Name) -> Vec<u8> {
    let mut key = name.first.to_be_bytes().to_vec();
    key.extend_from_slice(&name.last.to_be_bytes());
    key
}

fn hash_key(hash: &NockHash) -> Vec<u8> {
    hash.to_be_bytes().to_vec()
}

impl Indexer {
    /// An indexer for the pack 9 fork: the rule active from height zero.
    pub fn new() -> Self {
        Self::with_activation(Some(0))
    }

    /// An indexer for a node built with the activation policy set to
    /// `activation` (`None`: disabled, every transaction `Inactive`).
    pub fn with_activation(activation: Option<u64>) -> Self {
        Self {
            holdings: BTreeMap::new(),
            tokens: BTreeMap::new(),
            seen: BTreeSet::new(),
            audit: Vec::new(),
            activation,
        }
    }

    /// Applies one canonical transaction.
    ///
    /// Applying is total: a transaction whose token payload is absent or
    /// invalid still spends its inputs, and any weight on them is destroyed
    /// (SPEC §7). There is no path that leaves an input both spent on the base
    /// chain and still holding weight here.
    pub fn apply(&mut self, tx: &TxView) -> Outcome {
        // no page stated: the latest possible one, under the rule whenever
        // the rule is active at all
        self.apply_at(tx, u64::MAX)
    }

    /// Applies one transaction mined at `page`. Before activation the
    /// outcome is `Inactive` and nothing changes: a note created then
    /// carries no credit later (`consensus::creditable`), so it never
    /// enters the holdings, and a transaction mined then cannot spend a
    /// note created after it.
    pub fn apply_at(&mut self, tx: &TxView, page: u64) -> Outcome {
        let tx_key = hash_key(&tx.id);
        if !self.seen.insert(tx_key) {
            // A duplicate transaction id in canonical order is a caller bug,
            // not a chain state: applying it twice would double-spend weight.
            return self.record(tx, Outcome::Untouched);
        }
        if !crate::consensus::active(self.activation, page) {
            return self.record(tx, Outcome::Inactive);
        }

        let consumed: Vec<(TokenId, u64)> = tx
            .inputs
            .iter()
            .filter_map(|name| self.holdings.remove(&name_key(name)))
            .map(|(token, amount, _)| (token, amount))
            .collect();

        let outcome = self.interpret(tx, &consumed);

        if let Outcome::Burned { .. } | Outcome::Untouched = outcome {
            // Inputs are already removed above; nothing is assigned.
        }
        self.record(tx, outcome)
    }

    fn record(&mut self, tx: &TxView, outcome: Outcome) -> Outcome {
        self.audit.push(AuditEntry {
            tx: tx.id.clone(),
            outcome: outcome.clone(),
        });
        outcome
    }

    fn interpret(&mut self, tx: &TxView, consumed: &[(TokenId, u64)]) -> Outcome {
        let consumed_units: u128 = consumed.iter().map(|(_, amount)| u128::from(*amount)).sum();
        let burn = move |reason: &'static str| {
            if consumed_units == 0 {
                Outcome::Untouched
            } else {
                Outcome::Burned {
                    units: consumed_units.min(u128::from(u64::MAX)) as u64,
                    reason,
                }
            }
        };

        let claimed: Vec<(&NoteView, &Claim)> = tx
            .outputs
            .iter()
            .filter_map(|note| note.claim.as_ref().map(|claim| (note, claim)))
            .collect();

        let genesis = claimed
            .iter()
            .filter(|(_, claim)| matches!(claim, Claim::Genesis { .. }))
            .count();
        if genesis > 0 {
            // Consensus: a genesis consumes nothing and carries no transfer
            // claim (nothing went in for one to be backed by). Either way the
            // weight consumed, if any, is destroyed.
            if genesis != claimed.len() {
                return burn("mixed genesis and transfer claims");
            }
            self.interpret_genesis(tx, consumed_units, &claimed, burn)
        } else {
            self.interpret_transfer(tx, consumed, &claimed)
        }
    }

    fn interpret_genesis(
        &mut self,
        tx: &TxView,
        consumed_units: u128,
        claimed: &[(&NoteView, &Claim)],
        burn: impl Fn(&'static str) -> Outcome,
    ) -> Outcome {
        // G1: genesis must not consume existing weight, or the supply of the
        // consumed token would silently vanish into a new one.
        if consumed_units != 0 {
            return burn("genesis consumed existing token weight");
        }
        // G2: identity is anchored to an input note, so there must be one.
        if tx.inputs.is_empty() {
            return Outcome::Untouched;
        }

        let (ticker, decimals) = match claimed[0].1 {
            Claim::Genesis {
                ticker, decimals, ..
            } => (ticker.clone(), *decimals),
            Claim::Transfer { .. } => unreachable!("genesis branch"),
        };

        // G3: every genesis claim must agree on what is being created.
        let consistent = claimed.iter().all(|(_, claim)| match claim {
            Claim::Genesis {
                ticker: t,
                decimals: d,
                ..
            } => *t == ticker && *d == decimals,
            Claim::Transfer { .. } => false,
        });
        if !consistent {
            return Outcome::Untouched;
        }

        let Ok(token) = TokenId::derive(&tx.inputs, &ticker, decimals) else {
            return Outcome::Untouched;
        };
        // G6: every genesis claim names the id it creates, and it must be
        // the derived one. Consensus (the forked engine) checks the same
        // equality and refuses the transaction otherwise; an indexer that
        // reads a chain without that rule treats a mismatch as no genesis.
        let named = claimed.iter().all(|(_, claim)| match claim {
            Claim::Genesis { token: t, .. } => *t == token,
            Claim::Transfer { .. } => false,
        });
        if !named {
            return Outcome::Untouched;
        }
        // G5: first creation in canonical order wins the identity.
        if self.tokens.contains_key(&token) {
            return Outcome::Untouched;
        }

        // G4: the declared supply is the sum of the genesis claims, and it must
        // fit under the cap. A transaction whose claims overflow, or exceed
        // MAX_SUPPLY, creates no token at all rather than a token whose recorded
        // supply is unrelated to the weight it handed out.
        let Some(supply) = checked_total(claimed.iter().map(|(_, claim)| claim.amount())) else {
            return Outcome::Untouched;
        };
        for (note, claim) in claimed {
            self.holdings.insert(
                name_key(&note.name),
                (token.clone(), claim.amount(), note.lock_root.clone()),
            );
        }
        self.tokens.insert(
            token.clone(),
            TokenMeta {
                ticker,
                decimals,
                supply,
                genesis_tx: tx.id.clone(),
            },
        );
        Outcome::Created(token)
    }

    fn interpret_transfer(
        &mut self,
        _tx: &TxView,
        consumed: &[(TokenId, u64)],
        claimed: &[(&NoteView, &Claim)],
    ) -> Outcome {
        // What went in, per token (T: the inputs' claims, summed per id).
        let mut going_in: BTreeMap<TokenId, u128> = BTreeMap::new();
        for (token, amount) in consumed {
            *going_in.entry(token.clone()).or_default() += u128::from(*amount);
        }
        if going_in.is_empty() {
            // Claiming weight that was never consumed would mint from
            // nothing; consensus refuses it, the indexer assigns nothing.
            return Outcome::Untouched;
        }
        // What the outputs claim, per token.
        let mut going_out: BTreeMap<TokenId, u128> = BTreeMap::new();
        for (_, claim) in claimed {
            if let Claim::Transfer { token, amount } = claim {
                *going_out.entry(token.clone()).or_default() += u128::from(*amount);
            }
        }
        // Per token: outputs at most inputs, else the rule refuses the
        // transaction. A node carrying the rule never mines one; on a
        // chain without it, the weight of that token is destroyed rather
        // than inflated (SPEC §7), and a claim of a token the inputs do
        // not carry mints nothing.
        let mut effects: Vec<Effect> = Vec::with_capacity(going_in.len());
        for (token, inn) in &going_in {
            let out = going_out.get(token).copied().unwrap_or(0);
            if out > *inn {
                effects.push(Effect { token: token.clone(), transferred: 0, burned: *inn as u64 });
            } else {
                effects.push(Effect { token: token.clone(), transferred: out as u64, burned: (*inn - out) as u64 });
            }
        }
        for (note, claim) in claimed {
            if let Claim::Transfer { token, amount } = claim {
                let kept = effects.iter().any(|e| &e.token == token && e.transferred > 0);
                if kept {
                    self.holdings.insert(
                        name_key(&note.name),
                        (token.clone(), *amount, note.lock_root.clone()),
                    );
                }
            }
        }
        let total_kept: u128 = effects.iter().map(|e| u128::from(e.transferred)).sum();
        let total_burned: u128 = effects.iter().map(|e| u128::from(e.burned)).sum();
        if total_kept == 0 {
            let reason = if going_out.is_empty() {
                "no token claim on any output"
            } else if going_out.keys().any(|t| !going_in.contains_key(t)) {
                "output claims a token the inputs do not carry"
            } else {
                "outputs claim more than the inputs carry"
            };
            return Outcome::Burned { units: total_burned.min(u128::from(u64::MAX)) as u64, reason };
        }
        if effects.len() == 1 && total_burned == 0 {
            return Outcome::Transferred(effects[0].token.clone());
        }
        Outcome::Settled(effects)
    }

    /// Balances for one token, keyed by controlling lock-root.
    pub fn balances(&self, token: &TokenId) -> BTreeMap<Vec<u8>, u64> {
        let mut out: BTreeMap<Vec<u8>, u64> = BTreeMap::new();
        for (held, amount, lock_root) in self.holdings.values() {
            if held == token {
                let slot = out.entry(hash_key(lock_root)).or_default();
                // Conservation plus the supply cap make this unreachable;
                // saturating rather than wrapping keeps a read path from
                // reporting a smaller balance than reality if it ever were.
                *slot = slot.saturating_add(*amount);
            }
        }
        out
    }

    /// Total live weight for a token. Should equal supply minus everything
    /// burned by §7.
    pub fn circulating(&self, token: &TokenId) -> u64 {
        self.holdings
            .values()
            .filter(|(held, _, _)| held == token)
            .fold(0u64, |acc, (_, amount, _)| acc.saturating_add(*amount))
    }

    pub fn token(&self, token: &TokenId) -> Option<&TokenMeta> {
        self.tokens.get(token)
    }

    pub fn tokens(&self) -> impl Iterator<Item = (&TokenId, &TokenMeta)> {
        self.tokens.iter()
    }

    pub fn audit(&self) -> &[AuditEntry] {
        &self.audit
    }

    /// Rebuilds state from a canonical history.
    ///
    /// A reorganization is handled by replaying the *replacement* history from
    /// empty, never by inverting applied transactions (SPEC §8).
    pub fn replay(history: &[TxView]) -> Self {
        let mut indexer = Self::new();
        for tx in history {
            indexer.apply(tx);
        }
        indexer
    }

    /// Rebuilds state from a canonical history with heights, under an
    /// activation policy.
    pub fn replay_at(history: &[(TxView, u64)], activation: Option<u64>) -> Self {
        let mut indexer = Self::with_activation(activation);
        for (tx, page) in history {
            indexer.apply_at(tx, *page);
        }
        indexer
    }
}
