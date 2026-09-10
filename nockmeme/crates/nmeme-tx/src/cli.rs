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
        ["genesis", ticker, decimals, amount] => Ok(Claim::Genesis {
            ticker: Ticker::new(ticker).map_err(|e| format!("ticker: {e}"))?,
            decimals: decimals.parse::<u64>().map_err(|e| format!("decimals: {e}"))?,
            amount: amount.parse::<u64>().map_err(|e| format!("amount: {e}"))?,
        }),
        _ => Err(
            "expected transfer:<token-b58>:<amount> or genesis:<TICKER>:<decimals>:<amount>"
                .to_string(),
        ),
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
