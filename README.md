# Cool Crypto Games

Games first. Crypto native.

A curated browser gaming network. Browsing, watching, leaderboards and event
pages are open to everyone; a wallet is required only at the moment someone
presses play, as an identity step that requests no transaction, gas fee or
asset permission.

Built from the handoff kit preserved in [`docs/product-reference/`](./docs/product-reference).

## Setup

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and the three secrets
npm run dev                    # http://localhost:3000
```

Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`SESSION_SECRET`, `IP_HASH_PEPPER` and `FINGERPRINT_PEPPER` must each be at
least 32 characters. Rotating either pepper changes every derived hash and
therefore drops every existing device or network sanction.

## Database

The wallet sign-in, username, chat, tournament and scoring routes all need
Postgres. Without a `DATABASE_URL` they return `503 service_unavailable` and
the sign-in button reports that it could not complete — the site still browses,
but nobody can sign in.

```bash
export DATABASE_URL=postgres://user:pass@host:5432/dbname
npm run db:migrate     # apply db/*.sql, once each, in order
npm run db:status      # show what is applied and what is pending
```

Migrations are idempotent: each is recorded in `schema_migrations` and runs
inside a transaction, so re-running is a no-op and a failure leaves the previous
version intact.

To check the whole auth path end to end against a running server:

```bash
npm start &
npm run smoke:auth
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run db:migrate` | Apply pending migrations |
| `npm run smoke:auth` | End-to-end auth, username and chat check |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript, strict |

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/IMPLEMENTATION_DECISIONS.md`](./docs/IMPLEMENTATION_DECISIONS.md) | Decisions taken while building, and the kit conflicts they resolved |
| [`SECURITY.md`](./SECURITY.md) | Verification design and its honest limits |
| [`docs/product-reference/`](./docs/product-reference) | The handoff kit — Product Bible, protocols, acceptance tests, brand |

## Feature flags

Every flag below is **off** by default. They gate capabilities that need real
accounts, operations or legal review before they can exist in public.

```
FEATURE_REAL_PRIZES              FEATURE_NATIVE_STREAMING
FEATURE_PAYMENTS                 FEATURE_OPEN_GAME_SUBMISSIONS
FEATURE_DEVELOPER_PAYOUTS        FEATURE_ONCHAIN_COLLECTIBLES
FEATURE_EXTERNAL_STREAM_EMBEDS   FEATURE_DEMO_WALLET
```

`FEATURE_DEMO_WALLET` additionally requires `NODE_ENV !== 'production'`, so
setting the variable on a production deploy is not sufficient to enable it.

## Brand

`/brand` renders the mark options at working sizes, in one colour and on acid.
Tokens live in `config/design-tokens.json` and are mirrored as CSS custom
properties in `app/globals.css`.

Acid yellow is reserved for primary actions, live and verified states. Safety
orange is reserved for alerts and expiring states. Using either elsewhere is
what stops them meaning anything.

## Layout

```
app/                     routes and API handlers
components/brand/        mark, letterforms, lockups
components/shell/        header, bottom navigation, footer
components/play/         wallet gate and play sheet
components/ui/           cards, badges, sections
lib/anticheat/           deterministic replay and submission validation
lib/auth/                Sign-In With Solana, platform sessions
lib/security/            device fingerprint, IP handling, sanctions
lib/content/demo.ts      seed catalogue, every record flagged
db/                      schema
docs/product-reference/  the handoff kit
```
