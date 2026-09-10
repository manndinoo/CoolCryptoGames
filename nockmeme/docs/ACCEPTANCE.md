# The acceptance gate, and what it will take

SPEC §11 says NMEME is proven only when a live node accepts and mines a real
creation and a real transfer, and an indexer rebuilt from that chain reports the
expected split. This document records what was established about that path, so
the next session starts from facts rather than from guesses.

## Environment: proven

The native stack builds and runs here. `nockchain`, `nockchain-wallet` and
`zk-pow-mine` are built from revision `2bcb0b9`; the fakenet node boots and runs
its recursive-verifier setup (real STARK proving, ~40 minutes of CPU on four
cores before the kernel reaches `%born`). The three build blockers and their
fixes are in [`DEVELOP.md`](./DEVELOP.md).

Two isolated fakenet wallets exist. Isolation is via `NOCKAPP_HOME`, not the
working directory — running the wallet from two different directories without
setting it yields the *same* address from both, which looks like two wallets and
is not.

Fork phases are not an obstacle: `--fakenet-v1-phase` and
`--fakenet-bythos-phase` both default to `1`, so v1 semantics and note-data
merging are active from the first block. Mainnet's `39.000` and `54.000` do not
apply on fakenet.

## The blocker: the wallet cannot attach arbitrary note-data

`create-tx` accepts recipients only in these forms
(`crates/nockchain-wallet/src/recipient.rs:74-96`, `serde(deny_unknown_fields)`):

```
{"kind":"p2pkh",          "address":"<pkh-b58>", "amount":<nicks>}
{"kind":"multisig",       "threshold":M, "addresses":[...], "amount":<nicks>}
{"kind":"bridge-deposit", "evm-address":"0x...",  "amount":<nicks>}
```

There is no field for a custom note-data key. `--include-data` is a boolean that
governs the built-in `lock` entry, not a way to add one. So a token transaction
cannot be produced by the stock CLI, and NMEME needs a tool that injects the
`meme` entry into a wallet-built transaction and re-signs it.

This is the same thing the repository's own bythos e2e test does, which is the
best available template: `crates/nockchain-e2e/tests/upgrade_bythos.rs`.

## Transaction file shape

`create-tx` writes a jammed noun under `./txs`. Decoded
(`upgrade_bythos.rs:1047-1082`) it is:

```
[1 name spends display witness-data]
```

where `witness-data` is carried *separately* from `spends` and is spliced back
onto each spend by name before use (`apply_witness_data`,
`upgrade_bythos.rs:1128-1173`). A tool must therefore rewrite both halves.

## The hard part: `sig-hash` must be reimplemented in Rust

Injecting note-data changes a seed, which changes the spend's `sig-hash`, which
invalidates the existing signature. The signature has to be recomputed.

`nockchain-types` exposes no `sig_hash` and no signing — both live in the Hoon
wallet kernel. So the tool must compute the sig-hash itself, from
`hoon/common/tx-engine-1.hoon`:

```
++  sig-hash                            :: spend-1, line 1116
  [(sig-hashable:seeds seeds.sen) leaf+fee.sen]

++  sig-hashable                        :: seed, line 707
  :*  (hashable-unit:source output-source.sed)
      hash+lock-root.sed
      hash+(hash:note-data note-data.sed)
      leaf+gift.sed
      hash+parent-hash.sed
  ==
```

The building blocks exist in `crates/nockchain-types/src/tx_engine/v1/hashable.rs`
(`hash_leaf_belt`, `hash_leaf_null`, `hash_hashable_value`) and
`nockchain_math::owned_based_noun::hash_owned_based_noun_varlen`.

**Verify before trusting it.** A Rust reimplementation of consensus hashing that
is subtly wrong will produce a signature the node silently rejects, and the
failure will look like a networking or fee problem. The check is cheap and
should come first:

> Take an unmodified wallet-built transaction, compute its `sig-hash` in Rust,
> and confirm the signature already in the file verifies against it.

Only once that passes is it safe to change a seed and re-sign.

Signing itself can be delegated to the wallet, which holds the keys:
`nockchain-wallet sign-hash <base58-tip5-hash>`.

## Proposed flow

1. `nockchain-wallet create-tx …` — wallet builds a correct v1 spend and witness.
2. `nmeme-tx inject --tx <file> --claim <claim>` — decode, add the `meme` entry
   to the seed for the intended lock-root, recompute `sig-hash`, print it.
3. `nockchain-wallet sign-hash <hash>` — signature over the modified spend.
4. `nmeme-tx attach --sig <sig>` — splice into witness-data, re-jam.
5. `nockchain-wallet send-tx` — broadcast.
6. Poll `tx-status` / `tx-accepted` until mined.
7. Read the canonical chain, build `TxView`s, run `Indexer`, compare balances.

Steps 2 and 4 are the tool. Everything else is stock.

## Two things to check on the first live run

Both are read from source and neither has been confirmed against a node:

1. **Merging.** Send two seeds to the same lock-root in one transaction, each
   with a `meme` entry, and confirm the resulting note carries exactly one entry
   and the union rule behaves as `tx-engine-1.hoon:2380-2386` describes. This is
   what FINDINGS §3 and SPEC R1 rest on.
2. **`output-source` pinning.** Confirm a pinned seed is rejected when the merged
   seed set at its lock-root differs from the pin. The entire swap design
   ([`SWAPS.md`](./SWAPS.md)) depends on this, and it should be confirmed before
   anything is built on top of it.

## Fees

Post-bythos: `base-fee = 2^14` per word for seeds, and witness words are divided
by `input-fee-divisor = 4`; minimum fee is `256` nicks
(`tx-engine-1.hoon:497-501`). A `meme` entry adds a handful of leaves, so it
adds a handful of words of fee — negligible, but not zero, and the merged
note-data per lock-root must stay under `max-size = 2.048` leaves.
`crates/wallet-tx-builder/src/word_count.rs` is the reference implementation of
the estimate, and `compute_fee_bounds` in the bythos e2e test shows how to use it.
