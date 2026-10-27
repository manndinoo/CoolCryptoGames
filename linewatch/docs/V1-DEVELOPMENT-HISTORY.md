# Linewatch — Basic field inspection UI

Private Sites project: appgprj_6adce29547148191893a7c7f4b4a55cf.

## Five connected sections

1. Pole urgency: red critical, purple high urgency, yellow attention needed, green no issues reported. Gray means unreviewed or insufficient evidence.
2. Map: GPS-projected poles, explicit previous-pole connections, branches, pan/zoom/fit, and click-to-open reports. Coordinate grid only; no street or satellite imagery. The attempted public street-tile provider blocked images during QA, so that dependency was removed.
3. Structure ID lookup: ID/line/finding search, urgency and line filters, CSV export, and add/edit GPS and connections.
4. To-do list: independent tickets with assignee, due date, and status. Completing work does not change inspection urgency.
5. Photos & tickets: choose or add a structure, upload photos, record observations and an optional component checklist, choose urgency, and optionally add follow-up work. Saving updates the map and full report together.

Reports retain photo thumbnails and full-size links, GPS, connection, inspector, dated inspection history, ticket-specific photos, checklists, work details, and local activity history.

## Data and boundaries

IndexedDB database linewatch-prototype-v1 retains previous records and photos. Migration adds nested tickets and connections without deleting older evidence. The latest dated inspection sets map urgency; backdated inspections retain evidence without replacing newer condition ratings. Later submissions on the same inspection date supersede earlier submissions for that date.

This is a device-local prototype. No shared company database, authenticated reviewer identity, cloud sync, or drone control is connected. OpenAI visual inspection is now implemented; see the current AI integration section below. Clearing browser data can erase records. CSV excludes photos. Green means no issues reported within the recorded assessment, not electrically safe or safe to climb. Sample poles and locations are fictional. Pole-to-pole segments connect endpoints and are not surveyed conductor geometry.

## Verification

Run node --check dist/app.js, node --check dist/model.js, and node test-model.cjs.

Model tests cover latest-versus-historical condition updates, task-only invariants, evidence retention, duplicate ticket rejection, coordinates, connection cycle rejection, and map projection/fit.

Browser QA covers adding a connected pole from the upload form, uploading an image, saving purple urgency with an assigned follow-up ticket, opening the colored map dot and ticket photos, persistence after reload, ID lookup, and completing a task without clearing the pole rating.

## Later phases

Add shared company storage, identity, GIS imports and basemaps, then validated AI photo assistance and a cited historical accident/fire/storm knowledge base. No model training is claimed by this interface.

## Real-photo workflow test — 2026-10-25

Eight licensed historical Wikimedia Commons photos are bundled in `dist/test-assets`, with per-image attribution and hashes in `dist/photo-tests.json`. Each photo was viewed by the assistant and given a provisional visual assessment; all require qualified review. No autonomous model is connected or trained. Internet image locations are not verified pole GPS: every PHOTO-TEST map coordinate and connection is explicitly simulated. The initial dataset includes red (3), purple (2), yellow (1), green (1, limited-view no obvious issue) and gray (1, insufficient evidence).

On launch, the app atomically fetches/decodes all missing test photos and saves records/photos to IndexedDB. Existing IDs are skipped, so repeat loads preserve edits and avoid duplication. The complete bundled set is delivered to each user browser; QA-browser mutations are not deployed. Storage remains browser-local.

Validation: `node test-model.cjs`; `node test-photo-dataset.cjs` (107 dataset assertions); `node --check dist/app.js`. Browser QA verified all eight images and reports, map colors/filtering, exact ID lookup, real JPEG upload and evidence retention, contradictory-green rejection, follow-up creation/completion, persistence and non-destructive reimport. Mobile map checked in a 390px iframe; compact labels avoid overlap. See `dist/test-report.html` for scope/limits and `screenshots/linewatch-photo-gallery.jpg` for captured proof. Source context and assistant visual findings are separately labeled in each report.

## Mobile report scrolling fix — 2026-10-25

Reports now place photos immediately after the urgency summary, before location and detailed notes. Historical assessment/source details remain available in an expandable section. Dialogs have a fixed header with a 44px close target and one explicitly bounded, momentum-enabled vertical scroll region. The bounds follow the visual viewport as browser chrome or the keyboard changes. Mobile photos use a full-width, uncropped layout. CSS/JS asset URLs were versioned so reopening receives the update.

Browser QA at 390×700: photo loaded and visible at initial open (top 296px, bottom 552px), scroll region 590px tall; PageDown advanced its scroll position; expanded notes reached the exact maximum scroll offset (1524px); close button stayed at 32px from the top; closing/reopening reset scrolling to zero and collapsed notes. Tested in Chromium at phone dimensions; native iOS webview touch behavior requires confirmation on the user's device. No records or photos were modified by this fix.

## Mobile capture and measurements — 2026-10-25

Photos & tickets → Start mobile capture opens a new/existing structure capture flow with a live rear-camera option, native phone camera fallback, and library selection. Both upload flows accept up to 25 JPEG/PNG/WebP photos (10 MB each, 150 MB total). Original photos remain unchanged. Saved records and photos remain in browser-local IndexedDB; this is not cloud upload or shared storage.

Opt-in GPS records phone location, accuracy and timestamp. New map pins use that approximate location unless the operator edits or confirms the pole position. Fresh camera-associated GPS is retained per photo; library imports are not assigned a fabricated capture position. Existing structure locations and urgency remain intact when adding a capture job. New captures create gray/unreviewed pins. Explicit previous-structure selection connects the route.

Live plumb/level guides use available device gravity readings. Two-point photo measurements retain the reference, measured angle and normalized endpoints. Missing/stale/degenerate sensor readings fall back to clearly labeled, uncalibrated image axes. Measurements describe a projected 2D angle, not surveyed pole lean or a certified crossarm level. Camera, GPS and sensor resources stop when leaving capture.

After saving, the inspection screen shows saved photos, map status and **Awaiting AI connection**. No AI request is attempted and no automatic findings are fabricated. The user declined the AI connection for this iteration. Captures retain their pending status after reload and can be reopened from structure reports.

Validation: `node test-capture.cjs` passes 24 assertions covering photo count/type/size limits, gravity transforms, angle geometry, fresh GPS, duplicate captures and preservation of earlier inspection condition. Existing model and 107 photo-dataset assertions pass. Browser QA saved 25 real JPEGs, rejected a 26th, saved a two-point measurement, created an approximate gray map pin, opened all 25 photos, and verified photo/measurement persistence after reload. At 390×800 the capture form had no horizontal overflow and the measurement modal scrolled within the viewport; denied GPS permissions showed a usable manual-coordinate fallback. Live phone camera, real GPS and motion sensors still require physical-device verification. Proof: `screenshots/linewatch-mobile-measurement.jpg`.

## Field workflow stability and phone installation — 2026-10-25

Fixed interrupted workflows: nested dialogs now suspend and restore their parent DOM, scroll position and inputs; pole edits return to the report; full-size photos use an in-app viewer; gallery → report → edit → cancel returns through the same stack. Browser Back closes the active popup while retaining the underlying page. Clicking the active navigation tab no longer rerenders unfinished forms. Explicit navigation remembers the page, map filter and map position. Valid zero-valued coordinates are retained.

Added a separate IndexedDB drafts store without changing the existing record/photo database. Mobile photos, notes, coordinates, confirmation and measurements save as drafts while working, with an explicit Save draft for later button. Manual inspection files/fields and pole/task forms also restore after reopening. The native camera/pagehide path stops hardware resources without deleting the draft. Successful capture commits have a stable draft ID to avoid duplicate captures after a retry. Save locks prevent navigation during image decoding/final capture saves. Image decoding has an HTML-image fallback for browsers without working createImageBitmap support; live-camera requests and sensor permissions cannot attach after their screen was closed. Live GPS/gravity evidence is snapshotted at the shutter.

Added a web app manifest, home-screen icons and Save to phone instructions for Safari/iPhone and Chrome/Android. No offline service worker is installed: internet is still required to open the app. Home-screen/browser storage can differ; the setup screen tells operators to start field testing from the installed icon and use the same app for their records. Company sync and live AI remain unconnected.

Browser QA: 25-photo mobile draft survived reload and tab navigation with notes intact; a 1.1° image-relative measurement survived reload/reopening; final capture saved all 25 photos and produced a gray map pin with all images loaded. Browser Back closed its report while preserving the map page. Manual form retained its image and summary through a nested new-pole flow and reload, including the newly selected structure; final manual inspection updated the report/map. Task draft survived close/reopen, saved and completed, without changing structure urgency. Map circuit selection survived reload. At 390×800, body width equaled scroll width; native-camera file chooser accepted a JPEG, a page navigation/back handoff retained the draft, measurement popup remained scrollable and restored saved points, and Save to phone help returned to the same capture. Three-level gallery/report/edit close paths were checked. Actual iPhone camera hardware, GPS and sensor permission behavior remain a physical-device verification item.

Validation: JavaScript syntax checks; existing model tests; 24 capture assertions; 107 dataset assertions. Screenshots: `screenshots/linewatch-field-stable.jpg`, `screenshots/linewatch-field-modal.jpg`. Preview QA records are not included in deployment.


## Current AI integration — 2026-10-25

The private Site now serves its preserved frontend from a dependency-free Worker with a server-side OpenAI Responses API inspection endpoint. The production OPENAI_API_KEY is stored as a Sites secret, never in browser assets or Git. Source assets moved from dist/ to web/; scripts/build.mjs embeds them in dist/server/index.js to preserve all prior routes and images. Build using `node scripts/build.mjs`; validate using `node scripts/validate-artifact.mjs`. The local dev server only forwards to the real Worker; no fixture mode is shipped.

New mobile captures automatically begin inspection. Existing captures can resume, and every structure report offers AI photo inspection for up to its latest 25 photos. The browser submits JPEG analysis copies (maximum 1600px dimension) in batches of five, plus notes and optional alignment metadata; GPS coordinates and operator identity are not included in the API payload. Originals remain in IndexedDB. Each successful batch is saved locally. Keep the app open for processing; after an interruption, Resume retries the unfinished group and retains completed groups. A lost network response can require repeating that group and incur another API request.

The agent uses gpt-5.4-mini with strict structured output, photo-ID evidence validation, quality assessments, observed concerns, coverage limits and requested additional views. It does not claim specialized training on historical utility accidents, fires or storms. New uninspected structures show provisional AI urgency; previously recorded inspection ratings are preserved. Lineman review requires a reviewer name and confirmation, with a reason for overriding the proposed urgency. Saving the review creates a dated inspection, updates the map through the existing latest-inspection rules and optionally creates follow-up work.

Live connection verification reached OpenAI and returned `credit_balance_exhausted` / `insufficient_quota`. The same result occurred for a real historical JPEG sent through the actual inspection function. No successful live model assessment is claimed. Add API credits in the connected Personal / Default project, then retry from the inspection screen. Billing errors are distinct from authentication, rate limiting, incomplete reports and transport failures; no fallback findings are invented.

Validation: 32 server tests cover input/image limits, exact photo coverage, fabricated evidence references, conservative urgency, structured API requests, refusals/incomplete reports, authentication/quota/rate-limit handling and Worker routes. Existing model, 24 capture and 107 dataset assertions pass. Browser QA used clearly labeled, development-only scripted responses to verify 25-photo processing, progress saved after photo 5, failure on the second batch, persistence after reload and resume to 25/25. Review override required a reason; approving created the inspection and changed map color; prior critical recorded urgency stayed critical when AI only suggested monitor. Selected capture/status persisted across reload. The temporary fixtures and debug output were removed before publication. Actual visual-model accuracy cannot be evaluated until the API account has credits.

## Field basics — October 26, 2026
- Each structure report has Crew prep & equipment: 27 optional fields covering voltage (L-L/L-N), phase configuration, primary/neutral/secondary/service conductors, pole class and length, framing, guys, transformers/banks, protection, grounding, equipment, job scope, access, contacts, materials, tools, coordination, notes and provenance. Include units and identify multiple units/spans in text. Unknown fields remain blank.
- IndexedDB record storage preserves equipment fields through inspection/capture updates; form drafts survive close/reload. Saved specs are included in structure-register CSV. No company synchronization or offline app-shell loading was added.
- Live camera now has 1–4× digital zoom. Saved image uses the identical centered crop and native cropped resolution; guides are separate. Digital zoom cannot add detail. Native phone photo option remains for device camera controls.
- Keep screen awake requests Screen Wake Lock while the live camera is open. It releases on close/navigation/background and reports denial or OS release. Camera must be reopened on return from background. This is not orientation lock or a replacement for phone auto-lock settings.
- QA: browser form draft survived close and reload; saved voltage/wire/pole/transformer test data survived reload; parent report restored. Automated tests cover wake-lock late-resolution cleanup, toggles and OS-release indication plus camera zoom crop and bounds. Existing model/capture/dataset/AI checks pass. Physical iPhone camera/sleep testing remains necessary; no mobile hardware is available in the cloud browser. QA equipment entries are labeled TEST ONLY in local browser storage, never bundled.

### Camera gesture correction
Pinching inside the live camera adjusts the 1–4× digital crop instead of browser zoom. Camera touch events and Safari gesture defaults are consumed on the preview only; one-finger movement there does not scroll the page. Slider uses horizontal touch handling. Normal page scrolling and accessibility zoom remain available outside camera controls. Automated gesture simulations cover pinch in/out, bounds, single-finger stability and cancellation. Physical iPhone Safari gesture verification remains outstanding.
