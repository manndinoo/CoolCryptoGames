# Trading NMEME tokens

Nockchain has no smart contracts, so the obvious assumption is that a DEX needs
either an escrow custodian or an HTLC round-trip. Neither is true here. The
chain already has the two primitives a swap needs, and they compose into a
**single transaction, no custody, no timelock**.

Everything in §1 is cited to source in [`FINDINGS.md`](./FINDINGS.md) §7.

## 1. Why it works

**A signature covers only its own spend.** `sig-hash` for a spend is a hash of
that spend's own seeds and its own fee
(`hoon/common/tx-engine-1.hoon:1116-1120`). It says nothing about the other
inputs of the transaction. In Bitcoin terms this is
`SIGHASH_SINGLE | ANYONECANPAY`, and it is the default and only mode.

On its own that is dangerous, not useful: if Alice signs a spend that hands
tokens to Bob, anyone could broadcast that spend alone and Bob gets the tokens
without paying.

**`output-source` closes the hole.** A seed may pin `output-source`, and
validation then requires the output note's source hash to equal the hash of the
*complete merged seed set* landing on that lock-root
(`hoon/common/tx-engine-1.hoon:1413-1418`). Seeds are normalized — their own
`output-source` is stripped — before that hash is taken
(`tx-engine-1.hoon:2370-2375`), which is precisely what makes a seed able to
commit to a set containing itself without circularity.

So a party can commit to *what it will receive*, in a signature that covers only
what it sends.

## 2. The construction

Alice holds a note coloured with 1,000 MEME. Bob holds NOCK. They agree on
1,000 MEME for 5 NOCK.

The transaction has two spends.

**Alice's spend** consumes her token note and emits two seeds:

| Seed | To | Carries |
| --- | --- | --- |
| `A1` | Bob's lock-root | `meme: {token, 1000}` |
| `A2` | Alice's lock-root | her NOCK change, `output-source` **pinned** |

**Bob's spend** consumes his NOCK note and emits two seeds:

| Seed | To | Carries |
| --- | --- | --- |
| `B1` | Alice's lock-root | 5 NOCK |
| `B2` | Bob's lock-root | his change, `output-source` **pinned** |

Because outputs merge by lock-root (FINDINGS §3), the transaction produces
exactly two notes:

- at Alice's lock-root: `A2 + B1` — her change *plus Bob's payment*
- at Bob's lock-root: `B2 + A1` — his change *plus Alice's tokens*

Alice pins `A2.output-source` to `hash(normalize({A2, B1}))`. Bob pins
`B2.output-source` to `hash(normalize({B2, A1}))`.

## 3. Why neither side can be robbed

**Alice's half cannot be broadcast alone.** Without Bob's spend, the merged set
at Alice's lock-root is `{A2}`, whose hash is not the pinned value. Output
validation fails and the whole transaction is rejected. Alice's signed spend is
therefore safe to hand to a counterparty, or publish.

**Bob cannot pay less.** Any change to `B1` — a different amount, a different
note-data — produces a different seed, a different merged-set hash, and the same
rejection.

**Bob cannot be robbed either.** His own pin requires `A1` to be present at his
lock-root with exactly the promised token claim.

**Neither can be front-run into a different trade.** Both pins name exact seed
sets; there is no substitution that validates.

This is symmetric and needs no trusted third party, no escrow lock, no
preimage, and no timeout.

## 4. What it costs

**Exact fill only.** The pin commits to an exact set, so partial fills are
impossible. An offer of 1,000 MEME is taken whole or not at all. A maker who
wants ladders posts several offers.

**The maker must know the taker's lock-root before signing.** `A1` pays to Bob's
lock-root, so Alice cannot sign until Bob is known. Offers are therefore not
fully non-interactive: the flow is

1. maker publishes an offer (terms only, unsigned) to the platform;
2. taker claims it, supplying their lock-root;
3. maker signs and returns their half;
4. taker signs, combines, broadcasts.

Step 3 needs the maker online. This is the same shape as most UTXO-chain order
books, and it is the honest cost of not having a contract to hold the offer.

**Fee accounting is per spend.** Each party pays the fee on its own spend, so
neither can inflate the other's cost.

## 5. What is not designed yet

- **An AMM.** Constant-product pools need state that persists across
  transactions and is mutable by strangers. On this chain that means a note
  under a lock that anyone may spend subject to a covenant, and the lock
  primitives (`Pkh`, `Tim`, `Hax`, `Burn`) do not express a covenant on the
  *shape of the outputs*. An AMM would need either a consensus change or a
  trusted sequencer, and calling a sequencer-run pool "decentralized" would be
  a lie. Order-book trading via §2 is what the chain actually supports today.
- **Partial fills**, for the reason in §4.
- **Offer expiry.** `Tim` gives absolute and relative timelocks, so a maker's
  refund path can be time-bounded; the design is not written.

## 6. Status

Implemented as a settlement primitive (`nmeme-tx swap`, `pins`, `half`,
`replace-spend`; `crates/nmeme-tx/src/swap.rs`), with the pinned
`output-source` hashable in the signing digest and eight unit tests covering
the construction and the tamper cases. The live fakenet run of
`scripts/swap-demo.sh` (the honest trade plus four attacks sent first) is
the confirmation against a running node; see `results/RESULTS.md`.

This is a two-party settlement mechanism, **not the trading product**. The
platform needs pooled, automatically priced liquidity; what the chain can and
cannot enforce for that is evaluated in [`LIQUIDITY.md`](./LIQUIDITY.md),
where this primitive is the settlement layer of the recommended design.
