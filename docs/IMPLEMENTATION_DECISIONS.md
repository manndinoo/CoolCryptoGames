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

## 17. CCG Reflex Lab removed

Removed at the user's request: the catalogue entry, the static build under
`public/games/reflex-lab/`, its deterministic engine at
`lib/games/reflex-lab/engine.ts`, and its nine engine tests.

This diverges from the Technical Blueprint, which lists `games/reflex-lab` as
the "original integration-test game". The blueprint is kept verbatim in
`docs/product-reference/`; this file is where divergences are recorded. The
integration surfaces it existed to exercise — play sessions, capabilities, the
shell-to-game protocol, submission validation — are all still covered by
`tests/play.test.ts` and `tests/anticheat.test.ts`, which never depended on the
engine except in the block that tested the engine itself.

Three things fell out of the removal rather than being separate decisions:

**The Reflex Open demo tournament is gone.** It bound to `reflex-lab` and its
score model was "lowest mean reaction time across five rounds" — it could not
be repointed at another game without inventing an event. `/tournaments` and the
home page module now carry an honest "no event scheduled" state. Repointing it
at Zero Signal was the alternative and was rejected: the rules would have been
written to fit whatever game was left, which is the opposite of publishing
rules before entry opens.

**The seeded standings are gone with it** — `ReflexKing`, `QuickDraw` and
`FastHands` were invented players on an invented event.

**The catalogue has no ranked game.** Reflex Lab was the only one with
server-side replay, so `/leaderboards` now renders its "nothing here to rank"
branch. That branch was written for exactly this case and needed no change,
which is the argument for writing the empty state at the same time as the
populated one.

The native stream layout preview referenced `reflex-lab` as the game being
composited; it now references Zero Signal. It is a layout demonstration marked
as demo, and pointing it at a real game keeps it that.

## 18. Sidebar shell, motion, and what "convince people to spend" was built as

Three separate asks arrived together: a sleeker dark interface with side tabs
and animation; research into the colours and moods that make people play and
spend; and pop-ups or side ads built on that research to convince people to
spend money. They are recorded together because the third one is the reason the
first two were built the way they were.

### The shell

Desktop navigation moved from a horizontal strip in the header into a fixed
left rail, grouped Play / Compete / You. The header keeps the account control
and gains the current section's name; repeating the rail's links along the top
would be two maps of the same site disagreeing about which to read. Mobile is
untouched — the bottom bar's four destinations still hold, and the rail is
`display: none` below `lg`.

The rail collapses to icons and the preference persists. An inline script in
`<body>` applies the stored width before first paint; without it the rail
renders wide and snaps closed on hydration, which is a visible jump on every
page load for anyone who collapsed it. The layout offset is a CSS custom
property (`--sidebar-w`) rather than React context, so the server-rendered
shell reserves the right space without knowing the preference.

### Motion

Everything animates on `transform` and `opacity` only, so nothing here triggers
layout. Durations come from the existing tokens: 120ms for direct feedback,
220ms for state changes, 420ms for entrances. That ceiling is not arbitrary —
the Doherty threshold puts the limit of "responsive" at 400ms, and Google's INP
metric now calls 200ms the bar for interaction feedback, so an entrance that
outlasts the content's arrival is an interface inventing a delay. The stagger is
capped at eight steps of 40ms for the same reason.

Page transitions animate the arrival only, never the exit. An exit animation
means holding the old page on screen after the user has already asked for a new
one.

`prefers-reduced-motion` disables all of it through the existing global rule,
verified in a reduced-motion browser context rather than assumed.

### Colour

No palette change. The brief asked for the colours that make people spend, and
the honest answer is that the statistic everyone cites for this — "62–90% of a
snap product judgement is based on colour alone" — traces to a 2006 literature
review about first impressions, not a controlled buying experiment, and the
review itself flagged the inconsistencies in the field. Picking a hue on that
basis would be decorating with folklore.

What does hold up is contrast and scarcity of the accent. Acid yellow reads as
"this is the action" precisely because nothing else on the site is allowed to
use it, which is why the sidebar's Play button and the header's are the same
button rather than two — spending the reserved colour twice halves what it is
worth. That was already the token rule; this change enforces it harder.

### The pop-up

One was built: `FirstVisitNotice`. It is not a modal, never blocks the page,
carries no countdown or scarcity, uses a plain "Got it" rather than a
confirm-shaming decline, and never returns once dismissed.

It exists because the objection that actually stops people here is that a
wallet-connected games site looks like a site that wants to drain your wallet.
Answering that before anyone is asked for anything removes a real barrier. That
is the honest form of a conversion surface: it converts by answering a question
rather than by manufacturing pressure.

### What was not built

No side ads, no urgency timers, no scarcity counters, no fake live player
counts, no purchase prompts.

There is no purchase path on this site to point them at. `FEATURE_PAYMENTS` is
off, and the founding product excludes a platform token, pay-to-play events,
purchasable attempts, purchasable competitive power and loot boxes. "Never pay
to play" is the product line. A prompt to spend would be pointing at a door
that does not exist.

Separately, the specific patterns that make people spend against their judgement
are the ones regulators now enforce against by name: the FTC's dark-pattern
categories include fake urgency, deceptive button contrast, and confirm-shaming,
and the Epic settlement over Fortnite's purchase flows ran to $245m with $126m
distributed to players in 2025. Building them into a site whose own Product
Bible forbids fabricated counts and undisclosed wallet interactions would put
the product in breach of itself before it put it in breach of anything else.

If a real thing to sell appears — a sponsored tournament, a studio's paid title,
merchandise — the honest version of a promotional surface can be built against
it then, with a real price, a real cancellation path, and no clock.

## 19. Theme rebuilt: cool minimal, games first

The founding palette was replaced on the owner's direction after the shell
redesign still read wrong to them. Recorded here because it is the largest
single divergence from the kit so far — `config/design-tokens.json` has been
updated to match, and the Product Bible's colour section no longer describes
what ships.

### What was actually wrong

Four things, diagnosed before anything was changed rather than after:

**The palette fought itself.** Acid `#DFFF00` beside cobalt `#1857FF` on near
black is a high-energy pairing — the yellow is at the top of its saturation and
value range and vibrates against the dark, and the blue headline sat on a
blue-black gradient, so it read muddy rather than bright.

**Everything was uppercase.** Headings, section titles, badges, buttons and nav
all set in caps with label tracking. Nothing was emphasised because everything
was.

**The elevation ramp was too shallow.** `#15191F` cards on `#080A0D` is roughly
a 5% lightness step, below what the eye reads as a layer, so cards looked drawn
on the page rather than raised above it. The `.ccg-surface` gradient made it
worse: the bottom of a card ended up darker than its surroundings, so a card
read as a hole.

**The home page spent its first screen on a slogan** — a clamped 4.5rem
headline and a 520px watermark, with two small cards below the fold. On a
catalogue, the catalogue is the design.

### What replaced it

A neutral ground with four visibly separated steps (`#0B0C0F` → `#14161B` →
`#1C1F26`), flat surfaces with a 1px border, and one accent carried in two
values: `#4C7DFF` for text, icons and the active marker (4.8:1 on the ground),
and `#3563E9` for filled buttons so white label text clears 4.5:1. One value
cannot do both jobs accessibly, which is why there are two.

Status colours were separated from the accent. Verified results are green,
live is red, alerts are amber. Previously acid meant "primary action" *and*
"verified" *and* "live", which is three meanings on one colour — and the badge
being the same colour as every button taught readers to stop treating the
accent as an invitation.

The chrome is deliberately the least saturated thing on any screen so that a
game's cover art is the most saturated. On a catalogue the art should supply
the colour.

Sentence case throughout, with uppercase reserved for 10–11px labels. Display
tracking eased from -0.035em to -0.02em: that much negative tracking was drawn
for caps and closes up the counters on sentence case.

### Grids follow their content

`lib/ui/columns.ts` picks a column count from the number of items. A
four-column grid holding a two-game catalogue renders two cards and two holes,
which reads as a page that failed to load. Matching columns to content keeps
the row full at any catalogue size and widens on its own as more arrives. Class
names are returned whole rather than interpolated, because Tailwind scans source
text and never sees a template-assembled class.

### The mark

The tile is now accent blue rather than acid. A yellow mark beside a blue
wordmark in an otherwise neutral interface was the last thing on screen still
arguing with itself.

## 20. Evidence-backed engagement work, and the measurements

Asked whether the site used the statistics and studies large sites use to drive
usage. Partly — motion timing was set against the Doherty threshold and INP,
and the dark-pattern research was used as a constraint (decision 18). What had
not been done was implementing the levers those sites actually pull. This is
that, with before-and-after numbers taken under throttling rather than claimed.

### Speed, because it is the best-evidenced lever there is

The relevant findings are unusually direct. Google's Deloitte study of over 30
million mobile sessions found a 0.1s improvement in speed associated with an
8.4% lift in retail conversion and 9.2% higher average order value. Vodafone
Italy A/B tested an LCP improvement of 31% and saw 8% more sales. Rakuten
reported 33% more conversions after Core Web Vitals work. These are correlational
in places and vendor-published in places, but they point one way and the
mechanism is not mysterious.

The site's largest single cost was the Solana wallet stack — adapter, modal and
web3.js — mounted in the root layout, so every visitor downloaded and parsed all
of it to read a leaderboard. It is now fetched at the moment someone asks to
play or opens their account, and warmed on hover, focus and touchstart so the
fetch usually lands before the click.

Measured on a 430px viewport at 1.6Mbps / 150ms RTT with 4x CPU throttling:

| Page              | JS before | JS after | LCP before | LCP after |
|-------------------|-----------|----------|-----------|-----------|
| `/`               | 303 KB    | 163 KB   | 912 ms    | 904 ms    |
| `/games`          | 310 KB    | 172 KB   | 1596 ms   | 1192 ms   |
| `/games/[slug]`   | 303 KB    | 163 KB   | 880 ms    | 868 ms    |

A 46% cut in JavaScript, and a 25% cut in LCP on the page that was worst. LCP
moved less than bytes did on the pages whose LCP was already an image rather
than a script — the win there is in interaction readiness, not first paint.

Chat was moved off `useWalletAuth` onto a new `useSession`, which answers "am I
signed in" with one fetch and no wallet library at all. Read-only identity and
wallet actions are genuinely different costs and should not have shared a hook.

### Resumption

`ContinuePlaying` puts what you last played at the top of the home page, from
`localStorage`. Every large catalogue does this — Steam, Netflix, YouTube — and
the reason is that resuming is the cheapest return visit there is: a catalogue
that opens on "here is everything, choose again" asks a returning player to redo
a decision they already made.

Built entirely from the player's own history. Nothing inferred, nothing
recommended, nothing stored server-side, and the section renders nothing at all
for a first-time visitor rather than showing an empty shelf.

### Progress in the play flow

`PlaySteps` shows three steps with the first already complete, because choosing
a game is a real step that really happened.

Kivetz, Urminsky and Zheng (2006) found café customers bought roughly 2.4 times
more frequently as they approached a reward, and — the part that applies here —
a ten-stamp card handed over with two stamps already applied was completed about
34% of the time against about 19% for a blank eight-stamp card requiring
identical effort. Visible progress is finished more often than progress starting
from nothing.

The line this does not cross: the steps are real and the count is real. A fake
fourth step, or a bar that advances without anything happening, is the version
of this with a regulatory name attached.

### A bug the work surfaced

Splitting the play gate exposed that a game placing its own HUD with
`position: fixed` — Zero Signal puts a currency counter top-right that way —
positioned it against the viewport and covered the stage's exit control, making
exit unclickable. `GameStage` now gives the game's container a transform, which
makes it the containing block for fixed descendants, so a game's chrome is
confined to the game's own area. Verified by driving the flow end to end.

### Not implemented, deliberately

Social proof. It is among the best-evidenced conversion levers there is, and it
needs real numbers. `verifiedPlayers` is 0 and the leaderboards are empty, so
there is nothing true to show. When there are real counts, they can go on the
cards; until then the honest figure is the one already displayed.

## 21. Signal Brawl, the save bridge, and who owns fullscreen

Signal Brawl arrived on `claude/new-session-58uno3`, cut from `5f8b07f` —
before Reflex Lab was removed, before the theme rebuild, before the sidebar and
before the wallet stack was deferred. Merging it would have reverted four
commits of work and resurrected a deleted game, so as with Zero Signal (decision
in the commit log) the added files were taken and the modified ones ported by
hand onto current `main`.

### The save bridge

The branch brought `lib/play/save-bridge.ts` and `components/play/sandboxed-game.tsx`,
and they solve a problem the sandbox created. A framed game runs with
`allow-scripts` and deliberately without `allow-same-origin`, so it is on an
opaque origin where every `localStorage` call throws — verified directly rather
than assumed. That isolation is the point, but it also means a game cannot
remember anything, and Signal Brawl unlocks six arenas one win at a time.

So the shell holds the save on the game's behalf, under a per-slug key in its
own storage, and everything crossing the frame boundary is parsed against an
allow-list first: known message types only, string values only, with caps on
key count, key length, value length and total size. Unknown types are dropped
rather than forwarded — a protocol that passes through what it does not
recognise grows a new attack surface every time a game invents a message.

None of this touches scoring. These are the player's own counters on their own
device, they never reach the server, and a ranked result is still whatever the
server independently replays. A player who edits them has edited their own save
file, which is theirs to edit.

Verified end to end: a preference set inside the frame was written to the
shell's storage, survived a full page reload, and came back through the bridge;
and a message with an unknown type, one with a nested object, and one with an
oversized value were each rejected with the save left unchanged.

### Fullscreen belongs to the shell

Playing the game surfaced a real trap. The frame's `allow` list carried
`fullscreen`, Signal Brawl calls `requestFullscreen` on match start, and the
iframe then *replaced* the stage as the fullscreen element — which hid the exit
bar and left a player mid-match with no visible way out. Confirmed by driving
it: `document.fullscreenElement` was `IFRAME` and the exit button, present in
the DOM, could not be clicked.

`fullscreen` is now off the `allow` list. The shell already gives every game the
whole screen; a frame re-requesting it on itself can only escape the shell's own
chrome, which is the one thing that must not happen. After the change the
fullscreen element is the stage again and exit works mid-match.

This was latent in the original iframe rather than introduced by the branch —
Signal Brawl is simply the first game that asks.

### A landscape game in a portrait frame

The gallery framed every screenshot at 3:4, which is right for the phone games
and cuts both ends off an arena. `DemoGame` now carries `orientation`, and the
frame follows it.

### The first-visit notice on a landscape phone

Signal Brawl is played sideways, and on a 430px-tall viewport the full-width
notice pinned to the bottom landed on top of the Play button it exists to
encourage. It now takes the desktop treatment on short viewports — a narrow
card in the corner — and its positioner no longer swallows clicks on whatever
sits beside it.

## 22. A full test pass, and the four defects it found

A clean build, the unit suite, a fresh database, the auth smoke test, and a
browser suite covering every route, all three games, the sign-in flow, the API
guards and Core Web Vitals. Four real defects surfaced, all fixed.

### `priority` on every card stopped the home page loading

`FeatureCard` passed `priority` to every cover. `priority` marks the LCP image
and a page has one; several preload links competed, and the first two images
never loaded at all — held at `complete: false` with an empty `currentSrc`
while the third, unprioritised, loaded normally. `document.readyState` stayed
`interactive` forever, so the page never fired `load`. Now only the first card
gets it.

Worth noting how this hid: every screenshot looked right, because the covers
did eventually paint. Only asking the browser for `readyState` and pending
requests showed it.

### Chat refused eight different ways with one status

Every refusal except an unauthenticated one answered 429. That is wrong in a
way clients act on: 429 means "you asked too often, try again", so a retry
layer sends the identical request back. Retrying an empty message, an over-long
one, a duplicate, or a post to a channel you are sanctioned on can never
succeed. `chatDenyStatus` now maps each reason — 400 for empty and too-long,
403 for sanctioned and disabled, 409 for a duplicate, 429 only for the two real
rate conditions, which now also carry `Retry-After`.

### The account pages cost 0.647 CLS

`/settings` measured LCP 3472ms and CLS 0.647 against thresholds of 2500ms and
0.1 — by far the worst page on the site. Two causes stacked: `WalletBoundary`
wrapped the whole view, so ~150KB of wallet adapter loaded before anything
rendered; and the view then showed a one-line "Loading…" before swapping in a
full-height page.

Both are gone. The pages read the session on the server and hand it to the
view, so there is no loading state to shift; and the wallet stack is now behind
`ConnectPanel`, loaded when someone presses "Connect a wallet". `/settings` is
LCP 864ms, CLS 0.048, 154KB.

The move exposed a smaller trap: `readSessionResponse` lived in a `'use client'`
module, and a function exported from one is a client reference — importing it
into a server component and calling it fails at request time. The shape now
lives in `lib/auth/session-state.ts`, which neither side owns.

### `/favicon.ico` was a 404

`app/icon.svg` covers HTML pages, which declare it in the head. Anything that
requests the conventional path — a client reading `robots.txt` or `sitemap.xml`
directly, an older browser, a feed reader — got a 404. `public/favicon.ico` is
now a PNG-payload ICO generated from the same geometry.

### Coverage the pass added

`tests/leaderboards.db.test.ts` runs the board query against a real database.
`rankResults` was already covered, but the rules that actually decide a board —
one row per player on their best result, banned wallets excluded, no address in
the projection — live in SQL and had none. They cannot be reached through the
UI either, because no game in the catalogue is ranked, so this is the only
place they are exercised. It skips when `DATABASE_URL` is unset.

`scripts/smoke-auth.mjs` had its base URL hardcoded to port 3000, so it could
only ever run against a default dev server. It reads `CCG_BASE_URL` now.
