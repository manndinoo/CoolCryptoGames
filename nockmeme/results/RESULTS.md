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

### A11. The live chain: two tokens created, transferred, and rebuilt from blocks

`scripts/live-demo.sh`, unmodified, ran to exit 0 against the fakenet node in
this environment (run "attempt 6", 2026-09-11 ~14:00 UTC; complete output in
[`live/attempt6/`](./live/attempt6/), node-log lines for every transaction
and block in [`live/node-log-excerpt.txt`](./live/node-log-excerpt.txt),
every signed transaction file in [`live/txs/`](./live/txs/)).

| stage | evidence |
|---|---|
| signature gate | `PASS` on all four transactions, before and after claim attachment: the Rust `sig-hash` matches the wallet's own signatures |
| funding, proven token-free | each genesis spent one coinbase note that a `FUNDING` proof (read from the chain while unspent) showed carrying no claim; `check-inputs` verified every input **before** broadcast (`INPUT-OK … tokenfree` / `named token note`, [`live/attempt6/*-check-inputs.txt`](./live/attempt6/)) |
| token A, DOGE, supply 1,000,000 | genesis `AzC1fW8Y…` mined at **height 640**; transfer `2XeMY77j…` at **650** (100 to Bob, 999,900 to Alice), spending the genesis output named by its computed identity |
| token B, PEPE, supply 1,000,000 | genesis `BojtQp3X…` at **685**; transfer `sQkkabab…` at **712** |
| rebuild of A over all four transactions | snapshot at height 737, stable; provenance of every input proven; `Created`, `Transferred`; A: 999,900 / 100, total 1,000,000, `ASSERT-OK` ×3 — **unchanged by B's creation** |
| rebuild of B over all four | same snapshot; B: 999,900 / 100, total 1,000,000, `ASSERT-OK` ×3 |
| omitted-history guard, live | B's two transactions alone, no proofs: **refused**, naming the genesis input whose status the replay could not know ([`live/attempt6/omitted-history.txt`](./live/attempt6/omitted-history.txt)) |

Before this run, the same script (without the guards) had mined three earlier
tokens on this chain — heights 21, 44/55, 75/91 — and a partial gated run
mined two more (541/571, 600). All of them are in `live/txs/`; §A12 says
what the complete history shows about them.

### A12. The omitted-history finding, and what closed it

An outside review of commit d6cfd78 asked: `interpret_genesis` rejects a
creation that consumes existing token weight, but the demo rebuilt each
token from a fresh indexer given only that token's transactions — could
leaving out earlier history hide consumed weight and report a creation the
rules reject? **Yes.** Replaying all five pre-guard token transactions
through one indexer ([`live/full-history-replay-h104.txt`](./live/full-history-replay-h104.txt)):

| height | transaction | short rebuild said | full history says |
|---|---|---|---|
| 21 | genesis, token `Bto3…` | Created | Created |
| 44 | genesis, token `3rVL…`, spent the `Bto3…` note | **Created** | **Burned: "genesis consumed existing token weight"**; `3rVL…` never existed |
| 55 | transfer of `3rVL…` | Transferred | Untouched (nothing valid to move) |
| 75 | genesis, token `4Fkt…`, spent the 999,900 `3rVL…` note | Created | Created — that note carried no validly created weight |
| 91 | transfer of `4Fkt…` | Transferred | Transferred; 999,900 / 100 stand |

So the height-44 result reported earlier in this file was wrong under the
standard's own rules, and the height-75 token stood only by the accident of
its input having been born invalid. The indexer cannot know what it was not
shown. Three changes close this, all verified live in §A11:

1. **Provenance, or refusal** (`nmeme-index` `require_provenance`, six tests
   in `tests/history.rs`; `omitting_history_turns_a_burn_into_a_creation` in
   nmeme-core pins the hazard itself). Every input of every replayed step
   must be an output of an earlier supplied step, or proven token-free by a
   `FUNDING` line read from the chain while the note was unspent. Weight only
   ever comes from a claim under the `meme` key, so a note with no such entry
   has zero weight in every possible history — no transaction list needed.
   A note that carries a claim but whose creating transaction was not
   supplied is refused and named. The pre-guard rebuilds of this chain now
   refuse, correctly: their inputs' provenance cannot be proven after the
   fact.
2. **Token notes are kept out of ordinary spending** (`funding`,
   `outputs`, `check-inputs`). The demo picks genesis funding only from
   notes the chain shows as `tokenfree`, names the token note it moves by the
   identity computed from the genesis file, and refuses to broadcast a
   transaction with any other input. That is the platform rule: a stock
   wallet must never be allowed to choose inputs for a token-aware
   transaction.
3. **Two tokens, one chain** (§A11): B's creation left A's balances exactly
   as rebuilt before it.

Two more facts the chain supplied on the way:

- **Coinbase notes do not sit at the wallet's change lock-root.** Alice's 501
  block rewards share one first-name; her change chain has another. A
  funding read at the change lock alone finds no token-free note. `funding`
  now takes `--first` as well as `--lock`, and the demo reads at every
  first-name the wallet lists.
- **A multi-address read can straddle blocks.** With a block every few
  seconds the node answered three first-name queries from two tips; the
  snapshot fold refused the mix, and the read now retries until every page
  agrees.

The saved state: chain at height 737 (`node-state-h737.tar.gz`, restorable
into `data/` with the seed cache), both wallets' key exports, and all twelve
signed transaction files, handed over as a bundle alongside this branch.

### A13. Evidence is verified, not trusted; missing data is not "no claims"

A second outside review of §A12 found two gaps in the guard itself, both
real, both closed and shown live (run "attempt 7", output in
[`live/attempt7/`](./live/attempt7/); before/after records in
[`live/evidence-before.txt`](./live/evidence-before.txt),
[`live/evidence-after.txt`](./live/evidence-after.txt),
[`live/evidence-tests-before.txt`](./live/evidence-tests-before.txt),
[`live/evidence-tests-after.txt`](./live/evidence-tests-after.txt)).

**Gap 1: a `FUNDING` line was a trusted assertion.** The checker read the
`tokenfree` label off a text file. On the binary built from commit bb7169f,
a forged line labelling token A's genesis output `tokenfree` got
`INPUT-OK … tokenfree`, and a file holding both the honest `claim` line and
the forged one still got `INPUT-OK`: the `tokenfree` set was consulted first
(`evidence-before.txt`).

What replaced it is a rule, not a label. Consensus names every v1 coinbase
note `new-v1:nname [root [parent %.y]]` and builds it with empty note-data
(`+new:coinbase`, `hoon/common/tx-engine.hoon`; `validate` pins the origin
page and the source hash). A miner supplies only the coinbase split, never
a note body. So a note whose last name equals `coinbase_last_name(parent id
of the block at its origin height)` was a coinbase note and carried no token
weight in any history — and both inputs to that check are consensus data any
node serves, **after the note is spent**. That is the verifiable historical
evidence:

| consumer | what it now does |
|---|---|
| `funding` | reads each note's body and its origin height, fetches the origin block's parent id (`GetBlockDetails`), and labels the note `coinbase` only if the name recomputes; `plain` if claim-free but not coinbase; `claim` otherwise. Every line carries the origin height. |
| `rebuild` | admits as token-free exactly the `coinbase` records, each re-verified against the node at rebuild time. `plain` and legacy `tokenfree` records admit nothing; a `coinbase` record that does not recompute is an error naming it; two records that disagree about one note refuse the whole file. |
| `check-inputs` | reads no file. It fetches the inputs' notes from the node and refuses any input not shown unspent without a claim, or not named as the token note to move. |

Live, on this chain: all **723** of Alice's reward notes recompute as
coinbase, **0** fall to `plain`, and her **10** token notes are `claim`
(`evidence-after.txt`). The vector for block 398 (parent id → last name) is
pinned in `nmeme-tx` `tests/names.rs`. The §A11 rebuild re-run with its old,
label-only proofs is now refused, correctly: nothing in those files is
evidence any more.

**Gap 2: missing data became "token-free".** The balance reader left the
claim list empty when the entry had no note body, no version, a legacy (v0)
version, or no note-data field, and read a missing `assets` as 0. The guard
then saw "no claim". `note_from_entry` now refuses each of those, plus an
unsupported version value and a body naming a different note — the same
posture as the node's own decoder, which treats every missing field as an
error. A verified empty claim list is a complete v1 body with no entries,
and nothing else.

**Regression tests, run against the unfixed code first.** Commit cf0afbd
added `tests/evidence.rs` with the reader moved into a pure function and its
old behaviour intact. Nine tests failed there — forged label admitted,
conflicting records accepted, missing body / version / note-data / assets,
v0 note, unsupported version, mismatched body name all read as fine — and
the two positive controls passed (`evidence-tests-before.txt`; the hosted
runner's run 6 failed the same way). After the fix all pass:

| suite | tests |
|---|---|
| nmeme-core | 27 |
| nmeme-index binding / decode / evidence / history / snapshot | 6 / 8 / 12 / 7 / 8 |
| nmeme-tx | 41 (adds the pinned coinbase vector) |
| **total** | **109**, 0 failed |

**The live run with verified evidence** (attempt 7, exit 0, chain at 876):

| | token A, DOGE | token B, PEPE |
|---|---|---|
| genesis input | Alice's reward note from block 398, admitted only after its last name recomputed from block 398's parent id | a later reward note, same check |
| gate | `INPUT-OK … tokenfree (node shows no claim)`, read live at the tip | same |
| genesis / transfer | **757** `2VmMxbfx…` / **796** `Bse3vCUr…` | **834** `3fTdPwkQ…` / **856** `7AkA8LFR…` |
| rebuild over all four | `EVIDENCE 833 coinbase note(s) re-verified against block parents` (every coinbase record in the four supplied files, each against its origin block); 999,900 / 100, total 1,000,000, `ASSERT-OK` ×3 — unchanged by B | same for B |
| omitted history | B alone, no evidence: refused, naming the genesis input | |

Reproduce: `RUNBOOK.md` steps 1–7 (the demo), then the four commands under
"What `live-demo.sh` runs" by hand against any of the transaction files in
`live/txs/`.

### A14. Two-party atomic settlement, live: the trade, and four attacks refused

The construction in `docs/SWAPS.md` — one transaction, two spends, each
party's change seed pinned to the complete seed set at its lock — was
assembled with `nmeme-tx swap`, signed by each wallet for its own spend,
gated live, and run five times on the fakenet: four attacks, each on its
own token note and a fresh NOCK note for Bob, and the honest trade
(evidence in [`live/swap/`](./live/swap/); transaction files in
[`live/txs/`](./live/txs/)).

| instance | what was sent | node's mempool | transaction engine, at block building | mined? | inputs after |
|---|---|---|---|---|---|
| Alice's half alone | her signed spend only | admitted | `v1-tx-invalid` on 26 candidate blocks | no | unspent |
| Bob's half alone | his signed spend only | admitted | `v1-tx-invalid` on 22 | no | unspent |
| Bob pays less | his re-built, re-signed 4-NOCK spend spliced into the trade Alice signed | admitted | `v1-tx-invalid` on 21 | no | unspent |
| Alice gives less | her re-built, re-signed 50-token spend spliced into the trade Bob signed | admitted | `v1-tx-invalid` on 9 | no | unspent |
| **honest** | both spends, both pins | admitted | — | **height 1268** | spent |

`nmeme-tx pins` named the violated pin before each attack was sent (the
other party's, in the two tampering cases). The honest trade, token B:

- Alice: −100 tokens, +327,680 nicks. Her merged output note holds
  4,295,267,400 nicks = 4,294,948,912 in − 1,000 dust to Bob − 8,192 fee
  + 327,680 from Bob, and the 999,800-token claim.
- Bob: +100 tokens, −327,680 nicks. His merged note holds 320,488 nicks =
  655,360 in − 327,680 − 8,192 fee + 1,000 dust, and the 100-token claim.
- Rebuilt over genesis (834), transfer (856), the plain funding step (1247,
  `Untouched`) and the swap (1268): Alice 999,800, Bob 200, total
  1,000,000, `ASSERT-OK`, with 1,221 coinbase records re-verified and every
  input's provenance known.

**What the node taught, on the way** (all in the logs under `live/swap/`):

1. **Mempool admission is not validity.** Every attack was "admitted"; the
   verdict came from the engine when the miner built a block. A client that
   treats the accepted query or the wallet's `tx-status: pending` as
   success is wrong.
2. **An admitted transaction reserves its inputs.** "Inputs present in
   spent-by, discarding transaction": while an invalid half sat in the
   mempool, any transaction spending the same notes was discarded on
   arrival, and the half was retried on every candidate block for as long
   as we watched. A leaked signed half blocks the trade's notes; the
   assembler must be the only holder of both halves and the only submitter.
3. **The wallet's `send-tx` fails under load.** It reads the whole balance
   first and aborts when a block lands mid-read. `nmeme-index send` submits
   through the public gRPC directly.
4. **The node's per-address balance cache can lag.** With the miner paused,
   a read spanning Alice's thousand-note coinbase address and two small
   ones returned the same disagreeing heights twelve times; reading one
   address at a time is exact.

This is the settlement layer of the pool design in `docs/LIQUIDITY.md`,
not a trading product: it needs a named counterparty and an exact fill.

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

Two tokens were created and transferred on a live Nockchain fakenet node in
this environment with every input read live from the node before broadcast,
and both were rebuilt from the mined blocks with every genesis input's
token-free status re-derived from consensus data (its coinbase name): 999,900 / 100 of 1,000,000 each, the first unchanged by the second's
creation. A replay given incomplete history now refuses instead of reporting
a creation the rules reject, a hazard an outside review found and the full
replay confirmed. Trading is designed, not built.
