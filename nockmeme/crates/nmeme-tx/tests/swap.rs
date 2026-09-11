//! The trade construction, without a node: pins commit each party to the
//! other's exact seed, and the assembler's tamper tools produce transactions
//! whose pins no longer match (the check consensus makes at validation).

use nmeme_core::{Claim, TokenId};
use nmeme_tx::names::{output_name, seeds_digest};
use nmeme_tx::sighash::{seed_sig_digest, spend_sig_hash};
use nmeme_tx::swap::{check_pins, merge, only, output_source_at, pin, replace, seeds_at_lock};
use nmeme_tx::{attach_claim, Error};
use nockchain_math::belt::Belt;
use nockchain_types::tx_engine::common::{Hash, Name, Nicks, Source};
use nockchain_types::tx_engine::v1::hashable::{hash_leaf_belt, hash_leaf_null, hash_pair};
use nockchain_types::tx_engine::v1::note::NoteData;
use nockchain_types::tx_engine::v1::tx::{
    LockMerkleProof, MerkleProof, PkhSignature, Seed, Seeds, Spend, Spend1, SpendCondition, Spends, Witness,
};

fn hash(n: u64) -> Hash { Hash::from_limbs(&[n, n + 1, n + 2, n + 3, n + 4]) }
fn alice() -> Hash { hash(1000) }
fn bob() -> Hash { hash(2000) }
fn a_input() -> Name { Name::new(hash(1), hash(2)) }
fn b_input() -> Name { Name::new(hash(3), hash(4)) }
fn seed(lock: Hash, gift: u64, parent: u64) -> Seed {
    Seed { output_source: None, lock_root: lock, note_data: NoteData::new(vec![]), gift: Nicks(gift as usize), parent_hash: hash(parent) }
}
fn spend(input: Name, owner: Hash, seeds: Vec<Seed>, fee: u64) -> Spends {
    Spends(vec![(
        input,
        Spend::Witness(Spend1 {
            witness: Witness {
                lock_merkle_proof: LockMerkleProof::new_full(
                    SpendCondition::simple_pkh(owner), 2, MerkleProof { root: hash(5), path: vec![hash(6)] }),
                pkh_signature: PkhSignature::new(vec![]),
                hax: vec![],
                tim: 0,
            },
            seeds: Seeds(seeds),
            fee: Nicks(fee as usize),
        }),
    )])
}
/// Alice's half: her token note in, dust to Bob (the token seed) and change to herself.
fn alice_half() -> Spends { spend(a_input(), alice(), vec![seed(bob(), 1_000, 7), seed(alice(), 4_000, 7)], 8_192) }
/// Bob's half: his NOCK note in, 5 NOCK to Alice and change to himself.
fn bob_half(price: u64) -> Spends { spend(b_input(), bob(), vec![seed(alice(), price, 9), seed(bob(), 1_000_000 - price, 9)], 8_192) }
fn token() -> TokenId { TokenId(hash(31337)) }
fn seeds_mut<'a>(spends: &'a mut Spends, input: &Name) -> &'a mut Seeds {
    let (_, s) = spends.0.iter_mut().find(|(n, _)| n == input).unwrap();
    let Spend::Witness(s1) = s else { unreachable!() };
    &mut s1.seeds
}
/// The honest trade: merged, claims attached, both locks pinned.
fn trade() -> Spends {
    let mut t = merge(alice_half(), bob_half(327_680)).unwrap();
    attach_claim(seeds_mut(&mut t, &a_input()), &bob(), &Claim::Transfer { token: token(), amount: 100 }).unwrap();
    attach_claim(seeds_mut(&mut t, &a_input()), &alice(), &Claim::Transfer { token: token(), amount: 999_800 }).unwrap();
    pin(&mut t, &alice(), &a_input()).unwrap();
    pin(&mut t, &bob(), &b_input()).unwrap();
    t
}

#[test]
fn the_same_input_in_both_halves_is_refused() {
    let err = merge(alice_half(), alice_half()).unwrap_err();
    assert!(matches!(err, Error::DuplicateInput(_)));
}

#[test]
fn each_pinned_lock_receives_seeds_from_both_spends() {
    let t = trade();
    assert_eq!(seeds_at_lock(&t, &alice()).len(), 2, "her change + his payment");
    assert_eq!(seeds_at_lock(&t, &bob()).len(), 2, "his change + her tokens");
}

#[test]
fn a_pin_is_the_digest_consensus_will_assign_and_sits_on_the_owners_seed() {
    let t = trade();
    // The pinned value equals the output's last-name source: what `output_name`
    // (validated live on this chain) derives for the merged seed set.
    let at_alice = seeds_at_lock(&t, &alice());
    let expected = seeds_digest(&at_alice).unwrap();
    let (_, a) = t.0.iter().find(|(n, _)| n == &a_input()).unwrap();
    let Spend::Witness(a1) = a else { unreachable!() };
    let pinned = a1.seeds.0.iter().find(|s| s.lock_root == alice()).unwrap();
    assert_eq!(pinned.output_source, Some(Source { hash: expected.clone(), is_coinbase: false }));
    assert_eq!(output_source_at(&t, &alice()).unwrap(), expected);
    assert_eq!(output_name(&alice(), &at_alice).unwrap().last, nmeme_tx::names::last_name(&expected));
    // Bob's seed paying Alice is not pinned: the pin is the owner's.
    let (_, b) = t.0.iter().find(|(n, _)| n == &b_input()).unwrap();
    let Spend::Witness(b1) = b else { unreachable!() };
    assert!(b1.seeds.0.iter().find(|s| s.lock_root == alice()).unwrap().output_source.is_none());
    assert!(check_pins(&t).unwrap().iter().all(|(_, ok)| *ok));
}

#[test]
fn pinning_a_lock_only_one_seed_pays_is_refused() {
    let mut t = merge(alice_half(), bob_half(327_680)).unwrap();
    let err = pin(&mut t, &hash(4242), &a_input()).unwrap_err();
    assert!(matches!(err, Error::NoSeedForLockRoot(_)));
    // Alice's lock with Bob's payment removed: one seed, nothing to commit to.
    let mut lone = alice_half();
    let err = pin(&mut lone, &alice(), &a_input()).unwrap_err();
    assert!(matches!(err, Error::NothingToPin(_)));
}

#[test]
fn either_half_alone_violates_its_own_pin() {
    let t = trade();
    let a_alone = only(&t, &a_input()).unwrap();
    let pins = check_pins(&a_alone).unwrap();
    assert_eq!(pins, vec![(alice(), false)], "her change is now the only seed at her lock");
    let b_alone = only(&t, &b_input()).unwrap();
    assert_eq!(check_pins(&b_alone).unwrap(), vec![(bob(), false)]);
}

#[test]
fn a_counterparty_paying_less_violates_the_other_partys_pin() {
    let t = trade();
    // Bob rebuilds his half paying 4 NOCK, pins his own lock honestly for the
    // new set, and splices it into the trade Alice signed.
    let mut cheap = merge(alice_half(), bob_half(262_144)).unwrap();
    attach_claim(seeds_mut(&mut cheap, &a_input()), &bob(), &Claim::Transfer { token: token(), amount: 100 }).unwrap();
    attach_claim(seeds_mut(&mut cheap, &a_input()), &alice(), &Claim::Transfer { token: token(), amount: 999_800 }).unwrap();
    pin(&mut cheap, &alice(), &a_input()).unwrap();
    pin(&mut cheap, &bob(), &b_input()).unwrap();
    let tampered = replace(t, &cheap, &b_input()).unwrap();
    let pins = check_pins(&tampered).unwrap();
    assert!(pins.contains(&(alice(), false)), "Alice's pin: {pins:?}");
    assert!(pins.contains(&(bob(), true)), "Bob's own pin is satisfied by design: {pins:?}");
}

#[test]
fn a_seller_delivering_fewer_tokens_violates_the_buyers_pin() {
    let t = trade();
    let mut stingy = merge(alice_half(), bob_half(327_680)).unwrap();
    attach_claim(seeds_mut(&mut stingy, &a_input()), &bob(), &Claim::Transfer { token: token(), amount: 50 }).unwrap();
    attach_claim(seeds_mut(&mut stingy, &a_input()), &alice(), &Claim::Transfer { token: token(), amount: 999_850 }).unwrap();
    pin(&mut stingy, &alice(), &a_input()).unwrap();
    pin(&mut stingy, &bob(), &b_input()).unwrap();
    let tampered = replace(t, &stingy, &a_input()).unwrap();
    let pins = check_pins(&tampered).unwrap();
    assert!(pins.contains(&(bob(), false)), "Bob's pin: {pins:?}");
}

#[test]
fn a_pinned_seed_signs_over_its_pin() {
    // `hashable-unit:source` for a pinned seed is `[leaf+~ [hash+p leaf+is-coinbase]]`,
    // so the pin is inside the signature and cannot be stripped by a relayer.
    let plain = seed(alice(), 4_000, 7);
    let mut pinned = plain.clone();
    pinned.output_source = Some(Source { hash: hash(77), is_coinbase: false });
    assert_ne!(seed_sig_digest(&plain).unwrap(), seed_sig_digest(&pinned).unwrap());
    let source = hash_pair(&hash_leaf_null(), &hash_pair(&hash(77), &hash_leaf_belt(Belt(1))));
    let expected = hash_pair(
        &source,
        &hash_pair(
            &plain.lock_root,
            &hash_pair(&nmeme_tx::note_data_digest(&plain.note_data).unwrap(), &hash_pair(&hash_leaf_belt(Belt(4_000)), &plain.parent_hash)),
        ),
    );
    assert_eq!(seed_sig_digest(&pinned).unwrap(), expected);
    // and so the spend's signing hash changes with the pin
    let t = trade();
    let (_, a) = t.0.iter().find(|(n, _)| n == &a_input()).unwrap();
    let Spend::Witness(a1) = a else { unreachable!() };
    let mut unpinned = a1.seeds.clone();
    for s in unpinned.0.iter_mut() { s.output_source = None; }
    assert_ne!(spend_sig_hash(&a1.seeds, 8_192).unwrap(), spend_sig_hash(&unpinned, 8_192).unwrap());
}
