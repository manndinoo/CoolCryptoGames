//! Omitted history must be refused, not guessed around.
//!
//! The live chain showed the hazard: a genesis that spent an earlier token's
//! note was reported `Created` by a rebuild given only its own transactions,
//! and `Burned` by the full replay. These tests pin the guard that makes the
//! short replay refuse instead.

use std::collections::BTreeSet;

use nmeme_core::claim::NOTE_DATA_KEY;
use nmeme_index::{funding_lines, has_claim, name_key, parse_funding, require_provenance, Snapshot};
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
    let err = require_provenance("B", &[name(10)], &set(&[]), &set(&[])).unwrap_err();
    assert!(err.contains("B:"), "{err}");
    assert!(err.contains(&name(10).first.to_base58()), "names the input: {err}");
    assert!(err.contains("burn"), "explains the consequence: {err}");
}

#[test]
fn an_output_of_an_earlier_step_is_known() {
    // With genesis A replayed first, its output (note 10) is known and B's
    // spend of it is admissible — the replay will then correctly burn it.
    require_provenance("B", &[name(10)], &set(&[name(10)]), &set(&[])).unwrap();
}

#[test]
fn a_note_proven_token_free_is_known() {
    require_provenance("B", &[name(10)], &set(&[]), &set(&[name(10)])).unwrap();
}

#[test]
fn every_input_must_be_covered_not_just_one() {
    let err = require_provenance("B", &[name(10), name(11)], &set(&[name(10)]), &set(&[])).unwrap_err();
    assert!(err.contains(&name(11).first.to_base58()), "{err}");
}

#[test]
fn a_note_with_a_claim_is_not_token_free() {
    // A FUNDING line marks a note `claim` when its note-data carries the meme
    // key. parse_funding must not let that note into the token-free set.
    let snap = Snapshot {
        height: 7,
        block_id: "blk".into(),
        notes: vec![
            (name(1), "alice".into(), vec![], 5_000),
            (name(2), "alice".into(), vec![(NOTE_DATA_KEY.to_string(), vec![1, 2, 3])], 9_000),
        ],
    };
    assert!(!has_claim(&snap.notes[0].2));
    assert!(has_claim(&snap.notes[1].2));
    let text = funding_lines(&snap).join("\n");
    assert!(text.contains("HEIGHT\t7"));
    let parsed = parse_funding(&text).unwrap();
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0], (name(1), true));
    assert_eq!(parsed[1], (name(2), false));

    let token_free: BTreeSet<Vec<u8>> =
        parsed.iter().filter(|(_, free)| *free).map(|(n, _)| name_key(n)).collect();
    require_provenance("B", &[name(1)], &set(&[]), &token_free).unwrap();
    assert!(require_provenance("B", &[name(2)], &set(&[]), &token_free).is_err());
}

#[test]
fn a_malformed_funding_line_is_an_error_not_a_skip() {
    assert!(parse_funding("FUNDING\tnot-base58\tx\ttokenfree\t1").is_err());
    assert!(parse_funding("FUNDING\t1\t2").is_err());
    // Unknown line kinds are fine; they are the HEIGHT/BLOCK headers.
    assert!(parse_funding("HEIGHT\t3\nBLOCK\tabc\n").unwrap().is_empty());
}
