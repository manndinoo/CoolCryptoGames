# Purchases

Off by default. One deliberate switch turns them on.

## Turning it on

```
FEATURE_PAYMENTS=true
```

That is the whole requirement. The treasury and the RPC endpoint have working
defaults:

| Setting | Default | Override with |
| --- | --- | --- |
| Treasury | `EwyzBV1hAVYWvtP6dUiFkXVvwaB9WQ2ghMxP1TjgAkQy` | `CCG_TREASURY_ADDRESS` |
| RPC | `https://api.mainnet-beta.solana.com` | `SOLANA_RPC_URL` |
| Cluster | `mainnet-beta` | `SOLANA_CLUSTER` |
| Price feed | CoinGecko's public SOL/USD endpoint | `SOL_PRICE_URL` |

The treasury is committed rather than left to a dashboard because every setup
step is a step that gets skipped or mistyped, and a mistyped recipient sends
real money to a stranger. It is public by nature — the recipient of a public
transfer, shown to the player before they sign — so there is nothing about it
to keep secret.

It is validated even though it is a constant. A committed address is still a
typed address, and the one purchase failure that cannot be undone is paying
into something no key can spend from: a malformed address, or an off-curve one
(a program derived address, which has no private key), is treated as absent and
purchases stay off.

**Replace the RPC before you take real volume.** Solana's public endpoint is
rate limited hard enough that settlements will start failing under load. A
failed settlement does not lose a payment — the intent stays open and the item
is granted on retry — but players will see it.

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

## Pricing

Items are listed in **US dollars** and charged in **SOL**. A dollar is what a
price means to a person; SOL is what the wallet sends.

The conversion happens once, when a purchase is quoted, at that moment's rate.
The resulting lamport figure is written onto the intent, so the amount the
player approves is the amount the server later checks against the chain — a
move in the SOL price between the quote and the signature cannot change what
they owe. That is also why a quote expires after ten minutes: a price held open
indefinitely is a price somebody comes back to claim after the market has moved.

Both the dollar price and the rate used are stored on the intent and on the
resulting entitlement, so a settled purchase is still explicable a year later.
`0.0093 SOL` on its own does not say whether that was the intended $1.99 or a
feed returning nonsense.

**No usable rate means no sale.** If the feed is unreachable the last rate is
reused for up to ten minutes; past that, quoting stops and the route answers
503. Guessing a rate is the only failure mode that could charge somebody many
times what an item costs, so the failure is a refused sale rather than an
invented number. A rate outside $1–$10,000, or a quote above 5 SOL, is refused
outright — those are guards against a feed returning zero, a string, or a
number in the wrong units.

Displayed SOL figures are always rounded **up**. A shown amount below what is
actually charged is the thing that reads as a bait.

### Current prices

| Item | Game | Kind | Price |
| --- | --- | --- | --- |
| Neon trail | Zero Signal | cosmetic | $0.99 |
| Chrome fighters | Signal Brawl | cosmetic | $1.99 |
| Extra arenas | Signal Brawl | content | $2.99 |

Edit `lib/store/catalogue.ts` to change them. A test asserts every price stays
between $0.50 and $5.00, so a stray zero has to argue with the suite rather
than slip past.

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
