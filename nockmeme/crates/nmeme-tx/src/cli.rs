//! Subcommands.
//!
//! The flow this supports, end to end:
//!
//! ```text
//! nockchain-wallet create-tx ...                  # wallet builds and signs
//! nmeme-tx sighash  tx.jam                        # GATE: verify the digest
//! nmeme-tx attach   tx.jam <lock-root> <claim> out.jam
//!                                                 # prints the NEW digest
//! nockchain-wallet sign-hash <new-digest>         # wallet re-signs
//! nmeme-tx set-sig  out.jam <name> <pubkey> <pkh> sig.jam final.jam
//! nockchain-wallet send-tx final.jam
//! ```
//!
//! The gate is not optional. Attaching to a transaction whose digest has not
//! been checked against the wallet's own signature means any later rejection is
//! unattributable.

use nmeme_core::{Claim, Ticker, TokenId};
use nockchain_math::owned_based_noun::OwnedBasedNoun;
use nockchain_types::tx_engine::common::{Hash, Name, SchnorrPubkey, SchnorrSignature};
use nockchain_types::tx_engine::v1::tx::{PkhSignature, PkhSignatureEntry, Spend, Witness};

use crate::Error;

/// Parses `transfer:<token-b58>:<amount>` or
/// `genesis:<TICKER>:<decimals>:<amount>`.
pub fn parse_claim(spec: &str) -> Result<Claim, String> {
    let parts: Vec<&str> = spec.split(':').collect();
    match parts.as_slice() {
        ["transfer", token, amount] => {
            let token = Hash::from_base58(token).map_err(|e| format!("token id: {e}"))?;
            let amount = amount.parse::<u64>().map_err(|e| format!("amount: {e}"))?;
            Ok(Claim::Transfer {
                token: TokenId(token),
                amount,
            })
        }
        // The id a genesis creates is derived from the transaction's inputs;
        // `with_genesis_id` fills it once the spends are known.
        ["genesis", ticker, decimals, amount] => Ok(Claim::Genesis {
            ticker: Ticker::new(ticker).map_err(|e| format!("ticker: {e}"))?,
            decimals: decimals.parse::<u64>().map_err(|e| format!("decimals: {e}"))?,
            amount: amount.parse::<u64>().map_err(|e| format!("amount: {e}"))?,
            token: TokenId(Hash::from_limbs(&[0; 5])),
        }),
        _ => Err(
            "expected transfer:<token-b58>:<amount> or genesis:<TICKER>:<decimals>:<amount>"
                .to_string(),
        ),
    }
}

/// A claim to attach: one the codec checks, or a raw payload for the live
/// cases that show consensus refusing what the codec never produces.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimSpec {
    Checked(Claim),
    /// `raw-genesis:<ticker text>:<decimals>:<amount>[:<token id b58>]`:
    /// the ticker's bytes limbed seven at a time exactly as given (lowercase
    /// and all), the decimals and amount unchecked; the id derived from the
    /// inputs unless given.
    RawGenesis {
        ticker_limbs: Vec<u64>,
        decimals: u64,
        amount: u64,
        token: Option<TokenId>,
    },
    /// `raw-transfer:<token id b58>:<amount>`: the amount unchecked.
    RawTransfer { token: TokenId, amount: u64 },
}

impl ClaimSpec {
    pub fn amount(&self) -> u64 {
        match self {
            Self::Checked(c) => c.amount(),
            Self::RawGenesis { amount, .. } | Self::RawTransfer { amount, .. } => *amount,
        }
    }

    /// The payload noun, with a genesis id derived from `inputs` where the
    /// spec does not carry one.
    pub fn to_noun(&self, inputs: &[Name]) -> Result<OwnedBasedNoun, String> {
        match self {
            Self::Checked(claim) => with_genesis_id(claim.clone(), inputs)?
                .to_noun()
                .map_err(|e| format!("claim: {e}")),
            Self::RawGenesis { ticker_limbs, decimals, amount, token } => {
                let token = match token {
                    Some(t) => t.clone(),
                    None => TokenId::derive_limbs(inputs, ticker_limbs, *decimals)
                        .map_err(|e| format!("token id: {e}"))?,
                };
                nmeme_core::claim::raw_genesis_noun(ticker_limbs, *decimals, *amount, &token)
                    .map_err(|e| format!("raw genesis: {e}"))
            }
            Self::RawTransfer { token, amount } => {
                nmeme_core::claim::raw_transfer_noun(token, *amount).map_err(|e| format!("raw transfer: {e}"))
            }
        }
    }
}

fn raw_limbs(text: &str) -> Vec<u64> {
    text.as_bytes()
        .chunks(7)
        .map(|chunk| chunk.iter().enumerate().fold(0u64, |acc, (i, b)| acc | ((*b as u64) << (8 * i))))
        .collect()
}

pub fn parse_claim_spec(spec: &str) -> Result<ClaimSpec, String> {
    let parts: Vec<&str> = spec.split(':').collect();
    match parts.as_slice() {
        ["raw-genesis", ticker, decimals, amount] | ["raw-genesis", ticker, decimals, amount, _] => {
            let token = match parts.get(4) {
                Some(b58) => Some(TokenId(Hash::from_base58(b58).map_err(|e| format!("token id: {e}"))?)),
                None => None,
            };
            Ok(ClaimSpec::RawGenesis {
                ticker_limbs: raw_limbs(ticker),
                decimals: decimals.parse::<u64>().map_err(|e| format!("decimals: {e}"))?,
                amount: amount.parse::<u64>().map_err(|e| format!("amount: {e}"))?,
                token,
            })
        }
        ["raw-transfer", token, amount] => Ok(ClaimSpec::RawTransfer {
            token: TokenId(Hash::from_base58(token).map_err(|e| format!("token id: {e}"))?),
            amount: amount.parse::<u64>().map_err(|e| format!("amount: {e}"))?,
        }),
        _ => parse_claim(spec).map(ClaimSpec::Checked),
    }
}

/// Builds the replacement witness for one spend: the original witness with a
/// single pkh signature substituted.
///
/// Only the signature changes. The lock merkle proof, hax preimages and timelock
/// field are carried over from the wallet's own witness, because this crate has
/// no business reconstructing them.
pub fn witness_with_signature(
    original: &Witness,
    pkh: Hash,
    pubkey: SchnorrPubkey,
    signature: SchnorrSignature,
) -> Witness {
    Witness {
        lock_merkle_proof: original.lock_merkle_proof.clone(),
        pkh_signature: PkhSignature::new(vec![PkhSignatureEntry {
            pkh,
            pubkey,
            signature,
        }]),
        hax: original.hax.clone(),
        tim: original.tim,
    }
}

/// Finds a spend by the base58 of its input note's first name.
pub fn find_spend<'a>(
    spends: &'a [(Name, Spend)],
    first_name_b58: &str,
) -> Result<&'a (Name, Spend), Error> {
    spends
        .iter()
        .find(|(name, _)| name.first.to_base58() == first_name_b58)
        .ok_or_else(|| Error::NoSeedForLockRoot(first_name_b58.to_string()))
}

/// A genesis claim's id is a function of the transaction that creates it:
/// the smallest input name, the ticker and the decimals (`TokenId::derive`,
/// which the forked engine recomputes and enforces). Fills it in.
pub fn with_genesis_id(claim: Claim, inputs: &[Name]) -> Result<Claim, String> {
    match claim {
        Claim::Genesis { ticker, decimals, amount, .. } => {
            let token = TokenId::derive(inputs, &ticker, decimals).map_err(|e| format!("token id: {e}"))?;
            Ok(Claim::Genesis { ticker, decimals, amount, token })
        }
        other => Ok(other),
    }
}
