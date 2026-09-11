# NMEME v0 — a fixed-supply token standard for Nockchain

Status: draft, implemented against Nockchain `2bcb0b9`. Every rule below is
derived from a consensus fact recorded in [`FINDINGS.md`](./FINDINGS.md).

NMEME is a *colored-note* standard. It adds no consensus rules and needs no
node patch. A note carries token weight because it carries a note-data entry
saying so, and because the spender who created it signed that entry.

## 1. Note-data key

Key: `meme` (`@tas`).

It is not one of the three reserved keys (`lock`, `bridge`, `bridge-w`,
FINDINGS §1), so it decodes to the wildcard `NoteDataValue::Noun` and is
preserved verbatim by existing tooling. The cord `meme` is `0x656d656d`, far
below `PRIME`, so it satisfies `based` (FINDINGS §5).

## 2. Payload shape

The value under `meme` is a versioned noun:

```
[%0 claim]
```

`claim` is exactly one of:

```
[%c ticker decimals amount tid]  ::  genesis claim; tid = the id it creates (§2a)
[%t token-id amount]             ::  transfer claim

### 2a. The genesis claim names its id

`tid` is `TokenId::derive(inputs, ticker, decimals)`: the transaction's
smallest input name (by the big-endian bytes of its atoms), the ticker
and the decimals, hashed as a noun. A genesis whose claims name any other
id creates nothing (indexer rule G6), and on the forked node
(`docs/ENFORCEMENT.md` §3) consensus refuses the transaction. The field
was added after review found that a claim consensus never validated could
be sold into a pool; carrying the id lets a later spend of the genesis
note be counted by consensus without knowing the genesis transaction.

Under the fork, consensus also enforces conservation of transfer claims
per token id on every transaction (outputs never exceed inputs plus the
genesis claims of that id); the indexer's rules T2–T3 become a consensus
guarantee rather than a reading convention. On the unchanged node they
remain conventions the indexer verifies.
```

- `ticker` is a **list of atoms, each at most 7 bytes** of ASCII. Seven bytes
  is the largest width that cannot exceed `PRIME` (FINDINGS §5). An 8-byte
  cord is not permitted because it can be rejected by `based`.
- `decimals` is an atom, `0 <= decimals <= 18`.
- `amount` is a positive integer, `0 < amount <= MAX_SUPPLY` where
  `MAX_SUPPLY = 2^63 - 1`.
- `token-id` is a `hash` (five field elements), computed as in §4.

Every atom is below `PRIME` by construction. The whole payload is well under
the 2048-leaf merged limit (FINDINGS §4).

### Why amounts are capped below the field prime

Consensus only requires an amount to be a field element, and the prime
`2^64 - 2^32 + 1` sits just *below* `u64::MAX` — the gap is about `4.3e9`. Two
otherwise-valid amounts can therefore sum past `u64::MAX`.

That matters because §6 accepts a transfer when the output total equals the
input total. Under wrapping arithmetic an attacker holding **one** unit can
claim two outputs of `2^63` and `2^63 + 1`: the total wraps to `1`, conservation
appears to hold, and the transfer mints roughly `1.8e19` units out of nothing.
In a debug build the same input panics the indexer instead.

Two independent defences are required:

> **A1.** Every amount and every declared supply MUST be at most
> `MAX_SUPPLY = 2^63 - 1`. This leaves a full bit of headroom, so any *pair* of
> valid amounts sums without wrapping.
>
> **A2.** Every accumulation of amounts MUST use checked arithmetic, and MUST
> treat overflow as a rejection. A1 alone does not cover sums of more than two
> claims.

A conforming indexer that violates either is inflatable.

## 3. One claim per lock-root — the merging rule

**A note's `meme` entry describes that note's own token balance.** It is not a
list of instructions addressed at other outputs.

This is forced by consensus. Seeds sharing a lock-root collapse into one output
note and their note-data maps are unioned, with collisions resolved
destructively (FINDINGS §3). Therefore:

> **R1.** A conforming transaction builder MUST emit at most one seed carrying
> the `meme` key per lock-root. Allocations to the same recipient MUST be summed
> into a single claim before seeds are constructed.

> **R2.** An indexer reads the **post-merge** note. It sees one `meme` entry per
> note and never has to reconstruct which seed supplied it.

R1 is the rule the earlier Python simulation could not express: its allocations
were keyed on individual output notes, which do not survive merging.

## 4. Token identity

Token identity must be fixed *before* the transaction is signed, because
note-data is hashed into the seed and therefore into the transaction id
(FINDINGS §2). Embedding the genesis transaction's own id inside its note-data
would be circular.

Instead, identity is anchored to a note that already exists:

```
anchor    = the lexicographically smallest input note name (nname) of the
            genesis transaction
token-id  = tip5-hash([anchor, ticker, decimals])
```

The anchor is a note that can be spent exactly once, so `token-id` is unique
and unforgeable, and it is fully determined by data available before signing.

Two different creators may pick the same `ticker`. They will produce different
`token-id`s, and neither increases the other's supply. **Ticker is a label, not
an identity** — a platform must display `token-id` wherever a user makes a
value decision.

## 5. Genesis

A transaction is a valid NMEME genesis for `token-id` when all of:

- **G1.** No input note carries a `meme` entry. (Genesis must not consume
  existing token weight.)
- **G2.** At least one input exists, so an anchor exists.
- **G3.** Every output note carrying `meme` carries a `%c` claim with the
  identical `ticker` and `decimals`.
- **G4.** Every claimed `amount` is a positive integer.
- **G5.** `token-id` has never been created before in canonical order.

Total supply is defined as the sum of the `%c` amounts, and is fixed forever —
there is no mint operation in v0.

## 6. Transfer

Let `consumed` be the multiset of `(token-id, amount)` carried by the
transaction's input notes.

- **T1.** v0 supports exactly one distinct `token-id` in `consumed`. A
  transaction consuming two different tokens is invalid as an NMEME operation.
- **T2.** Every output note carrying `meme` MUST carry a `%t` claim naming that
  same `token-id`.
- **T3.** The sum of output claim amounts MUST equal the sum of consumed
  amounts. Exact conservation — no partial burn, no implicit change.

If any of T1–T3 fails, the transaction is **not** a valid NMEME operation, and
the consumed token weight is destroyed (§7).

Note that T3 makes the change output the sender's own responsibility: a sender
who forgets to color their change note burns the remainder. A conforming wallet
MUST construct the change claim automatically.

## 7. Burn-on-invalid

> **B1.** A confirmed base-chain spend is never rolled back by the overlay. If a
> transaction's token payload is absent, malformed, or violates §5/§6, the token
> weight on its inputs is destroyed and no output receives weight.

This is not a choice. The base chain has already spent the inputs; an overlay
that "rejected" the action while leaving the inputs spent would resurrect
tokens on the next rebuild. The earlier simulation reached the same conclusion
and it carries over unchanged.

The practical consequence is severe and must be stated plainly to users:
**spending a token note with an ordinary, token-unaware wallet burns the
tokens.** Token-aware note selection is a hard requirement for any wallet that
touches NMEME notes, not a nicety.

## 8. Reorganizations

Overlay state is a pure function of the canonical chain. On reorg the indexer
MUST rebuild from the replacement canonical history rather than attempting to
invert applied events. Two indexers agreeing on a state digest is evidence only
when they are independent implementations; the same implementation run twice
proves determinism, nothing more.

## 9. Trading

Swaps use the native construction described in FINDINGS §7 and do not need a
new primitive:

- each party signs only its own spend (`sig-hash` covers own seeds + fee);
- the maker pins `output-source` on a seed paying its own lock-root, so the pin
  is satisfied only if the taker's payment seed is present at that lock-root.

A maker's signed half is therefore safe to publish: broadcasting it alone fails
validation. Offers are **exact-fill** — the pin commits to an exact merged seed
set, so partial fills are out of scope for v0.

## 10. What v0 deliberately does not do

- No minting after genesis, no burning as an explicit operation.
- No mixed-token transactions.
- No partial-fill offers.
- No metadata beyond ticker and decimals (names, images and links belong
  off-chain, keyed by `token-id`).
- No claim of security, interoperability or mainnet readiness. The acceptance
  gate is §12.

## 11. Provenance and evidence

An indexer learns which notes carry token weight only from the transactions
it replays. Replayed without the transaction that put weight on a note, a
genesis that consumes that note looks like a valid creation instead of the
burn §5 and §7 make it. So a replay must establish, for every input of every
step, that the input's token status is known:

1. the input is an output of an earlier supplied step (the replay computed
   its weight, possibly zero); or
2. the input is proven to have carried no `meme` entry.

Proof under (2) is never a label. The only admissible evidence is one that
anyone can recompute from consensus data after the note is spent. v0 admits
exactly one: **the note was a coinbase note.** Consensus names every v1
coinbase note from its origin block's parent id with the coinbase flag set
(`+new:coinbase`, `tx-engine.hoon`) and builds it with empty note-data; a
miner supplies only the coinbase split. A note whose last name equals that
recomputed value carried no claim in any history. The origin height and the
parent id are served by every node.

A note that is claim-free at read time but not a coinbase note is admissible
for a pre-broadcast check made against the node at that moment, and for
nothing else: once it is spent, supply the step that created it instead.
Anything not covered by (1) or (2) is refused and named, never guessed.

## 12. Acceptance gate

NMEME v0 is proven when, on a local fakenet node:

1. two native wallets exist and control their own notes;
2. a real transaction creates a token and is mined;
3. a real transaction transfers part of it and is mined;
4. an indexer rebuilt from the node's canonical chain reports the expected
   split;
5. the same is re-derived after a forced rebuild.

Until every one of those holds against a real node, NMEME is a design, not a
working token.
