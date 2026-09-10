# nockmeme

A memecoin standard and platform for Nockchain.

Nockchain has no token layer. NMEME adds one without touching consensus, by
carrying token weight in the `note-data` field that Nockchain notes already
support.

## Status

| Stage | State |
| --- | --- |
| Consensus facts verified against source | done — [`docs/FINDINGS.md`](./docs/FINDINGS.md) |
| Standard specified | done — [`docs/SPEC.md`](./docs/SPEC.md) |
| Encoding + accounting implemented | in progress — [`crates/nmeme-core`](./crates/nmeme-core) |
| Native stack builds | done — [`docs/DEVELOP.md`](./docs/DEVELOP.md) |
| Node runs a chain | yes at `RAYON_NUM_THREADS=1` (5.7 GiB); OOM at default parallelism — [`results/environment.md`](./results/environment.md) |
| Transaction tooling | built, **digest not yet verified** — [`crates/nmeme-tx`](./crates/nmeme-tx) |
| Proven on a live fakenet chain | not done — [`docs/ACCEPTANCE.md`](./docs/ACCEPTANCE.md) |
| Trading | designed — [`docs/SWAPS.md`](./docs/SWAPS.md) — not implemented |
| Platform UI | not started |

**Nothing here has touched a real chain yet.** The acceptance gate is SPEC §11:
a local node must accept and mine a real creation and a real transfer, and an
indexer rebuilt from that chain must report the expected split. Until then this
is a design with tests, not a working token.

One measured claim to be careful with: the `sig-hash` implementation in
`nmeme-tx` is **not yet verified against a signature the wallet produced**. The
obvious offline route does not work — the repository's transaction fixtures
carry no signatures. Until the check in
[`docs/ACCEPTANCE.md`](./docs/ACCEPTANCE.md) passes, treat every digest this
crate computes as unproven.

## Why note-data

Every Nockchain note carries `note-data`, a map from term to arbitrary noun.
Three keys are reserved (`lock`, `bridge`, `bridge-w`); everything else is
preserved verbatim by the node. NMEME claims the key `meme`.

Crucially, note-data is hashed into the seed and therefore into the signature,
so a token claim is authenticated by whoever controlled the input note. There is
no separate authorization scheme to get wrong.

## The three things that make this different from a Bitcoin-style colored coin

1. **Outputs merge by lock-root.** Two payments to the same recipient in one
   transaction become one note, and their note-data is unioned. Allocations are
   therefore addressed to *recipients*, never to output indices.
2. **Every atom must be a field element.** The Goldilocks prime bounds what can
   be encoded, which is why tickers are carried as 7-byte limbs.
3. **Signatures are `SIGHASH_SINGLE | ANYONECANPAY` by default.** Combined with
   `output-source` pinning, this makes single-transaction trustless swaps a
   native capability rather than something to build with HTLCs.

All three are cited to source in [`docs/FINDINGS.md`](./docs/FINDINGS.md).

## The sharp edge

Spending a token note with a token-unaware wallet **burns the tokens**. This is
forced: the base chain has already spent the input, and an overlay that undid
that would resurrect supply on the next rebuild. Token-aware note selection is a
hard requirement for any wallet touching these notes.

## Building

`nmeme-core` builds against Nockchain at revision
`2bcb0b9dfd190f17252205afd1c8a067048a1ad9`. See
[`docs/DEVELOP.md`](./docs/DEVELOP.md) for the toolchain, the kernel-asset build
that the Rust build depends on, and the container settings it needs.
