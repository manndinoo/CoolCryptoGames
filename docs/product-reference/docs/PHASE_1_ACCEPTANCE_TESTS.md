# Phase 1 Acceptance Tests

Claude must automate these where practical and manually verify the remaining visual/accessibility items.

## A. Public access

- [ ] Home, catalog, game details, developer pages, leaderboards, tournament pages, and live schedule load without a wallet.
- [ ] Public pages do not create a wallet prompt on initial load.
- [ ] No fake live state, player number, revenue amount, prize, or winner is presented as real.
- [ ] Demo records are visibly labeled.

## B. Wallet-gated play

- [ ] Pressing Play without a verified session opens the wallet explanation flow.
- [ ] The flow states that no transaction, gas fee, or asset permission is requested.
- [ ] A valid signature creates a secure server session.
- [ ] Invalid signature fails.
- [ ] Wrong wallet fails.
- [ ] Wrong domain fails.
- [ ] Expired challenge fails.
- [ ] Replayed nonce fails.
- [ ] Play capability is scoped to one game and build.
- [ ] Directly navigating to the runtime without a capability fails.
- [ ] An empty wallet can play.
- [ ] No code path requests token balance, NFT ownership, transaction signing, or approval.

## C. Game isolation

- [ ] Sample game runs inside the planned isolation boundary.
- [ ] Game cannot read platform cookies.
- [ ] Game cannot access a wallet provider directly.
- [ ] Unexpected message type is ignored and logged safely.
- [ ] Wrong origin is rejected.
- [ ] Wrong session, game, build, or request ID is rejected.
- [ ] Mobile touch, desktop keyboard, pause, restart, and resize work.

## D. Score integrity

- [ ] Valid CCG Reflex Lab run becomes verified.
- [ ] Duplicate completion is idempotent and cannot award twice.
- [ ] Expired match is rejected.
- [ ] Impossible score is rejected or held.
- [ ] Impossible chronology is rejected or held.
- [ ] Wrong build is rejected.
- [ ] Held result does not enter final standings.
- [ ] Admin decision creates an audit event.
- [ ] Unauthorized user cannot access review actions.

## E. Tournament foundation

- [ ] Tournament has versioned rules and game build.
- [ ] Entry requires wallet authentication and rules acceptance.
- [ ] Closed or ineligible entry fails.
- [ ] Only verified results affect standings.
- [ ] Tie-break behavior is deterministic.
- [ ] Real-prize controls remain disabled by default.
- [ ] No paid-entry or player-funded-pool code exists.

## F. Responsive design

- [ ] Mobile header is compact and does not contain squeezed desktop navigation.
- [ ] Mobile has safe-area support and thumb-sized controls.
- [ ] Featured games communicate horizontal swipe affordance.
- [ ] Desktop uses an intentional grid/rail layout.
- [ ] Primary action uses acid yellow with accessible contrast.
- [ ] Reduced-motion mode works.
- [ ] Keyboard focus is visible.
- [ ] Core flows work at representative small mobile, large mobile, tablet, laptop, and wide desktop sizes.

## G. Production safety

- [ ] Type check passes.
- [ ] Lint passes.
- [ ] Unit and integration tests pass.
- [ ] Critical browser tests pass.
- [ ] Production build passes.
- [ ] No secrets are committed.
- [ ] Security headers are configured.
- [ ] Mutation endpoints validate origin/CSRF strategy.
- [ ] Rate-limit strategy exists for sensitive endpoints.
- [ ] Demo wallet cannot run when `NODE_ENV=production`.
- [ ] Disabled future features are visibly and technically gated.

## Definition of done

Phase 1 is done only when a new developer can follow the README, start the platform, connect through the real wallet adapter or explicit development simulator, launch CCG Reflex Lab, submit a verified score, inspect the leaderboard, and review a held score from an authorized admin account.

