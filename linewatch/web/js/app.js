// App shell: sign-in, navigation, the map and walk-the-line mapping.
import * as store from './store.js';
import * as gps from './gps.js';
import { createMap } from './map.js';
import { $, $$, esc, toast, panel, gradeChip, confirmDialog, timeAgo } from './ui.js';
import { GRADE_INFO, ALL_STATES, STRUCTURES, MATERIALS } from './grades.js';
import { distanceM, nearbyPoles, nextTag, fixQuality, fmtDistance, lineLengthM } from './geo.js';
import { openInspect } from './views/inspect.js';
import { renderReviewQueue, openReview } from './views/review.js';
import { openPole } from './views/pole.js';
import { renderLearning } from './views/learning.js';
import { renderWork } from './views/work.js';
import { renderAdmin } from './views/admin.js';

export const session = { user: null, ai: null, org: { name: 'Linewatch' } };
export const canReview = () => ['admin', 'reviewer'].includes(session.user?.role);
export const isAdmin = () => session.user?.role === 'admin';
let mapView = null;

// ---------- boot ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  await store.loadLocal();
  let s;
  try { s = await store.api('GET', '/api/session'); }
  catch {
    // Offline: carry on with the last signed-in user and cached data.
    const cached = readCachedSession();
    if (cached) { Object.assign(session, cached); return startApp(); }
    return showOffline();
  }
  Object.assign(session, { user: s.user, ai: s.ai, org: s.org });
  if (s.needsSetup) return showSetup();
  if (!s.user) return showLogin();
  cacheSession();
  startApp();
}

const readCachedSession = () => { try { return JSON.parse(localStorage.getItem('lw.session')); } catch { return null; } };
const cacheSession = () => { try { localStorage.setItem('lw.session', JSON.stringify(session)); } catch {} };

function showOffline() {
  $('#app').innerHTML = `<div class="auth"><h1>Linewatch</h1><p>No connection, and this phone has not signed in before. Connect once to sign in; after that the app works offline.</p><button class="btn primary" onclick="location.reload()">Try again</button></div>`;
}

function authScreen(title, intro, fields, submitLabel, onSubmit) {
  $('#app').innerHTML = `<form class="auth"><img src="/icons/icon-192.png" alt="" width="64" height="64"><h1>${esc(title)}</h1><p>${intro}</p>${fields}
    <p class="error" hidden></p><button class="btn primary big">${esc(submitLabel)}</button></form>`;
  const form = $('.auth');
  form.onsubmit = async e => {
    e.preventDefault();
    const err = $('.error', form); err.hidden = true;
    form.querySelector('button').disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(form))); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { form.querySelector('button').disabled = false; }
  };
}

function showSetup() {
  authScreen('Set up Linewatch', 'Create the first administrator account. You can add inspectors and reviewers afterwards.',
    `<label>Company or crew name<input name="orgName" placeholder="Northwest Electric"></label>
     <label>Your name<input name="name" required autocomplete="name"></label>
     <label>Email<input name="email" type="email" required autocomplete="email"></label>
     <label>Password (10+ characters)<input name="password" type="password" minlength="10" required autocomplete="new-password"></label>`,
    'Create account', async v => { await store.api('POST', '/api/setup', v); location.reload(); });
}

function showLogin() {
  authScreen(session.org?.name || 'Linewatch', 'Sign in to inspect and map poles.',
    `<label>Email<input name="email" type="email" required autocomplete="username"></label>
     <label>Password<input name="password" type="password" required autocomplete="current-password"></label>`,
    'Sign in', async v => { await store.api('POST', '/api/login', v); location.reload(); });
}

window.addEventListener('lw:signed-out', () => { if (session.user) { localStorage.removeItem('lw.session'); showLogin(); session.user = null; } });

// ---------- shell ----------
const TABS = [
  { id: 'map', label: 'Map', icon: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15' },
  { id: 'review', label: 'Review', icon: 'M9 3h6v4H9zM9 5H5v16h14V5h-4m-7 9 3 3 5-6', need: canReview },
  { id: 'work', label: 'Work', icon: 'M14 5l5-2-2 5 3 3-4 4-3-3-8 9-3-3 9-8-3-3 4-4z' },
  { id: 'learning', label: 'AI', icon: 'M12 3a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11zM9 21h6', need: canReview },
  { id: 'admin', label: 'More', icon: 'M4 6h16M4 12h16M4 18h16' },
];
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

function startApp() {
  $('#app').innerHTML = `
    <header class="top"><b>${esc(session.org?.name || 'Linewatch')}</b><button class="sync-pill" id="sync-pill"></button></header>
    <main>
      <section id="view-map" class="view"><div id="map"></div><div id="map-ui"></div></section>
      <section id="view-other" class="view scroll" hidden></section>
    </main>
    <nav class="tabs">${TABS.filter(t => !t.need || t.need()).map(t => `<a href="#/${t.id}" data-tab="${t.id}">${svg(t.icon)}<span>${t.label}</span><i class="badge" hidden></i></a>`).join('')}</nav>`;
  mapView = createMapView();
  store.subscribe(onData);
  $('#sync-pill').onclick = showSyncDetails;
  window.addEventListener('hashchange', route);
  store.startAutoSync();
  route();
  onData();
}

function onData() {
  const s = store.state;
  const pill = $('#sync-pill');
  if (pill) {
    const offline = !s.online;
    pill.className = `sync-pill ${offline ? 'offline' : s.pending ? 'pending' : 'ok'}`;
    pill.textContent = offline ? `Offline${s.pending ? ` · ${s.pending} to send` : ''}` : s.pending ? `Sending ${s.pending}…` : s.syncing ? 'Syncing…' : 'Synced';
  }
  const reviewCount = [...s.inspections.values()].filter(i => ['needs_review', 'urgent_review'].includes(i.status)).length;
  const badge = $('[data-tab="review"] .badge');
  if (badge) { badge.hidden = !reviewCount; badge.textContent = reviewCount; }
  mapView?.refresh();
  // Only views built from local data redraw on every sync; the rest fetch from the server when opened.
  if (currentTab === 'work') refreshOther?.();
}

function showSyncDetails() {
  const s = store.state;
  const p = panel(`<div class="sheet-head"><h2>Sync</h2><button class="btn icon" data-close>✕</button></div><div class="pad">
    <p>${s.online ? 'Connected.' : 'No connection. Everything you do is saved on this phone and will send automatically.'}</p>
    <p>${s.pending} change${s.pending === 1 ? '' : 's'} waiting to send. Last synced ${s.lastSync ? timeAgo(s.lastSync) : 'never'}.</p>
    ${s.lastError ? `<p class="muted">Last problem: ${esc(s.lastError)}</p>` : ''}
    ${s.rejected.length ? `<h3>Changes the server refused</h3><ul>${s.rejected.map(r => `<li>${esc(r.what)}: ${esc(r.why)}</li>`).join('')}</ul>` : ''}
    <button class="btn primary" data-sync>Sync now</button></div>`);
  $('[data-sync]', p.el).onclick = () => store.sync().then(() => toast('Synced', 'ok')).catch(e => toast(e.message, 'error'));
}

// ---------- routing ----------
let currentTab = 'map', refreshOther = null;
function route() {
  const [tab = 'map', id] = location.hash.replace(/^#\//, '').split('/');
  currentTab = TABS.some(t => t.id === tab) ? tab : 'map';
  $$('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === currentTab));
  const isMap = currentTab === 'map';
  $('#view-map').hidden = !isMap;
  $('#view-other').hidden = isMap;
  refreshOther = null;
  if (isMap) { mapView.invalidate(); return; }
  const el = $('#view-other');
  el.scrollTop = 0;
  const views = { review: renderReviewQueue, work: renderWork, learning: renderLearning, admin: renderAdmin };
  refreshOther = () => views[currentTab](el, { id });
  refreshOther();
  if (currentTab === 'review' && id) openReview(id);
}

export const go = hash => { location.hash = hash; };
export const showPoleOnMap = id => { go('#/map'); setTimeout(() => mapView.selectPole(id), 50); };
export const startMoveOnMap = id => { go('#/map'); setTimeout(() => mapView.movePole(id), 50); };
export const continueLineFrom = id => { go('#/map'); setTimeout(() => mapView.startWalk({ fromPoleId: id }), 50); };

// ---------- map view ----------
function createMapView() {
  const ui = $('#map-ui');
  let filter = null;          // Set of grades to highlight, or null for all
  let selectedId = null;
  let walk = loadWalk();      // { lineId, prevId, nextTag, structure } while walking
  let mode = null;            // 'pick' while choosing a spot on the map
  let trail = [];
  let lastFix = null;

  const m = createMap($('#map'), {
    onPoleClick: id => {
      if (walk) { walk.prevId = id; saveWalk(); renderUi(); toast(`Next pole connects from ${store.state.poles.get(id)?.tag}`, 'info', 2000); return; }
      selectPole(id);
    },
    onMapClick: ll => {
      if (mode === 'pick') {
        mode = null;
        const pos = { lat: ll.lat, lng: ll.lng, accuracy: null, samples: 0, source: 'map' };
        walk ? placePole(pos, ($('#walk-tag')?.value || walk.nextTag).trim()) : addPoleDialog(pos);
        renderUi();
        return;
      }
      if (selectedId) { selectedId = null; m.select(null); renderUi(); }
    },
  });

  gps.onFix(fix => {
    if (!fix) { renderMeter(); return; }
    lastFix = fix;
    m.setMe(fix);
    if (walk && fix.accuracy <= 20 && (!trail.length || distanceM(trail.at(-1), fix) > 2)) {
      trail.push({ lat: fix.lat, lng: fix.lng });
      if (trail.length > 5000) trail.shift();
      m.setTrail(trail);
    }
    renderMeter();
  });
  gps.start();

  function data() {
    return { poles: store.livePoles(), spans: store.liveSpans(), lines: store.state.lines, filter };
  }
  function refresh() { m.render(data()); renderUi(); }

  function selectPole(id) {
    selectedId = id;
    m.select(id);
    renderUi();
  }

  // ---------- overlay UI ----------
  function renderUi() {
    const poles = store.livePoles();
    const counts = Object.fromEntries(ALL_STATES.map(g => [g, 0]));
    for (const p of poles) counts[p.grade] = (counts[p.grade] || 0) + 1;
    const chips = ['critical', 'high', 'monitor', 'clear', 'inconclusive', 'unreviewed'].map(g =>
      `<button class="fchip ${filter?.has(g) ? 'on' : ''}" data-filter="${g}" style="--c:${GRADE_INFO[g].color}"><i></i>${esc(GRADE_INFO[g].short)} <b>${counts[g] || 0}</b></button>`).join('');
    ui.dataset.ready || (ui.innerHTML = '<div class="map-top"></div><div class="map-tools"></div><div class="map-bottom"></div>', ui.dataset.ready = '1');
    // Only replace a part whose content changed, so a background sync never
    // wipes out a tag someone is in the middle of typing.
    patch('.map-top', `<div class="filters">${chips}</div>`);
    patch('.map-tools', `
        <button class="tool" data-act="basemap" title="Street or satellite">${m.basemap() === 'satellite' ? 'Street' : 'Satellite'}</button>
        <button class="tool" data-act="locate" title="Follow my location">◎</button>
        <button class="tool" data-act="fit" title="Show all poles">⤢</button>`);
    patch('.map-bottom', mode === 'pick' ? pickHint() : walk ? walkPanel() : selectedId ? poleSheet() : idlePanel());
    renderMeter();
  }

  function patch(sel, html) {
    const el = ui.querySelector(sel);
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  }

  const pickHint = () => `<div class="card hint"><p>Tap the map where the pole stands. Satellite view helps.</p><button class="btn" data-act="cancel-pick">Cancel</button></div>`;

  function idlePanel() {
    const poles = store.livePoles();
    return `<div class="card">
      <div class="gps-meter" id="gps-meter"></div>
      <div class="row">
        <button class="btn primary big grow" data-act="walk">Walk a line</button>
        <button class="btn big grow" data-act="add">Mark pole on map</button>
      </div>
      ${poles.length ? '' : '<p class="muted small">Walk a line to map poles as you go: stand at each pole, tap Mark pole on map, and Linewatch draws the line.</p>'}
    </div>`;
  }

  function poleSheet() {
    const p = store.state.poles.get(selectedId);
    if (!p) return idlePanel();
    const line = store.state.lines.get(p.line_id);
    const latest = store.inspectionsFor(p.id)[0];
    const spans = store.liveSpans().filter(s => s.from_pole === p.id || s.to_pole === p.id);
    return `<div class="card sheet">
      <div class="row between"><h2>${esc(p.tag)}</h2>${gradeChip(p.grade, p.grade_source === 'ai' ? 'AI' : '')}</div>
      <p class="muted">${esc(line?.name || 'No line')} · ${esc(STRUCTURES.find(s => s.id === p.structure)?.label || p.structure)} · ${esc(p.material)}
        · ${p.accuracy_m != null ? `±${p.accuracy_m} m` : esc(p.location_source)} · ${spans.length} span${spans.length === 1 ? '' : 's'}</p>
      ${p.open_critical ? '<p class="alert">Unresolved Critical on record</p>' : ''}
      ${latest ? `<p class="small">Last inspection ${timeAgo(latest.submitted_at || latest.created_at)} · ${esc(statusText(latest))}</p>` : '<p class="small muted">Not inspected yet.</p>'}
      <div class="row">
        <button class="btn primary grow" data-act="inspect">Inspect · photos</button>
        <button class="btn grow" data-act="details">Details</button>
      </div>
      <div class="row">
        <button class="btn grow" data-act="continue">Continue line from here</button>
      </div>
    </div>`;
  }

  function walkPanel() {
    const prev = store.state.poles.get(walk.prevId);
    const line = store.state.lines.get(walk.lineId);
    const lineSpans = store.liveSpans().filter(s => s.line_id === walk.lineId);
    const lineLen = lineLengthM(lineSpans, store.state.poles);
    const poleCount = store.livePoles().filter(p => p.line_id === walk.lineId).length;
    const lines = [...store.state.lines.values()].sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="card walk">
      <div class="row between"><h2>Walking ${esc(line?.name || '')}</h2><button class="btn small" data-act="end-walk">End</button></div>
      <p class="small muted">${poleCount} poles · ${fmtDistance(lineLen)} mapped</p>
      <div class="gps-meter" id="gps-meter"></div>
      <div class="walk-tag"><label>Next pole tag<input id="walk-tag" value="${esc(walk.nextTag)}" autocomplete="off" autocapitalize="characters"></label></div>
      <p class="small muted" id="walk-dist"></p>
      <button class="btn primary huge" data-act="drop">Mark pole on map</button>
      <div class="row">
        ${prev ? `<button class="btn grow" data-act="inspect-prev">Photos of ${esc(prev.tag)}</button>` : ''}
        <button class="btn grow" data-act="pick">Tap the map instead</button>
      </div>
      <details ${walk.open ? 'open' : ''} data-walk-options><summary class="small">Type ${esc(STRUCTURES.find(s => s.id === walk.structure)?.label || '')} · connects from ${esc(prev?.tag || 'nothing')}</summary>
      <div class="grid2">
        <label>Type<select id="walk-structure">${STRUCTURES.map(s => `<option value="${s.id}" ${s.id === walk.structure ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
        <label>Connects from<select id="walk-prev"><option value="">Start of a new run</option>${prev ? `<option value="${prev.id}" selected>${esc(prev.tag)}</option>` : ''}</select></label>
        <label>Line<select id="walk-line">${lines.map(l => `<option value="${l.id}" ${l.id === walk.lineId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}<option value="__new">New line…</option></select></label>
      </div></details>
      <p class="small muted">Tap any pole on the map to branch the line from it.</p>
    </div>`;
  }

  function renderMeter() {
    const el = $('#gps-meter');
    if (!el) return;
    const err = gps.lastError();
    const fix = gps.current();
    const fresh = fix && Date.now() - fix.time < 15000;
    const q = fresh ? fixQuality(fix.accuracy) : 'none';
    el.className = `gps-meter q-${q}`;
    el.innerHTML = `<i></i><span>${fresh ? `GPS ±${fix.accuracy < 10 ? fix.accuracy.toFixed(1) : Math.round(fix.accuracy)} m · ${q}` : esc(err || 'Finding GPS…')}</span>`;
    const dist = $('#walk-dist');
    const prev = walk && store.state.poles.get(walk.prevId);
    if (dist) dist.textContent = prev && fresh ? `${fmtDistance(distanceM(prev, fix))} from ${prev.tag}` : '';
  }

  ui.addEventListener('click', async e => {
    const f = e.target.closest('[data-filter]');
    if (f) {
      const g = f.dataset.filter;
      filter = new Set(filter || []);
      filter.has(g) ? filter.delete(g) : filter.add(g);
      if (!filter.size) filter = null;
      return refresh();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const pole = store.state.poles.get(selectedId);
    switch (act) {
      case 'basemap': m.setBasemap(m.basemap() === 'satellite' ? 'street' : 'satellite'); renderUi(); break;
      case 'locate': if (lastFix) m.followMe(true, lastFix); else toast(gps.lastError() || 'Waiting for GPS…'); break;
      case 'fit': m.fitAll(); break;
      case 'walk': startWalk({}); break;
      case 'add': addPoleHere(); break;
      case 'cancel-pick': mode = null; renderUi(); break;
      case 'pick': mode = 'pick'; renderUi(); break;
      case 'inspect': openInspect(pole.id); break;
      case 'details': openPole(pole.id); break;
      case 'continue': startWalk({ fromPoleId: pole.id }); break;
      case 'end-walk': {
        const lineId = walk.lineId;
        walk = null; saveWalk(); trail = []; m.setTrail([]); renderUi();
        m.fitTo(store.livePoles().filter(p => p.line_id === lineId));
        break;
      }
      case 'drop': dropPole(); break;
      case 'inspect-prev': openInspect(walk.prevId); break;
    }
  });

  ui.addEventListener('toggle', e => { if (walk && e.target.matches('[data-walk-options]')) { walk.open = e.target.open; saveWalk(); } }, true);

  ui.addEventListener('change', async e => {
    if (!walk) return;
    if (e.target.id === 'walk-tag') walk.nextTag = e.target.value.trim();
    if (e.target.id === 'walk-structure') walk.structure = e.target.value;
    if (e.target.id === 'walk-prev') walk.prevId = e.target.value || null;
    if (e.target.id === 'walk-line') {
      if (e.target.value === '__new') { const l = await newLineDialog(); if (l) walk.lineId = l.id; }
      else walk.lineId = e.target.value;
      renderUi();
    }
    saveWalk();
  });

  // ---------- walking ----------
  async function startWalk({ fromPoleId }) {
    const from = fromPoleId && store.state.poles.get(fromPoleId);
    let lineId = from?.line_id;
    if (!lineId) {
      const lines = [...store.state.lines.values()];
      lineId = lines.length === 1 ? lines[0].id : (await chooseLineDialog())?.id;
      if (!lineId) return;
    }
    const line = store.state.lines.get(lineId);
    const lineTags = store.livePoles().filter(p => p.line_id === lineId).map(p => p.tag);
    const seed = from?.tag || lineTags.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
    // Picking a line back up: connect from the nearest pole on it, if one is close.
    const fix = gps.current();
    const nearest = !from && fix ? nearbyPoles(store.livePoles().filter(p => p.line_id === lineId), fix, 150)[0]?.pole : null;
    walk = { lineId, prevId: from?.id || nearest?.id || null, nextTag: seed ? nextTag(seed) : `${line?.tag_prefix || ''}1`, structure: 'tangent' };
    saveWalk();
    selectedId = null; m.select(null);
    gps.start();
    if (lastFix) m.followMe(true, lastFix);
    renderUi();
  }

  async function dropPole() {
    const tag = ($('#walk-tag')?.value || walk.nextTag).trim();
    if (!tag) return toast('Enter the pole tag first.', 'error');
    const pos = await lockDialog();
    if (!pos) return;
    await placePole(pos, tag);
  }

  async function placePole(pos, tag) {
    // Same pole twice? Phones are accurate to a few metres; poles are tens of metres apart.
    const near = nearbyPoles(store.livePoles(), pos, Math.max(4, Math.min(10, (pos.accuracy || 4) * 1.5)))[0];
    if (near && near.pole.id !== walk.prevId) {
      const reuse = await confirmDialog(`Pole ${near.pole.tag} is already mapped ${fmtDistance(near.distance)} from here. Connect the line to ${near.pole.tag} instead of adding a new pole?`, { ok: `Use ${near.pole.tag}` });
      if (reuse) {
        if (walk.prevId) store.saveSpan({ from_pole: walk.prevId, to_pole: near.pole.id, line_id: walk.lineId });
        walk.prevId = near.pole.id; saveWalk(); refresh();
        return;
      }
    }
    if (store.livePoles().some(p => p.tag === tag && p.line_id === walk.lineId) && !(await confirmDialog(`Tag ${tag} is already used on this line. Add another pole with the same tag?`, { ok: 'Add anyway' }))) return;
    const prev = store.state.poles.get(walk.prevId);
    const pole = store.savePole({ tag, line_id: walk.lineId, lat: pos.lat, lng: pos.lng, accuracy_m: pos.accuracy, gps_samples: pos.samples, location_source: pos.source || 'gps', structure: walk.structure, material: 'wood' });
    let msg = `Pole ${tag} added`;
    if (prev) { store.saveSpan({ from_pole: prev.id, to_pole: pole.id, line_id: walk.lineId }); msg += ` · ${fmtDistance(distanceM(prev, pole))} span`; }
    walk.prevId = pole.id;
    walk.nextTag = nextTag(tag);
    walk.structure = 'tangent';
    saveWalk();
    refresh();
    navigator.vibrate?.(60);
    toast(`${msg}${pos.accuracy ? ` · ±${pos.accuracy} m` : ''}`, 'ok');
  }

  // Stand at the pole, gather fixes, show progress, return the averaged position.
  function lockDialog() {
    return new Promise(resolve => {
      let result = null;
      const p = panel(`<div class="dialog lock"><h2>Locking position</h2>
        <p class="small">Stand against the pole and hold still.</p>
        <div class="lock-ring"><b data-acc>–</b><span>metres</span></div>
        <p class="small" data-samples>Waiting for GPS…</p>
        <div class="row"><button class="btn grow" data-close>Cancel</button><button class="btn primary grow" data-now disabled>Use now</button></div></div>`,
        { className: 'small', onClose: () => { ctl.cancel(); resolve(result); } });
      const ctl = gps.lockPosition({
        targetAccuracy: 3, minSamples: 5, maxSeconds: 20,
        onProgress: ({ estimate, samples, elapsed }) => {
          if (!estimate) return;
          $('[data-acc]', p.el).textContent = `±${estimate.accuracy}`;
          $('[data-acc]', p.el).parentElement.className = `lock-ring q-${fixQuality(estimate.accuracy)}`;
          $('[data-samples]', p.el).textContent = `${samples} fix${samples === 1 ? '' : 'es'} averaged · ${Math.round(elapsed)} s`;
          $('[data-now]', p.el).disabled = false;
        },
      });
      $('[data-now]', p.el).onclick = () => ctl.useNow();
      ctl.promise.then(est => {
        if (!est) return;
        result = { ...est, source: 'gps' };
        p.close();
      });
    });
  }

  async function addPoleHere() {
    const pos = await lockDialog();
    if (pos) addPoleDialog(pos);
  }

  function addPoleDialog(pos) {
    const lines = [...store.state.lines.values()];
    const near = nearbyPoles(store.livePoles(), pos, 150);
    const p = panel(`<form class="dialog"><h2>New pole</h2>
      <p class="small muted">${pos.accuracy ? `GPS ±${pos.accuracy} m from ${pos.samples} fixes` : 'Placed on the map'}</p>
      <label>Tag or number<input name="tag" required autocomplete="off" autocapitalize="characters" value="${esc(near[0] ? nextTag(near[0].pole.tag) : '')}"></label>
      <label>Line<select name="line_id">${lines.map(l => `<option value="${l.id}" ${near[0]?.pole.line_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}<option value="__new">New line…</option></select></label>
      <div class="grid2"><label>Type<select name="structure">${STRUCTURES.map(s => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select></label>
      <label>Material<select name="material">${MATERIALS.map(x => `<option>${x}</option>`).join('')}</select></label></div>
      <label>Connect to<select name="connect"><option value="">Nothing</option>${near.slice(0, 8).map(n => `<option value="${n.pole.id}">${esc(n.pole.tag)} · ${fmtDistance(n.distance)}</option>`).join('')}</select></label>
      <div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save pole</button></div></form>`, { className: 'small' });
    const form = $('form', p.el);
    form.line_id.onchange = async () => { if (form.line_id.value === '__new') { const l = await newLineDialog(); if (l) { form.line_id.insertAdjacentHTML('afterbegin', `<option value="${l.id}">${esc(l.name)}</option>`); form.line_id.value = l.id; } } };
    form.onsubmit = async e => {
      e.preventDefault();
      let lineId = form.line_id.value;
      if (lineId === '__new' || !lineId) { const l = await newLineDialog(); if (!l) return; lineId = l.id; }
      const pole = store.savePole({ tag: form.tag.value.trim(), line_id: lineId, lat: pos.lat, lng: pos.lng, accuracy_m: pos.accuracy, gps_samples: pos.samples, location_source: pos.source || 'gps', structure: form.structure.value, material: form.material.value });
      if (form.connect.value) store.saveSpan({ from_pole: form.connect.value, to_pole: pole.id, line_id: lineId });
      p.close();
      toast(`Pole ${pole.tag} added`, 'ok');
      setTimeout(() => selectPole(pole.id), 100);
    };
  }

  async function movePole(id) {
    const pole = store.state.poles.get(id);
    if (!pole) return;
    selectedId = null; renderUi();
    // Held outside patch() so a background sync does not replace it mid-drag.
    ui.querySelector('.map-bottom').innerHTML = `<div class="card"><p>Drag the blue handle onto the pole in the satellite view.</p>
      <div class="row"><button class="btn grow" data-move="cancel">Cancel</button><button class="btn primary grow" data-move="save">Save position</button></div></div>`;
    m.setBasemap('satellite');
    const wait = m.startDrag(pole);
    ui.querySelector('[data-move="save"]').onclick = () => m.finishDrag(true);
    ui.querySelector('[data-move="cancel"]').onclick = () => m.finishDrag(false);
    const pos = await wait;
    ui.querySelector('.map-bottom')._html = null;
    if (pos) {
      store.savePole({ ...pole, lat: pos.lat, lng: pos.lng, accuracy_m: null, gps_samples: 0, location_source: 'map' });
      toast(`${pole.tag} moved ${fmtDistance(distanceM(pole, pos))}`, 'ok');
    }
    selectPole(id);
  }

  function saveWalk() { try { walk ? localStorage.setItem('lw.walk', JSON.stringify(walk)) : localStorage.removeItem('lw.walk'); } catch {} }
  function loadWalk() { try { return JSON.parse(localStorage.getItem('lw.walk')); } catch { return null; } }

  refresh();
  return { refresh, selectPole, movePole, startWalk, invalidate: () => setTimeout(() => m.invalidate(), 0) };
}

export function chooseLineDialog() {
  const lines = [...store.state.lines.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!lines.length) return newLineDialog();
  return new Promise(resolve => {
    let picked = null;
    const p = panel(`<div class="dialog"><h2>Which line?</h2><div class="list">${lines.map(l => `<button class="list-item" data-line="${l.id}"><i class="swatch" style="background:${esc(l.color)}"></i>${esc(l.name)}<small>${esc(l.voltage)}</small></button>`).join('')}</div>
      <div class="row"><button class="btn grow" data-close>Cancel</button><button class="btn primary grow" data-new>New line</button></div></div>`, { className: 'small', onClose: () => resolve(picked) });
    p.el.addEventListener('click', async e => {
      const id = e.target.closest('[data-line]')?.dataset.line;
      if (id) { picked = store.state.lines.get(id); p.close(); }
      if (e.target.closest('[data-new]')) { p.close(); setTimeout(async () => resolve(await newLineDialog()), 50); picked = undefined; }
    });
  }).then(x => x || null);
}

const LINE_COLORS = ['#2f6fde', '#e8590c', '#0ca678', '#ae3ec9', '#f59f00', '#1098ad', '#d6336c', '#5c940d'];
export function newLineDialog() {
  return new Promise(resolve => {
    let made = null;
    const color = LINE_COLORS[store.state.lines.size % LINE_COLORS.length];
    const p = panel(`<form class="dialog"><h2>New line</h2>
      <label>Name<input name="name" required placeholder="Feeder 12 · Cedar Creek"></label>
      <div class="grid2"><label>Kind<select name="kind"><option value="distribution">Distribution</option><option value="transmission">Transmission</option><option value="secondary">Secondary</option></select></label>
      <label>Voltage<input name="voltage" placeholder="12.47 kV"></label></div>
      <div class="grid2"><label>Tag prefix<input name="tag_prefix" placeholder="NW-" autocapitalize="characters"></label>
      <label>Colour<input name="color" type="color" value="${color}"></label></div>
      <div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create line</button></div></form>`, { className: 'small', onClose: () => resolve(made) });
    const form = $('form', p.el);
    form.name.focus();
    form.onsubmit = e => {
      e.preventDefault();
      made = store.saveLine(Object.fromEntries(new FormData(form)));
      p.close();
    };
  });
}

export function statusText(i) {
  if (i.status === 'complete') return `${GRADE_INFO[i.final_grade]?.label || ''}${i.final_source === 'ai' ? ' (AI, trusted)' : ' (reviewed)'}`;
  if (i.status === 'urgent_review') return 'Critical: awaiting reviewer';
  if (i.status === 'needs_review') return i.ai_grade ? `AI says ${GRADE_INFO[i.ai_grade]?.label}; awaiting reviewer` : 'Awaiting reviewer';
  if (i.ai_status === 'queued' || i.ai_status === 'running') return session.ai ? 'AI is inspecting' : 'Awaiting reviewer';
  return i.status;
}

boot();
