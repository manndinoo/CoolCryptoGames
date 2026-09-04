# MASTER BUILD PROMPT - COOL CRYPTO GAMES

You are the lead product engineer, security-minded platform architect, game-platform designer, and QA owner for Cool Crypto Games (CCG).

Your assignment is to build the first production-quality foundation of CCG from the files in this handoff package. Do not stop at a static mockup. Produce a functional, responsive application that runs locally, builds successfully, has meaningful automated tests, and demonstrates the complete verified-play path.

## 1. Read before writing code

Before changing or generating project files, read every file in this kit, including:

- `README_START_HERE.md`
- `docs/CCG_PRODUCT_BIBLE.md`
- `docs/SECURITY_AND_WALLET_PROTOCOL.md`
- `docs/TECHNICAL_BLUEPRINT.md`
- `docs/PHASE_1_ACCEPTANCE_TESTS.md`
- `config/design-tokens.json`
- `config/game-manifest.schema.json`
- `config/env.example`
- all visual references under `assets/brand/`

Summarize your understanding in a short implementation checklist, inspect the target repository, then build. Do not ask the user to repeat requirements that exist in these files.

## 2. Product truth

CCG is a curated browser gaming network where:

- Anybody can browse games, developers, leaderboards, tournaments, schedules, and live streams without a wallet.
- A wallet connection and free signed message are required before any game can launch.
- The wallet is an identity and security requirement, not a payment requirement.
- An empty wallet must be able to play.
- Starting a game must never require a token balance, NFT, transaction, gas fee, staking, deposit, or asset approval.
- Games are the product. Crypto is optional infrastructure.
- Tournaments launch with free entry, predetermined sponsor- or platform-funded prizes, published rules, objective skill, and verified results.
- Developers receive transparent revenue shares and control their own IP.
- The platform earns through memberships, game commerce, sponsorships, restrained advertising, and optional developer services - never from players losing wagers.

The public product line is:

> Browse freely. Watch freely. Connect to play. Never pay to play.

## 3. Non-negotiable exclusions

Do not add or imply any of the following:

- A CCG platform token
- Live token-price charts, candlesticks, or trading feeds on CCG platform
  surfaces, and investment language in platform copy (games may depict market
  imagery as game content — see "Market imagery: games versus platform" in the
  Product Bible)
- Pay-to-play prize events
- Player-funded prize pools
- Peer-to-peer wagering
- Purchased tournament lives or attempts
- Purchased competitive power
- Token or NFT holding requirements to play
- Random paid rewards with real-world value
- Loot boxes in the founding product
- Custodial player balances
- Undisclosed wallet transactions or approvals
- Fake online-player counts, fake earnings, fake prize winners, or fake live streams
- Existing game characters, game logos, token logos, or copied IP
- Open anonymous streaming or automatic public game uploads
- Claims that security is impossible to defeat

## 4. Build scope: Phase 1 verified-play foundation

Build all of the following now.

### Public product shell

- `/` home page
- `/games` curated catalog
- `/games/[slug]` complete game page and theater
- `/tournaments` event listing
- `/tournaments/[slug]` event detail, rules, eligibility, and standings
- `/live` official and approved-stream schedule
- `/developers` developer directory
- `/developers/[slug]` developer page
- `/leaderboards` global leaderboard view
- `/profile` connected-player profile
- `/settings` privacy, wallet-session, and accessibility settings
- `/studio` developer dashboard shell
- `/admin` protected operator dashboard

### Home page

Recreate the approved hybrid direction with real responsive code:

- Compact CCG header
- Strong hero with `GAMES FIRST. CRYPTO NATIVE.`
- Primary acid-yellow `PLAY NOW` action
- Trending strip
- Swipeable featured games on mobile
- Featured-game grid or rail on desktop
- Live tournament module
- Live-programming module
- Developer spotlight
- Recently updated games
- Mobile bottom navigation with Home, Games, Tournaments, and Profile

Do not reproduce fake statistics or blockchain logos shown in concept art. Use truthful demo labels such as `Demo event`, `Preview`, or `0 verified players` until real data exists.

### Wallet-gated play

- The site is public until a user presses a Play action.
- Pressing Play while unauthenticated opens a clear wallet sheet/modal.
- Support injected Solana-compatible wallets through a maintained wallet-standard integration. Keep the connection layer replaceable.
- Request a free signed authentication message only.
- Display: `This signature will not create a transaction, cost gas, or give CCG access to your assets.`
- Send the signed challenge to the server for verification.
- Server issues a secure HTTP-only platform session plus a short-lived, game-specific play capability.
- Only after successful verification may the game runtime mount.
- A rejected, expired, replayed, mismatched, or malformed signature must fail safely.
- Provide a local development wallet simulator only in development and test environments. It must be impossible to enable silently in production.

### Play session and score verification

- Create a one-time match ID when the game launches.
- Bind it to wallet identity, game, immutable build identifier, issued time, expiration, and risk-session identifier.
- Run the sample game on an isolated route/origin boundary or sandboxed iframe with the strictest practical permissions.
- Use an allow-listed, schema-validated `postMessage` protocol between the shell and game.
- Implement a small original test game called `CCG Reflex Lab`. It exists only to prove session, scoring, touch, keyboard, restart, and verification behavior. Mark it as an integration demo, not a flagship release.
- Submit score plus compact event evidence to the server.
- Validate match existence, ownership, expiration, duplicate use, chronology, score range, event sequence, and build version.
- Return `VERIFIED`, `HELD_FOR_REVIEW`, or `REJECTED` with an internal reason code.
- The client may show a player-safe explanation but must not expose fraud-rule thresholds.
- Add an admin queue for held results and a basic approve/reject decision with audit history.

### Tournaments

- Implement demo tournament records with no live public prize.
- Include official-rules fields, opening and closing times, eligibility, game build, score model, tie-breaker, status, standings, and verification state.
- Require wallet authentication and rules acceptance before entry.
- Keep real prize enablement behind `FEATURE_REAL_PRIZES=false` by default.
- Do not implement paid entry, deposits, stakes, prize pooling, or random winner selection.

### Developers and Studio

- Build public developer pages with games, updates, scheduled streams, and follow action.
- Build a protected Studio shell with game records, builds, health, sessions, retention placeholders, score-verification status, revenue-ledger placeholders, and release controls.
- Clearly label simulated analytics and revenue data.
- Validate game manifests using the supplied JSON schema.
- Do not support automatic publication. New builds remain draft or review pending.

### Live

- Build a curated live schedule and stream-card system.
- Allow approved external embed URLs through an allow-list and feature flag.
- If no real stream is configured, show a truthful scheduled/offline state.
- Do not build open broadcasting in Phase 1.
- Include report, mute, and moderation-entry points in the UI architecture even when demo streams are offline.

## 5. Technical direction

- Use the latest stable mutually compatible versions available at build time.
- Use TypeScript with strict mode.
- Use Next.js App Router. Do not use a static-only export because CCG requires server authentication, protected APIs, and dynamic tournament state.
- Use a PostgreSQL-compatible data layer with migrations and generated development seed data.
- Keep the database adapter configurable so local development can run without a paid cloud account.
- Use server-side schema validation for all external input.
- Use secure HTTP-only cookies for the platform session.
- Use CSRF protection or origin-bound request validation for mutations.
- Use rate limiting for auth challenges, signature verification, session creation, score submission, follows, reports, and admin decisions.
- Use an object-storage abstraction for game builds and media.
- Keep Redis/rate-limit infrastructure optional locally and required/configurable for production.
- Use a structured audit log for privileged and competition-sensitive actions.
- Add a PWA manifest, responsive safe-area CSS, metadata, sitemap, robots policy, and accessible semantic markup.
- Use unit tests for domain rules and API validation plus browser tests for critical journeys.
- Provide Docker and ordinary Node deployment paths. Do not hard-code one hosting company.

Current primary references:

- Next.js App Router: https://nextjs.org/docs/app
- Next.js production checklist: https://nextjs.org/docs/app/guides/production-checklist
- Next.js deployment options: https://nextjs.org/docs/app/getting-started/deploying
- WalletConnect application SDK overview: https://docs.walletconnect.network/app-sdk/overview
- Stripe Connect marketplace model: https://docs.stripe.com/connect/marketplace

If an SDK changed after this prompt was written, use the current official documentation and record the decision in `docs/IMPLEMENTATION_DECISIONS.md`. Do not silently substitute an abandoned dependency.

## 6. Visual implementation

Use `assets/brand/04-approved-hybrid-desktop.png` and `05-approved-hybrid-mobile.png` as the primary art direction.

Design balance:

- 65% dark premium gaming platform
- 35% clean, playful degen culture
- Carbon black and graphite foundation
- Bone-white readable surfaces and typography
- Cobalt structural accents
- Acid yellow only for primary action, live, and verified states
- Safety orange only for alerts and expiring states
- Restrained smoke/glass depth
- No excessive neon, rainbow gradients, crypto-market decoration, casino imagery, or retro WEBCADE styling

Use `config/design-tokens.json` as the source of truth. Implement tokens as CSS custom properties and map them into the component system. Create an original, simple, code-native SVG CCG mark inspired by three connected game tiles. It must work in one color and at favicon size. Do not raster-trace the generated logo or treat the reference typography as a final licensed font.

The desktop and mobile compositions must be related but not identical. Mobile uses thumb-sized actions, safe areas, horizontal game-card swiping, condensed content, and fixed bottom navigation. Desktop uses richer rails and grids. Do not squeeze desktop navigation into mobile.

## 7. Data and truthfulness

- Seed content must be marked as demo content in code and UI.
- Do not show `LIVE` unless a configured stream is active.
- Do not show a player count unless it comes from stored session data.
- Do not show a prize value unless an administrator created and approved that prize record.
- Do not show developer earnings as real unless ledger entries exist.
- Never use concept-art text as production data.

## 8. Quality bar

Before declaring the build complete:

1. Run linting and type checking.
2. Run unit and integration tests.
3. Run end-to-end tests for all critical paths in `docs/PHASE_1_ACCEPTANCE_TESTS.md`.
4. Run a production build.
5. Test representative mobile and desktop viewports.
6. Check keyboard navigation, focus states, reduced motion, and contrast.
7. Confirm no Play route can mount a game without a valid server-issued capability.
8. Confirm no wallet flow requests a transaction or asset approval.
9. Confirm demo authentication cannot be enabled in production.
10. Confirm protected routes and admin mutations reject unauthorized requests.
11. Confirm seed data cannot be mistaken for real players, prizes, revenue, or live streams.

Fix failures before stopping. Do not hide errors, disable tests, replace real verification with client-side booleans, or claim production readiness when external services are mocked.

## 9. Required handoff from you

Deliver:

- Complete repository
- `README.md` with exact local setup and deployment instructions
- `.env.example` with no secrets
- Database schema and migrations
- Seed command
- Automated tests
- `docs/IMPLEMENTATION_DECISIONS.md`
- `docs/SECURITY_LIMITATIONS.md`
- `docs/DEPLOYMENT_CHECKLIST.md`
- List of feature flags and which production capabilities remain disabled
- Test results and production-build result
- Short list of credentials/services the owner must configure next

Work in phases, but continue until the complete Phase 1 acceptance set passes. Preserve all files in this handoff package under a `/product-reference` or `/docs/product-reference` directory inside the resulting repository.

