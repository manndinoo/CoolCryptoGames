//! Spending a pool note under the `%amm` covenant, and building the trade
//! around it.
//!
//! A pool note has no key. Its witness is the bare covenant spend-condition
//! with a one-leaf Merkle proof and no signatures; what makes the spend
//! valid is the transaction it sits in (`++  amm` in the forked engine, see
//! `nockmeme/upstream/amm-covenant.patch`). This module builds that spend
//! from the five fields a reader prints for the note, and the seeds that a
//! quote says the covenant will accept.

use nmeme_core::claim::NOTE_DATA_KEY;
use nmeme_core::pool::{PoolParams, Reserves};
use nmeme_core::Claim;
use nockchain_math::belt::Belt;
use nockchain_types::tx_engine::common::{BlockHeight, Hash, Name, Nicks, Version};
use nockchain_types::tx_engine::v1::hashable::{hash_leaf_belt, hash_pair, HashHashable};
use nockchain_types::tx_engine::v1::note::{NoteData, NoteDataEntry, NoteDataValue, NoteV1};
use nockchain_types::tx_engine::v1::tx::{
    Lock, LockMerkleProof, LockMerkleProofStub, LockPrimitive, MerkleProof, Pkh, PkhSignature,
    Seed, Seeds, Spend, Spend1, SpendCondition, Spends, Witness,
};

use crate::sighash::note_data_digest;
use crate::Error;

/// A note at the pool lock, as the indexer's `pool` command prints it:
/// `<first> <last> <origin> <nock> <tokens>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolNote {
    pub name: Name,
    pub origin: u64,
    pub reserves: Reserves,
}

impl PoolNote {
    pub fn parse(spec: &str) -> Result<Self, String> {
        let parts: Vec<&str> = spec.split_whitespace().collect();
        let [first, last, origin, nock, tokens] = parts.as_slice() else {
            return Err(format!("expected \"<first> <last> <origin> <nock> <tokens>\", got {spec:?}"));
        };
        Ok(Self {
            name: Name::new(
                Hash::from_base58(first).map_err(|e| format!("first: {e}"))?,
                Hash::from_base58(last).map_err(|e| format!("last: {e}"))?,
            ),
            origin: origin.parse().map_err(|e| format!("origin: {e}"))?,
            reserves: Reserves::new(
                nock.parse().map_err(|e| format!("nock: {e}"))?,
                tokens.parse().map_err(|e| format!("tokens: {e}"))?,
            ),
        })
    }

    /// The note as consensus holds it: version 1, the origin, the name, a
    /// note-data map with exactly the token claim, the assets. A pool note
    /// carries nothing else, because every successor's note-data is the
    /// union of a NOCK-only seed and the pool's own claim-bearing seed.
    pub fn note(&self, params: &PoolParams) -> Result<NoteV1, Error> {
        Ok(NoteV1 {
            version: Version::V1,
            origin_page: BlockHeight(Belt(self.origin)),
            name: self.name.clone(),
            note_data: claim_data(params, self.reserves.tokens)?,
            assets: Nicks(self.reserves.nock as usize),
        })
    }

    /// `hash:nnote-1` of the note: what every seed of its spend must carry
    /// as `parent-hash`.
    pub fn hash(&self, params: &PoolParams) -> Result<Hash, Error> {
        note_hash(&self.note(params)?)
    }
}

/// Note-data holding one transfer claim of `amount` for the pool's token.
pub fn claim_data(params: &PoolParams, amount: u64) -> Result<NoteData, Error> {
    let claim = Claim::Transfer {
        token: params.token.clone(),
        amount,
    };
    Ok(NoteData::new(vec![NoteDataEntry::new(
        NOTE_DATA_KEY.to_string(),
        NoteDataValue::Noun(claim.to_noun()?),
    )]))
}

fn belt(v: u64) -> Result<Belt, Error> {
    if nockchain_math::belt::based_check(v) {
        Ok(Belt(v))
    } else {
        Err(Error::NotBased(v))
    }
}

/// `hash:nnote-1` (tx-engine-1.hoon, `++  hashable` of `nnote-1`):
///
/// ```text
/// :*  leaf+version  leaf+origin-page  hash+(hash:nname name)
///     hash+(hash:note-data note-data)  leaf+assets  ==
/// ```
pub fn note_hash(note: &NoteV1) -> Result<Hash, Error> {
    let version = hash_leaf_belt(Belt(1));
    let origin = hash_leaf_belt(note.origin_page.0);
    let name = note.name.hash_digest().map_err(|_| Error::Shape)?;
    let data = note_data_digest(&note.note_data)?;
    let assets = hash_leaf_belt(belt(note.assets.0 as u64)?);
    Ok(hash_pair(
        &version,
        &hash_pair(&origin, &hash_pair(&name, &hash_pair(&data, &assets))),
    ))
}

/// The witness a pool spend carries: the covenant spend-condition, axis 1,
/// a proof whose root is the leaf itself, and no signature of any kind.
pub fn covenant_witness(params: &PoolParams) -> Result<Witness, Error> {
    let spend_condition = SpendCondition::new(vec![params.primitive()]);
    let root = params.lock_root()?;
    Ok(Witness {
        lock_merkle_proof: LockMerkleProof::Stub(LockMerkleProofStub {
            spend_condition,
            axis: 1,
            proof: MerkleProof { root, path: vec![] },
        }),
        pkh_signature: PkhSignature(vec![]),
        hax: vec![],
        tim: 0,
    })
}

/// A witness that claims the note is under a 1-of-1 key lock instead: what
/// a creator who kept a key would present. Its proof root is the root of
/// *that* lock, which is not the pool's, so consensus refuses it before it
/// looks at any signature.
pub fn key_witness(pkh: Hash) -> Result<Witness, Error> {
    let spend_condition = SpendCondition::new(vec![LockPrimitive::Pkh(Pkh::new(1, [pkh]))]);
    let root = Lock::SpendCondition(spend_condition.clone()).hash()?;
    Ok(Witness {
        lock_merkle_proof: LockMerkleProof::Stub(LockMerkleProofStub {
            spend_condition,
            axis: 1,
            proof: MerkleProof { root, path: vec![] },
        }),
        pkh_signature: PkhSignature(vec![]),
        hax: vec![],
        tim: 0,
    })
}

/// A seed with no pin.
pub fn seed(lock_root: Hash, gift: u64, note_data: NoteData, parent_hash: Hash) -> Seed {
    Seed {
        output_source: None,
        lock_root,
        note_data,
        gift: Nicks(gift as usize),
        parent_hash,
    }
}

/// Points every seed paying `from` at `to` instead. Returns how many moved.
pub fn retarget(spends: &mut Spends, from: &Hash, to: &Hash) -> usize {
    let mut n = 0;
    for (_, spend) in spends.0.iter_mut() {
        let Spend::Witness(spend1) = spend else { continue };
        for s in spend1.seeds.0.iter_mut() {
            if &s.lock_root == from {
                s.lock_root = to.clone();
                n += 1;
            }
        }
    }
    n
}

/// The spend of a pool note: keyless witness, the given seeds, the given
/// miner fee (the covenant requires zero; anything else is an attack case).
pub fn pool_spend(input: &PoolNote, witness: Witness, seeds: Vec<Seed>, fee: u64) -> (Name, Spend) {
    (
        input.name.clone(),
        Spend::Witness(Spend1 {
            witness,
            seeds: Seeds(seeds),
            fee: Nicks(fee as usize),
        }),
    )
}
