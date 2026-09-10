//! `nmeme-index` — token identity, and balances read back from a node.
//!
//! ```text
//! nmeme-index token-id --tx <tx.jam> --ticker <T> --decimals <D>
//! nmeme-index rebuild  --addr <host:port> --token <token-b58> --address <addr>...
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

use std::collections::BTreeMap;
use std::process::ExitCode;

use nmeme_core::indexer::{NoteView, TxView};
use nmeme_core::{Indexer, Ticker, TokenId};
use nmeme_tx::txfile::ParsedTransaction;
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockapp_grpc_proto::pb::common::v2::note::NoteVersion;
use nockapp_grpc_proto::pb::public::v2::nockchain_block_service_client::NockchainBlockServiceClient;
use nockapp_grpc_proto::pb::public::v2::nockchain_service_client::NockchainServiceClient;
use nockapp_grpc_proto::pb::public::v2::{get_transaction_details_response, GetTransactionDetailsRequest};
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
  nmeme-index token-note --addr <host:port> --address <addr> --lock <lock-root-b58>
  nmeme-index rebuild  --addr <host:port> --token <token-b58>
                       --step <txid>:<tx.jam> [--step ...]   (canonical order)
                       --address <addr> [--address ...]
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
    let address = flag(args, "--address").ok_or("missing --address")?.to_string();
    let lock = Hash::from_base58(flag(args, "--lock").ok_or("missing --lock")?)
        .map_err(|e| format!("lock: {e}"))?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(async move {
        let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
            .await
            .map_err(|e| format!("connect {addr}: {e}"))?;
        let want_first = nmeme_index::first_name_of(&lock);
        let snapshot = read_snapshot(&mut client, &[address.clone()]).await?;
        println!("# snapshot height {} block {}", snapshot.height, snapshot.block_id);

        let mut found = Vec::new();
        for (name, _owner, data) in &snapshot.notes {
            if name.first != want_first {
                continue;
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

    let addresses: Vec<String> = flags(args, "--address").into_iter().map(str::to_string).collect();
    if addresses.is_empty() {
        return Err("at least one --address is required".to_string());
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
    runtime.block_on(rebuild(addr, token, steps, addresses, expectations, expect_total))
}

#[allow(clippy::too_many_arguments)]
async fn rebuild(
    addr: String,
    token: TokenId,
    steps: Vec<(String, std::path::PathBuf)>,
    addresses: Vec<String>,
    expectations: Vec<(String, u64)>,
    expect_total: Option<u64>,
) -> Result<ExitCode, String> {
    let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
        .await
        .map_err(|e| format!("connect {addr}: {e}"))?;

    // 1. One canonical snapshot: every address, every page, one block.
    let snapshot = read_snapshot(&mut client, &addresses).await?;
    let unspent: Vec<(Name, String)> = snapshot.notes.iter().map(|(n, a, _)| (n.clone(), a.clone())).collect();
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
    for (i, (txid, plan)) in plans.iter().enumerate() {
        let mut candidates: Vec<Name> = Vec::new();
        for (_, later) in plans.iter().skip(i + 1) {
            candidates.extend(later.inputs.iter().cloned());
        }
        candidates.extend(unspent.iter().map(|(n, _)| n.clone()));

        // Bind the local file to the mined transaction before trusting it.
        let (height, block) = verify_canonical(&addr, txid, plan).await?;
        if height > snapshot.height {
            return Err(format!(
                "{txid} is at height {height}, beyond the snapshot at {}; the reads are not of one chain state",
                snapshot.height
            ));
        }
        println!("CANONICAL\t{txid}\theight={height}\tblock={block}");

        let paired = nmeme_index::bind_outputs(&plan.destinations, &candidates, &mut taken)?;
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
    for (lock_bytes, amount) in &balances {
        let bytes: [u8; 32] = lock_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "lock-root key is not 32 bytes".to_string())?;
        let lock = Hash::from_be_bytes(&bytes);
        by_lock.insert(lock.to_base58(), *amount);
        total = total.saturating_add(*amount);
        println!("BALANCE\t{}\t{}", lock.to_base58(), amount);
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

/// Checks that a transaction file describes the transaction the chain mined
/// under `txid`: same inputs, same outputs, same amounts, and that it sits in
/// a block. Returns (height, block id).
///
/// The details RPC exposes only first-names, so this binds the *shape* of the
/// transaction — every input lock, every output lock and its merged amount —
/// not the last-names. Those are bound separately by `bind_outputs`, which
/// requires the computed full name to exist on chain. Together the two leave
/// no field of the replayed transaction unchecked against canonical data.
async fn verify_canonical(
    addr: &str,
    txid: &str,
    plan: &nmeme_index::TxPlan,
) -> Result<(u64, String), String> {
    let mut client = NockchainBlockServiceClient::connect(format!("http://{addr}"))
        .await
        .map_err(|e| format!("connect block service {addr}: {e}"))?;
    let request = GetTransactionDetailsRequest {
        tx_id: Some(nockapp_grpc_proto::pb::common::v1::Base58Hash { hash: txid.to_string() }),
    };
    let response = client
        .get_transaction_details(request)
        .await
        .map_err(|e| format!("get_transaction_details({txid}): {e}"))?
        .into_inner();
    let details = match response.result {
        Some(get_transaction_details_response::Result::Details(d)) => d,
        Some(get_transaction_details_response::Result::Pending(_)) => {
            return Err(format!("{txid} is still pending; not canonical"))
        }
        Some(get_transaction_details_response::Result::Error(e)) => {
            return Err(format!("get_transaction_details: {}", e.message))
        }
        None => return Err("get_transaction_details returned nothing".to_string()),
    };
    if details.tx_id != txid {
        return Err(format!("chain returned tx {} for {txid}", details.tx_id));
    }
    let block = details
        .block_id
        .as_ref()
        .map(|b| decode_hash(b).map(|h| h.to_base58()))
        .transpose()?
        .ok_or_else(|| format!("{txid} has no block id; not mined"))?;
    if details.height == 0 && details.block_id.is_none() {
        return Err(format!("{txid} reports no height"));
    }

    // Inputs: every spend name in the file must be an input on chain, by
    // first-name, and the counts must agree.
    let chain_inputs: Vec<String> = details.inputs.iter().map(|i| i.note_name_b58.clone()).collect();
    if chain_inputs.len() != plan.inputs.len() {
        return Err(format!(
            "{txid}: file has {} input(s), chain has {}",
            plan.inputs.len(),
            chain_inputs.len()
        ));
    }
    for input in &plan.inputs {
        let f = input.first.to_base58();
        if !chain_inputs.contains(&f) {
            return Err(format!("{txid}: file input {f} is not an input of the mined transaction"));
        }
    }

    // Outputs: every destination must appear on chain with the same
    // first-name and the same merged amount, one-to-one.
    let mut chain_outputs: Vec<(String, u64)> = details
        .outputs
        .iter()
        .map(|o| {
            let amount = match &o.amount_required {
                Some(nockapp_grpc_proto::pb::public::v2::transaction_output::AmountRequired::Amount(n)) => n.value,
                None => 0,
            };
            (o.note_name_b58.clone(), amount)
        })
        .collect();
    if chain_outputs.len() != plan.destinations.len() {
        return Err(format!(
            "{txid}: file has {} output(s), chain has {}",
            plan.destinations.len(),
            chain_outputs.len()
        ));
    }
    for dest in &plan.destinations {
        let f = dest.name.first.to_base58();
        let pos = chain_outputs
            .iter()
            .position(|(name, amount)| *name == f && *amount == dest.gift)
            .ok_or_else(|| {
                format!(
                    "{txid}: no mined output pays {} to first-name {} (lock-root {})",
                    dest.gift,
                    f,
                    dest.lock_root.to_base58()
                )
            })?;
        chain_outputs.remove(pos);
    }
    Ok((details.height, block))
}

/// Reads every unspent note for every address, following pagination to the
/// end for each, and folds the pages into one snapshot — refusing if any page
/// reports a different block than the first.
async fn read_snapshot(
    client: &mut NockchainServiceClient<tonic::transport::Channel>,
    addresses: &[String],
) -> Result<nmeme_index::Snapshot, String> {
    let mut all_pages: Vec<nmeme_index::Page> = Vec::new();
    for address in addresses {
        // collect_pages is synchronous over a closure; fetch each page here.
        let mut token = String::new();
        let mut pages_for_address = Vec::new();
        loop {
            let request = WalletGetBalanceRequest {
                selector: Some(wallet_get_balance_request::Selector::Address(
                    nockapp_grpc_proto::pb::common::v1::Base58Pubkey { key: address.clone() },
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
                notes.push((name, address.clone(), data));
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
