//! Output-name derivation, checked against real code where real code exists.

use nmeme_tx::names::{first_name, last_name, output_name, seeds_digest};
use nockchain_types::tx_engine::common::{FirstName, Hash, Nicks, Source};
use nockchain_types::tx_engine::v1::note::NoteData;
use nockchain_types::tx_engine::v1::tx::Seed;

fn hash(n: u64) -> Hash {
    Hash::from_limbs(&[n, n + 1, n + 2, n + 3, n + 4])
}
fn alice() -> Hash {
    hash(1000)
}
fn seed(lock: Hash, gift: u64, parent: u64) -> Seed {
    Seed {
        output_source: None,
        lock_root: lock,
        note_data: NoteData::new(vec![]),
        gift: Nicks(gift as usize),
        parent_hash: hash(parent),
    }
}

#[test]
fn first_name_matches_the_repository_implementation() {
    // The ground-truth check for the transcription conventions used here:
    // `leaf+&` as the null leaf, pair ordering, `hash+` as identity. If this
    // holds, `last` — built the same way — is trustworthy; if it fails, nothing
    // else in this module should be believed.
    for n in [1u64, 7, 1000, 31337] {
        let lock = hash(n);
        let expected = FirstName::from_lock_root(&lock).expect("repo derives").into_hash();
        assert_eq!(first_name(&lock), expected, "lock {n}");
    }
}

#[test]
fn successive_outputs_to_the_same_recipient_have_distinct_identities() {
    // The case the summary RPC cannot distinguish: Alice receives change in two
    // consecutive transactions. Same lock-root, same first-name — and the
    // complete names must still differ, because each seed's parent-hash binds
    // it to the note it spent.
    let tx1 = output_name(&alice(), &[seed(alice(), 5_000, 11)]).expect("name");
    let tx2 = output_name(&alice(), &[seed(alice(), 5_000, 22)]).expect("name");
    assert_eq!(tx1.first, tx2.first, "same recipient, same first-name");
    assert_ne!(tx1.last, tx2.last, "different notes, different last-name");
    assert_ne!(tx1, tx2);
}

#[test]
fn equal_gifts_to_the_same_recipient_still_differ_by_parent() {
    // Matching by (recipient, amount) would collide here; full identity does not.
    let a = output_name(&alice(), &[seed(alice(), 999_900, 1)]).expect("name");
    let b = output_name(&alice(), &[seed(alice(), 999_900, 2)]).expect("name");
    assert_ne!(a, b);
}

#[test]
fn the_name_is_a_pure_function_of_the_seed_set() {
    let x = output_name(&alice(), &[seed(alice(), 5, 3), seed(alice(), 6, 4)]).expect("name");
    let y = output_name(&alice(), &[seed(alice(), 6, 4), seed(alice(), 5, 3)]).expect("name");
    assert_eq!(x, y, "z-set order, not vec order, determines the digest");
}

#[test]
fn output_source_is_stripped_before_hashing() {
    // Consensus normalizes seeds by removing output-source before hashing
    // (tx-engine-1.hoon:2370-2375), so a pinned and an unpinned copy of the
    // same seed must name the same output.
    let plain = seed(alice(), 5_000, 9);
    let pinned = Seed { output_source: Some(Source { hash: hash(77), is_coinbase: false }), ..plain.clone() };
    assert_eq!(seeds_digest(&[plain.clone()]).expect("d"), seeds_digest(&[pinned]).expect("d"));
}

#[test]
fn merged_seeds_name_one_note() {
    // Two seeds to one lock-root become one note; its identity covers both.
    let both = output_name(&alice(), &[seed(alice(), 400, 1), seed(alice(), 600, 1)]).expect("name");
    let one = output_name(&alice(), &[seed(alice(), 400, 1)]).expect("name");
    assert_ne!(both, one);
}

#[test]
fn a_seed_for_another_lock_is_rejected() {
    assert!(output_name(&alice(), &[seed(hash(2000), 1, 1)]).is_err());
    assert!(output_name(&alice(), &[]).is_err());
}

#[test]
fn last_name_depends_on_the_seeds_hash() {
    assert_ne!(last_name(&hash(1)), last_name(&hash(2)));
}

/// Pinned from the live fakenet (chain at height 737, 2026-09-11): the node
/// reports Alice's reward note from block 398 as
/// `[4mWu8uLjC6W9BgWVzTW9r4qJ3ZPMNgP28xDnKfy1QYz14mkjyF4b8Ax Y6bv9Wvc71jbj6FbddPRswigF6r6vk75xMNn6g2KD5cwytdpHjqY3f]`
/// with origin page 398, and `GetBlockDetails(398)` gives parent id
/// `BQ8FBXh1WF2nNHB4jefnFRy4XSXnSSkp5momunbDvkqEffY5Ui7hvAi` (block 397's id).
/// `coinbase_last_name` of that parent must be the note's last name; on the
/// same chain it matched for all 723 of Alice's reward notes and for none of
/// her token notes (results/live/evidence-after.txt).
#[test]
fn coinbase_last_name_matches_the_chain() {
    let parent = Hash::from_base58("BQ8FBXh1WF2nNHB4jefnFRy4XSXnSSkp5momunbDvkqEffY5Ui7hvAi").unwrap();
    let last = nmeme_tx::names::coinbase_last_name(&parent);
    assert_eq!(last.to_base58(), "Y6bv9Wvc71jbj6FbddPRswigF6r6vk75xMNn6g2KD5cwytdpHjqY3f");
    // The wrong parent (block 396's id, parent of 397) does not.
    let other = Hash::from_base58("AxUHNkwMSuzubiayARbbAhB2qQFvzZrwHfNXE39siwVaYPLSf48uqMd").unwrap();
    assert_ne!(nmeme_tx::names::coinbase_last_name(&other), last);
    // And a transaction output's last name for the same digest differs: the
    // is-coinbase flag is part of the source.
    assert_ne!(nmeme_tx::names::last_name(&parent), last);
}
