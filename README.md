# CoolCryptoGames

Games site built with Next.js 16, React 19 and Tailwind CSS 4, deployed on Vercel.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run typecheck`, `npm test`.

Copy `.env.example` to `.env.local` and fill it in — the wallet gate and the
scoring routes need a database and three secrets to run.

## Set your site identity

Everything user-facing reads from `site.config.ts`. Edit that one file:

```ts
export const site = {
  name: 'CoolCryptoGames',        // shown in the header, footer and page titles
  domain: 'coolcryptogames.fun',     // the domain you bought — no https://, no trailing slash
  tagline: '...',
  description: '...',
}
```

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and sign in **with GitHub**.
2. Grant Vercel access to this repository when prompted.
3. Pick this repo and click **Deploy**. Vercel auto-detects Next.js — leave every
   build setting at its default.
4. You get a `*.vercel.app` URL in about a minute. Every push to `main` redeploys
   automatically; every pull request gets its own preview URL.

## Point your domain at the site

`coolcryptogames.fun` is registered with **Porkbun**.

### 1. Add the domain in Vercel

**Project → Settings → Domains → Add**, and add both forms:

- `coolcryptogames.fun` (apex)
- `www.coolcryptogames.fun`

Vercel then shows the exact records to create. Use its values over the ones below
if they differ — they do change occasionally.

### 2. Create the records at Porkbun

Log in → **Domain Management** → find `coolcryptogames.fun` → **DNS**.

**Delete the default parking records first.** Porkbun pre-populates a record on the
root and one on `www` pointing at its own parking page. Leaving them in place is the
usual reason a domain keeps serving the "this domain is parked" page long after the
new records are added.

Then add:

| Type    | Host    | Answer                 | TTL |
| ------- | ------- | ---------------------- | --- |
| `A`     | (blank) | `76.76.21.21`          | 600 |
| `CNAME` | `www`   | `cname.vercel-dns.com` | 600 |

Porkbun's **Host** field is relative to the domain, so **leave it empty** for the
apex record — do not type `@` or the full domain name.

Also confirm under **Authoritative Nameservers** that the domain is still on
Porkbun's own nameservers (`*.ns.porkbun.com`). If those were changed to another
provider, the records added here are ignored.

### 3. Wait

Propagation is usually minutes, occasionally up to 48 hours. Vercel issues the HTTPS
certificate itself once the records resolve — nothing to buy or configure. The domain
shows as **Invalid Configuration** in Vercel until DNS catches up; that is expected
and clears on its own.

### Alternative: let Vercel run DNS

Instead of the records above, change the nameservers at Porkbun to `ns1.vercel-dns.com`
and `ns2.vercel-dns.com`. Vercel then manages the whole zone. Simpler for a site-only
domain, but it moves *all* DNS for the domain to Vercel — including any email records,
so avoid it if you plan to run mail on this domain.

## Security

Games are wallet-gated, and scores are computed by the server from a replay of
the player's inputs rather than reported by the client. Read
[SECURITY.md](./SECURITY.md) before changing anything under `lib/anticheat/`,
`lib/auth/` or `lib/security/` — it documents what each layer is actually worth
and, more importantly, what it is not.

## Adding a game

1. Drop the playable build into `public/games/<slug>/` so its entry point is
   `public/games/<slug>/index.html`.
2. Add an entry to the `games` array in `lib/games.ts`:

   ```ts
   {
     slug: 'my-game',
     title: 'My Game',
     blurb: 'One line about it.',
     playUrl: '/games/my-game/index.html',
     status: 'live',          // 'coming-soon' hides the player and shows a placeholder
     tags: ['arcade'],
   }
   ```

3. The listing on `/` and the page at `/games/my-game` both pick it up automatically.

Games are embedded in an `<iframe>`, so anything that runs in a browser works —
a plain HTML/canvas build, a Unity or Godot web export, a Phaser bundle.

### Ranked games need a server-side simulation

A game with a leaderboard must also register deterministic rules the server can
replay:

```ts
registerGame({
  slug: 'my-game',
  maxDurationMs: 120_000,
  maxScore: 10_000,
  maxInputsPerSecond: 12,
  simulate(seed, inputs) { /* same logic the browser build runs */ },
})
```

Keep that logic in one module both the browser build and the server import, so
the two cannot drift apart. A game with no registered rules still runs — it just
cannot have a score this server is able to vouch for, and `/api/play/start`
refuses to open a ranked session for it.

## Layout

```
app/
  layout.tsx              header, footer, shared metadata
  page.tsx                home page + games listing
  games/[slug]/page.tsx   individual game page
  globals.css             Tailwind import + theme tokens
app/api/auth/*            wallet challenge, verify, session
app/api/play/*            ranked session start, heartbeat, score submit
components/               wallet gate and auth hook
lib/anticheat/            deterministic replay + submission validation
lib/auth/                 Sign-In With Solana, session tokens
lib/security/             device fingerprint, IP handling, bans, sybil gate
lib/games.ts              the games catalogue
db/001_init.sql           schema
site.config.ts            site name, domain, tagline
public/games/             playable game builds
```
