//! Token identity.
//!
//! Identity must be fixed *before* the genesis transaction is signed, because a
//! seed's signed image includes the hash of its note-data (FINDINGS §2).
//! Embedding the genesis transaction's own id inside its note-data would be
//! circular — the id would depend on a field that depends on the id.
//!
//! So identity is anchored to a note that already exists: the lexicographically
//! smallest input note name of the genesis transaction. That note can be spent
//! exactly once, which makes the derived id unique and unforgeable, and it is
//! fully determined before signing.

use nockchain_math::owned_based_noun::{hash_owned_based_noun_varlen, OwnedBasedNoun};
use nockchain_types::tx_engine::common::{Hash as NockHash, Name};

use crate::ticker::Ticker;
use crate::Error;

/// A token's permanent identity.
///
/// `Hash` implements neither `Ord` nor `std::hash::Hash`, so both are defined
/// here over the canonical limb array. That gives a stable, well-defined order
/// for the maps the indexer keys on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenId(pub NockHash);

impl PartialOrd for TokenId {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for TokenId {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.to_array().cmp(&other.0.to_array())
    }
}

impl std::hash::Hash for TokenId {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.to_array().hash(state);
    }
}

impl TokenId {
    /// Derives the identity of the token created by a genesis transaction.
    ///
    /// `inputs` is the transaction's full set of input note names; the anchor is
    /// the smallest by canonical byte order, so every party derives the same id
    /// regardless of how the input set is ordered in transit.
    pub fn derive(inputs: &[Name], ticker: &Ticker, decimals: u64) -> Result<Self, Error> {
        Self::derive_limbs(inputs, &ticker.limbs(), decimals)
    }

    /// [`Self::derive`] over ticker limbs as they will sit in the payload,
    /// valid or not: what consensus hashes is the noun, and the tests that
    /// show it refusing a bad ticker need the id it would have derived.
    pub fn derive_limbs(inputs: &[Name], ticker_limbs: &[u64], decimals: u64) -> Result<Self, Error> {
        let anchor = inputs
            .iter()
            .min_by_key(|name| (name.first.to_be_bytes(), name.last.to_be_bytes()))
            .ok_or(Error::NoAnchor)?;
        let limbs = ticker_limbs
            .iter()
            .map(|limb| OwnedBasedNoun::try_atom(*limb).map_err(Error::from))
            .collect::<Result<Vec<_>, _>>()?;
        let noun = OwnedBasedNoun::cell(
            name_noun(anchor)?,
            OwnedBasedNoun::cell(OwnedBasedNoun::list(limbs), OwnedBasedNoun::try_atom(decimals)?),
        );
        Ok(Self(NockHash::from_limbs(&hash_owned_based_noun_varlen(&noun))))
    }

    /// Encodes the id as the 5-limb tuple used inside a transfer claim.
    pub fn to_noun(&self) -> OwnedBasedNoun {
        let limbs = self.0.to_array();
        OwnedBasedNoun::tuple_atoms(&limbs).expect("hash limbs are field elements by construction")
    }

    /// Decodes a 5-limb tuple back into an id.
    pub fn from_noun(noun: &OwnedBasedNoun) -> Result<Self, Error> {
        let mut limbs = [0u64; 5];
        let mut cursor = noun;
        for slot in limbs.iter_mut().take(4) {
            let OwnedBasedNoun::Cell(head, tail) = cursor else {
                return Err(Error::ExpectedCell);
            };
            let OwnedBasedNoun::Atom(belt) = head.as_ref() else {
                return Err(Error::ExpectedAtom);
            };
            *slot = belt.0;
            cursor = tail;
        }
        let OwnedBasedNoun::Atom(belt) = cursor else {
            return Err(Error::ExpectedAtom);
        };
        limbs[4] = belt.0;
        Ok(Self(NockHash::from_limbs(&limbs)))
    }

    /// Human-facing identity. Always show this where a user makes a value
    /// decision — tickers are labels and collide by design (SPEC §4).
    pub fn to_base58(&self) -> String {
        self.0.to_base58()
    }
}

fn name_noun(name: &Name) -> Result<OwnedBasedNoun, Error> {
    Ok(OwnedBasedNoun::cell(
        OwnedBasedNoun::tuple_atoms(&name.first.to_array())?,
        OwnedBasedNoun::tuple_atoms(&name.last.to_array())?,
    ))
}
