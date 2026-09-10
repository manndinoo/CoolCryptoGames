//! Fee enforcement after attachment.

use nmeme_core::{Claim, TokenId};
use nmeme_tx::fee::{enforce_fee, required_fee, FeeParams};
use nmeme_tx::{attach_claim, Error};
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
fn claim() -> Claim { Claim::Transfer { token: TokenId(hash(31337)), amount: 100 } }
fn fakenet() -> FeeParams { FeeParams::fakenet(10) }

#[test]
fn attaching_a_claim_raises_the_required_fee() {
    // The whole reason this module exists: the wallet's fee was sized before
    // the claim existed.
    let mut s = spends(256);
    let before = required_fee(&s, fakenet()).expect("fee");
    let Spend::Witness(sp) = &mut s.0[0].1 else { unreachable!() };
    attach_claim(&mut sp.seeds, &bob(), &claim()).expect("attach");
    let after = required_fee(&s, fakenet()).expect("fee");
    assert!(after.seed_words > before.seed_words, "claim adds seed words");
    assert!(after.required >= before.required);
}

#[test]
fn a_fee_below_the_post_attach_minimum_is_refused_with_the_shortfall() {
    let mut s = spends(1);
    let Spend::Witness(sp) = &mut s.0[0].1 else { unreachable!() };
    attach_claim(&mut sp.seeds, &bob(), &claim()).expect("attach");
    let err = enforce_fee(&s, fakenet()).expect_err("must refuse");
    match err {
        Error::FeeTooLow { current, required, shortfall } => {
            assert_eq!(current, 1);
            assert!(required > 1);
            assert_eq!(shortfall, required - current);
        }
        other => panic!("wrong error: {other}"),
    }
}

#[test]
fn a_fee_at_the_minimum_is_accepted_and_one_below_is_not() {
    let mut s = spends(0);
    let Spend::Witness(sp) = &mut s.0[0].1 else { unreachable!() };
    attach_claim(&mut sp.seeds, &bob(), &claim()).expect("attach");
    let required = required_fee(&s, fakenet()).expect("fee").required;

    let Spend::Witness(sp) = &mut s.0[0].1 else { unreachable!() };
    sp.fee = Nicks(required as usize);
    enforce_fee(&s, fakenet()).expect("exactly the minimum passes");

    let Spend::Witness(sp) = &mut s.0[0].1 else { unreachable!() };
    sp.fee = Nicks((required - 1) as usize);
    assert!(enforce_fee(&s, fakenet()).is_err(), "one nick short fails");
}

#[test]
fn the_minimum_is_never_below_the_network_floor() {
    let r = required_fee(&spends(0), fakenet()).expect("fee");
    assert!(r.required >= 256, "min-fee floor of 256 nicks");
}

#[test]
fn mainnet_charges_more_per_word_than_fakenet() {
    let s = spends(0);
    let f = required_fee(&s, FeeParams::fakenet(100_000)).expect("fee");
    let m = required_fee(&s, FeeParams::mainnet(100_000)).expect("fee");
    assert_eq!(f.seed_words, m.seed_words, "same words");
    assert!(m.required > f.required, "base fee 16384 vs 128");
}
