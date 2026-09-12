# The wallet side: rules, what exists, what a backend has to do

The review of pack 5 asked for the wallet backend "supplied separately" to
be integrated, with four properties: enough ordinary NOCK for network
fees, token holdings and change preserved, pending-transaction tracking,
and reservation handling. **No wallet backend was supplied to this work**:
nothing under that name is in the repository or was attached to the task.
This document states the rules such a backend must follow, what this
package already implements of them (and demonstrates live), and the
contract a backend integrates against. The demonstration is
`scripts/wallet-demo.sh` (results: `results/RESULTS.md` §A20).

## 1. The four rules

1. **A token note is never spent without its claim.** A note carrying a
   `meme` claim is a token holding; spending it as plain NOCK burns the
   tokens (SPEC §7, a consensus fact on every node). Coin selection for a
   payment or a fee prefers plain notes and never picks a token note as
   *plain* funds. When a token note is being spent anyway — with its change
   claim attached (rule 2) — the NOCK it carries may pay the fee. It has to:
   consensus merges a spend's change seed with a token seed to the same
   lock into one note, so after a buy the buyer's change sits inside the
   token note, and after a sell the seller's change does too (seen live,
   `wallet-demo.sh`: a wallet that bought and sold held no plain note at
   all, all its NOCK inside two token notes). A backend that only ever
   spent plain notes would strand that NOCK.
2. **A token spend carries its change claim.** Spending a note holding `n`
   of a token to send `k` attaches `transfer:<token>:<k>` to the
   recipient's seed and `transfer:<token>:<n − k>` to the sender's change
   seed, one claim per lock root (SPEC R1). Under the fork's rule a missing
   change claim is a partial burn, not an error: the wallet is the last
   line of defence.
3. **The fee is checked before sending.** Attaching claims adds words, and
   the chain's fee requirement counts them (`nmeme-tx` reports
   `FEE current=… required=…` on every attach and pool trade; on the fakenet
   a covenant trade needs 16,384 nicks where a plain payment needs 8,192).
   A transaction whose fee is below the requirement is never sent.
4. **Sent inputs are reserved until settled.** The inputs of a transaction
   the node admitted are reserved from the moment it is sent. They are
   released when the transaction is mined (its inputs have left the unspent
   set) or when the node refuses it (the answer to the submission, or a
   refusal seen in the node's log). A second transaction never selects a
   reserved note, so two spends of one note cannot be built by mistake —
   the node would refuse the second anyway, but with the first admitted
   and holding the note (§A15: an admitted transaction that later fails a
   check keeps its inputs reserved in the mempool), the wallet would
   otherwise keep building against a note it cannot spend.

## 2. What this package implements

`scripts/lib-wallet.sh`, used by `scripts/wallet-demo.sh`:

| rule | function | how |
|---|---|---|
| 1 | `w_pick_plain <who> <lock> <need>` | reads the wallet's unspent notes through the indexer (`nmeme-index funding --lock`), takes the smallest note typed `plain` holding at least `need`, never one typed `claim`, never a reserved one; when none exists and a token note is being spent with its claim, that note's NOCK pays the fee |
| 1 | `w_nock <lock>` | the wallet's spendable NOCK: plain and coinbase notes only; token notes counted separately |
| 2 | callers | every token spend in the suites attaches the change claim (`open_pool`, `pool-trade --claim`, `attach … <change-lock>=transfer:…`) |
| 3 | `w_fee_ok <attach-or-trade output>` | `current ≥ required` from the tool's FEE line, or the transaction is not sent |
| 4 | `w_reserve`, `w_release`, `w_reserved`, `w_pending`, `w_reconcile` | a ledger per wallet (`pending.tsv`: txid, note, label, height sent); reconcile releases a transaction whose inputs are all spent (mined) and reports one still pending; a refusal at submission releases immediately |

The demo runs a new wallet through creation, funding, a buy from the main
pool, a sell of half back, and a transfer to another wallet, printing the
transaction id, the block, the balances before and after (NOCK in plain
notes at the wallet's lock, tokens by the indexer's view of its notes), and
the ledger's state after each send.

What is *not* here: a service. The ledger is a file per wallet, selection
is a shell function over an indexer read, and the demo drives one wallet
serially. There is no API, no concurrency across wallets, no persistence
beyond the file, no retry policy. Those belong to the backend.

## 3. The contract a backend integrates against

Everything the backend needs is a command with a line-oriented output:

| need | command | output |
|---|---|---|
| unspent notes at a lock, typed | `nmeme-index funding --addr <node> --lock <lock-root>` | `FUNDING <first> <last> <kind: plain/coinbase/claim> <nicks>` |
| token holdings at a lock | `nmeme-index token-note --addr <node> --lock <lock-root> --token <id>` | `NOTE [<first> <last>] … <amount>` |
| a pool's state | `nmeme-index pool --addr <node> --token <id> --fee-bps <n> --lore-bps <n> --lore-lock <root>` | `POOL <first> <last> <origin> <nock> <tokens>` |
| a quote and the trade | `nmeme-tx pool-trade <wallet-tx> <out> --pool "<POOL line>" --side buy/sell …` | `QUOTE …` with every fee in its unit, `POOL-AFTER`, `NEWSIGHASH` per spend to re-sign, `FEE current= required=` |
| a token transfer | `nmeme-tx attach <wallet-tx> <out> <lock>=transfer:<id>:<n> <change-lock>=transfer:<id>:<held − n>` | `ATTACHED`, `FEE`, `NEWSIGHASH` |
| re-signing | `nockchain-wallet sign-hash <digest>` then `nmeme-tx set-sig` | the signed file |
| sending | `nmeme-index send --addr <node> --tx <file>` | `TXID <id>`, `MEMPOOL admitted / not admitted` |
| settlement | `nmeme-index funding --first <first>` (the note's presence) | mined when every input has left the unspent set |
| the node's verdict | the node's log: `heard-tx: Transaction context invalid: <reason>` | a refusal at admission |

A backend keeps rules 1–4 above over these calls. The wallet's own
`create-tx` builds the base transaction (it selects plain notes when given
`--names`, and adds inputs for the fee on its own — which is why the
funding proofs and the reservation ledger matter: the backend must read
the inputs the wallet actually chose, `nmeme-index outputs --tx <file>`,
and reserve those).

## 4. What the fakenet showed

`results/RESULTS.md` §A20: the wallet flow, with ids and balances. And
from the earlier runs, the facts a backend must design around: the
wallet's arena grows by hundreds of megabytes per call (rebuild it from
its exported keys; §A7), a wallet rebuilt from keys lists no active child
addresses (read `list-master-addresses`), a fresh wallet knows no notes
until it has listed them once, and a covenant trade at 8,192 nicks of fee
is refused as `v1-insufficient-fee` (§A16).
