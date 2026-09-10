//! Decoding NMEME claims out of chain data.
//!
//! Split from the binary so the decode path can be tested. It is the seam
//! between what `nmeme-tx` writes into a transaction and what comes back from
//! the node: the node returns each note-data entry as a jammed noun blob
//! (`NoteDataEntry.blob` in `nockchain/common/v2/blockchain.proto`), which has
//! to cue, satisfy the based-atom rule, and parse as a claim.

use nmeme_core::Claim;
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockchain_math::owned_based_noun::OwnedBasedNoun;
use nockvm::noun::NounAllocator;

/// Why a note-data blob did not yield a claim.
///
/// Every variant means the note carries no token weight (SPEC §7). None of them
/// is retryable, and none should be silently ignored: a note that fails here
/// after having been counted before would mean the indexer disagrees with
/// itself.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DecodeError {
    #[error("blob is not a valid jammed noun: {0}")]
    Cue(String),
    #[error("noun contains an atom outside the base field: {0}")]
    NotBased(String),
    #[error("payload is not an NMEME claim: {0}")]
    Claim(String),
}

/// Decodes one `meme` note-data blob as it arrives from the node.
pub fn decode_claim(blob: &[u8]) -> Result<Claim, DecodeError> {
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab
        .cue_into(bytes::Bytes::copy_from_slice(blob))
        .map_err(|err| DecodeError::Cue(err.to_string()))?;
    let space = slab.noun_space();
    let owned = OwnedBasedNoun::from_noun(noun, &space)
        .map_err(|err| DecodeError::NotBased(err.to_string()))?;
    Claim::from_noun(&owned).map_err(|err| DecodeError::Claim(err.to_string()))
}

/// Jams a claim the way `NoteDataValue::Noun` does, for tests and tooling.
pub fn encode_claim(claim: &Claim) -> Result<Vec<u8>, nmeme_core::Error> {
    use nockchain_types::tx_engine::v1::note::NoteDataValue;
    let value = NoteDataValue::Noun(claim.to_noun()?);
    Ok(value.raw_blob().to_vec())
}

// ---------------------------------------------------------------------------
// Reading claims back out of a signed transaction file.
// ---------------------------------------------------------------------------

use std::collections::BTreeMap;

use nmeme_core::claim::NOTE_DATA_KEY;
use nockchain_types::tx_engine::common::{Hash, Name};
use nockchain_types::tx_engine::v1::note::NoteDataValue;
use nockchain_types::tx_engine::v1::tx::Spend;

/// What one lock-root receives in a transaction: its merged gift, and the claim
/// attached to it if any.
#[derive(Debug, Clone)]
pub struct Destination {
    pub lock_root: Hash,
    /// Gifts are summed per lock-root because consensus merges seeds sharing
    /// one into a single note (FINDINGS §3).
    pub gift: u64,
    pub claim: Option<Claim>,
}

/// The inputs a transaction spends and the destinations it pays.
#[derive(Debug, Clone)]
pub struct TxPlan {
    pub inputs: Vec<Name>,
    pub destinations: Vec<Destination>,
}

/// Reads a signed transaction file.
///
/// The spend keys *are* the input note names, so inputs need no lookup. Output
/// note names are assigned by consensus and are not in the file; they come from
/// the node.
pub fn read_tx_plan(path: &std::path::Path) -> Result<TxPlan, String> {
    use nmeme_tx::txfile::ParsedTransaction;

    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = slab.cue_into(bytes.into()).map_err(|e| format!("cue: {e}"))?;
    let space = slab.noun_space();
    let parsed =
        ParsedTransaction::from_noun(noun.in_space(&space)).map_err(|e| format!("decode: {e}"))?;
    let spends = parsed.spliced().map_err(|e| format!("splice: {e}"))?;

    let mut inputs = Vec::new();
    let mut merged: BTreeMap<Vec<u8>, Destination> = BTreeMap::new();

    for (name, spend) in &spends.0 {
        inputs.push(name.clone());
        let Spend::Witness(spend1) = spend else {
            return Err(format!("spend {} is legacy v0", name.first.to_base58()));
        };
        for seed in &spend1.seeds.0 {
            let key = seed.lock_root.to_be_bytes().to_vec();
            let entry = merged.entry(key).or_insert_with(|| Destination {
                lock_root: seed.lock_root.clone(),
                gift: 0,
                claim: None,
            });
            entry.gift = entry.gift.saturating_add(seed.gift.0 as u64);

            for data in seed.note_data.iter() {
                if data.key != NOTE_DATA_KEY {
                    continue;
                }
                let NoteDataValue::Noun(value) = &data.value else {
                    return Err("meme entry is not a raw noun".to_string());
                };
                let claim = Claim::from_noun(value)
                    .map_err(|e| format!("claim on {}: {e}", seed.lock_root.to_base58()))?;
                if entry.claim.is_some() {
                    // Two claims on one lock-root: consensus would union the
                    // maps and one would silently win (SPEC R1).
                    return Err(format!(
                        "two meme claims target lock-root {}",
                        seed.lock_root.to_base58()
                    ));
                }
                entry.claim = Some(claim);
            }
        }
    }

    Ok(TxPlan {
        inputs,
        destinations: merged.into_values().collect(),
    })
}

/// The first-name every note at `lock_root` carries.
///
/// A note's `Name` is `{first, last}`, where `first` is derived from the
/// lock-root and `last` distinguishes notes at the same lock. So `first`
/// identifies the *destination* exactly — no amount matching, no guessing.
pub fn first_name_of(lock_root: &Hash) -> Result<Hash, String> {
    use nockchain_types::tx_engine::common::FirstName;
    FirstName::from_lock_root(lock_root)
        .map(|f| f.into_hash())
        .map_err(|e| format!("first-name of {}: {e}", lock_root.to_base58()))
}

/// Assigns the chain-assigned output note names to a step's destinations.
///
/// `candidates` is every note name that could be an output of this step: the
/// inputs of any later step (which must have been created earlier), plus the
/// notes still unspent at the end. `taken` carries assignments already made, so
/// the same note is never attributed to two steps.
///
/// Matching is by first-name, and every failure is an error rather than a
/// fallback. Attributing a claim to the wrong note would silently move weight
/// between owners.
pub fn assign_outputs(
    destinations: &[Destination],
    candidates: &[Name],
    taken: &mut Vec<Vec<u8>>,
) -> Result<Vec<(Name, Destination)>, String> {
    let mut out = Vec::new();
    for dest in destinations {
        let first = first_name_of(&dest.lock_root)?;
        let matches: Vec<&Name> = candidates
            .iter()
            .filter(|n| n.first == first)
            .filter(|n| !taken.contains(&name_key(n)))
            .collect();
        match matches.as_slice() {
            [] => {
                return Err(format!(
                    "no chain note matches lock-root {} (first-name {})",
                    dest.lock_root.to_base58(),
                    first.to_base58()
                ))
            }
            [only] => {
                taken.push(name_key(only));
                out.push(((*only).clone(), dest.clone()));
            }
            several => {
                return Err(format!(
                    "ambiguous: {} unassigned notes share first-name {}; cannot attribute \
                     claims safely",
                    several.len(),
                    first.to_base58()
                ))
            }
        }
    }
    Ok(out)
}

pub fn name_key(name: &Name) -> Vec<u8> {
    let mut key = name.first.to_be_bytes().to_vec();
    key.extend_from_slice(&name.last.to_be_bytes());
    key
}
