# The acceptance gate, and what it took

SPEC §11 says NMEME is proven only when a live node accepts and mines a real
creation and a real transfer, and an indexer rebuilt from that chain reports the
expected split.

## Status: passed

On 2026-09-11, in this environment, `scripts/live-demo.sh` ran unmodified to
exit 0 against a fakenet node: genesis
`CxfcXk3W3dAHAhZXGJjKKZ2FnZBW4JhgfU61Y2ju2RGB4duWipZfhBh` mined at height 75,
transfer `Z8tvhDFP4SkuxcfCzkLpjorxryUF7jocdZB3HCPEeqjmokVqsC5Gi` at height 91,
balances rebuilt from the chain at a stable snapshot at height 104:
999,900 / 100 of 1,000,000. Evidence and the three things the chain taught
that source reading had not: [`../results/RESULTS.md`](../results/RESULTS.md)
§A11 and [`../results/live/`](../results/live/).

The sections below are the path that got there, kept because each turned out
to matter. The memory ceiling was real; the way around it was to generate the
verifier-setup seed cache elsewhere, one bucket per free hosted-runner job
(`../seedgen/`, `.github/workflows/nmeme-seed-buckets.yml`), and install it
(`scripts/install-seed-cache.sh`). With the cache present the node boots here
in 10 seconds at 197 MB.

## Environment: generation does not run here (the node does)

`nockchain`, `nockchain-wallet` and `zk-pow-mine` build from revision `2bcb0b9`
on a 15 GB / 4-core box. The build blockers and their fixes are in
[`DEVELOP.md`](./DEVELOP.md).

A first attempt at running a node was OOM-killed at 13.9 GB resident, against a
**13.34 GiB** cgroup ceiling (`memory.limit_in_bytes = 14327676928`), after ~21
minutes wall and ~80 minutes CPU, having mined nothing:

```
Memory cgroup out of memory: Killed process 4372 (nockchain)
total-vm:27549392kB, anon-rss:13881708kB
```

The obvious lever was tried and does not work. The verifier-setup build is
rayon-parallel (`RAYON_NUM_THREADS` is cited as a tuning knob in
`crates/ai-pow/src/zk_bridge.rs:3689`), and early in a single-threaded run RSS
sat at 2–6 GiB, which looked like a fit. It was not:

| Configuration | Peak RSS | Result |
| --- | --- | --- |
| default (4 threads) | 13.24 GiB | OOM-killed before `%born`, ~21 min |
| `RAYON_NUM_THREADS=1` | 13.93 GB at kill | OOM-killed before `%born`, ~89 min |

Memory climbs through the later buckets regardless of thread count. An earlier
version of this document reported the single-threaded run as fitting; that was
a mid-run reading and it was wrong.

Both knobs used are documented operator settings, not workarounds:

- `RAYON_NUM_THREADS` — prover parallelism.
- `AI_POW_VERIFIER_CACHE_CAP` — resident-context LRU cap
  (`ai-pow-jets/src/setup.rs:692`; `docs/VERIFIER_SETUP.md` says operators may
  "lower the cap to trade RSS for synchronous page-ins").

**So generation is blocked on memory here** — and it later measured far
beyond 32 GB at four threads: the two 2^19 buckets each need a ~50 GB working
set (`../results/environment.md`). It was never the node that did not fit;
it was this one-time job, which is why moving the job elsewhere resolved it.

**On a cached setup.** `install_or_build_verifier_setup`
(`ai-pow-jets/src/setup.rs:743`) takes a fast path when a digest-matching seed
cache is already present, skipping generation entirely. The digest is committed
in-source (`AI_POW_V0_VERIFIER_SETUP_TABLE_DIGEST`), so a cache built by any
conforming node would validate. No such cache is published in the repository or
its docker directory, and none was found — so this run generates its own. A
cache copied from a machine that has already paid the cost would remove the
startup wait, and is the right answer for repeated runs.

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

**Verify before trusting it**, and note that the obvious offline route does not
work. `crates/wallet-tx-builder/tests/fixtures/withdrawal_tx_fixtures.jam` looked
like ground truth — it decodes to five entries carrying complete v1
`Transaction`s with witnesses — but every one of them carries **zero
signatures**. They are fee-estimation fixtures, not signed transactions.
`nmeme-tx`'s `sighash_fixtures` test reports this rather than silently passing:

```
INFO withdrawal-basic  v1 spend: 1 seed(s), 0 signature(s), pinned_source=0
```

Rust has no schnorr verifier of its own either — `nockchain-math/src/crypto/cheetah.rs`
exposes only limb conversions, and verification is
`batch-verify:affine:belt-schnorr` in Hoon.

So the authoritative check needs a signed transaction, which needs a funded
note, which needs a running node:

> Build a transaction with `create-tx` (the wallet signs it), compute its
> `sig-hash` in Rust **without modifying anything**, and confirm the signature
> already in the file verifies against that digest via
> `nockchain-wallet verify-hash`.

Only once that passes is it safe to attach a claim and re-sign. Doing it in this
order means a wrong digest is caught as a failed verification rather than as a
node rejection that reads like a fee or networking problem.

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
7. Bind each local transaction file to the mined transaction, derive complete
   output identities from its seeds, replay through `Indexer`, assert balances.

Steps 2 and 4 are the tool. Everything else is stock.

## Two things to check on the first live run

Read from source; the first is now observed on chain (the transfer's two
destinations landed at their lock-roots with their claims), the second is
still open:

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
