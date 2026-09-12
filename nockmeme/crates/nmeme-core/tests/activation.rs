//! The activation policy of the consensus upgrade candidate
//! (`upstream/activation.patch`, `hoon/common/nmeme-policy.hoon`) mirrored
//! in Rust: `consensus::active`, `consensus::creditable`, `check_at`, and
//! the indexer's `apply_at`. The cases follow the candidate's 24 Hoon
//! assertions (`hoon/tests/dumb/mod/unit/nmeme-upgrade.hoon`) where they
//! concern the token rule; the covenant's cases are the node's alone.

use nmeme_core::consensus::{active, check, check_at, creditable, Entry, Refusal, Verdict};
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
fn ticker(s: &str) -> Ticker {
    Ticker::new(s).unwrap()
}
fn token() -> TokenId {
    TokenId::derive(&[name(1)], &ticker("TEST"), 0).unwrap()
}
fn transfer(amount: u64) -> Claim {
    Claim::Transfer { token: token(), amount }
}
fn out(seed: u64, claim: Option<Claim>) -> NoteView {
    NoteView { name: name(seed), lock_root: lock(seed), claim }
}
fn tx(id: u64, inputs: Vec<Name>, outputs: Vec<NoteView>) -> TxView {
    TxView { id: hash(500_000 + id), inputs, outputs }
}

const H: Option<u64> = Some(100);

#[test]
fn the_policy_is_the_candidates() {
    // !(active ~ 1.000.000); !(active `100 99); (active `100 100); (active `100 101)
    assert!(!active(None, 1_000_000));
    assert!(!active(H, 99));
    assert!(active(H, 100));
    assert!(active(H, 101));
    // !(creditable `100 101 99); (creditable `100 101 100); !(creditable `100 101 102)
    assert!(!creditable(H, 101, 99));
    assert!(creditable(H, 101, 100));
    assert!(!creditable(H, 101, 102));
    assert!(!creditable(None, 101, 100));
    assert!(!creditable(H, 99, 99), "not before activation either");
}

#[test]
fn before_activation_or_disabled_the_rule_does_not_apply() {
    // arbitrary metadata is what it always was: a malformed entry on an
    // output refuses nothing before activation, and nothing with none
    let outs = vec![Entry::Malformed];
    assert_eq!(check_at(&[(name(1), None, 50)], &outs, 101, None), Verdict::Inactive);
    assert_eq!(check_at(&[(name(1), None, 50)], &outs, 99, H), Verdict::Inactive);
    assert!(check_at(&[(name(1), None, 50)], &outs, 99, H).accepted());
    // at and after activation the same output is refused (W)
    assert_eq!(check_at(&[(name(1), None, 50)], &outs, 100, H), Verdict::Refused(Refusal::MalformedOutputClaim));
    assert_eq!(check_at(&[(name(1), None, 50)], &outs, 101, H), Verdict::Refused(Refusal::MalformedOutputClaim));
}

#[test]
fn a_legacy_claim_carries_no_credit_but_its_nock_can_be_spent() {
    let legacy = (name(1), Some(transfer(100)), 99u64);
    // !(accepted `100 101 99 (claim 100) (claim 100)): the output's claim has nothing behind it
    let v = check_at(&[legacy.clone()], &[Entry::Claim(transfer(100))], 101, H);
    assert_eq!(v, Verdict::Refused(Refusal::OutputsExceedInputs(token())));
    // (accepted `100 101 99 (claim 100) ~): spent as plain NOCK, the claim discarded
    let v = check_at(&[legacy], &[Entry::Absent], 101, H);
    assert!(v.accepted());
    assert_eq!(v, Verdict::Accepted { created: None, effects: vec![] }, "no credit went in: nothing to burn either");
}

#[test]
fn a_claim_from_activation_on_is_credit_and_conserved() {
    let fresh = (name(1), Some(transfer(100)), 100u64);
    // (accepted `100 101 100 (claim 100) (claim 100))
    assert!(check_at(&[fresh.clone()], &[Entry::Claim(transfer(100))], 101, H).accepted());
    // !(accepted `100 101 100 (claim 100) (claim 101))
    assert_eq!(
        check_at(&[fresh.clone()], &[Entry::Claim(transfer(101))], 101, H),
        Verdict::Refused(Refusal::OutputsExceedInputs(token()))
    );
    // (accepted `100 101 100 (claim 100) (claim 99)): a partial burn
    match check_at(&[fresh], &[Entry::Claim(transfer(99))], 101, H) {
        Verdict::Accepted { effects, .. } => {
            assert_eq!(effects.len(), 1);
            assert_eq!((effects[0].transferred, effects[0].burned), (99, 1));
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_fresh_genesis_needs_no_historical_weight_and_a_legacy_entry_still_blocks_it() {
    // (accepted `100 100 50 ~ genesis): the anchor is a legacy note without an entry
    let genesis = Claim::Genesis { ticker: ticker("TEST"), decimals: 0, amount: 100, token: token() };
    assert!(matches!(
        check_at(&[(name(1), None, 50)], &[Entry::Claim(genesis.clone())], 100, H),
        Verdict::Accepted { created: Some((t, 100)), .. } if t == token()
    ));
    // the genesis rule reads the inputs' entries as entries, not as credit:
    // a legacy note that still carries a claim cannot anchor a genesis
    // (conserved:meme after the patch gates the credit only)
    assert_eq!(
        check_at(&[(name(1), Some(transfer(5)), 50)], &[Entry::Claim(genesis)], 100, H),
        Verdict::Refused(Refusal::GenesisConsumesTokens)
    );
}

#[test]
fn the_always_active_fork_is_activation_at_zero() {
    let ins = [(name(1), Some(transfer(100)), 7u64)];
    let outs = [Entry::Claim(transfer(100))];
    assert_eq!(check_at(&ins, &outs, 9, Some(0)), check(&[(name(1), Some(transfer(100)))], &outs));
}

#[test]
fn the_indexer_records_nothing_before_activation_and_credits_nothing_legacy() {
    let mut ix = Indexer::with_activation(H);
    // a genesis mined at 99: not under the rule, nothing indexed
    let genesis = Claim::Genesis { ticker: ticker("TEST"), decimals: 0, amount: 100, token: token() };
    let early = tx(1, vec![name(1)], vec![out(10, Some(genesis.clone()))]);
    assert_eq!(ix.apply_at(&early, 99), Outcome::Inactive);
    assert!(ix.token(&token()).is_none());
    // its output spent at 101 with a claim: the claim was legacy, nothing goes in, nothing is assigned
    let spend = tx(2, vec![name(10)], vec![out(11, Some(transfer(100)))]);
    assert_eq!(ix.apply_at(&spend, 101), Outcome::Untouched);
    assert_eq!(ix.balances(&token()).values().sum::<u64>(), 0);
    // the same genesis mined at 100 is a token, and its units carry on at 101
    let mut ix = Indexer::with_activation(H);
    let at = tx(3, vec![name(1)], vec![out(10, Some(genesis))]);
    assert_eq!(ix.apply_at(&at, 100), Outcome::Created(token()));
    let spend = tx(4, vec![name(10)], vec![out(11, Some(transfer(100)))]);
    assert_eq!(ix.apply_at(&spend, 101), Outcome::Transferred(token()));
    assert_eq!(ix.balances(&token()).values().sum::<u64>(), 100);
    // disabled: every transaction is inactive
    let mut off = Indexer::with_activation(None);
    let genesis = Claim::Genesis { ticker: ticker("TEST"), decimals: 0, amount: 100, token: token() };
    assert_eq!(off.apply_at(&tx(5, vec![name(1)], vec![out(10, Some(genesis))]), 1_000_000), Outcome::Inactive);
    assert_eq!(off.apply(&tx(6, vec![name(1)], vec![out(12, None)])), Outcome::Inactive);
}

#[test]
fn replay_at_agrees_with_the_rule_on_every_height_around_activation() {
    let genesis = Claim::Genesis { ticker: ticker("TEST"), decimals: 0, amount: 100, token: token() };
    for page in [98u64, 99, 100, 101] {
        let history = vec![(tx(1, vec![name(1)], vec![out(10, Some(genesis.clone()))]), page)];
        let ix = Indexer::replay_at(&history, H);
        let verdict = check_at(&[(name(1), None, 50)], &[Entry::Claim(genesis.clone())], page, H);
        assert_eq!(ix.token(&token()).is_some(), active(H, page), "page {page}");
        assert_eq!(verdict == Verdict::Inactive, !active(H, page), "page {page}");
    }
}
