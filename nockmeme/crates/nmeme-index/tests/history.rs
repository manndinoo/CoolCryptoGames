//! Omitted history must be refused, not guessed around.
//!
//! The live chain showed the hazard: a genesis that spent an earlier token's
//! note was reported `Created` by a rebuild given only its own transactions,
//! and `Burned` by the full replay. These tests pin the guard that makes the
//! short replay refuse instead.

use std::collections::BTreeSet;

use nmeme_core::claim::NOTE_DATA_KEY;
use nmeme_index::{
    admitted_token_free, funding_line, has_claim, name_key, parse_funding, require_provenance, FundingStatus,
    NoteRow,
};
use nmeme_tx::names::coinbase_last_name;
use nockchain_types::tx_engine::common::{Hash, Name};

fn hash(n: u64) -> Hash {
    Hash::from_limbs(&[n, n + 1, n + 2, n + 3, n + 4])
}
fn name(n: u64) -> Name {
    Name::new(hash(n), hash(n + 100))
}
fn set(names: &[Name]) -> BTreeSet<Vec<u8>> {
    names.iter().map(name_key).collect()
}

#[test]
fn an_input_from_nowhere_is_refused_and_named() {
    // Genesis B spends note 10, which nothing in the supplied history produced
    // and no funding proof covers. This is exactly the omitted-history case.
    let err = require_provenance("B", &[name(10)], &set(&[]), &set(&[]), &set(&[])).unwrap_err();
    assert!(err.contains("B:"), "{err}");
    assert!(err.contains(&name(10).first.to_base58()), "names the input: {err}");
    assert!(err.contains("burn"), "explains the consequence: {err}");
}

#[test]
fn an_output_of_an_earlier_step_is_known() {
    // With genesis A replayed first, its output (note 10) is known and B's
    // spend of it is admissible — the replay will then correctly burn it.
    require_provenance("B", &[name(10)], &set(&[name(10)]), &set(&[]), &set(&[])).unwrap();
}

#[test]
fn a_note_proven_token_free_is_known() {
    require_provenance("B", &[name(10)], &set(&[]), &set(&[name(10)]), &set(&[])).unwrap();
}

#[test]
fn every_input_must_be_covered_not_just_one() {
    let err = require_provenance("B", &[name(10), name(11)], &set(&[name(10)]), &set(&[]), &set(&[])).unwrap_err();
    assert!(err.contains(&name(11).first.to_base58()), "{err}");
}

#[test]
fn a_note_with_a_claim_is_not_token_free() {
    // A FUNDING line marks a note `claim` when its note-data carries the meme
    // key. Nothing about such a record may reach the token-free set.
    let plain = NoteRow { name: name(1), address: "alice".into(), data: vec![], assets: 5_000, origin_page: 3 };
    let claimed = NoteRow {
        name: name(2),
        address: "alice".into(),
        data: vec![(NOTE_DATA_KEY.to_string(), vec![1, 2, 3])],
        assets: 9_000,
        origin_page: 3,
    };
    assert!(!has_claim(&plain.data));
    assert!(has_claim(&claimed.data));
    let text = format!(
        "HEIGHT\t7\n{}\n{}\n",
        funding_line(&plain, FundingStatus::Plain),
        funding_line(&claimed, FundingStatus::Claim)
    );
    let parsed = parse_funding(&text).unwrap();
    assert_eq!(parsed.len(), 2);
    assert_eq!((parsed[0].status, parsed[0].origin_page), (FundingStatus::Plain, Some(3)));
    assert_eq!(parsed[1].status, FundingStatus::Claim);

    // Neither `plain` nor `claim` is admissible evidence for a rebuild: once
    // spent, nothing can re-verify a plain note, and a claim is never free.
    let token_free = admitted_token_free(&parsed, |_| Err("unused".into())).unwrap();
    assert!(token_free.is_empty());
    assert!(require_provenance("B", &[name(1)], &set(&[]), &token_free, &set(&[])).is_err());
    assert!(require_provenance("B", &[name(2)], &set(&[]), &token_free, &set(&[])).is_err());
}

#[test]
fn a_coinbase_record_is_admitted_only_when_its_name_recomputes() {
    // The note's last name is the coinbase name for parent block 77.
    let parent = hash(77);
    let cb = NoteRow {
        name: Name::new(hash(1), coinbase_last_name(&parent)),
        address: "alice".into(),
        data: vec![],
        assets: 5_000,
        origin_page: 640,
    };
    let text = funding_line(&cb, FundingStatus::Coinbase);
    let recs = parse_funding(&text).unwrap();

    // The chain says block 640's parent is 77: admitted.
    let ok = admitted_token_free(&recs, |h| if h == 640 { Ok(hash(77)) } else { Err(format!("no block {h}")) })
        .unwrap();
    assert!(ok.contains(&name_key(&cb.name)));
    require_provenance("B", &[cb.name.clone()], &set(&[]), &ok, &set(&[])).unwrap();

    // The chain says otherwise: the record is refused loudly, not skipped.
    let err = admitted_token_free(&recs, |_| Ok(hash(78))).unwrap_err();
    assert!(err.contains("not the coinbase name"), "{err}");
    // No chain answer at all: refused, not admitted.
    assert!(admitted_token_free(&recs, |_| Err("offline".into())).is_err());
    // A coinbase label without an origin height cannot be checked: refused.
    let mut no_origin = recs.clone();
    no_origin[0].origin_page = None;
    assert!(admitted_token_free(&no_origin, |_| Ok(hash(77))).is_err());
}

#[test]
fn a_malformed_funding_line_is_an_error_not_a_skip() {
    assert!(parse_funding("FUNDING\tnot-base58\tx\ttokenfree\t1\t1").is_err());
    assert!(parse_funding("FUNDING\t1\t2").is_err());
    // Unknown line kinds are fine; they are the HEIGHT/BLOCK headers.
    assert!(parse_funding("HEIGHT\t3\nBLOCK\tabc\n").unwrap().is_empty());
}
