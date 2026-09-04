# Website

Games site built with Next.js 16, React 19 and Tailwind CSS 4, deployed on Vercel.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run typecheck`.

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

In Vercel: **Project → Settings → Domains → Add**, enter your domain, and add the
**apex** (`coolcryptogames.fun`) and **www** (`www.coolcryptogames.fun`) forms. Vercel then
shows you exactly which DNS records to create.

Add those records at your **registrar** (wherever you bought the domain —
Namecheap, GoDaddy, Cloudflare, Porkbun…), under DNS settings. They will look like:

| Type    | Name  | Value                   |
| ------- | ----- | ----------------------- |
| `A`     | `@`   | `76.76.21.21`           |
| `CNAME` | `www` | `cname.vercel-dns.com.` |

> Use the values Vercel shows you, not the ones in this table — they can change.

DNS usually propagates in minutes but can take up to 48 hours. Vercel issues the
HTTPS certificate on its own once the records resolve; there is nothing to buy or
configure for SSL.

**If your DNS is on Cloudflare:** set those records to **DNS only** (grey cloud),
not proxied — an orange-cloud proxy in front of Vercel breaks certificate issuance.

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

## Layout

```
app/
  layout.tsx              header, footer, shared metadata
  page.tsx                home page + games listing
  games/[slug]/page.tsx   individual game page
  globals.css             Tailwind import + theme tokens
lib/games.ts              the games catalogue
site.config.ts            site name, domain, tagline
public/games/             playable game builds
```
