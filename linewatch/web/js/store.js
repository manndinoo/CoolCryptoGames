// Offline-first data store.
//
// The phone keeps a full copy of the grid (lines, poles, spans, inspections,
// work orders) in IndexedDB, so the map works with no signal. Every change is
// applied locally first and queued in an outbox; the outbox replays to the
// server in order when there is a connection. All ids are generated on the
// phone, so replaying an operation twice is harmless.

const DB_NAME = 'linewatch-v2';
let dbp;
function idb() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('kv');
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function op(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const kvGet = k => op('kv', 'readonly', s => s.get(k));
const kvSet = (k, v) => op('kv', 'readwrite', s => s.put(v, k));
export const blobGet = k => op('blobs', 'readonly', s => s.get(k));
export const blobSet = (k, v) => op('blobs', 'readwrite', s => s.put(v, k));
export const blobDel = k => op('blobs', 'readwrite', s => s.delete(k));

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));

// ---------- in-memory state ----------
export const state = {
  lines: new Map(), poles: new Map(), spans: new Map(), inspections: new Map(), workOrders: new Map(), photos: new Map(),
  lastSync: null, pending: 0, online: navigator.onLine, syncing: false, lastError: '', rejected: [],
};
const COLLECTIONS = ['lines', 'poles', 'spans', 'inspections', 'workOrders', 'photos'];
const listeners = new Set();
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
let emitQueued = false;
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; for (const fn of listeners) fn(state); });
}

let saveTimer;
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const snap = { lastSync: state.lastSync };
    for (const c of COLLECTIONS) snap[c] = [...state[c].values()];
    kvSet('snapshot', snap).catch(() => {});
  }, 300);
}

export async function loadLocal() {
  const snap = await kvGet('snapshot').catch(() => null);
  if (snap) {
    for (const c of COLLECTIONS) state[c] = new Map((snap[c] || []).map(r => [r.id, r]));
    state.lastSync = snap.lastSync;
  }
  state.pending = await op('outbox', 'readonly', s => s.count());
  emit();
}

export async function clearLocal() {
  const db = await idb();
  db.close(); dbp = null;
  await new Promise(r => { const req = indexedDB.deleteDatabase(DB_NAME); req.onsuccess = req.onerror = req.onblocked = r; });
  for (const c of COLLECTIONS) state[c].clear();
  state.lastSync = null; state.pending = 0;
  emit();
}

// ---------- server calls ----------
export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }

export async function api(method, url, body, { raw, contentType } = {}) {
  const headers = { 'X-Linewatch': '1' };
  let payload;
  if (raw) { payload = raw; headers['Content-Type'] = contentType; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' }); }
  catch { throw new ApiError(0, 'No connection.'); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`);
  return data;
}

// ---------- outbox ----------
async function enqueue(entry, blob) {
  if (blob) await blobSet(entry.blobKey, blob);
  await op('outbox', 'readwrite', s => s.add({ ...entry, queuedAt: new Date().toISOString() }));
  state.pending++;
  emit();
  flushSoon();
}

let flushTimer;
const flushSoon = (ms = 50) => { clearTimeout(flushTimer); flushTimer = setTimeout(() => sync().catch(() => {}), ms); };

async function flushOutbox() {
  for (;;) {
    const entry = await firstOutbox();
    if (!entry) return;
    try {
      if (entry.blobKey) {
        const blob = await blobGet(entry.blobKey);
        if (blob) await api(entry.method, entry.url, undefined, { raw: blob, contentType: blob.type || 'image/jpeg' });
      } else {
        const res = await api(entry.method, entry.url, entry.body);
        if (entry.after === 'pole' && res.pole) mergeOne('poles', { ...res.pole, equipment: res.pole.equipment ? safeJson(res.pole.equipment) : {} });
      }
    } catch (err) {
      if (err.status === 0 || err.status === 401 || err.status === 429 || err.status >= 500) throw err; // try again later
      // The server refused this change permanently. Keep a record so the user
      // knows, and move on so one bad change cannot block the rest.
      state.rejected.unshift({ at: new Date().toISOString(), what: entry.label || `${entry.method} ${entry.url}`, why: err.message });
    }
    await op('outbox', 'readwrite', s => s.delete(entry.seq));
    if (entry.blobKey && entry.releaseBlob) await blobDel(entry.blobKey);
    state.pending = Math.max(0, state.pending - 1);
    emit();
  }
}
async function firstOutbox() {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('outbox').objectStore('outbox').openCursor();
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}
const safeJson = v => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : v);

// ---------- sync ----------
let syncPromise = null;
export function sync() {
  syncPromise ??= (async () => {
    state.syncing = true; emit();
    try {
      await flushOutbox();
      // Everything local has reached the server, so the server copy is now authoritative.
      for (const c of COLLECTIONS) for (const r of state[c].values()) delete r._local;
      const data = await api('GET', `/api/sync${state.lastSync ? `?since=${encodeURIComponent(state.lastSync)}` : ''}`);
      for (const c of COLLECTIONS) for (const r of data[c] || []) mergeOne(c, r);
      state.lastSync = data.now;
      state.lastError = '';
      state.online = true;
      persistSoon();
    } catch (err) {
      state.lastError = err.message;
      if (err.status === 0) state.online = false;
      if (err.status === 401) window.dispatchEvent(new CustomEvent('lw:signed-out'));
      throw err;
    } finally {
      state.syncing = false; syncPromise = null; emit();
    }
  })();
  return syncPromise;
}

function mergeOne(c, r) {
  const map = state[c];
  const cur = map.get(r.id);
  // Keep a local edit that has not reached the server yet.
  if (cur?._local && cur.updated_at > (r.updated_at || '')) return;
  map.set(r.id, r);
  emit();
}

function localPut(c, r) {
  state[c].set(r.id, { ...state[c].get(r.id), ...r, _local: true, updated_at: new Date().toISOString() });
  persistSoon();
  emit();
}

export function startAutoSync() {
  window.addEventListener('online', () => { state.online = true; flushSoon(0); });
  window.addEventListener('offline', () => { state.online = false; emit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushSoon(0); });
  setInterval(() => { if (!document.hidden) sync().catch(() => {}); }, 20000);
  return sync().catch(() => {});
}

// ---------- mutations (local first, then queued) ----------
export function saveLine(line) {
  const l = { id: line.id || uid(), color: '#2f6fde', kind: 'distribution', voltage: '', tag_prefix: '', notes: '', ...line };
  localPut('lines', l);
  enqueue({ method: 'PUT', url: `/api/lines/${l.id}`, body: l, label: `Line ${l.name}` });
  return l;
}

export function savePole(pole) {
  const p = { id: pole.id || uid(), grade: 'unreviewed', structure: 'tangent', material: 'wood', equipment: {}, notes: '', deleted: 0, open_critical: 0, ...pole };
  localPut('poles', p);
  enqueue({ method: 'PUT', url: `/api/poles/${p.id}`, body: p, label: `Pole ${p.tag}`, after: 'pole' });
  return p;
}

export function deletePole(id) {
  localPut('poles', { id, deleted: 1 });
  for (const s of state.spans.values()) if (s.from_pole === id || s.to_pole === id) localPut('spans', { id: s.id, deleted: 1 });
  enqueue({ method: 'DELETE', url: `/api/poles/${id}`, label: 'Delete pole' });
}

export function saveSpan(span) {
  const dup = [...state.spans.values()].find(s => !s.deleted && ((s.from_pole === span.from_pole && s.to_pole === span.to_pole) || (s.from_pole === span.to_pole && s.to_pole === span.from_pole)));
  if (dup) return dup;
  const s = { id: span.id || uid(), conductor: 'primary', deleted: 0, ...span };
  localPut('spans', s);
  enqueue({ method: 'PUT', url: `/api/spans/${s.id}`, body: s, label: 'Span' });
  return s;
}

export function deleteSpan(id) {
  localPut('spans', { id, deleted: 1 });
  enqueue({ method: 'DELETE', url: `/api/spans/${id}`, label: 'Delete span' });
}

export function saveWorkOrder(wo) {
  const w = { id: wo.id || uid(), status: 'open', ...wo };
  localPut('workOrders', w);
  enqueue({ method: 'PUT', url: `/api/work-orders/${w.id}`, body: w, label: `Work order ${w.title}` });
  return w;
}

// An inspection is created as a draft, its photos are uploaded, then it is
// submitted. All three steps queue in order, so it works fully offline.
export async function submitInspection({ id = uid(), poleId, notes, checklist, photos }) {
  const t = new Date().toISOString();
  localPut('inspections', { id, pole_id: poleId, notes, checklist, status: 'submitted', ai_status: 'queued', submitted_at: t, created_at: t });
  await enqueue({ method: 'PUT', url: `/api/inspections/${id}`, body: { pole_id: poleId, notes, checklist }, label: 'Inspection' });
  for (const p of photos) {
    const q = new URLSearchParams({ inspection: id, view: p.view || '', taken: p.takenAt || t });
    if (p.heading != null) q.set('heading', p.heading);
    state.photos.set(p.id, { id: p.id, inspection_id: id, pole_id: poleId, view: p.view, heading: p.heading ?? null, taken_at: p.takenAt, _local: true });
    await enqueue({ method: 'PUT', url: `/api/photos/${p.id}?${q}`, blobKey: p.id, label: 'Photo', releaseBlob: true }, p.blob);
  }
  await enqueue({ method: 'POST', url: `/api/inspections/${id}/submit`, body: {}, label: 'Submit inspection' });
  persistSoon();
  return id;
}

// Photo URL: the local copy while it is still waiting to upload.
const objectUrls = new Map();
export async function photoUrl(id) {
  if (objectUrls.has(id)) return objectUrls.get(id);
  const blob = await blobGet(id).catch(() => null);
  if (blob) { const u = URL.createObjectURL(blob); objectUrls.set(id, u); return u; }
  return `/api/photos/${id}`;
}

// Derived helpers.
export const livePoles = () => [...state.poles.values()].filter(p => !p.deleted);
export const liveSpans = () => [...state.spans.values()].filter(s => !s.deleted && state.poles.get(s.from_pole) && state.poles.get(s.to_pole) && !state.poles.get(s.from_pole).deleted && !state.poles.get(s.to_pole).deleted);
export const inspectionsFor = poleId => [...state.inspections.values()].filter(i => i.pole_id === poleId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
