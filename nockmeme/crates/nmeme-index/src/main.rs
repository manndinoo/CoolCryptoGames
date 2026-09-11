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
use nockapp_grpc_proto::pb::common::v2::note::NoteVersion;
use nockapp_grpc_proto::pb::public::v2::nockchain_block_service_client::NockchainBlockServiceClient;
use nockapp_grpc_proto::pb::public::v2::nockchain_service_client::NockchainServiceClient;
use nockapp_grpc_proto::pb::public::v2::{get_transaction_block_response, GetTransactionBlockRequest};
use nockapp_grpc_proto::pb::public::v2::{
    wallet_get_balance_request, wallet_get_balance_response, WalletGetBalanceRequest,
};
use nockchain_types::tx_engine::common::{Hash, Name};
use nockvm::noun::NounAllocator;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("token-id") => cmd_token_id(&args),
        Some("token-note") => cmd_token_note(&args),
        Some("funding") => cmd_funding(&args),
        Some("outputs") => cmd_outputs(&args),
        Some("check-inputs") => cmd_check_inputs(&args),
        Some("rebuild") => cmd_rebuild(&args),
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
  nmeme-index token-note --addr <host:port> --lock <lock-root-b58> [--name \"<first> <last>\"]
  nmeme-index funding  --addr <host:port> [--lock <lock-root-b58>]... [--first <first-name-b58>]...
                       (every unspent note there: FUNDING <first> <last> tokenfree|claim <nicks>)
  nmeme-index outputs  --tx <tx.jam>      (INPUT <first> <last>; OUTPUT <lock> <first> <last> <claim>)
  nmeme-index check-inputs --tx <tx.jam> --funding <funding.txt> [--token-note \"<first> <last>\"]...
                       (every input must be proven token-free, or be a named token note)
  nmeme-index rebuild  --addr <host:port> --token <token-b58>
                       --step <txid>:<tx.jam> [--step ...]   (canonical order)
                       --funding <funding.txt> [--funding ...] (provenance of inputs)
                       --lock <lock-root-b58> [--lock ...]
                       [--expect <lock-root-b58>=<amount>]... [--expect-total <n>]";

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
        for (name, _owner, data, _assets) in &snapshot.notes {
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
                let claim = nmeme_index::decode_claim(blob).map_err(|e| format!("claim on note: {e}"))?;
                found.push((name.clone(), 0u64, claim.amount()));
            }
        }

        match found.as_slice() {
            [] => Err(format!("no token-bearing note at lock-root {}", lock.to_base58())),
            [(name, assets, amount)] => {
                println!(
                    "NOTE\t[{} {}]\t{}\t{}",
                    name.first.to_base58(),
                    name.last.to_base58(),
                    assets,
                    amount
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
    let mut token_free: BTreeSet<Vec<u8>> = BTreeSet::new();
    for path in flags(args, "--funding") {
        let text = std::fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?;
        for (name, free) in nmeme_index::parse_funding(&text)? {
            if free {
                token_free.insert(nmeme_index::name_key(&name));
            }
        }
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
    runtime.block_on(rebuild(addr, token, steps, addresses, expectations, expect_total, token_free))
}

#[allow(clippy::too_many_arguments)]
async fn rebuild(
    addr: String,
    token: TokenId,
    steps: Vec<(String, std::path::PathBuf)>,
    addresses: Vec<Hash>,
    expectations: Vec<(String, u64)>,
    expect_total: Option<u64>,
    token_free: BTreeSet<Vec<u8>>,
) -> Result<ExitCode, String> {
    let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
        .await
        .map_err(|e| format!("connect {addr}: {e}"))?;

    // 1. One canonical snapshot: every address, every page, one block.
    let snapshot = read_snapshot(&mut client, &addresses).await?;
    let unspent: Vec<(Name, String)> = snapshot.notes.iter().map(|(n, a, _, _)| (n.clone(), a.clone())).collect();
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
        nmeme_index::require_provenance(txid, &plan.inputs, &known_outputs, &token_free)?;
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

        let paired = nmeme_index::bind_outputs(&plan.destinations, &candidates, &mut taken)?;
        for (name, _) in &paired {
            known_outputs.insert(nmeme_index::name_key(name));
        }
        let outputs: Vec<NoteView> = paired
            .into_iter()
            .map(|(name, dest)| NoteView {
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
    // Coinbase notes do not sit at the wallet's change lock-root: a miner is
    // paid at a lock built from its mining pkh, and the wallet's change goes
    // to its own p2pkh lock-root. So funding may be asked for by lock-root
    // (`--lock`, first-name derived) or directly by first-name (`--first`,
    // e.g. taken from the inputs a wallet-built probe transaction chose).
    let mut firsts: Vec<Hash> = Vec::new();
    for l in flags(args, "--lock") {
        let lock = Hash::from_base58(l).map_err(|e| format!("lock {l}: {e}"))?;
        firsts.push(nmeme_index::first_name_of(&lock));
    }
    for f in flags(args, "--first") {
        firsts.push(Hash::from_base58(f).map_err(|e| format!("first {f}: {e}"))?);
    }
    if firsts.is_empty() {
        return Err("funding: give at least one --lock or --first".to_string());
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(async move {
        let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let snapshot = read_snapshot_firsts(&mut client, &firsts).await?;
        for line in nmeme_index::funding_lines(&snapshot) {
            println!("{line}");
        }
        Ok(ExitCode::SUCCESS)
    })
}

/// The outputs a transaction file will produce: lock-root, complete computed
/// note name, and claim. Lets a caller name the genesis output it means to
/// spend later, rather than picking "a token note at that lock".
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

/// Pre-broadcast gate: every input of the transaction must be proven
/// token-free by a FUNDING file, or be one of the token notes the caller
/// explicitly means to move. Anything else is the wallet spending a token
/// note as ordinary funds, which burns it (SPEC §7) — refuse before sending.
fn cmd_check_inputs(args: &[String]) -> Result<ExitCode, String> {
    let path = std::path::PathBuf::from(flag(args, "--tx").ok_or("missing --tx")?);
    let plan = nmeme_index::read_tx_plan(&path)?;
    let mut token_free: BTreeSet<Vec<u8>> = BTreeSet::new();
    let mut claimed: BTreeSet<Vec<u8>> = BTreeSet::new();
    let funding = flags(args, "--funding");
    if funding.is_empty() {
        return Err("at least one --funding file is required".to_string());
    }
    for f in funding {
        let text = std::fs::read_to_string(f).map_err(|e| format!("read {f}: {e}"))?;
        for (name, free) in nmeme_index::parse_funding(&text)? {
            let key = nmeme_index::name_key(&name);
            if free { token_free.insert(key); } else { claimed.insert(key); }
        }
    }
    let allowed_token_notes: Vec<Name> = flags(args, "--token-note")
        .into_iter()
        .map(parse_name)
        .collect::<Result<_, _>>()?;
    let mut failures = 0usize;
    for input in &plan.inputs {
        let key = nmeme_index::name_key(input);
        let label = format!("[{} {}]", input.first.to_base58(), input.last.to_base58());
        if token_free.contains(&key) {
            println!("INPUT-OK\t{label}\ttokenfree");
        } else if allowed_token_notes.iter().any(|n| nmeme_index::name_key(n) == key) {
            println!("INPUT-OK\t{label}\tnamed token note");
        } else if claimed.contains(&key) {
            println!("INPUT-REFUSED\t{label}\tcarries a claim and was not named: spending it here would burn it");
            failures += 1;
        } else {
            println!("INPUT-REFUSED\t{label}\tnot in any FUNDING file: token status unknown");
            failures += 1;
        }
    }
    if failures > 0 {
        return Err(format!("{failures} input(s) refused"));
    }
    println!("INPUTS\t{} verified", plan.inputs.len());
    Ok(ExitCode::SUCCESS)
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

async fn read_snapshot_firsts(
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
                let Some(name) = entry.name.as_ref() else { continue };
                let name = decode_name(name)?;
                let mut data = Vec::new();
                if let Some(note) = entry.note.as_ref() {
                    if let Some(NoteVersion::V1(v1)) = note.note_version.as_ref() {
                        if let Some(nd) = v1.note_data.as_ref() {
                            for e in &nd.entries {
                                data.push((e.key.clone(), e.blob.clone()));
                            }
                        }
                    }
                }
                let assets = entry
                    .note
                    .as_ref()
                    .and_then(|n| match n.note_version.as_ref() {
                        Some(NoteVersion::V1(v1)) => v1.assets.as_ref().map(|a| a.value),
                        _ => None,
                    })
                    .unwrap_or(0);
                notes.push((name, address.clone(), data, assets));
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

fn decode_name(name: &nockapp_grpc_proto::pb::common::v1::Name) -> Result<Name, String> {
    let first = name.first.as_ref().ok_or("name has no first")?;
    let last = name.last.as_ref().ok_or("name has no last")?;
    Ok(Name::new(decode_hash(first)?, decode_hash(last)?))
}

/// The proto carries a tip5 hash as five field elements.
fn decode_hash(hash: &nockapp_grpc_proto::pb::common::v1::Hash) -> Result<Hash, String> {
    let limb = |b: &Option<nockapp_grpc_proto::pb::common::v1::Belt>, which: &str| -> Result<u64, String> {
        b.as_ref().map(|b| b.value).ok_or_else(|| format!("hash missing {which}"))
    };
    Ok(Hash::from_limbs(&[
        limb(&hash.belt_1, "belt_1")?,
        limb(&hash.belt_2, "belt_2")?,
        limb(&hash.belt_3, "belt_3")?,
        limb(&hash.belt_4, "belt_4")?,
        limb(&hash.belt_5, "belt_5")?,
    ]))
}
