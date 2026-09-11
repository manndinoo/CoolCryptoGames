//! `sig-hash` for v1 spends, in Rust.
//!
//! Attaching a token claim changes a seed, which changes the spend's signing
//! hash, which invalidates the signature already on the transaction. Re-signing
//! therefore needs the digest, and `nockchain-types` exposes neither `sig_hash`
//! nor signing — both live in the Hoon wallet kernel.
//!
//! Every rule here is transcribed from `hoon/common/tx-engine-1.hoon` at
//! revision `2bcb0b9`, and the line numbers below point into it. The primitives
//! are the ones the chain itself uses; nothing re-implements tip5.
//!
//! ```text
//! ++  sig-hash                             :: spend-1, 1116
//!   [(sig-hashable:seeds seeds.sen) leaf+fee.sen]
//!
//! ++  sig-hashable:seeds                   :: 749 — walks the z-set tree
//!   ?@  form  leaf+form
//!   :+  (sig-hashable:seed n.form)
//!     $(form l.form)
//!   $(form r.form)
//!
//! ++  sig-hashable:seed                    :: 707
//!   :*  (hashable-unit:source output-source.sed)
//!       hash+lock-root.sed
//!       hash+(hash:note-data note-data.sed)
//!       leaf+gift.sed
//!       hash+parent-hash.sed
//!   ==
//! ```
//!
//! Two encoding facts do the work:
//!
//! - `hash+X` is the **identity** on the digest. The `%hash` branch of the
//!   hashable dispatch returns `X` rather than hashing it again
//!   (`nockchain-types/src/tx_engine/v1/hashable/noun.rs:48`).
//! - `:*  a b c d e` is `[a [b [c [d e]]]]`, and an untagged hashable cell
//!   digests as `hash_pair` of its children — so a seed is four nested pairs.

use nockapp::noun::slab::{NockJammer, NounSlab};
use nockchain_math::belt::Belt;
use nockchain_math::zoon::zset::ZSet;
use nockchain_types::tx_engine::common::Hash;
use nockchain_types::tx_engine::v1::hashable::{hash_leaf_belt, hash_leaf_null, hash_pair};
use nockchain_types::tx_engine::v1::note::NoteData;
use nockchain_types::tx_engine::v1::tx::{Seed, Seeds};
use nockvm::noun::{Noun, NounAllocator, NounSpace};
use noun_serde::NounEncode;

use crate::Error;

/// `sig-hash` for a v1 spend: `[(sig-hashable:seeds seeds) leaf+fee]`.
pub fn spend_sig_hash(seeds: &Seeds, fee: u64) -> Result<Hash, Error> {
    let seeds_digest = seeds_sig_digest(seeds)?;
    Ok(hash_pair(&seeds_digest, &hash_leaf_belt(belt(fee)?)))
}

/// `sig-hashable:seeds` — the z-set tree walk.
///
/// This is exactly the shape `HashableTreeHasher` implements: a node digests as
/// `hash_pair(element, hash_pair(left, right))` and the empty branch as
/// `leaf+0`. The tree must be the *canonical* z-set, because the tree shape is
/// part of the digest — so it is rebuilt with `ZSet::try_from_items`, the same
/// call `Seeds::to_noun` makes.
pub fn seeds_sig_digest(seeds: &Seeds) -> Result<Hash, Error> {
    let set = ZSet::try_from_items(seeds.0.clone()).map_err(|_| Error::SeedSet)?;
    set.try_fold_tree(
        || Ok(hash_leaf_null()),
        |seed: &Seed, left: Hash, right: Hash| {
            let digest = seed_sig_digest(seed)?;
            Ok(hash_pair(&digest, &hash_pair(&left, &right)))
        },
    )
}

/// `sig-hashable:seed` — four nested pairs.
pub fn seed_sig_digest(seed: &Seed) -> Result<Hash, Error> {
    // `hashable-unit:source` (tx-engine-0.hoon:338-343): `~` digests as
    // `leaf+~`; a pinned source as `[leaf+~ (hashable source)]`, where
    // `hashable:source` is `[hash+p leaf+is-coinbase]` (330-336), `%.y` = 0
    // and `%.n` = 1. A pin is what a swap party signs over: it commits the
    // signer to the complete seed set that must land on the pinned lock.
    let source = match &seed.output_source {
        None => hash_leaf_null(),
        Some(src) => hash_pair(
            &hash_leaf_null(),
            &hash_pair(&src.hash, &hash_leaf_belt(Belt(if src.is_coinbase { 0 } else { 1 }))),
        ),
    };
    let note_data = note_data_digest(&seed.note_data)?;
    let gift = hash_leaf_belt(belt(seed.gift.0 as u64)?);

    Ok(hash_pair(
        &source,
        &hash_pair(
            &seed.lock_root, // hash+ -> identity
            &hash_pair(
                &note_data, // hash+ -> identity
                &hash_pair(&gift, &seed.parent_hash),
            ),
        ),
    ))
}

/// `hash:note-data` (tx-engine-1.hoon:637-650).
///
/// **This is not a plain noun hash.** The map is walked as a tree, pairing
/// `leaf+key` with the value's *noun* hashable:
///
/// ```text
/// ?@  form  leaf+~
/// :+  [leaf+p.n.form (hashable-noun q.n.form)]
///   $(form l.form)
/// $(form r.form)
/// ```
///
/// Calling `hash_owned_based_noun` on the map, or on a value, gives the wrong
/// answer: that is `hash-noun-varlen` (leaf-sequence plus dyck), whereas
/// `hashable-noun` digests a cell as `hash_pair` of its children.
///
/// The tree shape is part of the digest, and the canonical shape is the one
/// `NoteData::to_noun` builds by repeated `z_map_put`. So the map is encoded
/// and the resulting noun walked, rather than the entry `Vec` being folded.
pub fn note_data_digest(note_data: &NoteData) -> Result<Hash, Error> {
    let mut slab: NounSlab<NockJammer> = NounSlab::new();
    let noun = note_data.to_noun(&mut slab);
    let space = slab.noun_space();
    zmap_digest(&noun, &space)
}

/// Walks a `ztree` node, which is a plain `[n l r]` with `~` for empty
/// (`hoon/common/zoon.hoon:8-17` — no cached hash in the node).
fn zmap_digest(noun: &Noun, space: &NounSpace) -> Result<Hash, Error> {
    if noun.is_atom() {
        return Ok(hash_leaf_null());
    }
    let cell = noun.in_space(space).as_cell().map_err(|_| Error::Shape)?;
    let entry = cell.head().noun();
    let rest = cell.tail().noun();
    let rest_cell = rest.in_space(space).as_cell().map_err(|_| Error::Shape)?;
    let left = rest_cell.head().noun();
    let right = rest_cell.tail().noun();

    let entry_cell = entry.in_space(space).as_cell().map_err(|_| Error::Shape)?;
    let key = entry_cell.head().noun();
    let value = entry_cell.tail().noun();

    let key_atom = key
        .in_space(space)
        .as_atom()
        .map_err(|_| Error::Shape)?
        .as_u64()
        .map_err(|_| Error::Shape)?;

    let pair = hash_pair(&hash_leaf_belt(belt(key_atom)?), &hashable_noun(&value, space)?);
    Ok(hash_pair(
        &pair,
        &hash_pair(&zmap_digest(&left, space)?, &zmap_digest(&right, space)?),
    ))
}

/// `hashable-noun`: an atom digests as `leaf+n`, a cell as the pair of its
/// children's digests.
fn hashable_noun(noun: &Noun, space: &NounSpace) -> Result<Hash, Error> {
    if noun.is_atom() {
        let atom = noun
            .in_space(space)
            .as_atom()
            .map_err(|_| Error::Shape)?
            .as_u64()
            .map_err(|_| Error::Shape)?;
        return Ok(hash_leaf_belt(belt(atom)?));
    }
    let cell = noun.in_space(space).as_cell().map_err(|_| Error::Shape)?;
    Ok(hash_pair(
        &hashable_noun(&cell.head().noun(), space)?,
        &hashable_noun(&cell.tail().noun(), space)?,
    ))
}

fn belt(value: u64) -> Result<Belt, Error> {
    Belt::try_from(&value).map_err(|_| Error::NotBased(value))
}
