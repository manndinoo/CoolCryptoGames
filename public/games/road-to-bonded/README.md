# BONDED

*An original arcade match-3 game*

An original portrait-first strategic match-3 arcade game: launch a coin, build
volume, survive dips, climb the bonding curve and become **BONDED**. Every level has its own
animated backdrop and palette, and the BONDED pill is a rare on-board power-up:
swap it with any piece to fire BONDED on that symbol. Fifty
data-driven levels across five map regions, a deterministic engine, a
signature BONDED power-up, full local persistence, and no lives, ads, stores,
payments or real crypto connections.

## Run it

The game is a static web app with no build step:

```
node apps/road-to-bonded/tools/serve.mjs 8080
# open http://localhost:8080/
```

Opening `index.html` directly from disk also works (plain scripts, no modules).

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | Screens, HUD, modals, responsive portrait shell |
| `js/rng.js` | Seeded deterministic RNG with serialisable state |
| `js/engine.js` | Authoritative match-3 model: matching, specials, combos, blockers, gravity, portals, lanes, FUD, printers, wallets, capsules, keys/gates, BONDED, market reset, win/lose |
| `js/levels.js` | The 50 level configurations (grids, objectives, budgets, mechanics) |
| `js/seeds.js` | Generated tested seed pools and score-grade targets per level |
| `js/pieces.js` | Procedural artwork for every chip, special, blocker and the vector pill |
| `js/board.js` | Board renderer, animation player, touch/drag input, BONDED candlestick meter |
| `js/roadmap.js` | Scrolling candlestick roadmap level select |
| `js/app.js` | Screens, flows, tutorials, settings, persistence glue |
| `js/save.js`, `js/audio.js` | Versioned save with backup; synthesized audio |
| `assets/pill.png` | The BONDED pill reference with its background removed |
| `tools/verify.mjs` | Level verifier: validates configs, finds winning seeds with a solver bot, checks determinism, writes `js/seeds.js` |
| `tools/smoke.mjs` | Headless Chromium smoke test through real UI code paths at several viewports |
| `tools/pill-clean.mjs` | Pure-Node PNG background removal used for the pill asset |

## Verification

```
node apps/road-to-bonded/tools/verify.mjs            # all 50 levels
node apps/road-to-bonded/tools/verify.mjs --write    # regenerate seed pools + grade targets
node apps/road-to-bonded/tools/smoke.mjs ./shots     # browser smoke test + screenshots
```

Every shipped level has at least three tested seeds: no opening match, at
least three legal opening moves, and a verified winning route within the move
budget found by the solver. Replays of the same seed and moves are
byte-identical.

## Design rules encoded in the engine

* Only orthogonal swaps; invalid swaps bounce and cost nothing; valid swaps cost one move; cascades are free.
* Input is accepted only in the READY state; the whole cascade resolves before win/lose is decided.
* Specials: Breakout Candle (4 in a line), Volume Burst (T/L), Market Sweep (5 in a line), Smart Bot (2×2 made by the player's swap); all eight combinations implemented; every triggered special fires exactly once.
* Candle meter: filling it drops the power-up previewed in the NEXT slot (Candle, Burst, Sweep, Bot, or the rare BONDED pill; levels that require BONDED deal the pill first).
* BONDED pill: a rare board piece (natural drop chance per spawned piece, plus the rare meter prize). Swap it with any piece to clear every chip of that symbol and fire three deterministic Smart Rockets; specials struck by it fire too. Costs no move, never fires on its own, never carries between levels, and its own destruction never recharges the meter.
* Dead boards trigger a free MARKET RESET that preserves specials, blockers, capsules, objectives, score and charge.
* Saves after every resolved move, BONDED activation, win/lose and app background; a reload restores the exact run from the last-known-good copy.
