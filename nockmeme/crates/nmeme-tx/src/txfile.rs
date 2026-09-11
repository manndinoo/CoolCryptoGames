//! Reading a wallet-built transaction file.
//!
//! `create-tx` writes a jammed noun under the wallet's `./txs`. Its shape is
//! `[1 name spends display witness-data]` — note that the witness data is
//! carried *beside* the spends rather than inside them, and has to be spliced
//! onto each spend by name before the spend is complete. This mirrors
//! `ParsedTransaction` / `apply_witness_data` in the repository's own
//! `crates/nockchain-e2e/tests/upgrade_bythos.rs`.

use bytes::Bytes;
use nockapp::noun::slab::{NockJammer, NounSlab};
use nockchain_math::structs::HoonMapIter;
use nockchain_types::tx_engine::common::{Name, Signature};
use nockchain_types::tx_engine::v1::tx::{Spend, Spends, Witness, WitnessMap};
use nockvm::noun::{Noun, NounHandle};
use noun_serde::{NounDecode, NounEncode};

use crate::Error;

/// Witness data as the file carries it, before splicing.
pub enum WitnessData {
    Legacy(Vec<(Name, Signature)>),
    Witness(Vec<(Name, Witness)>),
}

pub struct ParsedTransaction {
    pub spends: Spends,
    pub witness_data: WitnessData,
}

impl ParsedTransaction {
    /// Decodes `[1 name spends display witness-data]`.
    pub fn from_noun(noun: NounHandle<'_>) -> Result<Self, Error> {
        let cell = noun.as_cell().map_err(|_| Error::Shape)?;
        let tag = cell
            .head()
            .as_atom()
            .map_err(|_| Error::Shape)?
            .as_u64()
            .map_err(|_| Error::Shape)?;
        if tag != 1 {
            return Err(Error::UnsupportedTxTag(tag));
        }
        // skip name
        let cell = cell.tail().as_cell().map_err(|_| Error::Shape)?;
        let cell = cell.tail().as_cell().map_err(|_| Error::Shape)?;
        let spends_noun = cell.head();
        // skip display
        let cell = cell.tail().as_cell().map_err(|_| Error::Shape)?;
        let witness_noun = cell.tail();

        let spends = Spends::from_noun_handle(&spends_noun).map_err(|_| Error::Shape)?;
        let witness_data = decode_witness_data(witness_noun)?;
        Ok(Self {
            spends,
            witness_data,
        })
    }

    /// Splices witness data onto the spends, giving complete signed spends.
    pub fn spliced(self) -> Result<Spends, Error> {
        let mut out = Vec::with_capacity(self.spends.0.len());
        match self.witness_data {
            WitnessData::Witness(entries) => {
                for (name, spend) in self.spends.0 {
                    let Spend::Witness(mut spend1) = spend else {
                        return Err(Error::Shape);
                    };
                    let witness = entries
                        .iter()
                        .find(|(entry_name, _)| entry_name == &name)
                        .map(|(_, witness)| witness.clone())
                        .ok_or(Error::Shape)?;
                    spend1.witness = witness;
                    out.push((name, Spend::Witness(spend1)));
                }
            }
            WitnessData::Legacy(entries) => {
                for (name, spend) in self.spends.0 {
                    let Spend::Legacy(mut spend0) = spend else {
                        return Err(Error::Shape);
                    };
                    let signature = entries
                        .iter()
                        .find(|(entry_name, _)| entry_name == &name)
                        .map(|(_, sig)| sig.clone())
                        .ok_or(Error::Shape)?;
                    spend0.signature = signature;
                    out.push((name, Spend::Legacy(spend0)));
                }
            }
        }
        Ok(Spends(out))
    }
}

fn decode_witness_data(noun: NounHandle<'_>) -> Result<WitnessData, Error> {
    let cell = noun.as_cell().map_err(|_| Error::Shape)?;
    let tag = cell
        .head()
        .as_atom()
        .map_err(|_| Error::Shape)?
        .as_u64()
        .map_err(|_| Error::Shape)?;
    let map = cell.tail();
    match tag {
        0 => Ok(WitnessData::Legacy(decode_map::<Signature>(map)?)),
        1 => Ok(WitnessData::Witness(decode_map::<Witness>(map)?)),
        other => Err(Error::UnsupportedWitnessTag(other)),
    }
}

fn decode_map<T: NounDecode>(noun: NounHandle<'_>) -> Result<Vec<(Name, T)>, Error> {
    HoonMapIter::new(&noun)
        .filter(|entry| entry.is_cell())
        .map(|entry| {
            let cell = entry.as_cell().map_err(|_| Error::Shape)?;
            let name = Name::from_noun_handle(&cell.head()).map_err(|_| Error::Shape)?;
            let value = T::from_noun_handle(&cell.tail()).map_err(|_| Error::Shape)?;
            Ok((name, value))
        })
        .collect()
}

/// Rewrites a transaction file with modified spends and witness data.
///
/// The file is `[1 name spends display witness-data]`. `name` and `display` are
/// carried through as the original nouns rather than re-derived, so nothing
/// depends on this crate understanding them.
///
/// The witness-data map is rebuilt by walking the *original* map and
/// substituting values, keeping its exact tree shape. Rebuilding a Hoon map
/// from scratch would require reproducing its balancing, and a differently
/// shaped map is a different noun.
pub fn rewrite(
    original: NounHandle<'_>,
    slab: &mut NounSlab<NockJammer>,
    spends: &Spends,
    witness_for: &dyn Fn(&Name) -> Option<Witness>,
) -> Result<Bytes, Error> {
    let cell = original.as_cell().map_err(|_| Error::Shape)?;
    let tag = cell.head().noun();
    let after_tag = cell.tail().as_cell().map_err(|_| Error::Shape)?;
    let name_noun = after_tag.head().noun();
    let after_name = after_tag.tail().as_cell().map_err(|_| Error::Shape)?;
    let after_spends = after_name.tail().as_cell().map_err(|_| Error::Shape)?;
    let display_noun = after_spends.head().noun();
    let witness_noun = after_spends.tail();

    let new_spends = spends.to_noun(slab);

    // witness-data is [tag map]; keep the tag, rebuild the map in place.
    let wcell = witness_noun.as_cell().map_err(|_| Error::Shape)?;
    let wtag = wcell.head().noun();
    let map = rebuild_witness_map(wcell.tail(), slab, witness_for)?;
    let new_witness = nockvm::noun::T(slab, &[wtag, map]);

    let root = nockvm::noun::T(
        slab,
        &[tag, name_noun, new_spends, display_noun, new_witness],
    );
    slab.set_root(root);
    Ok(slab.jam())
}

/// Walks a Hoon map node `[[key value] left right]` (`~` when empty) and
/// substitutes each value, preserving the tree's shape.
fn rebuild_witness_map(
    noun: NounHandle<'_>,
    slab: &mut NounSlab<NockJammer>,
    witness_for: &dyn Fn(&Name) -> Option<Witness>,
) -> Result<Noun, Error> {
    if noun.is_atom() {
        return Ok(nockvm::noun::D(0));
    }
    let cell = noun.as_cell().map_err(|_| Error::Shape)?;
    let entry = cell.head().as_cell().map_err(|_| Error::Shape)?;
    let key_noun = entry.head().noun();
    let name = Name::from_noun_handle(&entry.head()).map_err(|_| Error::Shape)?;

    let value = match witness_for(&name) {
        Some(witness) => witness.to_noun(slab),
        None => entry.tail().noun(),
    };

    let branches = cell.tail().as_cell().map_err(|_| Error::Shape)?;
    let left = rebuild_witness_map(branches.head(), slab, witness_for)?;
    let right = rebuild_witness_map(branches.tail(), slab, witness_for)?;

    let new_entry = nockvm::noun::T(slab, &[key_noun, value]);
    Ok(nockvm::noun::T(slab, &[new_entry, left, right]))
}

/// Writes a transaction file for `spends` that may come from several wallets:
/// `[1 name spends display [1 witness-map]]`, with `name` and `display`
/// carried from `original` and the witness map built from the spends' own
/// witnesses. Unlike [`rewrite`], which substitutes values in the original
/// file's map, this builds the map from scratch — the canonical z-map the
/// repository's own `WitnessMap` encoder produces, which is what a map with a
/// different entry count has to be.
pub fn assemble(
    original: NounHandle<'_>,
    slab: &mut NounSlab<NockJammer>,
    spends: &Spends,
) -> Result<Bytes, Error> {
    let cell = original.as_cell().map_err(|_| Error::Shape)?;
    let tag = cell.head().noun();
    let after_tag = cell.tail().as_cell().map_err(|_| Error::Shape)?;
    let name_noun = after_tag.head().noun();
    let after_name = after_tag.tail().as_cell().map_err(|_| Error::Shape)?;
    let after_spends = after_name.tail().as_cell().map_err(|_| Error::Shape)?;
    let display_noun = after_spends.head().noun();

    let mut entries: Vec<(Name, Witness)> = Vec::with_capacity(spends.0.len());
    for (name, spend) in &spends.0 {
        let Spend::Witness(spend1) = spend else { return Err(Error::Shape) };
        entries.push((name.clone(), spend1.witness.clone()));
    }
    let new_spends = spends.to_noun(slab);
    let map = WitnessMap(entries).to_noun(slab);
    let new_witness = nockvm::noun::T(slab, &[nockvm::noun::D(1), map]);
    let root = nockvm::noun::T(slab, &[tag, name_noun, new_spends, display_noun, new_witness]);
    slab.set_root(root);
    Ok(slab.jam())
}
