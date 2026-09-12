# The wallet side: rules, the backend, what the fakenet showed

The review of pack 5 asked for a wallet backend with four properties:
enough ordinary NOCK for network fees, token holdings and change preserved,
pending-transaction tracking, and reservation handling. Pack 6 stated the
rules and demonstrated them with shell tooling (`scripts/wallet-demo.sh`,
§A20). With the review of pack 6 a backend was supplied
(`nockmeme-wallet-backend`, a Python planner with persistent SQLite
reservations); it is integrated under `backend/` (its README explains what
was adapted and why) and run on the fakenet by `scripts/backend-demo.sh`
(results: `results/RESULTS.md` §A23). This document states the rules, what
implements them, and the contract over the package's tools.

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

## 2. What implements them

`backend/` (the integrated backend; `backend/README.md`):

| rule | where | how |
|---|---|---|
| 1 | `wallet_backend.Planner.reserve` | a buy is funded from plain notes, then from token notes of the token it buys (their units re-claimed on the bought output as one merged claim, `pool-trade --held`); a sell or transfer spends the token notes of the requested token (largest first) and pays fee and dust from their NOCK when the wallet's own even split can (`wallet_split`, a port of `++create-spends-1`), adding plain notes largest-first only when it cannot; other tokens' notes, undecodable (`unknown`) notes and reserved notes never fund anything |
| 2 | `service.WalletService._finish_trade` / `_finish_transfer` | the change claim `transfer:<token>:<held − sent>` is attached to the wallet's own lock on every sell and transfer, from the plan's `token_change_units` |
| 3 | `service.WalletService._fee_ok` / `_finish_plain` | `FEE current ≥ required` from `nmeme-tx` on the built transaction, or it is not signed or sent |
| 5 (pack 8) | `service.PoolQueue` | one trade at a time per pool across wallets and processes: the request's turn waits for the previous trade on the pool to be mined or gone, then quotes the pool as it stands and checks the request's slippage floor (`--slippage-bps`, `--min-out`) before building |
| 4 | `wallet_backend.Planner` + `service.WalletService` | one `BEGIN IMMEDIATE` transaction reserves the inputs before anything is built; the signed transaction and its id are recorded before the broadcast; settlement is `nmeme-index tx-status --txid` — mined in the canonical block at its height — and only that releases the inputs; `reconcile()` on restart resumes every open request from the record |

`scripts/lib-wallet.sh`, used by `scripts/wallet-demo.sh` (pack 6's shell version, kept as it ran):

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

The shell ledger settled on inputs leaving the unspent set; the backend
does not (§A23: that proves *a* transaction spending them was mined, not
this one). What is still not here: a network API and key custody beyond the
stock wallet's export file.

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
| settlement | `nmeme-index tx-status --addr <node> --txid <id>` | `TX-STATUS <id> mined height=<h> block=<id> canonical=yes/no`, `pending`, or `unknown`; `TIP <height>` |
| a wallet's lock root | `nmeme-tx key-lock <address>` | `KEY-LOCK <root>`, `KEY-FIRST <first>` (verified live against carol's and bob's locks) |
| every token note at a lock | `nmeme-index token-note --addr <node> --lock <lock-root> --all` | one `NOTE` per token-bearing note, `NOTE-UNKNOWN` for a claim that does not decode |
| the node's verdict | the node's log: `heard-tx: Transaction context invalid: <reason>` | a refusal at admission |

The backend keeps rules 1–4 above over these calls. The wallet's own
`create-tx --names` builds the base transaction over exactly the named
notes (seen live; the backend still reads the inputs the wallet chose,
`nmeme-index outputs --tx <file>`, and aborts if they differ from the plan).

## 4. What the fakenet showed

`results/RESULTS.md` §A20 (the shell flow) and §A23 (the backend), with
ids and balances. The facts a backend must design around, from these and
the earlier runs: the stock wallet's planner spreads the fee evenly over
the notes named — `ceil(fee / n)` each, capped to leave one nick per note,
the payment drawn from what remains in order, each note's leftover its own
change seed (`tx-builder.hoon`, `++create-spends-1`) — so a token note
holding 1,000 nicks cannot carry a 16,384-nick fee share; a wallet building two spends pays its change
from each to the same lock, and consensus merges those seeds into one
note; the planner left to itself picks the smallest notes first, so a lock
full of trade dust cannot pay a fee unless a note is named. And: the
wallet's arena grows by hundreds of megabytes per call (rebuild it from
its exported keys; §A7), a wallet rebuilt from keys lists no active child
addresses (read `list-master-addresses`), a fresh wallet knows no notes
until it has listed them once, and a covenant trade at 8,192 nicks of fee
is refused as `v1-insufficient-fee` (§A16).
