//! Reading a wallet-built transaction file.
//!
//! `create-tx` writes a jammed noun under the wallet's `./txs`. Its shape is
//! `[1 name spends display witness-data]` — note that the witness data is
//! carried *beside* the spends rather than inside them, and has to be spliced
//! onto each spend by name before the spend is complete. This mirrors
//! `ParsedTransaction` / `apply_witness_data` in the repository's own
//! `crates/nockchain-e2e/tests/upgrade_bythos.rs`.

use nockchain_math::structs::HoonMapIter;
use nockchain_types::tx_engine::common::{Name, Signature};
use nockchain_types::tx_engine::v1::tx::{Spend, Spends, Witness};
use nockvm::noun::NounHandle;
use noun_serde::NounDecode;

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
