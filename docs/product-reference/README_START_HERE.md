# Cool Crypto Games - Claude Build Kit

This folder is the complete implementation handoff for the first build of Cool Crypto Games (CCG).

## How to give this to Claude

1. Upload the entire `CCG_Claude_Build_Kit.zip` file to Claude.
2. Tell Claude to extract it and preserve the folder structure.
3. Copy and paste the complete contents of `CLAUDE_MASTER_BUILD_PROMPT.md` into Claude.
4. Do not upload only the pictures. The Product Bible and technical documents contain the rules that prevent the build from drifting.
5. Give Claude access to a fresh Git repository or ask it to create the project in a clean folder.

## Authority order

If files appear to conflict, Claude must follow this order:

1. `CLAUDE_MASTER_BUILD_PROMPT.md`
2. `docs/CCG_PRODUCT_BIBLE.md`
3. `docs/SECURITY_AND_WALLET_PROTOCOL.md`
4. `docs/TECHNICAL_BLUEPRINT.md`
5. `docs/PHASE_1_ACCEPTANCE_TESTS.md`
6. `config/design-tokens.json`
7. Visual reference images

The Word version of the Product Bible is included for polished human reading. The Markdown version contains the same product direction and is easier for coding agents to parse.

## Visual-reference hierarchy

- `04-approved-hybrid-desktop.png` is the primary desktop direction.
- `05-approved-hybrid-mobile.png` is the primary mobile direction.
- `01-toxic-black-brand-board.png` supplies premium dark materials and restraint.
- `02-clean-degen-brand-board.png` supplies clean shapes, cobalt, white, and playful energy.
- `03-after-hours-brand-board.png` is an alternate exploration only. Do not use its red/purple palette in the founding build.

The images are art direction, not pixel-perfect screen specifications. Do not copy fake player counts, blockchain logos, placeholder game names, or promotional claims from generated images.

## What Claude should deliver first

Claude should build Phase 1 as a working, testable platform foundation:

- Responsive desktop and mobile shell
- Public game discovery, developer, leaderboard, tournament, and live pages
- Wallet required only when a user starts a game or performs a competition action
- Free signed-message authentication with no transaction and no asset permission
- Isolated sample game runtime
- Server-issued play session and match ID
- Validated score submission and visible verification state
- Admin review screen
- Seed data that is clearly labeled as demo content
- Automated tests, production build, setup documentation, and deployment configuration

Real payments, public prizes, native streaming, open game uploads, and production anti-cheat enforcement stay behind feature flags until the necessary accounts, operations, and legal approvals exist.

