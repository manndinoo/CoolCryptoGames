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

use nmeme_core::pool::{PoolParams, Side};
use nmeme_core::{Claim, TokenId};
use nmeme_tx::pool::PoolNote;
use nockchain_types::tx_engine::v1::note::NoteData;
use nockchain_types::tx_engine::v1::tx::Seed;
use nmeme_tx::cli::{parse_claim, witness_with_signature};
use nmeme_tx::fee::{enforce_fee, required_fee, FeeParams};
use nmeme_tx::sighash::spend_sig_hash;
use nmeme_tx::txfile::{rewrite, ParsedTransaction};
use nmeme_tx::{attach_claim, Error};
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockchain_types::tx_engine::common::{Hash, Name, SchnorrPubkey, SchnorrSignature};
use nockchain_types::tx_engine::v1::tx::{Lock, LockPrimitive, Pkh, Spend, SpendCondition, Spends};
use nockvm::noun::NounAllocator;
use noun_serde::{NounDecode, NounEncode};

/// `retarget <tx.jam> <out.jam> <from-root> <to-root>`: every seed paying
/// `from` pays `to` instead. This is how a wallet-built payment to a
/// placeholder address becomes a payment to a lock the wallet cannot name,
/// such as a pool's covenant lock. The digest changes; re-sign after.
fn cmd_retarget(args: &[String]) -> Result<ExitCode, String> {
    let (slab, mut spends) = load_noun(&args[2])?;
    let from = Hash::from_base58(&args[4]).map_err(|e| format!("from: {e}"))?;
    let to = Hash::from_base58(&args[5]).map_err(|e| format!("to: {e}"))?;
    let moved = nmeme_tx::pool::retarget(&mut spends, &from, &to);
    if moved == 0 {
        return Err(format!("no seed pays lock-root {}", from.to_base58()));
    }
    println!("RETARGETED\t{moved}\t{}\t{}", from.to_base58(), to.to_base58());
    write_assembled(&slab, &spends, &args[3])?;
    print_digests(&spends)?;
    Ok(ExitCode::SUCCESS)
}

fn pool_params(args: &[String]) -> Result<PoolParams, String> {
    let token = opt(args, "--token").ok_or("missing --token")?;
    let fee = opt(args, "--fee-bps").ok_or("missing --fee-bps")?;
    let lore = opt(args, "--lore-bps").ok_or("missing --lore-bps")?;
    let lore_lock = opt(args, "--lore-lock").ok_or("missing --lore-lock")?;
    PoolParams::new(
        TokenId(Hash::from_base58(token).map_err(|e| format!("token: {e}"))?),
        fee.parse::<u64>().map_err(|e| format!("fee-bps: {e}"))?,
        lore.parse::<u64>().map_err(|e| format!("lore-bps: {e}"))?,
        Hash::from_base58(lore_lock).map_err(|e| format!("lore-lock: {e}"))?,
    )
    .map_err(|e| e.to_string())
}

/// `pool-lock --token <b58> --fee-bps N`: the canonical pool lock.
fn cmd_pool_lock(args: &[String]) -> Result<ExitCode, String> {
    let params = pool_params(args)?;
    let root = params.lock_root().map_err(|e| format!("{e:?}"))?;
    println!("POOL-LOCK\t{}", root.to_base58());
    println!("POOL-FIRST\t{}", nmeme_tx::names::first_name(&root).to_base58());
    println!("LORE-FIRST\t{}", params.lore_first_name().to_base58());
    Ok(ExitCode::SUCCESS)
}

/// `quote --pool "<POOL line>" <pool params> --side buy --nicks-in N [--dust D] [--network-fee F]`
/// `quote --pool "<POOL line>" <pool params> --side sell --tokens-in N [--dust D] [--network-fee F]`:
/// the quote alone, the same function `pool-trade` applies when it builds,
/// so a backend can set a slippage floor before it reserves and builds and
/// re-check it against the pool as it stands when its turn comes.
fn cmd_quote(args: &[String]) -> Result<ExitCode, String> {
    let params = pool_params(args)?;
    let pool = PoolNote::parse(opt(args, "--pool").ok_or("missing --pool")?)?;
    let dust = parse_u64(args, "--dust")?.unwrap_or(1000);
    let network_fee = parse_u64(args, "--network-fee")?.unwrap_or(0);
    let (side, quote) = match opt(args, "--side") {
        Some("buy") => {
            let paid = parse_u64(args, "--nicks-in")?.ok_or("a buy needs --nicks-in")?;
            ("buy", nmeme_core::pool::quote_buy(pool.reserves, paid, dust, &params, network_fee))
        }
        Some("sell") => {
            let tokens_in = parse_u64(args, "--tokens-in")?.ok_or("a sell needs --tokens-in")?;
            ("sell", nmeme_core::pool::quote_sell(pool.reserves, tokens_in, dust, &params, network_fee))
        }
        other => return Err(format!("--side must be buy or sell, got {other:?}")),
    };
    let quote = quote.map_err(|e| format!("quote: {e}"))?;
    let (pool_unit, in_unit, out_unit) = if side == "buy" { ("nicks", "nicks", "tokens") } else { ("tokens", "tokens", "nicks") };
    println!(
        "QUOTE\t{side}\tin={} {in_unit}\tout_net={} {out_unit}\tpool_fee={} {pool_unit}\tlore_fee={} nicks\tnock_fees={} nicks\ttoken_fees={} tokens\tnetwork_fee={} nicks\tspot_e9={}\texec_e9={}\timpact_bps={}",
        quote.amount_in, quote.amount_out, quote.pool_fee, quote.lore_fee, quote.nock_fees(), quote.token_fees(), quote.network_fee,
        quote.spot_before_e9, quote.execution_e9, quote.price_impact_bps
    );
    println!("POOL-BEFORE\t{}\t{}", pool.reserves.nock, pool.reserves.tokens);
    println!("POOL-AFTER\t{}\t{}", quote.after.nock, quote.after.tokens);
    Ok(ExitCode::SUCCESS)
}

/// `key-lock <address-b58>`: the lock root of the 1-of-1 key lock the wallet
/// pays an address with (its `p2pkh` recipient), and the first name every
/// note at that lock carries. This is what a wallet's "address" resolves to
/// on the chain, so a backend can read a wallet's notes without first
/// building a throwaway transaction to learn its lock root.
fn cmd_key_lock(args: &[String]) -> Result<ExitCode, String> {
    let pkh = Hash::from_base58(&args[2]).map_err(|e| format!("address: {e}"))?;
    let spend_condition = SpendCondition::new(vec![LockPrimitive::Pkh(Pkh::new(1, [pkh]))]);
    let root = Lock::SpendCondition(spend_condition).hash().map_err(|e| format!("{e:?}"))?;
    println!("KEY-LOCK\t{}", root.to_base58());
    println!("KEY-FIRST\t{}", nmeme_tx::names::first_name(&root).to_base58());
    Ok(ExitCode::SUCCESS)
}

/// `note-hash "<first> <last> <origin> <nock> <tokens>" --token <b58> --fee-bps N`:
/// `hash:nnote-1` of a pool note, the parent-hash its spend must carry.
fn cmd_note_hash(args: &[String]) -> Result<ExitCode, String> {
    let params = pool_params(args)?;
    let note = PoolNote::parse(&args[2])?;
    println!("NOTEHASH\t{}", note.hash(&params).map_err(|e| e.to_string())?.to_base58());
    Ok(ExitCode::SUCCESS)
}

fn opt<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

fn opts<'a>(args: &'a [String], name: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    for (i, a) in args.iter().enumerate() {
        if a == name {
            if let Some(v) = args.get(i + 1) {
                out.push(v.as_str());
            }
        }
    }
    out
}

fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
}

fn parse_u64(args: &[String], name: &str) -> Result<Option<u64>, String> {
    opt(args, name)
        .map(|v| v.parse::<u64>().map_err(|e| format!("{name}: {e}")))
        .transpose()
}

/// `pool-trade <user.tx> <out.jam> --pool "<first> <last> <origin> <nock> <tokens>"
///             --token <b58> --fee-bps N --side buy|sell --placeholder <lock-root>
///             [--tokens-in N] [--claim <lock-root>=<claim-spec>]... [--dust N]
///             [attack: --payout N | --withdraw N | --pool-fee N | --extra-seed <root>:<gift>
///                      | --drop-claim | --successor-tokens N | --inflate-claim N
///                      | --witness-pkh <b58> | --also-spend "<note>" [--also-take]]`
///
/// The user's wallet-built transaction pays the placeholder; that seed is
/// retargeted to the pool lock. The pool note's keyless spend is built from
/// the quote: for a buy, the bought tokens (with `dust` nicks) go to the
/// user's lock and the rest stays; for a sell, the quoted nicks go to the
/// user and the successor carries the tokens received. The user's own spend
/// pins the user's lock, so the user gets exactly the quoted fill or nothing.
/// The attack options build a transaction that the covenant must refuse.
fn cmd_pool_trade(args: &[String]) -> Result<ExitCode, String> {
    let (slab, mut spends) = load_noun(&args[2])?;
    let out_path = &args[3];
    let params = pool_params(args)?;
    let pool_root = params.lock_root().map_err(|e| format!("{e:?}"))?;
    let pool = PoolNote::parse(opt(args, "--pool").ok_or("missing --pool")?)?;
    let placeholder = Hash::from_base58(opt(args, "--placeholder").ok_or("missing --placeholder")?)
        .map_err(|e| format!("placeholder: {e}"))?;
    let side = match opt(args, "--side") {
        Some("buy") => Side::Buy,
        Some("sell") => Side::Sell,
        other => return Err(format!("--side must be buy or sell, got {other:?}")),
    };
    let dust = parse_u64(args, "--dust")?.unwrap_or(1000);
    let tokens_in = parse_u64(args, "--tokens-in")?.unwrap_or(0);
    // `--held N` (buy): the user's spend consumes token notes of this token
    // holding N units (their NOCK funds the buy); the bought output's claim
    // carries N + the quote's output, one claim at the user's lock. A change
    // claim on the user's own change seed would be a second claim at that
    // lock, and consensus keeps one (the other's tokens burn).
    let held = parse_u64(args, "--held")?.unwrap_or(0);
    if held > 0 && side != Side::Buy {
        return Err("--held applies to a buy (a sell carries its change with --claim)".to_string());
    }
    let user_inputs: Vec<Name> = spends.0.iter().map(|(n, _)| n.clone()).collect();

    let moved = nmeme_tx::pool::retarget(&mut spends, &placeholder, &pool_root);
    if moved != 1 {
        return Err(format!("expected exactly one seed paying the placeholder, found {moved}"));
    }
    for spec in opts(args, "--claim") {
        let (lock, claim) = spec.split_once('=').ok_or_else(|| format!("expected <lock-root>=<claim-spec>, got {spec:?}"))?;
        let lock = Hash::from_base58(lock).map_err(|e| format!("lock-root {lock}: {e}"))?;
        let claim = parse_claim(claim)?;
        let mut done = false;
        for (_, spend) in spends.0.iter_mut() {
            let Spend::Witness(spend1) = spend else { continue };
            if spend1.seeds.0.iter().any(|s| s.lock_root == lock) {
                attach_claim(&mut spend1.seeds, &lock, &claim).map_err(|e: Error| format!("attach: {e}"))?;
                done = true;
                break;
            }
        }
        if !done {
            return Err(format!("no seed of the user's transaction pays lock-root {}", lock.to_base58()));
        }
        println!("ATTACHED\t{}\t{}", lock.to_base58(), claim.amount());
    }

    // The user's lock: the one lock the user's seeds pay besides the pool.
    let mut user_locks: Vec<Hash> = Vec::new();
    let mut paid: u64 = 0;
    for (_, spend) in &spends.0 {
        let Spend::Witness(spend1) = spend else { continue };
        for s in &spend1.seeds.0 {
            if s.lock_root == pool_root {
                paid += s.gift.0 as u64;
            } else if !user_locks.contains(&s.lock_root) {
                user_locks.push(s.lock_root.clone());
            }
        }
    }
    let user_lock = match opt(args, "--user-lock") {
        Some(l) => Hash::from_base58(l).map_err(|e| format!("user-lock: {e}"))?,
        None => {
            if user_locks.len() != 1 {
                return Err(format!("the user's seeds pay {} locks besides the pool; pass --user-lock", user_locks.len()));
            }
            user_locks[0].clone()
        }
    };

    let fee_bps = params.fee_bps;
    // the miner fee the user's own spend pays: disclosed, not part of the trading fee
    let network_fee: u64 = spends
        .0
        .iter()
        .map(|(_, sp)| match sp { Spend::Witness(s1) => s1.fee.0 as u64, _ => 0 })
        .sum();
    let quote = match side {
        Side::Buy => nmeme_core::pool::quote_buy(pool.reserves, paid, dust, &params, network_fee),
        Side::Sell => {
            if tokens_in == 0 {
                return Err("a sell needs --tokens-in".to_string());
            }
            nmeme_core::pool::quote_sell(pool.reserves, tokens_in, paid, &params, network_fee)
        }
    }
    .map_err(|e| format!("quote: {e}"))?;
    // Every fee with its denomination: the pool's share is retained in the
    // unit that came in (nicks on a buy, tokens on a sell); the treasury's
    // is always nicks; the network fee is nicks the trader's own spend pays
    // the miner, outside the trading fee.
    let (pool_unit, in_unit, out_unit) = match side {
        Side::Buy => ("nicks", "nicks", "tokens"),
        Side::Sell => ("tokens", "tokens", "nicks"),
    };
    println!(
        "QUOTE\t{}\tin={} {in_unit}\tout_net={} {out_unit}\tpool_fee={} {pool_unit}\tlore_fee={} nicks\tnock_fees={} nicks\ttoken_fees={} tokens\tnetwork_fee={} nicks\tspot_e9={}\texec_e9={}\timpact_bps={}",
        match side { Side::Buy => "buy", Side::Sell => "sell" },
        quote.amount_in, quote.amount_out, quote.pool_fee, quote.lore_fee, quote.nock_fees(), quote.token_fees(), quote.network_fee,
        quote.spot_before_e9, quote.execution_e9, quote.price_impact_bps
    );
    println!("POOL-BEFORE\t{}\t{}", pool.reserves.nock, pool.reserves.tokens);
    println!("POOL-AFTER\t{}\t{}", quote.after.nock, quote.after.tokens);
    if held > 0 {
        println!("HELD\t{held}\tuser-claim={}", quote.amount_out + held);
    }

    let parent = pool.hash(&params).map_err(|e| e.to_string())?;
    // the pool's spend pays: the user, the treasury, and its own successor;
    // the user's payment (paid) lands on the successor from the user's spend
    let mut lore_gift = quote.lore_fee;
    let (mut to_user_gift, mut to_user_tokens, mut succ_gift, mut succ_tokens) = match side {
        Side::Buy => (dust, quote.amount_out + held, pool.reserves.nock - dust - lore_gift, pool.reserves.tokens - quote.amount_out),
        Side::Sell => (quote.amount_out, 0u64, pool.reserves.nock - quote.amount_out - lore_gift, pool.reserves.tokens + tokens_in),
    };
    // A second note at the pool lock, spent in the same transaction.
    let also = opt(args, "--also-spend").map(PoolNote::parse).transpose()?;
    let also_take = has(args, "--also-take");
    let mut extra_spends: Vec<(Name, Spend)> = Vec::new();
    if let Some(other) = &also {
        let ph = other.hash(&params).map_err(|e| e.to_string())?;
        let w = nmeme_tx::pool::covenant_witness(&params).map_err(|e| e.to_string())?;
        if also_take {
            // the attacker keeps the other note's NOCK and folds its tokens
            // into what the user receives
            to_user_tokens += other.reserves.tokens;
            let s = nmeme_tx::pool::seed(user_lock.clone(), other.reserves.nock, NoteData::new(vec![]), ph);
            extra_spends.push(nmeme_tx::pool::pool_spend(other, w, vec![s], 0));
            println!("ALSO-SPEND\ttake\t{}\t{}", other.reserves.nock, other.reserves.tokens);
        } else {
            succ_tokens += other.reserves.tokens;
            let s = nmeme_tx::pool::seed(pool_root.clone(), other.reserves.nock, NoteData::new(vec![]), ph);
            extra_spends.push(nmeme_tx::pool::pool_spend(other, w, vec![s], 0));
            println!("ALSO-SPEND\tmerge\t{}\t{}", other.reserves.nock, other.reserves.tokens);
        }
    }
    // Attack overrides.
    if let Some(p) = parse_u64(args, "--payout")? {
        match side {
            Side::Buy => {
                to_user_tokens = p;
                succ_tokens = pool.reserves.tokens.checked_sub(p).ok_or("payout exceeds the token reserve")?;
            }
            Side::Sell => {
                to_user_gift = p;
                succ_gift = pool.reserves.nock.checked_sub(p).ok_or("payout exceeds the NOCK reserve")?;
            }
        }
        println!("ATTACK\tpayout\t{p}");
    }
    if let Some(w) = parse_u64(args, "--withdraw")? {
        to_user_gift += w;
        succ_gift = succ_gift.checked_sub(w).ok_or("withdraw exceeds the reserve")?;
        println!("ATTACK\twithdraw\t{w}");
    }
    let pool_fee = parse_u64(args, "--pool-fee")?.unwrap_or(0);
    if pool_fee > 0 {
        succ_gift = succ_gift.checked_sub(pool_fee).ok_or("pool fee exceeds the reserve")?;
        println!("ATTACK\tpool-fee\t{pool_fee}");
    }
    let mut seeds: Vec<Seed> = Vec::new();
    for spec in opts(args, "--extra-seed") {
        let (root, gift) = spec.split_once(':').ok_or("expected <lock-root>:<gift>")?;
        let root = Hash::from_base58(root).map_err(|e| format!("extra-seed: {e}"))?;
        let gift: u64 = gift.parse().map_err(|e| format!("extra-seed gift: {e}"))?;
        succ_gift = succ_gift.checked_sub(gift).ok_or("extra seed exceeds the reserve")?;
        seeds.push(nmeme_tx::pool::seed(root.clone(), gift, NoteData::new(vec![]), parent.clone()));
        println!("ATTACK\textra-seed\t{}\t{gift}", root.to_base58());
    }
    if let Some(t) = parse_u64(args, "--successor-tokens")? {
        succ_tokens = t;
        println!("ATTACK\tsuccessor-tokens\t{t}");
    }
    let mut lore_tokens: u64 = 0;
    if let Some(n) = parse_u64(args, "--lore-short")? {
        // the treasury is paid less than its share; the difference stays in the successor
        let cut = n.min(lore_gift);
        lore_gift -= cut;
        succ_gift += cut;
        println!("ATTACK\tlore-short\t{cut}");
    }
    if let Some(n) = parse_u64(args, "--lore-tokens")? {
        // tokens sent to the treasury, taken from the successor's claim
        lore_tokens = n;
        succ_tokens = succ_tokens.checked_sub(n).ok_or("lore-tokens exceeds the successor's claim")?;
        println!("ATTACK\tlore-tokens\t{n}");
    }
    let succ_data = if has(args, "--drop-claim") {
        println!("ATTACK\tdrop-claim");
        NoteData::new(vec![])
    } else {
        nmeme_tx::pool::claim_data(&params, succ_tokens).map_err(|e| e.to_string())?
    };
    let user_data = if to_user_tokens > 0 {
        nmeme_tx::pool::claim_data(&params, to_user_tokens).map_err(|e| e.to_string())?
    } else {
        NoteData::new(vec![])
    };
    seeds.push(nmeme_tx::pool::seed(user_lock.clone(), to_user_gift, user_data, parent.clone()));
    seeds.push(nmeme_tx::pool::seed(pool_root.clone(), succ_gift, succ_data, parent.clone()));
    if lore_gift > 0 || lore_tokens > 0 {
        let lore_data = if lore_tokens > 0 {
            nmeme_tx::pool::claim_data(&params, lore_tokens).map_err(|e| e.to_string())?
        } else {
            NoteData::new(vec![])
        };
        seeds.push(nmeme_tx::pool::seed(params.lore_lock.clone(), lore_gift, lore_data, parent.clone()));
    }
    if let Some(n) = parse_u64(args, "--inflate-claim")? {
        // a fabricated claim on the user's own seed to the pool
        let claim = Claim::Transfer { token: params.token.clone(), amount: n };
        for (_, spend) in spends.0.iter_mut() {
            let Spend::Witness(spend1) = spend else { continue };
            if spend1.seeds.0.iter().any(|s| s.lock_root == pool_root) {
                attach_claim(&mut spend1.seeds, &pool_root, &claim).map_err(|e: Error| format!("inflate: {e}"))?;
            }
        }
        println!("ATTACK\tinflate-claim\t{n}");
    }
    let witness = match opt(args, "--witness-pkh") {
        Some(pkh) => {
            println!("ATTACK\twitness-pkh\t{pkh}");
            nmeme_tx::pool::key_witness(Hash::from_base58(pkh).map_err(|e| format!("witness-pkh: {e}"))?)
        }
        None => nmeme_tx::pool::covenant_witness(&params),
    }
    .map_err(|e| e.to_string())?;
    println!("POOL-SPEND\tto_user={to_user_gift}+{to_user_tokens}t\tsuccessor={succ_gift}+{succ_tokens}t\tlore={lore_gift}+{lore_tokens}t\tfee={pool_fee}");

    let (name, spend) = nmeme_tx::pool::pool_spend(&pool, witness, seeds, pool_fee);
    let mut all = nmeme_tx::swap::merge(spends, Spends(vec![(name, spend)])).map_err(|e| format!("merge: {e}"))?;
    for extra in extra_spends {
        all = nmeme_tx::swap::merge(all, Spends(vec![extra])).map_err(|e| format!("merge: {e}"))?;
    }
    let digest = pin_on(&mut all, &user_lock, &user_inputs)?;
    println!("PINNED\tuser\t{}\t{}", user_lock.to_base58(), digest.to_base58());
    let report = enforce_fee(&all, fee_params_from_env()).map_err(|e| format!("{e}"))?;
    println!(
        "FEE\tcurrent={}\trequired={}\tseed_words={}\twitness_words={}",
        report.current, report.required, report.seed_words, report.witness_words
    );
    write_assembled(&slab, &all, out_path)?;
    print_digests(&all)?;
    Ok(ExitCode::SUCCESS)
}

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
        Some("retarget") if args.len() == 6 => cmd_retarget(&args),
        Some("pool-lock") if args.len() >= 10 => cmd_pool_lock(&args),
        Some("quote") if args.len() >= 12 => cmd_quote(&args),
        Some("key-lock") if args.len() == 3 => cmd_key_lock(&args),
        Some("note-hash") if args.len() >= 11 => cmd_note_hash(&args),
        Some("pool-trade") if args.len() >= 16 => cmd_pool_trade(&args),
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
  nmeme-tx retarget <tx.jam> <out.jam> <from-lock-root> <to-lock-root>
  nmeme-tx pool-lock --token <token-b58> --fee-bps <n> --lore-bps <n> --lore-lock <lock-root>
  nmeme-tx key-lock <address-b58>            (KEY-LOCK <lock-root> and KEY-FIRST: the wallet's 1-of-1 key lock)
  nmeme-tx quote --pool \"<POOL line>\" <pool params> --side buy --nicks-in <n> | --side sell --tokens-in <n> [--dust <d>] [--network-fee <f>]
                                             (the QUOTE line alone, the function pool-trade applies)
  pool-trade ... [--held <units>]            (buy: token notes of this token the user spends fund it; their units join the bought claim)
  nmeme-tx note-hash \"<first> <last> <origin> <nock> <tokens>\" <pool params>
  nmeme-tx pool-trade <user.tx> <out.jam> --pool \"<first> <last> <origin> <nock> <tokens>\" <pool params>
                      --side buy|sell --placeholder <lock-root> [--tokens-in <n>] [--claim <lock-root>=<claim-spec>]... [--dust <n>]
                      [--payout n | --withdraw n | --pool-fee n | --extra-seed <root>:<gift> | --drop-claim | --successor-tokens n
                       | --inflate-claim n | --witness-pkh <b58> | --also-spend \"<note>\" [--also-take]
                       | --lore-short n | --lore-tokens n]
  pool params: --token <token-b58> --fee-bps <n> --lore-bps <n> --lore-lock <lock-root>

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
            println!("INFO\t{}\tlegacy v0 spend, different digest", spend_key(name));
            continue;
        };
        let digest = match spend_sig_hash(&spend1.seeds, spend1.fee.0 as u64) {
            Ok(digest) => digest,
            Err(err) => {
                println!("INFO\t{}\tskipped: {err}", spend_key(name));
                continue;
            }
        };
        println!(
            "INFO\t{}\t{} seed(s), fee {}, {} signature(s)",
            spend_key(name),
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
            let path = out_dir.join(format!("sig-{}-{index}.jam", spend_key(name)));
            std::fs::write(&path, sig_slab.jam())
                .map_err(|e| format!("write {}: {e}", path.display()))?;
            println!(
                "SIGHASH\t{}\t{}\t{}\t{}\t{}",
                spend_key(name),
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

    let mut wanted: Vec<(Hash, nmeme_tx::cli::ClaimSpec)> = Vec::new();
    for spec in &args[4..] {
        let (lock, claim) = spec
            .split_once('=')
            .ok_or_else(|| format!("expected <lock-root>=<claim-spec>, got {spec:?}"))?;
        let lock = Hash::from_base58(lock).map_err(|e| format!("lock-root {lock}: {e}"))?;
        wanted.push((lock, nmeme_tx::cli::parse_claim_spec(claim)?));
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
    // a genesis claim names the id it creates, derived from these inputs
    let input_names: Vec<Name> = spends.0.iter().map(|(n, _)| n.clone()).collect();
    for (lock, claim) in &wanted {
        let payload = claim.to_noun(&input_names)?;
        let mut found = false;
        for (name, spend) in spends.0.iter_mut() {
            let Spend::Witness(spend1) = spend else { continue };
            if !spend1.seeds.0.iter().any(|s| &s.lock_root == lock) {
                continue;
            }
            if found {
                // several spends pay this lock (a wallet's change from each
                // of its spends): their seeds become one note, which carries
                // the one claim attached above
                println!("MERGED\t{}\tpaid by more than one spend; one claim on the merged note", lock.to_base58());
                continue;
            }
            nmeme_tx::attach::attach_noun(&mut spend1.seeds, lock, payload.clone())
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
        println!("NEWSIGHASH\t{}\t{}", spend_key(name), digest.to_base58());
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

    let original = find_spend(&spends, target)?;
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

/// The key a spend is reported and addressed by: `<first>.<last>` of its
/// input note. Two notes of one wallet share a first name (it is the
/// lock's), so the first name alone is not a key — a two-input
/// transaction's signature files overwrote each other under it (seen
/// live, the wallet demo's sell).
fn spend_key(name: &Name) -> String {
    format!("{}.{}", name.first.to_base58(), name.last.to_base58())
}

/// A spend by its key, or by its first name alone when that is unique
/// among the transaction's spends (the older scripts pass a first name).
fn find_spend<'a>(spends: &'a Spends, key: &str) -> Result<&'a (Name, Spend), String> {
    if let Some(hit) = spends.0.iter().find(|(n, _)| spend_key(n) == key) {
        return Ok(hit);
    }
    let by_first: Vec<&(Name, Spend)> = spends.0.iter().filter(|(n, _)| n.first.to_base58() == key).collect();
    match by_first.len() {
        1 => Ok(by_first[0]),
        0 => Err(format!("no spend keyed by {key}")),
        n => Err(format!("{n} spends share the first name {key}; name the spend as <first>.<last>")),
    }
}

fn print_digests(spends: &Spends) -> Result<(), String> {
    for (name, spend) in &spends.0 {
        let Spend::Witness(spend1) = spend else { continue };
        let digest = spend_sig_hash(&spend1.seeds, spend1.fee.0 as u64).map_err(|e| format!("sighash: {e}"))?;
        println!("NEWSIGHASH\t{}\t{}", spend_key(name), digest.to_base58());
    }
    Ok(())
}

fn spend_named<'a>(spends: &'a Spends, key: &str) -> Result<&'a Name, String> {
    find_spend(spends, key).map(|(n, _)| n)
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
    // Claims go on the token side's seeds — a's — and on those only. Every
    // lock in a trade is paid by both spends (the counterparty's payment and
    // the owner's change land on one lock), and the claim must sit on the
    // seed the token *sender* signs: the buyer's change seed carries none.
    for (lock, claim) in &claims {
        let mut done = false;
        for (name, spend) in spends.0.iter_mut() {
            if !a_inputs.contains(name) {
                continue;
            }
            let Spend::Witness(spend1) = spend else { continue };
            if !spend1.seeds.0.iter().any(|s| &s.lock_root == lock) {
                continue;
            }
            if done {
                return Err(format!("lock-root {} is paid by more than one of a's spends; a claim goes on exactly one seed", lock.to_base58()));
            }
            attach_claim(&mut spend1.seeds, lock, claim).map_err(|e: Error| format!("attach to {}: {e}", lock.to_base58()))?;
            done = true;
        }
        if !done {
            return Err(format!("no seed of a.tx pays lock-root {}", lock.to_base58()));
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
