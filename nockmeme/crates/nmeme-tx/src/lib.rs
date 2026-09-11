//! Attaching NMEME token data to Nockchain transactions.
//!
//! The stock wallet cannot do this: `create-tx` accepts only `p2pkh`,
//! `multisig` and `bridge-deposit` recipients, under `deny_unknown_fields`
//! (`crates/nockchain-wallet/src/recipient.rs:74-96`), and `--include-data`
//! governs the built-in `lock` entry rather than adding one. So a token
//! transaction has to be built by taking a wallet-built transaction, adding the
//! `meme` note-data entry, and re-signing.
//!
//! This crate owns the parts the wallet cannot do: computing the new
//! signing hash ([`sighash`]), attaching a claim to a seed ([`attach`]), and
//! assembling a two-party trade with output-source pins ([`swap`]).
//! Signing itself stays with the wallet, which holds the keys
//! (`nockchain-wallet sign-hash`).

pub mod attach;
pub mod cli;
pub mod fee;
pub mod names;
pub mod sighash;
pub mod pool;
pub mod swap;
pub mod txfile;

pub use attach::attach_claim;
pub use fee::{enforce_fee, required_fee, FeeParams, FeeReport};
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
    #[error("input note {0} appears in both transactions: the same note cannot be spent twice")]
    DuplicateInput(String),
    #[error("no spend keyed by input note {0}")]
    NoSpend(String),
    #[error("only one seed pays lock-root {0}; a pin there commits to nothing another party does")]
    NothingToPin(String),
    #[error("no seed pays lock-root {0}")]
    NoSeedForLockRoot(String),
    #[error("seed already carries a {0:?} note-data entry")]
    DuplicateKey(String),
    #[error("claim encoding failed: {0}")]
    Claim(#[from] nmeme_core::Error),
    #[error("fee {current} is below the minimum {required} for this transaction (short by {shortfall})")]
    FeeTooLow { current: u64, required: u64, shortfall: u64 },
    #[error("lock merkle path of {path_len} siblings exceeds the deepest lock the protocol defines ({max}); refusing to estimate a fee for a witness the chain would reject")]
    UnsupportedLockShape { path_len: usize, max: usize },
    #[error("unsupported transaction tag {0}")]
    UnsupportedTxTag(u64),
    #[error("unsupported witness-data tag {0}")]
    UnsupportedWitnessTag(u64),
    #[error("lock hash: {0:?}")]
    LockHash(nockchain_types::tx_engine::v1::tx::LockHashError),
    #[error("{0}")]
    Pool(#[from] nmeme_core::pool::PoolError),
}

impl From<nockchain_types::tx_engine::v1::tx::LockHashError> for Error {
    fn from(e: nockchain_types::tx_engine::v1::tx::LockHashError) -> Self {
        Error::LockHash(e)
    }
}
