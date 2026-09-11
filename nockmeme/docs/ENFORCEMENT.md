# What Nockchain can enforce about a pool, and what had to be added

> **Status: a fork-only prototype.** Everything below the shipped-node
> analysis runs on a modified Nockchain node and is **not deployable on the
> unchanged mainnet**. No separate public chain has been launched or is
> proposed, and native NOCK is not replaced by anything: the fakenet here
> is a private test network of one node. For the pool to exist on mainnet
> the change has to be adopted upstream, by the Nockchain maintainers, as a
> consensus upgrade with an activation height, and every node has to run
> it; §8 sets out that path and what can exist on mainnet until then.

**Short answer.** As shipped (revision `2bcb0b9`), Nockchain cannot enforce
any of the pool rules. A note's lock is checked against `[now since
sig-hash witness bythos-phase]` and nothing else; it cannot see what the
spending transaction does with the note. Every lock is therefore either a
key (`%pkh`), a clock (`%tim`), a secret (`%hax`), or unspendable (`%brn`),
and a pool whose reserves are spendable but not by any key is not
expressible. That is the precise missing capability: **a lock primitive
whose check receives the spending transaction**, its inputs and its merged
outputs. This repository adds one, `%amm`, to a fork of the transaction
engine, rebuilds the node from it, and tests the pool against it on a
fakenet. This document is the proof of the gap and the specification of
the change. `results/RESULTS.md` §A15 holds the test evidence.

Line numbers are into `hoon/common/tx-engine-1.hoon` at `2bcb0b9` unless
another file is named.

## 1. What consensus checks when a note is spent

A v1 transaction is a map from input note names to spends
(`++  spends`, 1151); each spend carries a witness, a set of seeds (the
outputs it creates: lock-root, note-data, gift, parent-hash; `++  seed`,
654) and a fee. `validate-with-context` (1226–1276) is the only place a
lock is evaluated. For every input it:

1. finds the note in the balance (1240);
2. checks each seed's `parent-hash` is the note's hash (1252–1255);
3. builds a `check-context` from the page number, the note's origin page,
   the spend's `sig-hash`, the witness and the bythos phase (1264–1269),
   and hands it with the note's first name to `check:check-context`
   (1271–1272);
4. checks the gifts plus fee equal the note's assets (1273).

`check:check-context` (2232–2270) verifies the witness's Merkle proof
against the lock root, then requires every primitive of the revealed
spend-condition to hold. The primitives are the closed set at 1516–1525:

| primitive | what it checks | against |
|---|---|---|
| `%pkh` | m-of-n Schnorr signatures | the spend's `sig-hash` (2064) |
| `%tim` | absolute or relative height bounds | `now`, `since` (2112) |
| `%hax` | preimages | the witness's preimage map (2149) |
| `%brn` | always false | — |

The context (2221–2230) carries no seed, no output, no other spend and no
amount. `sig-hash` (1116) is a hash over the spend's own seeds and fee; a
primitive can bind a *signer* to those, but there is no primitive that
constrains them without a signer. The outputs are computed after the fact
in `build-outputs` (2333–2400), merged per lock-root with note-data
unioned; the only rule ever applied to them is the `output-source` pin
(`validate:output`, 1404–1419), which lets a *spender* insist on the seed
set that lands on a lock. A pin is a promise a signer makes about someone
else's payment. Nothing lets a note make a promise about its own successor.

## 2. Why no key-based design meets the requirement

The requirement is: reserves leave only through rule-enforced trades, no
administrative withdrawal, and nobody holds a key that can drain the pool.

- A `%pkh` lock, single or committee, is a key. Whoever satisfies it can
  spend the reserves to any lock at any price; consensus checks the
  signature and the arithmetic of gifts, nothing about the counterparty.
  A signing service is this with a policy in front of it; the policy is
  not consensus. This is exactly the design `docs/LIQUIDITY.md` §3 called
  custodial, and it is ruled out by the specification.
- A `%tim` or `%hax` lock makes the reserves spendable by *anyone* who
  meets the clock or knows the secret, with no rule on what they do next.
- A `%brn` lock cannot be spent, so it cannot trade.
- A lock tree over these is an OR of the above.

So the pool cannot be built on the shipped primitives, and no amount of
off-chain machinery changes that: the chain will accept any spend the
lock admits. What is missing is one primitive, and its shape is fixed by
the requirement: it must be **keyless**, so that nobody holds a drain, and
**transaction-aware**, so that the rule it enforces is about what the
transaction does with the reserves.

## 3. The primitive: `%amm`

`[%amm tid fee lore lore-lock]`, where `tid` is the token's transfer-claim
id under the note-data token standard (`docs/SPEC.md`), `fee` is the
pool's share in basis points, `lore` the treasury's share in basis points
and `lore-lock` the treasury's lock root (the Lore Wallet, `docs/FEES.md`).
A pool for token `T` is any note under the lock whose only spend-condition
is `~[[%amm T fee lore lore-lock]]`. The lock root is a pure function of
those four values, so anyone recomputes the pool's address and refuses one
that lives anywhere else — in particular one whose lock tree has a second
branch with a creator's key, or one that names a different treasury.

The spend of such a note is valid if and only if, writing `X`, `Y` for the
NOCK assets and token claims summed over **every** input of the
transaction at that lock, and `x1`, `y1` for the one output note the
transaction leaves at that lock (`build-outputs` merges everything paid to
a lock into one note):

```
(B·x1 − fee·max(x1−X, 0)) · (B·y1 − fee·max(y1−Y, 0))  ≥  B·B·X·Y,   B = 10000
x1 > 0,  y1 > 0
```

and, in the same transaction:

- the pool spend's miner fee is zero (reserves cannot leave as fees);
- every seed of the pool spend pays the pool lock, the treasury lock, or a
  lock that another spend of the transaction also pays (a counterparty
  shows itself by paying its own change; nothing leaves the pool towards a
  lock no party to the transaction pays);
- the output at the treasury lock holds at least `⌊lore · N / B⌋` nicks,
  where `N` is the NOCK paid into the pool lock by the other spends plus
  the NOCK the pool spends pay to anyone but the pool and the treasury —
  every nick that crosses the pool's boundary other than the treasury
  payment itself — and that output carries no `meme` entry: the treasury
  is paid in NOCK and nothing else;
- every `meme` entry on every input and every output is a transfer claim
  of `T` (no genesis claims, no other tokens: the token standard would
  otherwise reject the whole transfer while consensus had already moved
  the NOCK), and the total of those claims over the outputs equals the
  total over the inputs.

That last rule only counts claims; it does not say where they came from.
Review of the first prototype found the hole (`results/RESULTS.md` §A17):
a note carrying a *fabricated* transfer claim of `T` — an ordinary
transaction whose seed carried `[%0 %t T 500000]` with no token input —
was mined, because consensus never validated claims, and selling it into
the pool released real NOCK. The fix is that consensus validates every
claim on every transaction (`++  meme` in the patch):

- a genesis claim is `[%0 %c ticker decimals amount tid]`, valid only if
  no input carries a `meme` entry and `tid` equals the id derived from the
  transaction's anchor input, the ticker and the decimals (the same
  derivation the indexer uses, transcribed to Hoon);
- for every token id, the transfer claims on a transaction's outputs may
  not exceed the transfer and genesis claims of that id on its inputs;
- a malformed entry counts for nothing.

A transaction breaking either rule is refused (`v1-token-claims`). So a
claim on a mined note is backed by an unbroken history to a genesis, and
the covenant's count is a count of real tokens. This makes the token
standard's no-inflation rule a consensus rule for every transaction, not
only for pool trades.

The inequality is the constant product with the fee charged on the input
side: the fee share of whatever comes in does not count towards the
price, and nothing is paid out of it, so it stays in the reserves and the
product grows by it on every trade. That is the entire mechanism by which
"trading fees strengthen each coin's own liquidity": there is no fee
account, no distribution, no cut for anyone, because there is nowhere for
a cut to go. A withdrawal (`x1 < X` with `y1 = Y`, or any output below the
curve) violates the inequality. A no-op spend that leaves the reserves as
they were satisfies it, which is harmless. Summing over every input at the
lock means two pool notes spent together must be answered by one successor
worth at least their combined product, so merging notes at the lock cannot
release value; a donation to the lock is absorbed into the reserves and
cannot be taken back.

The arithmetic is exact: Hoon atoms are unbounded, so the chain evaluates
the products in full. A client computes the largest output the inequality
admits (`nmeme-core::pool`, a 256-bit product and a binary search over the
predicate) and one unit more is refused. Rounding therefore always favours
the pool, and by construction rather than by policy.

## 4. What changed, exactly

The complete diff against `2bcb0b9` is `nockmeme/upstream/amm-covenant.patch`.
Everything else in the node is untouched: the hashing of the existing
primitives, the block format, the mempool, the proof pipeline, the wallet's
signing.

| file | change |
|---|---|
| `hoon/common/tx-engine-1.hoon` | `[%amm amm]` added to `lock-primitive` (`based`, `hashable` arms); a `++  amm` core with `based`, `hashable` (`[hash+tid leaf+fee leaf+lore hash+lore-lock]`), `claim`, `foreign` and `check`; `check-context` gains a last field `amm=(unit [note sps balance page])` that `validate-with-context` fills; `check:check-context` dispatches `%amm` to `check:amm` (`check-multisig-lock` refuses it); `build-outputs` is lifted out of `new:tx` so the covenant reads the outputs exactly as consensus builds them. |
| `hoon/apps/wallet/lib/utils.hoon` | the wallet's lock display gains an `%amm` arm (an exhaustive switch; the wallet kernel would not compile without it). |
| `crates/nockchain-types/src/tx_engine/v1/tx.rs` | `LockPrimitive::Amm(Amm { token_id, fee_bps, lore_bps, lore_lock })` with noun encode/decode and the same `hashable` digest, so tooling computes the same lock root as the chain. |
| `crates/wallet-tx-builder/src/word_count.rs` | the transaction-size estimator learns the primitive's size (an exhaustive match). |
| `crates/nockapp-grpc-proto` | `AmmLock` in the `LockPrimitive` oneof and its conversions, so a transaction carrying the witness can be submitted over gRPC. |

For a real deployment this is a hard fork: a node without the change
rejects the tag. Mainnet would gate it on an activation height the way
`bythos-phase` and `parent-hash-phase` gate the other v1 changes
(`validate-with-context`, 1226–1233); the fakenet here runs it from
genesis. It needs the maintainers' review, Hoon unit tests in
`hoon/tests/dumb`, and wallet support for building the keyless spend
(this repository builds it in `nmeme-tx` instead).

## 5. The rest of the requirement, under the primitive

| requirement | how it is met |
|---|---|
| dedicated NOCK/token pool per coin | one lock per `(token, fee)`; the reserves are one note |
| automatic prices, quotes with fee and impact | `nmeme-core::pool::quote_buy/quote_sell`: the exact fill the covenant admits, the fee share, spot and execution price, impact in bps |
| 1–2% fee, most to the pool, a smaller share to the treasury | `fee` and `lore` are lock parameters; `docs/FEES.md` proposes 100 + 50 bps. The suite runs those on the main pool |
| the pool's share stays in the pool; the treasury's share arrives in NOCK | the inequality keeps the pool's share in the reserves; the treasury rule requires the payment in the same transaction, in NOCK only, at the lock the covenant names |
| no admin withdrawal, creator cannot drain, change rules or unlock | the lock has no key and no other branch; the rule is in consensus; the fee is in the lock root |
| defined initial reserves | the opening transaction: the creator's NOCK and tokens paid to the pool lock, both required (`x1 > 0`, `y1 > 0` on every successor, and a pool with a zero reserve admits every spend, so a pool must be born with both) |
| sell payouts backed by real NOCK | reserves are the note's assets; a sell pays out of them and the inequality bounds it. No virtual reserves: nothing is quoted that the note does not hold |
| bonding curve / graduation | not used. The pool is a real-reserve constant-product market from its first block; there is nothing to graduate |
| fees scoped to pool trades | the rule lives in the pool's lock; ordinary transfers of the token are untouched |
| operating costs funded separately | the pool pays nothing to anyone: the trader pays the miner fee from their own spend, and the covenant requires the pool spend's fee to be zero |
| "locked" means nobody can withdraw, not a price guarantee | the rule bounds the product, not the price; a sell moves the price down like any trade |

## 6. Properties to know

- **One trade per pool per block.** A pool note is spent once per block;
  the second transaction spending it is invalid once the first is mined.
  A batcher can put many user spends and one pool spend in one
  transaction: each user's pin protects their own fill, the covenant checks
  the sum. This is `docs/LIQUIDITY.md` §3.4 without the operator's key.
- **Mempool admission is not validity**, and an admitted transaction keeps
  its inputs reserved while it sits there (seen live, `results/RESULTS.md`
  §A14). A *covenant* violation is a lock failure, which the mempool
  evaluates on admission, so every such trade was refused on arrival and
  reserved nothing (§A15–A16); a transaction that fails a later check
  (an insufficient miner fee, a violated pin) is admitted and does hold
  its inputs. A client should never submit a trade the quote does not
  admit, and should pay the exact network fee the tooling computes.
- **A fabricated claim on a payment to the pool is harmless.** Consensus
  unions the note-data of every seed landing on a lock; if the pool's own
  claim wins the union the transaction is an ordinary trade, and if the
  fabricated one wins the covenant's conservation check refuses it. Both
  were observed: mined as an honest trade in phase two, refused at
  admission in phase three (`results/RESULTS.md` §A16, §A19,
  `inflate-claim`); which one happens depends on the seeds' fold order.
  Nothing is minted either way.
- **A note at the pool lock holding only one asset** (someone paid NOCK
  alone, or tokens alone, to the lock outside a trade) has product zero
  and can be spent by anyone who leaves both reserves positive. The pool's
  own note never has a zero reserve, so this concerns stray payments only;
  a client pays the pool lock only inside a trade.
- **Reorganisations.** The pool is a note; a reorganisation replaces the
  canonical chain and with it the note set, and the covenant is evaluated
  again in every block of the new chain. A trade in an orphaned block
  never happened, like any transaction, and a client waits for the
  confirmations it wants before treating a fill as final. Nothing about
  the pool state lives outside the chain.
- **The fee cannot be changed.** It is in the lock root. Choosing the rate
  is choosing which pool to open; migrating would be a new pool.

## 7. What was not done

- No Hoon unit tests; the covenant is tested live (`scripts/pool-suite.sh`).
- No activation height; the fork is fakenet-only.
- No wallet support; `nmeme-tx` builds the keyless spend.
- No batcher; trades are one per block.

## 8. The path to mainnet, and what exists without it

Nothing here changes mainnet. The prototype demonstrates, on a private
fakenet, what one consensus change buys; putting it on mainnet is a
decision for the Nockchain maintainers and the network, in this order:

1. **Proposal.** `upstream/amm-covenant.patch` against `2bcb0b9`, with
   this document, `docs/FEES.md` and the evidence, raised with the
   maintainers as a consensus-upgrade proposal.
2. **Review and tests.** Hoon unit tests for `++  amm` and `++  meme` in
   `hoon/tests/dumb`, review of the derivation and the arithmetic, and of
   the mempool's handling of the new failure reasons.
3. **Activation height.** The rules take effect at a height (`amm-phase`,
   `meme-phase`) the way `bythos-phase` and `parent-hash-phase` gate the
   existing v1 rules; before it, the new lock tag and the claim rules are
   inert, so nodes can be upgraded ahead of time. This is a hard fork: a
   node that has not upgraded rejects a block containing a covenant spend
   after activation.
4. **Release and adoption.** Node release, miners and nodes upgrade before
   the height, wallet support for the keyless spend and the genesis id.
5. **Then** pools can be opened on mainnet, and only then.

Until adoption, what exists on the unchanged mainnet is what was verified
on the shipped node earlier in this repository: the note-data token
standard with indexer-side verification (§A1–A13), transfers, and
two-party atomic settlement by pins (§A14). Those need no network change.
A pool does. A pool built without the change would be custodial, which
is ruled out.
