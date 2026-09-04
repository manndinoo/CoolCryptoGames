# SIGNAL BRAWL

*A WEBCADE original stick-figure platform brawler*

One player against three CPU rivals, three lives each, on a ninety-second
timer. Light combos, a charged heavy, a directional dash, a guard with a guard
meter, and a Signal Surge earned by landing hits. Pulse Blasters, Signal
Staves, Gravity Hammers, throwable Plasma Bombs and a rare Star Power drop
mid-match. Six arenas, each with a hazard of its own: rising lava, timed wind,
ceiling crushers, reactor shockwaves, low gravity, and a sweeping static wall.

No dependencies, no build step, no external images or audio — the art is drawn
into a canvas and the sound is synthesised with Web Audio.

## Run it

```
python3 -m http.server 8080 --directory public
# open http://localhost:8080/games/signal-brawl/index.html
```

Opening `index.html` from disk works too.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | Canvas, menus, HUD containers, touch controls, accessibility labels |
| `styles.css` | Responsive shell, overlays, level picker, thumb controls, landscape breakpoints |
| `game.js` | The whole engine: stages, fighters, combat, AI, weapons, hazards, particles, audio, input, render, loop |

## Controls

**Desktop** — `A`/`D` or arrows move, `W`/`↑`/space jump (twice), `S`/`↓` drop
through a thin platform, `J` light, `K` heavy, `L` dash or Signal Surge, either
Shift guards, `Esc` pauses.

**Touch** — left joystick moves and pulls down to drop through; Jump, Hit (hold
for heavy) and Dash (hold to guard) sit under the right thumb.

## Running inside the site

`PlayGate` frames this build with `sandbox="allow-scripts"` and deliberately
without `allow-same-origin`, so it runs on an opaque origin. Two consequences
shape the code here:

- **Storage throws.** Every `localStorage` call raises SecurityError in that
  frame. The `save` module at the top of `game.js` probes for a working
  `localStorage` and otherwise keeps progress in memory, asking the host page
  for the stored copy over `postMessage` and posting changes back. The shell
  side is `lib/play/save-bridge.ts` and `components/play/sandboxed-game.tsx`,
  which hold the save under `ccg.gamesave.signal-brawl`. Without it the six
  unlockable levels would never unlock for anyone playing on the site.
  `tests/signal-brawl.test.ts` keeps the two ends of that protocol in step.
- **The shell owns the chrome.** `GameStage` puts a 44px title-and-exit bar
  above the frame, so the game's viewport is shorter than the window. The
  in-game pause and sound buttons are positioned from `resizeCanvas()` against
  the letterboxed world rect rather than the viewport corner, which is what
  keeps them off the fourth fighter's HUD card at 16:9.

Nothing here talks to the network, and nothing is loaded from another origin.

## Changing it

The engine is one file organised as: constants and persistence, `AudioBus`,
stage factories, fighter construction and match lifecycle, player and CPU
decisions, attack definitions and hit resolution, projectile/bomb/pickup/hazard
/particle updates, canvas resize and world-to-screen scaling, layered render
functions, input listeners, and a fixed-step loop.

Find the subsystem before editing it and keep the change local — the state
machine (menu → countdown → playing → paused/result) is what everything else
assumes. After a change, check that all six levels still start and finish, that
unlocks and preferences survive a reload, that pause and resume leave no key
stuck, and that it still plays at both landscape phone size and desktop size.
