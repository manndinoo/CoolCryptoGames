//! Fee enforcement after attachment.

use nmeme_tx::fee::{required_fee, FeeParams};
use nockchain_types::tx_engine::common::{Hash, Name, Nicks};
use nockchain_types::tx_engine::v1::note::NoteData;
use nockchain_types::tx_engine::v1::tx::{
    LockMerkleProof, MerkleProof, PkhSignature, Seed, Seeds, Spend, Spend1, SpendCondition, Spends, Witness,
};

fn hash(n: u64) -> Hash { Hash::from_limbs(&[n, n + 1, n + 2, n + 3, n + 4]) }
fn alice() -> Hash { hash(1000) }
fn bob() -> Hash { hash(2000) }
fn seed(lock: Hash, gift: u64) -> Seed {
    Seed { output_source: None, lock_root: lock, note_data: NoteData::new(vec![]), gift: Nicks(gift as usize), parent_hash: hash(7) }
}
fn spends(fee: u64) -> Spends {
    Spends(vec![(
        Name::new(hash(1), hash(2)),
        Spend::Witness(Spend1 {
            witness: Witness {
                lock_merkle_proof: LockMerkleProof::new_full(
                    SpendCondition::simple_pkh(alice()), 2, MerkleProof { root: hash(5), path: vec![hash(6)] }),
                pkh_signature: PkhSignature::new(vec![]),
                hax: vec![],
                tim: 0,
            },
            seeds: Seeds(vec![seed(alice(), 5_000), seed(bob(), 1_000)]),
            fee: Nicks(fee as usize),
        }),
    )])
}
fn fakenet() -> FeeParams { FeeParams::fakenet(10) }

#[test]
fn fee_must_include_the_supplied_merkle_path() {
    use nockchain_math::belt::Belt;
    use nockchain_types::tx_engine::common::BlockHeight;
    use wallet_tx_builder::types::ChainContext;
    use wallet_tx_builder::word_count::{WitnessWordInput, WordCountEstimator};
    let s = spends(0);
    let actual = required_fee(&s, fakenet()).expect("fee");
    let context = ChainContext {
        height: BlockHeight(Belt(10)), bythos_phase: BlockHeight(Belt(1)),
        base_fee: 128, input_fee_divisor: 4, min_fee: 256,
    };
    let expected = WordCountEstimator::new(&context).estimate_witness_words(&[
        WitnessWordInput { spend_condition: SpendCondition::simple_pkh(alice()),
            input_origin_page: BlockHeight(Belt(10)), spend_condition_count: Some(2) }
    ]);
    assert_eq!(actual.witness_words, expected,
        "one supplied Merkle sibling must be charged; fee estimator must use actual path length");
}
