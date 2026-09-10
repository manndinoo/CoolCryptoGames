# What is proven, and what is not

Two lists. Nothing appears in the first without a command that produced it and
an artifact in this repository.

---

## A. Executed and verified

### A1. Consensus facts, read from source

Revision `2bcb0b9dfd190f17252205afd1c8a067048a1ad9`. Every claim in
[`../docs/FINDINGS.md`](../docs/FINDINGS.md) cites `file:line`. These are
*readings of source*, not runtime observations — strong evidence, but §B1 notes
which of them a live chain still needs to confirm.

### A2. The native stack builds

`nockchain`, `nockchain-wallet`, `zk-pow-mine`, `honk` all build. Four blockers
and their fixes are in [`../docs/DEVELOP.md`](../docs/DEVELOP.md).

```bash
cargo build --release -p nockchain --bin nockchain \
  -p nockchain-wallet --bin nockchain-wallet -p zk-pow-miner --bin zk-pow-mine
```

### A3. Encoding and accounting — 26 tests

```bash
cargo test -p nmeme-core             # 26 passed
cargo test -p nmeme-core --release   # 26 passed
```

Both profiles are run deliberately: the overflow bug behaved differently in
each. Output in [`test-results.txt`](./test-results.txt).

### A4. The overflow bug, fixed and demonstrated

Amounts were bounded only by the field prime, ~4.3e9 below `u64::MAX`, and
accumulated with unchecked `+`. Holding **1 unit**, claiming outputs of `2^63`
and `2^63 + 1` wraps the total to `1`, satisfies conservation, and mints
~1.8e19 units.

Demonstrated by reverting the fix: `wrapped_claim_sum_cannot_mint` fails with
the transfer **accepted** rather than burned. In debug the same input panics the
indexer instead — a denial of service as well as an inflation.

Fixed by `MAX_SUPPLY = 2^63 - 1` plus `checked_total()` on every accumulation.

Honest note on test strength: two of the five overflow tests are genuine
regression tests that fail without the fix.
`many_capped_claims_cannot_overflow_the_indexer` is robustness only — the
conservation check rejects it either way.

### A5. Attachment, digest, file surgery, identity, binding — 42 tests

```bash
cargo test -p nmeme-tx       # 13 attach + 6 roundtrip + 8 names + 1 fixture report
cargo test -p nmeme-index    # 8 decode + 6 binding
```

`names` derives a merged output's complete `Name` from the transaction's own
seeds, transcribed from `build-outputs`. One of its tests is ground truth rather
than self-consistency: the transcribed `first` must equal the repository's own
`FirstName::from_lock_root`. `binding` covers successive transactions paying the
same recipient with equal amounts — the case first-name or amount matching
cannot distinguish — and requires a note with the right recipient but the wrong
identity to be refused.

The decode tests cover the seam between what `nmeme-tx` writes and what the
node hands back as a jammed blob, including a foreign payload under the `meme`
key and a future-version claim, both of which must be rejected rather than
coerced into a v0 claim.

The load-bearing round-trip test asserts that the signing hash computed before
writing a transaction equals the one computed after reading it back. If jam/cue
perturbed the note-data at all, a signature made against the pre-write digest
would be silently worthless.

Includes `note_data_digest_is_not_a_plain_noun_hash`, which pins a mistake that
was made and corrected: `hash:note-data` is not `hash_owned_based_noun`.

### A6. The signature gate — 9 checks

```bash
bash scripts/gate-selftest.sh          # 9 checks passed
```

The gate previously matched with `grep -i valid`, which also matches
"**In**valid signature" — it accepted failure as success and could never fail.
The self-test demonstrates that directly, then shows the replacement rejecting
the same input. The decision now keys on the wallet's exit code
(`wallet.hoon:2028-2030`).

### A8. Fee enforcement after attachment — 5 tests

```bash
cargo test -p nmeme-tx --test fee
```

Attaching a claim adds words to a seed after the wallet has already sized the
fee. `nmeme-tx attach` now computes the post-attach minimum with the
repository's own estimator (`wallet_tx_builder::word_count`) and
`fee::compute_minimum_fee`, and **refuses to write** a transaction whose fee
is below it, naming the shortfall. `nmeme-tx fee` reports the same numbers.
Constants are parameters with fakenet defaults (base fee 128, bythos at 1,
divisor 4, floor 256), not baked in. One test pins that attaching raises the
required fee; one that exactly the minimum passes and one nick less does not.

### A9. Snapshot-consistent, paginated reads — 8 tests

```bash
cargo test -p nmeme-index --test snapshot
```

Balance reads follow `next_page_token` to the end for every address (a read
that stops after one page silently drops every note past the server's page
size), and every page from every address must report the **same** height and
block id or the fold refuses — a balance assembled across a block boundary is
two chains, not one. The transaction-detail reads are bracketed by a second
snapshot read that must match the first, and each mined transaction's height
must not exceed the snapshot's. The page loop and the fold are pure functions
tested without a node, including a repeated token and a runaway pager.

### A7. Environment limits, measured

| `RAYON_NUM_THREADS` | Peak RSS | Outcome |
| --- | --- | --- |
| 4 (default) | 13.24 GiB | OOM-killed before `%born` |
| 1 | 13.93 GB at kill | OOM-killed before `%born` after 89 min |

Neither configuration completes verifier setup under the 13.34 GiB ceiling. An
earlier revision of this file said the 1-thread run fit; it did not.

Numbers, `dmesg` evidence and the full RSS series:
[`environment.md`](./environment.md), [`node-memory-1thread.tsv`](./node-memory-1thread.tsv).

---

---

**Everything above in A is an offline code check. What follows in B is
separate: it is not a code defect list, it is what cannot be shown without
a chain.**

## B. Designed, implemented, or assumed — but NOT verified

### B1. Two consensus readings a live chain must confirm

- **Note-data merging by lock-root.** `FINDINGS §3` and `SPEC R1` rest on it,
  and the whole allocation model follows from it.
- **`output-source` pinning.** The entire swap design rests on it.

Both are read from `tx-engine-1.hoon` and corroborated by the repository's own
code, but neither has been observed on a running node.

### B2. The `sig-hash` implementation

`nmeme-tx` computes a v1 spend's signing hash by transcribing
`tx-engine-1.hoon`. **It has never been checked against a signature the wallet
produced.** The offline route does not exist: the repository's transaction
fixtures carry zero signatures (`sighash_fixtures` reports this), and Rust has
no schnorr verifier.

Until the gate in [`../docs/ACCEPTANCE.md`](../docs/ACCEPTANCE.md) passes, every
digest this crate computes is unproven, and so is everything built on it —
including B3.

### B3. Claim injection, re-signing, broadcast, balance rebuild

Implemented (`nmeme-tx attach`/`set-sig`, `nmeme-index`,
`scripts/live-demo.sh`) and **not yet executed against a chain**. No
transaction has been broadcast. There are no transaction IDs, no block heights,
and no on-chain balances to report.

`nmeme-index rebuild` replays the mined transactions through the real
`Indexer` — genesis rules, exact conservation, burn-on-invalid — and asserts
per-lock-root balances and total supply. Before a step is replayed, the local
file is bound to the mined transaction (`verify_canonical`: same inputs, same
outputs, same merged amounts, present in a block), and each output is bound by
its **complete computed name** to a note the chain knows (`bind_outputs`).
Earlier versions summed anything under the `meme` key, then matched outputs by
recipient; both are gone. None of this has run against a chain.

### B4. Trading

[`../docs/SWAPS.md`](../docs/SWAPS.md) is a design derived from source. Nothing
is implemented and nothing is tested. It also depends on B1's `output-source`
reading.

### B5. Everything else

No AMM (not expressible without a consensus change or a trusted sequencer). No
partial fills. No platform, wallet integration, or UI. No security review. No
claim of mainnet suitability.

---

## The single sentence version

The standard is specified against verified consensus rules and its accounting
layer is tested, including against an inflation bug that was found and fixed.
Nothing has touched a chain, so the token does not yet work.
