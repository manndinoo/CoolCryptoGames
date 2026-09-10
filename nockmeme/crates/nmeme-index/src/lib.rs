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
use nockchain_types::tx_engine::v1::tx::{Seed, Spend};

/// What one lock-root receives in a transaction: its merged gift, and the claim
/// attached to it if any.
#[derive(Debug, Clone)]
pub struct Destination {
    pub lock_root: Hash,
    /// Gifts are summed per lock-root because consensus merges seeds sharing
    /// one into a single note (FINDINGS §3).
    pub gift: u64,
    pub claim: Option<Claim>,
    /// Every seed paying this lock-root; the merged note's identity is a
    /// function of exactly this set.
    pub seeds: Vec<Seed>,
    /// The complete `Name` consensus assigns to the merged output, computed
    /// from `seeds` (`nmeme_tx::names::output_name`). This is what binds a
    /// claim to one specific note rather than to a recipient.
    pub name: Name,
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
    struct Partial { lock_root: Hash, gift: u64, claim: Option<Claim>, seeds: Vec<Seed> }
    let mut merged: BTreeMap<Vec<u8>, Partial> = BTreeMap::new();

    for (name, spend) in &spends.0 {
        inputs.push(name.clone());
        let Spend::Witness(spend1) = spend else {
            return Err(format!("spend {} is legacy v0", name.first.to_base58()));
        };
        for seed in &spend1.seeds.0 {
            let key = seed.lock_root.to_be_bytes().to_vec();
            let entry = merged.entry(key).or_insert_with(|| Partial {
                lock_root: seed.lock_root.clone(),
                gift: 0,
                claim: None,
                seeds: Vec::new(),
            });
            entry.gift = entry.gift.saturating_add(seed.gift.0 as u64);
            entry.seeds.push(seed.clone());

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

    let mut destinations = Vec::new();
    for partial in merged.into_values() {
        let name = nmeme_tx::output_name(&partial.lock_root, &partial.seeds)
            .map_err(|e| format!("output name for {}: {e}", partial.lock_root.to_base58()))?;
        destinations.push(Destination {
            lock_root: partial.lock_root,
            gift: partial.gift,
            claim: partial.claim,
            seeds: partial.seeds,
            name,
        });
    }
    Ok(TxPlan { inputs, destinations })
}

/// The first-name every note at `lock_root` carries — the lock, not the note.
pub fn first_name_of(lock_root: &Hash) -> Hash {
    nmeme_tx::first_name(lock_root)
}

/// Binds each destination's computed output name to a note the chain knows.
///
/// `candidates` is every note that could be an output of this step: the inputs
/// of any later step (full names, from their transaction files) plus the notes
/// still unspent at the end (full names, from the node). A destination's
/// computed name must appear there **exactly** — first and last. Matching on
/// first-name alone would identify the recipient and nothing more: successive
/// change outputs to the same lock share it.
///
/// Every failure is an error. A destination whose computed name is absent
/// means either the transaction file does not describe what was mined, or the
/// note was spent by something not in the replay; both invalidate the rebuild.
pub fn bind_outputs(
    destinations: &[Destination],
    candidates: &[Name],
    taken: &mut Vec<Vec<u8>>,
) -> Result<Vec<(Name, Destination)>, String> {
    let mut out = Vec::new();
    for dest in destinations {
        let key = name_key(&dest.name);
        if taken.contains(&key) {
            return Err(format!(
                "note {} computed for lock-root {} was already produced by an earlier step",
                dest.name.first.to_base58(),
                dest.lock_root.to_base58()
            ));
        }
        let present = candidates.iter().any(|c| name_key(c) == key);
        if !present {
            return Err(format!(
                "no chain note has the identity computed for lock-root {}: first {} last {}. \
                 The transaction file does not describe a mined output, or the note was \
                 consumed outside the replay.",
                dest.lock_root.to_base58(),
                dest.name.first.to_base58(),
                dest.name.last.to_base58()
            ));
        }
        taken.push(key);
        out.push((dest.name.clone(), dest.clone()));
    }
    Ok(out)
}

pub fn name_key(name: &Name) -> Vec<u8> {
    let mut key = name.first.to_be_bytes().to_vec();
    key.extend_from_slice(&name.last.to_be_bytes());
    key
}
