# Activation: the consensus upgrade candidate, reviewed and mirrored

`upstream/activation.patch` is the delta a third party supplied on
12 September 2026 as a "consensus upgrade candidate" (its own notes are in
`upstream/activation-candidate/`). It applies on top of
`upstream/amm-covenant.patch` at the pinned Nockchain revision
`2bcb0b9d`; the candidate's "complete" patch is exactly that revision +
our pack 9 patch + this delta (checked byte for byte, Cargo files aside —
results/RESULTS.md §A26). It adds:

- `hoon/common/nmeme-policy.hoon`: a compile-time activation height,
  `phase`, with `~` meaning **disabled** (not height zero); `active`
  (height ≥ activation) and `creditable` (activation ≤ a note's origin ≤
  the current height).
- `tx-engine-1.hoon`: `validate` calls `validate-at-phase` with the policy's
  phase; the `%amm` covenant only receives a transaction context when the
  rule is active (`check-with-amm`, the original five-field `check` kept
  for wallet and test callers); `conserved:meme` credits an input's claim
  only if `creditable` holds for the note's origin; before activation the
  token rule is not applied at all (`meme` entries are arbitrary metadata,
  as on the shipped node) and every `%amm` spend is refused.
- 24 Hoon assertions (`hoon/tests/dumb/mod/unit/nmeme-upgrade.hoon`,
  entry `hoon/tests/dumb/nmeme-upgrade-check.hoon`) over the real
  `validate-at-phase` with a test activation height of 100.

## What the rule means

| | before activation (or disabled) | at and after activation |
|---|---|---|
| a `meme` entry on an output | arbitrary metadata | must be a well-formed claim, else the transaction is refused |
| token credit of an input | none (the rule does not run) | its claim, **only if the note's origin is at or after activation** |
| a note with a claim written before activation | spendable | spendable as plain NOCK; its claim is discarded, never credit; a transfer claim on the outputs backed only by it is refused |
| a genesis claim | not checked | as before (anchor, id, cap); a legacy anchor note without an entry is fine — **a legacy note that still carries an entry blocks a genesis**, because the genesis rule reads entries, not credit (see findings) |
| a `%amm` pool spend | refused | the covenant, with the pool note itself required to be creditable: a pool opened before activation is unspendable ("legacy pool") |

There is no migration: a balance shown by an indexer before activation is
overlay bookkeeping, not consensus weight, and stays that way. Any
migration would be a separately specified issuance.

## What was verified here (§A26)

- The delta applies to our pack 9 checkout; the candidate's full patch is
  our state plus the delta.
- The 24 assertions were compiled and evaluated with the workspace's honk
  compiler in a scratch worktree at our state plus the delta
  (`scripts/verify-activation.sh`): the emitted artifact is 64 bytes,
  byte-identical (SHA-256) to the candidate's, and reduces to the constant
  `24` under source hints only — checked by our own decoder
  (`scripts/verify-activation-result.py`, not the candidate's script).
- The rule is mirrored in Rust: `nmeme_core::consensus::{active,
  creditable, check_at}` and `Verdict::Inactive`; the indexer's
  `Indexer::with_activation`, `apply_at`, `replay_at` and
  `Outcome::Inactive`; `nmeme-index rebuild --activation <height>|none`
  (default 0: the pack 9 fork, always active) with legacy `claim` funding
  records admitted as token-free. Tests: `crates/nmeme-core/tests/activation.rs`.

## What was not done here

- No kernel or node rebuild with the delta, and no live run under it: the
  fakenet node and the evidence in `results/live/` are the pack 9 fork
  (always active). A fakenet build of the candidate must pin a height in
  `nmeme-policy.hoon` first — the distributable default `~` disables
  everything this project demonstrates:

  ```
  # in the nockchain checkout, after both patches:
  sed -i '0,/^  ~$/s//  `1/' hoon/common/nmeme-policy.hoon   # phase = `1 for a fresh fakenet
  bash /path/to/nockmeme/scripts/build-node.sh ...            # RUNBOOK step 4
  nmeme-index rebuild ... --activation 1
  ```

- Nothing on the public network: no activation height, no maintainers, no
  deployment. Old nodes reject `%amm` spends; this is a coordinated
  consensus upgrade, as the candidate's own notes say.

## Findings on the candidate (for its author)

1. **The covenant's token-in count is not gated by `creditable`.**
   `check:amm` sums `tin` over every input's claim; a legacy input holding
   the pool's token would count toward the invariant. The transaction is
   still refused — `conserved:meme` gives that input no credit, so the
   pool's output claim exceeds what went in — but the covenant should gate
   `tin` the same way, for defence in depth and so the two rules cannot
   drift. No assertion covers a legacy *user* input into a pool spend; the
   legacy *pool* note is covered.
2. **A legacy entry blocks a genesis after activation** (`gen-ok` tests
   `entry`, not credit). Safe, but it means a note with old metadata must
   be spent to a clean note before it can anchor a genesis. Worth an
   assertion and a sentence in the candidate's notes.
3. **`creditable` requires `origin ≤ height`.** Always true of a note being
   spent; harmless, but it is a second condition on every input and the
   notes should say why it is there.
4. **`validate-at-phase` is exposed for tests only.** Nothing in the node
   calls it with a phase other than the policy's; an accidental caller
   would change consensus. A comment says so; a `?>` on the caller side
   would be firmer.
5. The candidate's verifier accepts only a `%spot` hint around the
   constant; ours does the same. Both refuse a deferred computation.
