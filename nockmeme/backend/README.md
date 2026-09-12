# The wallet backend, integrated

The wallet backend supplied with the review of pack 6 (`nockmeme-wallet-backend`,
"first implementation": a Python planner with persistent SQLite reservations and
a native wallet-creation wrapper, 15 tests) lives here, integrated with the
package's tools and run on the fakenet. Python 3.10+, standard library only.

| file | what |
|---|---|
| `wallet_backend.py` | the supplied planner (`Note`, `Snapshot`, `Request`, `Plan`, `Planner`, `create_test_wallet`), its selection rule adapted to the live findings (below); `Planner.reserved()` and `Planner.release()` added for the service |
| `chain.py` | the trusted adapter: node reads, transaction files, the wallet binary — every call a subprocess of `nmeme-index`, `nmeme-tx` or `nockchain-wallet`, serialised per wallet with a file lock, the wallet's arena rebuilt from its exported keys when it outgrows its budget |
| `service.py` | the lifecycle: request → atomic reservation → build → durable record → broadcast → settlement by transaction id and canonical inclusion → release; `reconcile()` on restart |
| `cli.py` | the command line the fakenet suite drives (`create`, `balances`, `pay`, `buy`, `sell`, `transfer`, `reconcile`, `wait`, `status`) |
| `tests/test_wallet.py` | the supplied tests (two of them updated to the adapted rule, see below) |
| `tests/test_service.py` | the lifecycle against a scripted chain: restart at each point of a submission, settlement never by inputs, two processes on one note, balances split |
| `demo.py` | the supplied synthetic example, unchanged |
| `../scripts/backend-demo.sh` | the live run: a fresh wallet from zero through create → fund → buy → sell → transfer, simultaneous requests, a restart during submission |

```sh
cd nockmeme/backend && python3 -m unittest discover -s tests -v     # 26 tests
```

## What was adapted, and why

The supplied planner funded every network fee from plain notes only and
reported the NOCK a token note carries as "backing" the builder must
conserve. The fakenet showed two facts that make that rule strand funds
(docs/WALLET.md §1 and §4):

1. **Consensus merges seeds to one lock.** A spend's change seed and a token
   seed to the same lock become one note. After a buy, the buyer's NOCK change
   sits inside the token note it bought (`wallet-demo.sh`, pack 6: a wallet
   that bought and sold held *no plain note at all*; through this backend,
   carol's live balance reads `nock_available=0 nock_attached=13975575`).
   Spending a plain note next to a token note only moves the plain note's
   change into the token note.
2. **The stock wallet splits the fee evenly over the notes it is told to
   spend**: `ceil(fee / n)` per note, capped to leave one nick for the note's
   own seed, the payment drawn from what remains in order, each note's
   leftover returned as its own change seed (`tx-builder.hoon`,
   `++create-spends-1`). A note holding 1,000 nicks cannot carry a 16,384-nick
   fee share.

So the adapted rule is: a token note of the **requested** token that a sell
or a transfer spends anyway — with its change claim attached — pays the
network fee and the dust payment from the NOCK it carries; a plain note is
added only when that backing cannot cover them. `wallet_split()` is a port of
the wallet's allocation, and the planner adds plain notes (largest first:
the fewest inputs) until the split pays fee and payment in full — so the
wallet never refuses the plan with "Insufficient funds to pay fee and gift".
A buy is funded from plain notes only, as supplied. Notes of another token,
notes whose claim does not decode (`unknown`), and reserved notes never fund
anything, as supplied. Tokens and their change are never touched: the plan
carries the change claim (`token_change_units`) and the backing NOCK that
did not pay fee or payment (`token_backing_nicks − backing_spent_nicks`)
returns as the token note's change, inside the note that carries the claim.

Two supplied tests encoded the old rule and were updated:
`test_sell_preserves_token_change_and_attached_nock` now expects the token
note to pay the 20-nick fee from its 900 nicks (no plain input;
`token_change_nicks = 880`), and `test_no_plain_nock_refuses_even_with_token_backing`
became `..._when_token_backing_cannot_pay` (a token note holding 15 nicks
cannot pay a 20-nick fee; with a plain note the fee is split 10/10).

Also added to the planner: a `pay` side (a plain NOCK payment, used to fund
a wallet), a `transfer` side (like a sell for selection), and for a buy
`token_units` is the minimum the quote must deliver (the builder refuses a
quote below it before signing).

## The lifecycle (service.py)

```
request ─► snapshot (funding + token notes at ONE block; the tip re-read)
        ─► Planner.reserve   BEGIN IMMEDIATE: duplicate request refused, reserved notes excluded, inputs chosen, COMMIT
        ─► submissions: planned
        ─► nockchain-wallet create-tx --names <exactly the planned inputs>   (checked: the wallet spent what was planned, or abort + release)
        ─► nmeme-index check-inputs; nmeme-tx sighash; every wallet signature verified
        ─► nmeme-tx pool-trade / attach; FEE current ≥ required; buy: quote ≥ minimum; re-sign touched spends
        ─► submissions: built  (the signed file and its id on disk, BEFORE any broadcast)
        ─► nmeme-index send    ─► admitted: sent (height noted)   /  not admitted: refused, released
        ─► settle: nmeme-index tx-status --txid
               mined, canonical=yes  → mined, released
               mined, canonical=no   → stays sent (an orphaned block is not settlement)
               pending               → not in a block AND in the node's accepted set: stays sent
                                       (built → sent if the record of the broadcast was lost)
               unknown               → not in a block and not in the accepted set: the stored file is sent
                                       (a built transaction never sent, or a mempool the node lost);
                                       its id is a content hash, so this is the same transaction
        ─► reconcile() on start: every open request through settle(); a planned request with no built
           transaction was never broadcast (the record precedes the send) and is aborted, its inputs released
```

Inputs having left the unspent set is never taken as settlement: it proves
that *a* transaction spending them was mined, not this one. And the node's
block lookup (`GetTransactionBlock`) answers "pending" for any id that is
not in a block — an id it has never seen included (seen live: a refused
transaction, and a built one that was never sent, both read as pending).
`tx-status` therefore asks the node's accepted set as well
(`TransactionAccepted`, the question `send` asks after a broadcast) and
reports `pending` only when the node holds the transaction.

**Balances** (`balances`): `nock_total` (every note at the lock),
`nock_available` (plain notes not reserved), `nock_pending` (plain notes
reserved by an open request), `nock_attached` (NOCK carried by token notes)
and `nock_attached_pending` (of that, reserved), `nock_unknown`
(claim-bearing notes whose claim does not decode); per token `total`,
`available`, `reserved`, and the open requests with their state and id.

**Concurrency.** Two processes on one wallet share the database: the
reservation is one `BEGIN IMMEDIATE` transaction, so the second sees the
first's reservation or waits for it. Wallet binary calls are serialised per
wallet with `flock` (two processes in one arena corrupt it, seen live).

## What the fakenet showed (results/RESULTS.md §A23)

See the results section for the transaction ids, blocks and balances of the
fresh wallet's flow, the simultaneous requests and the restarts.

## Not here

A network API, key custody beyond the stock wallet's export file,
reorganisation handling beyond the canonical check at settlement (a
transaction whose block leaves the canonical chain stays `sent` and is
re-checked; on one fakenet node no reorganisation can be provoked), fee
estimation before the build (the fee is the suite's fixed 16,384 nicks,
checked against the chain's requirement on the built transaction).
