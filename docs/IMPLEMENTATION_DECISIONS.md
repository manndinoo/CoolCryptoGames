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

## 11. ZERO SIGNAL: the first game the site actually runs

ZERO SIGNAL arrived as a standalone handoff: its own Next/Vite project, its own
deployment identity, its own PWA. It is now the first entry in the catalogue
that mounts real code when someone presses Play. The port kept the gameplay
intact — one-tap portrait control, reachable gate generation, full-ball
collision, rarity-weighted run-only pickups and the daily-limited shop — and
changed four things, each for a reason worth recording.

**The stylesheet is scoped.** The original styled bare class names — `.play`,
`.screen`, `.modal`, `.stats`, `.toast` — from a page that owned the whole
document. Imported unscoped into this site it would have repainted the platform
shell. Every selector now sits under `.zs-root`, and the frame sizes itself to
the theater box the game page gives it instead of to the viewport.

**The service worker and the install flow are gone.** The handoff registers
`/sw.js` and offers "add to home screen". Registering a game's worker from a
page on this origin hands it the cache for the entire site, including the auth
routes. A game embedded in a platform does not get to own the platform's
offline behaviour. The standalone build still has both; this one does not.

**The economy moved out of the component.** Daily allowances are the part of a
free-to-play economy people actually try to get around, and in the handoff they
were inline `setSave` callbacks that also fired toasts, so they could not be
tested without a browser. They are now pure functions in
`lib/games/zero-signal/rules.ts` with tests covering each limit. The component
owns the simulation and the canvas; it owns none of the rules.

**Real-money purchase stays locked, for a second reason.** The game shipped
with its store locked for beta. Here it is also gated by `FEATURE_PAYMENTS`,
which is off. The credit prices remain in the model so the economy is complete
and testable, and no UI spends them.

### Why it is unranked, and what would change that

`scoreVerification: 'unranked'`. The site's rule is that a game may only claim a
verified score if the server can replay the run from the input log, and this run
cannot be replayed: it advances on a variable frame delta and an unseeded
`Math.random()`, so the same taps produce a different score on a different
machine — or on the same machine twice. Listing it as verified would be a claim
the server cannot back, so it is listed as what it is, and
`lib/anticheat/registry.ts` has no entry for it. `/api/play/start` therefore
refuses the slug with `game_not_scoreable`, which is the correct answer rather
than an oversight: the game runs entirely on the player's device and stores
progress in that device's `localStorage`.

Making it rankable is a real piece of work, not a flag: a seeded PRNG for gate,
pickup and bonus placement, a fixed-timestep simulation so a frame delta cannot
change the outcome, the core extracted into a module both the browser and the
server import, and a decision about banked power-ups — they come from client
storage today, so a replay cannot confirm the inventory a run started with.
Until all four exist, the honest listing is the one shipped.

### Runtime mounting

`components/play/runtimes.tsx` maps a slug to the component that runs it, and
`PlayGate` mounts nothing for a slug that is not in it. A catalogue entry marked
`playable` is a claim about the listing; that map is the claim about the code,
and the two are checked separately. Runtimes load on demand and client-only — a
game owns a canvas, an animation loop and device storage, none of which survive
a server render, and none of which belong in the bundle of a page nobody pressed
Play on.

The wallet gate is unchanged: the game page is fully public, and the gate
appears only where the game would mount, only once someone presses Play.
