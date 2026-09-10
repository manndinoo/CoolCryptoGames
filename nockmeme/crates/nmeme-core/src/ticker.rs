//! Ticker encoding.
//!
//! Every atom that appears anywhere in note-data must be a base-field element
//! (`OwnedBasedNoun` rejects anything that is not, see FINDINGS §5). The field
//! prime is `2^64 - 2^32 + 1`, so an 8-byte ASCII cord can exceed it and be
//! rejected at validation time. Seven bytes is the widest limb that is always
//! safe, so a ticker is carried as a list of 7-byte limbs.

use nockchain_math::owned_based_noun::OwnedBasedNoun;

use crate::Error;

/// Bytes per ticker limb. 7 * 8 = 56 bits, always below the field prime.
pub const LIMB_BYTES: usize = 7;

/// Maximum ticker length in bytes. Four limbs is far more than any memecoin
/// ticker needs and keeps the payload well inside the 2048-leaf note-data cap.
pub const MAX_TICKER_BYTES: usize = LIMB_BYTES * 4;

/// A validated ticker: uppercase ASCII alphanumerics, 1..=28 bytes.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Ticker(String);

impl Ticker {
    /// Validates and constructs a ticker.
    ///
    /// Tickers are restricted to `A-Z0-9` so that they round-trip through the
    /// limb encoding byte-for-byte and cannot carry homoglyphs or whitespace
    /// that would make two distinct tokens render identically.
    pub fn new(raw: &str) -> Result<Self, Error> {
        if raw.is_empty() || raw.len() > MAX_TICKER_BYTES {
            return Err(Error::TickerLength(raw.len()));
        }
        if !raw.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) {
            return Err(Error::TickerCharset(raw.to_string()));
        }
        Ok(Self(raw.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Splits the ticker into little-endian 7-byte limbs.
    pub fn limbs(&self) -> Vec<u64> {
        self.0
            .as_bytes()
            .chunks(LIMB_BYTES)
            .map(|chunk| {
                let mut value = 0u64;
                for (i, &byte) in chunk.iter().enumerate() {
                    value |= (byte as u64) << (8 * i);
                }
                value
            })
            .collect()
    }

    /// Rebuilds a ticker from its limbs, rejecting anything that does not
    /// round-trip to a valid ticker.
    pub fn from_limbs(limbs: &[u64]) -> Result<Self, Error> {
        if limbs.is_empty() || limbs.len() > MAX_TICKER_BYTES / LIMB_BYTES {
            return Err(Error::TickerLength(limbs.len() * LIMB_BYTES));
        }
        let mut bytes = Vec::with_capacity(limbs.len() * LIMB_BYTES);
        for (index, &limb) in limbs.iter().enumerate() {
            // Only the final limb may be short; a zero byte anywhere else would
            // make two different tickers encode to the same limb sequence.
            let mut limb_bytes = Vec::with_capacity(LIMB_BYTES);
            for i in 0..LIMB_BYTES {
                let byte = ((limb >> (8 * i)) & 0xff) as u8;
                if byte == 0 {
                    break;
                }
                limb_bytes.push(byte);
            }
            let is_last = index + 1 == limbs.len();
            if !is_last && limb_bytes.len() != LIMB_BYTES {
                return Err(Error::TickerEncoding);
            }
            if limb_bytes.is_empty() {
                return Err(Error::TickerEncoding);
            }
            bytes.extend_from_slice(&limb_bytes);
        }
        let text = String::from_utf8(bytes).map_err(|_| Error::TickerEncoding)?;
        Self::new(&text)
    }

    /// Encodes the ticker as a proper Hoon list of limb atoms.
    pub fn to_noun(&self) -> Result<OwnedBasedNoun, Error> {
        let items = self
            .limbs()
            .into_iter()
            .map(|limb| OwnedBasedNoun::try_atom(limb).map_err(Error::from))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(OwnedBasedNoun::list(items))
    }
}
