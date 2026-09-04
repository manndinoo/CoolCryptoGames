#!/usr/bin/env node
/**
 * End-to-end smoke test for wallet auth, usernames and chat.
 *
 * Runs against a server that is already up with a real database behind it. It
 * signs challenges with a throwaway keypair, so it exercises the same code path
 * a browser wallet does without needing one.
 *
 *   npm run db:migrate
 *   npm start &
 *   npm run smoke:auth
 *
 * Every check here passed the first time it was run — but only after a
 * database existed. Before that the routes threw before producing a body, and
 * the client treated the resulting parse failure as the player cancelling, so
 * a completely broken sign-in looked like a button that did nothing. If this
 * passes, sign-in genuinely works.
 */
import nacl from 'tweetnacl'
import bs58 from 'bs58'

const BASE = 'http://localhost:3000'
const kp = nacl.sign.keyPair()
const address = bs58.encode(kp.publicKey)
let cookie = ''

// Unique per run. A fixed name passes once and then fails forever, because the
// first run claims it — which is exactly what happened the first time this was
// re-run, and looked like a product bug rather than a test that could not
// repeat itself.
const NAME = 'Smoke' + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/gi, 'x')

const grab = (res) => {
  const c = res.headers.get('set-cookie')
  if (c) cookie = c.split(';')[0]
}
const post = (path, body) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
const get = (path) => fetch(BASE + path, { headers: cookie ? { cookie } : {} })

const fingerprint = {
  platform: 'linux', timezone: 'utc', screen: '1920x1080x24',
  cores: '8', canvas: 'abc123', webgl: 'def456',
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

// 1. challenge
let res = await post('/api/auth/challenge', { address, fingerprint })
const challenge = await res.json()
check('challenge issued', res.ok && !!challenge.message && !!challenge.nonce, `status ${res.status}`)

// 2. sign + verify
const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), kp.secretKey))
res = await post('/api/auth/verify', { nonce: challenge.nonce, signature: sig, fingerprint })
grab(res)
const verified = await res.json()
check('signature verified', res.ok && verified.wallet === address, `status ${res.status}`)
check('new wallet needs a username', verified.needsUsername === true)
check('session cookie issued', cookie.startsWith('ccg_session='))

// 3. nonce is single use
res = await post('/api/auth/verify', { nonce: challenge.nonce, signature: sig, fingerprint })
check('replayed nonce rejected', res.status === 400, `status ${res.status}`)

// 4. wrong signature
const c2 = await (await post('/api/auth/challenge', { address, fingerprint })).json()
const other = nacl.sign.keyPair()
const badSig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(c2.message), other.secretKey))
res = await post('/api/auth/verify', { nonce: c2.nonce, signature: badSig, fingerprint })
check('wrong wallet signature rejected', res.status === 401, `status ${res.status}`)

// 5. me
const me = await (await get('/api/auth/me')).json()
check('session resolves to the wallet', me.wallet === address)

// 6. username claim
res = await post('/api/auth/username', { username: NAME })
grab(res)
const claimed = await res.json()
check('username claimed', res.ok && claimed.username === NAME, `status ${res.status} ${JSON.stringify(claimed)}`)

// 7. reserved + taken
res = await post('/api/auth/username', { username: 'admin' })
check('reserved username refused', res.status === 400 || res.status === 409, `status ${res.status}`)

const me2 = await (await get('/api/auth/me')).json()
check('username now on the session', me2.username === NAME, JSON.stringify(me2))

// 8. a second wallet cannot take the same name
const kp2 = nacl.sign.keyPair()
const addr2 = bs58.encode(kp2.publicKey)
const savedCookie = cookie
cookie = ''
const c3 = await (await post('/api/auth/challenge', { address: addr2, fingerprint })).json()
const sig3 = bs58.encode(nacl.sign.detached(new TextEncoder().encode(c3.message), kp2.secretKey))
res = await post('/api/auth/verify', { nonce: c3.nonce, signature: sig3, fingerprint })
grab(res)
res = await post('/api/auth/username', { username: NAME.toLowerCase() })
check('duplicate username refused case-insensitively', res.status === 409, `status ${res.status}`)

// 9. chat: read open, post requires a name
cookie = ''
res = await get('/api/live/ccg-official/chat')
const feed = await res.json()
check('chat readable with no session', res.ok && Array.isArray(feed.messages), `status ${res.status}`)

cookie = savedCookie
const MSG = 'smoke ' + NAME
res = await post('/api/live/ccg-official/chat', { text: MSG })
const posted = await res.json()
check('chat post accepted', res.ok && posted.message?.handle === NAME, `status ${res.status} ${JSON.stringify(posted)}`)

res = await post('/api/live/ccg-official/chat', { text: MSG })
check('duplicate chat message refused', res.status === 429, `status ${res.status}`)

const feed2 = await (await get('/api/live/ccg-official/chat')).json()
check('message appears under the username', feed2.messages.at(-1)?.handle === NAME)
check('feed carries no wallet address', !JSON.stringify(feed2).includes(address))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
