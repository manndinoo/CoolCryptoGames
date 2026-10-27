// End-to-end API tests against a real server and database, with a stub AI
// provider whose answers each test controls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server/app.mjs';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]);
let server, base, app, dir;
const aiAnswers = [];   // queue of { grade, confidence, ... } the stub returns
const aiCalls = [];

const stub = {
  name: 'stub', label: 'Stub', model: 'stub-model',
  async inspect({ context, request, photos }) {
    aiCalls.push({ context, request, photos });
    const a = aiAnswers.shift() || { grade: 'clear', confidence: 0.95 };
    if (a.error) throw a.error;
    return {
      model: 'stub-model',
      report: {
        summary: a.summary || `Looks ${a.grade}`, grade: a.grade, confidence: a.confidence, rationale: 'stub',
        critical_gate: a.grade === 'critical' ? { hazard: 'Pole snapped at groundline photo 1', consequence: 'Structure can fall on the road', why_immediate: 'Conductors are under load now' } : { hazard: '', consequence: '', why_immediate: '' },
        structure_observed: 'tangent', coverage: { adequate: true, missing_views: [] },
        photos: photos.map(p => ({ photo_id: p.id, view: 'full', quality: 'usable', observations: [] })),
        findings: a.grade === 'clear' ? [] : [{ component: 'Pole', observation: 'x', kind: 'visible', grade: a.grade === 'inconclusive' ? 'monitor' : a.grade, photo_ids: [photos[0].id], follow_up: 'y' }],
        additional_photos: [], field_verification: [],
      },
    };
  },
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-test-'));
  app = createApp({ dataDir: dir, env: {}, provider: stub, log: {}, aiIntervalMs: 20 });
  server = http.createServer(app.handle);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async function call(method, url, body, { raw, type, noHeader } = {}) {
    const headers = { ...(noHeader ? {} : { 'X-Linewatch': '1' }), ...(cookie ? { Cookie: cookie } : {}) };
    if (raw) headers['Content-Type'] = type || 'image/jpeg';
    else if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = /^application\/(geo\+)?json/.test(res.headers.get('content-type') || '') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
}
const admin = client(), inspector = client();
const id = () => crypto.randomUUID();
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };

let lineId;
async function makePole(call, i, extra = {}) {
  const poleId = id();
  const r = await call('PUT', `/api/poles/${poleId}`, { tag: `T-${i}`, line_id: lineId, lat: 46.6 + i * 0.0005, lng: -120.5, accuracy_m: 2.5, gps_samples: 8, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return poleId;
}
async function inspect(call, poleId, photoCount = 2) {
  const insId = id();
  assert.equal((await call('PUT', `/api/inspections/${insId}`, { pole_id: poleId, notes: 'n' })).status, 200);
  for (let k = 0; k < photoCount; k++) assert.equal((await call('PUT', `/api/photos/${id()}?inspection=${insId}&view=full&lat=46.6&lng=-120.5&acc=3`, undefined, { raw: JPEG })).status, 200);
  assert.equal((await call('POST', `/api/inspections/${insId}/submit`, {})).status, 200);
  return insId;
}
const getIns = async insId => (await admin('GET', `/api/inspections/${insId}`)).data.inspection;

test('first visit creates the admin; setup cannot run twice', async () => {
  assert.equal((await admin('GET', '/api/session')).data.needsSetup, true);
  const r = await admin('POST', '/api/setup', { name: 'Ada', email: 'ada@example.com', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  assert.equal((await client()('POST', '/api/setup', { name: 'X', email: 'x@example.com', password: 'correct horse battery' })).status, 409);
});

test('admin adds an inspector who can sign in; wrong password fails', async () => {
  assert.equal((await admin('POST', '/api/users', { name: 'Ian', email: 'ian@example.com', role: 'inspector', password: 'inspector-pass-1' })).status, 200);
  assert.equal((await client()('POST', '/api/login', { email: 'ian@example.com', password: 'nope-nope-nope' })).status, 401);
  assert.equal((await inspector('POST', '/api/login', { email: 'IAN@example.com', password: 'inspector-pass-1' })).status, 200);
});

test('requests without the app header or a session are refused', async () => {
  assert.equal((await inspector('PUT', `/api/lines/${id()}`, { name: 'x' }, { noHeader: true })).status, 403);
  assert.equal((await client()('GET', '/api/sync')).status, 401);
});

test('inspectors cannot review or change settings', async () => {
  assert.equal((await inspector('GET', '/api/review-queue')).status, 403);
  assert.equal((await inspector('PUT', '/api/learning/settings', { enabled: true })).status, 403);
});

test('walking a line: poles, spans with lengths, duplicate span ignored, sync', async () => {
  lineId = id();
  assert.equal((await inspector('PUT', `/api/lines/${lineId}`, { name: 'Feeder 12', color: '#2f6fde', tag_prefix: 'T-' })).status, 200);
  const a = await makePole(inspector, 1), b = await makePole(inspector, 2);
  const s = await inspector('PUT', `/api/spans/${id()}`, { from_pole: a, to_pole: b, line_id: lineId });
  assert.equal(s.status, 200);
  assert.ok(Math.abs(s.data.span.length_m - 55.6) < 1, String(s.data.span.length_m));
  const dup = await inspector('PUT', `/api/spans/${id()}`, { from_pole: b, to_pole: a, line_id: lineId });
  assert.equal(dup.data.duplicate, true);
  const sync = await inspector('GET', '/api/sync');
  assert.equal(sync.data.poles.length, 2);
  assert.equal(sync.data.spans.length, 1);
  const later = await inspector('GET', `/api/sync?since=${encodeURIComponent(sync.data.now)}`);
  assert.equal(later.data.poles.length, 0);
});

test('moving a pole refreshes span length and is audited', async () => {
  const a = await makePole(inspector, 10), b = await makePole(inspector, 11);
  const spanId = id();
  await inspector('PUT', `/api/spans/${spanId}`, { from_pole: a, to_pole: b });
  await inspector('PUT', `/api/poles/${b}`, { tag: 'T-11', line_id: lineId, lat: 46.6 + 10 * 0.0005 + 0.001, lng: -120.5, location_source: 'map' });
  const detail = await inspector('GET', `/api/poles/${b}`);
  assert.ok(detail.data.spans[0].length_m > 100);
  assert.ok(detail.data.history.some(h => h.action === 'moved'));
});

test('bad input is rejected', async () => {
  assert.equal((await inspector('PUT', `/api/poles/${id()}`, { tag: 'x', lat: 200, lng: 0 })).status, 400);
  assert.equal((await inspector('PUT', '/api/poles/bad', { tag: 'x', lat: 1, lng: 1 })).status, 400);
  const p = await makePole(inspector, 20);
  const insId = id();
  await inspector('PUT', `/api/inspections/${insId}`, { pole_id: p });
  assert.equal((await inspector('PUT', `/api/photos/${id()}?inspection=${insId}`, undefined, { raw: Buffer.from('not an image at all'), type: 'image/jpeg' })).status, 415);
  assert.equal((await inspector('PUT', `/api/photos/${id()}?inspection=${insId}`, undefined, { raw: JPEG, type: 'application/pdf' })).status, 415);
});

test('photo uploads are idempotent so offline replays are safe', async () => {
  const p = await makePole(inspector, 21);
  const insId = id(), photoId = id();
  await inspector('PUT', `/api/inspections/${insId}`, { pole_id: p });
  assert.equal((await inspector('PUT', `/api/photos/${photoId}?inspection=${insId}`, undefined, { raw: JPEG })).status, 200);
  assert.equal((await inspector('PUT', `/api/photos/${photoId}?inspection=${insId}`, undefined, { raw: JPEG })).data.duplicate, true);
  const got = await fetch(`${base}/api/photos/${photoId}`, { headers: { Cookie: '' } });
  assert.equal(got.status, 401);
});

test('AI grades an inspection; with autonomy off it waits for a reviewer', async () => {
  const p = await makePole(inspector, 30);
  aiAnswers.push({ grade: 'monitor', confidence: 0.92 });
  const insId = await inspect(inspector, p);
  const ins = await waitFor(async () => { const i = await getIns(insId); return i.ai_status === 'done' && i; });
  assert.equal(ins.ai_grade, 'monitor');
  assert.equal(ins.status, 'needs_review');
  assert.match(ins.autonomy.reasons.join(' '), /Autonomy is off/);
  const call = aiCalls.at(-1);
  assert.equal(call.photos.length, 2);
  assert.equal(call.request.structure_tag, 'T-30');
  assert.ok(!('lat' in call.request), 'GPS location is not sent to the AI');
});

test('overriding the AI requires a reason; the reason teaches later prompts', async () => {
  const p = await makePole(inspector, 31);
  aiAnswers.push({ grade: 'clear', confidence: 0.9 });
  const insId = await inspect(inspector, p);
  await waitFor(async () => (await getIns(insId)).ai_status === 'done');
  assert.equal((await admin('POST', `/api/inspections/${insId}/review`, { grade: 'high' })).status, 400);
  const r = await admin('POST', `/api/inspections/${insId}/review`, { grade: 'high', reason: 'Woodpecker cavity near the top in photo 2', lesson: 'Woodpecker cavities near attachments are Priority.' });
  assert.equal(r.status, 200);
  // A work order opens for Priority.
  const pole = await admin('GET', `/api/poles/${p}`);
  assert.equal(pole.data.pole.grade, 'high');
  assert.equal(pole.data.workOrders.length, 1);
  // The next inspection's prompt carries the lesson and the correction.
  const p2 = await makePole(inspector, 32);
  const ins2 = await inspect(inspector, p2);
  await waitFor(async () => (await getIns(ins2)).ai_status === 'done');
  const ctx = aiCalls.at(-1).context;
  assert.match(ctx, /Woodpecker cavities near attachments are Priority/);
  assert.match(ctx, /Reviewer final grade: high/);
});

test('a grade becomes autonomous only after enough agreeing reviews', async () => {
  assert.equal((await admin('PUT', '/api/learning/settings', { enabled: true, minSamples: 5, minAgreement: 0.5, auditRate: 0, minConfidence: 0.8 })).status, 200);
  // "No issues" is blocked: earlier the AI called a Priority pole "No issues".
  const before = (await admin('GET', '/api/learning')).data.metrics.perGrade.clear;
  assert.equal(before.severe, 1);
  assert.equal(before.autonomous, false);
  assert.match(before.reasons.join(' '), /severe under-call/);
  // Five reviewed "Monitor" predictions the reviewer agrees with.
  for (let k = 0; k < 5; k++) {
    const p = await makePole(inspector, 40 + k);
    aiAnswers.push({ grade: 'monitor', confidence: 0.95 });
    const insId = await inspect(inspector, p);
    const ins = await waitFor(async () => { const i = await getIns(insId); return i.ai_status === 'done' && i; });
    assert.equal(ins.status, 'needs_review', `sample ${k} should still need review`);
    assert.equal((await admin('POST', `/api/inspections/${insId}/review`, { grade: 'monitor' })).status, 200);
  }
  const learning = await admin('GET', '/api/learning');
  assert.equal(learning.data.metrics.perGrade.monitor.autonomous, true);
  // Now a confident Monitor result is accepted without a person.
  const p = await makePole(inspector, 50);
  aiAnswers.push({ grade: 'monitor', confidence: 0.95 });
  const insId = await inspect(inspector, p);
  const ins = await waitFor(async () => { const i = await getIns(insId); return i.status === 'complete' && i; });
  assert.equal(ins.final_source, 'ai');
  assert.equal((await admin('GET', `/api/poles/${p}`)).data.pole.grade, 'monitor');
  // A low-confidence Monitor still goes to a person.
  const p2 = await makePole(inspector, 51);
  aiAnswers.push({ grade: 'monitor', confidence: 0.5 });
  const ins2 = await inspect(inspector, p2);
  const i2 = await waitFor(async () => { const i = await getIns(ins2); return i.ai_status === 'done' && i; });
  assert.equal(i2.status, 'needs_review');
  assert.match(i2.autonomy.reasons.join(' '), /confidence/);
  // So does a "No issues" result, which has not earned trust.
  const p3 = await makePole(inspector, 52);
  aiAnswers.push({ grade: 'clear', confidence: 0.99 });
  const ins3 = await inspect(inspector, p3);
  assert.equal((await waitFor(async () => { const i = await getIns(ins3); return i.ai_status === 'done' && i; })).status, 'needs_review');
});

test('Critical is never finalised by the AI and stays until a reviewer resolves it', async () => {
  const p = await makePole(inspector, 60);
  aiAnswers.push({ grade: 'critical', confidence: 0.99 });
  const insId = await inspect(inspector, p);
  const ins = await waitFor(async () => { const i = await getIns(insId); return i.ai_status === 'done' && i; });
  assert.equal(ins.status, 'urgent_review');
  const queue = await admin('GET', '/api/review-queue');
  assert.equal(queue.data.items[0].id, insId, 'urgent items are first in the queue');
  await admin('POST', `/api/inspections/${insId}/review`, { grade: 'critical' });
  // A later clean inspection does not clear the open Critical...
  aiAnswers.push({ grade: 'clear', confidence: 0.99 });
  const ins2 = await inspect(inspector, p);
  const i2 = await waitFor(async () => { const i = await getIns(ins2); return i.ai_status === 'done' && i; });
  assert.equal(i2.status, 'needs_review', 'AI cannot auto-clear a pole with an open Critical');
  await admin('POST', `/api/inspections/${ins2}/review`, { grade: 'clear' });
  assert.equal((await admin('GET', `/api/poles/${p}`)).data.pole.grade, 'critical');
  // ...until a reviewer explicitly marks it resolved.
  aiAnswers.push({ grade: 'clear', confidence: 0.99 });
  const ins3 = await inspect(inspector, p);
  await waitFor(async () => (await getIns(ins3)).ai_status === 'done');
  await admin('POST', `/api/inspections/${ins3}/review`, { grade: 'clear', resolveCritical: true });
  assert.equal((await admin('GET', `/api/poles/${p}`)).data.pole.grade, 'clear');
});

test('a permanent AI failure hands the inspection to a person', async () => {
  const { InspectionError } = await import('../server/ai/policy.mjs');
  const p = await makePole(inspector, 70);
  aiAnswers.push({ error: new InspectionError('billing_required', 'Credits exhausted', 402) });
  const insId = await inspect(inspector, p);
  const ins = await waitFor(async () => { const i = await getIns(insId); return i.ai_status === 'failed' && i; });
  assert.equal(ins.status, 'needs_review');
  assert.match(ins.ai_error, /Credits/);
});

test('completing a work order does not change the pole grade', async () => {
  const sync = await admin('GET', '/api/sync');
  const wo = sync.data.workOrders[0];
  const before = (await admin('GET', `/api/poles/${wo.pole_id}`)).data.pole.grade;
  assert.equal((await inspector('PUT', `/api/work-orders/${wo.id}`, { status: 'done' })).status, 200);
  assert.equal((await admin('GET', `/api/poles/${wo.pole_id}`)).data.pole.grade, before);
});

test('exports: CSV escapes formulas, GeoJSON has poles and spans, training set is admin-only', async () => {
  await inspector('PUT', `/api/poles/${id()}`, { tag: '=HYPERLINK("x")', line_id: lineId, lat: 46.7, lng: -120.5 });
  const csv = await inspector('GET', '/api/export/poles.csv');
  assert.match(csv.data, /"'=HYPERLINK/);
  const geo = await inspector('GET', '/api/export/grid.geojson');
  const fc = geo.data;
  assert.ok(fc.features.some(f => f.geometry.type === 'LineString'));
  assert.equal((await inspector('GET', '/api/export/training.jsonl')).status, 403);
  const jsonl = await admin('GET', '/api/export/training.jsonl');
  assert.ok(jsonl.data.trim().split('\n').length >= 6);
});

test('static files are served and paths cannot escape the web root', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/vendor/leaflet/leaflet-src.esm.js')).status, 200);
  assert.equal((await fetch(base + '/js/geo.js')).status, 200);
  const res = await new Promise(r => http.get(base + '/..%2f..%2fpackage.json', r));
  assert.equal(res.statusCode, 404);
});

test('a reviewer grading before the AI finishes keeps their grade', async () => {
  const p = await makePole(inspector, 80);
  let release;
  const gate = new Promise(r => { release = r; });
  const original = stub.inspect;
  stub.inspect = async args => { await gate; stub.inspect = original; return original(args); };
  aiAnswers.push({ grade: 'monitor', confidence: 0.99 });
  const insId = await inspect(inspector, p);
  await waitFor(async () => (await getIns(insId)).ai_status === 'running');
  assert.equal((await admin('POST', `/api/inspections/${insId}/review`, { grade: 'high' })).status, 200);
  release();
  const ins = await waitFor(async () => { const i = await getIns(insId); return i.ai_status === 'done' && i; });
  assert.equal(ins.status, 'complete');
  assert.equal(ins.final_grade, 'high');
  assert.equal(ins.final_source, 'human');
  assert.equal(ins.ai_grade, 'monitor');
});

test('photo compass headings are stored, validated and sent to the AI', async () => {
  const p = await makePole(inspector, 90);
  const insId = id(), good = id(), bad = id();
  await inspector('PUT', `/api/inspections/${insId}`, { pole_id: p });
  await inspector('PUT', `/api/photos/${good}?inspection=${insId}&view=top&heading=92`, undefined, { raw: JPEG });
  await inspector('PUT', `/api/photos/${bad}?inspection=${insId}&heading=900`, undefined, { raw: JPEG });
  aiAnswers.push({ grade: 'monitor', confidence: 0.6 });
  await inspector('POST', `/api/inspections/${insId}/submit`, {});
  await waitFor(async () => (await getIns(insId)).ai_status === 'done');
  const photos = (await admin('GET', `/api/inspections/${insId}`)).data.photos;
  assert.equal(photos.find(x => x.id === good).heading, 92);
  assert.equal(photos.find(x => x.id === bad).heading, null);
  assert.equal(aiCalls.at(-1).photos.find(x => x.id === good).heading, 92);
});
