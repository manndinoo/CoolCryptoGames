//! Round-trip tests for transaction file surgery.
//!
//! `rewrite` rebuilds `[1 name spends display witness-data]` with new spends,
//! carrying `name` and `display` through untouched and rebuilding the
//! witness-data map by walking the original to preserve its tree shape. None of
//! that is exercised by the unit tests, and a bug in it would only surface as a
//! node rejection during a live run — expensive to diagnose there, cheap here.

use nmeme_core::{Claim, TokenId};
use nmeme_tx::sighash::spend_sig_hash;
use nmeme_tx::txfile::{rewrite, ParsedTransaction};
use nmeme_tx::attach_claim;
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockchain_types::tx_engine::common::{Hash, Name, Nicks};
use nockchain_types::tx_engine::v1::note::NoteData;
use nockchain_types::tx_engine::v1::tx::{
    LockMerkleProof, MerkleProof, PkhSignature, Seed, Seeds, Spend, Spend1, SpendCondition, Spends,
    Witness,
};
use nockvm::noun::{NounAllocator, T};
use noun_serde::NounEncode;

fn hash(seed: u64) -> Hash {
    Hash::from_limbs(&[seed, seed + 1, seed + 2, seed + 3, seed + 4])
}
fn name(seed: u64) -> Name {
    Name::new(hash(seed), hash(seed + 100))
}
fn alice() -> Hash {
    hash(1000)
}
fn bob() -> Hash {
    hash(2000)
}

fn seed_to(lock_root: Hash, gift: u64) -> Seed {
    Seed {
        output_source: None,
        lock_root,
        note_data: NoteData::new(vec![]),
        gift: Nicks(gift as usize),
        parent_hash: hash(77),
    }
}

fn witness() -> Witness {
    Witness {
        lock_merkle_proof: LockMerkleProof::new_full(
            SpendCondition::simple_pkh(alice()),
            2,
            MerkleProof {
                root: hash(5),
                path: vec![hash(6)],
            },
        ),
        // Empty: these tests exercise noun surgery, not signature validity.
        pkh_signature: PkhSignature::new(vec![]),
        hax: vec![],
        tim: 0,
    }
}

fn sample_spends() -> Spends {
    Spends(vec![(
        name(1),
        Spend::Witness(Spend1 {
            witness: witness(),
            seeds: Seeds(vec![seed_to(alice(), 5_000), seed_to(bob(), 1_000)]),
            fee: Nicks(256),
        }),
    )])
}

/// Builds `[1 name spends display witness-data]` as the wallet writes it,
/// where witness-data is `[1 map]` and map is a single-entry `[[k v] l r]`.
fn build_tx_file(spends: &Spends) -> Vec<u8> {
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let tag = nockvm::noun::D(1);
    let tx_name = nockchain_types::tx_engine::common::Name::new(hash(900), hash(901));
    let name_noun = tx_name.to_noun(&mut slab);
    let spends_noun = spends.to_noun(&mut slab);
    let display_noun = nockvm::noun::D(0);

    let entry_key = spends.0[0].0.to_noun(&mut slab);
    let entry_val = witness().to_noun(&mut slab);
    let entry = T(&mut slab, &[entry_key, entry_val]);
    let map = T(&mut slab, &[entry, nockvm::noun::D(0), nockvm::noun::D(0)]);
    let witness_data = T(&mut slab, &[nockvm::noun::D(1), map]);

    let root = T(
        &mut slab,
        &[tag, name_noun, spends_noun, display_noun, witness_data],
    );
    slab.set_root(root);
    slab.jam().to_vec()
}

fn reload(bytes: &[u8]) -> (NounSlab<NockJammer>, Spends) {
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.to_vec().into()).expect("cue");
    let space = slab.noun_space();
    let parsed = ParsedTransaction::from_noun(noun.in_space(&space)).expect("decode");
    let spends = parsed.spliced().expect("splice");
    (slab, spends)
}

#[test]
fn a_synthetic_transaction_file_round_trips_unchanged() {
    // Establishes the harness before anything is modified: if this fails, the
    // fixture is wrong rather than `rewrite`.
    let bytes = build_tx_file(&sample_spends());
    let (_slab, spends) = reload(&bytes);
    assert_eq!(spends.0.len(), 1);
    let Spend::Witness(spend1) = &spends.0[0].1 else {
        panic!("expected a v1 spend");
    };
    assert_eq!(spend1.seeds.0.len(), 2);
    assert_eq!(spend1.fee.0, 256);
}

#[test]
fn rewrite_without_changes_preserves_the_spends() {
    let bytes = build_tx_file(&sample_spends());
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.clone().into()).expect("cue");
    let space = slab.noun_space();
    let parsed = ParsedTransaction::from_noun(noun.in_space(&space)).expect("decode");
    let spends = parsed.spliced().expect("splice");

    let mut out: NounSlab<NockJammer> = NounSlab::new();
    let rewritten = rewrite(noun.in_space(&space), &mut out, &spends, &|_| None).expect("rewrite");

    let (_slab2, reloaded) = reload(&rewritten);
    assert_eq!(reloaded, spends, "an identity rewrite must change nothing");
}

#[test]
fn attaching_a_claim_survives_the_round_trip() {
    let bytes = build_tx_file(&sample_spends());
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).expect("cue");
    let space = slab.noun_space();
    let parsed = ParsedTransaction::from_noun(noun.in_space(&space)).expect("decode");
    let mut spends = parsed.spliced().expect("splice");

    let claim = Claim::Transfer {
        token: TokenId(hash(31337)),
        amount: 4_242,
    };
    let Spend::Witness(spend1) = &mut spends.0[0].1 else {
        panic!("expected a v1 spend");
    };
    let before = spend_sig_hash(&spend1.seeds, spend1.fee.0 as u64).expect("digest");
    attach_claim(&mut spend1.seeds, &bob(), &claim).expect("attach");
    let after = spend_sig_hash(&spend1.seeds, spend1.fee.0 as u64).expect("digest");
    assert_ne!(before, after, "attaching must change the signing hash");

    let mut out: NounSlab<NockJammer> = NounSlab::new();
    let rewritten = rewrite(noun.in_space(&space), &mut out, &spends, &|_| None).expect("rewrite");

    // The claim must survive jam -> cue, byte-identically in meaning.
    let (_slab2, reloaded) = reload(&rewritten);
    let Spend::Witness(reloaded_spend) = &reloaded.0[0].1 else {
        panic!("expected a v1 spend");
    };
    let bobs = reloaded_spend
        .seeds
        .0
        .iter()
        .find(|s| s.lock_root == bob())
        .expect("bob seed");
    let entry = bobs.note_data.iter().next().expect("meme entry");
    assert_eq!(entry.key, "meme");

    // And the digest of the reloaded transaction must equal the one computed
    // before writing. If jam/cue perturbed the note-data at all, the signature
    // made against `after` would be worthless.
    let reloaded_digest =
        spend_sig_hash(&reloaded_spend.seeds, reloaded_spend.fee.0 as u64).expect("digest");
    assert_eq!(
        after, reloaded_digest,
        "the digest must survive the file round trip"
    );
}

#[test]
fn other_seeds_and_the_fee_are_untouched_by_attachment() {
    let bytes = build_tx_file(&sample_spends());
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).expect("cue");
    let space = slab.noun_space();
    let parsed = ParsedTransaction::from_noun(noun.in_space(&space)).expect("decode");
    let mut spends = parsed.spliced().expect("splice");

    let Spend::Witness(spend1) = &mut spends.0[0].1 else {
        panic!("expected a v1 spend");
    };
    attach_claim(
        &mut spend1.seeds,
        &bob(),
        &Claim::Transfer {
            token: TokenId(hash(1)),
            amount: 7,
        },
    )
    .expect("attach");

    let mut out: NounSlab<NockJammer> = NounSlab::new();
    let rewritten = rewrite(noun.in_space(&space), &mut out, &spends, &|_| None).expect("rewrite");
    let (_slab2, reloaded) = reload(&rewritten);
    let Spend::Witness(reloaded_spend) = &reloaded.0[0].1 else {
        panic!("expected a v1 spend");
    };

    assert_eq!(reloaded_spend.fee.0, 256, "fee unchanged");
    let alices = reloaded_spend
        .seeds
        .0
        .iter()
        .find(|s| s.lock_root == alice())
        .expect("alice seed");
    assert_eq!(alices.note_data.iter().count(), 0, "alice's seed untouched");
    assert_eq!(alices.gift.0, 5_000, "alice's gift unchanged");
}

#[test]
fn a_substituted_witness_replaces_only_its_own_entry() {
    let bytes = build_tx_file(&sample_spends());
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).expect("cue");
    let space = slab.noun_space();
    let parsed = ParsedTransaction::from_noun(noun.in_space(&space)).expect("decode");
    let spends = parsed.spliced().expect("splice");

    // A witness distinguishable from the original by its merkle root.
    let mut replacement = witness();
    replacement.lock_merkle_proof = LockMerkleProof::new_full(
        SpendCondition::simple_pkh(alice()),
        2,
        MerkleProof {
            root: hash(4242),
            path: vec![Hash::from_limbs(&[9, 9, 9, 9, 9])],
        },
    );
    let target = spends.0[0].0.clone();

    let mut out: NounSlab<NockJammer> = NounSlab::new();
    let rewritten = rewrite(noun.in_space(&space), &mut out, &spends, &|n: &Name| {
        (n == &target).then(|| replacement.clone())
    })
    .expect("rewrite");

    let (_slab2, reloaded) = reload(&rewritten);
    let Spend::Witness(reloaded_spend) = &reloaded.0[0].1 else {
        panic!("expected a v1 spend");
    };
    assert_eq!(
        reloaded_spend.witness, replacement,
        "the substituted witness must come back"
    );
}

/// Writes the synthetic transaction to `$NMEME_SYNTH_OUT` so the CLI can be
/// driven against it without a node. A no-op unless the variable is set.
#[test]
fn dump_synthetic_transaction_when_asked() {
    let Ok(path) = std::env::var("NMEME_SYNTH_OUT") else { return };
    std::fs::write(&path, build_tx_file(&sample_spends())).expect("write synthetic tx");
}
