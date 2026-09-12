//! The `meme` note-data payload.
//!
//! A note's `meme` entry describes *that note's own* token balance. It is not a
//! list of instructions aimed at sibling outputs, because sibling outputs to the
//! same lock-root do not survive as separate notes: consensus merges them and
//! unions their note-data maps (FINDINGS §3).

use nockchain_math::owned_based_noun::OwnedBasedNoun;
use nockchain_types::tx_engine::common::Hash;

use crate::ticker::Ticker;
use crate::{Error, TokenId};

/// Payload schema version. Bumping this is how the standard evolves without
/// silently reinterpreting old notes.
pub const VERSION: u64 = 0;

/// The note-data key claimed by this standard. Not one of the three reserved
/// keys, so it decodes to `NoteDataValue::Noun` and is preserved verbatim.
pub const NOTE_DATA_KEY: &str = "meme";

const TAG_CREATE: u64 = b'c' as u64;
const TAG_TRANSFER: u64 = b't' as u64;

/// The maximum decimals a token may declare.
pub const MAX_DECIMALS: u64 = 18;

/// The largest amount any single claim may carry, and the largest total supply
/// a token may have: `2^63 - 1`.
///
/// This is a standard-level cap, not a consensus one. Consensus only requires an
/// amount to be a field element, and the field prime `2^64 - 2^32 + 1` sits just
/// *below* `u64::MAX` — close enough that two otherwise-valid amounts can sum
/// past it. Accumulating such amounts without checking would wrap, and a wrapped
/// total can be made to satisfy conservation while handing out arbitrary weight.
///
/// Capping at `2^63 - 1` leaves a full bit of headroom, so any *pair* of valid
/// amounts sums without overflow. Sums of more than two are still guarded by
/// checked arithmetic in the indexer; the cap is defence in depth, not the
/// defence.
pub const MAX_SUPPLY: u64 = (1 << 63) - 1;

/// What a note claims to hold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Claim {
    /// This note holds `amount` of a token being created by this transaction.
    /// `token` is the id the genesis creates: consensus (the fork) recomputes
    /// it from the transaction's anchor input, the ticker and the decimals,
    /// and refuses a genesis that names any other id. A later transfer of
    /// this note counts as `amount` of `token` going in.
    Genesis {
        ticker: Ticker,
        decimals: u64,
        amount: u64,
        token: TokenId,
    },
    /// This note holds `amount` of the already-existing token `token`.
    Transfer { token: TokenId, amount: u64 },
}

impl Claim {
    /// The amount of token weight this note claims, whichever variant it is.
    pub fn amount(&self) -> u64 {
        match self {
            Self::Genesis { amount, .. } | Self::Transfer { amount, .. } => *amount,
        }
    }

    fn validate(&self) -> Result<(), Error> {
        let amount = self.amount();
        if amount == 0 {
            return Err(Error::ZeroAmount);
        }
        if amount > MAX_SUPPLY {
            return Err(Error::AmountTooLarge(amount));
        }
        if !nockchain_math::belt::based_check(amount) {
            return Err(Error::AmountNotBased(amount));
        }
        if let Self::Genesis { decimals, .. } = self {
            if *decimals > MAX_DECIMALS {
                return Err(Error::Decimals(*decimals));
            }
        }
        Ok(())
    }

    /// Encodes the claim as the versioned noun `[version claim]`.
    pub fn to_noun(&self) -> Result<OwnedBasedNoun, Error> {
        self.validate()?;
        let body = match self {
            Self::Genesis {
                ticker,
                decimals,
                amount,
                token,
            } => OwnedBasedNoun::cell(
                OwnedBasedNoun::try_atom(TAG_CREATE)?,
                OwnedBasedNoun::cell(
                    ticker.to_noun()?,
                    OwnedBasedNoun::cell(
                        OwnedBasedNoun::try_atom(*decimals)?,
                        OwnedBasedNoun::cell(OwnedBasedNoun::try_atom(*amount)?, token.to_noun()),
                    ),
                ),
            ),
            Self::Transfer { token, amount } => OwnedBasedNoun::cell(
                OwnedBasedNoun::try_atom(TAG_TRANSFER)?,
                OwnedBasedNoun::cell(token.to_noun(), OwnedBasedNoun::try_atom(*amount)?),
            ),
        };
        Ok(OwnedBasedNoun::cell(
            OwnedBasedNoun::try_atom(VERSION)?,
            body,
        ))
    }

    /// Decodes a claim from a `meme` note-data value.
    ///
    /// Every failure here is a *rejection*, not an error to retry: an
    /// unparseable payload means the note carries no token weight, and any
    /// weight consumed to produce it is burned (SPEC §7).
    pub fn from_noun(noun: &OwnedBasedNoun) -> Result<Self, Error> {
        let (version, body) = cell(noun)?;
        if atom(version)? != VERSION {
            return Err(Error::UnsupportedVersion(atom(version)?));
        }
        let (tag, rest) = cell(body)?;
        let claim = match atom(tag)? {
            TAG_CREATE => {
                let (ticker_noun, rest) = cell(rest)?;
                let limbs = list_atoms(ticker_noun)?;
                let (decimals, rest) = cell(rest)?;
                let (amount, token) = cell(rest)?;
                Self::Genesis {
                    ticker: Ticker::from_limbs(&limbs)?,
                    decimals: atom(decimals)?,
                    amount: atom(amount)?,
                    token: TokenId::from_noun(token)?,
                }
            }
            TAG_TRANSFER => {
                let (token_noun, amount) = cell(rest)?;
                Self::Transfer {
                    token: TokenId::from_noun(token_noun)?,
                    amount: atom(amount)?,
                }
            }
            other => return Err(Error::UnknownTag(other)),
        };
        claim.validate()?;
        Ok(claim)
    }
}

fn cell(noun: &OwnedBasedNoun) -> Result<(&OwnedBasedNoun, &OwnedBasedNoun), Error> {
    match noun {
        OwnedBasedNoun::Cell(head, tail) => Ok((head, tail)),
        OwnedBasedNoun::Atom(_) => Err(Error::ExpectedCell),
    }
}

fn atom(noun: &OwnedBasedNoun) -> Result<u64, Error> {
    match noun {
        OwnedBasedNoun::Atom(belt) => Ok(belt.0),
        OwnedBasedNoun::Cell(_, _) => Err(Error::ExpectedAtom),
    }
}

/// Reads a proper Hoon list of atoms, terminated by the null atom.
fn list_atoms(noun: &OwnedBasedNoun) -> Result<Vec<u64>, Error> {
    let mut out = Vec::new();
    let mut cursor = noun;
    loop {
        match cursor {
            OwnedBasedNoun::Atom(belt) if belt.0 == 0 => return Ok(out),
            OwnedBasedNoun::Atom(_) => return Err(Error::ImproperList),
            OwnedBasedNoun::Cell(head, tail) => {
                out.push(atom(head)?);
                if out.len() > crate::ticker::MAX_TICKER_BYTES {
                    return Err(Error::ImproperList);
                }
                cursor = tail;
            }
        }
    }
}

/// A genesis payload encoded *without* the standard's checks, for tests and
/// for the live attack cases that show consensus refusing what the codec
/// would never produce: any ticker limbs, any decimals, any amount.
pub fn raw_genesis_noun(
    ticker_limbs: &[u64],
    decimals: u64,
    amount: u64,
    token: &TokenId,
) -> Result<OwnedBasedNoun, Error> {
    let limbs = ticker_limbs
        .iter()
        .map(|limb| OwnedBasedNoun::try_atom(*limb).map_err(Error::from))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(OwnedBasedNoun::cell(
        OwnedBasedNoun::try_atom(VERSION)?,
        OwnedBasedNoun::cell(
            OwnedBasedNoun::try_atom(TAG_CREATE)?,
            OwnedBasedNoun::cell(
                OwnedBasedNoun::list(limbs),
                OwnedBasedNoun::cell(
                    OwnedBasedNoun::try_atom(decimals)?,
                    OwnedBasedNoun::cell(OwnedBasedNoun::try_atom(amount)?, token.to_noun()),
                ),
            ),
        ),
    ))
}

/// A transfer payload encoded without the standard's checks (see
/// [`raw_genesis_noun`]).
pub fn raw_transfer_noun(token: &TokenId, amount: u64) -> Result<OwnedBasedNoun, Error> {
    Ok(OwnedBasedNoun::cell(
        OwnedBasedNoun::try_atom(VERSION)?,
        OwnedBasedNoun::cell(
            OwnedBasedNoun::try_atom(TAG_TRANSFER)?,
            OwnedBasedNoun::cell(token.to_noun(), OwnedBasedNoun::try_atom(amount)?),
        ),
    ))
}

/// Convenience: the `Hash` a `TokenId` wraps.
pub fn token_hash(token: &TokenId) -> &Hash {
    &token.0
}
