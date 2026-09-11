//! Offline tests for claim attachment and the signing digest.
//!
//! None of these prove the digest matches what the Hoon wallet computes — that
//! needs a signed transaction from a running node (docs/ACCEPTANCE.md). What
//! they do prove is that attachment obeys the merge rule, that note-data
//! actually enters the digest, and that the digest uses the right hash
//! function — the last being a mistake that was made and corrected here.

use nmeme_core::{Claim, Ticker, TokenId};
use nmeme_tx::sighash::{note_data_digest, spend_sig_hash};
use nmeme_tx::{attach_claim, Error};
use nockchain_math::owned_based_noun::OwnedBasedNoun;
use nockchain_types::tx_engine::common::{Hash, Nicks, Source};
use nockchain_types::tx_engine::v1::note::{NoteData, NoteDataEntry, NoteDataValue};
use nockchain_types::tx_engine::v1::tx::{Seed, Seeds};

fn hash(seed: u64) -> Hash {
    Hash::from_limbs(&[seed, seed + 1, seed + 2, seed + 3, seed + 4])
}

fn alice() -> Hash {
    hash(1000)
}
fn bob() -> Hash {
    hash(2000)
}

fn seed(lock_root: Hash, gift: u64) -> Seed {
    Seed {
        output_source: None,
        lock_root,
        note_data: NoteData::new(vec![]),
        gift: Nicks(gift as usize),
        parent_hash: hash(77),
    }
}

fn claim() -> Claim {
    Claim::Transfer {
        token: TokenId(hash(31337)),
        amount: 1_000,
    }
}

fn two_seeds() -> Seeds {
    Seeds(vec![seed(alice(), 5_000), seed(bob(), 1_000)])
}

// ---------------------------------------------------------------- attach ---

#[test]
fn attaches_to_the_seed_paying_the_named_lock_root() {
    let mut seeds = two_seeds();
    attach_claim(&mut seeds, &bob(), &claim()).expect("attaches");

    let bobs = seeds.0.iter().find(|s| s.lock_root == bob()).expect("bob seed");
    assert_eq!(bobs.note_data.iter().count(), 1);
    assert_eq!(bobs.note_data.iter().next().expect("entry").key, "meme");

    let alices = seeds.0.iter().find(|s| s.lock_root == alice()).expect("alice seed");
    assert_eq!(alices.note_data.iter().count(), 0, "other seeds untouched");
}

#[test]
fn refuses_an_unknown_lock_root() {
    let mut seeds = two_seeds();
    let err = attach_claim(&mut seeds, &hash(999), &claim()).expect_err("no such seed");
    assert!(matches!(err, Error::NoSeedForLockRoot(_)));
}

#[test]
fn refuses_to_overwrite_an_existing_meme_entry() {
    let mut seeds = two_seeds();
    attach_claim(&mut seeds, &bob(), &claim()).expect("first");
    let err = attach_claim(&mut seeds, &bob(), &claim()).expect_err("second");
    assert!(matches!(err, Error::DuplicateKey(_)));
}

#[test]
fn refuses_two_seeds_sharing_one_lock_root() {
    // Consensus merges these into one note and unions their note-data,
    // resolving key collisions destructively (tx-engine-1.hoon:2380-2386). One
    // claim would silently overwrite the other, so this is refused rather than
    // guessed at; the caller must sum into a single claim (SPEC R1).
    let mut seeds = Seeds(vec![seed(bob(), 400), seed(bob(), 600)]);
    let err = attach_claim(&mut seeds, &bob(), &claim()).expect_err("ambiguous");
    assert!(matches!(err, Error::DuplicateKey(_)));
}

#[test]
fn preserves_note_data_that_is_already_present() {
    let mut seeds = Seeds(vec![Seed {
        note_data: NoteData::new(vec![NoteDataEntry::new(
            "lock".to_string(),
            NoteDataValue::Noun(OwnedBasedNoun::try_atom(7).expect("based")),
        )]),
        ..seed(bob(), 1_000)
    }]);
    attach_claim(&mut seeds, &bob(), &claim()).expect("attaches alongside");
    let keys: Vec<String> = seeds.0[0].note_data.iter().map(|e| e.key.clone()).collect();
    assert!(keys.contains(&"lock".to_string()), "wallet lock metadata kept");
    assert!(keys.contains(&"meme".to_string()));
}

// --------------------------------------------------------------- sighash ---

#[test]
fn attaching_a_claim_changes_the_signing_hash() {
    // If this did not hold, note-data would not be covered by the signature and
    // a token claim could be altered in flight. It is the whole reason
    // re-signing is required after attaching.
    let before = spend_sig_hash(&two_seeds(), 256).expect("digest");
    let mut seeds = two_seeds();
    attach_claim(&mut seeds, &bob(), &claim()).expect("attaches");
    let after = spend_sig_hash(&seeds, 256).expect("digest");
    assert_ne!(before, after);
}

#[test]
fn the_signing_hash_covers_the_fee() {
    let seeds = two_seeds();
    assert_ne!(
        spend_sig_hash(&seeds, 256).expect("digest"),
        spend_sig_hash(&seeds, 512).expect("digest"),
    );
}

#[test]
fn the_signing_hash_is_deterministic_and_order_independent() {
    // Seeds are a z-set; the canonical tree, not the Vec order, fixes the
    // digest.
    let forward = Seeds(vec![seed(alice(), 5_000), seed(bob(), 1_000)]);
    let reversed = Seeds(vec![seed(bob(), 1_000), seed(alice(), 5_000)]);
    assert_eq!(
        spend_sig_hash(&forward, 256).expect("digest"),
        spend_sig_hash(&reversed, 256).expect("digest"),
    );
}

#[test]
fn a_pinned_output_source_is_signed_over_not_stripped() {
    // `hashable-unit:source` puts a pin inside the seed's sig-hashable
    // (tx-engine-0.hoon:338-343), so a pinned seed's digest differs from the
    // unpinned one, and two different pins differ from each other. A relayer
    // cannot remove or alter a pin without invalidating the signature.
    let plain = two_seeds();
    let mut pinned = two_seeds();
    pinned.0[0].output_source = Some(Source { hash: hash(5), is_coinbase: false });
    let mut other = two_seeds();
    other.0[0].output_source = Some(Source { hash: hash(6), is_coinbase: false });
    let d_plain = spend_sig_hash(&plain, 256).expect("digest");
    let d_pinned = spend_sig_hash(&pinned, 256).expect("digest");
    let d_other = spend_sig_hash(&other, 256).expect("digest");
    assert_ne!(d_plain, d_pinned);
    assert_ne!(d_pinned, d_other);
    assert_eq!(d_pinned, spend_sig_hash(&pinned, 256).expect("deterministic"));
}

#[test]
fn note_data_digest_is_not_a_plain_noun_hash() {
    // The mistake this pins: hash:note-data pairs leaf+key with the value's
    // *noun* hashable, which digests a cell as hash_pair of its children.
    // hash_owned_based_noun is hash-noun-varlen over leaf-sequence and dyck.
    // Using the latter produces a digest the chain will not agree with.
    use nockchain_types::tx_engine::v1::hashable::hash_owned_based_noun;

    let value = claim().to_noun().expect("claim encodes");
    let note_data = NoteData::new(vec![NoteDataEntry::new(
        "meme".to_string(),
        NoteDataValue::Noun(value.clone()),
    )]);

    let correct = note_data_digest(&note_data).expect("digest");
    let wrong = hash_owned_based_noun(&value);
    assert_ne!(correct, wrong, "the two hash functions must not be conflated");
}

#[test]
fn empty_note_data_digests_as_the_null_leaf() {
    use nockchain_types::tx_engine::v1::hashable::hash_leaf_null;
    assert_eq!(
        note_data_digest(&NoteData::new(vec![])).expect("digest"),
        hash_leaf_null(),
    );
}

#[test]
fn different_claims_give_different_note_data_digests() {
    let mk = |amount: u64| {
        let value = Claim::Transfer { token: TokenId(hash(31337)), amount }
            .to_noun()
            .expect("encodes");
        NoteData::new(vec![NoteDataEntry::new(
            "meme".to_string(),
            NoteDataValue::Noun(value),
        )])
    };
    assert_ne!(
        note_data_digest(&mk(1_000)).expect("digest"),
        note_data_digest(&mk(1_001)).expect("digest"),
    );
}

#[test]
fn genesis_and_transfer_claims_are_distinguishable_in_the_digest() {
    let genesis = Claim::Genesis {
        ticker: Ticker::new("DOGE").expect("valid"),
        decimals: 6,
        amount: 1_000,
    };
    let mk = |claim: &Claim| {
        NoteData::new(vec![NoteDataEntry::new(
            "meme".to_string(),
            NoteDataValue::Noun(claim.to_noun().expect("encodes")),
        )])
    };
    assert_ne!(
        note_data_digest(&mk(&genesis)).expect("digest"),
        note_data_digest(&mk(&claim())).expect("digest"),
    );
}
