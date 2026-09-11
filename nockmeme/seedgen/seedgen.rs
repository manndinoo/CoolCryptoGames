//! Verifier-setup seed generation, one bucket at a time.
//!
//! The node generates its verifier-setup seed cache by proving all fourteen
//! production buckets in one process (`build_and_cache_verifier_setup_seeds`),
//! which needs more memory than the machines available to this project. Every
//! bucket is an independent proof, so this binary proves ONE bucket per process
//! and a final step concatenates the per-bucket seed files in bucket order and
//! checks the result against the consensus table digest.
//!
//! Built as an extra bin target of `ai-pow-jets` (copied to
//! `crates/ai-pow-jets/src/bin/seedgen.rs` in the pinned Nockchain checkout), so
//! it links the very code the node uses. Nothing here touches consensus: the
//! output is byte-for-byte what the node's own generator writes, and the node
//! validates it against `AI_POW_V0_VERIFIER_SETUP_TABLE_DIGEST` on load.
//!
//!   seedgen count
//!   seedgen list
//!   seedgen prove <bucket-index> <out.bin>
//!   seedgen merge <out.bin> <seed-0.bin> <seed-1.bin> ... (in bucket order)
//!   seedgen check <cache.bin>
//!   seedgen contexts <data-dir>   (what a node does at boot: load the cache from
//!                                 <data-dir>/ai-pow/, digest-check it, build every
//!                                 bucket's on-disk context; prints their sizes)

use std::path::Path;

use ai_pow_jets::setup::{
    build_verifier_setup_seed, build_verifier_setup_seed_dense, install_or_build_verifier_setup,
    load_verifier_setup_seeds, production_verifier_setup_buckets, save_verifier_setup_seeds,
    verifier_setup_seed_cache_path,
};
use ai_pow_jets::table_digest::verify_verifier_setup_seed_table_digest;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn peak_rss_gib() -> f64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("VmHWM:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|kb| kb.parse::<f64>().ok())
        })
        .map(|kb| kb / 1048576.0)
        .unwrap_or(0.0)
}

fn usage() -> ! {
    eprintln!(
        "usage:\n  seedgen count\n  seedgen list\n  seedgen prove <bucket-index> <out.bin>\n  \
         seedgen merge <out.bin> <seed-0.bin> <seed-1.bin> ...\n  seedgen check <cache.bin>"
    );
    std::process::exit(2)
}

fn run(args: &[String]) -> Result<(), String> {
    let buckets = production_verifier_setup_buckets();
    match args.first().map(String::as_str) {
        Some("count") => {
            println!("{}", buckets.len());
            Ok(())
        }
        Some("list") => {
            for (i, b) in buckets.iter().enumerate() {
                let p = &b.params;
                println!(
                    "{i}\tdense={}\tm={} k={} n={} r={} tile={}\thw={} e={} top_k={}",
                    b.dense, p.m, p.k, p.n, p.noise_rank, p.tile, b.hw, b.e, b.top_k
                );
            }
            Ok(())
        }
        Some("prove") => {
            let i: usize = args
                .get(1)
                .and_then(|s| s.parse().ok())
                .ok_or("prove: bucket index required")?;
            let out = args.get(2).ok_or("prove: output path required")?;
            let b = buckets
                .get(i)
                .ok_or_else(|| format!("bucket {i} out of range (0..{})", buckets.len()))?;
            let started = std::time::Instant::now();
            eprintln!("[seedgen] proving bucket {i}/{} (dense={})", buckets.len(), b.dense);
            let seed = if b.dense {
                build_verifier_setup_seed_dense(&b.params)
            } else {
                build_verifier_setup_seed(&b.params, b.hw, b.e, b.top_k)
            }
            .map_err(|e| format!("prove bucket {i}: {e}"))?;
            let digest = hex(&seed.verifier_key_digest_bytes);
            let height = seed.trace_height();
            save_verifier_setup_seeds(Path::new(out), &[seed])
                .map_err(|e| format!("save bucket {i}: {e}"))?;
            println!(
                "bucket {i}\ttrace_height={height}\tverifier_key_digest={digest}\tsecs={:.0}\tpeak_rss_gib={:.2}",
                started.elapsed().as_secs_f64(),
                peak_rss_gib()
            );
            Ok(())
        }
        Some("merge") => {
            let out = args.get(1).ok_or("merge: output path required")?;
            let inputs = &args[2..];
            if inputs.len() != buckets.len() {
                return Err(format!(
                    "merge: expected {} seed files in bucket order, got {}",
                    buckets.len(),
                    inputs.len()
                ));
            }
            let mut seeds = Vec::with_capacity(buckets.len());
            for (i, p) in inputs.iter().enumerate() {
                let mut s = load_verifier_setup_seeds(Path::new(p))
                    .map_err(|e| format!("load {p}: {e}"))?;
                if s.len() != 1 {
                    return Err(format!("{p}: expected exactly one seed, found {}", s.len()));
                }
                let seed = s.remove(0);
                println!(
                    "bucket {i}\ttrace_height={}\tverifier_key_digest={}",
                    seed.trace_height(),
                    hex(&seed.verifier_key_digest_bytes)
                );
                seeds.push(seed);
            }
            let digest = verify_verifier_setup_seed_table_digest(&seeds)
                .map_err(|e| format!("consensus table digest check FAILED: {e}"))?;
            save_verifier_setup_seeds(Path::new(out), &seeds)
                .map_err(|e| format!("save {out}: {e}"))?;
            println!("table digest {} matches AI_POW_V0_VERIFIER_SETUP_TABLE_DIGEST; wrote {out}", hex(&digest));
            Ok(())
        }
        Some("check") => {
            let p = args.get(1).ok_or("check: cache path required")?;
            let seeds =
                load_verifier_setup_seeds(Path::new(p)).map_err(|e| format!("load {p}: {e}"))?;
            let digest = verify_verifier_setup_seed_table_digest(&seeds)
                .map_err(|e| format!("consensus table digest check FAILED: {e}"))?;
            println!(
                "{p}: {} seeds, table digest {} matches AI_POW_V0_VERIFIER_SETUP_TABLE_DIGEST",
                seeds.len(),
                hex(&digest)
            );
            Ok(())
        }
        Some("contexts") => {
            let dir = Path::new(args.get(1).ok_or("contexts: data dir required")?);
            let cache = verifier_setup_seed_cache_path(dir);
            if !cache.exists() {
                return Err(format!("no seed cache at {}", cache.display()));
            }
            let started = std::time::Instant::now();
            // Empty bucket list: the cache MUST load and digest-check, never regenerate.
            let n = install_or_build_verifier_setup(dir, &[])
                .map_err(|e| format!("boot-path install from cache FAILED: {e}"))?;
            let ai_pow = dir.join("ai-pow");
            let mut total = 0u64;
            let mut entries: Vec<_> = std::fs::read_dir(&ai_pow)
                .map_err(|e| format!("read {}: {e}", ai_pow.display()))?
                .flatten()
                .collect();
            entries.sort_by_key(|e| e.file_name());
            for e in entries {
                let len = e.metadata().map(|m| m.len()).unwrap_or(0);
                total += len;
                println!("{:>12}  {}", len, e.file_name().to_string_lossy());
            }
            println!(
                "installed {n} buckets from cache in {:.0}s; on-disk total {:.2} GiB; peak_rss_gib={:.2}",
                started.elapsed().as_secs_f64(),
                total as f64 / 1073741824.0,
                peak_rss_gib()
            );
            Ok(())
        }
        _ => usage(),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(e) = run(&args) {
        eprintln!("[seedgen] error: {e}");
        std::process::exit(1);
    }
}
