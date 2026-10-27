// Accounts and sessions. Passwords use scrypt; session tokens are random and
// only their SHA-256 hash is stored, so a copied database cannot log anyone in.
import crypto from 'node:crypto';
import { now } from './db.mjs';

const SESSION_DAYS = 30;
export const ROLES = ['admin', 'reviewer', 'inspector'];
// What each role may do. Reviewers can also inspect; admins can do everything.
const CAN = {
  inspect: ['admin', 'reviewer', 'inspector'],
  review: ['admin', 'reviewer'],
  admin: ['admin'],
};
export const can = (user, action) => !!user && CAN[action].includes(user.role);

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, key] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'Password is too long.';
  return null;
}

const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(tokenHash(token), userId, now(), expires);
  return { token, expires };
}

export function sessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1`).get(tokenHash(token));
  if (!row || row.expires_at < now()) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function endSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function sessionCookie(token, expires, secure) {
  return `lw_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure ? '; Secure' : ''}`;
}

export const clearCookie = secure => `lw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Slows password guessing: 8 failures per email+address in 15 minutes.
const failures = new Map();
export function loginThrottled(key) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > 15 * 60e3) { failures.delete(key); return false; }
  return entry.count >= 8;
}
export function recordLoginFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > 15 * 60e3) failures.set(key, { first: Date.now(), count: 1 });
  else entry.count++;
}
export const clearLoginFailures = key => failures.delete(key);
