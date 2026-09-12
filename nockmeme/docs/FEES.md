# Trading fees and the Lore Wallet

## 0. The proposal

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
per pool at launch and cannot be changed afterwards (§4). **The split is a
proposal**: the numbers above ran on the fakenet and are what the evidence
shows, and nothing in the design depends on them being these.

The network fee — what the trader's own spend pays the miner — is not part
of the 1.5 %. It is disclosed separately on every quote (`network_fee`),
because it is paid to the miner from the trader's own note and is set by
the trader, not the platform. A covenant trade is larger than a plain
transfer (the keyless witness and the treasury seed); on the fakenet it
needs 16,384 nicks where a transfer needs 8,192 (seen live: the engine's
`v1-insufficient-fee`, `results/RESULTS.md` §A16). The chain's rule is a
word count, and the tooling now applies it exactly.

**Verified live** (`results/RESULTS.md` §A16): five trades at these rates,
the Lore Wallet's balance equal to the sum of the quoted shares after each
one, every note there plain NOCK; a trade that short-changes the treasury
by one nick and one that sends it tokens both refused by the chain.

## 1. The exact calculation, by direction

`B = 10000`. `pool = 100`, `lore = 50` (basis points; a proposal, §0). All
arithmetic is on integers; `⌊ ⌋` is the floor. Nothing is ever rounded in
the trader's favour, and no fee is ever collected twice.

### Buy: nicks in, tokens out

| step | value | unit |
|---|---|---|
| the trader pays | `P` | nicks |
| the dust that travels to the trader with the tokens | `d` (1,000 on the fakenet) | nicks |
| **treasury share** | `L = ⌊(P + d) · lore / B⌋` | nicks, paid to the Lore lock in the same transaction |
| priced amount | `A = P − L − d` | nicks |
| **pool share** | `F = ⌊A · pool / B⌋` | nicks, retained in the reserves (not a payment: it is the part of `A` the curve does not count) |
| reserves after | `x1 = x + A`, and `y1` the least value with `(B·x1 − pool·(x1 − x)) · B·y1 ≥ B²·x·y` | nicks, tokens |
| **tokens out, net** | `y − y1` | tokens |
| network fee | what the trader's spend pays the miner (16,384 on the fakenet) | nicks, disclosed separately |

The `d` nicks are counted in the treasury's base because they cross the
pool's boundary; they are 0.5 % of 1,000 = 5 nicks.

### Sell: tokens in, nicks out

| step | value | unit |
|---|---|---|
| the trader pays | `T` | tokens |
| the dust the trader's payment carries into the pool | `d` | nicks |
| **pool share** | `F = ⌊T · pool / B⌋` | **tokens**, retained in the reserves (the curve counts `T − F`) |
| gross proceeds | `G`, the most the curve pays: the largest value with `(B·(x + d − G)) · (B·(y + T) − pool·T) ≥ B²·x·y` | nicks |
| **treasury share** | `L = ⌊(G + d) · lore / B⌋` | nicks, paid to the Lore lock in the same transaction |
| **nicks out, net** | `G − L` | nicks |
| reserves after | `x1 = x + d − G`, `y1 = y + T` | nicks, tokens |
| network fee | as above | nicks, separate |

The chain's floor for `L` is the same formula: `⌊base · lore / B⌋` with
`base = gin + gout` on a buy (`gin` the nicks paid into the pool by the
trader's spend, `gout` the nicks the pool pays to anyone but the
treasury: `P + d`) and `base = gin + gout + L` on a sell (`d + (G − L) + L
= d + G`). Quote, covenant and replay share one calculation
(`nmeme_core::pool::lore_due`, `++  amm` in the patch); the replay reports
`paid` and `due_floor` per trade and they are equal on every trade of the
live runs. (The first prototype's floor excluded `L` from a sell's base and
sat 0.25 bps under the quote; review of pack 5 asked for identity.)

## 2. What the quote shows

For every trade, before signing (`nmeme-tx pool-trade`, the `QUOTE` line),
each with its unit:

| field | meaning |
|---|---|
| `in` | what the trader pays (nicks on a buy, tokens on a sell) |
| `out_net` | what the trader receives after both shares (tokens on a buy, nicks on a sell) |
| `pool_fee` | the pool's share, retained in the reserves: **nicks on a buy, tokens on a sell** |
| `lore_fee` | the treasury's share, always nicks |
| `nock_fees` | every fee charged in nicks: both shares on a buy, the treasury's alone on a sell |
| `token_fees` | every fee charged in tokens: the pool's share on a sell, none on a buy |
| `network_fee` | nicks the trader's own spend pays the miner, outside the trading fee |
| `spot_e9`, `exec_e9`, `impact_bps` | mid price before, execution price net of fees, their distance in basis points |

There is no single "total fee" on a sell, because its two shares are in
different units; the quote lists both. A percentage of "the trade" can be
stated only after choosing a price to convert one into the other, and the
quote does not do that for the trader.

**Slippage protection is exact.** The trader's own spend pins the
complete seed set that must land on their lock (`docs/SWAPS.md`): the
transaction is valid only if they receive precisely `out_net`, or it is not
mined at all. What can happen is non-inclusion — another trade spends the
pool note first — and then the trader re-quotes.

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
  pool's boundary in the transaction: the NOCK paid in by the trader's
  spend plus the NOCK the pool pays to anyone but the Lore Wallet, and on
  a sell the Lore payment itself (it comes out of the gross proceeds);
- that output carries no `meme` entry (NOCK only);
- the pool's seeds go only to the pool lock, the Lore lock, or a lock the
  trader's spend also pays.

`N` is the NOCK paid on a buy plus the nicks that travel with the tokens,
and on a sell the dust paid in plus the gross proceeds (the seller's net
plus the Lore payment): the covenant tells the direction from the
reserves (`x1 < X` is a sell). The quote pays exactly `N`'s share in both
directions (§1). Both rates and the Lore lock are in the pool's lock root:
they cannot be changed, and no key exists that could move reserves or
redirect the share.
