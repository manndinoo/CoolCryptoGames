//! `nmeme-tx` — inspect and verify the signing hash of a wallet-built
//! transaction.
//!
//! Usage:
//!   nmeme-tx sighash <tx.jam> [out-dir]
//!
//! Prints one `SIGHASH` line per signature found:
//!
//!   SIGHASH  <input-name-b58>  <sig-hash-b58>  <pubkey-b58>  <signature.jam>
//!
//! `verify-hash` takes a *jammed signature file*, not a base58 signature, so
//! each signature is written to `<out-dir>` (default: alongside the tx) and the
//! path is printed. Then:
//!
//!   nockchain-wallet --client private --private-grpc-server-port <port> \
//!     verify-hash <sig-hash-b58> <signature.jam> <pubkey-b58>
//!
//! Do this on an **unmodified** transaction before attaching anything: it is
//! the check that separates "my digest is right" from "the node rejected my
//! transaction for some reason". Note that the wallet's default endpoint is a
//! public node, so always pin it to the local one.

use std::process::ExitCode;

use nmeme_tx::sighash::spend_sig_hash;
use nmeme_tx::txfile::ParsedTransaction;
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockchain_types::tx_engine::v1::tx::Spend;
use nockvm::noun::NounAllocator;
use noun_serde::NounEncode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 || args.len() > 4 || args[1] != "sighash" {
        eprintln!("usage: nmeme-tx sighash <tx.jam> [out-dir]");
        return ExitCode::from(2);
    }
    let out_dir = if args.len() == 4 {
        std::path::PathBuf::from(&args[3])
    } else {
        std::path::Path::new(&args[2])
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .to_path_buf()
    };

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
        for (index, entry) in spend1.witness.pkh_signature.0.iter().enumerate() {
            let pubkey = match entry.pubkey.to_base58() {
                Ok(pubkey) => pubkey,
                Err(err) => {
                    println!("INFO\tpubkey encode failed: {err:?}");
                    continue;
                }
            };
            // verify-hash consumes a jammed signature file, so write one out.
            let mut sig_slab: NounSlab<NockJammer> = NounSlab::new();
            let sig_noun = entry.signature.to_noun(&mut sig_slab);
            sig_slab.set_root(sig_noun);
            let path = out_dir.join(format!("sig-{}-{index}.jam", name.first.to_base58()));
            if let Err(err) = std::fs::write(&path, sig_slab.jam()) {
                println!("INFO\twrite {}: {err}", path.display());
                continue;
            }
            println!(
                "SIGHASH\t{}\t{}\t{}\t{}",
                name.first.to_base58(),
                digest.to_base58(),
                pubkey,
                path.display(),
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
