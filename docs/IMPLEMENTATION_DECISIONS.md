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
