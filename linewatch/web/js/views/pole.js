// Pole record: details, location, connections, inspection history, photos.
import * as store from '../store.js';
import * as gps from '../gps.js';
import { $, esc, toast, panel, gradeChip, confirmDialog, timeAgo, viewPhotos } from '../ui.js';
import { GRADE_INFO, STRUCTURES, MATERIALS } from '../grades.js';
import { distanceM, fmtDistance } from '../geo.js';
import { openInspect } from './inspect.js';
import { openReview } from './review.js';
import { startMoveOnMap, continueLineFrom, statusText, newLineDialog, canReview } from '../app.js';

const EQUIPMENT_FIELDS = [
  ['voltage', 'Voltage (L-L / L-N)'], ['phases', 'Phase configuration'], ['primary', 'Primary conductor'], ['neutral', 'Neutral'],
  ['secondary', 'Secondary / services'], ['pole_class', 'Pole class & height'], ['framing', 'Framing'], ['guys', 'Guys & anchors'],
  ['transformers', 'Transformers / banks'], ['protection', 'Fuses, cutouts, arresters'], ['grounding', 'Grounding'], ['attachments', 'Comm / foreign attachments'],
  ['access', 'Access notes'], ['year', 'Install year / birthmark'],
];

export async function openPole(id) {
  let detail = null;
  try { detail = await store.api('GET', `/api/poles/${id}`); } catch { /* offline: local copy below */ }
  const pole = detail?.pole || store.state.poles.get(id);
  if (!pole) return toast('Pole not found.', 'error');
  const inspections = detail?.inspections || store.inspectionsFor(id);
  const photos = detail?.photos || [...store.state.photos.values()].filter(p => p.pole_id === id);
  const workOrders = detail?.workOrders || [...store.state.workOrders.values()].filter(w => w.pole_id === id);
  const spans = store.liveSpans().filter(s => s.from_pole === id || s.to_pole === id);
  const lines = [...store.state.lines.values()];
  const eq = pole.equipment || {};
  const urls = await Promise.all(photos.map(ph => store.photoUrl(ph.id)));

  const p = panel(`
    <div class="sheet-head"><div><h2>${esc(pole.tag)}</h2><p class="small muted">${esc(store.state.lines.get(pole.line_id)?.name || 'No line')}</p></div><button class="btn icon" data-close aria-label="Close">✕</button></div>
    <div class="pad pole-detail">
      <div class="row between">${gradeChip(pole.grade, pole.grade_source === 'ai' ? 'from trusted AI' : pole.grade_source === 'human' ? 'reviewed' : '')}<span class="small muted">${pole.graded_at ? timeAgo(pole.graded_at) : ''}</span></div>
      <p class="small">${esc(GRADE_INFO[pole.grade]?.response || '')}</p>
      ${pole.open_critical ? '<p class="alert">Unresolved Critical. Stays Critical until a reviewer marks it resolved.</p>' : ''}
      <div class="row wrap">
        <button class="btn primary grow" data-inspect>Inspect · photos</button>
        <button class="btn grow" data-continue>Continue line</button>
      </div>

      <h3>Location</h3>
      <p class="small">${pole.lat.toFixed(7)}, ${pole.lng.toFixed(7)} · ${pole.accuracy_m != null ? `±${pole.accuracy_m} m from ${pole.gps_samples} GPS fixes` : pole.location_source === 'map' ? 'placed on the map' : esc(pole.location_source)}</p>
      <div class="row wrap"><button class="btn grow" data-move>Move pin on map</button><button class="btn grow" data-relock>Re-lock with GPS</button>
        <a class="btn grow" href="https://www.google.com/maps/dir/?api=1&destination=${pole.lat},${pole.lng}" target="_blank" rel="noopener">Directions</a></div>

      <h3>Connections</h3>
      ${spans.length ? `<ul class="plain">${spans.map(s => { const other = store.state.poles.get(s.from_pole === id ? s.to_pole : s.from_pole); return `<li class="row between"><span>${s.from_pole === id ? '→' : '←'} ${esc(other?.tag)} · ${fmtDistance(other ? distanceM(pole, other) : null)} · ${esc(s.conductor)}</span><button class="btn small" data-unspan="${s.id}">Remove</button></li>`; }).join('')}</ul>` : '<p class="muted small">Not connected to any pole.</p>'}
      <div class="row"><select data-connect class="grow"><option value="">Connect to a nearby pole…</option>${store.livePoles().filter(o => o.id !== id && !spans.some(s => s.from_pole === o.id || s.to_pole === o.id)).map(o => ({ o, d: distanceM(pole, o) })).sort((a, b) => a.d - b.d).slice(0, 15).map(({ o, d }) => `<option value="${o.id}">${esc(o.tag)} · ${fmtDistance(d)}</option>`).join('')}</select></div>

      <h3>Inspections</h3>
      ${inspections.length ? `<ul class="plain">${inspections.map(i => `<li><button class="list-item" data-insp="${i.id}"><span>${new Date(i.submitted_at || i.created_at).toLocaleDateString()} · ${esc(statusText(i))}</span>${i.final_grade ? gradeChip(i.final_grade) : i.ai_grade ? gradeChip(i.ai_grade, 'AI') : ''}</button></li>`).join('')}</ul>` : '<p class="muted small">No inspections yet.</p>'}

      ${photos.length ? `<h3>Photos (${photos.length})</h3><div class="gallery small">${urls.map((u, i) => `<button data-photo="${i}"><img src="${u}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}

      ${workOrders.length ? `<h3>Work orders</h3><ul class="plain">${workOrders.map(w => `<li class="row between"><span>${esc(w.title)}</span><span class="chip">${esc(w.status)}</span></li>`).join('')}</ul>` : ''}

      <h3>Details</h3>
      <form class="pole-form">
        <div class="grid2">
          <label>Tag<input name="tag" value="${esc(pole.tag)}" required></label>
          <label>Line<select name="line_id">${lines.map(l => `<option value="${l.id}" ${l.id === pole.line_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}<option value="__new">New line…</option></select></label>
          <label>Structure<select name="structure">${STRUCTURES.map(s => `<option value="${s.id}" ${s.id === pole.structure ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
          <label>Material<select name="material">${MATERIALS.map(m => `<option ${m === pole.material ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        </div>
        <details><summary>Equipment & crew prep</summary><div class="grid2">
          ${EQUIPMENT_FIELDS.map(([k, label]) => `<label>${esc(label)}<input name="eq_${k}" value="${esc(eq[k] || '')}"></label>`).join('')}
        </div></details>
        <label>Notes<textarea name="notes" rows="3">${esc(pole.notes || '')}</textarea></label>
        <div class="row"><button class="btn primary grow">Save details</button></div>
      </form>

      ${detail?.history?.length ? `<details><summary>Change history</summary><ul class="plain small">${detail.history.map(h => `<li>${new Date(h.at).toLocaleString()} · ${esc(h.user_name || 'system')} · ${esc(h.action)}</li>`).join('')}</ul></details>` : ''}
      <button class="btn danger" data-delete>Delete pole</button>
    </div>`, { className: 'full' });
  const el = p.el;

  el.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-inspect]')) { p.close(); setTimeout(() => openInspect(id), 50); }
    else if (t.closest('[data-continue]')) { p.close(); setTimeout(() => continueLineFrom(id), 50); }
    else if (t.closest('[data-move]')) { p.close(); setTimeout(() => startMoveOnMap(id), 50); }
    else if (t.closest('[data-relock]')) relock();
    else if (t.closest('[data-photo]')) viewPhotos(urls, Number(t.closest('[data-photo]').dataset.photo));
    else if (t.closest('[data-insp]')) {
      if (!store.state.online) return toast('Opening an inspection needs a connection.', 'error');
      openReview(t.closest('[data-insp]').dataset.insp);
    }
    else if (t.closest('[data-unspan]')) { store.deleteSpan(t.closest('[data-unspan]').dataset.unspan); p.close(); setTimeout(() => openPole(id), 50); }
    else if (t.closest('[data-delete]')) {
      if (await confirmDialog(`Delete pole ${pole.tag} and its connections? Inspections and photos are kept on the server.`, { ok: 'Delete', danger: true })) { store.deletePole(id); p.close(); toast(`${pole.tag} deleted`); }
    }
  });
  $('[data-connect]', el).onchange = e => {
    if (!e.target.value) return;
    store.saveSpan({ from_pole: id, to_pole: e.target.value, line_id: pole.line_id });
    p.close(); setTimeout(() => openPole(id), 50);
  };

  const form = $('.pole-form', el);
  form.line_id.onchange = async () => { if (form.line_id.value === '__new') { const l = await newLineDialog(); if (l) { form.line_id.insertAdjacentHTML('afterbegin', `<option value="${l.id}">${esc(l.name)}</option>`); form.line_id.value = l.id; } else form.line_id.value = pole.line_id || ''; } };
  form.onsubmit = e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const equipment = Object.fromEntries(EQUIPMENT_FIELDS.map(([k]) => [k, (v[`eq_${k}`] || '').trim()]).filter(([, x]) => x));
    store.savePole({ ...store.state.poles.get(id), tag: v.tag.trim(), line_id: v.line_id === '__new' ? pole.line_id : v.line_id, structure: v.structure, material: v.material, notes: v.notes, equipment });
    toast('Saved', 'ok');
  };

  async function relock() {
    const old = store.state.poles.get(id);
    toast('Stand against the pole and hold still…', 'info', 4000);
    const ctl = gps.lockPosition({ targetAccuracy: 3, minSamples: 5, maxSeconds: 20 });
    const est = await ctl.promise;
    if (!est) return toast(gps.lastError() || 'No GPS fix.', 'error');
    const moved = distanceM(old, est);
    if (!(await confirmDialog(`New position ±${est.accuracy} m from ${est.samples} fixes, ${fmtDistance(moved)} from the old pin. Use it?`, { ok: 'Use new position' }))) return;
    store.savePole({ ...old, lat: est.lat, lng: est.lng, accuracy_m: est.accuracy, gps_samples: est.samples, location_source: 'gps' });
    p.close(); setTimeout(() => openPole(id), 50);
  }
}
