//! `nmeme-index` — token identity, and balances read back from a node.
//!
//! ```text
//! nmeme-index token-id --tx <tx.jam> --ticker <T> --decimals <D>
//! nmeme-index rebuild  --addr <host:port> --token <token-b58> --lock <lock-root-b58>...
//! ```
//!
//! `token-id` is offline: identity is derived from the genesis transaction's
//! input note names, which are fixed before signing (SPEC §4), so it can be
//! computed from the transaction file alone.
//!
//! `rebuild` replays the mined transactions through the real
//! `nmeme_core::Indexer` and checks the result against the node's canonical
//! unspent-note set.
//!
//! It does **not** sum claims. Summing whatever carries a `meme` key would
//! count an unrelated token's genesis, an inflated transfer, or a claim on a
//! note nobody validated. The Indexer applies SPEC §5–§7 — genesis rules, exact
//! conservation, burn-on-invalid — so a forged transfer contributes nothing and
//! a foreign genesis registers a different token id.
//!
//! Note identity comes from the chain, not from guesswork: a note's `first`
//! name is derived from its lock-root, so outputs pair with destinations
//! exactly. Ambiguity is an error.

use std::collections::{BTreeMap, BTreeSet};
use std::process::ExitCode;

use nmeme_core::Claim;
use nmeme_core::indexer::{NoteView, TxView};
use nmeme_core::{Indexer, Ticker, TokenId};
use nmeme_tx::txfile::ParsedTransaction;
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockapp_grpc_proto::pb::public::v2::nockchain_block_service_client::NockchainBlockServiceClient;
use nockapp_grpc_proto::pb::public::v2::nockchain_metrics_service_client::NockchainMetricsServiceClient;
use nockapp_grpc_proto::pb::public::v2::nockchain_service_client::NockchainServiceClient;
use nockapp_grpc_proto::pb::public::v2::{
    get_block_details_request, get_block_details_response, get_explorer_metrics_response,
    get_transaction_block_response, GetBlockDetailsRequest, GetExplorerMetricsRequest,
    GetTransactionBlockRequest,
};
use nockapp_grpc_proto::pb::public::v2::{
    wallet_get_balance_request, wallet_get_balance_response, WalletGetBalanceRequest,
};
use nockapp_grpc_proto::pb::public::v2::{
    transaction_accepted_response, wallet_send_transaction_response, TransactionAcceptedRequest,
    WalletSendTransactionRequest,
};
use nockchain_types::tx_engine::common::{Hash, Name};
use nockchain_types::tx_engine::v1::tx::Spend;
use nockvm::noun::NounAllocator;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("token-id") => cmd_token_id(&args),
        Some("token-note") => cmd_token_note(&args),
        Some("funding") => cmd_funding(&args),
        Some("outputs") => cmd_outputs(&args),
        Some("check-inputs") => cmd_check_inputs(&args),
        Some("block") => cmd_block(&args),
        Some("tx-id") => cmd_tx_id(&args),
        Some("tx-status") => cmd_tx_status(&args),
        Some("send") => cmd_send(&args),
        Some("rebuild") => cmd_rebuild(&args),
        Some("pool") => cmd_pool(&args),
        Some("pool-replay") => cmd_pool_replay(&args),
        _ => {
            eprintln!("{USAGE}");
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
  nmeme-index token-id --tx <tx.jam> --ticker <TICKER> --decimals <N>
  nmeme-index token-note --addr <host:port> --lock <lock-root-b58> [--name \"<first> <last>\"] [--token <b58>] [--all]
  nmeme-index tx-status --addr <host:port> --txid <id-b58>
                       (TX-STATUS <id> mined height=<h> block=<id> canonical=yes|no | pending | unknown; TIP <height>)
  nmeme-index funding  --addr <host:port> [--lock <lock-root-b58>]... [--first <first-name-b58>]...
                       (every unspent note there: FUNDING <first> <last> coinbase|plain|claim <nicks> <origin>;
                        coinbase = last name recomputed from the origin block's parent id)
  nmeme-index outputs  --tx <tx.jam>      (INPUT <first> <last>; OUTPUT <lock> <first> <last> <claim>)
  nmeme-index check-inputs --tx <tx.jam> --funding <funding.txt> [--token-note \"<first> <last>\"]...
                       (every input must be proven token-free, or be a named token note)
  nmeme-index rebuild  --addr <host:port> --token <token-b58>
                       --step <txid>:<tx.jam> [--step ...]   (canonical order)
                       --funding <funding.txt> [--funding ...] (provenance of inputs)
                       [--scan-coinbase <height>]  (also accept inputs whose last name is a reward note's, recomputed from blocks 1..height)
                       --lock <lock-root-b58> [--lock ...]
                       [--expect <lock-root-b58>=<amount>]... [--expect-total <n>]
  nmeme-index pool     --addr <host:port> <pool params>
                       (POOL <first> <last> <origin> <nock> <tokens> for every note at the canonical pool lock)
  nmeme-index pool-replay <pool params> --open <txid>:<tx.jam> --step <txid>:<tx.jam>...
                       (TRADE and LORE lines per step: deltas, fee retained, the treasury's due and paid; STATE at the end)
  pool params: --token <token-b58> --fee-bps <n> --lore-bps <n> --lore-lock <lock-root>";

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
}

fn flags<'a>(args: &'a [String], name: &str) -> Vec<&'a str> {
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

fn cmd_token_id(args: &[String]) -> Result<ExitCode, String> {
    let tx = flag(args, "--tx").ok_or("missing --tx")?;
    let ticker = Ticker::new(flag(args, "--ticker").ok_or("missing --ticker")?)
        .map_err(|e| format!("ticker: {e}"))?;
    let decimals: u64 = flag(args, "--decimals")
        .ok_or("missing --decimals")?
        .parse()
        .map_err(|e| format!("decimals: {e}"))?;

    let bytes = std::fs::read(tx).map_err(|e| format!("read {tx}: {e}"))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let parsed =
        ParsedTransaction::from_noun(noun.in_space(&space)).map_err(|e| format!("decode: {e}"))?;

    let inputs: Vec<Name> = parsed.spends.0.iter().map(|(name, _)| name.clone()).collect();
    if inputs.is_empty() {
        return Err("transaction has no inputs to anchor identity to".to_string());
    }
    let token = TokenId::derive(&inputs, &ticker, decimals).map_err(|e| format!("derive: {e}"))?;
    println!("{}", token.to_base58());
    Ok(ExitCode::SUCCESS)
}

/// Finds the note at a lock-root that actually carries token weight.
///
/// A transfer must spend that note explicitly. Letting the wallet auto-select
/// inputs would very likely spend a plain NOCK note instead, leaving the token
/// note untouched — or worse, spend the token note in a transaction with no
/// claim attached, which burns the tokens outright (SPEC §7).
///
/// Prints `NOTE\t[<first> <last>]\t<assets>\t<amount>` in the bracket form
/// `create-tx --names` expects.
fn cmd_token_note(args: &[String]) -> Result<ExitCode, String> {
    let addr = flag(args, "--addr").ok_or("missing --addr")?.to_string();
    let lock = Hash::from_base58(flag(args, "--lock").ok_or("missing --lock")?)
        .map_err(|e| format!("lock: {e}"))?;
    // With two tokens at one lock there are two token-bearing notes; the
    // caller names the one it means (the genesis output, by full name).
    let want_name = flag(args, "--name").map(parse_name).transpose()?;
    // Or by token: only notes carrying a transfer claim of that token.
    // `--all`: every token-bearing note at the lock, whatever its token,
    // one NOTE line each (and NOTE-UNKNOWN for a claim that does not decode)
    let all = args.iter().any(|a| a == "--all");
    let want_token = flag(args, "--token")
        .map(|t| Hash::from_base58(t).map_err(|e| format!("token: {e}")))
        .transpose()?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(async move {
        let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let want_first = nmeme_index::first_name_of(&lock);
        let snapshot = read_snapshot(&mut client, std::slice::from_ref(&lock)).await?;
        println!("# snapshot height {} block {}", snapshot.height, snapshot.block_id);

        let mut found = Vec::new();
        let mut unknown = 0usize;
        for row in &snapshot.notes {
            let (name, data) = (&row.name, &row.data);
            if name.first != want_first {
                continue;
            }
            if let Some(w) = &want_name {
                if nmeme_index::name_key(w) != nmeme_index::name_key(name) {
                    continue;
                }
            }
            for (key, blob) in data {
                if key != nmeme_core::NOTE_DATA_KEY {
                    continue;
                }
                // `--all`: a note whose claim does not decode is reported as
                // such and the listing goes on (a backend classifies it as
                // unknown: never plain funds, never a token holding)
                let claim = match nmeme_index::decode_claim(blob) {
                    Ok(c) => c,
                    Err(e) if all => {
                        unknown += 1;
                        println!(
                            "NOTE-UNKNOWN\t[{} {}]\t{}\t{}",
                            name.first.to_base58(),
                            name.last.to_base58(),
                            row.assets,
                            e.to_string().replace(['\t', '\n'], " ")
                        );
                        continue;
                    }
                    Err(e) => return Err(format!("claim on note: {e}")),
                };
                // a genesis note carries the id it created (SPEC §2a): it
                // holds that token as much as a transfer note does
                let token = match &claim {
                    Claim::Transfer { token, .. } => token.0.to_base58(),
                    Claim::Genesis { token, .. } => format!("{} (genesis)", token.0.to_base58()),
                };
                if let Some(w) = &want_token {
                    let held = match &claim {
                        Claim::Transfer { token, .. } | Claim::Genesis { token, .. } => &token.0,
                    };
                    if held != w {
                        continue;
                    }
                }
                found.push((name.clone(), row.assets, claim.amount(), token));
            }
        }

        // Filtered by token, every note is printed: a holder may well have
        // several notes of one token (a transfer's change and a purchase).
        if all {
            for (name, assets, amount, token) in &found {
                println!("NOTE\t[{} {}]\t{}\t{}\t{}", name.first.to_base58(), name.last.to_base58(), assets, amount, token);
            }
            eprintln!("# token-note: {} token notes, {} undecodable", found.len(), unknown);
            return Ok(ExitCode::SUCCESS);
        }
        if want_token.is_some() && !found.is_empty() {
            for (name, assets, amount, token) in &found {
                println!("NOTE\t[{} {}]\t{}\t{}\t{}", name.first.to_base58(), name.last.to_base58(), assets, amount, token);
            }
            return Ok(ExitCode::SUCCESS);
        }
        match found.as_slice() {
            [] => Err(format!("no token-bearing note at lock-root {}", lock.to_base58())),
            [(name, assets, amount, token)] => {
                println!(
                    "NOTE\t[{} {}]\t{}\t{}\t{}",
                    name.first.to_base58(),
                    name.last.to_base58(),
                    assets,
                    amount,
                    token
                );
                Ok(ExitCode::SUCCESS)
            }
            several => Err(format!(
                "{} token-bearing notes at that lock-root; refusing to pick one",
                several.len()
            )),
        }
    })
}

fn cmd_rebuild(args: &[String]) -> Result<ExitCode, String> {
    let addr = flag(args, "--addr").ok_or("missing --addr")?.to_string();
    let token_b58 = flag(args, "--token").ok_or("missing --token")?;
    let token = TokenId(Hash::from_base58(token_b58).map_err(|e| format!("token: {e}"))?);

    let mut steps: Vec<(String, std::path::PathBuf)> = Vec::new();
    for spec in flags(args, "--step") {
        let (txid, path) = spec
            .split_once(':')
            .ok_or_else(|| format!("expected <txid>:<file>, got {spec:?}"))?;
        steps.push((txid.to_string(), std::path::PathBuf::from(path)));
    }
    if steps.is_empty() {
        return Err("at least one --step <txid>:<file> is required".to_string());
    }

    let addresses: Vec<Hash> = flags(args, "--lock")
        .into_iter()
        .map(|l| Hash::from_base58(l).map_err(|e| format!("lock {l}: {e}")))
        .collect::<Result<_, _>>()?;
    let mut records: Vec<nmeme_index::FundingRecord> = Vec::new();
    let scan_max: Option<u64> = flag(args, "--scan-coinbase")
        .map(|v| v.parse::<u64>().map_err(|e| format!("--scan-coinbase: {e}")))
        .transpose()?;
    for path in flags(args, "--funding") {
        let text = std::fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?;
        records.extend(nmeme_index::parse_funding(&text)?);
    }
    if addresses.is_empty() {
        return Err("at least one --lock is required".to_string());
    }

    let mut expectations: Vec<(String, u64)> = Vec::new();
    for spec in flags(args, "--expect") {
        let (lock, amount) = spec
            .split_once('=')
            .ok_or_else(|| format!("expected <lock-root>=<amount>, got {spec:?}"))?;
        expectations.push((
            lock.to_string(),
            amount.parse().map_err(|e| format!("amount: {e}"))?,
        ));
    }
    let expect_total: Option<u64> = match flag(args, "--expect-total") {
        Some(v) => Some(v.parse().map_err(|e| format!("--expect-total: {e}"))?),
        None => None,
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(rebuild(addr, token, steps, addresses, expectations, expect_total, records, scan_max))
}

#[allow(clippy::too_many_arguments)]
async fn rebuild(
    addr: String,
    token: TokenId,
    steps: Vec<(String, std::path::PathBuf)>,
    addresses: Vec<Hash>,
    expectations: Vec<(String, u64)>,
    expect_total: Option<u64>,
    records: Vec<nmeme_index::FundingRecord>,
    scan_max: Option<u64>,
) -> Result<ExitCode, String> {
    let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
        .await
        .map_err(|e| format!("connect {addr}: {e}"))?;

    // 0. Funding evidence is re-verified against the chain, never read off the
    //    file: a record is admitted only if it says coinbase and the note's
    //    last name recomputes from the parent id of its origin block.
    let mut parents = ParentCache::default();
    let mut oracle_client = NockchainBlockServiceClient::connect(format!("http://{addr}"))
        .await
        .map_err(|e| format!("connect {addr}: {e}"))?;
    let mut needed: Vec<u64> = records
        .iter()
        .filter(|r| r.status == nmeme_index::FundingStatus::Coinbase)
        .filter_map(|r| r.origin_page)
        .collect();
    needed.sort_unstable();
    needed.dedup();
    for h in needed {
        parents.fill(&mut oracle_client, h).await?;
    }
    let token_free = nmeme_index::admitted_token_free(&records, |h| parents.get(h))?;
    println!("EVIDENCE\t{} coinbase note(s) re-verified against block parents", token_free.len());
    // Optionally, every coinbase name the chain could have issued up to a
    // height: the last name of a block's reward note is recomputed from its
    // parent id (`coinbase_last_name`), so a spent input whose last name is
    // among them was a reward note and carried no claim in any history. The
    // same proof as a FUNDING record, without needing a read taken while the
    // note was unspent (a wallet may add inputs a caller never listed).
    let mut coinbase_lasts: BTreeSet<Vec<u8>> = BTreeSet::new();
    if let Some(max) = scan_max {
        for h in 1..=max {
            parents.fill(&mut oracle_client, h).await?;
            let parent = parents.get(h)?;
            coinbase_lasts.insert(nmeme_tx::names::coinbase_last_name(&parent).to_base58().into_bytes());
        }
        println!("EVIDENCE\t{} coinbase names recomputed from the parents of blocks 1..={max}", coinbase_lasts.len());
    }

    // 1. One canonical snapshot: every address, every page, one block.
    let snapshot = read_snapshot(&mut client, &addresses).await?;
    let unspent: Vec<(Name, String)> = snapshot.notes.iter().map(|r| (r.name.clone(), r.address.clone())).collect();
    println!("# canonical snapshot: {} unspent note(s) at height {} block {}", unspent.len(), snapshot.height, snapshot.block_id);
    println!("HEIGHT\t{}", snapshot.height);
    println!("BLOCK\t{}", snapshot.block_id);

    // 2. Candidate output names: inputs of later steps, plus the final unspent
    //    set. An output of step N is one or the other.
    let mut plans = Vec::new();
    for (txid, path) in &steps {
        plans.push((txid.clone(), nmeme_index::read_tx_plan(path)?));
    }

    // 3. Replay through the real Indexer.
    let mut indexer = Indexer::new();
    let mut taken: Vec<Vec<u8>> = Vec::new();
    // Outputs the replay has assigned so far; an input must be one of these
    // or proven token-free, or the history is incomplete (lib.rs, provenance).
    let mut known_outputs: BTreeSet<Vec<u8>> = BTreeSet::new();
    for (i, (txid, plan)) in plans.iter().enumerate() {
        nmeme_index::require_provenance(txid, &plan.inputs, &known_outputs, &token_free, &coinbase_lasts)?;
        let mut candidates: Vec<Name> = Vec::new();
        for (_, later) in plans.iter().skip(i + 1) {
            candidates.extend(later.inputs.iter().cloned());
        }
        candidates.extend(unspent.iter().map(|(n, _)| n.clone()));

        // Bind the local file to the mined transaction before trusting it.
        let path = &steps[i].1;
        let (height, block) = verify_canonical(&addr, txid, path).await?;
        if height > snapshot.height {
            return Err(format!(
                "{txid} is at height {height}, beyond the snapshot at {}; the reads are not of one chain state",
                snapshot.height
            ));
        }
        println!("CANONICAL\t{txid}\theight={height}\tblock={block}");
        println!("PROVENANCE\t{txid}\t{} input(s) known", plan.inputs.len());

        let paired = nmeme_index::bind_outputs(&plan.destinations, &candidates, &mut taken, Some(&token))?;
        for (name, dest, present) in &paired {
            known_outputs.insert(nmeme_index::name_key(name));
            if !present {
                println!(
                    "OUTSIDE\t{txid}\t{}\t{}.{}\tconsumed outside the replay ({}); the step is canonical, this token's history is unaffected",
                    dest.lock_root.to_base58(), name.first.to_base58(), name.last.to_base58(),
                    match &dest.claim { None => "no claim".to_string(), Some(_) => "a claim of another token".to_string() }
                );
            }
        }
        let outputs: Vec<NoteView> = paired
            .into_iter()
            .map(|(name, dest, _)| NoteView {
                name,
                lock_root: dest.lock_root,
                claim: dest.claim,
            })
            .collect();

        let tx_id = Hash::from_base58(txid).map_err(|e| format!("txid {txid}: {e}"))?;
        let view = TxView { id: tx_id, inputs: plan.inputs.clone(), outputs };
        let outcome = indexer.apply(&view);
        println!("STEP\t{txid}\t{outcome:?}");
    }

    // 3b. Bracket: the transaction reads happened after the balance read. If
    //     the tip moved in between, the two describe different states.
    let after = read_snapshot(&mut client, &addresses).await?;
    nmeme_index::require_same_snapshot(&snapshot, &after)?;
    println!("SNAPSHOT\tstable\theight={}\tblock={}", snapshot.height, snapshot.block_id);

    // 4. Report validated balances, keyed by lock-root.
    println!("TOKEN\t{}", token.to_base58());
    let balances = indexer.balances(&token);
    let mut total: u64 = 0;
    let mut by_lock: BTreeMap<String, u64> = BTreeMap::new();
    // Balance keys are the lock-root's atom bytes (`Hash::to_be_bytes`, a tip5
    // digest of five 64-bit belts, so up to 40 bytes and never the 32 a
    // `from_be_bytes` round trip would need). Label them by matching against
    // the lock-roots this run was given; anything else is printed as hex.
    let mut known: BTreeMap<Vec<u8>, String> = BTreeMap::new();
    for l in &addresses {
        known.insert(l.to_be_bytes(), l.to_base58());
    }
    for (l, _) in &expectations {
        if let Ok(h) = Hash::from_base58(l) {
            known.insert(h.to_be_bytes(), l.clone());
        }
    }
    for (lock_bytes, amount) in &balances {
        let label = known.get(lock_bytes.as_slice()).cloned().unwrap_or_else(|| {
            format!("0x{}", lock_bytes.iter().map(|b| format!("{b:02x}")).collect::<String>())
        });
        by_lock.insert(label.clone(), *amount);
        total = total.saturating_add(*amount);
        println!("BALANCE\t{label}\t{amount}");
    }
    println!("TOTAL\t{total}");
    println!("CIRCULATING\t{}", indexer.circulating(&token));
    if let Some(meta) = indexer.token(&token) {
        println!("SUPPLY\t{}", meta.supply);
        println!("TICKER\t{}", meta.ticker.as_str());
    } else {
        println!("SUPPLY\tunregistered");
    }

    // 5. Assertions.
    let mut failures = 0usize;
    for (lock, expected) in &expectations {
        let got = by_lock.get(lock).copied().unwrap_or(0);
        if got == *expected {
            println!("ASSERT-OK\t{lock}\t{expected}");
        } else {
            println!("ASSERT-FAIL\t{lock}\texpected {expected}, got {got}");
            failures += 1;
        }
    }
    if let Some(expected) = expect_total {
        if total == expected {
            println!("ASSERT-OK\ttotal\t{expected}");
        } else {
            println!("ASSERT-FAIL\ttotal\texpected {expected}, got {total}");
            failures += 1;
        }
    }
    if failures > 0 {
        return Err(format!("{failures} assertion(s) failed"));
    }
    Ok(ExitCode::SUCCESS)
}


fn parse_name(text: &str) -> Result<Name, String> {
    let t = text.trim().trim_start_matches('[').trim_end_matches(']');
    let mut parts = t.split_whitespace();
    let (Some(f), Some(l), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err(format!("name {text:?}: expected \"<first> <last>\""));
    };
    Ok(Name::new(
        Hash::from_base58(f).map_err(|e| format!("name first: {e}"))?,
        Hash::from_base58(l).map_err(|e| format!("name last: {e}"))?,
    ))
}

/// Every unspent note at a lock, with its token status as the chain reports
/// it. This is the funding proof: read BEFORE a transaction spends the note,
/// it settles the note's weight for any later replay (lib.rs, provenance).
fn cmd_funding(args: &[String]) -> Result<ExitCode, String> {
    let addr = flag(args, "--addr").ok_or("missing --addr")?.to_string();
    let mut firsts: Vec<Hash> = Vec::new();
    for l in flags(args, "--lock") {
        let lock = Hash::from_base58(l).map_err(|e| format!("lock {l}: {e}"))?;
        firsts.push(nmeme_index::first_name_of(&lock));
    }
    for f in flags(args, "--first") {
        firsts.push(Hash::from_base58(f).map_err(|e| format!("first {f}: {e}"))?);
    }
    if firsts.is_empty() {
        return Err("at least one --lock or --first is required".to_string());
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(async move {
        let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let mut blocks = NockchainBlockServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let snapshot = read_snapshot_firsts(&mut client, &firsts).await?;
        // Every origin height once; the parent ids are what make `coinbase`
        // a verified status rather than a label.
        let mut parents = ParentCache::default();
        let mut heights: Vec<u64> = snapshot.notes.iter().map(|r| r.origin_page).collect();
        heights.sort_unstable();
        heights.dedup();
        for h in heights {
            parents.fill(&mut blocks, h).await?;
        }
        for line in nmeme_index::funding_header(&snapshot) {
            println!("{line}");
        }
        let mut counts = [0usize; 3];
        for row in &snapshot.notes {
            let status = if nmeme_index::has_claim(&row.data) {
                nmeme_index::FundingStatus::Claim
            } else if nmeme_index::is_coinbase_note(&row.name, row.origin_page, &mut |h| parents.get(h))? {
                nmeme_index::FundingStatus::Coinbase
            } else {
                nmeme_index::FundingStatus::Plain
            };
            counts[status as usize] += 1;
            println!("{}", nmeme_index::funding_line(row, status));
        }
        eprintln!(
            "# funding: {} coinbase (verified against block parents), {} plain, {} claim",
            counts[0], counts[1], counts[2]
        );
        Ok(ExitCode::SUCCESS)
    })
}

/// `send --addr <host:port> --tx <file>`: submits the file's transaction
/// through the node's public `WalletSendTransaction`, then asks
/// `TransactionAccepted` whether the mempool holds it. Prints `TXID`, `SEND`
/// (the node's acknowledgement or error) and `MEMPOOL admitted|not admitted`.
///
/// Mempool admission is **not** validity. Seen live: a transaction whose
/// output-source pin was violated was admitted, and then failed with
/// `v1-tx-invalid` every time the miner tried to build a block with it,
/// never mined. The consensus verdict is in the node's log
/// (`tx-acc: process failed: v1-tx-invalid`) and in whether it is mined.
///
/// The wallet's own `send-tx` reads the whole balance before submitting and
/// aborts when a block lands mid-read (seen live), so nothing reaches the
/// node; this path has no such step, and the verdict comes from the node.
fn cmd_send(args: &[String]) -> Result<ExitCode, String> {
    use nmeme_tx::txfile::ParsedTransaction;
    use nockchain_types::tx_engine::common::Version;
    use nockchain_types::tx_engine::v1::tx::RawTx;

    let addr = flag(args, "--addr").ok_or("missing --addr")?.to_string();
    let path = flag(args, "--tx").ok_or("missing --tx")?.to_string();
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let parsed = ParsedTransaction::from_noun(noun.in_space(&space)).map_err(|e| format!("decode: {e}"))?;
    let spends = parsed.spliced().map_err(|e| format!("splice: {e}"))?;
    let probe = RawTx { version: Version::V1, id: Hash::from_be_bytes(&[0u8; 32]), spends: spends.clone() };
    let id = probe.compute_id().map_err(|e| format!("compute tx id: {e}"))?;
    let id_b58 = id.to_base58();
    let raw = RawTx { version: Version::V1, id: id.clone(), spends };
    println!("TXID\t{id_b58}");

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(async move {
        let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let request = WalletSendTransactionRequest {
            tx_id: Some(nockapp_grpc_proto::pb::common::v1::Hash::from(id.clone())),
            raw_tx: Some(nockapp_grpc_proto::pb::common::v2::RawTransaction::from(raw)),
        };
        let response = client
            .wallet_send_transaction(request)
            .await
            .map_err(|e| format!("wallet_send_transaction: {e}"))?
            .into_inner();
        match response.result {
            Some(wallet_send_transaction_response::Result::Ack(_)) => println!("SEND\tacknowledged"),
            Some(wallet_send_transaction_response::Result::Error(err)) => println!("SEND\terror: {}", err.message),
            None => println!("SEND\tno result"),
        }
        // The node validates on receipt; give it a moment, then ask.
        let mut verdict = "not admitted".to_string();
        let mut detail = String::new();
        for _ in 0..12 {
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            let req = TransactionAcceptedRequest {
                tx_id: Some(nockapp_grpc_proto::pb::common::v1::Base58Hash { hash: id_b58.clone() }),
            };
            match client.transaction_accepted(req).await {
                Ok(resp) => match resp.into_inner().result {
                    Some(transaction_accepted_response::Result::Accepted(true)) => {
                        verdict = "admitted".to_string();
                        break;
                    }
                    Some(transaction_accepted_response::Result::Accepted(false)) => {
                        detail = "not in the node's accepted set".to_string();
                    }
                    Some(transaction_accepted_response::Result::Error(err)) => detail = err.message,
                    None => detail = "no result".to_string(),
                },
                Err(e) => detail = format!("{e}"),
            }
        }
        println!("MEMPOOL\t{verdict}\t{detail}");
        Ok(ExitCode::SUCCESS)
    })
}

/// `tx-id --tx <file>`: the id consensus assigns to the file's transaction.
fn cmd_tx_id(args: &[String]) -> Result<ExitCode, String> {
    let path = std::path::PathBuf::from(flag(args, "--tx").ok_or("missing --tx")?);
    println!("{}", nmeme_index::read_tx_id(&path)?);
    Ok(ExitCode::SUCCESS)
}

/// `tx-status --addr <host:port> --txid <b58>`: settlement of a transaction
/// by ITS ID, from the node. Inputs having left the unspent set proves only
/// that *some* transaction spending them was mined; this asks the node which
/// block holds this id (`GetTransactionBlock`, the lookup the wallet's
/// `tx-status` uses) and then checks that the block is the canonical one at
/// that height (`GetBlockDetails` by height on the heaviest chain): a
/// transaction in an orphaned block is `mined ... canonical=no`.
///
///   TX-STATUS <id> mined height=<h> block=<id> canonical=yes|no [canonical_block=<id>]
///   TX-STATUS <id> pending            (in the node's mempool, not in a block)
///   TX-STATUS <id> unknown <reason>   (the node knows no such transaction)
///   TIP <height>                      (the heaviest chain's height, when served)
fn cmd_tx_status(args: &[String]) -> Result<ExitCode, String> {
    let addr = flag(args, "--addr").ok_or("missing --addr")?.to_string();
    let txid = flag(args, "--txid").ok_or("missing --txid")?.to_string();
    Hash::from_base58(&txid).map_err(|e| format!("txid: {e}"))?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(async move {
        let mut blocks = NockchainBlockServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let request = GetTransactionBlockRequest {
            tx_id: Some(nockapp_grpc_proto::pb::common::v1::Base58Hash { hash: txid.clone() }),
        };
        let response = blocks
            .get_transaction_block(request)
            .await
            .map_err(|e| format!("get_transaction_block({txid}): {e}"))?
            .into_inner();
        match response.result {
            Some(get_transaction_block_response::Result::Block(b)) => {
                let block = b
                    .block_id
                    .as_ref()
                    .map(|h| decode_hash(h).map(|h| h.to_base58()))
                    .transpose()?
                    .ok_or_else(|| format!("{txid}: block data without a block id"))?;
                let at_height = GetBlockDetailsRequest {
                    selector: Some(get_block_details_request::Selector::Height(b.height)),
                };
                let canonical = match blocks.get_block_details(at_height).await {
                    Ok(r) => match r.into_inner().result {
                        Some(get_block_details_response::Result::Details(d)) => d
                            .block_id
                            .as_ref()
                            .map(|h| decode_hash(h).map(|h| h.to_base58()))
                            .transpose()?,
                        _ => None,
                    },
                    Err(_) => None,
                };
                match canonical {
                    Some(c) if c == block => println!(
                        "TX-STATUS\t{txid}\tmined\theight={}\tblock={block}\tcanonical=yes",
                        b.height
                    ),
                    Some(c) => println!(
                        "TX-STATUS\t{txid}\tmined\theight={}\tblock={block}\tcanonical=no\tcanonical_block={c}",
                        b.height
                    ),
                    None => println!(
                        "TX-STATUS\t{txid}\tmined\theight={}\tblock={block}\tcanonical=unverified",
                        b.height
                    ),
                }
            }
            Some(get_transaction_block_response::Result::Pending(_)) => println!("TX-STATUS\t{txid}\tpending"),
            Some(get_transaction_block_response::Result::Error(e)) => {
                println!("TX-STATUS\t{txid}\tunknown\t{}", e.message.replace(['\t', '\n'], " "))
            }
            None => println!("TX-STATUS\t{txid}\tunknown\tno result"),
        }
        if let Ok(mut metrics) = NockchainMetricsServiceClient::connect(format!("http://{addr}")).await {
            if let Ok(m) = metrics.get_explorer_metrics(GetExplorerMetricsRequest {}).await {
                if let Some(get_explorer_metrics_response::Result::Metrics(m)) = m.into_inner().result {
                    println!("TIP\t{}", m.heaviest_height);
                }
            }
        }
        Ok(ExitCode::SUCCESS)
    })
}

/// `block --addr <host:port> --height <h>`: the block's id and parent id, as
/// the node serves them. This is the public data a coinbase note's name is
/// recomputed from.
fn cmd_block(args: &[String]) -> Result<ExitCode, String> {
    let addr = flag(args, "--addr").ok_or("missing --addr")?.to_string();
    let height: u64 = flag(args, "--height").ok_or("missing --height")?.parse().map_err(|e| format!("height: {e}"))?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(async move {
        let mut blocks = NockchainBlockServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let request = GetBlockDetailsRequest { selector: Some(get_block_details_request::Selector::Height(height)) };
        let response = blocks.get_block_details(request).await.map_err(|e| format!("get_block_details({height}): {e}"))?.into_inner();
        let details = match response.result {
            Some(get_block_details_response::Result::Details(d)) => d,
            Some(get_block_details_response::Result::Error(err)) => return Err(err.message),
            None => return Err("no result".to_string()),
        };
        let id = details.block_id.as_ref().ok_or("block has no id")?;
        let parent = details.parent.as_ref().ok_or("block has no parent")?;
        println!("BLOCK\t{}\t{}\tparent={}", details.height, decode_hash(id)?.to_base58(), decode_hash(parent)?.to_base58());
        println!("COINBASE-LAST\t{}", nmeme_tx::names::coinbase_last_name(&decode_hash(parent)?).to_base58());
        Ok(ExitCode::SUCCESS)
    })
}

/// Parent block ids by height, from `GetBlockDetails`. The block at `h` is
/// consensus data every node serves; its parent id is what a coinbase note
/// at origin `h` was named from.
#[derive(Default)]
struct ParentCache(BTreeMap<u64, Hash>);

impl ParentCache {
    async fn fill(
        &mut self,
        blocks: &mut NockchainBlockServiceClient<tonic::transport::Channel>,
        height: u64,
    ) -> Result<(), String> {
        if self.0.contains_key(&height) {
            return Ok(());
        }
        let request = GetBlockDetailsRequest {
            selector: Some(get_block_details_request::Selector::Height(height)),
        };
        let response = blocks
            .get_block_details(request)
            .await
            .map_err(|e| format!("get_block_details({height}): {e}"))?
            .into_inner();
        let details = match response.result {
            Some(get_block_details_response::Result::Details(d)) => d,
            Some(get_block_details_response::Result::Error(err)) => {
                return Err(format!("get_block_details({height}): {}", err.message))
            }
            None => return Err(format!("get_block_details({height}): no result")),
        };
        if details.height != height {
            return Err(format!("get_block_details({height}): node answered with height {}", details.height));
        }
        let parent = details
            .parent
            .as_ref()
            .ok_or_else(|| format!("get_block_details({height}): block carries no parent id"))?;
        self.0.insert(height, decode_hash(parent)?);
        Ok(())
    }
    fn get(&self, height: u64) -> Result<Hash, String> {
        self.0
            .get(&height)
            .cloned()
            .ok_or_else(|| format!("no block parent cached for height {height}"))
    }
}

fn cmd_outputs(args: &[String]) -> Result<ExitCode, String> {
    let path = std::path::PathBuf::from(flag(args, "--tx").ok_or("missing --tx")?);
    let plan = nmeme_index::read_tx_plan(&path)?;
    for input in &plan.inputs {
        println!("INPUT\t{}\t{}", input.first.to_base58(), input.last.to_base58());
    }
    for dest in &plan.destinations {
        let claim = match &dest.claim {
            None => "none".to_string(),
            Some(Claim::Genesis { amount, .. }) => format!("genesis:{amount}"),
            Some(Claim::Transfer { token, amount }) => format!("transfer:{}:{amount}", token.to_base58()),
        };
        println!(
            "OUTPUT\t{}\t{}\t{}\t{}",
            dest.lock_root.to_base58(),
            dest.name.first.to_base58(),
            dest.name.last.to_base58(),
            claim
        );
    }
    Ok(ExitCode::SUCCESS)
}

/// Pre-broadcast gate: every input must be a note the node shows unspent
/// **right now** with no claim, or the token note the caller explicitly
/// means to move. The verdict comes from the note bodies the node returns
/// for the inputs' first-names, never from a file: an input the node does
/// not show, or shows with a claim that was not named, is refused before
/// anything is broadcast — spending a token note as ordinary funds burns it
/// (SPEC §7).
fn cmd_check_inputs(args: &[String]) -> Result<ExitCode, String> {
    let addr = flag(args, "--addr").ok_or("missing --addr")?.to_string();
    let path = std::path::PathBuf::from(flag(args, "--tx").ok_or("missing --tx")?);
    let plan = nmeme_index::read_tx_plan(&path)?;
    let allowed_token_notes: Vec<Name> = flags(args, "--token-note")
        .into_iter()
        .map(parse_name)
        .collect::<Result<_, _>>()?;
    let mut firsts: Vec<Hash> = plan.inputs.iter().map(|n| n.first.clone()).collect();
    firsts.sort_by_key(|h| h.to_be_bytes());
    firsts.dedup();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(async move {
        let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let snapshot = read_snapshot_firsts(&mut client, &firsts).await?;
        println!("# inputs read live at height {} block {}", snapshot.height, snapshot.block_id);
        let mut failures = 0usize;
        for input in &plan.inputs {
            let label = format!("[{} {}]", input.first.to_base58(), input.last.to_base58());
            match nmeme_index::classify_input(input, &snapshot.notes, &allowed_token_notes) {
                nmeme_index::InputVerdict::TokenFree => println!("INPUT-OK\t{label}\ttokenfree (node shows no claim)"),
                nmeme_index::InputVerdict::NamedTokenNote => println!("INPUT-OK\t{label}\tnamed token note"),
                nmeme_index::InputVerdict::Refused(why) => {
                    println!("INPUT-REFUSED\t{label}\t{why}");
                    failures += 1;
                }
            }
        }
        if failures > 0 {
            return Err(format!("{failures} input(s) refused"));
        }
        println!("INPUTS\t{} verified live", plan.inputs.len());
        Ok(ExitCode::SUCCESS)
    })
}

/// Binds a transaction file to the transaction the chain mined under `txid`,
/// and returns the (height, block id) of the block that holds it.
///
/// Binding is by CONTENT HASH: the file's id is recomputed the way consensus
/// computes it (`read_tx_id`) and must equal `txid`. That covers every input,
/// every output, every amount and every note-data claim at once, so nothing
/// in the replayed transaction is taken from the file unchecked.
///
/// Inclusion comes from `GetTransactionBlock`, the same lookup the wallet's
/// `tx-status` uses. `GetTransactionDetails` is NOT used: the node's explorer
/// decoder (`extract_transactions_from_map`) fails with a NounDecode error on a
/// transaction whose notes carry note-data, although consensus accepted and
/// mined it (seen live on the first genesis transaction). The mined block is
/// canonical data; the explorer's per-field view of it is a convenience this
/// tool no longer needs.
async fn verify_canonical(
    addr: &str,
    txid: &str,
    path: &std::path::Path,
) -> Result<(u64, String), String> {
    let computed = nmeme_index::read_tx_id(path)?;
    if computed != txid {
        return Err(format!(
            "{}: file hashes to tx id {computed}, not the mined {txid}",
            path.display()
        ));
    }

    let mut client = NockchainBlockServiceClient::connect(format!("http://{addr}"))
        .await
        .map_err(|e| format!("connect block service {addr}: {e}"))?;
    let request = GetTransactionBlockRequest {
        tx_id: Some(nockapp_grpc_proto::pb::common::v1::Base58Hash { hash: txid.to_string() }),
    };
    let response = client
        .get_transaction_block(request)
        .await
        .map_err(|e| format!("get_transaction_block({txid}): {e}"))?
        .into_inner();
    let data = match response.result {
        Some(get_transaction_block_response::Result::Block(b)) => b,
        Some(get_transaction_block_response::Result::Pending(_)) => {
            return Err(format!("{txid} is still pending; not canonical"))
        }
        Some(get_transaction_block_response::Result::Error(e)) => {
            return Err(format!("get_transaction_block({txid}): {}", e.message))
        }
        None => return Err(format!("get_transaction_block({txid}) returned nothing")),
    };
    let block = data
        .block_id
        .as_ref()
        .map(|b| decode_hash(b).map(|h| h.to_base58()))
        .transpose()?
        .ok_or_else(|| format!("{txid} has no block id; not mined"))?;
    Ok((data.height, block))
}

/// Reads every unspent note for every address, following pagination to the
/// end for each, and folds the pages into one snapshot — refusing if any page
/// reports a different block than the first.
/// Reads by note FIRST-NAME, not by wallet address. The node's
/// `WalletGetBalance` takes either a base58 cheetah pubkey or a first-name
/// (`public/v2/nockchain.proto`); the wallet's printed "address" is a pubkey
/// HASH, which the server rejects as "improperly formatted" (seen live). A
/// note's first name is a function of its lock-root alone (names.rs), and the
/// lock-roots are what this tool is given, so the first-name selector is the
/// exact query: every unspent note at that lock.
async fn read_snapshot(
    client: &mut NockchainServiceClient<tonic::transport::Channel>,
    locks: &[Hash],
) -> Result<nmeme_index::Snapshot, String> {
    let firsts: Vec<Hash> = locks.iter().map(nmeme_index::first_name_of).collect();
    read_snapshot_firsts(client, &firsts).await
}

/// A read spanning several first-names is several RPCs, and on a chain that
/// mines a block every few seconds the node can answer them from different
/// tips (seen live: page 0 at height 511, page 2 at 519). The fold refuses
/// such a mix; this retries the whole read until every page agrees, and
/// gives up loudly rather than returning a snapshot of two chain states.
/// `pool --addr <host:port> --token <b58> --fee-bps N`: every unspent note
/// at the canonical pool lock, read from the node, as
/// `POOL <first> <last> <origin> <nock> <tokens>`, plus the lock, the spot
/// price and the constant product. The lock is recomputed from the token
/// and the fee: a pool that lives anywhere else is not this pool.
fn cmd_pool(args: &[String]) -> Result<ExitCode, String> {
    let addr = flag(args, "--addr").ok_or("missing --addr")?.to_string();
    let params = index_pool_params(args)?;
    let root = params.lock_root().map_err(|e| format!("{e:?}"))?;
    let first = nmeme_index::first_name_of(&root);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(async move {
        let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let snapshot = read_snapshot_firsts(&mut client, &[first.clone()]).await?;
        println!("LOCK\t{}\tFIRST\t{}\tFEE-BPS\t{}\tLORE-BPS\t{}\tLORE-FIRST\t{}\tHEIGHT\t{}", root.to_base58(), first.to_base58(), params.fee_bps, params.lore_bps, params.lore_first_name().to_base58(), snapshot.height);
        let mut n = 0;
        for row in &snapshot.notes {
            let tokens = pool_tokens(&params, &row.data);
            println!(
                "POOL\t{}\t{}\t{}\t{}\t{}",
                row.name.first.to_base58(),
                row.name.last.to_base58(),
                row.origin_page,
                row.assets,
                tokens
            );
            if tokens > 0 {
                let r = nmeme_core::Reserves::new(row.assets, tokens);
                let (hi, lo) = r.product();
                println!("SPOT-E9\t{}\tK\t{hi}:{lo}", (row.assets as u128 * 1_000_000_000) / tokens as u128);
            }
            n += 1;
        }
        eprintln!("# pool: {n} note(s) at the pool lock");
        Ok(ExitCode::SUCCESS)
    })
}

fn index_pool_params(args: &[String]) -> Result<nmeme_core::PoolParams, String> {
    let token = flag(args, "--token").ok_or("missing --token")?;
    let fee = flag(args, "--fee-bps").ok_or("missing --fee-bps")?;
    let lore = flag(args, "--lore-bps").ok_or("missing --lore-bps")?;
    let lore_lock = flag(args, "--lore-lock").ok_or("missing --lore-lock")?;
    nmeme_core::PoolParams::new(
        TokenId(Hash::from_base58(token).map_err(|e| format!("token: {e}"))?),
        fee.parse::<u64>().map_err(|e| format!("fee-bps: {e}"))?,
        lore.parse::<u64>().map_err(|e| format!("lore-bps: {e}"))?,
        Hash::from_base58(lore_lock).map_err(|e| format!("lore-lock: {e}"))?,
    )
    .map_err(|e| e.to_string())
}

/// The pool's token in a note's data: a transfer claim of exactly that
/// token, or nothing (the covenant reads it the same way).
fn pool_tokens(params: &nmeme_core::PoolParams, data: &[(String, Vec<u8>)]) -> u64 {
    for (key, blob) in data {
        if key != nmeme_core::claim::NOTE_DATA_KEY {
            continue;
        }
        return match nmeme_index::decode_claim(blob) {
            Ok(Claim::Transfer { token, amount }) if token == params.token => amount,
            _ => 0,
        };
    }
    0
}

/// `pool-replay --token <b58> --fee-bps N --open <txid>:<tx.jam> --step <txid>:<tx.jam>...`
///
/// Replays the pool's history from the transaction files, exactly as the
/// covenant reads them: the opening transaction's seeds at the pool lock
/// set the reserves; every later transaction that spends the pool note
/// must leave a successor satisfying the invariant, and the sums say what
/// each trade did. Prints one `TRADE` line per step with the NOCK and token
/// deltas, the fee retained, and the constant product before and after,
/// then the final `STATE`. Compare it with `pool` on the live node.
fn cmd_pool_replay(args: &[String]) -> Result<ExitCode, String> {
    let params = index_pool_params(args)?;
    let root = params.lock_root().map_err(|e| format!("{e:?}"))?;
    let first = nmeme_index::first_name_of(&root);
    let open = flag(args, "--open").ok_or("missing --open")?;
    let (open_id, open_path) = open.split_once(':').ok_or("--open expects <txid>:<file>")?;
    let open_spends = load_spends(open_path)?;
    let (x0, y0) = seeds_at_pool(&params, &root, &open_spends)?;
    if open_spends.0.iter().any(|(n, _)| n.first == first) {
        return Err("the opening transaction spends a pool note; it must only create one".to_string());
    }
    println!("OPEN\t{open_id}\t{x0}\t{y0}");
    let mut state = nmeme_core::Reserves::new(x0, y0);
    let mut fees_nock: u64 = 0;
    let mut fees_tokens: u64 = 0;
    let mut lore_total: u64 = 0;
    let lore_first = params.lore_first_name();
    for step in flags(args, "--step") {
        let (id, path) = step.split_once(':').ok_or("--step expects <txid>:<file>")?;
        let spends = load_spends(path)?;
        let pool_inputs: Vec<&Name> = spends.0.iter().map(|(n, _)| n).filter(|n| n.first == first).collect();
        if pool_inputs.is_empty() {
            return Err(format!("{id}: spends no note at the pool lock"));
        }
        if pool_inputs.len() != 1 {
            return Err(format!("{id}: spends {} notes at the pool lock; this replay tracks one", pool_inputs.len()));
        }
        for (n, sp) in &spends.0 {
            if n.first != first {
                continue;
            }
            let Spend::Witness(s1) = sp else { return Err(format!("{id}: legacy spend of the pool note")) };
            if s1.fee.0 != 0 {
                println!("VIOLATION\t{id}\tpool spend pays a miner fee of {}", s1.fee.0);
            }
        }
        let (x1, y1) = seeds_at_pool(&params, &root, &spends)?;
        let after = nmeme_core::Reserves::new(x1, y1);
        let ok = nmeme_core::pool::invariant_holds(state, after, params.fee_bps);
        // the treasury: what crossed the boundary, what it was owed, what it got
        let (gin, gout, lore_got, lore_tokens) = boundary(&params, &first, &lore_first, &spends);
        // the floor by direction, as the covenant computes it: a sell's
        // base includes the treasury's own payment (the gross proceeds)
        let lore_side = if x1 < state.nock { nmeme_core::Side::Sell } else { nmeme_core::Side::Buy };
        let lore_due = nmeme_core::pool::lore_due(&params, lore_side, gin, gout, lore_got);
        let lore_ok = lore_got >= lore_due && lore_tokens == 0;
        lore_total += lore_got;
        println!(
            "LORE\t{id}\tnock_in={gin}\tnock_out={gout}\tdue_floor={lore_due}\tpaid={lore_got}\ttokens_to_lore={lore_tokens}\t{}",
            if lore_ok { "ok" } else { "VIOLATED" }
        );
        let (side, dn, dt) = if x1 >= state.nock {
            ("buy", x1 - state.nock, state.tokens.saturating_sub(y1))
        } else {
            ("sell", state.nock - x1, y1.saturating_sub(state.tokens))
        };
        let fee_retained = match side {
            "buy" => (dn as u128 * params.fee_bps as u128 / 10_000) as u64,
            _ => (dt as u128 * params.fee_bps as u128 / 10_000) as u64,
        };
        match side {
            "buy" => fees_nock += fee_retained,
            _ => fees_tokens += fee_retained,
        }
        let (kb_hi, kb_lo) = state.product();
        let (ka_hi, ka_lo) = after.product();
        println!(
            "TRADE\t{id}\t{side}\tnock_delta={}{dn}\ttoken_delta={}{dt}\tfee_retained={fee_retained}\tk_before={kb_hi}:{kb_lo}\tk_after={ka_hi}:{ka_lo}\tinvariant={}",
            if side == "buy" { "+" } else { "-" },
            if side == "buy" { "-" } else { "+" },
            if ok { "holds" } else { "VIOLATED" }
        );
        if !ok || !lore_ok {
            return Err(format!("{id}: the transaction violates the covenant; the chain would not have mined it"));
        }
        state = after;
    }
    let (k_hi, k_lo) = state.product();
    println!("STATE\t{}\t{}\tK\t{k_hi}:{k_lo}\tfees_retained_nock={fees_nock}\tfees_retained_tokens={fees_tokens}\tlore_paid_total={lore_total}", state.nock, state.tokens);
    Ok(ExitCode::SUCCESS)
}

/// NOCK crossing the pool boundary in a transaction, the way the covenant
/// counts it: paid to the pool lock by spends of other notes; paid by
/// spends of pool notes to anyone but the pool and the treasury; and what
/// the treasury's output holds (nicks, and any tokens it should not).
fn boundary(params: &nmeme_core::PoolParams, first: &Hash, lore_first: &Hash, spends: &nockchain_types::tx_engine::v1::tx::Spends) -> (u64, u64, u64, u64) {
    let (mut gin, mut gout, mut lore_got, mut lore_tokens) = (0u64, 0u64, 0u64, 0u64);
    for (name, sp) in &spends.0 {
        let Spend::Witness(s1) = sp else { continue };
        let from_pool = &name.first == first;
        for seed in &s1.seeds.0 {
            let f = nmeme_index::first_name_of(&seed.lock_root);
            if !from_pool && &f == first {
                gin += seed.gift.0 as u64;
            }
            if from_pool && &f != first && &f != lore_first {
                gout += seed.gift.0 as u64;
            }
            if &f == lore_first {
                lore_got += seed.gift.0 as u64;
                for entry in seed.note_data.iter() {
                    if entry.key == nmeme_core::claim::NOTE_DATA_KEY {
                        if let Ok(Claim::Transfer { token, amount }) = nmeme_index::decode_claim(&entry.value.raw_blob()) {
                            if token == params.token {
                                lore_tokens += amount;
                            }
                        }
                    }
                }
            }
        }
    }
    (gin, gout, lore_got, lore_tokens)
}

fn load_spends(path: &str) -> Result<nockchain_types::tx_engine::v1::tx::Spends, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let root = slab.cue_into(bytes.into()).map_err(|e| format!("cue {path}: {e}"))?;
    let space = slab.noun_space();
    let parsed = ParsedTransaction::from_noun(root.in_space(&space)).map_err(|e| format!("decode {path}: {e}"))?;
    parsed.spliced().map_err(|e| format!("splice {path}: {e}"))
}

/// What lands at the pool lock: the merged gift and the one claim, read
/// the way consensus merges seeds (`build-outputs`): note-data maps are
/// unioned, so two claim-bearing seeds would be a malformed trade.
fn seeds_at_pool(params: &nmeme_core::PoolParams, root: &Hash, spends: &nockchain_types::tx_engine::v1::tx::Spends) -> Result<(u64, u64), String> {
    let mut nock: u64 = 0;
    let mut tokens: Option<u64> = None;
    for (_, sp) in &spends.0 {
        let Spend::Witness(s1) = sp else { continue };
        for seed in &s1.seeds.0 {
            if &seed.lock_root != root {
                continue;
            }
            nock = nock.checked_add(seed.gift.0 as u64).ok_or("gift overflow")?;
            for entry in seed.note_data.iter() {
                if entry.key != nmeme_core::claim::NOTE_DATA_KEY {
                    continue;
                }
                let amount = match nmeme_index::decode_claim(&entry.value.raw_blob()) {
                    Ok(Claim::Transfer { token, amount }) if token == params.token => amount,
                    _ => 0,
                };
                if tokens.is_some() {
                    return Err("two seeds to the pool lock carry a claim; consensus would keep only one".to_string());
                }
                tokens = Some(amount);
            }
        }
    }
    Ok((nock, tokens.unwrap_or(0)))
}

async fn read_snapshot_firsts(
    client: &mut NockchainServiceClient<tonic::transport::Channel>,
    firsts: &[Hash],
) -> Result<nmeme_index::Snapshot, String> {
    // The node's per-page caches refresh on their own schedule: over a
    // long chain a page can sit a block or two behind its neighbour for
    // longer than a block interval (seen live at 1,300+ blocks: 12 tries
    // two seconds apart never agreed). Wait out several block intervals.
    const ATTEMPTS: usize = 60;
    let mut last_err = String::new();
    for attempt in 1..=ATTEMPTS {
        match read_snapshot_firsts_once(client, firsts).await {
            Ok(snap) => return Ok(snap),
            Err(e) if e.contains("pages disagree") => {
                eprintln!("# snapshot attempt {attempt}/{ATTEMPTS}: {e}; retrying");
                last_err = e;
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
            Err(e) => return Err(e),
        }
    }
    Err(format!("no consistent snapshot in {ATTEMPTS} attempts: {last_err}"))
}

async fn read_snapshot_firsts_once(
    client: &mut NockchainServiceClient<tonic::transport::Channel>,
    firsts: &[Hash],
) -> Result<nmeme_index::Snapshot, String> {
    let mut all_pages: Vec<nmeme_index::Page> = Vec::new();
    for first in firsts {
        let address = first.to_base58();
        // collect_pages is synchronous over a closure; fetch each page here.
        let mut token = String::new();
        let mut pages_for_address = Vec::new();
        loop {
            let request = WalletGetBalanceRequest {
                selector: Some(wallet_get_balance_request::Selector::FirstName(
                    nockapp_grpc_proto::pb::common::v1::Base58Hash { hash: address.clone() },
                )),
                page: Some(nockapp_grpc_proto::pb::common::v1::PageRequest {
                    client_page_items_limit: 0,
                    page_token: token.clone(),
                    max_bytes: 0,
                }),
            };
            let response = client
                .wallet_get_balance(request)
                .await
                .map_err(|e| format!("wallet_get_balance({address}): {e}"))?
                .into_inner();
            let balance = match response.result {
                Some(wallet_get_balance_response::Result::Balance(b)) => b,
                Some(wallet_get_balance_response::Result::Error(err)) => {
                    return Err(format!("wallet_get_balance({address}): {}", err.message))
                }
                None => return Err("wallet_get_balance returned no result".to_string()),
            };
            let mut notes = Vec::new();
            for entry in &balance.notes {
                notes.push(nmeme_index::note_from_entry(entry, &address)?);
            }
            let next = balance.page.as_ref().map(|p| p.next_page_token.clone()).unwrap_or_default();
            pages_for_address.push(nmeme_index::Page {
                height: balance.height.as_ref().map(|h| h.value),
                block_id: balance.block_id.as_ref().map(|b| decode_hash(b).map(|h| h.to_base58())).transpose()?,
                notes,
                next_page_token: next.clone(),
            });
            if next.is_empty() { break; }
            if next == token { return Err("node repeated a page token".to_string()); }
            if pages_for_address.len() >= nmeme_index::MAX_PAGES { return Err("too many pages".to_string()); }
            token = next;
        }
        all_pages.extend(pages_for_address);
    }
    nmeme_index::fold_pages(&all_pages)
}

fn decode_hash(hash: &nockapp_grpc_proto::pb::common::v1::Hash) -> Result<Hash, String> {
    nmeme_index::decode_pb_hash(hash)
}
