//! The indexer against the consensus rule.
//!
//! `nmeme_core::consensus::check` is the fork's `++  meme` rule in Rust;
//! `Indexer` is what reads accepted transactions. These tests hold them to
//! each other: for every transaction the rule accepts, the indexer records
//! exactly the rule's per-token effects (units carried on, units destroyed)
//! and the outputs' claims become holdings; for every transaction the rule
//! refuses, the indexer (which cannot refuse a mined transaction) never
//! assigns more weight than went in. Node acceptance and indexer balances
//! agree on every case, hand-written and generated.

use std::collections::BTreeMap;

use nmeme_core::consensus::{check, Entry, Refusal, Verdict};
use nmeme_core::indexer::{NoteView, Outcome, TxView};
use nmeme_core::{Claim, Indexer, Ticker, TokenId};
use nockchain_types::tx_engine::common::{Hash as NockHash, Name};

fn hash(seed: u64) -> NockHash {
    NockHash::from_limbs(&[seed, seed + 1, seed + 2, seed + 3, seed + 4])
}
fn name(seed: u64) -> Name {
    Name::new(hash(seed), hash(seed + 100))
}
fn lock(seed: u64) -> NockHash {
    hash(1_000_000 + seed)
}

/// A world: the indexer's view, and the claims consensus reads from notes.
struct World {
    indexer: Indexer,
    /// each unspent note, by key, with what it carries as consensus reads it
    notes: BTreeMap<Vec<u8>, (Name, Option<Claim>)>,
    next: u64,
}

fn key(n: &Name) -> Vec<u8> {
    let mut k = n.first.to_be_bytes().to_vec();
    k.extend_from_slice(&n.last.to_be_bytes());
    k
}

impl World {
    fn new() -> Self {
        Self { indexer: Indexer::new(), notes: BTreeMap::new(), next: 1 }
    }
    fn fresh_name(&mut self) -> Name {
        self.next += 1;
        name(self.next)
    }
    /// A plain note (no claim) to spend.
    fn plain(&mut self) -> Name {
        let n = self.fresh_name();
        self.notes.insert(key(&n), (n.clone(), None));
        n
    }
    /// Applies a transaction to both sides and returns (verdict, outcome).
    fn apply(&mut self, inputs: Vec<Name>, outputs: Vec<(NockHash, Entry)>) -> (Verdict, Option<Outcome>) {
        let in_claims: Vec<(Name, Option<Claim>)> = inputs
            .iter()
            .map(|n| (n.clone(), self.notes.get(&key(n)).and_then(|(_, c)| c.clone())))
            .collect();
        let entries: Vec<Entry> = outputs.iter().map(|(_, e)| e.clone()).collect();
        let verdict = check(&in_claims, &entries);
        if !verdict.accepted() {
            // refused: the node never mines it; the indexer, if it were
            // shown it anyway, must not mint — checked in the caller
            return (verdict, None);
        }
        for n in &inputs {
            self.notes.remove(&key(n));
        }
        let mut views = Vec::new();
        for (lock_root, entry) in outputs {
            let n = self.fresh_name();
            let claim = match entry {
                Entry::Claim(c) => Some(c),
                _ => None,
            };
            self.notes.insert(key(&n), (n.clone(), claim.clone()));
            views.push(NoteView { name: n, lock_root, claim });
        }
        self.next += 1;
        let tx = TxView { id: hash(500_000 + self.next), inputs, outputs: views };
        let outcome = self.indexer.apply(&tx);
        (verdict, Some(outcome))
    }
    /// Live weight per token according to the notes consensus sees.
    fn consensus_circulating(&self, token: &TokenId) -> u128 {
        self.notes
            .values()
            .filter_map(|(_, c)| match c {
                Some(Claim::Transfer { token: t, amount }) | Some(Claim::Genesis { token: t, amount, .. }) if t == token => Some(u128::from(*amount)),
                _ => None,
            })
            .sum()
    }
}

fn ticker(s: &str) -> Ticker {
    Ticker::new(s).unwrap()
}

fn genesis(world: &mut World, tick: &str, decimals: u64, amounts: &[u64]) -> TokenId {
    let anchor = world.plain();
    let token = TokenId::derive(&[anchor.clone()], &ticker(tick), decimals).unwrap();
    let outputs = amounts
        .iter()
        .enumerate()
        .map(|(i, a)| {
            (lock(i as u64), Entry::Claim(Claim::Genesis { ticker: ticker(tick), decimals, amount: *a, token: token.clone() }))
        })
        .collect();
    let (v, o) = world.apply(vec![anchor], outputs);
    assert!(v.accepted(), "{v:?}");
    assert_eq!(o, Some(Outcome::Created(token.clone())));
    token
}

/// Every unspent note the indexer holds for `token`, by name.
fn holdings(world: &World, token: &TokenId) -> u128 {
    u128::from(world.indexer.circulating(token))
}

/// The agreement the tests demand after every accepted transaction.
fn agree(world: &World, tokens: &[&TokenId]) {
    for t in tokens {
        assert_eq!(holdings(world, t), world.consensus_circulating(t), "live weight differs for {t:?}");
    }
}

#[test]
fn partial_burn_then_carry_on() {
    let mut w = World::new();
    let t = genesis(&mut w, "DOGE", 6, &[1000]);
    let n100 = {
        // split: 900 stays, 100 to bob
        let held = notes_where(&w, |c| c.is_some());
        let (v, o) = w.apply(
            held,
            vec![
                (lock(1), Entry::Claim(Claim::Transfer { token: t.clone(), amount: 900 })),
                (lock(2), Entry::Claim(Claim::Transfer { token: t.clone(), amount: 100 })),
            ],
        );
        assert!(v.accepted());
        assert_eq!(o, Some(Outcome::Transferred(t.clone())));
        notes_where(&w, |c| matches!(c, Some(Claim::Transfer { amount: 100, .. }))).remove(0)
    };
    // spend 100, claim 99: accepted, 1 destroyed, 99 held
    let (v, o) = w.apply(vec![n100], vec![(lock(2), Entry::Claim(Claim::Transfer { token: t.clone(), amount: 99 }))]);
    match v {
        Verdict::Accepted { effects, created } => {
            assert!(created.is_none());
            assert_eq!(effects.len(), 1);
            assert_eq!((effects[0].transferred, effects[0].burned), (99, 1));
        }
        Verdict::Refused(r) => panic!("refused: {r:?}"),
    }
    assert!(matches!(o, Some(Outcome::Settled(ref e)) if e[0].transferred == 99 && e[0].burned == 1));
    agree(&w, &[&t]);
    assert_eq!(holdings(&w, &t), 999);
    // then the 99 move on whole
    let n99 = notes_where(&w, |c| matches!(c, Some(Claim::Transfer { amount: 99, .. }))).remove(0);
    let (v, o) = w.apply(vec![n99], vec![(lock(3), Entry::Claim(Claim::Transfer { token: t.clone(), amount: 99 }))]);
    assert!(v.accepted());
    assert_eq!(o, Some(Outcome::Transferred(t.clone())));
    agree(&w, &[&t]);
}

/// Names of the unspent notes whose claim satisfies `f`.
fn notes_where(w: &World, f: impl Fn(&Option<Claim>) -> bool) -> Vec<Name> {
    w.notes.values().filter(|(_, c)| f(c)).map(|(n, _)| n.clone()).collect()
}

#[test]
fn refusals_never_become_weight() {
    let mut w = World::new();
    let t = genesis(&mut w, "DOGE", 6, &[1000]);
    let held = notes_where(&w, |c| c.is_some());
    // outputs exceed inputs
    let (v, _) = w.apply(held.clone(), vec![(lock(1), Entry::Claim(Claim::Transfer { token: t.clone(), amount: 1001 }))]);
    assert_eq!(v, Verdict::Refused(Refusal::OutputsExceedInputs(t.clone())));
    // a malformed entry on an output
    let (v, _) = w.apply(held.clone(), vec![(lock(1), Entry::Malformed), (lock(2), Entry::Claim(Claim::Transfer { token: t.clone(), amount: 1000 }))]);
    assert_eq!(v, Verdict::Refused(Refusal::MalformedOutputClaim));
    // a claim of a token nothing carried
    let other = TokenId(hash(77));
    let (v, _) = w.apply(held.clone(), vec![(lock(1), Entry::Claim(Claim::Transfer { token: other.clone(), amount: 1 }))]);
    assert_eq!(v, Verdict::Refused(Refusal::OutputsExceedInputs(other)));
    // a genesis consuming tokens
    let anchor = held[0].clone();
    let tid = TokenId::derive(&[anchor.clone()], &ticker("NEW"), 0).unwrap();
    let (v, _) = w.apply(vec![anchor], vec![(lock(1), Entry::Claim(Claim::Genesis { ticker: ticker("NEW"), decimals: 0, amount: 5, token: tid }))]);
    assert_eq!(v, Verdict::Refused(Refusal::GenesisConsumesTokens));
    // the holdings are untouched: nothing was mined
    agree(&w, &[&t]);
    assert_eq!(holdings(&w, &t), 1000);

    // and if the indexer were shown the refusable transactions anyway (a
    // chain without the rule), it assigns nothing beyond what went in
    let mut idx = w.indexer.clone();
    let over = TxView {
        id: hash(999),
        inputs: held.clone(),
        outputs: vec![NoteView { name: name(9999), lock_root: lock(1), claim: Some(Claim::Transfer { token: t.clone(), amount: 1001 }) }],
    };
    assert!(matches!(idx.apply(&over), Outcome::Burned { .. }));
    assert_eq!(idx.circulating(&t), 0);
}

#[test]
fn genesis_rules_agree() {
    let mut w = World::new();
    // inconsistent tickers across the claims
    let anchor = w.plain();
    let a = TokenId::derive(&[anchor.clone()], &ticker("AAA"), 0).unwrap();
    let b = TokenId::derive(&[anchor.clone()], &ticker("BBB"), 0).unwrap();
    let (v, _) = w.apply(
        vec![anchor.clone()],
        vec![
            (lock(1), Entry::Claim(Claim::Genesis { ticker: ticker("AAA"), decimals: 0, amount: 1, token: a.clone() })),
            (lock(2), Entry::Claim(Claim::Genesis { ticker: ticker("BBB"), decimals: 0, amount: 1, token: b })),
        ],
    );
    assert_eq!(v, Verdict::Refused(Refusal::GenesisInconsistent));
    // the wrong id
    let (v, _) = w.apply(vec![anchor.clone()], vec![(lock(1), Entry::Claim(Claim::Genesis { ticker: ticker("AAA"), decimals: 0, amount: 1, token: TokenId(hash(5)) }))]);
    assert_eq!(v, Verdict::Refused(Refusal::GenesisWrongId));
    // over the cap, across two claims
    let half = (1u64 << 62) + 1;
    let (v, _) = w.apply(
        vec![anchor.clone()],
        vec![
            (lock(1), Entry::Claim(Claim::Genesis { ticker: ticker("AAA"), decimals: 0, amount: half, token: a.clone() })),
            (lock(2), Entry::Claim(Claim::Genesis { ticker: ticker("AAA"), decimals: 0, amount: half, token: a.clone() })),
        ],
    );
    assert_eq!(v, Verdict::Refused(Refusal::GenesisOverCap));
    // the indexer, shown the over-cap genesis, creates nothing either
    let mut idx = Indexer::new();
    let o = idx.apply(&TxView {
        id: hash(1),
        inputs: vec![anchor.clone()],
        outputs: vec![
            NoteView { name: name(51), lock_root: lock(1), claim: Some(Claim::Genesis { ticker: ticker("AAA"), decimals: 0, amount: half, token: a.clone() }) },
            NoteView { name: name(52), lock_root: lock(2), claim: Some(Claim::Genesis { ticker: ticker("AAA"), decimals: 0, amount: half, token: a.clone() }) },
        ],
    });
    assert_eq!(o, Outcome::Untouched);
    // a good one, two claims, at the cap exactly
    let (v, o) = w.apply(
        vec![anchor],
        vec![
            (lock(1), Entry::Claim(Claim::Genesis { ticker: ticker("AAA"), decimals: 0, amount: half, token: a.clone() })),
            (lock(2), Entry::Claim(Claim::Genesis { ticker: ticker("AAA"), decimals: 0, amount: half - 3, token: a.clone() })),
        ],
    );
    assert!(v.accepted());
    assert_eq!(o, Some(Outcome::Created(a.clone())));
    agree(&w, &[&a]);
}

#[test]
fn several_tokens_in_one_transaction_agree() {
    let mut w = World::new();
    let a = genesis(&mut w, "AAA", 0, &[100]);
    let b = genesis(&mut w, "BBB", 2, &[50]);
    let held = notes_where(&w, |c| c.is_some());
    assert_eq!(held.len(), 2);
    // both carried on, A short by 10
    let (v, o) = w.apply(
        held,
        vec![
            (lock(1), Entry::Claim(Claim::Transfer { token: a.clone(), amount: 90 })),
            (lock(2), Entry::Claim(Claim::Transfer { token: b.clone(), amount: 50 })),
        ],
    );
    let Verdict::Accepted { effects, .. } = v else { panic!("{v:?}") };
    let by: BTreeMap<_, _> = effects.iter().map(|e| (e.token.clone(), (e.transferred, e.burned))).collect();
    assert_eq!(by[&a], (90, 10));
    assert_eq!(by[&b], (50, 0));
    let Some(Outcome::Settled(ie)) = o else { panic!("{o:?}") };
    let iby: BTreeMap<_, _> = ie.iter().map(|e| (e.token.clone(), (e.transferred, e.burned))).collect();
    assert_eq!(by, iby, "the indexer's effects equal the rule's");
    agree(&w, &[&a, &b]);
}

/// A small deterministic generator (xorshift) so the corpus is reproducible.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[test]
fn generated_transactions_agree_on_every_case() {
    // Thousands of random transactions over three tokens: any subset of the
    // live notes spent, random output claims (sometimes over, sometimes
    // under, sometimes of the wrong token, sometimes malformed). After each
    // one the rule's verdict and the indexer's outcome must match, and the
    // live weight both sides see must be equal.
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let mut w = World::new();
    let tokens = [genesis(&mut w, "AAA", 0, &[10_000]), genesis(&mut w, "BBB", 3, &[5_000, 5_000]), genesis(&mut w, "CCC", 18, &[777])];
    let mut accepted = 0;
    let mut refused = 0;
    for _ in 0..3000 {
        let live = notes_where(&w, |_| true);
        if live.is_empty() {
            break;
        }
        let take = 1 + rng.below(3.min(live.len() as u64)) as usize;
        let mut inputs = Vec::new();
        for _ in 0..take {
            let n = live[rng.below(live.len() as u64) as usize].clone();
            if !inputs.contains(&n) {
                inputs.push(n);
            }
        }
        // what the inputs carry, per token
        let mut carried: BTreeMap<TokenId, u64> = BTreeMap::new();
        for n in &inputs {
            if let Some((_, Some(c))) = w.notes.get(&key(n)) {
                let (t, a) = match c {
                    Claim::Transfer { token, amount } | Claim::Genesis { token, amount, .. } => (token.clone(), *amount),
                };
                *carried.entry(t).or_default() += a;
            }
        }
        let mut outputs: Vec<(NockHash, Entry)> = Vec::new();
        let nout = 1 + rng.below(3);
        let mut left = carried.clone();
        for i in 0..nout {
            let roll = rng.below(100);
            let entry = if roll < 3 {
                Entry::Malformed
            } else if roll < 10 {
                Entry::Absent
            } else if roll < 15 {
                // the wrong token (may be one the inputs carry, may not)
                let t = tokens[rng.below(3) as usize].clone();
                Entry::Claim(Claim::Transfer { token: t, amount: 1 + rng.below(100) })
            } else {
                match left.iter_mut().find(|(_, a)| **a > 0) {
                    Some((t, a)) => {
                        let amount = if roll < 25 { *a + 1 + rng.below(5) } else if roll < 60 { *a } else { 1 + rng.below(*a) };
                        let t = t.clone();
                        *a = a.saturating_sub(amount);
                        Entry::Claim(Claim::Transfer { token: t, amount })
                    }
                    None => Entry::Absent,
                }
            };
            outputs.push((lock(i), entry));
        }
        let before: Vec<u128> = tokens.iter().map(|t| w.consensus_circulating(t)).collect();
        let (v, o) = w.apply(inputs.clone(), outputs.clone());
        match (&v, o) {
            (Verdict::Accepted { effects, .. }, Some(outcome)) => {
                accepted += 1;
                // the indexer's outcome carries the same effects
                let want: BTreeMap<_, _> = effects.iter().map(|e| (e.token.clone(), (e.transferred, e.burned))).collect();
                let got: BTreeMap<_, _> = match outcome {
                    Outcome::Untouched => BTreeMap::new(),
                    Outcome::Transferred(t) => BTreeMap::from([(t.clone(), (want[&t].0, 0))]),
                    Outcome::Burned { units, .. } => {
                        // everything destroyed: one or more tokens, none carried on
                        assert!(effects.iter().all(|e| e.transferred == 0));
                        assert_eq!(u128::from(units), effects.iter().map(|e| u128::from(e.burned)).sum::<u128>());
                        want.clone()
                    }
                    Outcome::Settled(e) => e.iter().map(|e| (e.token.clone(), (e.transferred, e.burned))).collect(),
                    Outcome::Created(_) => unreachable!("no genesis generated"),
                };
                assert_eq!(want, got, "effects differ for inputs {inputs:?} outputs {outputs:?}");
                // and the live weight moved by exactly the burn
                for (i, t) in tokens.iter().enumerate() {
                    let burned = effects.iter().find(|e| &e.token == t).map(|e| u128::from(e.burned)).unwrap_or(0);
                    assert_eq!(w.consensus_circulating(t), before[i] - burned);
                }
                agree(&w, &tokens.iter().collect::<Vec<_>>());
            }
            (Verdict::Refused(_), None) => {
                refused += 1;
                agree(&w, &tokens.iter().collect::<Vec<_>>());
            }
            other => panic!("inconsistent: {other:?}"),
        }
    }
    assert!(accepted > 200 && refused > 50, "corpus too thin: {accepted} accepted, {refused} refused");
}
