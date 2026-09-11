//! Funding evidence is verified, never trusted; missing data is never "empty".
//!
//! Two gaps an outside review found in the provenance guard:
//!
//! 1. A `FUNDING` line is text. The checker took its `tokenfree` label at
//!    face value, so an edited line could admit a claim-bearing note, and a
//!    `tokenfree` line could override a `claim` line for the same note.
//! 2. The balance reader turned a missing note body, a missing note-data
//!    field, or an unknown note version into an empty claim list, which the
//!    guard then read as "no claim" — token-free by absence of data.
//!
//! Every test here was run against the implementation under review first;
//! the ones that failed then are the regressions, and they pass after the
//! fix. See results/RESULTS.md §A13 for the record.

use nmeme_core::claim::NOTE_DATA_KEY;
use nmeme_index::{admitted_token_free, classify_input, name_key, note_from_entry, parse_funding, InputVerdict, NoteRow};
use nockapp_grpc_proto::pb::common::v1 as pb1;
use nockapp_grpc_proto::pb::common::v2 as pb2;
use nockchain_types::tx_engine::common::{Hash, Name};

fn hash(n: u64) -> Hash {
    Hash::from_limbs(&[n, n + 1, n + 2, n + 3, n + 4])
}
fn name(n: u64) -> Name {
    Name::new(hash(n), hash(n + 100))
}
fn pb_hash(h: &Hash) -> pb1::Hash {
    let b = |i: usize| Some(pb1::Belt { value: h.0[i].0 });
    pb1::Hash { belt_1: b(0), belt_2: b(1), belt_3: b(2), belt_4: b(3), belt_5: b(4) }
}
fn pb_name(n: &Name) -> pb1::Name {
    pb1::Name { first: Some(pb_hash(&n.first)), last: Some(pb_hash(&n.last)) }
}
fn v1_note(n: &Name, entries: Vec<pb2::NoteDataEntry>) -> pb2::NoteV1 {
    pb2::NoteV1 {
        version: Some(pb1::NoteVersion { value: 1 }),
        origin_page: Some(pb1::BlockHeight { value: 640 }),
        name: Some(pb_name(n)),
        note_data: Some(pb2::NoteData { entries }),
        assets: Some(pb1::Nicks { value: 4_294_958_104 }),
    }
}
fn entry(n: &Name, note: Option<pb2::Note>) -> pb2::BalanceEntry {
    pb2::BalanceEntry { name: Some(pb_name(n)), note }
}
fn wrap(v1: pb2::NoteV1) -> Option<pb2::Note> {
    Some(pb2::Note { note_version: Some(pb2::note::NoteVersion::V1(v1)) })
}
fn line(n: &Name, status: &str) -> String {
    format!("FUNDING\t{}\t{}\t{}\t5\t640\n", n.first.to_base58(), n.last.to_base58(), status)
}

// --- gap 1: funding records ------------------------------------------------

#[test]
fn conflicting_funding_records_are_rejected() {
    // The same note, once `claim`, once `tokenfree`. Whichever line came
    // second must not win; the file is inconsistent and is refused whole.
    let text = format!("{}{}", line(&name(1), "claim"), line(&name(1), "tokenfree"));
    let err = parse_funding(&text).expect_err("conflicting records must be an error");
    assert!(err.contains("conflict") || err.contains("disagree"), "{err}");
    let text = format!("{}{}", line(&name(1), "tokenfree"), line(&name(1), "claim"));
    assert!(parse_funding(&text).is_err(), "order must not matter");
}

#[test]
fn identical_duplicate_records_are_not_a_conflict() {
    let text = format!("{}{}", line(&name(1), "claim"), line(&name(1), "claim"));
    assert_eq!(parse_funding(&text).unwrap().len(), 2);
}

#[test]
fn a_tokenfree_label_alone_admits_nothing() {
    // A record that says `tokenfree` and has nothing on the chain behind it.
    // The chain oracle here knows no block at all, so no evidence can be
    // checked; the label must not be enough.
    let recs = parse_funding(&line(&name(1), "tokenfree")).unwrap();
    let admitted = admitted_token_free(&recs, |_h| Err("no such block".to_string()))
        .unwrap_or_default();
    assert!(
        !admitted.contains(&name_key(&name(1))),
        "a label with no verifiable evidence must not admit the note"
    );
}

// --- gap 2: the balance reader --------------------------------------------

#[test]
fn a_missing_note_body_is_not_token_free() {
    let err = note_from_entry(&entry(&name(1), None), "alice").expect_err("no body, no verdict");
    assert!(err.contains("no note"), "{err}");
}

#[test]
fn a_missing_note_version_is_refused() {
    let e = entry(&name(1), Some(pb2::Note { note_version: None }));
    assert!(note_from_entry(&e, "alice").is_err());
}

#[test]
fn a_legacy_v0_note_is_refused_explicitly_not_read_as_empty() {
    let e = entry(
        &name(1),
        Some(pb2::Note { note_version: Some(pb2::note::NoteVersion::Legacy(pb1::Note::default())) }),
    );
    let err = note_from_entry(&e, "alice").expect_err("a v0 note has no note-data to read");
    assert!(err.contains("v0"), "names the version: {err}");
}

#[test]
fn a_missing_note_data_field_is_refused() {
    let mut v1 = v1_note(&name(1), vec![]);
    v1.note_data = None;
    assert!(note_from_entry(&entry(&name(1), wrap(v1)), "alice").is_err());
}

#[test]
fn missing_assets_or_origin_are_refused() {
    let mut v1 = v1_note(&name(1), vec![]);
    v1.assets = None;
    assert!(note_from_entry(&entry(&name(1), wrap(v1)), "alice").is_err());
    let mut v1 = v1_note(&name(1), vec![]);
    v1.origin_page = None;
    assert!(note_from_entry(&entry(&name(1), wrap(v1)), "alice").is_err());
}

#[test]
fn an_unsupported_version_value_is_refused() {
    let mut v1 = v1_note(&name(1), vec![]);
    v1.version = Some(pb1::NoteVersion { value: 2 });
    let err = note_from_entry(&entry(&name(1), wrap(v1)), "alice").expect_err("only v1 is read");
    assert!(err.contains("version"), "{err}");
}

#[test]
fn the_body_name_must_match_the_entry_name() {
    // The entry says note 1, the body says note 2: an inconsistent response.
    let v1 = v1_note(&name(2), vec![]);
    assert!(note_from_entry(&entry(&name(1), wrap(v1)), "alice").is_err());
}

#[test]
fn a_verified_empty_claim_list_is_token_free_and_carries_its_origin() {
    // The positive control: a complete v1 body with no entries is a note the
    // reader has actually seen to be claim-free.
    let row = note_from_entry(&entry(&name(1), wrap(v1_note(&name(1), vec![]))), "alice").unwrap();
    assert!(row.data.is_empty());
    assert_eq!(row.origin_page, 640);
    assert_eq!(row.assets, 4_294_958_104);
    let with_claim = vec![pb2::NoteDataEntry { key: NOTE_DATA_KEY.to_string(), blob: vec![1, 2] }];
    let row = note_from_entry(&entry(&name(1), wrap(v1_note(&name(1), with_claim))), "alice").unwrap();
    assert!(nmeme_index::has_claim(&row.data));
}

// --- the gate reads the note, not a label ----------------------------------

#[test]
fn check_inputs_verdicts_come_from_the_live_note_not_a_label() {
    let plain = NoteRow { name: name(1), address: "alice".into(), data: vec![], assets: 5, origin_page: 640 };
    let token = NoteRow {
        name: name(2),
        address: "alice".into(),
        data: vec![(NOTE_DATA_KEY.to_string(), vec![9])],
        assets: 5,
        origin_page: 641,
    };
    let live = vec![plain, token];
    assert_eq!(classify_input(&name(1), &live, &[]), InputVerdict::TokenFree);
    // The claim-bearing note is refused unless it was named as the note to move.
    assert!(matches!(classify_input(&name(2), &live, &[]), InputVerdict::Refused(_)));
    assert_eq!(classify_input(&name(2), &live, &[name(2)]), InputVerdict::NamedTokenNote);
    // A note the node does not show unspent has no verdict but refusal.
    let why = match classify_input(&name(3), &live, &[name(3)]) {
        InputVerdict::Refused(w) => w,
        other => panic!("{other:?}"),
    };
    assert!(why.contains("not an unspent note"), "{why}");
}

// --- conflicts across files ------------------------------------------------

#[test]
fn conflicting_records_across_files_are_rejected_in_either_order() {
    // File 1 says the note carries a claim; file 2 says it is a coinbase note
    // and the chain even agrees with file 2's recomputation. Combined, the
    // records disagree about one note, and the combination must be refused
    // whichever file came first — a coinbase line must never win over a
    // claim line by being parsed from a later file.
    use nmeme_tx::names::coinbase_last_name;
    let parent = hash(77);
    let n = Name::new(hash(1), coinbase_last_name(&parent));
    let claim_file = format!("FUNDING\t{}\t{}\tclaim\t5\t640\n", n.first.to_base58(), n.last.to_base58());
    let coinbase_file = format!("FUNDING\t{}\t{}\tcoinbase\t5\t640\n", n.first.to_base58(), n.last.to_base58());
    let oracle = |h: u64| if h == 640 { Ok(hash(77)) } else { Err(format!("no block {h}")) };

    let mut combined = parse_funding(&claim_file).unwrap();
    combined.extend(parse_funding(&coinbase_file).unwrap());
    let err = admitted_token_free(&combined, oracle).expect_err("claim then coinbase: conflict");
    assert!(err.contains("conflict"), "{err}");

    let mut combined = parse_funding(&coinbase_file).unwrap();
    combined.extend(parse_funding(&claim_file).unwrap());
    let err = admitted_token_free(&combined, oracle).expect_err("coinbase then claim: conflict");
    assert!(err.contains("conflict"), "{err}");

    // Identical records from two files are the same fact twice: fine.
    let mut combined = parse_funding(&coinbase_file).unwrap();
    combined.extend(parse_funding(&coinbase_file).unwrap());
    let admitted = admitted_token_free(&combined, oracle).unwrap();
    assert!(admitted.contains(&name_key(&n)));
    assert_eq!(admitted.len(), 1);
}

#[test]
fn records_that_differ_only_in_assets_or_origin_are_still_a_conflict() {
    // Full note identity is the key; everything said about it must agree.
    let n = name(4);
    let a = format!("FUNDING\t{}\t{}\tclaim\t5\t640\n", n.first.to_base58(), n.last.to_base58());
    let b = format!("FUNDING\t{}\t{}\tclaim\t6\t640\n", n.first.to_base58(), n.last.to_base58());
    let c = format!("FUNDING\t{}\t{}\tclaim\t5\t641\n", n.first.to_base58(), n.last.to_base58());
    for (x, y) in [(&a, &b), (&a, &c)] {
        let mut combined = parse_funding(x).unwrap();
        combined.extend(parse_funding(y).unwrap());
        assert!(admitted_token_free(&combined, |_| Err("unused".into())).is_err());
    }
}
