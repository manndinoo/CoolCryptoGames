//! Expected-value fee tests that do not go through `required_fee`.
//!
//! Each case computes the witness words the repository's estimator produces
//! when told the lock's true condition count explicitly, then checks that
//! `required_fee` — which must infer that count from the Merkle path in the
//! witness — arrives at the same number. The one-sibling case is the
//! independently reported undercount, retained separately in
//! `independent_fee_path.rs`.

use nmeme_tx::fee::{required_fee, spend_condition_count_for_path, FeeParams, MAX_LOCK_PATH_LEN};
use nmeme_tx::Error;
use nockchain_math::belt::Belt;
use nockchain_types::tx_engine::common::{BlockHeight, Hash, Name, Nicks};
use nockchain_types::tx_engine::v1::note::NoteData;
use nockchain_types::tx_engine::v1::tx::{
    LockMerkleProof, MerkleProof, PkhSignature, Seed, Seeds, Spend, Spend1, SpendCondition, Spends, Witness,
};
use wallet_tx_builder::types::ChainContext;
use wallet_tx_builder::word_count::{WitnessWordInput, WordCountEstimator};

fn hash(n: u64) -> Hash { Hash::from_limbs(&[n, n + 1, n + 2, n + 3, n + 4]) }
fn alice() -> Hash { hash(1000) }
fn seed(gift: u64) -> Seed {
    Seed { output_source: None, lock_root: alice(), note_data: NoteData::new(vec![]), gift: Nicks(gift as usize), parent_hash: hash(7) }
}
fn spends_with_path(path_len: usize) -> Spends {
    let path: Vec<Hash> = (0..path_len as u64).map(|i| hash(100 + i)).collect();
    Spends(vec![(
        Name::new(hash(1), hash(2)),
        Spend::Witness(Spend1 {
            witness: Witness {
                lock_merkle_proof: LockMerkleProof::new_full(
                    SpendCondition::simple_pkh(alice()), 2, MerkleProof { root: hash(5), path }),
                pkh_signature: PkhSignature::new(vec![]),
                hax: vec![],
                tim: 0,
            },
            seeds: Seeds(vec![seed(5_000)]),
            fee: Nicks(0),
        }),
    )])
}
fn expected_witness_words(count: u64) -> u64 {
    let context = ChainContext {
        height: BlockHeight(Belt(10)), bythos_phase: BlockHeight(Belt(1)),
        base_fee: 128, input_fee_divisor: 4, min_fee: 256,
    };
    WordCountEstimator::new(&context).estimate_witness_words(&[WitnessWordInput {
        spend_condition: SpendCondition::simple_pkh(alice()),
        input_origin_page: BlockHeight(Belt(10)),
        spend_condition_count: Some(count),
    }])
}

#[test]
fn a_path_of_n_siblings_is_charged_as_a_2_to_the_n_lock() {
    for path_len in 0..=MAX_LOCK_PATH_LEN {
        let count = 1u64 << path_len;
        let actual = required_fee(&spends_with_path(path_len), FeeParams::fakenet(10)).expect("fee");
        assert_eq!(
            actual.witness_words,
            expected_witness_words(count),
            "path {path_len} must be charged as a {count}-condition lock"
        );
    }
}

#[test]
fn a_simple_lock_with_no_path_is_charged_as_before() {
    // The zero-sibling case must not have been changed by the fix.
    let actual = required_fee(&spends_with_path(0), FeeParams::fakenet(10)).expect("fee");
    assert_eq!(actual.witness_words, expected_witness_words(1));
}

#[test]
fn each_extra_sibling_costs_five_words() {
    // A sibling is one tip5 hash: five field elements. Pinning the slope
    // catches a future change to the estimator's list accounting.
    let w0 = required_fee(&spends_with_path(0), FeeParams::fakenet(10)).expect("fee").witness_words;
    let w1 = required_fee(&spends_with_path(1), FeeParams::fakenet(10)).expect("fee").witness_words;
    let w2 = required_fee(&spends_with_path(2), FeeParams::fakenet(10)).expect("fee").witness_words;
    assert_eq!(w1 - w0, 5);
    assert_eq!(w2 - w1, 5);
}

#[test]
fn the_undercount_is_now_visible_in_nicks() {
    // One sibling, no min-fee floor binding: 5 words * 128 / 4 = 160 nicks,
    // the exact figure the independent report gave.
    let f0 = required_fee(&spends_with_path(0), FeeParams::fakenet(10)).expect("fee").required;
    let f1 = required_fee(&spends_with_path(1), FeeParams::fakenet(10)).expect("fee").required;
    assert_eq!(f1 - f0, 160);
}

#[test]
fn a_path_deeper_than_any_defined_lock_is_refused_not_estimated() {
    assert!(spend_condition_count_for_path(MAX_LOCK_PATH_LEN).is_ok());
    match spend_condition_count_for_path(MAX_LOCK_PATH_LEN + 1) {
        Err(Error::UnsupportedLockShape { path_len, max }) => {
            assert_eq!(path_len, MAX_LOCK_PATH_LEN + 1);
            assert_eq!(max, MAX_LOCK_PATH_LEN);
        }
        other => panic!("expected UnsupportedLockShape, got {other:?}"),
    }
    assert!(required_fee(&spends_with_path(MAX_LOCK_PATH_LEN + 1), FeeParams::fakenet(10)).is_err());
}

#[test]
fn the_count_derivation_is_exactly_the_estimators_inverse() {
    // The estimator takes count.ilog2() as the path length; 1 << n inverts it
    // with no rounding for every depth the protocol defines.
    for n in 0..=MAX_LOCK_PATH_LEN {
        assert_eq!(spend_condition_count_for_path(n).expect("ok").ilog2() as usize, n);
    }
}
