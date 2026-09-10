//! Attaching NMEME token data to Nockchain transactions.
//!
//! The stock wallet cannot do this: `create-tx` accepts only `p2pkh`,
//! `multisig` and `bridge-deposit` recipients, under `deny_unknown_fields`
//! (`crates/nockchain-wallet/src/recipient.rs:74-96`), and `--include-data`
//! governs the built-in `lock` entry rather than adding one. So a token
//! transaction has to be built by taking a wallet-built transaction, adding the
//! `meme` note-data entry, and re-signing.
//!
//! This crate owns the two parts the wallet cannot do: computing the new
//! signing hash ([`sighash`]) and attaching a claim to a seed ([`attach`]).
//! Signing itself stays with the wallet, which holds the keys
//! (`nockchain-wallet sign-hash`).

pub mod attach;
pub mod cli;
pub mod names;
pub mod sighash;
pub mod txfile;

pub use attach::attach_claim;
pub use names::{first_name, output_name};
pub use sighash::{note_data_digest, seed_sig_digest, seeds_sig_digest, spend_sig_hash};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("noun did not have the expected shape")]
    Shape,
    #[error("atom {0} is not a field element")]
    NotBased(u64),
    #[error("seeds did not form a canonical z-set")]
    SeedSet,
    #[error(
        "seed pins output-source; its hashable is only needed by the swap \
         construction, which is not implemented"
    )]
    PinnedOutputSource,
    #[error("no seed pays lock-root {0}")]
    NoSeedForLockRoot(String),
    #[error("seed already carries a {0:?} note-data entry")]
    DuplicateKey(String),
    #[error("claim encoding failed: {0}")]
    Claim(#[from] nmeme_core::Error),
    #[error("unsupported transaction tag {0}")]
    UnsupportedTxTag(u64),
    #[error("unsupported witness-data tag {0}")]
    UnsupportedWitnessTag(u64),
}
