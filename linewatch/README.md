# Linewatch 2

Pole inspection, line mapping and AI-assisted grading for electric utilities.

- **Map the grid by walking it.** Stand at a pole, tap **Mark pole on map**. The phone averages several GPS fixes into one position (shown as ±metres), places the pole, and draws the span from the previous pole. Keep walking and the line builds itself. Tap any pole to branch from it. Pins can be corrected by dragging them on satellite imagery.
- **Photograph poles in the app.** An in-app camera for rapid multi-shot capture walks you through the recommended views (whole pole, top and crossarms, equipment, guys, groundline, tag). The phone's own camera and photo library also work. The camera does not use GPS; location is only used when you mark a pole on the map.
- **AI + human grading into four grades:** Critical, Priority, Monitor, No issues. "Needs more evidence" is a separate state, and it never counts as No issues.
- **The AI learns until review isn't needed.** Every review is measured and fed back into the AI. Each grade has to earn trust before the AI may finalise it alone (details below).
- **Works with no signal.** The app opens offline, and poles, spans and photos are saved on the phone and upload when signal returns. Map tiles you have viewed are cached.
- **Shared by the whole crew.** Accounts with inspector, reviewer and admin roles share one database. Work orders open automatically for Critical and Priority poles. Exports are CSV, GeoJSON (for GIS) and a training dataset.

## Run it

Needs Node.js 22.5 or later.

```sh
cd linewatch
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY for AI grading (optional)
npm start                   # http://localhost:3000
npm test
```

The first visit creates the admin account. Add inspectors and reviewers under **More**. Without an API key everything works, but every inspection is graded by a person.

To try the AI on sample photos, run `npm run seed:demo` after creating the admin. It loads the eight historical photos from v1 as a demo line. Their locations are **simulated**, and their licenses are in `demo/photos/ATTRIBUTION.txt`.

### On a phone

Phones only allow camera and GPS over **HTTPS**. Deploy behind any HTTPS host. The `Dockerfile` runs anywhere that gives you a persistent volume for `/data`, such as Fly.io, Render or Railway. For a quick test on your own network you can set `LINEWATCH_TLS_CERT` and `LINEWATCH_TLS_KEY`. Then open the site and use **Add to Home Screen** (iPhone, Safari) or **Install app** (Android, Chrome).

Back up the data directory (`linewatch.db` plus `photos/`). That folder is the whole system.

## How the AI learns, and when it stops needing a person

The AI is not retrained. It learns from context, and its trust is measured, not assumed.

1. **Policy.** Every request carries the grading policy and lineman checklists from `docs/`, which v1 had drafted but never installed. The policy includes the three-part Critical gate and rules such as "missing views never become No issues". Code then enforces what must not depend on the model following instructions: the grade can't be milder than its worst finding, every finding must cite a supplied photo, and No issues requires adequate coverage.
2. **Feedback.** When a reviewer changes the AI's grade they must say why. Reasons and saved lessons, plus recent reviewed cases (overrides first), go into every new prompt. Lessons can be switched off on the **AI** tab.
3. **Measurement.** For each grade the AI predicts, Linewatch tracks agreement with reviewers over a rolling window. Trust is the 95% lower bound (Wilson) of that agreement, so 6 out of 6 isn't proof. The dashboard also shows a confusion matrix, Critical recall and whether the AI's stated confidence matches reality.
4. **Autonomy.** It is off until an admin turns it on. An AI result is then accepted without review only when all of these hold:
   - the grade is allowed (No issues and Monitor by default; Priority is opt-in)
   - the grade has at least N reviews (default 25) and trust at or above the bar (default 90%)
   - there are no severe under-calls recently (AI said No issues, a person found Priority)
   - the AI's confidence is high
   - photo coverage is adequate, and no field verification or policy correction was needed

   About 10% of trusted results still go to a person at random, so accuracy stays measured.
5. **Hard limits.** Critical is always confirmed by a person, immediately and at the top of the queue. Once a pole is Critical it stays Critical until a reviewer marks the hazard resolved. Neither a cleaner later inspection nor a closed work order clears it.

**Export training set** (admin) downloads every human-labelled inspection with its photos, for evaluating or training a dedicated model later.

### AI provider

Claude (`claude-opus-5-5`, adaptive thinking, structured JSON output, server-side refusal fallback) is used when `ANTHROPIC_API_KEY` is set. OpenAI (`gpt-5.4-mini`, as in v1) is used if only `OPENAI_API_KEY` is set. Both get the same policy and must return the same schema. GPS coordinates and inspector identity are not sent to the AI. A failed AI call retries with backoff. If it still can't finish (billing, refusal), the inspection goes to a person with the reason attached; no results are invented.

## Layout

| Path | What |
|---|---|
| `server/app.mjs` | HTTP API, auth checks, static files |
| `server/inspections.mjs` | inspection lifecycle, AI worker queue, how a grade reaches a pole |
| `server/ai/policy.mjs` | grading policy prompt, output schema, report validation |
| `server/ai/learning.mjs` | lessons and calibration cases, trust metrics, the autonomy decision |
| `server/ai/anthropic.mjs`, `openai.mjs` | providers |
| `server/db.mjs` | SQLite schema (append-only migrations) |
| `web/js/store.js` | offline copy and outbox sync |
| `web/js/geo.js` | GPS averaging, distances (shared with the server) |
| `web/js/app.js` | app shell, map, walk-the-line |
| `web/js/views/` | capture, review, pole, work orders, AI dashboard, admin |

## Honest limits

- **Live AI accuracy is unverified.** The provider code is tested against mocked API responses only, because no API key was available while building this. Run `npm run seed:demo` with a key, review the results, and watch the **AI** tab before turning autonomy on.
- **GPS accuracy is phone-grade.** Expect ±2–5 m in the open, worse under trees or near buildings. The pin marks where the phone was, so stand against the pole. For survey-grade positions, use an external RTK receiver paired to the phone; the phone reports its accuracy to the app.
- **Spans are straight lines between poles**, not surveyed conductor geometry.
- **Camera guides are not measurements.** The AI is told that apparent lean in a photo depends on perspective.
- **No issues is never clearance to climb, touch or work** on a structure.
- **Not migrated from v1.** v1 kept its data in one phone's browser storage on another site, with no export for photos, so it cannot be moved. v1's docs and test photos are in `docs/` and `demo/`.
- **Before exposing it publicly:** put it behind HTTPS, set `NODE_ENV=production`, and consider rate limits on the API. Login attempts are already throttled.
