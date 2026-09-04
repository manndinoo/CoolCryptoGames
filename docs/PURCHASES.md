# Purchases

Off by default. Two independent settings must both be present before anything
can be charged, so neither a stray flag nor a stray address is enough on its own.

## Turning it on

```
FEATURE_PAYMENTS=true
CCG_TREASURY_ADDRESS=<the wallet that receives payments>
SOLANA_RPC_URL=https://<an RPC endpoint>
SOLANA_CLUSTER=devnet          # or mainnet-beta
```

The treasury address is public — it is the recipient of a public transfer and
is shown to the player before they sign. It is validated on read: a malformed
address, or an off-curve one (a program derived address, which no private key
can ever sign for), is treated as absent and purchases stay off rather than
sending money somewhere it can never be spent from.

`SOLANA_RPC_URL` must be HTTPS, or loopback. A settlement decision rests on
what that endpoint says, so a plaintext link across a network is a link
somebody else can answer.

## Try it on devnet first

1. Set the four variables above with `SOLANA_CLUSTER=devnet` and a devnet RPC.
2. Put the treasury address in a wallet you control, switched to devnet.
3. Fund a second devnet wallet from a faucet and sign in with it.
4. Open a game that sells something and buy the cheapest item.
5. Check the treasury balance moved, and that the item shows as owned.
6. Sign in with a third wallet: it must own nothing.

Only then point `SOLANA_CLUSTER` at `mainnet-beta`.

## What is sold, and what is not

`lib/store/catalogue.ts` carries two kinds and only two:

- **cosmetic** — how something looks.
- **content** — more of the game.

There is no kind for lives, attempts, boosts, revives, stat increases or
tournament entries, and the `entitlements` table has a CHECK constraint that
refuses one. Every game is complete and playable, ranked or not, by a wallet
that has never spent anything.

## How a payment is verified

The browser is trusted with nothing.

1. **Quote.** The server fixes the price, the recipient and a fresh reference
   key, and stores them, before the wallet is asked for anything.
2. **Pay.** The wallet signs one plain transfer to the treasury, carrying the
   reference key as a read-only account.
3. **Settle.** The client returns a signature. The server reads that
   transaction from the cluster and compares it against the intent it issued:
   the fee payer must be the signed-in wallet, the reference must be present,
   the treasury's balance must have risen by at least the quoted amount, and
   the transaction must have succeeded.

Each of those checks stops a specific attack, and each has a test:

| Check | What it stops |
| --- | --- |
| fee payer is the session wallet | claiming someone else's real payment to the treasury |
| reference key present | presenting one payment against several intents |
| treasury balance delta | a transfer that went somewhere else |
| amount ≥ quote | paying a fraction of the price |
| `meta.err` is null | a transaction that failed on chain |
| signature is in the record | pointing at one transaction while naming another |
| `signature` column is UNIQUE | replaying a settled payment |

A signature the cluster has not seen yet answers `202`, not a refusal — a
confirmed payment can take a moment to propagate, and refusing outright would
lose real money. An unreachable RPC answers `503` for the same reason: the
payment may well be good, the server simply could not ask.

## What the platform never does

- Hold a balance. There is no column anywhere that stores a player's SOL.
- Charge twice. One item per wallet per game, enforced by a unique index.
- Move an item. Entitlements are bound to a wallet and to one game.
- Ask for a signature the player has not been shown. The amount, the recipient
  and the cluster are on screen before the wallet is opened.
