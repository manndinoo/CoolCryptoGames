//! Tests the seam between what goes into a transaction and what comes back
//! from the node.
//!
//! `nmeme-tx` writes a claim as a `NoteDataValue::Noun`; the node hands it back
//! as a jammed blob in `NoteDataEntry.blob`. If those two disagree, balances
//! read from the chain would be wrong or absent while every unit test still
//! passed, because nothing else exercises both sides.

use nmeme_core::{Claim, Ticker, TokenId};
use nmeme_index::{decode_claim, encode_claim, DecodeError};
use nockchain_types::tx_engine::common::Hash;

fn hash(seed: u64) -> Hash {
    Hash::from_limbs(&[seed, seed + 1, seed + 2, seed + 3, seed + 4])
}

fn transfer(amount: u64) -> Claim {
    Claim::Transfer {
        token: TokenId(hash(31337)),
        amount,
    }
}

fn genesis() -> Claim {
    Claim::Genesis {
        ticker: Ticker::new("DOGE").expect("valid"),
        decimals: 6,
        amount: 1_000_000,
        token: TokenId(Hash::from_limbs(&[1, 2, 3, 4, 5])),
    }
}

#[test]
fn a_transfer_claim_survives_the_blob_encoding() {
    let claim = transfer(1_000);
    let blob = encode_claim(&claim).expect("encodes");
    assert_eq!(decode_claim(&blob).expect("decodes"), claim);
}

#[test]
fn a_genesis_claim_survives_the_blob_encoding() {
    let claim = genesis();
    let blob = encode_claim(&claim).expect("encodes");
    assert_eq!(decode_claim(&blob).expect("decodes"), claim);
}

#[test]
fn every_ticker_width_survives() {
    for raw in ["A", "DOGE", "ABCDEFG", "ABCDEFGH", "PEPE2024"] {
        let claim = Claim::Genesis {
            ticker: Ticker::new(raw).expect("valid"),
            decimals: 0,
            amount: 1,
            token: TokenId(Hash::from_limbs(&[9, 8, 7, 6, 5])),
        };
        let blob = encode_claim(&claim).expect("encodes");
        assert_eq!(decode_claim(&blob).expect("decodes"), claim, "{raw}");
    }
}

#[test]
fn the_supply_cap_survives_the_round_trip() {
    let claim = transfer(nmeme_core::claim::MAX_SUPPLY);
    let blob = encode_claim(&claim).expect("encodes");
    assert_eq!(decode_claim(&blob).expect("decodes"), claim);
}

#[test]
fn a_truncated_blob_is_rejected_not_misread() {
    let blob = encode_claim(&transfer(1_000)).expect("encodes");
    let truncated = &blob[..blob.len() / 2];
    // Must be an error, and must not be some other valid-looking claim.
    match decode_claim(truncated) {
        Err(DecodeError::Cue(_)) | Err(DecodeError::NotBased(_)) | Err(DecodeError::Claim(_)) => {}
        Ok(claim) => panic!("truncated blob decoded as {claim:?}"),
    }
}

#[test]
fn garbage_is_rejected() {
    assert!(decode_claim(&[0xff, 0xff, 0xff, 0xff]).is_err());
    assert!(decode_claim(&[]).is_err());
}

#[test]
fn a_foreign_payload_under_the_meme_key_is_rejected() {
    // Anyone may put anything under the `meme` key. A note carrying a payload
    // that is not an NMEME claim must contribute no weight rather than being
    // coerced into one.
    use nockchain_math::owned_based_noun::OwnedBasedNoun;
    use nockchain_types::tx_engine::v1::note::NoteDataValue;

    let foreign = OwnedBasedNoun::tuple_atoms(&[1, 2, 3]).expect("based");
    let blob = NoteDataValue::Noun(foreign).raw_blob().to_vec();
    assert!(matches!(decode_claim(&blob), Err(DecodeError::Claim(_))));
}

#[test]
fn a_future_version_is_rejected_rather_than_guessed() {
    // Version 0 is the only shape defined. A payload claiming a later version
    // must not be reinterpreted as v0.
    use nockchain_math::owned_based_noun::OwnedBasedNoun;
    use nockchain_types::tx_engine::v1::note::NoteDataValue;

    let v1_payload = OwnedBasedNoun::cell(
        OwnedBasedNoun::try_atom(1).expect("based"), // version 1
        OwnedBasedNoun::tuple_atoms(&[b't' as u64, 5]).expect("based"),
    );
    let blob = NoteDataValue::Noun(v1_payload).raw_blob().to_vec();
    assert!(matches!(decode_claim(&blob), Err(DecodeError::Claim(_))));
}
