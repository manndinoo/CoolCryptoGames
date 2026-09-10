# Verified Nockchain facts for a token overlay

Everything below was read from the Nockchain source at revision
`2bcb0b9dfd190f17252205afd1c8a067048a1ad9` (`github.com/nockchain/nockchain`,
which is also where `zorp-corp/nockchain` redirects). Citations are
`file:line` into that checkout. Nothing here is inferred from documentation
or from the earlier Python simulation.

Where a finding contradicts the `nock-test-lab` simulation, that is called out
as **Corrects the simulation**.

## 1. Note-data is a real, usable extension point

`note-data` is a map from term to arbitrary noun:

```
+$  form  (z-map @tas *)
```
`hoon/common/tx-engine-1.hoon:620`

Three keys are reserved by consensus-adjacent tooling:

| Key | Constant | Meaning |
| --- | --- | --- |
| `lock` | `NOTE_DATA_KEY_LOCK` | wallet lock metadata |
| `bridge` | `NOTE_DATA_KEY_BRIDGE_DEPOSIT` | Base bridge deposit |
| `bridge-w` | `NOTE_DATA_KEY_BRIDGE_WITHDRAWAL` | bridge withdrawal |

`crates/nockchain-types/src/tx_engine/v1/note.rs:156-158`

Any other key decodes to the wildcard variant `NoteDataValue::Noun(_)` and is
preserved verbatim:

```rust
_ => Self::raw_noun_value(raw_value, space)?,
```
`crates/nockchain-types/src/tx_engine/v1/note.rs:~315`

So a token standard can claim its own key without patching the node. This is
the confirmed integration point.

## 2. Note-data is signed

The per-spend signature hash covers the spend's own seeds and fee:

```
++  sig-hash
  |=  sen=form
  ^-  ^hash
  %-  hash-hashable:tip5
  [(sig-hashable:seeds seeds.sen) leaf+fee.sen]
```
`hoon/common/tx-engine-1.hoon:1116-1120`

and each seed's signed image includes the hash of its note-data:

```
:*  (hashable-unit:source output-source.sed)
    hash+lock-root.sed
    hash+(hash:note-data note-data.sed)
    leaf+gift.sed
    hash+parent-hash.sed
==
```
`hoon/common/tx-engine-1.hoon:710-715`

**Token metadata is therefore authenticated by the spender's signature.** An
indexer does not need a separate authorization scheme: whoever controls the
input note authorized the token operation attached to it.

**Corrects the simulation.** The simulation carried a JSON `owner` label and
warned that it "is never authorization". On the real chain the note-data is
inside the signed payload, so authorization is structural.

## 3. Outputs merge by lock-root — allocations cannot be per-output

This is the finding that most changes the design. Within one transaction, every
seed sharing a lock-root collapses into a **single** output note. Assets are
summed and note-data maps are unioned:

```
=/  updated-child=output
  :_  new-seeds
  %=  note.child
    assets  new-assets
    name    (new-v1:nname [lock-root.sed src])
    note-data  (~(uni z-by note-data.note.child) note-data.sed)
  ==
```
`hoon/common/tx-engine-1.hoon:2380-2386`

The fee estimator mirrors it, keyed on `lock_root`, with later keys overwriting
earlier ones:

```rust
let mut merged_by_lock_root = BTreeMap::<[u64; 5], BTreeMap<String, Bytes>>::new();
```
`crates/wallet-tx-builder/src/word_count.rs:58-79`

Merging activates at the `bythos` fork height (default `bythos-phase=54.000`,
`hoon/common/tx-engine-1.hoon:493`); before it, the legacy per-seed accounting
applies (`word_count.rs:44-49`).

**Corrects the simulation.** `overlay.py` allocates to individual output notes
(`{"note": ..., "amount": ...}`) and treats two outputs owned by the same party
as distinct — its own fixture sends to `change-a` and `received-b` and would
have had `test-a`/`change-a` merge on a real chain. On Nockchain there is at
most one output note per distinct lock-root per transaction, and note-data keys
collide destructively when two seeds to the same lock-root both set the token
key.

**Consequence:** a token standard must allocate **by lock-root (recipient)**,
not by output index, and must define exactly one token entry per lock-root.

## 4. Hard limits

| Limit | Value | Source |
| --- | --- | --- |
| Max leaves in merged note-data per lock-root | `2.048` | `tx-engine-1.hoon:497` |
| Min fee | `256` nicks | `tx-engine-1.hoon:497` |
| Post-bythos base fee per word | `2^14` = 16384 | `tx-engine-1.hoon:499` |
| Input fee divisor | `4` | `tx-engine-1.hoon:501` |
| v1 activation height | `39.000` | `tx-engine-1.hoon:492` |
| bythos activation height | `54.000` | `tx-engine-1.hoon:493` |

Oversized note-data is rejected at validation with
`%v1-note-data-exceeds-max-size` (`tx-engine-1.hoon:1236-1237`), and the size is
measured on the **merged** map per lock-root (`tx-engine-1.hoon:1214-1222`), not
per seed.

## 5. Every atom must be a field element

`based:note-data` requires every atom in the note-data noun — keys and all atoms
inside values — to satisfy `based`:

```
%-  ~(rep z-by form)
|=  [[k=@tas v=*] a=?]
?&(a (^based k) (based-noun v))
```
`hoon/common/tx-engine-1.hoon:622-631`

with the field prime

```rust
pub const PRIME: u64 = 18446744069414584321;   // 2^64 - 2^32 + 1
```
`crates/nockchain-math/src/belt.rs:17`

**Consequence:** an 8-byte ASCII ticker packed as one cord can exceed `PRIME`
and be rejected. Tickers must be limited to **7 bytes per atom** or split into
limbs. The simulation used Python strings and never had to confront this.

## 6. Locks are expressive enough for trading

```rust
pub enum LockPrimitive { Pkh(Pkh), Tim(LockTim), Hax(Hax), Burn }
```
`crates/nockchain-types/src/tx_engine/v1/tx.rs:776-781`

- `Pkh` is m-of-n multisig (`Pkh::new(1, vec![pkh])`, `tx.rs:957`)
- `Tim` is relative + absolute timelocks (`tx.rs:962-967`)
- `Hax` is a hash-preimage lock — an HTLC primitive (`tx.rs:890-899`)
- `Burn` is a provable burn

and `Lock` is a disjunction of 2/4/8/16 alternative spend conditions
(`tx.rs:618-629`). HTLCs, escrows and covenant-ish branching are all
expressible without any node change.

## 7. Single-transaction trustless swaps are native

Two facts combine:

1. A signature commits **only to its own spend's seeds and fee** (§2). It does
   not commit to the other inputs of the transaction. This is
   `SIGHASH_SINGLE | ANYONECANPAY` semantics, by default.
2. A seed may pin `output-source`, and validation requires the resulting output
   note's source hash to equal the hash of the **complete normalized merged seed
   set** landing on that lock-root:

```
?~  output-source.seed  %.y
.=   %-  hash-hashable:tip5
     :*  leaf+&
         (hashable:source u.output-source.seed)
         leaf+~
      ==
source-hash
```
`hoon/common/tx-engine-1.hoon:1413-1418`

So a maker signs a spend that pays the taker, and pins `output-source` on a
seed paying **its own** lock-root. That pin is only satisfied if the taker's
payment seed — exact amount, exact note-data — is also present at the maker's
lock-root. A maker's half-signed offer cannot be broadcast alone to steal the
goods, because the maker's own output would fail its source check.

This yields exact-fill, non-interactive offers settled in one transaction, with
no escrow, no HTLC round-trip and no custody. Partial fills are not possible
under this construction because the pin is over an exact set.

## 8. Burn-on-invalid is the right model, and the simulation got it right

Once a base spend is confirmed its inputs are spent regardless of whether the
token payload parses. Rolling back an invalid token action while leaving the
input spent would resurrect tokens. The simulation's choice to burn consumed
colors on invalid metadata matches what the real chain forces, and carries over
unchanged.
