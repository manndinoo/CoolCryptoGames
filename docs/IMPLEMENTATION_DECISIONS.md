# Implementation decisions

Decisions taken while building Phase 1 from the handoff kit, with the reasoning
that produced them. Kit authority order is followed throughout: master build
prompt, then Product Bible, then Security and Wallet Protocol, then Technical
Blueprint, then acceptance tests, then design tokens, then visual references.

## 1. Removed the wallet balance gate (conflict with pre-kit work)

**Superseded.** Before this kit arrived, the repository carried a
`lib/security/sybil.ts` that could require a minimum SOL balance and a minimum
wallet age before sign-in, configured by `MIN_WALLET_SOL` and
`MIN_WALLET_AGE_DAYS`. It was built as an anti-sybil measure on the reasoning
that wallets are free to create and so wallet-gating alone deters nobody.

That reasoning is sound in general and wrong for this product. The Product
Bible's non-negotiables are explicit:

> An empty wallet must be able to play. Starting a game must never require a
> token balance, NFT, transaction, gas fee, staking, deposit, or asset approval.

Acceptance test B also requires that **no code path** requests a token balance
or NFT ownership. A disabled flag would not satisfy that, so the module and its
call site were deleted rather than defaulted off, and `wallets.min_balance_ok`
was dropped from the schema.

A refundable stake for ranked play had also been proposed in conversation. The
build prompt excludes paid entry, deposits, stakes and player-funded pools
outright. Not built.

**Consequence, recorded honestly:** sybil resistance now rests on risk signals,
result verification and review rather than on economic cost. Minting fresh
wallets is free, so identity abuse is cheaper here than it would be under an
economic gate. That is a deliberate product trade — accessibility over
deterrence — and the mitigations are the layered evidence in
`SECURITY_LIMITATIONS.md`, not a claim that the problem is solved.

## 2. Kept the existing verification core, re-framed to kit vocabulary

The pre-kit work already implemented server-authoritative scoring: the client
submits an input log rather than a score, and the server replays it against a
server-chosen seed, checking wall-clock agreement and heartbeat continuity.

This satisfies the kit's `deterministic-replay` verification mode and its score
pipeline, so it is retained rather than rewritten. Adapted to fit the kit:

- The binary accept/reject becomes the kit's three-state outcome —
  `VERIFIED`, `HELD_FOR_REVIEW`, `REJECTED`.
- Internal reason codes stay server-side. The client gets a player-safe
  explanation, never a threshold. The existing validator already returned
  structured reasons, which map onto reason codes directly.
- "Play session" splits into the kit's separate `PlaySession` and `Match`,
  because a tournament binds to an exact build hash and rules version.

## 3. Play capability is separate from the platform session

Per the Security and Wallet Protocol, authenticating does not by itself launch
a game. The platform session is a secure HTTP-only cookie; the play capability
is a separate short-lived token scoped to one game, one build hash and one
match, handed only to the game frame. The frame never receives platform
cookies or wallet provider access.

## 4. Database adapter

The kit requires a PostgreSQL-compatible layer that can run locally without a
paid cloud account. The pre-kit code used the Neon serverless HTTP driver
directly, which is Neon-specific. Replaced with a driver that speaks ordinary
Postgres so `docker compose up` works offline, keeping the repository layer
between domain rules and the driver so the choice stays swappable.

## 5. Deployment is not hosting-specific

Earlier work assumed Vercel. The blueprint requires both a managed Node path
and a container path, and requires that no single hosting company be
hard-coded. A Dockerfile and compose file are provided alongside the plain Node
path; nothing in the application reads a Vercel-specific API. The one place
that touched a Vercel header — client IP extraction — already falls back to
`x-real-ip` and the rightmost `x-forwarded-for` entry, which is correct behind
any reverse proxy.

## 6. Demo wallet cannot be enabled by configuration alone

`FEATURE_DEMO_WALLET` is not a plain flag read. `lib/flags.ts` requires both
the flag and `NODE_ENV !== 'production'`, so setting the variable on a
production deploy is insufficient to accept simulated signatures. This is the
"disabled by construction" requirement from the Security and Wallet Protocol.

## 7. Visual direction is interpreted, not traced

The brand boards are art direction. Per `REFERENCE_MAP.md` the generated logo is
not a production vector, so the CCG mark is built as original SVG — a
three-tile monogram that stays legible at 16px in one colour and does not
depend on glow.

The concept art's chain logos, player counts, tournament prize values and game
names are **not** reproduced. Acceptance test A forbids presenting fake live
state, player numbers or prizes as real, so demo records carry visible demo
labelling and counts read `0 verified players` until stored session data exists.

## 8. Amended the handoff kit: market imagery (Bible v0.2)

The kit README asks that its files be preserved. They have been, but the
Product Bible was amended on the product owner's instruction rather than left
frozen — a founding document that cannot be corrected stops being the source of
truth the moment reality moves.

**The change.** The original exclusion read "token-price charts, candlesticks,
trading feeds, or investment language" without saying where it applied. Read
literally it barred a game from having a chart in it, which was not the intent.
The boundary now sits at the platform edge: games may depict market imagery as
subject matter; CCG surfaces may not display live market data.

**Why four files changed, not one.** The kit's authority order puts
`CLAUDE_MASTER_BUILD_PROMPT.md` above `CCG_PRODUCT_BIBLE.md`. Amending only the
Bible would have left the stricter rule in force by that ordering and produced
exactly the drift the kit warns about. Changed together:

- `docs/CCG_PRODUCT_BIBLE.md` — new section "Market imagery: games versus
  platform"; brand system scoped to the shell; boundaries table and launch
  non-negotiables updated; version 0.1 → 0.2 with an amendment note
- `CLAUDE_MASTER_BUILD_PROMPT.md` — exclusion list rewritten to match
- `config/design-tokens.json` — `usageRules.crypto` rewritten to match
- `config/design-tokens.json` at the repository root — same file, kept mirrored

**Unchanged by this.** The truthfulness rules still hold in full: a game's
market imagery must not be presented as real market activity, and platform copy
carries no investment language whatever a game depicts. The exclusion on a CCG
platform token is untouched.

Live market data and investment language attract financial promotion regulation
in several jurisdictions, which is a large part of why the line is drawn at the
platform edge rather than at the game. That remains for counsel to review — the
Bible's standing instruction that legal must review before launch applies here.

## 9. Chat is open, not anonymous

Chat is open to anyone: no approved-participant list, no invitation. Posting
requires a wallet session; reading requires nothing at all.

**Why this is not the excluded thing.** The Bible's escalation trigger for
streaming is "open broadcasting or **anonymous** chat", and the founding
moderation level reads "pre-approved accounts; monitored chat". Those two words
get used interchangeably and they are not the same:

- *Anonymous* chat has no identity behind a message, so there is nothing to
  mute, time out, or ban. That is the thing excluded, and it is not built.
- *Open* chat lets anyone participate, under an identity. Every message here is
  bound to a wallet, so moderation has a subject.

I read "pre-approved accounts" as applying to the accounts that **broadcast**,
which the same table pairs with "monitored chat" for everyone else. If it was
meant to gate chat participation to an approved list too, this is the wrong
call and the fix is one flag on `chat_channels`. Say so and I will change it.

**Consequences taken deliberately.**

- Requiring a wallet to post is a friction cost on the most casual form of
  participation, and it will lose some chatters. The alternative is unattributed
  messages, which cannot be moderated at all.
- It is consistent with how the platform already treats play: browse freely,
  connect to play — now also connect to chat. Watching and reading stay free.

**The honest weakness.** A wallet costs nothing to create, so a chat ban is
evaded by minting a new one, exactly as described in `SECURITY.md` for play.
Rate limits and slow mode raise the cost of flooding, and the device and network
clustering already in `identity_links` is what makes a ban apply to a person
rather than to one keypair. None of that makes a determined abuser go away — it
makes them work, and it makes the ring visible.

**Chat sanctions are separate from platform bans.** Muting someone in chat is a
much smaller act than barring them from competing, and conflating the two makes
the smaller one too expensive to use. `chat_sanctions` is its own table, and a
timeout with an expiry is the expected shape rather than a permanent ban.

Removed messages are soft-deleted. A moderation decision needs an auditable
subject; hard-deleting the message erases the evidence for the action taken
against it.

## 10. Wallet addresses are never public; usernames are the identity

A wallet address is the credential, not the identity. Every public surface —
leaderboards, standings, chat, profiles — shows a username. The address is shown
back only to the person who controls it, behind a Show control on their own
profile, and appears in no API response that anyone else can read.

**Why this matters more than it looks.** A Solana address is a permanent public
key into a public ledger. Publishing one on a leaderboard also publishes the
balance behind it, every counterparty it has transacted with, and any other
account it has touched — and address clustering makes tying that to a real
person routine. Entering a tournament should not disclose someone's finances.
The privacy note in `SECURITY.md` flagged this; this closes it.

**Rules the implementation follows.**

- Uniqueness is case-insensitive, via a unique index on `lower(username)`.
  Without that, "Alice" and "alice" are two accounts that nobody can tell apart
  on a leaderboard.
- Names are ASCII letters, digits and single underscores, starting with a
  letter. Restricting the alphabet removes homoglyph impersonation outright:
  allowing the full Unicode letter range would let someone register a name using
  Cyrillic "а" that renders identically to an existing player's.
- The reserved list is checked twice — against the literal name and against an
  `impersonationKey` that strips underscores and reverses digit substitutions.
  A list checked literally is sidestepped by one character: `ccg_0fficial`.
- `displayName(null)` returns "Unnamed player", never anything address-shaped.
  An account is authenticated before it is named, and a fallback to the address
  would leak exactly what this exists to prevent.

**Concurrency.** The availability check the form runs is advisory. Between it
and the write, another wallet can claim the same name, and the unique index is
what actually decides — that surfaces as a constraint violation rather than an
empty result, so the route catches SQLSTATE 23505 rather than inferring the
outcome from a row count.

**Not built: changing a name.** The claim route only sets a name where none
exists. A username is a public identity other players learn to recognise, so
free reassignment lets someone shed a reputation or take a name someone else
just released. Renaming should be a separate, rate-limited, audited operation
with the old name held in reserve for a period. It is not in this pass.

**Still to do.** `identity_links`, `submission_rejections` and the chat and
competition tables all key on the wallet address, which is correct — it is the
stable internal identifier. The audit is that no *read path serving a public
surface* selects it, which is currently true and worth a test once the database
exists to test against.

## 11. Road to Bonded: removed the paid lives store

The game arrived from `solana-intel-engine`, branch
`claude/road-to-bonded-game-snkvn1`, as a self-contained static app. It ships a
`js/store.js` that sold lives for real SOL: connect an injected wallet provider,
fetch a live SOL/USD rate, transfer lamports to a treasury address, credit
lives on confirmation.

**Every part of that is an excluded mechanic here.** The founding non-negotiables
rule out purchased tournament lives or attempts, purchased competitive power,
and undisclosed wallet transactions; the SDK contract states a game may never
initiate a wallet transaction; and the product line is "never pay to play".

The shipped config had `treasury: ''`, which closes the store — but that leaves
the entire flow one config edit from live. The implementation is therefore
replaced with a permanently-closed stub of the same shape, and the original
kept at `tools/store.original.js` for reference. Nothing in the hosted build
touches a wallet provider, fetches a price, or loads a web3 library.

The frame is also sandboxed without `allow-same-origin`, so a wallet provider
would be unreachable regardless. That is a second line, not the first: isolation
should not be the only thing standing between a player and a payment.

**Left alone, and needing your decision.** The free lives economy remains — five
lives, six-hour regeneration, a lost life on a failed level. It is not a
purchase, so it does not breach a non-negotiable. It is still a soft gate on
play, and it exists because a store was going to be attached to it. Whether a
game on CCG may gate play behind regenerating lives at all is a product call I
have not made either way.

## 12. Two external requests removed

**The game fetched Google Fonts.** `index.html` pulled Space Grotesk and
JetBrains Mono from `fonts.googleapis.com`, sending every player's IP and
referer to a third party and rendering wrong wherever that host is blocked. The
link is gone; the CSS variables already carried system fallbacks.

**So did the wallet adapter.** `@solana/wallet-adapter-react-ui/styles.css`
opens with an `@import` of DM Sans from Google Fonts, so *every page rendering
wallet UI* — including the home page — made that request before a visitor did
anything. The stylesheet is now vendored at `styles/wallet-adapter.css` with
that one line removed. Re-vendor when upgrading the package and check the first
line again.

Verified: four pages, zero requests off-origin.

## 13. Road to Bonded is unranked for now

Its engine is deterministic — seeded RNG, and `tools/verify.mjs` confirms
byte-identical replays across all 100 levels — so verified scoring is genuinely
reachable, which is not true of most third-party games.

It is listed unranked anyway, because reachable is not the same as done. A
leaderboard needs the server to replay a submitted run through the same engine,
and that means porting `js/engine.js` to a module the server imports. Until that
exists the server cannot vouch for a score, and `/api/play/start` refuses to
open a ranked session for a game with no registered rules.

## 14. Game cards use real screenshots

Cards now show a cover image captured from the running game rather than a
gradient. The covers are produced by driving the actual game in a headless
browser and clipping the frame — Road to Bonded mid-level with the board and
BONDED meter, Reflex Lab three rounds into a run with its pips and reaction
times visible.

Two reasons for screenshots over illustration. A card is a promise about what
opening it gets you, and a drawn image can promise something the build does not
deliver. And the concept art in the handoff kit depicts games that do not
exist, so borrowing from it would put fictional key art next to real entries.

Reflex Lab's first capture was its full-screen acid state, which is what the
game genuinely looks like mid-press but reads as a broken card at 320px. The
mid-run state was used instead: same honesty, actual structure on screen.

Catalogue placeholders keep the gradient. There is no game behind them to
photograph, and a gradient reads as a placeholder in a way that invented art
would not.

**Operational note.** `next/image` caches optimised output keyed on the request
URL, so replacing a cover at the same path serves the stale image until the
cache clears — that bit me locally and would bite harder behind a CDN. Version
the filename when a cover changes, rather than overwriting it.

## 15. Leaderboards read real rows, and are empty until there are some

`/leaderboards` queries the `scores` table. Every row there is the output of a
server-side replay — `/api/play/submit` never writes a client-reported number —
so reading that table is what makes a board worth anything.

Today the table is empty, because no game has server-side rules registered yet
(decision 13). The board therefore renders an explicit empty state rather than
seeded standings. The tournament demo already carries invented names, and one
place on the site where numbers are decoration is enough; a leaderboard is the
last surface that should teach a reader to discount what it says.

Three rules are enforced in the query rather than in the page:

- **One row per player, on their best result.** A board where one person holds
  the whole top ten is a list of attempts, not of players.
- **Banned wallets are excluded, not deleted.** The score rows stay for review,
  they simply stop being published. Only wallet-level bans filter here —
  applying a device or network ban retroactively would remove the results of
  everyone who shared a household or a carrier NAT with the banned party.
- **Direction is per game.** Reflex Lab is scored on mean reaction time, where
  lower wins. A board that assumed higher-is-better would put the slowest
  player on top, so `scoreDirection` is catalogue metadata and the two
  orderings are written out as separate queries rather than assembled from an
  interpolated string.

Ties share a place and the next place skips, which is standard competition
ranking. Separating tied players by submission time would invent a distinction
the scoring model does not make.

No query in `lib/leaderboards/` selects `wallets.address`. The display name
falls back to "Unnamed player", never to an address — a truncated key is still
a public link to an on-chain history, which is the thing usernames exist to
keep off this page.

## 16. Account deletion is a request, not a button

`/settings` records a deletion request for a person to action. It does not
delete.

The reason is specific. `identity_links`, `play_sessions` and `scores` all
cascade from `wallets`, so a self-serve delete lets a wallet under
investigation erase the device and network links that connect it to the rest of
its ring. The ban rows themselves survive — they key on text, not a foreign key
— but the evidence that would justify the next one does not.

The page says this in those words rather than offering a delete button that
quietly does not apply to accounts under review. A control that appears to work
and does not is worse than an honest queue.

Data export is not gated this way: `/api/account/data` returns the caller's own
record immediately, because reading your own data endangers nobody. Three
things are held back from it, each for a stated reason — other people's
identities (the links table exists to investigate rings, not to reveal who else
uses your network), the peppered hashes themselves (they identify nothing to
the reader and would only help someone confirm a guess), and rejection reason
codes. That last one is the Product Bible's rule against exposing fraud
thresholds: publishing which check caught a run tells the next attempt exactly
what to change. A person reviewing an appeal can explain the decision; an
automatic export cannot do that without also handing it over.
