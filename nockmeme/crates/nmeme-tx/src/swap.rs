//! Two-party atomic trade assembly by output-source pinning (docs/SWAPS.md).
//!
//! A v1 signature covers one spend and its fee (`sig-hash`, tx-engine-1.hoon
//! 1116-1120), so a spend signed by Alice is valid in any transaction that
//! contains it — including one Bob assembles without paying. What closes that
//! is `output-source`: a seed may pin the source hash of the output note it
//! lands in, and validation (tx-engine-1.hoon 1409-1419) then requires the
//! note's last name to be built from *exactly* the complete seed set that
//! merged into it (`build-outputs`, 2370-2400: the set is normalized by
//! stripping every seed's own `output-source` before hashing, so a seed can
//! commit to a set containing itself).
//!
//! The construction: Alice's spend pays Bob's lock (tokens) and her own lock
//! (change); Bob's spend pays Alice's lock (NOCK) and his own lock (change).
//! Outputs merge by lock-root, so the note at Alice's lock is {her change,
//! Bob's payment} and the note at Bob's lock is {his change, Alice's tokens}.
//! Alice pins her change seed to the digest of {her change, Bob's payment};
//! Bob pins his change seed to the digest of {his change, Alice's tokens}.
//! Each pin sits on the seed its owner signs, and commits the owner's
//! signature to what the *other* party must deliver: their exact seed, gift,
//! note-data and parent note. Either spend alone, or either payment altered,
//! leaves a pinned lock with a different seed set, and the transaction is
//! invalid as a whole.

use nockchain_types::tx_engine::common::{Hash, Name, Source};
use nockchain_types::tx_engine::v1::tx::{Seed, Spend, Spends};

use crate::names::seeds_digest;
use crate::Error;

/// Concatenates two transactions' spends into one transaction. Spend keys are
/// input note names; the same input in both would be a double spend.
pub fn merge(a: Spends, b: Spends) -> Result<Spends, Error> {
    let mut out = a.0;
    for (name, spend) in b.0 {
        if out.iter().any(|(n, _)| n == &name) {
            return Err(Error::DuplicateInput(name.first.to_base58()));
        }
        out.push((name, spend));
    }
    Ok(Spends(out))
}

/// Every seed in the transaction paying `lock_root`, across all spends: the
/// set consensus merges into the one output note at that lock.
pub fn seeds_at_lock(spends: &Spends, lock_root: &Hash) -> Vec<Seed> {
    let mut out = Vec::new();
    for (_, spend) in &spends.0 {
        let Spend::Witness(spend1) = spend else { continue };
        out.extend(spend1.seeds.0.iter().filter(|s| &s.lock_root == lock_root).cloned());
    }
    out
}

/// The source hash consensus will assign to the output at `lock_root`:
/// `hash:seeds` over the normalized set of every seed paying it.
pub fn output_source_at(spends: &Spends, lock_root: &Hash) -> Result<Hash, Error> {
    let all = seeds_at_lock(spends, lock_root);
    if all.is_empty() {
        return Err(Error::NoSeedForLockRoot(lock_root.to_base58()));
    }
    seeds_digest(&all)
}

/// Pins the output at `lock_root` on the seed paying it from the spend whose
/// input is `owner_input` — the seed the lock's owner signs. Refuses a lock
/// that only one seed pays: a pin there commits to nothing another party
/// does, which is not a trade but a misconfiguration.
pub fn pin(spends: &mut Spends, lock_root: &Hash, owner_input: &Name) -> Result<Hash, Error> {
    let all = seeds_at_lock(spends, lock_root);
    if all.is_empty() {
        return Err(Error::NoSeedForLockRoot(lock_root.to_base58()));
    }
    if all.len() < 2 {
        return Err(Error::NothingToPin(lock_root.to_base58()));
    }
    let digest = seeds_digest(&all)?;
    for (name, spend) in spends.0.iter_mut() {
        if name != owner_input {
            continue;
        }
        let Spend::Witness(spend1) = spend else { return Err(Error::Shape) };
        for seed in spend1.seeds.0.iter_mut() {
            if &seed.lock_root == lock_root {
                seed.output_source = Some(Source { hash: digest.clone(), is_coinbase: false });
                return Ok(digest);
            }
        }
        return Err(Error::NoSeedForLockRoot(lock_root.to_base58()));
    }
    Err(Error::NoSpend(owner_input.first.to_base58()))
}

/// Does every pinned seed in `spends` agree with the seed set actually paying
/// its lock? This is the check consensus makes; running it before broadcast
/// tells the assembler which pin a tampered or half transaction violates.
pub fn check_pins(spends: &Spends) -> Result<Vec<(Hash, bool)>, Error> {
    let mut out = Vec::new();
    for (_, spend) in &spends.0 {
        let Spend::Witness(spend1) = spend else { continue };
        for seed in &spend1.seeds.0 {
            if let Some(src) = &seed.output_source {
                let actual = output_source_at(spends, &seed.lock_root)?;
                out.push((seed.lock_root.clone(), actual == src.hash && !src.is_coinbase));
            }
        }
    }
    Ok(out)
}

/// The transaction reduced to the one spend keyed by `input`: one party's
/// half, as a counterparty might try to broadcast it alone.
pub fn only(spends: &Spends, input: &Name) -> Result<Spends, Error> {
    let kept: Vec<(Name, Spend)> = spends.0.iter().filter(|(n, _)| n == input).cloned().collect();
    if kept.is_empty() {
        return Err(Error::NoSpend(input.first.to_base58()));
    }
    Ok(Spends(kept))
}

/// `base` with the spend keyed by `input` replaced by the same-keyed spend
/// from `donor`: what a party does when it substitutes its own re-signed
/// spend into a transaction the other party already signed.
pub fn replace(base: Spends, donor: &Spends, input: &Name) -> Result<Spends, Error> {
    let (_, replacement) = donor
        .0
        .iter()
        .find(|(n, _)| n == input)
        .ok_or_else(|| Error::NoSpend(input.first.to_base58()))?;
    let mut out = base.0;
    let slot = out
        .iter_mut()
        .find(|(n, _)| n == input)
        .ok_or_else(|| Error::NoSpend(input.first.to_base58()))?;
    slot.1 = replacement.clone();
    Ok(Spends(out))
}
