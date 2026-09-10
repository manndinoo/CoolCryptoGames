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
use nockapp_grpc_proto::pb::public::v2::nockchain_service_client::NockchainServiceClient;
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
        let want_first = nmeme_index::first_name_of(&lock)?;
        let request = WalletGetBalanceRequest {
            selector: Some(wallet_get_balance_request::Selector::Address(
                nockapp_grpc_proto::pb::common::v1::Base58Pubkey { key: address.clone() },
            )),
            page: None,
        };
        let response = client
            .wallet_get_balance(request)
            .await
            .map_err(|e| format!("wallet_get_balance: {e}"))?
            .into_inner();
        let balance = match response.result {
            Some(wallet_get_balance_response::Result::Balance(b)) => b,
            Some(wallet_get_balance_response::Result::Error(err)) => {
                return Err(format!("wallet_get_balance: {}", err.message))
            }
            None => return Err("wallet_get_balance returned no result".to_string()),
        };

        let mut found = Vec::new();
        for entry in &balance.notes {
            let Some(name) = entry.name.as_ref() else { continue };
            let name = decode_name(name)?;
            if name.first != want_first {
                continue;
            }
            let Some(note) = entry.note.as_ref() else { continue };
            let Some(NoteVersion::V1(v1)) = note.note_version.as_ref() else { continue };
            let Some(nd) = v1.note_data.as_ref() else { continue };
            for data in &nd.entries {
                if data.key != nmeme_core::NOTE_DATA_KEY {
                    continue;
                }
                let claim = nmeme_index::decode_claim(&data.blob)
                    .map_err(|e| format!("claim on note: {e}"))?;
                let assets = v1.assets.as_ref().map(|a| a.value).unwrap_or(0);
                found.push((name.clone(), assets, claim.amount()));
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

    // 1. The canonical unspent note set, with full names and note-data.
    let mut unspent: Vec<(Name, String)> = Vec::new();
    let mut height_seen: Option<u64> = None;
    for address in &addresses {
        let request = WalletGetBalanceRequest {
            selector: Some(wallet_get_balance_request::Selector::Address(
                nockapp_grpc_proto::pb::common::v1::Base58Pubkey { key: address.clone() },
            )),
            page: None,
        };
        let response = client
            .wallet_get_balance(request)
            .await
            .map_err(|e| format!("wallet_get_balance({address}): {e}"))?
            .into_inner();
        let balance = match response.result {
            Some(wallet_get_balance_response::Result::Balance(b)) => b,
            Some(wallet_get_balance_response::Result::Error(err)) => {
                return Err(format!("wallet_get_balance: {}", err.message))
            }
            None => return Err("wallet_get_balance returned no result".to_string()),
        };
        if let Some(h) = balance.height.as_ref() {
            height_seen = Some(h.value);
        }
        for entry in &balance.notes {
            let Some(name) = entry.name.as_ref() else { continue };
            let name = decode_name(name)?;
            unspent.push((name, address.clone()));
        }
    }
    println!("# canonical note set: {} unspent note(s)", unspent.len());
    if let Some(h) = height_seen {
        println!("HEIGHT\t{h}");
    }

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

        let paired = nmeme_index::assign_outputs(&plan.destinations, &candidates, &mut taken)?;
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
