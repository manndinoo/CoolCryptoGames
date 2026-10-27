// HTTP API and static file server. No framework: a small router over node:http.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, tx, now, audit, getSetting, setSetting } from './db.mjs';
import * as auth from './auth.mjs';
import { createAnthropicProvider } from './ai/anthropic.mjs';
import { createOpenAIProvider } from './ai/openai.mjs';
import { computeMetrics, getAutonomy, saveAutonomy } from './ai/learning.mjs';
import { finalize, submit, startAiWorker, parseInspection, queueOrder, isGrade } from './inspections.mjs';
import { distanceM, validLatLng } from '../web/js/geo.js';
import { GRADES, STRUCTURES, MATERIALS, VIEWS } from '../web/js/grades.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const STATIC_ROOTS = { '/vendor/leaflet/': path.join(ROOT, 'node_modules/leaflet/dist') };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_PHOTOS_PER_INSPECTION = 40;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

export function selectProvider(env) {
  const choice = (env.LINEWATCH_AI_PROVIDER || '').toLowerCase();
  if ((choice === 'anthropic' || !choice) && env.ANTHROPIC_API_KEY) return createAnthropicProvider(env);
  if ((choice === 'openai' || !choice) && env.OPENAI_API_KEY) return createOpenAIProvider(env);
  return null;
}

export function createApp({ dataDir, env = process.env, provider = selectProvider(env), log = console, aiIntervalMs } = {}) {
  const db = openDb(dataDir);
  const worker = startAiWorker({ db, provider, dataDir, log, intervalMs: aiIntervalMs });
  const secureCookies = env.LINEWATCH_INSECURE_COOKIES !== '1' && env.NODE_ENV === 'production';
  const routes = [];
  const route = (method, pattern, perm, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, perm, handler });
  };

  // ---------- helpers ----------
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  const rows = (sql, ...a) => db.prepare(sql).all(...a);
  const str = (v, max = 2000, d = '') => (v == null ? d : String(v).slice(0, max));
  const numOrNull = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const heading = v => { const n = numOrNull(v); return n != null && n >= 0 && n <= 360 ? n % 360 : null; };
  const checkId = id => { if (!ID_RE.test(id)) fail(400, 'Invalid id.'); return id; };
  const pole = id => row('SELECT * FROM poles WHERE id = ?', id) || fail(404, 'Pole not found.');
  const publicUser = u => u && { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active ?? 1 };

  // ---------- auth & setup ----------
  route('GET', '/api/session', 'none', ({ user }) => ({
    user: publicUser(user),
    needsSetup: !row('SELECT 1 AS x FROM users LIMIT 1'),
    ai: provider ? { provider: provider.name, label: provider.label, model: provider.model } : null,
    org: getSetting(db, 'org', { name: 'Linewatch' }),
    enums: { grades: GRADES, structures: STRUCTURES, materials: MATERIALS, views: VIEWS },
  }));

  route('POST', '/api/setup', 'none', ({ body, res }) => {
    if (row('SELECT 1 AS x FROM users LIMIT 1')) fail(409, 'Setup is already complete.');
    const email = str(body.email, 200).trim(), name = str(body.name, 100).trim();
    if (!email.includes('@') || !name) fail(400, 'Enter a name and email.');
    const bad = auth.validatePassword(body.password); if (bad) fail(400, bad);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, email, name, role, pass_hash, created_at) VALUES (?,?,?,?,?,?)').run(id, email, name, 'admin', auth.hashPassword(body.password), now());
    if (body.orgName) setSetting(db, 'org', { name: str(body.orgName, 100) });
    const s = auth.createSession(db, id);
    res.setHeader('Set-Cookie', auth.sessionCookie(s.token, s.expires, secureCookies));
    audit(db, id, 'user', id, 'setup');
    return { user: { id, email, name, role: 'admin' } };
  });

  route('POST', '/api/login', 'none', ({ body, res, ip }) => {
    const email = str(body.email, 200).trim().toLowerCase();
    const key = `${ip}|${email}`;
    if (auth.loginThrottled(key)) fail(429, 'Too many attempts. Wait 15 minutes.');
    const u = row('SELECT * FROM users WHERE email = ? AND active = 1', email);
    if (!u || !auth.verifyPassword(String(body.password || ''), u.pass_hash)) { auth.recordLoginFailure(key); fail(401, 'Email or password is wrong.'); }
    auth.clearLoginFailures(key);
    const s = auth.createSession(db, u.id);
    res.setHeader('Set-Cookie', auth.sessionCookie(s.token, s.expires, secureCookies));
    return { user: publicUser(u) };
  });

  route('POST', '/api/logout', 'none', ({ token, res }) => {
    auth.endSession(db, token);
    res.setHeader('Set-Cookie', auth.clearCookie(secureCookies));
    return { ok: true };
  });

  route('GET', '/api/users', 'admin', () => ({ users: rows('SELECT id, email, name, role, active, created_at FROM users ORDER BY name') }));
  route('POST', '/api/users', 'admin', ({ body, user }) => {
    const email = str(body.email, 200).trim(), name = str(body.name, 100).trim();
    if (!email.includes('@') || !name) fail(400, 'Enter a name and email.');
    if (!auth.ROLES.includes(body.role)) fail(400, 'Choose a role.');
    const bad = auth.validatePassword(body.password); if (bad) fail(400, bad);
    if (row('SELECT 1 AS x FROM users WHERE email = ?', email)) fail(409, 'That email already has an account.');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, email, name, role, pass_hash, created_at) VALUES (?,?,?,?,?,?)').run(id, email, name, body.role, auth.hashPassword(body.password), now());
    audit(db, user.id, 'user', id, 'created', { role: body.role });
    return { user: { id, email, name, role: body.role, active: 1 } };
  });
  route('PATCH', '/api/users/:id', 'admin', ({ params, body, user }) => {
    const u = row('SELECT * FROM users WHERE id = ?', params.id) || fail(404, 'User not found.');
    if (u.id === user.id && (body.active === false || (body.role && body.role !== 'admin'))) fail(400, 'You cannot remove your own admin access.');
    if (body.role && !auth.ROLES.includes(body.role)) fail(400, 'Choose a role.');
    if (body.password) { const bad = auth.validatePassword(body.password); if (bad) fail(400, bad); }
    db.prepare('UPDATE users SET role = ?, active = ?, pass_hash = ? WHERE id = ?').run(body.role || u.role, body.active === undefined ? u.active : body.active ? 1 : 0, body.password ? auth.hashPassword(body.password) : u.pass_hash, u.id);
    if (body.active === false || body.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, user.id, 'user', u.id, 'updated', { role: body.role, active: body.active, passwordReset: !!body.password });
    return { ok: true };
  });

  // ---------- sync ----------
  // Everything changed since `since`. The phone keeps a local copy so the map
  // and pole history work with no signal.
  route('GET', '/api/sync', 'inspect', ({ query }) => {
    const since = query.since || '1970-01-01T00:00:00.000Z';
    const stamp = now();
    const inspections = rows(`SELECT i.*, u.name AS inspector_name, r.name AS reviewer_name FROM inspections i
      LEFT JOIN users u ON u.id = i.inspector_id LEFT JOIN users r ON r.id = i.reviewer_id WHERE i.updated_at > ?`, since).map(parseInspection);
    return {
      now: stamp,
      lines: rows('SELECT * FROM lines WHERE updated_at > ?', since),
      poles: rows('SELECT * FROM poles WHERE updated_at > ?', since).map(p => ({ ...p, equipment: JSON.parse(p.equipment || '{}') })),
      spans: rows('SELECT * FROM spans WHERE updated_at > ?', since),
      inspections,
      photos: rows(`SELECT id, inspection_id, pole_id, view, lat, lng, accuracy_m, heading, taken_at, created_at FROM photos
        WHERE inspection_id IN (SELECT id FROM inspections WHERE updated_at > ?)`, since),
      workOrders: rows('SELECT * FROM work_orders WHERE updated_at > ?', since),
    };
  });

  // ---------- lines ----------
  route('PUT', '/api/lines/:id', 'inspect', ({ params, body, user }) => {
    const id = checkId(params.id), t = now();
    const name = str(body.name, 120).trim() || fail(400, 'Name the line.');
    db.prepare(`INSERT INTO lines (id, name, kind, voltage, color, tag_prefix, notes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, voltage = excluded.voltage, color = excluded.color, tag_prefix = excluded.tag_prefix, notes = excluded.notes, updated_at = excluded.updated_at`)
      .run(id, name, str(body.kind, 40, 'distribution'), str(body.voltage, 40), /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : '#2f6fde', str(body.tag_prefix, 20), str(body.notes, 2000), user.id, t, t);
    audit(db, user.id, 'line', id, 'saved', { name });
    return { line: row('SELECT * FROM lines WHERE id = ?', id) };
  });

  // ---------- poles ----------
  route('PUT', '/api/poles/:id', 'inspect', ({ params, body, user }) => {
    const id = checkId(params.id), t = now();
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!validLatLng(lat, lng)) fail(400, 'Pole needs a valid location.');
    const tag = str(body.tag, 60).trim() || fail(400, 'Give the pole a tag or number.');
    if (body.line_id && !row('SELECT 1 AS x FROM lines WHERE id = ?', body.line_id)) fail(400, 'Unknown line.');
    const existing = row('SELECT * FROM poles WHERE id = ?', id);
    if (existing && existing.lat !== lat) audit(db, user.id, 'pole', id, 'moved', { from: [existing.lat, existing.lng], to: [lat, lng], source: body.location_source });
    db.prepare(`INSERT INTO poles (id, tag, line_id, lat, lng, accuracy_m, gps_samples, location_source, structure, material, equipment, notes, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET tag = excluded.tag, line_id = excluded.line_id, lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
        gps_samples = excluded.gps_samples, location_source = excluded.location_source, structure = excluded.structure, material = excluded.material,
        equipment = excluded.equipment, notes = excluded.notes, deleted = 0, updated_at = excluded.updated_at`)
      .run(id, tag, body.line_id || null, lat, lng, numOrNull(body.accuracy_m), Math.round(Number(body.gps_samples) || 0),
        ['gps', 'map', 'manual', 'import'].includes(body.location_source) ? body.location_source : 'gps',
        STRUCTURES.some(s => s.id === body.structure) ? body.structure : 'tangent', MATERIALS.includes(body.material) ? body.material : 'wood',
        JSON.stringify(body.equipment && typeof body.equipment === 'object' ? body.equipment : {}).slice(0, 20000), str(body.notes, 4000), user.id, t, t);
    if (!existing) audit(db, user.id, 'pole', id, 'created', { tag, lat, lng, accuracy: body.accuracy_m });
    // Spans touching a moved pole get their length refreshed.
    for (const s of rows('SELECT * FROM spans WHERE (from_pole = ? OR to_pole = ?) AND deleted = 0', id, id)) refreshSpan(s.id);
    return { pole: row('SELECT * FROM poles WHERE id = ?', id) };
  });

  route('DELETE', '/api/poles/:id', 'inspect', ({ params, user }) => {
    pole(params.id);
    tx(db, () => {
      const t = now();
      db.prepare('UPDATE poles SET deleted = 1, updated_at = ? WHERE id = ?').run(t, params.id);
      db.prepare('UPDATE spans SET deleted = 1, updated_at = ? WHERE from_pole = ? OR to_pole = ?').run(t, params.id, params.id);
      audit(db, user.id, 'pole', params.id, 'deleted');
    });
    return { ok: true };
  });

  function refreshSpan(id) {
    const s = row('SELECT * FROM spans WHERE id = ?', id);
    const a = row('SELECT lat, lng FROM poles WHERE id = ?', s.from_pole), b = row('SELECT lat, lng FROM poles WHERE id = ?', s.to_pole);
    if (a && b) db.prepare('UPDATE spans SET length_m = ?, updated_at = ? WHERE id = ?').run(Math.round(distanceM(a, b) * 10) / 10, now(), id);
  }

  // ---------- spans ----------
  route('PUT', '/api/spans/:id', 'inspect', ({ params, body, user }) => {
    const id = checkId(params.id), t = now();
    if (body.from_pole === body.to_pole) fail(400, 'A span needs two different poles.');
    pole(body.from_pole); pole(body.to_pole);
    const dup = row(`SELECT id FROM spans WHERE deleted = 0 AND id != ? AND ((from_pole = ? AND to_pole = ?) OR (from_pole = ? AND to_pole = ?))`, id, body.from_pole, body.to_pole, body.to_pole, body.from_pole);
    if (dup) return { span: row('SELECT * FROM spans WHERE id = ?', dup.id), duplicate: true };
    db.prepare(`INSERT INTO spans (id, from_pole, to_pole, line_id, conductor, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET from_pole = excluded.from_pole, to_pole = excluded.to_pole, line_id = excluded.line_id, conductor = excluded.conductor, deleted = 0, updated_at = excluded.updated_at`)
      .run(id, body.from_pole, body.to_pole, body.line_id || null, ['primary', 'secondary', 'service', 'transmission', 'neutral', 'communication'].includes(body.conductor) ? body.conductor : 'primary', user.id, t, t);
    refreshSpan(id);
    audit(db, user.id, 'span', id, 'saved', { from: body.from_pole, to: body.to_pole });
    return { span: row('SELECT * FROM spans WHERE id = ?', id) };
  });
  route('DELETE', '/api/spans/:id', 'inspect', ({ params, user }) => {
    db.prepare('UPDATE spans SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), params.id);
    audit(db, user.id, 'span', params.id, 'deleted');
    return { ok: true };
  });

  // ---------- inspections ----------
  route('PUT', '/api/inspections/:id', 'inspect', ({ params, body, user }) => {
    const id = checkId(params.id), t = now();
    pole(body.pole_id);
    const existing = row('SELECT * FROM inspections WHERE id = ?', id);
    if (existing && existing.status !== 'draft') return { inspection: parseInspection(existing) }; // already submitted: replay is a no-op
    db.prepare(`INSERT INTO inspections (id, pole_id, inspector_id, notes, checklist, status, created_at, updated_at) VALUES (?,?,?,?,?,'draft',?,?)
      ON CONFLICT(id) DO UPDATE SET notes = excluded.notes, checklist = excluded.checklist, updated_at = excluded.updated_at`)
      .run(id, body.pole_id, user.id, str(body.notes, 4000), JSON.stringify(body.checklist || {}).slice(0, 20000), t, t);
    return { inspection: parseInspection(row('SELECT * FROM inspections WHERE id = ?', id)) };
  });

  route('POST', '/api/inspections/:id/submit', 'inspect', ({ params, user }) => {
    const ins = row('SELECT * FROM inspections WHERE id = ?', params.id) || fail(404, 'Inspection not found.');
    if (ins.status === 'draft') { submit(db, ins.id, user.id, !!provider); worker.kick(); }
    return { inspection: parseInspection(row('SELECT * FROM inspections WHERE id = ?', ins.id)) };
  });

  route('POST', '/api/inspections/:id/retry-ai', 'review', ({ params, user }) => {
    if (!provider) fail(503, 'No AI provider is configured.');
    const ins = row('SELECT * FROM inspections WHERE id = ?', params.id) || fail(404, 'Inspection not found.');
    if (ins.status === 'complete') fail(409, 'This inspection is already complete.');
    db.prepare(`UPDATE inspections SET ai_status = 'queued', ai_error = '', updated_at = ? WHERE id = ?`).run(now(), ins.id);
    audit(db, user.id, 'inspection', ins.id, 'ai_retry');
    worker.kick();
    return { ok: true };
  });

  route('GET', '/api/inspections/:id', 'inspect', ({ params }) => {
    const ins = parseInspection(row(`SELECT i.*, u.name AS inspector_name, r.name AS reviewer_name FROM inspections i
      LEFT JOIN users u ON u.id = i.inspector_id LEFT JOIN users r ON r.id = i.reviewer_id WHERE i.id = ?`, params.id)) || fail(404, 'Inspection not found.');
    return {
      inspection: ins,
      photos: rows('SELECT id, view, lat, lng, accuracy_m, heading, taken_at FROM photos WHERE inspection_id = ? ORDER BY taken_at, created_at', ins.id),
      history: rows(`SELECT a.at, a.action, a.detail, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = 'inspection' AND a.entity_id = ? ORDER BY a.id`, ins.id),
    };
  });

  route('GET', '/api/review-queue', 'review', () => {
    const items = rows(`SELECT i.*, p.tag, p.structure, p.lat, p.lng, p.open_critical, u.name AS inspector_name,
        (SELECT id FROM photos WHERE inspection_id = i.id ORDER BY taken_at LIMIT 1) AS cover_photo,
        (SELECT COUNT(*) FROM photos WHERE inspection_id = i.id) AS photo_count
      FROM inspections i JOIN poles p ON p.id = i.pole_id LEFT JOIN users u ON u.id = i.inspector_id
      WHERE i.status IN ('submitted','needs_review','urgent_review')`).map(parseInspection);
    return { items: items.sort(queueOrder) };
  });

  route('POST', '/api/inspections/:id/review', 'review', ({ params, body, user }) => {
    const ins = row('SELECT * FROM inspections WHERE id = ?', params.id) || fail(404, 'Inspection not found.');
    if (ins.status === 'complete') fail(409, 'This inspection was already finalized.');
    if (ins.status === 'draft') fail(409, 'This inspection has not been submitted.');
    if (!isGrade(body.grade)) fail(400, 'Choose a grade.');
    const overriding = ins.ai_grade && body.grade !== ins.ai_grade;
    const reason = str(body.reason, 2000).trim();
    if (overriding && !reason) fail(400, 'Say why you changed the AI grade. This is how the AI learns.');
    const review = {
      reason, missed: str(body.missed, 2000).trim(), notes: str(body.notes, 4000).trim(), title: str(body.title, 200).trim(),
      findings: Array.isArray(body.findings) ? body.findings.slice(0, 80).map(f => ['agree', 'wrong', 'unsure'].includes(f) ? f : 'unsure') : [],
      agreed: !overriding,
    };
    tx(db, () => {
      finalize(db, ins.id, { grade: body.grade, source: 'human', reviewerId: user.id, review, resolveCritical: !!body.resolveCritical, workOrder: body.workOrder !== false });
      const lesson = str(body.lesson, 1000).trim();
      if (lesson) db.prepare('INSERT INTO lessons (id, text, source_inspection, created_by, created_at) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), lesson, ins.id, user.id, now());
    });
    return { inspection: parseInspection(row('SELECT * FROM inspections WHERE id = ?', ins.id)) };
  });

  // ---------- photos ----------
  route('PUT', '/api/photos/:id', 'inspect', async ({ params, query, req, user }) => {
    const id = checkId(params.id);
    const existing = row('SELECT id FROM photos WHERE id = ?', id);
    if (existing) { req.resume(); return { ok: true, duplicate: true }; }
    const mime = String(req.headers['content-type'] || '').split(';')[0];
    const ext = IMAGE_TYPES[mime] || fail(415, 'Use JPEG, PNG or WebP photos.');
    const ins = row('SELECT * FROM inspections WHERE id = ?', query.inspection) || fail(404, 'Inspection not found.');
    if (ins.status !== 'draft') fail(409, 'This inspection was already submitted.');
    if (row('SELECT COUNT(*) AS n FROM photos WHERE inspection_id = ?', ins.id).n >= MAX_PHOTOS_PER_INSPECTION) fail(413, `Up to ${MAX_PHOTOS_PER_INSPECTION} photos per inspection.`);
    const buf = await readBody(req, MAX_PHOTO_BYTES);
    if (!looksLikeImage(buf, mime)) fail(415, 'That file is not a readable image.');
    const file = `${ins.pole_id.slice(0, 64)}/${id}${ext}`;
    fs.mkdirSync(path.join(dataDir, 'photos', ins.pole_id.slice(0, 64)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'photos', file), buf);
    db.prepare(`INSERT INTO photos (id, inspection_id, pole_id, file, mime, bytes, view, lat, lng, accuracy_m, heading, taken_at, uploaded_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, ins.id, ins.pole_id, file, mime, buf.length, VIEWS.some(v => v.id === query.view) ? query.view : '', numOrNull(query.lat), numOrNull(query.lng), numOrNull(query.acc), heading(query.heading), str(query.taken, 40) || now(), user.id, now());
    db.prepare('UPDATE inspections SET updated_at = ? WHERE id = ?').run(now(), ins.id);
    return { ok: true };
  });

  route('DELETE', '/api/photos/:id', 'inspect', ({ params }) => {
    const p = row('SELECT p.*, i.status FROM photos p JOIN inspections i ON i.id = p.inspection_id WHERE p.id = ?', params.id) || fail(404, 'Photo not found.');
    if (p.status !== 'draft') fail(409, 'Photos on a submitted inspection are kept as evidence.');
    db.prepare('DELETE FROM photos WHERE id = ?').run(p.id);
    fs.rmSync(path.join(dataDir, 'photos', p.file), { force: true });
    return { ok: true };
  });

  route('GET', '/api/photos/:id', 'inspect', ({ params, res }) => {
    const p = row('SELECT * FROM photos WHERE id = ?', params.id) || fail(404, 'Photo not found.');
    const full = path.join(dataDir, 'photos', p.file);
    res.writeHead(200, { 'Content-Type': p.mime, 'Content-Length': fs.statSync(full).size, 'Cache-Control': 'private, max-age=31536000, immutable' });
    fs.createReadStream(full).pipe(res);
    return STREAMED;
  });

  // ---------- pole detail ----------
  route('GET', '/api/poles/:id', 'inspect', ({ params }) => {
    const p = pole(params.id);
    return {
      pole: { ...p, equipment: JSON.parse(p.equipment || '{}') },
      inspections: rows(`SELECT i.*, u.name AS inspector_name, r.name AS reviewer_name,
          (SELECT COUNT(*) FROM photos WHERE inspection_id = i.id) AS photo_count FROM inspections i
        LEFT JOIN users u ON u.id = i.inspector_id LEFT JOIN users r ON r.id = i.reviewer_id WHERE i.pole_id = ? ORDER BY i.created_at DESC`, p.id).map(parseInspection),
      photos: rows('SELECT id, inspection_id, view, heading, taken_at FROM photos WHERE pole_id = ? ORDER BY taken_at DESC', p.id),
      workOrders: rows('SELECT * FROM work_orders WHERE pole_id = ? ORDER BY created_at DESC', p.id),
      spans: rows('SELECT * FROM spans WHERE (from_pole = ? OR to_pole = ?) AND deleted = 0', p.id, p.id),
      history: rows(`SELECT a.at, a.action, a.detail, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = 'pole' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 50`, p.id),
    };
  });

  // ---------- work orders ----------
  route('PUT', '/api/work-orders/:id', 'inspect', ({ params, body, user }) => {
    const id = checkId(params.id), t = now();
    const existing = row('SELECT * FROM work_orders WHERE id = ?', id);
    if (!existing) pole(body.pole_id);
    const status = ['open', 'scheduled', 'in_progress', 'done', 'cancelled'].includes(body.status) ? body.status : existing?.status || 'open';
    const priority = GRADES.includes(body.priority) ? body.priority : existing?.priority || 'monitor';
    db.prepare(`INSERT INTO work_orders (id, pole_id, inspection_id, title, priority, status, assignee, due, notes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, priority = excluded.priority, status = excluded.status, assignee = excluded.assignee, due = excluded.due, notes = excluded.notes, updated_at = excluded.updated_at`)
      .run(id, existing?.pole_id || body.pole_id, existing?.inspection_id || null, str(body.title ?? existing?.title, 200) || fail(400, 'Give the work order a title.'), priority, status,
        str(body.assignee ?? existing?.assignee, 100), str(body.due ?? existing?.due, 10), str(body.notes ?? existing?.notes, 4000), user.id, t, t);
    audit(db, user.id, 'work_order', id, existing ? 'updated' : 'created', { status });
    // Closing work never changes a pole's grade: only a new inspection can.
    return { workOrder: row('SELECT * FROM work_orders WHERE id = ?', id) };
  });

  // ---------- learning ----------
  route('GET', '/api/learning', 'review', () => ({
    metrics: computeMetrics(db),
    lessons: rows(`SELECT l.*, u.name AS author FROM lessons l LEFT JOIN users u ON u.id = l.created_by ORDER BY l.created_at DESC`),
    recentOverrides: rows(`SELECT i.id, i.ai_grade, i.final_grade, i.review, i.reviewed_at, p.tag FROM inspections i JOIN poles p ON p.id = i.pole_id
      WHERE i.final_source = 'human' AND i.ai_grade IS NOT NULL AND i.ai_grade != i.final_grade ORDER BY i.reviewed_at DESC LIMIT 25`).map(parseInspection),
  }));
  route('PUT', '/api/learning/settings', 'admin', ({ body, user }) => {
    const settings = saveAutonomy(db, body);
    audit(db, user.id, 'settings', 'autonomy', 'updated', settings);
    return { settings, metrics: computeMetrics(db, settings) };
  });
  route('POST', '/api/lessons', 'review', ({ body, user }) => {
    const text = str(body.text, 1000).trim() || fail(400, 'Write the lesson.');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO lessons (id, text, created_by, created_at) VALUES (?,?,?,?)').run(id, text, user.id, now());
    return { lesson: row('SELECT * FROM lessons WHERE id = ?', id) };
  });
  route('PATCH', '/api/lessons/:id', 'review', ({ params, body, user }) => {
    const l = row('SELECT * FROM lessons WHERE id = ?', params.id) || fail(404, 'Lesson not found.');
    db.prepare('UPDATE lessons SET active = ?, text = ? WHERE id = ?').run(body.active === undefined ? l.active : body.active ? 1 : 0, body.text ? str(body.text, 1000) : l.text, l.id);
    audit(db, user.id, 'lesson', l.id, 'updated', { active: body.active });
    return { ok: true };
  });

  // ---------- exports ----------
  route('GET', '/api/export/poles.csv', 'inspect', ({ res }) => {
    const data = rows(`SELECT p.tag, l.name AS line, p.lat, p.lng, p.accuracy_m, p.gps_samples, p.location_source, p.structure, p.material, p.grade, p.grade_source, p.graded_at, p.open_critical, p.notes
      FROM poles p LEFT JOIN lines l ON l.id = p.line_id WHERE p.deleted = 0 ORDER BY l.name, p.tag`);
    const cols = Object.keys(data[0] || { tag: 1 });
    const cell = v => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="linewatch-poles.csv"' });
    res.end([cols.join(','), ...data.map(r => cols.map(c => cell(r[c])).join(','))].join('\n'));
    return STREAMED;
  });
  route('GET', '/api/export/grid.geojson', 'inspect', ({ res }) => {
    const ps = rows('SELECT p.*, l.name AS line_name FROM poles p LEFT JOIN lines l ON l.id = p.line_id WHERE p.deleted = 0');
    const byId = new Map(ps.map(p => [p.id, p]));
    const features = ps.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { kind: 'pole', id: p.id, tag: p.tag, line: p.line_name, grade: p.grade, structure: p.structure, material: p.material, accuracy_m: p.accuracy_m } }));
    for (const s of rows('SELECT s.*, l.name AS line_name FROM spans s LEFT JOIN lines l ON l.id = s.line_id WHERE s.deleted = 0')) {
      const a = byId.get(s.from_pole), b = byId.get(s.to_pole);
      if (a && b) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] }, properties: { kind: 'span', id: s.id, line: s.line_name, conductor: s.conductor, length_m: s.length_m, from: a.tag, to: b.tag } });
    }
    res.writeHead(200, { 'Content-Type': 'application/geo+json', 'Content-Disposition': 'attachment; filename="linewatch-grid.geojson"' });
    res.end(JSON.stringify({ type: 'FeatureCollection', features }));
    return STREAMED;
  });
  // Human-labelled examples for training or evaluating a dedicated model later.
  route('GET', '/api/export/training.jsonl', 'admin', ({ res }) => {
    const data = rows(`SELECT i.id, i.ai_grade, i.ai_confidence, i.ai_report, i.final_grade, i.review, i.notes, i.reviewed_at, p.tag, p.structure, p.material
      FROM inspections i JOIN poles p ON p.id = i.pole_id WHERE i.final_source = 'human' ORDER BY i.reviewed_at`);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': 'attachment; filename="linewatch-training.jsonl"' });
    for (const d of data) {
      const photos = rows('SELECT id, view FROM photos WHERE inspection_id = ?', d.id).map(p => ({ ...p, url: `/api/photos/${p.id}` }));
      res.write(JSON.stringify({ ...parseInspection(d), photos }) + '\n');
    }
    res.end();
    return STREAMED;
  });

  // ---------- dispatch ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    try {
      if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
      // Every state-changing request must carry this header. Browsers will not
      // add it cross-site without CORS, which this server never grants.
      if (req.method !== 'GET' && req.headers['x-linewatch'] !== '1') fail(403, 'Missing request header.');
      const match = routes.map(r => ({ r, m: r.method === req.method && r.re.exec(url.pathname) })).find(x => x.m);
      if (!match) fail(404, 'Not found.');
      const token = auth.readCookie(req.headers.cookie, 'lw_session');
      const user = auth.sessionUser(db, token);
      if (match.r.perm !== 'none') {
        if (!user) fail(401, 'Sign in first.');
        if (!auth.can(user, match.r.perm)) fail(403, 'Your role cannot do that.');
      }
      const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m[i + 1])]));
      const isJson = String(req.headers['content-type'] || '').startsWith('application/json');
      const body = isJson ? JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}') : {};
      const out = await match.r.handler({ req, res, params, query: Object.fromEntries(url.searchParams), body, user, token, ip: req.socket.remoteAddress });
      if (out === STREAMED) return;
      send(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof SyntaxError) return send(res, 400, { error: 'Request body is not valid JSON.' });
      log.error?.(err);
      send(res, 500, { error: 'Something went wrong on the server.' });
    }
  }

  function serveStatic(pathname, res) {
    let base = WEB, rel = pathname;
    for (const [prefix, dir] of Object.entries(STATIC_ROOTS)) if (pathname.startsWith(prefix)) { base = dir; rel = pathname.slice(prefix.length - 1); }
    if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // client-side routes
    const full = path.normalize(path.join(base, decodeURIComponent(rel)));
    if (!full.startsWith(base + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...(full.endsWith('.html') ? { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'same-origin' } : {}),
    });
    fs.createReadStream(full).pipe(res);
  }

  return { handle, db, worker, close() { worker.stop(); db.close(); } };
}

const STREAMED = Symbol('streamed');
const CSP = "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://server.arcgisonline.com https://*.arcgisonline.com; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self'";

function send(res, status, data) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Upload is too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function looksLikeImage(buf, mime) {
  if (buf.length < 12) return false;
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (mime === 'image/png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  return false;
}
