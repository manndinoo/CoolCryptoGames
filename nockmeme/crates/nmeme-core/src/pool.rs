//! The constant-product pool as the `%amm` covenant enforces it.
//!
//! Everything here mirrors `++  amm` in the forked `tx-engine-1.hoon`
//! (`nockmeme/upstream/amm-covenant.patch`). The chain checks the rule in
//! unbounded integers; this module reproduces it exactly with a 256-bit
//! product, so a quote computed here is the most the covenant will accept
//! and never one unit more.
//!
//! The rule, for a pool note (or the sum of every input at the pool lock)
//! holding `x` nicks and `y` tokens, and a successor holding `x1`, `y1`:
//!
//! ```text
//! (B*x1 - fee*max(x1-x,0)) * (B*y1 - fee*max(y1-y,0)) >= B*B*x*y,   B = 10000
//! x1 > 0, y1 > 0
//! ```
//!
//! The pool's fee share of whatever comes *in* does not count towards the
//! price, and nothing is paid out of it: it stays in the reserves, so the
//! constant product grows by it on every trade.
//!
//! The treasury (the Lore Wallet, `docs/FEES.md`) takes `lore` basis points
//! of every trade's NOCK side, in NOCK, in the same transaction: on a buy it
//! comes off the NOCK paid before the trade is priced; on a sell it comes
//! off the gross proceeds before the seller is paid. The covenant requires
//! the treasury's output to hold at least `floor(lore * N / B)`, `N` being
//! every nick crossing the pool boundary other than that payment.

use nockchain_types::tx_engine::common::Hash;
use nockchain_types::tx_engine::v1::hashable::{hash_leaf_null, hash_pair};
use nockchain_types::tx_engine::v1::tx::{Amm, Lock, LockHashError, LockPrimitive, SpendCondition};

use crate::TokenId;

/// Basis points in one.
pub const FEE_DENOMINATOR: u64 = 10_000;

/// What identifies a pool: the token and the fee. The pool's lock is a pure
/// function of these, so anyone can recompute the address a pool must live
/// at and refuse one that lives anywhere else.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolParams {
    pub token: TokenId,
    /// The pool's share, retained in the reserves.
    pub fee_bps: u64,
    /// The treasury's share, paid in NOCK to `lore_lock`.
    pub lore_bps: u64,
    /// The treasury's lock root (the Lore Wallet).
    pub lore_lock: Hash,
}

impl PoolParams {
    pub fn new(token: TokenId, fee_bps: u64, lore_bps: u64, lore_lock: Hash) -> Result<Self, PoolError> {
        if fee_bps + lore_bps > FEE_DENOMINATOR {
            return Err(PoolError::FeeTooHigh(fee_bps + lore_bps));
        }
        Ok(Self { token, fee_bps, lore_bps, lore_lock })
    }

    /// `[%amm tid fee lore lore-lock]`.
    pub fn primitive(&self) -> LockPrimitive {
        LockPrimitive::Amm(Amm {
            token_id: self.token.0.clone(),
            fee_bps: self.fee_bps,
            lore_bps: self.lore_bps,
            lore_lock: self.lore_lock.clone(),
        })
    }

    /// The treasury's first name: where its notes sit.
    pub fn lore_first_name(&self) -> Hash {
        hash_pair(&hash_leaf_null(), &self.lore_lock)
    }

    /// The treasury's share of `nock` nicks crossing the pool boundary.
    pub fn lore_share(&self, nock: u64) -> u64 {
        ((nock as u128 * self.lore_bps as u128) / FEE_DENOMINATOR as u128) as u64
    }

    /// The canonical pool lock: one spend-condition, one primitive, no key.
    /// A lock with any other branch (a creator's key, say) has a different
    /// root and is not this pool.
    pub fn lock(&self) -> Lock {
        Lock::SpendCondition(SpendCondition::new(vec![self.primitive()]))
    }

    pub fn lock_root(&self) -> Result<Hash, LockHashError> {
        self.lock().hash()
    }

    /// The first name every note at the pool lock carries: `[leaf+& hash+lock]`.
    pub fn first_name(&self) -> Result<Hash, LockHashError> {
        Ok(hash_pair(&hash_leaf_null(), &self.lock_root()?))
    }
}

/// Reserves: nicks of NOCK and units of the token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reserves {
    pub nock: u64,
    pub tokens: u64,
}

impl Reserves {
    pub fn new(nock: u64, tokens: u64) -> Self {
        Self { nock, tokens }
    }

    /// The constant product, as a 256-bit value `(hi, lo)`.
    pub fn product(&self) -> (u128, u128) {
        mul_wide(self.nock as u128, self.tokens as u128)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PoolError {
    #[error("fee {0} bps exceeds 10000")]
    FeeTooHigh(u64),
    #[error("a pool must hold both assets")]
    EmptyReserve,
    #[error("trade too small: the covenant admits no output for it")]
    NoOutput,
}

const MASK: u128 = (1u128 << 64) - 1;

/// 128x128 -> 256 multiplication, as `(hi, lo)`.
pub fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    let (a_hi, a_lo) = (a >> 64, a & MASK);
    let (b_hi, b_lo) = (b >> 64, b & MASK);
    let ll = a_lo * b_lo;
    let lh = a_lo * b_hi;
    let hl = a_hi * b_lo;
    let hh = a_hi * b_hi;
    let (s1, c1) = ll.overflowing_add(lh << 64);
    let (lo, c2) = s1.overflowing_add(hl << 64);
    let hi = hh + (lh >> 64) + (hl >> 64) + c1 as u128 + c2 as u128;
    (hi, lo)
}

/// Exactly the covenant's arithmetic. `before` is the sum over every input
/// at the pool lock; `after` the successor note.
pub fn invariant_holds(before: Reserves, after: Reserves, fee_bps: u64) -> bool {
    if fee_bps > FEE_DENOMINATOR || after.nock == 0 || after.tokens == 0 {
        return false;
    }
    let b = FEE_DENOMINATOR as u128;
    let fee = fee_bps as u128;
    let (x, y) = (before.nock as u128, before.tokens as u128);
    let (x1, y1) = (after.nock as u128, after.tokens as u128);
    let dx = x1.saturating_sub(x);
    let dy = y1.saturating_sub(y);
    // b*x1 >= fee*dx because dx <= x1 and fee <= b; same for y.
    let left = b * x1 - fee * dx;
    let right = b * y1 - fee * dy;
    let lhs = mul_wide(left, right);
    let rhs = mul_wide(b * b * x, y);
    lhs >= rhs
}

/// The most tokens the covenant lets leave when the NOCK reserve becomes
/// `nock_after` (what came in, less any nicks paid out with the tokens).
pub fn max_tokens_out(before: Reserves, nock_after: u64, fee_bps: u64) -> Result<u64, PoolError> {
    if before.nock == 0 || before.tokens == 0 {
        return Err(PoolError::EmptyReserve);
    }
    // Monotone: the more that leaves, the smaller the product. Binary search
    // the largest admissible amount; the covenant is the predicate.
    let ok = |out: u64| invariant_holds(before, Reserves::new(nock_after, before.tokens - out), fee_bps);
    if !ok(0) {
        return Err(PoolError::NoOutput);
    }
    let (mut lo, mut hi) = (0u64, before.tokens - 1); // y1 >= 1
    while lo < hi {
        let mid = lo + (hi - lo + 1) / 2;
        if ok(mid) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    if lo == 0 {
        Err(PoolError::NoOutput)
    } else {
        Ok(lo)
    }
}

/// The most nicks the covenant lets leave when the token reserve becomes
/// `tokens_after`.
pub fn max_nock_out(before: Reserves, tokens_after: u64, fee_bps: u64) -> Result<u64, PoolError> {
    if before.nock == 0 || before.tokens == 0 {
        return Err(PoolError::EmptyReserve);
    }
    let ok = |out: u64| invariant_holds(before, Reserves::new(before.nock - out, tokens_after), fee_bps);
    if !ok(0) {
        return Err(PoolError::NoOutput);
    }
    let (mut lo, mut hi) = (0u64, before.nock - 1);
    while lo < hi {
        let mid = lo + (hi - lo + 1) / 2;
        if ok(mid) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    if lo == 0 {
        Err(PoolError::NoOutput)
    } else {
        Ok(lo)
    }
}

/// Which way value flows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    /// NOCK in, tokens out.
    Buy,
    /// Tokens in, NOCK out.
    Sell,
}

/// A quote: what the taker pays, what the taker gets net, the two fee
/// shares, the prices, and what the trade does to the pool. Every number
/// is what the covenant will accept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quote {
    pub side: Side,
    /// What the trader pays: nicks on a buy, tokens on a sell.
    pub amount_in: u64,
    /// What the trader receives, net of both shares: tokens on a buy, nicks on a sell.
    pub amount_out: u64,
    /// The pool's share, retained in the reserves: nicks on a buy, tokens on a sell.
    pub pool_fee: u64,
    /// The treasury's share, in nicks, paid in the same transaction.
    pub lore_fee: u64,
    /// The miner fee the trader's own spend pays: not part of the trading fee.
    pub network_fee: u64,
    /// Nicks per token before, scaled by 1e9, from the reserves.
    pub spot_before_e9: u128,
    /// Nicks per token this trade executes at, scaled by 1e9 (net of fees).
    pub execution_e9: u128,
    /// How far the execution price sits from the spot price, in basis points.
    pub price_impact_bps: u128,
    pub before: Reserves,
    pub after: Reserves,
}

impl Quote {
    /// The fees charged in nicks: on a buy both shares (the pool's is
    /// retained from the NOCK paid); on a sell only the treasury's, since
    /// the pool's share of a sell is retained in tokens.
    pub fn nock_fees(&self) -> u64 {
        match self.side {
            Side::Buy => self.pool_fee + self.lore_fee,
            Side::Sell => self.lore_fee,
        }
    }
    /// The fees charged in tokens: the pool's share of a sell; none on a buy.
    pub fn token_fees(&self) -> u64 {
        match self.side {
            Side::Buy => 0,
            Side::Sell => self.pool_fee,
        }
    }
}

/// Quotes a buy: `nock_in` nicks arrive at the pool; `nock_to_taker` nicks
/// leave with the tokens (the dust a token note needs to exist). The
/// treasury's share comes off `nock_in` first; the rest is priced.
pub fn quote_buy(before: Reserves, nock_in: u64, nock_to_taker: u64, params: &PoolParams, network_fee: u64) -> Result<Quote, PoolError> {
    // the covenant's floor: the share of every nick crossing the boundary
    // other than the treasury payment: what is paid in plus the dust out
    let lore_fee = params.lore_share(nock_in.checked_add(nock_to_taker).ok_or(PoolError::NoOutput)?);
    let available = nock_in.checked_sub(lore_fee).ok_or(PoolError::NoOutput)?;
    let nock_after = before
        .nock
        .checked_add(available)
        .and_then(|v| v.checked_sub(nock_to_taker))
        .ok_or(PoolError::NoOutput)?;
    let tokens_out = max_tokens_out(before, nock_after, params.fee_bps)?;
    let after = Reserves::new(nock_after, before.tokens - tokens_out);
    let spot = (before.nock as u128 * 1_000_000_000) / before.tokens as u128;
    let exec = (nock_in as u128 * 1_000_000_000) / tokens_out as u128;
    let priced = available.saturating_sub(nock_to_taker);
    Ok(Quote {
        side: Side::Buy,
        amount_in: nock_in,
        amount_out: tokens_out,
        pool_fee: ((priced as u128 * params.fee_bps as u128) / FEE_DENOMINATOR as u128) as u64,
        lore_fee,
        network_fee,
        spot_before_e9: spot,
        execution_e9: exec,
        price_impact_bps: impact_bps(spot, exec),
        before,
        after,
    })
}

/// Quotes a sell: `tokens_in` arrive at the pool along with `nock_in` nicks
/// (the dust the seller's payment carries); the gross proceeds leave the
/// pool, the treasury's share of them is paid, and the seller gets the rest.
pub fn quote_sell(before: Reserves, tokens_in: u64, nock_in: u64, params: &PoolParams, network_fee: u64) -> Result<Quote, PoolError> {
    let tokens_after = before.tokens.checked_add(tokens_in).ok_or(PoolError::NoOutput)?;
    let nock_pool = before.nock.checked_add(nock_in).ok_or(PoolError::NoOutput)?;
    // the dust is NOCK coming in; it counts as such (fee and all)
    let gross = max_nock_out_from(before, nock_pool, tokens_after, params.fee_bps)?;
    // the share of the gross, plus the dust that crossed the boundary the
    // other way; above the covenant's floor, which is the share of the net
    let lore_fee = params.lore_share(gross + nock_in);
    let net = gross.checked_sub(lore_fee).ok_or(PoolError::NoOutput)?;
    if net == 0 {
        return Err(PoolError::NoOutput);
    }
    let after = Reserves::new(nock_pool - gross, tokens_after);
    let spot = (before.nock as u128 * 1_000_000_000) / before.tokens as u128;
    let exec = (net as u128 * 1_000_000_000) / tokens_in as u128;
    Ok(Quote {
        side: Side::Sell,
        amount_in: tokens_in,
        amount_out: net,
        pool_fee: ((tokens_in as u128 * params.fee_bps as u128) / FEE_DENOMINATOR as u128) as u64,
        lore_fee,
        network_fee,
        spot_before_e9: spot,
        execution_e9: exec,
        price_impact_bps: impact_bps(exec, spot),
        before,
        after,
    })
}

/// The covenant's floor for the treasury payment: `floor(lore * (gin + gout) / B)`.
pub fn lore_due(params: &PoolParams, nock_in: u64, nock_out_not_lore: u64) -> u64 {
    params.lore_share(nock_in.saturating_add(nock_out_not_lore))
}

fn max_nock_out_from(before: Reserves, nock_pool_after_in: u64, tokens_after: u64, fee_bps: u64) -> Result<u64, PoolError> {
    if before.nock == 0 || before.tokens == 0 {
        return Err(PoolError::EmptyReserve);
    }
    let ok = |out: u64| invariant_holds(before, Reserves::new(nock_pool_after_in - out, tokens_after), fee_bps);
    if !ok(0) {
        return Err(PoolError::NoOutput);
    }
    let (mut lo, mut hi) = (0u64, nock_pool_after_in - 1);
    while lo < hi {
        let mid = lo + (hi - lo + 1) / 2;
        if ok(mid) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    if lo == 0 {
        Err(PoolError::NoOutput)
    } else {
        Ok(lo)
    }
}

/// `(worse / better - 1)` in basis points, where a buy executes above spot
/// and a sell below it.
fn impact_bps(better: u128, worse: u128) -> u128 {
    if better == 0 {
        return 0;
    }
    (worse * 10_000 / better).saturating_sub(10_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(x: u64, y: u64) -> Reserves {
        Reserves::new(x, y)
    }

    #[test]
    fn wide_multiplication_matches_u128_where_it_fits() {
        assert_eq!(mul_wide(3, 4), (0, 12));
        let a = u64::MAX as u128;
        assert_eq!(mul_wide(a, a), (0, a * a));
        assert_eq!(mul_wide(1 << 100, 1 << 100), (1 << 72, 0));
        assert_eq!(mul_wide(u128::MAX, 1), (0, u128::MAX));
        assert_eq!(mul_wide(u128::MAX, 2), (1, u128::MAX - 1));
    }

    #[test]
    fn no_op_and_donation_hold_and_withdrawal_fails() {
        assert!(invariant_holds(r(1000, 1000), r(1000, 1000), 100));
        assert!(invariant_holds(r(1000, 1000), r(1001, 1000), 100));
        assert!(!invariant_holds(r(1000, 1000), r(999, 1000), 100));
        assert!(!invariant_holds(r(1000, 1000), r(1000, 999), 100));
        assert!(!invariant_holds(r(1000, 1000), r(0, 2_000_000), 100));
        assert!(!invariant_holds(r(1000, 1000), r(2_000_000, 0), 100));
    }

    #[test]
    fn zero_fee_is_plain_constant_product() {
        // 1000 in on (1000, 1000): out = 500 exactly.
        assert_eq!(max_tokens_out(r(1000, 1000), 2000, 0).unwrap(), 500);
        assert!(!invariant_holds(r(1000, 1000), r(2000, 499), 0));
    }

    #[test]
    fn fee_stays_in_reserves_and_one_unit_more_is_refused() {
        let before = r(1_000_000, 1_000_000);
        let fee = 100; // 1%
        let nock_in = 10_000;
        let out = max_tokens_out(before, before.nock + nock_in, fee).unwrap();
        // closed form: y - ceil(B x y / (B x1 - f dx))
        let b = 10_000u128;
        let num = b * before.nock as u128 * before.tokens as u128;
        let den = b * (before.nock + nock_in) as u128 - fee as u128 * nock_in as u128;
        let y1 = (num + den - 1) / den;
        assert_eq!(out, before.tokens - y1 as u64);
        assert!(!invariant_holds(before, r(before.nock + nock_in, before.tokens - out - 1), fee));
        // with the fee, fewer tokens leave than at zero fee
        let out0 = max_tokens_out(before, before.nock + nock_in, 0).unwrap();
        assert!(out < out0);
        // and the product grew
        let after = r(before.nock + nock_in, before.tokens - out);
        assert!(after.product() > before.product());
    }

    fn params(fee: u64, lore: u64) -> PoolParams {
        let t = TokenId(Hash::from_base58("2tqeQQXSWe5U7qCy4jprnGqrDEVrq4bK5669ShFSjRPzM1PuEFSr11f").unwrap());
        let lore_lock = Hash::from_base58("6Gn3zaAVYhto5qpVL84CpBQNGGokBxssUtZmw5879BESZVMdTmpEhfw").unwrap();
        PoolParams::new(t, fee, lore, lore_lock).unwrap()
    }

    #[test]
    fn quotes_round_trip_the_covenant() {
        let p = params(100, 50);
        let before = r(50_000_000, 2_000_000);
        let q = quote_buy(before, 1_000_000, 1000, &p, 8192).unwrap();
        assert!(invariant_holds(before, q.after, 100));
        assert!(!invariant_holds(before, r(q.after.nock, q.after.tokens - 1), 100));
        assert!(q.price_impact_bps > 0);
        // the treasury's share is 0.5% of what was paid (plus the dust), off the top
        assert_eq!(q.lore_fee, (1_000_000 + 1000) * 50 / 10_000);
        assert_eq!(q.after.nock, before.nock + 1_000_000 - q.lore_fee - 1000);
        assert!(q.lore_fee >= lore_due(&p, 1_000_000, 1000));
        let s = quote_sell(q.after, q.amount_out, 1000, &p, 8192).unwrap();
        assert!(invariant_holds(q.after, s.after, 100));
        assert!(!invariant_holds(q.after, r(s.after.nock - 1, s.after.tokens), 100));
        // the seller's net is the gross less the treasury's share of the gross
        let gross = q.after.nock + 1000 - s.after.nock;
        assert_eq!(s.amount_out, gross - s.lore_fee);
        assert!(s.lore_fee >= lore_due(&p, 1000, s.amount_out));
        assert!(s.amount_out < q.amount_in);
    }

    #[test]
    fn a_zero_treasury_share_is_the_plain_pool() {
        let p = params(100, 0);
        let before = r(1_000_000, 1_000_000);
        let q = quote_buy(before, 10_000, 1000, &p, 0).unwrap();
        assert_eq!(q.lore_fee, 0);
        assert_eq!(q.amount_out, max_tokens_out(before, before.nock + 10_000 - 1000, 100).unwrap());
    }

    #[test]
    fn a_tiny_trade_can_be_worth_nothing() {
        assert_eq!(max_tokens_out(r(1_000_000_000, 10), 1_000_000_001, 100), Err(PoolError::NoOutput));
        assert_eq!(quote_buy(r(1_000_000_000, 10), 2000, 1000, &params(100, 50), 0), Err(PoolError::NoOutput));
    }

    #[test]
    fn canonical_lock_is_a_function_of_token_and_fee() {
        let t = TokenId(Hash::from_base58("2tqeQQXSWe5U7qCy4jprnGqrDEVrq4bK5669ShFSjRPzM1PuEFSr11f").unwrap());
        let lore = Hash::from_base58("6Gn3zaAVYhto5qpVL84CpBQNGGokBxssUtZmw5879BESZVMdTmpEhfw").unwrap();
        let other = Hash::from_base58("CyjTA9Bz6oiepyYL4L4kyk3KPAtJRipnxkNZ7oDZSeygrevcLocA7wV").unwrap();
        let a = PoolParams::new(t.clone(), 100, 50, lore.clone()).unwrap();
        let b = PoolParams::new(t.clone(), 30, 50, lore.clone()).unwrap();
        let c = PoolParams::new(t.clone(), 100, 50, other).unwrap();
        assert_ne!(a.lock_root().unwrap(), b.lock_root().unwrap());
        assert_ne!(a.lock_root().unwrap(), c.lock_root().unwrap());
        assert_eq!(a.lock_root().unwrap(), PoolParams::new(t, 100, 50, lore.clone()).unwrap().lock_root().unwrap());
        assert!(PoolParams::new(a.token.clone(), 9_951, 50, lore).is_err());
    }
}
