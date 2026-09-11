//! `nmeme-tx` — attach NMEME token data to a Nockchain transaction and
//! recompute its signing hash.
//!
//! ```text
//! nmeme-tx sighash <tx.jam> [out-dir]
//! nmeme-tx attach  <tx.jam> <out.jam> <lock-root>=<claim-spec> [<lock-root>=<claim-spec>...]
//! nmeme-tx set-sig <tx.jam> <name-b58> <pkh-b58> <pubkey-b58> <sig.jam> <out.jam>
//! ```
//!
//! claim-spec: `transfer:<token-b58>:<amount>` | `genesis:<TICKER>:<decimals>:<amount>`
//!
//! Run `sighash` on an **unmodified** wallet-built transaction first and check
//! the digest against the wallet's own signature. Until that passes, every
//! digest this program prints is unproven.

use std::process::ExitCode;

use nmeme_core::Claim;
use nmeme_tx::cli::{parse_claim, witness_with_signature};
use nmeme_tx::fee::{enforce_fee, required_fee, FeeParams};
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
        Some("fee") if args.len() >= 3 => cmd_fee(&args),
        Some("attach") if args.len() >= 5 => cmd_attach(&args),
        Some("set-sig") if args.len() == 8 => cmd_set_sig(&args),
        Some("swap") if args.len() >= 5 => cmd_swap(&args),
        Some("pins") if args.len() == 3 => cmd_pins(&args),
        Some("half") if args.len() == 5 => cmd_half(&args),
        Some("replace-spend") if args.len() == 6 => cmd_replace_spend(&args),
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
  nmeme-tx fee     <tx.jam> [--height N] [--mainnet]
  nmeme-tx attach  <tx.jam> <out.jam> <lock-root>=<claim-spec> [more...]
  nmeme-tx set-sig <tx.jam> <name-b58> <pkh-b58> <pubkey-b58> <sig.jam> <out.jam>
  nmeme-tx swap    <a.tx> <b.tx> <out.jam> [--claim <lock-root>=<claim-spec>]... --pin-a <lock-root> --pin-b <lock-root>
  nmeme-tx pins    <tx.jam>                        (does every pinned seed match the seed set at its lock?)
  nmeme-tx half    <tx.jam> <spend-first-b58> <out.jam>
  nmeme-tx replace-spend <base.jam> <donor.jam> <spend-first-b58> <out.jam>

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

/// Attaches one claim per lock-root.
///
/// A transfer needs a claim on **every** output that carries weight, not just
/// the recipient's: SPEC §6 T3 demands exact conservation, so a sender who
/// leaves their own change uncoloured burns the remainder. Passing several
/// `<lock-root>=<claim>` pairs is therefore the normal case, not an advanced
/// one.
fn cmd_attach(args: &[String]) -> Result<ExitCode, String> {
    let tx_path = &args[2];
    let out_path = &args[3];

    let mut wanted: Vec<(Hash, Claim)> = Vec::new();
    for spec in &args[4..] {
        let (lock, claim) = spec
            .split_once('=')
            .ok_or_else(|| format!("expected <lock-root>=<claim-spec>, got {spec:?}"))?;
        let lock = Hash::from_base58(lock).map_err(|e| format!("lock-root {lock}: {e}"))?;
        wanted.push((lock, parse_claim(claim)?));
    }
    if wanted.is_empty() {
        return Err("at least one <lock-root>=<claim-spec> is required".to_string());
    }

    let bytes = std::fs::read(tx_path).map_err(|e| format!("read {tx_path}: {e}"))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let parsed =
        ParsedTransaction::from_noun(noun.in_space(&space)).map_err(|e| format!("decode: {e}"))?;
    let mut spends = parsed.spliced().map_err(|e| format!("splice: {e}"))?;

    let mut touched: Vec<Name> = Vec::new();
    for (lock, claim) in &wanted {
        let mut found = false;
        for (name, spend) in spends.0.iter_mut() {
            let Spend::Witness(spend1) = spend else { continue };
            if !spend1.seeds.0.iter().any(|s| &s.lock_root == lock) {
                continue;
            }
            if found {
                return Err(format!(
                    "lock-root {} appears in more than one spend",
                    lock.to_base58()
                ));
            }
            attach_claim(&mut spend1.seeds, lock, claim)
                .map_err(|e: Error| format!("attach to {}: {e}", lock.to_base58()))?;
            if !touched.contains(name) {
                touched.push(name.clone());
            }
            found = true;
        }
        if !found {
            return Err(format!("no seed pays lock-root {}", lock.to_base58()));
        }
    }

    // The claims added words. Refuse to write a transaction the chain would
    // reject for fee, and say by how much.
    let params = fee_params_from_env();
    let report = enforce_fee(&spends, params).map_err(|e| format!("{e}"))?;
    println!(
        "FEE\tcurrent={}\trequired={}\tseed_words={}\twitness_words={}",
        report.current, report.required, report.seed_words, report.witness_words
    );

    let mut out_slab: NounSlab<NockJammer> = NounSlab::new();
    let jammed = rewrite(noun.in_space(&space), &mut out_slab, &spends, &|_| None)
        .map_err(|e| format!("rewrite: {e}"))?;
    std::fs::write(out_path, &jammed).map_err(|e| format!("write {out_path}: {e}"))?;
    // Reported only once the file exists: a claim that was applied in memory
    // but never written is not attached, and saying so would mislead a caller
    // that reads this output after a partial failure.
    for (lock, claim) in &wanted {
        println!("ATTACHED\t{}\t{}", lock.to_base58(), claim.amount());
    }
    println!("WROTE\t{out_path}");

    // Every touched spend's signature is now stale: it covers the pre-attach
    // digest. Each one needs re-signing.
    for name in &touched {
        let (_, spend) = spends
            .0
            .iter()
            .find(|(n, _)| n == name)
            .ok_or("touched spend vanished")?;
        let Spend::Witness(spend1) = spend else { continue };
        let digest = spend_sig_hash(&spend1.seeds, spend1.fee.0 as u64)
            .map_err(|e| format!("sighash: {e}"))?;
        println!("NEWSIGHASH\t{}\t{}", name.first.to_base58(), digest.to_base58());
    }
    Ok(ExitCode::SUCCESS)
}

/// NMEME_FEE_HEIGHT and NMEME_FEE_NETWORK (fakenet|mainnet) select the fee
/// constants; fakenet at height 1 unless told otherwise.
fn fee_params_from_env() -> FeeParams {
    let height = std::env::var("NMEME_FEE_HEIGHT").ok().and_then(|h| h.parse().ok()).unwrap_or(1);
    match std::env::var("NMEME_FEE_NETWORK").as_deref() {
        Ok("mainnet") => FeeParams::mainnet(height),
        _ => FeeParams::fakenet(height),
    }
}

fn cmd_fee(args: &[String]) -> Result<ExitCode, String> {
    let (_slab, _bare, spends) = load(&args[2])?;
    let mut params = fee_params_from_env();
    if let Some(i) = args.iter().position(|a| a == "--height") {
        params.height = args.get(i + 1).and_then(|h| h.parse().ok()).ok_or("--height needs a number")?;
    }
    if args.iter().any(|a| a == "--mainnet") {
        params = FeeParams::mainnet(params.height);
    }
    let r = required_fee(&spends, params).map_err(|e| format!("{e}"))?;
    println!("FEE\tcurrent={}\trequired={}\tseed_words={}\twitness_words={}", r.current, r.required, r.seed_words, r.witness_words);
    if r.current < r.required {
        println!("SHORTFALL\t{}", r.required - r.current);
        return Ok(ExitCode::from(1));
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

/// The file's root noun is kept alongside its slab so `assemble` can carry
/// the original `name` and `display` fields through.
struct Loaded {
    slab: NounSlab<NockJammer>,
    root: nockvm::noun::Noun,
}

fn load_noun(path: &str) -> Result<(Loaded, Spends), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let root = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let spliced = {
        let space = slab.noun_space();
        let parsed = ParsedTransaction::from_noun(root.in_space(&space)).map_err(|e| format!("decode: {e}"))?;
        parsed.spliced().map_err(|e| format!("splice: {e}"))?
    };
    Ok((Loaded { slab, root }, spliced))
}

fn write_assembled(loaded: &Loaded, spends: &Spends, out_path: &str) -> Result<(), String> {
    let space = loaded.slab.noun_space();
    let mut out_slab: NounSlab<NockJammer> = NounSlab::new();
    let jammed = nmeme_tx::txfile::assemble(loaded.root.in_space(&space), &mut out_slab, spends)
        .map_err(|e| format!("assemble: {e}"))?;
    std::fs::write(out_path, &jammed).map_err(|e| format!("write {out_path}: {e}"))?;
    println!("WROTE\t{out_path}");
    Ok(())
}

fn print_digests(spends: &Spends) -> Result<(), String> {
    for (name, spend) in &spends.0 {
        let Spend::Witness(spend1) = spend else { continue };
        let digest = spend_sig_hash(&spend1.seeds, spend1.fee.0 as u64).map_err(|e| format!("sighash: {e}"))?;
        println!("NEWSIGHASH\t{}\t{}", name.first.to_base58(), digest.to_base58());
    }
    Ok(())
}

fn spend_named<'a>(spends: &'a Spends, first_b58: &str) -> Result<&'a Name, String> {
    spends
        .0
        .iter()
        .map(|(n, _)| n)
        .find(|n| n.first.to_base58() == first_b58)
        .ok_or_else(|| format!("no spend keyed by an input with first-name {first_b58}"))
}

/// `swap <a.tx> <b.tx> <out.jam> [--claim L=spec]... --pin-a L --pin-b L`
///
/// Merges the two wallet-built transactions, attaches the claims (to seeds
/// of either spend), then pins: `--pin-a` pins the output at that lock on
/// a's seed paying it, `--pin-b` on b's. Claims first, pins second: a pin is
/// a digest over the complete seeds, note-data included.
fn cmd_swap(args: &[String]) -> Result<ExitCode, String> {
    let (a_slab, a_spends) = load_noun(&args[2])?;
    let (_b_slab, b_spends) = load_noun(&args[3])?;
    let out_path = &args[4];
    let a_inputs: Vec<Name> = a_spends.0.iter().map(|(n, _)| n.clone()).collect();
    let b_inputs: Vec<Name> = b_spends.0.iter().map(|(n, _)| n.clone()).collect();

    let mut claims: Vec<(Hash, Claim)> = Vec::new();
    let mut pin_a: Vec<Hash> = Vec::new();
    let mut pin_b: Vec<Hash> = Vec::new();
    let mut i = 5;
    while i < args.len() {
        let value = args.get(i + 1).ok_or_else(|| format!("{} needs a value", args[i]))?;
        match args[i].as_str() {
            "--claim" => {
                let (lock, claim) = value.split_once('=').ok_or_else(|| format!("expected <lock-root>=<claim-spec>, got {value:?}"))?;
                claims.push((Hash::from_base58(lock).map_err(|e| format!("lock-root {lock}: {e}"))?, parse_claim(claim)?));
            }
            "--pin-a" => pin_a.push(Hash::from_base58(value).map_err(|e| format!("--pin-a: {e}"))?),
            "--pin-b" => pin_b.push(Hash::from_base58(value).map_err(|e| format!("--pin-b: {e}"))?),
            other => return Err(format!("unknown option {other}")),
        }
        i += 2;
    }
    if pin_a.is_empty() || pin_b.is_empty() {
        return Err("both --pin-a and --pin-b are required: an unpinned party can be robbed".to_string());
    }

    let mut spends = nmeme_tx::swap::merge(a_spends, b_spends).map_err(|e| format!("merge: {e}"))?;
    for (lock, claim) in &claims {
        let mut done = false;
        for (_, spend) in spends.0.iter_mut() {
            let Spend::Witness(spend1) = spend else { continue };
            if !spend1.seeds.0.iter().any(|s| &s.lock_root == lock) {
                continue;
            }
            if done {
                return Err(format!("lock-root {} is paid by more than one spend; a claim goes on exactly one seed", lock.to_base58()));
            }
            attach_claim(&mut spend1.seeds, lock, claim).map_err(|e: Error| format!("attach to {}: {e}", lock.to_base58()))?;
            done = true;
        }
        if !done {
            return Err(format!("no seed pays lock-root {}", lock.to_base58()));
        }
        println!("ATTACHED\t{}\t{}", lock.to_base58(), claim.amount());
    }
    for lock in &pin_a {
        let digest = pin_on(&mut spends, lock, &a_inputs)?;
        println!("PINNED\ta\t{}\t{}", lock.to_base58(), digest.to_base58());
    }
    for lock in &pin_b {
        let digest = pin_on(&mut spends, lock, &b_inputs)?;
        println!("PINNED\tb\t{}\t{}", lock.to_base58(), digest.to_base58());
    }

    let report = enforce_fee(&spends, fee_params_from_env()).map_err(|e| format!("{e}"))?;
    println!(
        "FEE\tcurrent={}\trequired={}\tseed_words={}\twitness_words={}",
        report.current, report.required, report.seed_words, report.witness_words
    );
    write_assembled(&a_slab, &spends, out_path)?;
    print_digests(&spends)?;
    Ok(ExitCode::SUCCESS)
}

/// Pins `lock` on whichever of `owner_inputs`' spends pays it.
fn pin_on(spends: &mut Spends, lock: &Hash, owner_inputs: &[Name]) -> Result<Hash, String> {
    let mut last_err = String::new();
    for input in owner_inputs {
        match nmeme_tx::swap::pin(spends, lock, input) {
            Ok(d) => return Ok(d),
            Err(Error::NoSeedForLockRoot(_)) => continue,
            Err(e) => last_err = format!("{e}"),
        }
    }
    if last_err.is_empty() {
        last_err = format!("none of the owner's spends pays lock-root {}", lock.to_base58());
    }
    Err(format!("pin {}: {last_err}", lock.to_base58()))
}

/// `pins <tx.jam>`: each pinned seed, and whether the seed set actually
/// paying its lock matches — the check consensus makes at validation.
fn cmd_pins(args: &[String]) -> Result<ExitCode, String> {
    let (_slab, spends) = load_noun(&args[2])?;
    let pins = nmeme_tx::swap::check_pins(&spends).map_err(|e| format!("{e}"))?;
    if pins.is_empty() {
        println!("PINS\tnone");
        return Ok(ExitCode::SUCCESS);
    }
    let mut bad = 0usize;
    for (lock, ok) in &pins {
        println!("PIN\t{}\t{}", lock.to_base58(), if *ok { "matches the seed set at this lock" } else { "VIOLATED: the seed set at this lock differs from what was pinned" });
        if !*ok {
            bad += 1;
        }
    }
    if bad > 0 {
        println!("PINS\t{bad} violated");
        return Ok(ExitCode::from(1));
    }
    println!("PINS\tall {} match", pins.len());
    Ok(ExitCode::SUCCESS)
}

/// `half <tx.jam> <spend-first-b58> <out.jam>`: one party's spend alone.
fn cmd_half(args: &[String]) -> Result<ExitCode, String> {
    let (slab, spends) = load_noun(&args[2])?;
    let input = spend_named(&spends, &args[3])?.clone();
    let half = nmeme_tx::swap::only(&spends, &input).map_err(|e| format!("{e}"))?;
    write_assembled(&slab, &half, &args[4])?;
    Ok(ExitCode::SUCCESS)
}

/// `replace-spend <base.jam> <donor.jam> <spend-first-b58> <out.jam>`.
fn cmd_replace_spend(args: &[String]) -> Result<ExitCode, String> {
    let (slab, base) = load_noun(&args[2])?;
    let (_dslab, donor) = load_noun(&args[3])?;
    let input = spend_named(&base, &args[4])?.clone();
    let out = nmeme_tx::swap::replace(base, &donor, &input).map_err(|e| format!("{e}"))?;
    write_assembled(&slab, &out, &args[5])?;
    print_digests(&out)?;
    Ok(ExitCode::SUCCESS)
}
