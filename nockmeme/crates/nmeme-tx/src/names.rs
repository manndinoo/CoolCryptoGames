//! Output note identity, derived from transaction contents.
//!
//! An output note's `Name` is assigned by consensus, not carried in the
//! transaction file, and the chain's summary RPC exposes only `first`, which
//! is a function of the lock-root alone. Two outputs to the same recipient in
//! successive transactions share it. Matching outputs to recipients therefore
//! identifies the *lock*, not the *note*, and a rebuild that stops there can
//! attribute a claim to the wrong note.
//!
//! The complete identity is computable from what the transaction contains.
//! `build-outputs` (`hoon/common/tx-engine-1.hoon:2350-2400`) names each merged
//! output `new-v1:nname [lock-root src]`, where `src` is the hash of the seeds
//! paying that lock-root with their `output-source` stripped:
//!
//! ```text
//! ++  new-v1  |=  [lock=hash =source]  [(first lock) (last source) ~]   :: 537
//! ++  first   |=  lock=hash   (hash-hashable [leaf+& hash+lock])         :: 542
//! ++  last    |=  =source     (hash-hashable [leaf+& (hashable:source) leaf+~]) :: 547
//! ++  hashable:source   [hash+p leaf+is-coinbase]        :: tx-engine-0
//! ++  hashable:seed     [hash+lock-root hash+(hash:note-data) leaf+gift hash+parent-hash] :: 700
//! ++  hashable:seeds    z-set walk, node = [seed [l r]], empty = leaf+~  :: 742
//! ```
//!
//! Two transcription facts: `&` is `%.y` which is `0`, and `%.n` — the
//! `is-coinbase` value `build-outputs` uses — is `1`. `first` is checked
//! against `FirstName::from_lock_root`, which the repository already
//! implements, so the transcription conventions are validated by real code
//! before `last` is trusted.

use nockchain_math::belt::Belt;
use nockchain_math::zoon::zset::ZSet;
use nockchain_types::tx_engine::common::{Hash, Name};
use nockchain_types::tx_engine::v1::hashable::{hash_leaf_belt, hash_leaf_null, hash_pair};
use nockchain_types::tx_engine::v1::tx::Seed;

use crate::sighash::note_data_digest;
use crate::Error;

/// `hashable:seed` — the *storage* hashable, which unlike `sig-hashable`
/// excludes `output-source`. That is why consensus strips it before hashing:
/// the digest never saw it.
pub fn seed_digest(seed: &Seed) -> Result<Hash, Error> {
    let gift = Belt::try_from(&(seed.gift.0 as u64)).map_err(|_| Error::NotBased(seed.gift.0 as u64))?;
    Ok(hash_pair(
        &seed.lock_root,
        &hash_pair(
            &note_data_digest(&seed.note_data)?,
            &hash_pair(&hash_leaf_belt(gift), &seed.parent_hash),
        ),
    ))
}

/// `hash:seeds` over the normalized set.
pub fn seeds_digest(seeds: &[Seed]) -> Result<Hash, Error> {
    let normalized: Vec<Seed> = seeds
        .iter()
        .map(|s| Seed { output_source: None, ..s.clone() })
        .collect();
    let set = ZSet::try_from_items(normalized).map_err(|_| Error::SeedSet)?;
    set.try_fold_tree(
        || Ok(hash_leaf_null()),
        |seed: &Seed, left: Hash, right: Hash| {
            Ok(hash_pair(&seed_digest(seed)?, &hash_pair(&left, &right)))
        },
    )
}

/// `first`: `[leaf+& hash+lock]`, with `&` = 0.
pub fn first_name(lock_root: &Hash) -> Hash {
    hash_pair(&hash_leaf_null(), lock_root)
}

/// `last` for a non-coinbase source: `[leaf+& [hash+src leaf+%.n] leaf+~]`.
pub fn last_name(seeds_hash: &Hash) -> Hash {
    let source = hash_pair(seeds_hash, &hash_leaf_belt(Belt(1))); // is-coinbase = %.n = 1
    hash_pair(&hash_leaf_null(), &hash_pair(&source, &hash_leaf_null()))
}

/// `last` for a **coinbase** note. `+new:coinbase` (`hoon/common/tx-engine.hoon`,
/// the v1 arm) names every reward note `new-v1:nname [root [parent %.y]]`:
/// the source is the block's *parent id* with `is-coinbase` = `%.y` = 0, and
/// the note is built with empty note-data (`*(z-map @tas *)`); `validate`
/// pins `origin-page` to the block height and the source hash to exactly
/// this. A miner supplies only the coinbase split (lock hashes and amounts),
/// never a note body, so no coinbase note can carry a claim.
///
/// That makes coinbase-ness a fact anyone can re-derive after the note is
/// spent: fetch the parent id of the block at the note's origin height and
/// compare. A spent note whose last name equals this value was a coinbase
/// note, and therefore carried no token weight in any history.
pub fn coinbase_last_name(parent_block_id: &Hash) -> Hash {
    let source = hash_pair(parent_block_id, &hash_leaf_null()); // is-coinbase = %.y = 0
    hash_pair(&hash_leaf_null(), &hash_pair(&source, &hash_leaf_null()))
}

/// The complete `Name` consensus assigns to the merged output at `lock_root`,
/// given every seed in the transaction that pays that lock-root.
pub fn output_name(lock_root: &Hash, seeds_at_lock: &[Seed]) -> Result<Name, Error> {
    if seeds_at_lock.is_empty() {
        return Err(Error::NoSeedForLockRoot(lock_root.to_base58()));
    }
    if seeds_at_lock.iter().any(|s| &s.lock_root != lock_root) {
        return Err(Error::Shape);
    }
    Ok(Name::new(first_name(lock_root), last_name(&seeds_digest(seeds_at_lock)?)))
}
