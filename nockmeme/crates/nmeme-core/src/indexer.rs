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

use std::collections::{BTreeMap, BTreeSet};

use nockchain_types::tx_engine::common::{Hash as NockHash, Name};

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
    Transferred(TokenId),
    /// Consumed weight was destroyed. Carries why, for auditability.
    Burned { units: u64, reason: &'static str },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditEntry {
    pub tx: NockHash,
    pub outcome: Outcome,
}

#[derive(Debug, Default, Clone)]
pub struct Indexer {
    /// Unspent notes that carry token weight.
    holdings: BTreeMap<Vec<u8>, (TokenId, u64, NockHash)>,
    tokens: BTreeMap<TokenId, TokenMeta>,
    seen: BTreeSet<Vec<u8>>,
    audit: Vec<AuditEntry>,
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
    pub fn new() -> Self {
        Self::default()
    }

    /// Applies one canonical transaction.
    ///
    /// Applying is total: a transaction whose token payload is absent or
    /// invalid still spends its inputs, and any weight on them is destroyed
    /// (SPEC §7). There is no path that leaves an input both spent on the base
    /// chain and still holding weight here.
    pub fn apply(&mut self, tx: &TxView) -> Outcome {
        let tx_key = hash_key(&tx.id);
        if !self.seen.insert(tx_key) {
            // A duplicate transaction id in canonical order is a caller bug,
            // not a chain state: applying it twice would double-spend weight.
            return self.record(tx, Outcome::Untouched);
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
        // Holdings are conserved and capped, so this cannot legitimately
        // overflow; treating a failure as "everything is burned" keeps the
        // burn path total rather than panicking on impossible input.
        let consumed_units: u64 =
            checked_total(consumed.iter().map(|(_, amount)| *amount)).unwrap_or(0);
        let burn = |reason: &'static str| {
            if consumed_units == 0 {
                Outcome::Untouched
            } else {
                Outcome::Burned {
                    units: consumed_units,
                    reason,
                }
            }
        };

        let claimed: Vec<(&NoteView, &Claim)> = tx
            .outputs
            .iter()
            .filter_map(|note| note.claim.as_ref().map(|claim| (note, claim)))
            .collect();

        if claimed.is_empty() {
            return burn("no token claim on any output");
        }

        let genesis = claimed
            .iter()
            .filter(|(_, claim)| matches!(claim, Claim::Genesis { .. }))
            .count();
        if genesis != 0 && genesis != claimed.len() {
            return burn("mixed genesis and transfer claims");
        }

        if genesis > 0 {
            self.interpret_genesis(tx, consumed_units, &claimed, burn)
        } else {
            self.interpret_transfer(tx, consumed, &claimed, burn)
        }
    }

    fn interpret_genesis(
        &mut self,
        tx: &TxView,
        consumed_units: u64,
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
        burn: impl Fn(&'static str) -> Outcome,
    ) -> Outcome {
        if consumed.is_empty() {
            // Claiming weight that was never consumed would mint from nothing.
            return Outcome::Untouched;
        }

        // T1: v0 carries exactly one token per transaction.
        let mut distinct: BTreeSet<&TokenId> = BTreeSet::new();
        for (token, _) in consumed {
            distinct.insert(token);
        }
        if distinct.len() != 1 {
            return burn("mixed token inputs are unsupported in v0");
        }
        let token = consumed[0].0.clone();

        // T2: every claim must name the token actually consumed.
        let all_match = claimed.iter().all(|(_, claim)| match claim {
            Claim::Transfer { token: t, .. } => *t == token,
            Claim::Genesis { .. } => false,
        });
        if !all_match {
            return burn("output claims a token the inputs do not carry");
        }

        // T3: exact conservation. A sender who forgets to colour their change
        // burns the remainder — the wallet must build the change claim.
        let Some(consumed_units) = checked_total(consumed.iter().map(|(_, amount)| *amount))
        else {
            return burn("consumed amounts overflowed");
        };
        // This is the sum an attacker controls. Wrapping it is the inflation
        // vector: consume one unit, claim two outputs summing to 2^64 + 1, and
        // an unchecked total would read as 1 and conserve.
        let Some(claimed_units) = checked_total(claimed.iter().map(|(_, claim)| claim.amount()))
        else {
            return burn("claimed amounts overflowed");
        };
        if claimed_units != consumed_units {
            return burn("supply not conserved");
        }

        for (note, claim) in claimed {
            self.holdings.insert(
                name_key(&note.name),
                (token.clone(), claim.amount(), note.lock_root.clone()),
            );
        }
        Outcome::Transferred(token)
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
}
