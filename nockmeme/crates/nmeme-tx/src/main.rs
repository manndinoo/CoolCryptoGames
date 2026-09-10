//! `nmeme-tx` — attach NMEME token data to a Nockchain transaction and
//! recompute its signing hash.
//!
//! ```text
//! nmeme-tx sighash <tx.jam> [out-dir]
//! nmeme-tx attach  <tx.jam> <lock-root-b58> <claim-spec> <out.jam>
//! nmeme-tx set-sig <tx.jam> <name-b58> <pkh-b58> <pubkey-b58> <sig.jam> <out.jam>
//! ```
//!
//! claim-spec: `transfer:<token-b58>:<amount>` | `genesis:<TICKER>:<decimals>:<amount>`
//!
//! Run `sighash` on an **unmodified** wallet-built transaction first and check
//! the digest against the wallet's own signature. Until that passes, every
//! digest this program prints is unproven.

use std::process::ExitCode;

use nmeme_tx::cli::{parse_claim, witness_with_signature};
use nmeme_tx::sighash::spend_sig_hash;
use nmeme_tx::txfile::{rewrite, ParsedTransaction};
use nmeme_tx::{attach_claim, Error};
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockchain_types::tx_engine::common::{Hash, Name, SchnorrPubkey, SchnorrSignature};
use nockchain_types::tx_engine::v1::tx::{Spend, Spends};
use nockvm::noun::NounAllocator;
use noun_serde::{NounDecode, NounEncode};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("sighash") if args.len() == 3 || args.len() == 4 => cmd_sighash(&args),
        Some("seeds") if args.len() == 3 => cmd_seeds(&args),
        Some("attach") if args.len() == 6 => cmd_attach(&args),
        Some("set-sig") if args.len() == 8 => cmd_set_sig(&args),
        _ => {
            eprintln!("{}", USAGE);
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(code) => code,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::from(2)
        }
    }
}

const USAGE: &str = "usage:
  nmeme-tx sighash <tx.jam> [out-dir]
  nmeme-tx seeds   <tx.jam>
  nmeme-tx attach  <tx.jam> <lock-root-b58> <claim-spec> <out.jam>
  nmeme-tx set-sig <tx.jam> <name-b58> <pkh-b58> <pubkey-b58> <sig.jam> <out.jam>

claim-spec: transfer:<token-b58>:<amount> | genesis:<TICKER>:<decimals>:<amount>";

fn load(path: &str) -> Result<(NounSlab<NockJammer>, Spends, Spends), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let parsed =
        ParsedTransaction::from_noun(noun.in_space(&space)).map_err(|e| format!("decode: {e}"))?;
    let bare = Spends(parsed.spends.0.clone());
    let spliced = parsed.spliced().map_err(|e| format!("splice: {e}"))?;
    Ok((slab, bare, spliced))
}

fn cmd_sighash(args: &[String]) -> Result<ExitCode, String> {
    let out_dir = args
        .get(3)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::Path::new(&args[2])
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .to_path_buf()
        });
    let (_slab, _bare, spends) = load(&args[2])?;

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
            let mut sig_slab: NounSlab<NockJammer> = NounSlab::new();
            let sig_noun = entry.signature.to_noun(&mut sig_slab);
            sig_slab.set_root(sig_noun);
            let path = out_dir.join(format!("sig-{}-{index}.jam", name.first.to_base58()));
            std::fs::write(&path, sig_slab.jam())
                .map_err(|e| format!("write {}: {e}", path.display()))?;
            println!(
                "SIGHASH\t{}\t{}\t{}\t{}\t{}",
                name.first.to_base58(),
                digest.to_base58(),
                pubkey,
                entry.pkh.to_base58(),
                path.display(),
            );
            emitted += 1;
        }
    }
    if emitted == 0 {
        eprintln!(
            "warning: no signatures found; an unsigned transaction cannot \
             validate the digest (see docs/ACCEPTANCE.md)"
        );
        return Ok(ExitCode::from(1));
    }
    Ok(ExitCode::SUCCESS)
}

/// Lists each seed's destination, so a caller can pick a lock-root to attach to.
///
/// Seeds sharing a lock-root are flagged: consensus merges them into one note
/// and unions their note-data, so only one of them may carry the claim.
fn cmd_seeds(args: &[String]) -> Result<ExitCode, String> {
    let (_slab, _bare, spends) = load(&args[2])?;
    let mut seen: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for (name, spend) in &spends.0 {
        let Spend::Witness(spend1) = spend else { continue };
        for seed in &spend1.seeds.0 {
            let root = seed.lock_root.to_base58();
            *seen.entry(root.clone()).or_default() += 1;
            println!(
                "SEED\t{}\t{}\t{}",
                name.first.to_base58(),
                root,
                seed.gift.0,
            );
        }
    }
    for (root, count) in seen {
        if count > 1 {
            println!("MERGED\t{root}\t{count} seeds share this lock-root and become one note");
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn cmd_attach(args: &[String]) -> Result<ExitCode, String> {
    let lock_root =
        Hash::from_base58(&args[3]).map_err(|e| format!("lock-root: {e}"))?;
    let claim = parse_claim(&args[4])?;

    let bytes = std::fs::read(&args[2]).map_err(|e| format!("read {}: {e}", args[2]))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let parsed =
        ParsedTransaction::from_noun(noun.in_space(&space)).map_err(|e| format!("decode: {e}"))?;
    let mut spends = parsed.spliced().map_err(|e| format!("splice: {e}"))?;

    // Exactly one spend may own the target lock-root; ambiguity here would mean
    // guessing which half of a transaction the claim belongs to.
    let mut touched: Option<Name> = None;
    for (name, spend) in spends.0.iter_mut() {
        let Spend::Witness(spend1) = spend else { continue };
        if !spend1.seeds.0.iter().any(|s| s.lock_root == lock_root) {
            continue;
        }
        if touched.is_some() {
            return Err(format!(
                "lock-root {} appears in more than one spend",
                args[3]
            ));
        }
        attach_claim(&mut spend1.seeds, &lock_root, &claim)
            .map_err(|e: Error| format!("attach: {e}"))?;
        touched = Some(name.clone());
    }
    let Some(name) = touched else {
        return Err(format!("no spend pays lock-root {}", args[3]));
    };

    let mut out_slab: NounSlab<NockJammer> = NounSlab::new();
    let jammed = rewrite(noun.in_space(&space), &mut out_slab, &spends, &|_| None)
        .map_err(|e| format!("rewrite: {e}"))?;
    std::fs::write(&args[5], &jammed).map_err(|e| format!("write {}: {e}", args[5]))?;

    // The signature now in the file is stale: it covers the pre-attach digest.
    for (spend_name, spend) in &spends.0 {
        if spend_name != &name {
            continue;
        }
        let Spend::Witness(spend1) = spend else { continue };
        let digest = spend_sig_hash(&spend1.seeds, spend1.fee.0 as u64)
            .map_err(|e| format!("sighash: {e}"))?;
        println!("ATTACHED\t{}\t{}", args[5], name.first.to_base58());
        println!("NEWSIGHASH\t{}\t{}", name.first.to_base58(), digest.to_base58());
    }
    Ok(ExitCode::SUCCESS)
}

fn cmd_set_sig(args: &[String]) -> Result<ExitCode, String> {
    let target = &args[3];
    let pkh = Hash::from_base58(&args[4]).map_err(|e| format!("pkh: {e}"))?;
    let pubkey = SchnorrPubkey::from_base58(&args[5]).map_err(|e| format!("pubkey: {e:?}"))?;

    let sig_bytes = std::fs::read(&args[6]).map_err(|e| format!("read {}: {e}", args[6]))?;
    let mut sig_slab: NounSlab<NockJammer> = NounSlab::new();
    let sig_noun = sig_slab
        .cue_into(sig_bytes.into())
        .map_err(|e| format!("cue signature: {e}"))?;
    let sig_space = sig_slab.noun_space();
    let signature = SchnorrSignature::from_noun(&sig_noun, &sig_space)
        .map_err(|e| format!("decode signature: {e}"))?;

    let bytes = std::fs::read(&args[2]).map_err(|e| format!("read {}: {e}", args[2]))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let parsed =
        ParsedTransaction::from_noun(noun.in_space(&space)).map_err(|e| format!("decode: {e}"))?;
    let spends = parsed.spliced().map_err(|e| format!("splice: {e}"))?;

    let original = spends
        .0
        .iter()
        .find(|(name, _)| &name.first.to_base58() == target)
        .ok_or_else(|| format!("no spend named {target}"))?;
    let Spend::Witness(spend1) = &original.1 else {
        return Err("target spend is legacy v0".to_string());
    };
    let new_witness = witness_with_signature(&spend1.witness, pkh, pubkey, signature);
    let target_name = original.0.clone();

    let mut out_slab: NounSlab<NockJammer> = NounSlab::new();
    let jammed = rewrite(noun.in_space(&space), &mut out_slab, &spends, &|name: &Name| {
        (name == &target_name).then(|| new_witness.clone())
    })
    .map_err(|e| format!("rewrite: {e}"))?;
    std::fs::write(&args[7], &jammed).map_err(|e| format!("write {}: {e}", args[7]))?;
    println!("SIGNED\t{}\t{}", args[7], target);
    Ok(ExitCode::SUCCESS)
}
