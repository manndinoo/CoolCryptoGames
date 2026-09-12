//! Adding a `meme` entry to a wallet-built seed.

use nmeme_core::claim::NOTE_DATA_KEY;
use nmeme_core::Claim;
use nockchain_math::owned_based_noun::OwnedBasedNoun;
use nockchain_types::tx_engine::common::Hash;
use nockchain_types::tx_engine::v1::note::{NoteData, NoteDataEntry, NoteDataValue};
use nockchain_types::tx_engine::v1::tx::Seeds;

use crate::Error;

/// Attaches `claim` to the seed paying `lock_root`.
///
/// Exactly one seed per lock-root may carry the key (SPEC R1). That is not a
/// style rule: consensus merges seeds sharing a lock-root and unions their
/// note-data maps, resolving key collisions destructively
/// (`tx-engine-1.hoon:2380-2386`), so a second `meme` entry for the same
/// recipient would silently overwrite the first. Allocations to one recipient
/// must be summed into a single claim before this is called; the claim goes on
/// the first seed paying the lock-root (several seeds become one note), and
/// attaching to a lock-root that already carries the key is refused rather
/// than merged.
pub fn attach_claim(seeds: &mut Seeds, lock_root: &Hash, claim: &Claim) -> Result<(), Error> {
    attach_noun(seeds, lock_root, claim.to_noun()?)
}

/// [`attach_claim`] for a payload built without the codec's checks (the
/// live cases that show consensus refusing what the codec never produces).
pub fn attach_noun(seeds: &mut Seeds, lock_root: &Hash, noun: OwnedBasedNoun) -> Result<(), Error> {
    let value = NoteDataValue::Noun(noun);

    let mut attached = false;
    for seed in seeds.0.iter_mut() {
        if &seed.lock_root != lock_root {
            continue;
        }
        if seed.note_data.iter().any(|e| e.key == NOTE_DATA_KEY) {
            return Err(Error::DuplicateKey(NOTE_DATA_KEY.to_string()));
        }
        if attached {
            // Two seeds to one lock-root become one note (consensus unions
            // their note-data). The one claim sits on the first seed; the
            // merged note carries it, and no second entry is ever written,
            // so nothing can overwrite it. (A wallet building two spends
            // pays its change from each of them, to the same lock: seen
            // live in the two-token transaction of the rules test.)
            continue;
        }
        let mut entries: Vec<NoteDataEntry> = seed.note_data.iter().cloned().collect();
        entries.push(NoteDataEntry::new(NOTE_DATA_KEY.to_string(), value.clone()));
        seed.note_data = NoteData::new(entries);
        attached = true;
    }

    if attached {
        Ok(())
    } else {
        Err(Error::NoSeedForLockRoot(lock_root.to_base58()))
    }
}
