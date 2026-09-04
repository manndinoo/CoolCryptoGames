# CCG Security and Wallet Protocol

## Security objective

The founding objective is not to promise perfect bot prevention. It is to create layered, auditable evidence that makes abuse more expensive, catches impossible or duplicated results, and gives CCG a defensible process for verifying valuable outcomes.

## Wallet rule

A wallet is required before a game runtime launches. It is not required to browse, watch, search, inspect leaderboards, view events, or discover developers.

An empty wallet is valid. No token, NFT, balance, transaction, gas payment, deposit, staking action, or asset approval may be required.

## Challenge format

Use a human-readable sign-in message containing at minimum:

```text
Cool Crypto Games wants you to sign in.
Domain: <exact-origin>
Wallet: <public-key>
Statement: Connect to play. No transaction, gas fee, or asset permission is requested.
URI: <exact-origin>
Version: 1
Chain: solana:<network>
Nonce: <cryptographically-random-single-use-value>
Issued At: <ISO-8601>
Expiration Time: <ISO-8601>
Request ID: <server-generated-id>
```

The final implementation should follow a current maintained wallet sign-in standard when available, while preserving domain binding, nonce, expiration, network, public key, and explicit statement.

## Verification rules

- Challenge is created server-side.
- Nonce is cryptographically random, short-lived, and single use.
- Domain and URI must equal the configured application origin.
- Wallet in the message must equal the signature verifier identity.
- Signature is verified server-side using the exact bytes shown to the user.
- Expired, already-used, malformed, wrong-domain, wrong-wallet, or invalid challenges fail.
- Successful verification consumes the challenge atomically.
- Platform session is stored in a secure, HTTP-only, same-site cookie.
- Session rotation occurs at authentication and privilege changes.
- Authentication attempts are rate limited and audited.

## Play capability

Authentication alone does not launch any arbitrary game. A server issues a separate capability containing or referencing:

- capability ID
- wallet/user subject
- game ID
- game build ID and hash
- play-session ID
- match ID
- issue and expiration times
- permitted actions
- risk-session reference
- one-time or bounded-use policy

The game frame receives only the scoped play capability. It never receives platform cookies, wallet keys, or wallet-provider access.

## Score pipeline

1. Server creates the match before launch.
2. Game batches required telemetry and event evidence.
3. Completion message includes score, duration, terminal state, event digest, and idempotency key.
4. Server validates identity, match, build, expiration, chronology, score constraints, duplicate use, event sequence, and tournament rules version.
5. Result becomes `VERIFIED`, `HELD_FOR_REVIEW`, or `REJECTED`.
6. Only verified results enter final standings.
7. Held tournament-leading results receive enhanced review.

## Risk signals

Risk evaluation may consider wallet history inside CCG, device-risk pseudonyms, rate patterns, impossible timing, network anomalies, duplicated evidence, automation signatures, and sanction relationships.

Rules:

- Never permanently ban from IP address alone.
- Do not claim device identity is infallible.
- Do not expose fraud thresholds to the client.
- Record internal reason codes and evidence references.
- Provide an appeal path for competition-affecting decisions.
- Minimize, disclose, secure, and expire collected risk data.

## Administrative security

- Role-based access
- Multifactor authentication for privileged accounts
- Separate permissions for game release, tournament rules, score review, prize approval, and payments
- Append-only audit trail for sensitive actions
- No single silent action should both approve a high-value result and pay a prize
- Emergency game and stream shutdown controls
- Secret rotation and environment separation
- Production demo features disabled by construction

## Security acceptance statement

The build may state that CCG uses wallet-secured sessions and layered result verification. It may not state that bots, AI, cheating, account duplication, or offline reverse engineering are impossible.

