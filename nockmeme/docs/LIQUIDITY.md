# Automated liquidity on Nockchain: what can be enforced, and by whom

**Where this stands.** This document was written first, against the node
as shipped, and its short answer then was that a pool protected by the
chain itself is not possible on Nockchain: a lock cannot see what the
spending transaction does with the note (§1). That finding stands for the
shipped node. The specification rules out every design that follows from
it (§3, §4: custodial reserves) and asks for the missing capability to be
named and built instead. It has been: `docs/ENFORCEMENT.md` is the proof
of the gap and the specification of the `%amm` covenant primitive added to
a fork of the transaction engine, `nockmeme/upstream/amm-covenant.patch` is
the change, and `results/RESULTS.md` §A15 is the pool running under it on a
fakenet, with the attacks the rule refuses. §5 below was the sketch of that
primitive; the built one differs in the details ENFORCEMENT.md gives.

§3 and §4 are kept as the record of what a key-based pool would be, and of
why it does not meet the requirement. They are not the recommendation.

Everything in §1 is read from the node's source at revision `2bcb0b9`.

## 1. What consensus provides

| capability | fact | where |
|---|---|---|
| lock primitives | exactly `%pkh` (m-of-n key hashes), `%tim` (absolute/relative timelock), `%hax` (hash preimage); `%brn` is unspendable. A lock is a Merkle tree of alternative spend-conditions, each a list of primitives that must all hold. | `tx-engine-1.hoon` 1521-1541, 2221-2270 |
| what a lock check can see | `[now since sig-hash witness bythos-phase]` and the lock itself. **Not** the outputs, amounts, recipients or note-data of the spending transaction. | `check-context`, 2221-2270 |
| covenants | none. No primitive constrains where value goes after a note is spent. | consequence of the above |
| note-data | arbitrary signed key/value on each note; merged by union when outputs merge; consensus does not interpret it. This is what the token standard uses. | FINDINGS §1–§3 |
| multi-party transactions | a signature covers only its own spend; `output-source` lets a seed pin the exact seed set that must land on a lock. Two parties can settle a trade in one transaction with nothing held by anyone in between. | `sig-hash` 1116; `validate` 1409-1419; SWAPS.md; `nmeme-tx swap` |
| spending unconfirmed outputs | not allowed: every input must be in the confirmed balance. | `inputs-in-balance`, `consensus.hoon` 324-338 |
| mempool admission vs validity | the mempool admits a transaction before the engine validates it; a pin-violating half was admitted, then failed `v1-tx-invalid` on every candidate block and was never mined. | seen live, `results/live/swap/` |
| mempool input reservation | an admitted transaction's inputs are reserved ("Inputs present in spent-by, discarding transaction") and stay reserved while it sits in the mempool, invalid or not — the invalid half was retried on fifty candidate blocks without being dropped. A signed half that leaks can therefore block the honest trade on the same notes until the mempool forgets it. | seen live |
| block cadence | mainnet ideal 150 s. | `blockchain_constants.rs` |
| bridge | an official NOCK bridge to **Base** (EVM) with multisig governance ships in this repository. | `crates/bridge/docs/` |

Two consequences matter for a pool:

- **Pricing cannot be enforced by consensus.** Whoever holds the reserve
  keys decides what trades to sign. The chain will accept any signed spend
  of the reserves, to anyone, at any price.
- **A pool's state advances once per block.** Each trade must spend the
  current reserve note, and its output is not spendable until mined. Serial
  trades therefore run at one per ~150 s unless a block's trades are batched
  into one transaction (§3.4).

## 2. What "a secure pool" means here

A pricing formula is a quote. A pool is enforced by whatever can refuse a
withdrawal. On this chain that is a key, so the design questions are:

1. who holds the reserve keys (custody);
2. what a key holder can do that the rules forbid, and whether anyone can
   tell (verifiability);
3. what a user risks inside a single trade (settlement).

Settlement (3) is solved trustlessly by the swap primitive: a user's spend
pins the exact seed the pool must pay them, and the pool's spend pins the
exact seed the user pays it. Either side missing or altered invalidates the
whole transaction. That holds for any design below. Custody (1) and
verifiability (2) are where the designs differ.

## 3. Design A — operator-settled pool, atomic trades, public reserves

Buildable now, on the note-data token standard and `nmeme-tx`/`nmeme-index`.

### 3.1 State on chain

The pool for token T is a set of notes at the **pool lock**: an `m`-of-`n`
`%pkh` lock over independent signer keys (start at 1-of-1 for development;
production is a committee, §3.6). The notes hold the NOCK reserve (assets)
and the token reserve (a `meme` claim). One designated note carries a
second note-data entry, `pool`, signed like everything else on the note:

```
pool: [version token-id reserve-nock reserve-token fee-bps curve seq]
```

`seq` increments per trade; `curve` names the formula (§3.3). This record is
not enforced by consensus, but it is on chain, signed by the pool key, and
committed to by every counterparty's pin, so the full trade history is
public and replayable.

### 3.2 A trade

A buy of tokens with `p` NOCK, at the state `(x, y)`:

- the user's spend: input a NOCK note; seed to the pool lock, gift `p`;
  change to the user; the change seed **pins** `{user change, pool→user}`,
  where `pool→user` is the exact token seed quoted (gift = dust, claim `q`);
- the pool's spend: input the reserve notes; seed to the user, claim `q`;
  seed to the pool lock with the new reserves and the new `pool` record;
  the pool's change seed pins `{pool change, user→pool}`.

A sell is the mirror image. Each party signs its own spend with its own
key; the pool signer signs only a spend whose `q` equals the curve's output
for `p` at the current `seq`. The user gets exactly `q` or the transaction
is invalid; there is no execution slippage beyond the quote, only the
possibility of non-inclusion.

The indexer already proves both sides of this: token conservation through
the `Indexer`, NOCK amounts through the note assets, provenance of every
input, and now the pins (`nmeme-tx pins`).

### 3.3 Pricing

Launch phase (bonding curve): constant product on **virtual** reserves,
`(x + X₀)(y + Y₀) = k`, with the whole supply minted at genesis to the pool
lock and `X₀, Y₀` chosen so the opening price and the graduation price are
what the platform wants. Every buy raises the price deterministically;
sells return NOCK along the same curve. Graduation at a NOCK-raised
threshold switches `curve` to constant product on **real** reserves; no
migration transaction is needed because the reserves already sit at the
pool lock.

Quote = fee (`fee-bps` of the input, kept in reserves or paid to a fee
lock), price impact (`q` versus the marginal price), and a slippage bound
that is moot for the user (§3.2) but still applies to *inclusion*: a quote
is valid for one `seq`, and a trade that misses its block is re-quoted.

### 3.4 Throughput: one transaction per pool per block

Because the reserve note can be spent once per block, the pool signer runs
as a **sequencer**: it collects trades against `seq`, and at block time
assembles one transaction with every user's spend plus one pool spend that
pays each user their fill and writes the next state. Fills are assigned in
receipt order and quoted individually; a user's pin covers only the pool's
seed *to that user*, so users sign in parallel after the fills are
published and a user who fails to sign is dropped without disturbing the
others (only the pool's own change seed, which the pool re-pins and
re-signs). Limits to measure on the fakenet: transaction size and fee for
`N+1` spends, and note-data size for the `pool` record (FINDINGS §4).

Consequence for the product: a trade confirms in one to two blocks
(~2.5–5 min on mainnet), with the exact fill known at signing time. The
sequencer can reorder or insert its own trades; with the order log published
and every state written on chain, that is detectable after the fact, not
preventable.

### 3.5 What enforces what

| property | enforced by | verifiable by anyone? |
|---|---|---|
| a user is never short-changed inside a trade | consensus (pins) | yes, `nmeme-tx pins` and the mined transaction |
| the price follows the curve | the pool signer's policy | yes: every state is on chain; the indexer recomputes each trade and flags any deviation |
| reserves match the state record | nothing but honesty | yes: reserves are notes at the pool lock; `nmeme-index` proves token reserves and reads NOCK reserves |
| no withdrawal except through trades | the key holders' policy | withdrawals are visible, not preventable |
| supply cannot be inflated | the token standard (indexer rejects it) | yes |

### 3.6 Custody, trust and infrastructure

- **Custody:** the platform. Reserves are at a key the platform's signers
  control; consensus offers no way to bind them to the curve.
- **Operator trust:** total for reserve safety, zero for settlement. A
  committee lock (`m`-of-`n` `%pkh` across separately operated signers,
  HSM-backed) and published proof of reserves reduce it to "the committee
  will not collude". A `%tim` path can add a cold-key recovery branch.
- **Liquidity providers:** at launch, buyers — the curve is the only LP.
  Do **not** take third-party LP deposits under this design: they would be
  unsecured loans to the committee, with no LP token consensus could honour.
- **Infrastructure:** a pool signer service (key management, curve policy,
  sequencing, batching), a quote API, the indexer extended with pool
  state, trade history, candles, volume, market cap and liquidity, a
  confirmation tracker, and the existing user-side signing flow
  (`sign-hash` in the user's wallet; the user never hands over a key).
- **Consensus changes:** none.

## 4. Design B — launch curve into pool

Design A with the launch phase first: genesis mints the supply to the pool
lock, the curve sells it for NOCK, graduation flips the formula. Same
custody, same enforcement table. This is the familiar launch-and-trade
flow; nothing in it is trustless at the reserve level, and it should be
described that way.

## 5. Design C — a covenant primitive (consensus change; built in the fork)

*This section is the original sketch. The primitive as built — its exact
rule, the conservation and destination checks, and the context it reads —
is specified in `docs/ENFORCEMENT.md` §3–§4; the fork's kernels run it on
the fakenet in `results/RESULTS.md` §A15.*

What would make a pool trustless is a lock primitive that can see the
spending transaction's outputs. The hook is `check-context`: today it is
`[now since sig-hash witness bythos-phase]`; a `%cov` primitive would need
the normalized seed set landing on chosen locks (the same set `validate`
already hashes for `output-source`), and a rule such as:

> the outputs at the pool lock carry assets `x'` and claim `y'` with
> `x'·y' ≥ (1 + fee)·x·y`, the `pool` record's `seq` is `seq + 1`, and
> nothing else leaves the lock.

That makes pricing and reserve protection consensus-enforced and lets
anyone trade against the pool without an operator. Cost: a hard fork of the
Hoon transaction engine, wallet support, and whatever proof pipeline the
network runs over transactions. It is an upstream proposal, written here so
it can be raised with the Nockchain maintainers, not a plan this repository
can execute.

## 6. Design D — trade on Base over the official bridge

Nockchain ships a governed NOCK bridge to Base. On Base, trustless AMMs and
bonding-curve launchers are commodity infrastructure. Memecoins would be
ERC-20s, pools would be enforced by EVM contracts, and NOCK would be the
bridged asset. What is given up: the tokens no longer live on Nockchain,
the note-data standard and its verification tooling are not used for
trading, and reserve trust moves to the bridge's own multisig (which exists
regardless). What is gained: the exact target experience with pool
security that does not depend on the platform.

## 7. Recommendation

*Superseded.* Platform custody was not acceptable, and the covenant path
(§5) has been built and tested; see `docs/ENFORCEMENT.md`. What remains
of this section is the reasoning as it stood before that.

The product as specified — automatic quotes, a pool to buy from and sell
into, no counterparties — cannot be given consensus-level reserve safety on
Nockchain as shipped. The decision was whether platform custody of
reserves is acceptable.

- **If yes:** build Designs A/B natively. It keeps the tokens on Nockchain,
  reuses everything verified so far (the standard, provenance-checked
  rebuilds, the atomic-settlement primitive), makes every trade and every
  state public and replayable, and confines trust to the reserve committee.
  Say "custodial reserves, atomic settlement, public state" in the product.
- **If no:** Design D now, and Design C raised upstream. Do not build a
  native pool and call it trustless.

An individual-offer marketplace is not proposed. The swap primitive stays
as the settlement layer of Designs A/B, not as the product.

## 8. If Design A/B is chosen: the backend, in order

1. Fakenet measurements: transaction size/fee for `N+1` spends, `pool`
   record size, confirmation latency under batching.
2. Pool signer: key management, curve policy, `seq`-serialized batching,
   refusal rules (a spend that is not the curve's output is never signed).
3. Quote API: fee, price impact, `seq`, expiry.
4. Indexer: `pool` record decoding, per-trade curve verification, reserves,
   trade history, candles, volume, market cap, liquidity.
5. Launch flow: genesis to the pool lock, curve parameters, graduation.
6. Committee lock and proof-of-reserves publication.
