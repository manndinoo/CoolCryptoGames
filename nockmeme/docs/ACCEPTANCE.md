# The acceptance gate, and what it will take

SPEC §11 says NMEME is proven only when a live node accepts and mines a real
creation and a real transfer, and an indexer rebuilt from that chain reports the
expected split. This document records what was established about that path, so
the next session starts from facts rather than from guesses.

## Environment: builds here, cannot run a chain here

`nockchain`, `nockchain-wallet` and `zk-pow-mine` build from revision `2bcb0b9`
on a 15 GB / 4-core box. The four blockers and their fixes are in
[`DEVELOP.md`](./DEVELOP.md).

**A node will not run to `%born` on that box.** It boots, begins generating its
recursive-verifier setup, and is OOM-killed at 13.9 GB resident after ~21
minutes wall / ~80 minutes CPU:

```
Memory cgroup out of memory: Killed process 4372 (nockchain)
total-vm:27549392kB, anon-rss:13881708kB
```

No block was ever mined. So the gate below is blocked on **memory, not on
code** — the first requirement is a machine with ~32 GB (the repo's own
`Makefile` uses `DOCKER_MEM ?= 32g`). Everything after that is the tool work
described here.

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

## Re-signing: `sig-hash` in Rust is smaller than it looks

Injecting note-data changes a seed, which changes the spend's `sig-hash`, which
invalidates the existing signature. The signature has to be recomputed, and
`nockchain-types` exposes neither `sig_hash` nor signing — both live in the Hoon
wallet kernel.

That sounds like reimplementing consensus hashing. It is not, because every
primitive is already exported and one of them matches exactly.

The Hoon (`hoon/common/tx-engine-1.hoon`):

```
++  sig-hash                            :: spend-1, line 1116
  [(sig-hashable:seeds seeds.sen) leaf+fee.sen]

++  sig-hashable:seeds                  :: line 749 — walks the z-set tree
  ?@  form  leaf+form
  :+  (sig-hashable:seed n.form)
    $(form l.form)
  $(form r.form)

++  sig-hashable:seed                   :: line 707
  :*  (hashable-unit:source output-source.sed)
      hash+lock-root.sed
      hash+(hash:note-data note-data.sed)
      leaf+gift.sed
      hash+parent-hash.sed
  ==
```

The seeds walk is precisely `HashableTreeHasher`
(`crates/nockchain-types/src/tx_engine/v1/hashable.rs:121-134`), which is already
implemented as

```rust
fn empty(&self)  -> Hash { hash_leaf_null() }
fn node(&self, digest: &Hash, left: Hash, right: Hash) -> Hash {
    hash_pair(digest, &hash_pair(&left, &right))
}
```

— the same shape as `[seed-hashable [left right]]` with the empty branch hashing
`leaf+0`. So `sig-hashable:seeds` is a fold of the existing z-set hasher, and
`sig-hashable:seed` is four nested `hash_pair`s over primitives that also already
exist: `hash_unit_belt`, `hash_leaf_belt`, `hash_leaf_null`, `hash_pair`, and the
note-data digest.

There is also a fallback that avoids hand-composition entirely:
`zkvm_jetpack::jets::tip5_jets::hash_hashable` is the real jet for
`hash-hashable:tip5`, callable from Rust and already used this way by
`crates/raw-tx-checker/src/main.rs`. Build the hashable noun, call the jet, and
the digest is computed by the same code the chain uses.

One thing to be careful of: the note-data digest is **not** a plain noun hash.
`hash:note-data` (`tx-engine-1.hoon:637-650`) walks the map with its own
`hashable` that pairs `leaf+key` with the value's noun-hashable, so
`hash_owned_based_noun` on the whole map is *not* the right call.

**Verify before trusting it.** The repository ships full signed transactions as
fixtures — `crates/wallet-tx-builder/tests/fixtures/withdrawal_tx_fixtures.jam`
decodes to entries carrying a complete `Transaction` with witnesses. That makes
the check possible entirely offline:

> Compute `sig-hash` for a fixture spend in Rust, then confirm the signature
> already in that fixture verifies against it, using
> `nockchain-wallet verify-hash`.

Rust has no schnorr verifier of its own (`nockchain-math/src/crypto/cheetah.rs`
exposes only limb conversions; verification is `batch-verify:affine:belt-schnorr`
in Hoon), so the wallet does that half. Do this before touching a live chain: a
wrong digest produces signatures the node rejects for reasons that read like
networking or fee problems.

Signing itself can be delegated to the wallet, which holds the keys:
`nockchain-wallet sign-hash <base58-tip5-hash>`.

### The digest, spelled out

`hash+X` is the identity on the digest: the `%hash` branch of the hashable
dispatch returns `X` itself rather than hashing it again
(`hashable/noun.rs:48`, `decode_hash_digest_noun`). `leaf+X` hashes the noun
(`hashable/noun.rs:49`). So one seed's digest is four nested pairs:

```rust
// Seed { output_source, lock_root, note_data, gift, parent_hash }
let seed_digest = hash_pair(
    &hash_unit_belt(None),            // output_source: None in v0 create/transfer
    &hash_pair(
        &seed.lock_root,              // hash+  -> identity
        &hash_pair(
            &note_data_digest(&seed.note_data),
            &hash_pair(
                &hash_leaf_belt(Belt(seed.gift.0)),   // leaf+gift
                &seed.parent_hash,                     // hash+ -> identity
            ),
        ),
    ),
);
```

Fold the seed digests over the z-set with `HashableTreeHasher`, then

```rust
let sig_hash = hash_pair(&seeds_digest, &hash_leaf_belt(Belt(fee)));
```

`note_data_digest` is the one piece with no ready-made helper: per
`tx-engine-1.hoon:637-650` it walks the map tree pairing `leaf+key` with the
value's *noun* hashable, so it is a tree fold of
`hash_pair(hash_pair(hash_leaf_belt(key), hash_owned_based_noun(value)), ...)`
and **not** `hash_owned_based_noun` over the map as a whole.

For NMEME's own claims, `hash_owned_based_noun` is the right call on the claim
value, because a claim is exactly one such value under the `meme` key.

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
