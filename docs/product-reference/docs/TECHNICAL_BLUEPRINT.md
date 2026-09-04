# CCG Technical Blueprint

## Recommended project shape

Use a single repository for the founding build, with boundaries that can later become services.

```text
apps/web                 Next.js platform shell and server APIs
packages/domain          Competition, identity, revenue and policy rules
packages/db              Schema, migrations, repositories and seeds
packages/game-sdk        Typed shell-to-game protocol and test harness
packages/ui              CCG design system and accessible components
packages/config          Shared TypeScript, lint and test configuration
games/reflex-lab         Original integration-test game
docs                     Decisions, runbooks and deployment notes
product-reference        Product Bible and visual references
```

Claude may use a simpler folder layout if working in a constrained environment, but the trust boundaries must remain explicit.

## Founding components

### Platform shell

- Next.js App Router with server-rendered public discovery pages
- Server routes for dynamic sessions, competition, admin, and developer data
- Strict TypeScript
- Responsive component system built from CCG tokens
- PWA metadata and installable shell

### Persistence

- PostgreSQL-compatible relational database
- Migration-based schema changes
- Transactional writes for match completion, leaderboard updates, prize state, and ledger entries
- Repository layer to keep domain rules out of page components

### Optional supporting infrastructure

- Redis-compatible rate limits, session coordination, and queues in production
- S3-compatible object storage for immutable game builds, media, and replay evidence
- Background worker for score review, media processing, notifications, and scheduled tournament state
- Stream provider abstraction for approved embeds first and managed streaming later
- Marketplace-payment abstraction for game commerce and developer payouts

## Core entities

- `User`
- `WalletIdentity`
- `AuthChallenge`
- `PlatformSession`
- `RiskIdentity`
- `Developer`
- `Game`
- `GameBuild`
- `GameManifest`
- `PlaySession`
- `Match`
- `MatchEventBatch`
- `ScoreSubmission`
- `VerificationDecision`
- `LeaderboardEntry`
- `Achievement`
- `UserAchievement`
- `Tournament`
- `TournamentRulesVersion`
- `TournamentEntry`
- `TournamentStanding`
- `Prize`
- `PrizeClaim`
- `StreamChannel`
- `StreamEvent`
- `Clip`
- `Follow`
- `Report`
- `Sanction`
- `Appeal`
- `AuditEvent`
- `Product`
- `Order`
- `LedgerEntry`
- `DeveloperPayout`

## Route behavior

Public GET routes may be cached where safe. Authentication, play capabilities, scores, competition entries, follows, reports, commerce, and admin actions are dynamic server operations and must never depend only on client state.

### Suggested API groups

```text
/api/auth/challenge
/api/auth/verify
/api/auth/session
/api/auth/logout
/api/games
/api/games/:gameId/builds
/api/play-sessions
/api/play-sessions/:id/complete
/api/scores
/api/tournaments
/api/tournaments/:id/enter
/api/tournaments/:id/standings
/api/reports
/api/studio/*
/api/admin/*
```

## Game isolation

- Host game builds on a separate origin when production infrastructure permits.
- Use a sandboxed iframe with no same-origin privilege unless a reviewed game capability requires it.
- Do not inject the wallet provider into the game frame.
- The platform shell owns authentication and grants only a short-lived play token.
- Validate message origin, direction, type, schema, session, and request ID.
- Restrict network access using declared manifest destinations and response headers where practical.
- Hash every build and bind tournaments to the exact hash.

## Founding message types

```text
GAME_READY
SHELL_INIT
SESSION_START
PAUSE
RESUME
SAVE_REQUEST
SAVE_RESULT
LOAD_REQUEST
LOAD_RESULT
TELEMETRY_BATCH
SCORE_SUBMIT
SCORE_RESULT
ACHIEVEMENT_REQUEST
ACHIEVEMENT_RESULT
ENTITLEMENT_QUERY
ENTITLEMENT_RESULT
PURCHASE_REQUEST
REPORT_ERROR
SESSION_END
```

Every message includes `protocolVersion`, `gameId`, `buildId`, `playSessionId`, `requestId`, and `timestamp` when appropriate.

## Deployment

Support both:

1. Managed Node deployment with a hosted PostgreSQL database and object storage.
2. Containerized Node deployment using a production Docker image.

Do not use a static-only deployment. Next.js documents that Node and Docker deployments support the full feature set while static export has limitations. CCG requires server-side wallet verification and protected dynamic APIs.

## Production feature flags

```text
FEATURE_REAL_PRIZES=false
FEATURE_PAYMENTS=false
FEATURE_DEVELOPER_PAYOUTS=false
FEATURE_EXTERNAL_STREAM_EMBEDS=false
FEATURE_NATIVE_STREAMING=false
FEATURE_OPEN_GAME_SUBMISSIONS=false
FEATURE_ONCHAIN_COLLECTIBLES=false
FEATURE_DEMO_WALLET=false
```

`FEATURE_DEMO_WALLET` must additionally require a non-production runtime environment.

