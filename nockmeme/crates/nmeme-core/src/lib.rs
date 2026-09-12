//! NMEME v0 — a fixed-supply token standard carried in Nockchain note-data.
//!
//! See `nockmeme/docs/SPEC.md` for the standard and `nockmeme/docs/FINDINGS.md`
//! for the consensus facts each rule is derived from. Both cite Nockchain
//! revision `2bcb0b9dfd190f17252205afd1c8a067048a1ad9`.
//!
//! This crate is the *encoding and accounting* layer. It does not sign, build
//! or broadcast transactions, and it does not verify base-chain consensus: it
//! consumes notes that a node has already accepted.

pub mod claim;
pub mod consensus;
pub mod indexer;
pub mod pool;
pub mod ticker;
pub mod token_id;

pub use claim::{Claim, NOTE_DATA_KEY, VERSION};
pub use consensus::{Effect, Refusal, Verdict};
pub use indexer::{Indexer, NoteView, Outcome, TxView};
pub use pool::{PoolParams, Quote, Reserves, Side};
pub use ticker::Ticker;
pub use token_id::TokenId;

use nockchain_math::owned_based_noun::OwnedBasedNounError;

/// Every way a `meme` payload can fail to be a token claim.
///
/// These are all *rejections*. A note whose payload fails to decode carries no
/// token weight, and weight consumed to produce it is burned (SPEC §7).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("ticker must be 1..=28 bytes, got {0}")]
    TickerLength(usize),
    #[error("ticker must be uppercase ASCII alphanumeric: {0:?}")]
    TickerCharset(String),
    #[error("ticker limbs do not round-trip")]
    TickerEncoding,
    #[error("amount must be positive")]
    ZeroAmount,
    #[error("amount {0} is not a field element")]
    AmountNotBased(u64),
    #[error("amount {0} exceeds the maximum supply")]
    AmountTooLarge(u64),
    #[error("token amounts overflowed a u64")]
    AmountOverflow,
    #[error("decimals {0} exceeds 18")]
    Decimals(u64),
    #[error("unsupported payload version {0}")]
    UnsupportedVersion(u64),
    #[error("unknown claim tag {0}")]
    UnknownTag(u64),
    #[error("expected a cell")]
    ExpectedCell,
    #[error("expected an atom")]
    ExpectedAtom,
    #[error("improper list")]
    ImproperList,
    #[error("genesis transaction has no input to anchor identity to")]
    NoAnchor,
    #[error("atom is not a field element: {0}")]
    NotBased(String),
}

impl From<OwnedBasedNounError> for Error {
    fn from(err: OwnedBasedNounError) -> Self {
        Self::NotBased(err.to_string())
    }
}
