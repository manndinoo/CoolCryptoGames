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
//! `rebuild` reads the node's canonical unspent-note set over the public gRPC
//! service and decodes each note's `meme` entry.
//!
//! Be precise about what that is and is not. It reconstructs balances from
//! **canonical chain state at a stated height and block id** — not by replaying
//! history from genesis. It is therefore a check that the chain agrees with the
//! expected split, not an independent re-derivation of it. SPEC §8's replay
//! rebuild needs full transaction history including note-data, which the
//! summary `TransactionDetails` RPC does not carry.

use std::collections::BTreeMap;
use std::process::ExitCode;

use nmeme_core::{Claim, Ticker, TokenId};
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
  nmeme-index rebuild  --addr <host:port> --token <token-b58> --address <addr> [--address <addr>...]";

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

fn cmd_rebuild(args: &[String]) -> Result<ExitCode, String> {
    let addr = flag(args, "--addr").ok_or("missing --addr")?.to_string();
    let token_b58 = flag(args, "--token").ok_or("missing --token")?;
    let token = TokenId(Hash::from_base58(token_b58).map_err(|e| format!("token: {e}"))?);
    let addresses: Vec<String> = flags(args, "--address")
        .into_iter()
        .map(str::to_string)
        .collect();
    if addresses.is_empty() {
        return Err("at least one --address is required".to_string());
    }

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio: {e}"))?;
    runtime.block_on(rebuild(addr, token, addresses))
}

async fn rebuild(
    addr: String,
    token: TokenId,
    addresses: Vec<String>,
) -> Result<ExitCode, String> {
    let mut client = NockchainServiceClient::connect(format!("http://{addr}"))
        .await
        .map_err(|e| format!("connect {addr}: {e}"))?;

    let mut balances: BTreeMap<String, u64> = BTreeMap::new();
    let mut total: u64 = 0;
    let mut notes_seen = 0usize;
    let mut height_seen: Option<u64> = None;
    let mut block_seen: Option<String> = None;

    for address in &addresses {
        let request = WalletGetBalanceRequest {
            selector: Some(wallet_get_balance_request::Selector::Address(
                nockapp_grpc_proto::pb::common::v1::Base58Pubkey {
                    key: address.clone(),
                },
            )),
            page: None,
        };
        let response = client
            .wallet_get_balance(request)
            .await
            .map_err(|e| format!("wallet_get_balance({address}): {e}"))?
            .into_inner();

        let balance = match response.result {
            Some(wallet_get_balance_response::Result::Balance(balance)) => balance,
            Some(wallet_get_balance_response::Result::Error(err)) => {
                return Err(format!("wallet_get_balance error: {}", err.message))
            }
            None => return Err("wallet_get_balance returned no result".to_string()),
        };

        if let Some(h) = balance.height.as_ref() {
            height_seen = Some(h.value);
        }
        if let Some(b) = balance.block_id.as_ref() {
            block_seen = Some(format!("{:?}", b));
        }

        let mut owner_total: u64 = 0;
        for entry in &balance.notes {
            let Some(note) = entry.note.as_ref() else { continue };
            let Some(NoteVersion::V1(v1)) = note.note_version.as_ref() else {
                continue; // legacy v0 notes cannot carry note-data
            };
            let Some(note_data) = v1.note_data.as_ref() else { continue };
            for data_entry in &note_data.entries {
                if data_entry.key != nmeme_core::NOTE_DATA_KEY {
                    continue;
                }
                notes_seen += 1;
                match decode_claim(&data_entry.blob) {
                    Ok(claim) => {
                        let claim_token = match &claim {
                            Claim::Transfer { token, .. } => Some(token.clone()),
                            // A genesis claim's identity is not carried in the
                            // payload; it is derived from the creating
                            // transaction's inputs, so it cannot be matched here.
                            Claim::Genesis { .. } => None,
                        };
                        let matches = claim_token.as_ref() == Some(&token) || claim_token.is_none();
                        if matches {
                            owner_total = owner_total.saturating_add(claim.amount());
                        }
                    }
                    Err(err) => {
                        // A note whose payload does not decode carries no token
                        // weight (SPEC §7). Reported, not silently skipped.
                        println!("UNDECODABLE\t{address}\t{err}");
                    }
                }
            }
        }
        balances.insert(address.clone(), owner_total);
        total = total.saturating_add(owner_total);
    }

    println!("# balances rebuilt from the node's canonical note set");
    println!("# NOT a replay from genesis — see the module docs");
    if let Some(height) = height_seen {
        println!("HEIGHT\t{height}");
    }
    if let Some(block) = block_seen {
        println!("BLOCK\t{block}");
    }
    println!("TOKEN\t{}", token.to_base58());
    for (address, amount) in &balances {
        println!("BALANCE\t{address}\t{amount}");
    }
    println!("TOTAL\t{total}");
    println!("NOTES\t{notes_seen}");
    Ok(ExitCode::SUCCESS)
}

fn decode_claim(blob: &[u8]) -> Result<Claim, String> {
    use nockchain_math::owned_based_noun::OwnedBasedNoun;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab
        .cue_into(bytes::Bytes::copy_from_slice(blob))
        .map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let owned = OwnedBasedNoun::from_noun(noun, &space).map_err(|e| format!("based: {e}"))?;
    Claim::from_noun(&owned).map_err(|e| format!("claim: {e}"))
}
