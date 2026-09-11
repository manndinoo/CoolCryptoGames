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

### A8. Fee enforcement after attachment — 5 tests, and observed live

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

### A9. Snapshot-consistent, paginated reads — 8 tests, and observed live

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

### A10. Independent verification, and the two bugs it found

A third party rebuilt the package inside the pinned workspace with zero
modifications to the 27 uploaded crate files, ran every supplied test (81
passed, 0 failed; 9 shell checks passed), and then wrote two checks of their
own. Both found bugs. Their packages are retained verbatim in
[`independent-verification/`](./independent-verification/), one directory per round.

**Fee undercount for Merkle proofs.** `required_fee` passed
`spend_condition_count: None` to the estimator, which means a one-condition
lock with no sibling path — while the witness in the same transaction carried
a path. One sibling was 5 words short: 160 nicks at fakenet rates, enough to
clear local enforcement and still be rejected by the node. Fixed: the count is
now derived from the path actually present in the witness (`1 << path.len()`,
the exact inverse of the estimator's `count.ilog2()`), and a path deeper than
the deepest lock the protocol defines is refused rather than estimated. Their
regression is retained as `independent_fee_path.rs` and passes; six further
expected-value tests pin every depth 0–4, the 5-words-per-sibling slope, and
the 160-nick figure.

**Mining timeout ignored the required height.** After the wait loop, the
script only checked that *some* height had parsed, not that it reached
`MIN_HEIGHT`; their mocked run proceeded at height 1 with a minimum of 3.
Fixed: the wait is now a function in `lib-mine.sh` that fails closed, with a
six-case self-test that the demo runs before mining. Their reproduction now
refuses.

**Round 8.** The same verifier re-ran against the fixed package: 88 tests and
15 shell checks passed with zero source modifications (byte comparisons of all
three crate directories), both fixes confirmed, the retained regression passing,
no new findings. Their resolved `Cargo.lock` is kept for reproducibility.

**What they also reported.** The default dev/test profile failed to link for
them and needed `CARGO_PROFILE_DEV_LTO=false CARGO_PROFILE_TEST_LTO=false`;
that failure did not occur here and its cause is not established
(`docs/DEVELOP.md`). And, in their words: no live node, mined creation, signed
transfer, or on-chain balance rebuild was executed in that verification either.

### A7. Environment limits, measured — and the way around them

The first-boot generation of the verifier-setup seed cache does not fit
this environment at any thread count (13.9 GB and still climbing under a
13.34 GiB ceiling; details and the full memory series in
[`environment.md`](./environment.md)). What fits is everything else.

The cache was generated on free GitHub-hosted runners, one bucket per job
(`../seedgen/seedgen.rs`, `.github/workflows/nmeme-seed-buckets.yml`), merged in
bucket order and checked against `AI_POW_V0_VERIFIER_SETUP_TABLE_DIGEST`
before publication. Measured per bucket, single-threaded, on 16 GB runners
with swap and a memory throttle: 3.5 GB and 2 minutes for the smallest, a
50 GB working set and 96–310 minutes for the two largest. The result:

| | |
|---|---|
| run | `nmeme-seed-buckets.yml` run `34562677406` |
| table digest | `57fb173ad5c70c6382aab7dd84dd0bf0f66912e8472ba429b2d3243981ce46d7` = consensus constant |
| file | `ai-pow/verifier-setup-seeds-v1.bin`, 85,195,241 bytes |
| sha256 | `1dec7dfe51deb549c5a3dab9ddafdcee71f349dfc0c1179a25ec51c6ea74aca9` |
| where | branch `seed-cache` of this repository; [`live/seed-cache.sha256`](./live/seed-cache.sha256), [`live/seed-cache-merge.log`](./live/seed-cache-merge.log) |

With the cache installed, the node here loaded it (no regeneration warning),
built the fourteen verifier contexts to disk (14.4 GB, 2.9 GB peak RSS,
40 minutes), and on the next boot reached **`handle-command: born` in 10
seconds at 197 MB peak RSS**. One more knob was needed: the default PMA arena
opened at 32 GiB and its first persist filled the disk; `--pma-initial-size
1GiB` (a documented flag) fixed it. Both boots' memory series:
[`live/node-boot-rss-first.tsv`](./live/node-boot-rss-first.tsv),
[`live/node-boot-rss-second.tsv`](./live/node-boot-rss-second.tsv).

### A11. The live chain: token created, transferred, and rebuilt from blocks

`scripts/live-demo.sh`, unmodified, ran to completion (exit 0) against the
fakenet node in this environment. Its complete output is
[`live/attempt5/results.txt`](./live/attempt5/results.txt) and
[`live/attempt5/progress.log`](./live/attempt5/progress.log); the node's own
log lines for every transaction and block below are in
[`live/node-log-excerpt.txt`](./live/node-log-excerpt.txt).

| stage | evidence |
|---|---|
| signature gate | `PASS genesis-gate` and `PASS xfer-gate`: the wallet's own signature verified against the **Rust** `sig-hash` of a real transaction, both before and after the claim was attached and the transaction re-signed. `B2` below is closed. |
| genesis (create DOGE, supply 1,000,000) | txid `CxfcXk3W3dAHAhZXGJjKKZ2FnZBW4JhgfU61Y2ju2RGB4duWipZfhBh`, mined at **height 75**, block `4UKGZ9qCi682QbaPd1kaTVRLSJydPgzz82BmJvJhWQvZ8yAieAbPy39`; fee paid 8192 nicks against a consensus minimum of 6016 (the wallet's own `tx-status` report, [`live/attempt5/genesis-tx-status.txt`](./live/attempt5/genesis-tx-status.txt)) |
| token id | `4Fkt8tEVF5AfozYrCdF5F48vd7VNVektAwz5jLHkdq5eTY4XNzubkRU` |
| transfer (100 to Bob, 999,900 back to Alice) | spends the token-bearing note **by name**; txid `Z8tvhDFP4SkuxcfCzkLpjorxryUF7jocdZB3HCPEeqjmokVqsC5Gi`, mined at **height 91**, block `5SbYyzHdJzPDXs5awSAnfJ1FNWfXPBdHYuTWJFwaNwPR3HCkBvaRYVW`; fee 8192 against a minimum of 7424 |
| canonical rebuild | one snapshot at **height 104**, block `A6311czcSLJJapgfa843WA1ApCXFM681XFeh8U35FZbC2ks672rs2fS`, stable across the read; each step bound to its mined transaction by recomputing the file's id the way consensus does; replayed through the real `Indexer` → `Created`, `Transferred` |
| balances | Alice's lock `6Gn3zaAVYhto5qpVL84CpBQNGGokBxssUtZmw5879BESZVMdTmpEhfw` **999,900**; Bob's lock `CyjTA9Bz6oiepyYL4L4kyk3KPAtJRipnxkNZ7oDZSeygrevcLocA7wV` **100**; total 1,000,000 = supply; `ASSERT-OK` ×3 |

The run before it ([`live/attempt4/`](./live/attempt4/)) had mined the same
sequence (genesis `CqnUQ22o…` at height 44, transfer `7dFCSs6E…` at height
55) and failed only in the rebuild tool; the rebuild over those two mined
transactions, run by hand after the fix, produced the same balances
([`live/attempt4/balances.txt`](./live/attempt4/balances.txt)).

**Three things the chain taught that the code did not know:**

1. **The node's explorer cannot decode a note-data transaction.**
   `GetTransactionDetails` fails with a `NounDecode` error in
   `extract_transactions_from_map` on a transaction consensus had just mined.
   The rebuild no longer depends on it: it recomputes each file's transaction
   id (`RawTx::compute_id`, the consensus hash of version and spends) and
   requires equality with the mined id, then takes inclusion from
   `GetTransactionBlock`. That binding covers every field at once.
2. **`WalletGetBalance` takes a cheetah pubkey or a note first-name, not the
   wallet's printed address** (a pubkey hash; "improperly formatted"). The
   tools now read by first-name, which is a function of the lock-root alone.
3. **Burn-on-unclaimed-spend is real, and wallets will trigger it.** Each run
   reused Alice's wallet on the same chain. Run 4's genesis picked run 3's
   token note as an ordinary input (it was the largest NOCK note), and run 5's
   genesis did the same to run 4's — spending the note with no claim on any
   output, which under `SPEC §7` burns that token's supply. The rebuild over
   run 4's transactions now refuses, correctly: its 999,900 output note no
   longer exists unspent. Only the last token, `4Fkt8tEV…`, still holds. A
   platform must pin token notes out of the wallet's input selection (the
   transfer does this with `--names`; the genesis did not need to, until a
   second token existed).

---

## B. Designed but NOT verified

### B1. `output-source` pinning

Note-data merging by lock-root is now observed on chain (the transfer's two
destinations landed at their lock-roots with their claims). `output-source`
pinning, on which the swap design rests, is still read from
`tx-engine-1.hoon` only.

### B2. — closed

The `sig-hash` gate passed on a live chain (A11). Nothing remains here.

### B3. — closed

Claim injection, re-signing, broadcast and canonical rebuild all executed
(A11).

### B4. Trading

[`../docs/SWAPS.md`](../docs/SWAPS.md) is a design derived from source. Nothing
is implemented and nothing is tested. It depends on B1.

### B5. Everything else

No AMM (not expressible without a consensus change or a trusted sequencer). No
partial fills. No platform, wallet integration, or UI. No security review. No
claim of mainnet suitability. The chain used is a single-node fakenet; nothing
here has touched mainnet.

---

## The single sentence version

A token was created and transferred on a live Nockchain fakenet node running
in this environment, and its balances were rebuilt from the mined blocks:
genesis at height 75, transfer at height 91, 999,900 / 100 of 1,000,000 at a
stable snapshot at height 104. The seed cache that made the node bootable was
produced on free hosted runners, one bucket per job. Trading is designed, not
built.
