//! Verifies the Rust `sig-hash` against transactions the Nockchain wallet
//! actually signed.
//!
//! A hand-transcribed consensus digest that is subtly wrong produces signatures
//! a node rejects, and the rejection looks like a fee or networking problem. So
//! the digest is checked before it is used, against the signed transactions the
//! repository already ships as fixtures.
//!
//! What this test can do alone: recompute the digest and print it. Rust has no
//! schnorr verifier — `nockchain-math/src/crypto/cheetah.rs` exposes only limb
//! conversions, and verification is `batch-verify:affine:belt-schnorr` in Hoon.
//! So the final signature check is done by the wallet, driven by
//! `nockmeme/scripts/verify-sighash.sh`, which consumes what this test emits.

use std::path::PathBuf;

use nmeme_tx::spend_sig_hash;
use nockvm::mem::{NockStack, NOCK_STACK_SIZE_TINY};
use nockvm::noun::{IndirectAtom, Noun};
use nockchain_types::tx_engine::v1::tx::{Spend, Transaction};
use noun_serde::NounDecode;

#[derive(Debug, Clone, PartialEq, NounDecode)]
struct WithdrawalTxFixtureEntry {
    case: String,
    transaction: Transaction,
    height: u64,
    min_fee: u64,
    seed_words: u64,
    witness_words: u64,
}

const FIXTURE_REL: &str = "crates/wallet-tx-builder/tests/fixtures/withdrawal_tx_fixtures.jam";

fn fixture_path() -> PathBuf {
    // Built as a member of the Nockchain workspace, this crate sits at
    // <nockchain>/crates/nmeme-tx, so the fixture is two levels up. NOCKCHAIN_REPO
    // overrides that for any other layout.
    if let Ok(repo) = std::env::var("NOCKCHAIN_REPO") {
        return PathBuf::from(repo).join(FIXTURE_REL);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join(FIXTURE_REL)
}

fn load() -> Result<Vec<WithdrawalTxFixtureEntry>, String> {
    let path = fixture_path();
    let bytes = std::fs::read(&path)
        .map_err(|err| format!("read {}: {err}", path.display()))?;
    let mut stack = NockStack::new(NOCK_STACK_SIZE_TINY, 0);
    let atom = unsafe {
        let mut a = IndirectAtom::new_raw_bytes(&mut stack, bytes.len(), bytes.as_ptr());
        a.normalize_as_atom_stack()
    };
    let noun: Noun = nockvm::serialization::cue(&mut stack, atom)
        .map_err(|err| format!("cue: {err:?}"))?;
    let space = stack.noun_space();
    Vec::<WithdrawalTxFixtureEntry>::from_noun(&noun, &space)
        .map_err(|err| format!("decode: {err}"))
}

#[test]
fn report_fixture_sig_hashes() {
    let entries = match load() {
        Ok(entries) => entries,
        Err(err) => {
            // Distinguish "no checkout here" from "the fixture did not decode",
            // which would mean this test is wrong about the fixture's shape.
            panic!("fixture load failed ({err}); set NOCKCHAIN_REPO if the checkout is elsewhere");
        }
    };

    let mut reported = 0usize;
    for entry in &entries {
        let Transaction::V1(tx) = &entry.transaction;
        for (name, spend) in &tx.spends.0 {
            let Spend::Witness(spend1) = spend else {
                println!("INFO\t{}\tlegacy v0 spend (different digest)", entry.case);
                continue;
            };
            println!(
                "INFO\t{}\tv1 spend: {} seed(s), {} signature(s), pinned_source={}",
                entry.case,
                spend1.seeds.0.len(),
                spend1.witness.pkh_signature.0.len(),
                spend1.seeds.0.iter().filter(|s| s.output_source.is_some()).count(),
            );
            let fee = spend1.fee.0 as u64;
            match spend_sig_hash(&spend1.seeds, fee) {
                Ok(digest) => {
                    // Emitted for scripts/verify-sighash.sh to check against the
                    // signature the wallet actually produced.
                    for sig_entry in &spend1.witness.pkh_signature.0 {
                        println!(
                            "SIGHASH\t{}\t{}\t{}\t{}",
                            entry.case,
                            digest.to_base58(),
                            hex_pubkey(&sig_entry.pubkey),
                            name.first.to_base58(),
                        );
                        reported += 1;
                    }
                }
                Err(err) => println!("SKIP\t{}\t{}", entry.case, err),
            }
        }
    }
    println!("reported {reported} sig-hash(es) from {} fixture(s)", entries.len());
}

fn hex_pubkey<T: std::fmt::Debug>(pubkey: &T) -> String {
    // The pubkey type has no stable string form here; Debug is enough to pair a
    // digest with the key the wallet must verify against.
    format!("{pubkey:?}").replace(['\n', '\t'], " ")
}
