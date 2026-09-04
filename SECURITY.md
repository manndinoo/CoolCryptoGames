# Anti-abuse design

What this system does, what it deliberately does not attempt, and where the
real limits are. Read the limits section before relying on any of this.

## The rule everything else follows from

**The client is not trusted to report a score.**

If game logic runs in the player's browser, the player controls every number it
produces. Obfuscation, integrity checksums, anti-debugger tricks and encrypted
payloads all lose to one person with a debugger and an afternoon. There is no
client-side scheme that survives a determined attacker, and treating one as a
defence just means you don't find out you've been beaten.

So the client submits **what the player pressed**, and the server works out what
that was worth by replaying the inputs itself.

This converts score forgery — trivial, unlimited — into botting, which is
bounded by real time and leaves evidence. That is the whole trade.

## The specific attack: play offline, submit a huge score

Three properties defeat it, and all three are required:

**1. Inputs, not scores.** `validateSubmission` runs the game's own
`simulate(seed, inputs)` and uses its result. A `claimedScore` in the payload is
compared and recorded as a signal, never stored. You cannot assert a number you
did not earn.

**2. The server owns the seed.** Issued at `/api/play/start` from
`randomBytes`. The client cannot search for a favourable seed, and cannot
pre-compute a run before the session exists.

**3. Wall-clock must match simulated time.** A run claiming 45 seconds,
submitted from a session that has been open for an hour, did not happen the way
it says. Heartbeats every 5s prove the client was connected *throughout*;
`max_gap_ms` records the largest silence and survives reconnection, so going
offline to do the work leaves a permanent mark on the session even if the
client comes back and behaves.

What remains is a bot that plays in real time, online, at human speed. The
input-plausibility checks (`exceedsRate`, `isMetronomic`) make that harder, and
the identity clustering makes each one you catch expensive to replace.

## Layers

| Layer | Mechanism | Defeated by |
| --- | --- | --- |
| Wallet control | Sign-In With Solana, server-rebuilt challenge | Nothing — this part is sound |
| Sybil cost | Min SOL balance / wallet age (off by default) | Funding many wallets |
| Device identity | Peppered hash of 6 browser signals | Switching browser, VM, anti-detect browser |
| Network identity | Peppered IP hash + /24 or /64 prefix | Any VPN or residential proxy |
| Score integrity | Server-side deterministic replay | Real-time botting only |
| Session integrity | Server seed, heartbeats, one score per session | Nothing cheap |

Read that table honestly. Two of the six layers are *speed bumps*, one is a
product decision you have not enabled, and the two that genuinely hold are the
replay and the session rules.

## Limits — please do not misread these as solved

**Wallet gating alone stops nobody.** A Solana keypair is free, instant and
scriptable. "You must connect a wallet" costs an attacker one line of code.
It only becomes a barrier once holding an *eligible* wallet costs something per
identity — which is what `MIN_WALLET_SOL` / `MIN_WALLET_AGE_DAYS` are for, and
both ship off.

**Device fingerprints are correlation, not identity** — but they are stronger
than they are usually given credit for. All six signals are properties of the
machine and the browser engine, not of browser storage, so the hash is stable
across cleared cookies, private windows, a fresh browser profile and a new
wallet. Casual multi-accounting, which is most real abuse, does not get past it.

What does get past it: switching to a different browser (Firefox rasterises
canvas differently to Chrome, so the hash changes), a different machine, a VM,
or an anti-detect browser built specifically to spoof these signals per profile
for roughly $30-100/month. Call it one minute of effort for someone who knows
what they are doing.

So the useful framing is cost, not prevention: a device ban is total against a
casual cheat and briefly inconvenient to a professional. Its lasting value is
the cluster it reveals — see `relatedIdentities`, and the note below.

**IP bans are weak and dangerous at the same time.** VPNs and residential proxy
pools defeat them for a few dollars. Meanwhile carrier-grade NAT puts thousands
of unrelated mobile users behind one IPv4 address, so a permanent IP ban can
quietly remove a whole region of real players. **Always set `expires_at` on
`ip` and `ip_prefix` bans.** Prefer them as a rate-limiting signal over a wall.

**A ban is a delay, not a removal.** Against a motivated attacker the goal is
to make each new identity cost more than it earns — never to believe they are
gone for good.

Three things would sharpen this considerably, none of them built yet:

- **Cluster bans.** `relatedIdentities` currently only reports. Acting on it —
  flagging every device and IP a banned wallet touched, and every wallet those
  touched — catches the browser switch that beats an exact-match device ban,
  because the new device still links back through the wallet or the address.
- **Shadow bans.** A cheater who knows they are banned churns identities; one
  who does not keeps using the burnt one. Let them play and simply do not rank
  them. In practice this outperforms hard bans.
- **A refundable stake.** The lever a crypto site has that others do not.
  Stake to play ranked, forfeit on a confirmed cheat. This prices abuse
  directly instead of proxying it through fingerprint effort, and it is the
  only measure here that meaningfully deters someone doing this for money.

**Replay only works for games the server can simulate.** `getGameRules` returns
null for anything not in the registry and `/api/play/start` refuses it. A
third-party or embedded game you did not write cannot have a leaderboard you
are able to trust. Run those unranked rather than pretending otherwise.

## Deliberate design choices

**Raw IPs are never stored.** Only a peppered HMAC plus a truncated display
form (`203.0.113.x`). Exact-match ban lookups still work; a database leak does
not hand over a list of players' addresses.

**The rightmost `x-forwarded-for` entry is used, never the leftmost.** The
leftmost is client-supplied: trusting it would let an attacker pick a fresh
"IP" per request and walk straight through every IP ban. See `clientIpFromHeaders`.

**Nonces are consumed before the signature is checked.** A captured signature
is worth exactly one attempt, and a replayed request loses the race even when
the signature is genuine.

**The server rebuilds the signed message from its own stored challenge.** It
never parses the message the client hands back. Parsing attacker-controlled
text and then trusting the fields you parsed out of it is how these flows
usually break.

**Off-curve addresses are rejected.** A program-derived address has no private
key, so nothing could ever authenticate as one.

**Rejections are kept.** One is noise; a pattern against one wallet or device
is what a ban decision should actually be built on. See `submission_rejections`
and `relatedIdentities`.

## Privacy and legal

Linking a device fingerprint and IP address to a wallet is **personal data**
under GDPR and CCPA, and a wallet address is a persistent pseudonymous
identifier that is often deanonymisable on-chain. Before launch you need:

- a privacy policy stating what is collected, why, and for how long
- a retention window with actual deletion — the schema keeps rows indefinitely
  today, which is a decision you should make consciously rather than inherit
- a route for players to request their data and its erasure
- a real appeals path for bans; the gate surfaces a reason code for this

I am not a lawyer and this is not legal advice. If you take players from the EU
or California, get someone who is to look at it.

## Operational notes

Rotating `IP_HASH_PEPPER` or `FINGERPRINT_PEPPER` changes every derived hash
and therefore silently drops every existing IP or device ban. Rotate
deliberately, and expect to re-issue.
