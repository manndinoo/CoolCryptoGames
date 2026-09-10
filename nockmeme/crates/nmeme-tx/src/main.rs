//! `nmeme-tx` — inspect and verify the signing hash of a wallet-built
//! transaction.
//!
//! Usage:
//!   nmeme-tx sighash <tx.jam>
//!
//! Prints one `SIGHASH` line per signature found:
//!
//!   SIGHASH  <input-name-b58>  <sig-hash-b58>  <pubkey-b58>
//!
//! Feed those to `nockchain-wallet verify-hash` to confirm the digest computed
//! here matches the one the wallet signed. Do that on an **unmodified**
//! transaction before attaching anything: it is the check that separates "my
//! digest is right" from "the node rejected my transaction for some reason".

use std::process::ExitCode;

use nmeme_tx::sighash::spend_sig_hash;
use nmeme_tx::txfile::ParsedTransaction;
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockchain_types::tx_engine::v1::tx::Spend;
use nockvm::noun::NounAllocator;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 || args[1] != "sighash" {
        eprintln!("usage: nmeme-tx sighash <tx.jam>");
        return ExitCode::from(2);
    }

    let bytes = match std::fs::read(&args[2]) {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("error: read {}: {err}", args[2]);
            return ExitCode::from(2);
        }
    };

    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = match slab.cue_into(bytes.into()) {
        Ok(noun) => noun,
        Err(err) => {
            eprintln!("error: cue: {err}");
            return ExitCode::from(2);
        }
    };
    let space = slab.noun_space();

    let parsed = match ParsedTransaction::from_noun(noun.in_space(&space)) {
        Ok(parsed) => parsed,
        Err(err) => {
            eprintln!("error: decode transaction: {err}");
            return ExitCode::from(2);
        }
    };
    let spends = match parsed.spliced() {
        Ok(spends) => spends,
        Err(err) => {
            eprintln!("error: splice witness data: {err}");
            return ExitCode::from(2);
        }
    };

    let mut emitted = 0usize;
    for (name, spend) in &spends.0 {
        let Spend::Witness(spend1) = spend else {
            println!("INFO\t{}\tlegacy v0 spend, different digest", name.first.to_base58());
            continue;
        };
        let digest = match spend_sig_hash(&spend1.seeds, spend1.fee.0 as u64) {
            Ok(digest) => digest,
            Err(err) => {
                println!("INFO\t{}\tskipped: {err}", name.first.to_base58());
                continue;
            }
        };
        println!(
            "INFO\t{}\t{} seed(s), fee {}, {} signature(s)",
            name.first.to_base58(),
            spend1.seeds.0.len(),
            spend1.fee.0,
            spend1.witness.pkh_signature.0.len(),
        );
        for entry in &spend1.witness.pkh_signature.0 {
            println!(
                "SIGHASH\t{}\t{}\t{}",
                name.first.to_base58(),
                digest.to_base58(),
                entry.pkh.to_base58(),
            );
            emitted += 1;
        }
    }

    if emitted == 0 {
        eprintln!(
            "warning: no signatures found. An unsigned transaction cannot \
             validate the digest — see nockmeme/docs/ACCEPTANCE.md."
        );
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}
