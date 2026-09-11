# Trading fees and the Lore Wallet

## The proposal

| | rate | where it goes |
|---|---|---|
| pool share | **1.00 %** (100 bps) | stays in the traded coin's pool, as reserves |
| Lore share | **0.50 %** (50 bps) | the Lore Wallet, in NOCK |
| **total** | **1.50 %** (150 bps) per buy or sell | disclosed as one number |

Why these numbers. The requirement is a total of 1–2 % with most of it in
the pool. 1 % to the pool is the rate the first pool suite ran at
(`results/RESULTS.md` §A15), so its effect on price impact and on the
growth of the constant product is measured, not guessed; it is also the
rate users of constant-product pools elsewhere expect. A third of the
total to the treasury keeps "most" unambiguous while making the treasury
material: at fakenet scale one 10-NOCK buy adds 0.05 NOCK to the Lore
Wallet, and every trade adds something. 1.5 % sits in the middle of the
allowed band, leaving room to move either way after mainnet data without
leaving it. Both rates are parameters of the pool's lock, so the choice is
per pool at launch and cannot be changed afterwards (§4).

The network fee — what the trader's own spend pays the miner — is not part
of the 1.5 %. It is disclosed separately on every quote (`network_fee`),
because it is paid to the miner from the trader's own note and is set by
the trader, not the platform.

## 1. What the fee is charged on

Every trade has a NOCK side: the NOCK a buyer pays, or the gross NOCK a
seller's tokens fetch. Both shares are charged on that side, and the Lore
share is taken first:

- **Buy.** The buyer pays `P` nicks. The Lore share `L = ⌊P · 50 / 10000⌋`
  is deducted; `P − L` is what the trade is priced on; the pool share is
  the 1 % of `P − L` that the curve does not count, and it stays in the
  reserves.
- **Sell.** The seller's tokens fetch `G` nicks gross from the curve, of
  which the pool share was already retained on the token side. The Lore
  share `L = ⌊G · 50 / 10000⌋` is deducted and the seller receives `G − L`.

Everything is integer arithmetic with floors. The remainder of a floor
stays where the value already is: in the pool on buys, with the seller's
gross on sells. Nothing is rounded up against the trader.

## 2. What the quote shows

For every trade, before signing (`nmeme-tx pool-trade`, `QUOTE` line):

| field | meaning |
|---|---|
| `in` | what the trader pays (nicks on a buy, tokens on a sell) |
| `out` | what the trader receives, **net**: after both shares |
| `pool_fee` | the 1 % share retained in the pool |
| `lore_fee` | the 0.5 % share paid to the Lore Wallet, in nicks |
| `total_fee` | the two together, the disclosed 1.5 % |
| `spot`, `exec`, `impact_bps` | mid price before, execution price, their distance |
| `network_fee` | the miner fee the trader's spend pays, separately |

**Slippage protection is exact.** The trader's own spend pins the
complete seed set that must land on their lock (`docs/SWAPS.md`): the
transaction is valid only if they receive precisely `out`, or it is not
mined at all. There is no "minimum received" below the quote, because
nothing below the quote can be mined. What can happen is non-inclusion —
another trade spends the pool note first — and then the trader re-quotes.

## 3. The Lore Wallet

- **What it is.** One lock, the same for every pool, that receives the
  Lore share of every trade in NOCK. Its lock root is a parameter of every
  pool's covenant, so a pool that named a different treasury would have a
  different address and would not be the platform's pool.
- **What it receives.** NOCK only. The covenant refuses a transaction that
  leaves a token claim on the Lore lock (§4), so no memecoin can be sent
  to it inside a trade, and nothing needs converting: the share is taken
  from the NOCK side that every trade has.
- **What it starts with.** Nothing. Its first nick is the Lore share of the
  first trade.
- **Who controls it.** A key. The Lore lock is an ordinary `%pkh` lock over
  a key the platform holds (on the fakenet, the `lore` wallet's key; on
  mainnet, a committee `m`-of-`n` lock over separately held keys is the
  right shape). **Whoever holds that key can spend the Lore Wallet.** The
  requirement that it remain untouched is a commitment the key holders
  make, not something the chain enforces; the chain enforces only that
  every trade pays into it. It must therefore be described as
  *held, not locked*: "the Lore Wallet has never been spent" is a claim
  anyone can verify on chain at any time, "the Lore Wallet cannot be
  spent" would be false. It is not a burn: a `%brn` lock would make the
  fee unspendable forever, which is not what was asked.
- **How it is verified.** Its balance is the set of unspent notes at its
  first name, readable from any node (`nmeme-index funding --lock <lore
  lock>`); every note there is `plain` (no claim) by construction, and the
  replay (`nmeme-index pool-replay`) recomputes the share every trade owed
  and checks the transaction paid it.

## 4. What consensus enforces

The pool covenant (`docs/ENFORCEMENT.md` §3) is
`[%amm tid fee lore lore-lock]`. Beyond the constant-product rule with the
pool share, the spend of a pool note is valid only if:

- the merged output at the Lore lock in the same transaction holds at
  least `⌊lore · N / 10000⌋` nicks, where `N` is every nick that crosses the
  pool's boundary in the transaction other than the Lore payment itself —
  the NOCK paid in by the trader's spend plus the NOCK the pool pays to
  anyone but the Lore Wallet;
- that output carries no `meme` entry (NOCK only);
- the pool's seeds go only to the pool lock, the Lore lock, or a lock the
  trader's spend also pays.

`N` is exactly the NOCK paid on a buy (plus the nicks that travel with the
tokens) and the seller's net proceeds on a sell, so the on-chain minimum
is the full share on buys and the share of the *net* proceeds on sells —
0.25 bps under the share of the gross. The client always pays the share of
the gross (§1), which is above the minimum; the replay checks the client's
figure, the chain checks the floor. Both rates and the Lore lock are in
the pool's lock root: they cannot be changed, and no key exists that could
move reserves or redirect the share.
