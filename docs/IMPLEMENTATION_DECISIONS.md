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

## 23. The supplied identity

A brand sheet, an app reference and a lockup export replaced the invented
identity. The founding kit's acid/cobalt palette and the drawn CCG letterforms
are both gone.

### The mark is the artwork, not a rebuild

First attempt was wrong: I traced the symbol's geometry and rebuilt it as SVG
paths. That is the wrong instinct for a supplied identity — a redraw is a
near-copy that drifts from the brand the moment anything changes, and there is
no reason to approximate a file that already exists.

`public/brand/*.png` are the sheet's own one-colour panels, keyed to
transparency and issued in both inks with the accent square preserved.
`components/brand/logo.tsx` renders those files and does no drawing at all.
`components/brand/letterforms.tsx` and the three drawn marks are deleted.

The keying is worth recording because the first pass produced noise. Alpha has
to come from the SOURCE artwork — how far each pixel travelled from the sheet's
cream toward the sheet's black — not from the target ink. Using the target in
the denominator made the cream version a solid block, because cream against
cream is a zero-length interval. A small alpha floor discards the sheet's paper
grain, which would otherwise survive as speckle across every flat area.

The supplied transparent lockup could not be used directly: it is flattened
onto white, and its wordmark is cream on that white, so it carries no usable
alpha. The sheet's panels are cleaner sources.

### Colour

Sampled rather than eyeballed: accent `#FE3F0E`, cream `#F1ECE4`, ink
`#0D0D0F`, and the app reference's ground `#08090B` with `#121416` cards.

One contrast decision falls out of the brand. White on the accent is 3.5:1,
which meets AA for large text only, and "large" for bold begins at 18.66px. The
primary button therefore sets its label at 19px/900 — which is also what the
reference does, its PLAY being visibly larger than its secondary button. Every
smaller control uses the accent as text on the ground, where it is 5.4:1.

### Shape and type

Square. The sheet has no rounded control on it, so every radius token drops to
2-3px; `--radius-pill` is kept as a name so the pill class names already spread
across the codebase resolve to a rectangle in one edit rather than forty.

Cards carry the reference's clipped corner. A border does not follow a
`clip-path`, so `.ccg-notch` is two clipped layers — the outer is the edge
colour, the inner is inset by 1px and carries the fill — and the 1px line
traces the notch.

Display type is uppercase and heavy again, which reverses decision 19. That
decision was right about the problem and wrong about the cause: the old build
was unreadable because *everything* was uppercase at one weight, not because
uppercase is wrong. The sheet gets its hierarchy from size and weight contrast
— a 4xl/900 heading against a 10px tracked label — so case is free to carry the
brand. Body copy stays sentence case. Space Grotesk gave way to Archivo, which
has the wordmark's width and reaches 900.

### What was not copied

The reference mockup carries figures: 8.4K playing, a $5,000 prize pool, 312
players, 14.2K followers, per-game player counts. Those are placeholders in
exactly the sense the games were, and the Product Bible forbids fabricated
counts and unapproved prizes. The layout is the reference's; the fact strip
under the hero carries what is actually true instead — entry always free,
wallet is identity only, the real catalogue size, no purchases anywhere.

## 24. Purchases, and saves that follow the wallet

Both requested by the owner. Purchases collide with the founding product in one
place, and that is recorded here rather than quietly resolved.

### What the Product Bible says, and what shipped

The Bible excludes, among other things, *purchased tournament lives or
attempts*, *purchased competitive power*, *loot boxes*, *custodial player
balances* and *undisclosed wallet transactions or approvals*. Its product line
is "Browse freely. Watch freely. Connect to play. Never pay to play."

What shipped keeps every one of those:

- Only cosmetic and content items exist. `ItemKind` has two members and neither
  is competitive; the `entitlements` table has a CHECK that refuses a third.
  Nothing purchasable changes what a player can achieve.
- No balance is held. A purchase is one transfer from the player's own wallet
  to the treasury. There is no column anywhere holding a player's SOL, and so
  nothing to withdraw, lose or return.
- Nothing is hidden. The amount, the recipient and the cluster are on screen
  before the wallet is opened.
- Play stays free. An empty wallet still plays every game in full, ranked or
  not, which is what "never pay to play" actually asserts.

The line that now needs the owner's word rather than mine: "Never pay to play"
is still true of *play*, but the site does now take money for cosmetics. That
is a Bible amendment for the owner to make, and it is flagged rather than
assumed. Anything beyond cosmetics and content — a purchased attempt, a boost,
a paid tournament entry — would need the exclusions themselves amended, and is
not built.

### Verifying a payment

The security of this rests entirely on one idea: the client is trusted with
nothing except a signature string, and every fact the decision needs is read
back from the chain.

`settlePayment` is pure and takes the transaction as data, so every refusal is
testable without a network — payer mismatch, missing reference, wrong
recipient, underpayment, failed transaction, signature mismatch, expired quote,
malformed metadata. Sixteen end-to-end checks then drive the real routes,
including a replayed payment against a second intent and one wallet trying to
claim another's.

Two answers are deliberately not refusals. A signature the cluster has not seen
returns `202`, because a confirmed payment can take a moment to propagate and
refusing would lose real money. An unreachable RPC returns `503` for the same
reason. Both leave the intent open.

### Tested against a stub, not against the chain

This environment's egress policy blocks every Solana RPC host, so no real
payment has been made from here. The settlement path was exercised against a
local server answering `getTransaction` the way a validator does — the real
route, the real parser and the real comparison all run; only the network is a
stand-in.

That is a genuine gap, and `docs/PURCHASES.md` carries the devnet procedure to
close it in a few minutes with a funded test wallet. It should be run before
`SOLANA_CLUSTER` is pointed at mainnet.

### Saves against the wallet

`game_saves` is keyed by (wallet, game). A signed-in player's progress follows
their account to any device; the device copy is kept in step as a fallback for
playing signed out.

The merge rule is not "most recent wins". Neither copy carries a trustworthy
clock — the device's is the player's own, and the server's records when it was
written rather than when it was played. They are ranked by how much progress
they hold instead, because choosing the larger one can only ever hand someone
more of their own game. The failure mode of the alternative is the one that
actually matters: signing in on a new phone and overwriting fifty levels with
an empty save.

The frame is not mounted until the save is in hand, so a game's first
`SAVE_LOAD` is answered with the wallet's progress rather than with an empty
object it would immediately overwrite.

One gap the test found: a device that only *read* the wallet's save never wrote
a local fallback, so going offline or signing out on that browser left nothing
behind. The chosen save is now mirrored to the device on load, not only on
write.

## 25. Bible amendment 0.3, and the treasury

The product owner supplied a treasury address and asked for the Product Bible
to permit purchases.

### What was amended, and what was not

Amendment 0.3 authorises in-game purchases **limited to appearance and
additional content**, with eight conditions: play stays free, no competitive
effect, nothing held, full disclosure before signing, bound to the buyer,
verified rather than asserted, no randomised purchase, and irreversibility
stated. It also adds a scope note to the positioning statement — "Never pay to
play" is a claim about play, and it stays literally true.

Deliberately left in force: *purchased score advantages*, *paid tournament
entry*, *purchased tournament attempts*, and *randomised paid rewards with
real-world value*. The request was to allow what was built, and what was built
is cosmetics and content. Striking the competitive exclusions is a materially
different decision with regulatory weight, so it was flagged back rather than
taken.

The interesting thing the amendment revealed: the Bible's own Commerce rules
already said "Prices and developer shares are visible before purchase" and
"Competitive power is never sold". It had always contemplated purchases
existing — it simply never authorised them, and the positioning line read as an
absolute. The amendment resolves that contradiction rather than reversing a
position.

### The address is committed, not configured

`EwyzBV1hAVYWvtP6dUiFkXVvwaB9WQ2ghMxP1TjgAkQy` is the default in
`lib/store/treasury.ts`, with the environment variable still winning so a fork
or a devnet run can point elsewhere.

This softens the "two independent conditions" property from decision 24 — the
flag alone now enables charging. That is a deliberate trade. The property
existed to stop an *accidental* enablement, and a committed, reviewed address
is not an accident. Set against it: every configuration step is a step that
gets skipped or mistyped, and the failure mode of a mistyped recipient is real
money to a stranger, which is worse than the failure mode it was guarding.

It is validated at read time despite being a constant, and a test asserts the
committed value parses, is on the ed25519 curve, and is therefore spendable —
because the one purchase failure that cannot be undone is paying into an
address nothing can sign for.

The RPC now defaults to Solana's public endpoint so a deployment can settle
without further setup, with a documented warning to replace it: it is rate
limited hard enough to fail under load. A failed settlement does not lose a
payment — the intent stays open — but players see it.

## 26. Dollar prices, SOL payments

The owner asked for items priced around a dollar and converted to SOL. The
catalogue now carries `usdCents` and the conversion happens at quote time.

### Why not just store a SOL price

A fixed lamport price is a dollar price that silently drifts. Set 0.05 SOL today
and it is $10 one month and $4 the next, without anyone deciding that. Pricing
in dollars and converting per quote keeps the number that was actually chosen
as the number being charged.

The existing intent structure already suited this exactly: the quote stores its
own lamport figure and expires in ten minutes. So the price the player approves
is the price the settlement check uses, and a market move between signature and
confirmation cannot change what they owe or cause a false `underpaid`.

### Refusing to quote is a feature

`solUsdRate()` returns null when there is no usable rate, and the intent route
answers 503 rather than proceeding. A stale rate is reused for up to ten
minutes — better a slightly old price than no sales — but past that it stops.

Guessing is the one failure that could overcharge somebody by orders of
magnitude, so every path that could produce a wrong number refuses instead: a
rate outside $1–$10,000, a non-integer cent amount, a quote above 5 SOL, or a
feed body in a shape the parser does not recognise. `readRate` deliberately
does not scan for "the first number that looks plausible".

### Rounding

Lamports round **up**. A lamport is a billionth of a SOL, so it costs the buyer
nothing measurable, and rounding down could land the transfer a lamport short
of the price — which the settlement check would then reject as underpaid, on a
payment that had already left their wallet. Displayed SOL figures round up for
the same reason in reverse: a shown amount below what is charged reads as a
bait.

### Prices

$0.99, $1.99, $2.99. "Reasonably priced of a dollar" is a range rather than a
figure, so this is a ladder anchored at a dollar: one cosmetic, a cosmetic set,
and a content pack. A test holds every price between $0.50 and $5.00 so a stray
zero has to argue with the suite.

### Tested against a stub

The price feed is blocked from this environment, like the RPC. `readRate`,
the conversion, the bounds and the staleness policy are unit tested directly;
the end-to-end run drives the real routes against a local server answering in
CoinGecko's shape, and confirms that paying exactly the quoted amount settles,
that one lamport short is refused, and that pointing the feed at nothing makes
the route refuse to quote rather than invent a price.

## 27. Settlement, proven against a real Solana runtime

The previous two entries both ended with the same caveat: the environment's
egress proxy denies every Solana RPC host, so the settlement path was exercised
only against transaction objects this repository wrote. That is a real gap —
the risk was never the decision logic, it was whether a *genuine* transaction
arrives in the shape the verifier expects.

Confirmed the block first rather than assuming it: `registry.npmjs.org` and
`api.github.com` both answer 200; seven Solana RPC hosts, including three
third-party providers, all return `connect_rejected` at the gateway. The
network is fine, the hosts are denied by policy.

`solana-bankrun` is on npm and reachable. It embeds the Solana VM as a native
addon, so the transfer can be executed locally by the **real System Program**
instead of imagined. `tests/settlement.chain.test.ts` builds the transaction
with `@solana/web3.js` exactly as `purchase-flow.tsx` builds it — reference key
appended to the instruction — signs it, processes it, and reads the balances
the runtime produced.

Two of those assertions could not have been made any other way, and both are
load-bearing:

- **The reference key survives into the compiled message.** The whole
  anti-replay design assumes an extra read-only key is carried through message
  compilation. If web3.js dropped it, every settlement would fail in production
  and pass against a fixture.
- **The fee payer really is account index 0.** The payer check reads that
  index. A fixture asserting it proves nothing; the runtime agreeing does.

The end-to-end run then puts that runtime behind an RPC-shaped socket, so the
real route reads a real transaction and writes a real entitlement. A genuine
payment settles; the same payment reused for a second item is refused
(`reference_missing`); a second wallet claiming it is refused
(`payer_mismatch`); a real transfer one lamport short is refused
(`underpaid`); a real transfer to another address is refused
(`treasury_missing`).

What remains untested is the network hop and the cluster's own consensus, which
is what the devnet procedure covers. The test skips where the native addon has
no prebuilt binary — it raises confidence, it is not a gate on every machine.

### The price feed was the other single point of failure

One provider means one failure mode: no sales. The feed is now a list —
Coinbase, Binance, CoinGecko, Kraken — tried in order, first usable answer
wins, with `SOL_PRICE_URL` replacing the list for a paid provider.

`readRate` gained the extra shapes those return and is still a listed set
rather than a search. A heuristic that hunts for "the first plausible number"
in a JSON body will eventually find a volume, a market cap, or a percentage,
and this number gets multiplied by a real payment.

## 28. The wallet is no longer the door

The owner asked for the wallet-to-play requirement off, kept available for
testing. It is off.

### The requirement follows the accountability, not the game

The Bible's locked rule said "a wallet is required to play", and gave its own
reason: authentication and accountability, explicitly not payment. That reason
is worth keeping and is what decided the shape of this. A wallet is how a
result gets attached to somebody, so the requirement should extend exactly as
far as there is a result worth attaching, and no further.

An unranked game issues no score, takes no leaderboard place, enters no
competition and pays out nothing. There is nothing for a signature to be
accountable for, so asking for one bought a wallet prompt in front of a free
game and nothing else. Those games now open for anyone.

Everything that does produce a record still requires a signed-in wallet, and
none of that changed: ranked play, score submission, tournament entry, prize
claims, chat, purchases. `PlayGate` enforces the ranked half itself —
`requireWallet || game.ranked` — so turning the platform switch off cannot
quietly turn the leaderboard into an anonymous one. All three shipped games are
unranked, so today the switch decides everything; the guard is there for the
first ranked build.

`walletRequiredToPlay()` in `lib/play/access.ts` is the switch, defaulting to
false, with `CCG_REQUIRE_WALLET_TO_PLAY=true` putting the gate back across
every game. The prop defaults to `true` rather than `false`, so a future caller
that forgets to pass it gates rather than opens — the wrong default should cost
a prompt, not a hole.

### The ungated path deliberately imports no wallet code

`OpenPlay` is a separate module from `PlayGateInner` for the same reason
`PlayGate` was split from `PlaySession` in the first place. Pressing Play on an
ungated game now fetches the game and the save bridge and nothing else;
verified in the browser, zero wallet chunks requested against roughly 300KB of
adapter that used to be mandatory.

Saves needed no change and still bind to a wallet when there is one. The bridge
asks the server for the game's copy either way — a signed-out visitor gets a
401 it already treats as "nothing stored" and keeps progress in the browser,
and someone signed in from `/settings` gets their wallet's copy here without
this path knowing what a wallet is, because the session is a cookie and the
adapter is only ever needed to create one.

### Where the wallet stayed reachable

`/settings` could already sign in, but only the game page can sign in, press
Play, and watch the save land against the wallet rather than the browser — the
thing actually worth testing. So `SignInPrompt` sits under the play button on
ungated games. It says the one true remaining reason to connect and nothing
more: signed out, progress stays in this browser. Both of its states occupy a
row of the same height, so the session resolving swaps text instead of moving
the store panel and the facts table below it.

### Copy that had gone false

Two claims were now wrong and one had been wrong since Amendment 0.3. The
positioning line ("Connect to play") and the first-visit notice ("Playing needs
a wallet") described the old gate. The same notice also promised "No purchases,
no deposits, no transaction to approve. Ever." — which stopped being true when
purchases shipped, and was being shown to every first-time visitor. All three
are rewritten; the strongest claim that is actually true is that every game is
complete and playable free, with no wallet, and nothing bought changes what any
player can achieve.

### Six buttons had no styling at all

Unrelated to the gate, found in the sign-in path while testing it. A previous
rewrite had mangled six class attributes into `ccg-btn-primary90` and
`ccg-btn-primary[1.02]` — neither of which exists in `globals.css`, so those
buttons rendered with `ccg-btn` alone and no accent fill. It hit "Sign in to
play", the username save, tournament entry, the leaderboard CTA, the first-visit
CTA, and the connect panel: most of the primary actions on the site. Fixed.

## 29. The game stage was never actually filling the screen

The owner asked that pressing Play put the game on the whole screen. It was
already meant to. It usually wasn't, and the reason took measuring to find.

### An identity transform on the page wrapper

`PageTransition` wraps every page in `.ccg-reveal`, whose animation carried
`both`. That fill keeps the final keyframe applied for the life of the element,
and while a rule of `transform: none` computes to the keyword, a *filled*
`transform: none` computes to the identity matrix instead. Any transform other
than the keyword makes an element the containing block for its
`position: fixed` descendants.

So the stage — `fixed inset-0`, and correct — was resolving against the content
column, not the viewport. Measured on a 1280x800 screen it came out 968x800 at
x=280: a game in a box, beside the sidebar, under the header.

What hid it was the fullscreen request. A fullscreen element is promoted to the
top layer, which escapes ancestor containing blocks, so wherever the browser
granted fullscreen the stage looked perfect and every screenshot agreed. The
bug was visible only where fullscreen was refused — an iPhone, a denied
request, or any moment after the player left fullscreen themselves. That is a
coincidence doing the work of a design.

Both halves are fixed. `.ccg-reveal` and `.ccg-stagger > *` now use `backwards`,
which still applies the opening state before the animation and leaves nothing
behind after it. And the stage renders through a portal into `document.body`,
so it no longer depends on every ancestor it happens to have staying
untransformed. `tests/page-wrapper-css.test.ts` guards the fill mode, because
this failure has no error message and no visible symptom on the machine of
whoever reintroduces it.

### The request now happens at the press

`requestFullscreen` is only granted while the click that asked for it still
counts as active, and that window is a few seconds. The stage asked for it on
mount — but the stage mounts only after its lazy chunk has been fetched, which
on a phone can outlast the gesture. `PlayGate` asks at the press instead, before
awaiting anything.

It also asks on `document.documentElement` rather than on the stage. The stage
does not exist yet at that moment, and rooting it means the fullscreen element
never changes afterwards, so a game inside the frame cannot take it and strand
the player. A refusal is not reported: the overlay covers the screen either way,
and there is nothing the player could do about it.

### The bar stopped being a permanent tax

It occupied 44px of every game for the whole session — about 5% of a phone
screen, taken from the thing the player came for. It is now drawn over the game
rather than beside it, shown for the first four seconds and then retracted,
brought back by a small handle at top centre.

Overlaying rather than reflowing is the part that matters: the game is sized
once and never resized. A canvas that changes size mid-round has to rebuild its
backing store, and some of these games lay their level out to the viewport they
were handed. The handle sits at top centre because that is the least contested
strip across the three games shipping — Zero Signal holds both upper corners,
Signal Brawl puts fighter health in them.

A fullscreen toggle joins the exit in the bar, rendered only where the browser
has the API at all, so an iPhone gets no button that would do nothing. Leaving
fullscreen no longer exits the game, since there is now a control that means
just that; Escape and the exit button still leave.

### What this did not fix

Zero Signal and Road to Bonded are portrait games. They cap themselves at 470px
and 520px wide and lay their content out in fixed pixels, so on a landscape
monitor they sit in a tall column with the screen dark either side. That is not
the stage: raising the cap only stretches the frame around content that stays
320px wide, which was tried and looks worse. Filling a 16:9 screen with them
means making their own layouts landscape-aware, which is work inside each game,
not in the shell. Signal Brawl is landscape and already fills the screen edge to
edge.
