//! Minimum-fee calculation for a transaction *after* a claim is attached.
//!
//! The wallet sizes the fee for the transaction it built. Attaching a `meme`
//! entry adds leaves to a seed's note-data, which adds words, which raises the
//! minimum fee — after the wallet has already chosen one. Post-bythos the rule
//! is `seed_words * base_fee + witness_words * base_fee / divisor`, floored at
//! `min_fee` (`tx-engine-1.hoon:495-501`). A transaction that clears the
//! wallet's estimate but not the post-attach minimum is rejected by the node
//! for a reason that looks like nothing in particular.
//!
//! The words are counted by the repository's own estimator
//! (`wallet_tx_builder::word_count`) and the fee by its own
//! `fee::compute_minimum_fee`, so this crate re-derives neither.

use nockchain_math::belt::Belt;
use nockchain_types::tx_engine::common::BlockHeight;
use nockchain_types::tx_engine::v1::tx::{LockMerkleProof, Spend, Spends};
use wallet_tx_builder::fee::{compute_minimum_fee, FeeInputs};
use wallet_tx_builder::types::{ChainContext, PlannedOutput, RawNoteDataEntry};
use wallet_tx_builder::word_count::{WitnessWordInput, WordCountEstimator};

use crate::Error;

/// Chain constants the fee depends on. They differ between networks, so they
/// are parameters with fakenet defaults, not baked-in numbers.
#[derive(Debug, Clone, Copy)]
pub struct FeeParams {
    /// Height the transaction will be validated at. Anything at or past
    /// `bythos_phase` uses the post-bythos rule.
    pub height: u64,
    pub bythos_phase: u64,
    pub base_fee: u64,
    pub input_fee_divisor: u64,
    pub min_fee: u64,
}

impl FeeParams {
    /// Fakenet: `blockchain_constants.rs:12-14, 303-304`; min-fee is the
    /// unchanged mainnet `data.min-fee` (`tx-engine-1.hoon:497`).
    pub fn fakenet(height: u64) -> Self {
        Self { height, bythos_phase: 1, base_fee: 128, input_fee_divisor: 4, min_fee: 256 }
    }
    /// Mainnet defaults (`tx-engine-1.hoon:493-501`).
    pub fn mainnet(height: u64) -> Self {
        Self { height, bythos_phase: 54_000, base_fee: 16_384, input_fee_divisor: 4, min_fee: 256 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeeReport {
    pub seed_words: u64,
    pub witness_words: u64,
    pub required: u64,
    pub current: u64,
}

fn height(n: u64) -> BlockHeight {
    BlockHeight(Belt(n))
}

/// The minimum fee the chain will accept for `spends` as they are now, and the
/// fee they currently carry (summed over spends).
pub fn required_fee(spends: &Spends, params: FeeParams) -> Result<FeeReport, Error> {
    let context = ChainContext {
        height: height(params.height),
        bythos_phase: height(params.bythos_phase),
        base_fee: params.base_fee,
        input_fee_divisor: params.input_fee_divisor,
        min_fee: params.min_fee,
    };
    let estimator = WordCountEstimator::new(&context);

    let mut outputs = Vec::new();
    let mut witnesses = Vec::new();
    let mut current: u64 = 0;
    for (_, spend) in &spends.0 {
        let Spend::Witness(spend1) = spend else { return Err(Error::Shape) };
        current = current.saturating_add(spend1.fee.0 as u64);
        for seed in &spend1.seeds.0 {
            outputs.push(PlannedOutput {
                lock_root: seed.lock_root.clone(),
                amount: seed.gift.0 as u64,
                note_data: seed
                    .note_data
                    .iter()
                    .map(|e| RawNoteDataEntry { key: e.key.clone(), blob: e.raw_blob() })
                    .collect(),
            });
        }
        let spend_condition = match &spend1.witness.lock_merkle_proof {
            LockMerkleProof::Full(full) => full.spend_condition.clone(),
            LockMerkleProof::Stub(stub) => stub.spend_condition.clone(),
        };
        witnesses.push(WitnessWordInput {
            spend_condition,
            // The input note's origin page is not in the file. Treating it as
            // post-bythos counts the version word, which is the larger estimate
            // — an over-estimate here costs a few nicks, an under-estimate costs
            // a rejected transaction.
            input_origin_page: height(params.height.max(params.bythos_phase)),
            spend_condition_count: None,
        });
    }

    let seed_words = estimator.estimate_seed_words(&outputs);
    let witness_words = estimator.estimate_witness_words(&witnesses);
    let breakdown = compute_minimum_fee(FeeInputs {
        seed_words,
        witness_words,
        base_fee: params.base_fee,
        input_fee_divisor: params.input_fee_divisor,
        min_fee: params.min_fee,
        height: height(params.height),
        bythos_phase: height(params.bythos_phase),
    });
    Ok(FeeReport { seed_words, witness_words, required: breakdown.minimum_fee, current })
}

/// Refuses a transaction whose fee is below the minimum for its current
/// contents. Called after attachment; the fee cannot be raised here because
/// doing so changes a seed, and with it the note names and the digest.
pub fn enforce_fee(spends: &Spends, params: FeeParams) -> Result<FeeReport, Error> {
    let report = required_fee(spends, params)?;
    if report.current < report.required {
        return Err(Error::FeeTooLow {
            current: report.current,
            required: report.required,
            shortfall: report.required - report.current,
        });
    }
    Ok(report)
}
