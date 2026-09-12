//! Output identity binding across successive transactions to one recipient.
//!
//! The chain's summary RPC exposes only a note's first-name, which is a
//! function of the lock-root. Alice's change in transaction 1 and Alice's
//! change in transaction 2 share it. A binding that matched by recipient would
//! accept either note for either step. These tests require the binding to use
//! the complete name computed from each transaction's own seeds, and to refuse
//! anything less.

use nmeme_core::{Claim, TokenId};
use nmeme_index::{bind_outputs, name_key, Destination, TxPlan};
use nmeme_tx::output_name;
use nockchain_types::tx_engine::common::{Hash, Name, Nicks};
use nockchain_types::tx_engine::v1::note::NoteData;
use nockchain_types::tx_engine::v1::tx::Seed;

fn hash(n: u64) -> Hash {
    Hash::from_limbs(&[n, n + 1, n + 2, n + 3, n + 4])
}
fn alice() -> Hash {
    hash(1000)
}
fn bob() -> Hash {
    hash(2000)
}
fn seed(lock: Hash, gift: u64, parent: &Hash) -> Seed {
    Seed {
        output_source: None,
        lock_root: lock,
        note_data: NoteData::new(vec![]),
        gift: Nicks(gift as usize),
        parent_hash: parent.clone(),
    }
}
fn dest(lock: Hash, seeds: Vec<Seed>, claim: Option<Claim>) -> Destination {
    let gift = seeds.iter().map(|s| s.gift.0 as u64).sum();
    let name = output_name(&lock, &seeds).expect("name");
    Destination { lock_root: lock, gift, claim, seeds, name }
}
fn xfer(amount: u64) -> Option<Claim> {
    Some(Claim::Transfer { token: TokenId(hash(31337)), amount })
}

/// Two successive transactions. tx1 spends a coinbase note and pays Alice
/// change plus Bob. tx2 spends tx1's Alice output and again pays Alice change
/// plus Bob — with the SAME gift to Alice, so amounts do not distinguish them.
fn two_step() -> (TxPlan, TxPlan) {
    let coinbase = Name::new(hash(1), hash(2));
    let parent1 = hash(11);
    let tx1 = TxPlan {
        inputs: vec![coinbase],
        destinations: vec![
            dest(alice(), vec![seed(alice(), 5_000, &parent1)], xfer(1_000_000)),
            dest(bob(), vec![seed(bob(), 1_000, &parent1)], None),
        ],
    };
    // tx2's input IS tx1's Alice output, by identity.
    let tx1_alice = tx1.destinations[0].name.clone();
    let parent2 = hash(22);
    let tx2 = TxPlan {
        inputs: vec![tx1_alice],
        destinations: vec![
            dest(alice(), vec![seed(alice(), 5_000, &parent2)], xfer(999_900)),
            dest(bob(), vec![seed(bob(), 1_000, &parent2)], xfer(100)),
        ],
    };
    (tx1, tx2)
}

#[test]
fn successive_change_outputs_to_alice_share_a_first_name() {
    // The premise: recipient-only matching cannot tell these apart.
    let (tx1, tx2) = two_step();
    assert_eq!(tx1.destinations[0].name.first, tx2.destinations[0].name.first);
    assert_ne!(tx1.destinations[0].name, tx2.destinations[0].name);
}

#[test]
fn each_step_binds_to_its_own_note_and_only_that_note() {
    let (tx1, tx2) = two_step();
    // Unspent at the end: tx2's outputs, and tx1's Bob output (never spent).
    let unspent = vec![
        tx2.destinations[0].name.clone(),
        tx2.destinations[1].name.clone(),
        tx1.destinations[1].name.clone(),
    ];
    let mut taken = Vec::new();

    // Step 1 candidates: later inputs + unspent.
    let mut c1 = tx2.inputs.clone();
    c1.extend(unspent.iter().cloned());
    let b1 = bind_outputs(&tx1.destinations, &c1, &mut taken, None).expect("step 1 binds");
    assert_eq!(b1[0].0, tx2.inputs[0], "tx1's Alice output is exactly tx2's input");

    // Step 2 candidates: unspent only.
    let b2 = bind_outputs(&tx2.destinations, &unspent, &mut taken, None).expect("step 2 binds");
    assert_eq!(b2[0].0, tx2.destinations[0].name);
    assert_ne!(b1[0].0, b2[0].0, "the two Alice notes are different notes");
}

#[test]
fn a_note_with_the_right_recipient_but_wrong_identity_is_refused() {
    // The failure recipient-only matching would silently accept: the
    // candidate set contains an Alice note (same first-name) that is NOT the
    // one this transaction created.
    let (tx1, tx2) = two_step();
    let impostor = output_name(&alice(), &[seed(alice(), 5_000, &hash(99))]).expect("name");
    assert_eq!(impostor.first, tx1.destinations[0].name.first, "same recipient");

    let candidates = vec![impostor, tx1.destinations[1].name.clone()];
    let mut taken = Vec::new();
    let err = bind_outputs(&tx1.destinations, &candidates, &mut taken, None).expect_err("must refuse");
    assert!(err.contains("no chain note has the identity"), "{err}");
    let _ = tx2;
}

#[test]
fn a_note_cannot_be_claimed_by_two_steps() {
    let (tx1, _) = two_step();
    let candidates: Vec<Name> = tx1.destinations.iter().map(|d| d.name.clone()).collect();
    let mut taken = vec![name_key(&tx1.destinations[0].name)]; // already produced earlier
    let err = bind_outputs(&tx1.destinations, &candidates, &mut taken, None).expect_err("must refuse");
    assert!(err.contains("already produced"), "{err}");
}

#[test]
fn a_missing_output_fails_rather_than_binding_partially() {
    let (tx1, _) = two_step();
    // Bob's note is absent from the chain's view.
    let candidates = vec![tx1.destinations[0].name.clone()];
    let mut taken = Vec::new();
    assert!(bind_outputs(&tx1.destinations, &candidates, &mut taken, None).is_err());
}

#[test]
fn equal_gifts_across_steps_never_collide_in_binding() {
    // Both steps pay Alice exactly 5,000 and Bob exactly 1,000. Amount-based
    // pairing would be ambiguous; identity-based binding is not.
    let (tx1, tx2) = two_step();
    assert_eq!(tx1.destinations[0].gift, tx2.destinations[0].gift);
    assert_eq!(tx1.destinations[1].gift, tx2.destinations[1].gift);
    let all: Vec<Name> = tx1.destinations.iter().chain(tx2.destinations.iter()).map(|d| d.name.clone()).collect();
    let keys: std::collections::BTreeSet<Vec<u8>> = all.iter().map(name_key).collect();
    assert_eq!(keys.len(), 4, "four outputs, four distinct identities");
}
