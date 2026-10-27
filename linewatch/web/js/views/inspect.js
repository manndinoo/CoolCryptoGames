// Photo capture and submission for one pole.
import * as store from '../store.js';
import * as camera from '../camera.js';
import * as compass from '../compass.js';
import { $, $$, esc, toast, panel, confirmDialog } from '../ui.js';
import { VIEWS, STRUCTURES, MATERIALS } from '../grades.js';
import { session } from '../app.js';

const MAX_PHOTOS = 40;
const draftKey = poleId => `lw.draft.${poleId}`;
const readDraft = poleId => { try { return JSON.parse(localStorage.getItem(draftKey(poleId))) || null; } catch { return null; } };
const writeDraft = (poleId, d) => { try { localStorage.setItem(draftKey(poleId), JSON.stringify(d)); } catch {} };

export async function openInspect(poleId) {
  const pole = store.state.poles.get(poleId);
  if (!pole) return toast('Pole not found.', 'error');
  // Photos are written to the phone's storage as they are taken, so closing
  // the app or losing battery does not lose them.
  const saved = readDraft(poleId) || { photos: [], notes: '' };
  const photos = [];
  for (const p of saved.photos) {
    const blob = await store.blobGet(p.id).catch(() => null);
    if (blob) photos.push({ ...p, blob, url: URL.createObjectURL(blob) });
  }
  let view = VIEWS.find(v => !photos.some(p => p.view === v.id))?.id || 'full';
  let cam = null, submitting = false, stopCompass = null;

  const p = panel(`
    <div class="sheet-head"><div><h2>${esc(pole.tag)}</h2><p class="small muted">${esc(store.state.lines.get(pole.line_id)?.name || '')}</p></div><button class="btn icon" data-close aria-label="Close">✕</button></div>
    <div class="capture">
      <div class="shot-guide" data-guide></div>
      <div class="camera" data-camera hidden>
        <video playsinline muted></video>
        <div class="camera-hint" data-hint></div>
        <div class="compass-badge" data-compass hidden></div>
        <div class="camera-bar">
          <input type="range" data-zoom hidden aria-label="Zoom">
          <button class="shutter" data-shutter aria-label="Take photo"></button>
          <button class="btn small" data-torch hidden>Light</button>
        </div>
      </div>
      <div class="row wrap">
        ${camera.liveCameraSupported() ? '<button class="btn primary grow" data-live>Open camera</button>' : ''}
        <label class="btn grow">Phone camera<input type="file" accept="image/*" capture="environment" data-native hidden></label>
        <label class="btn grow">From library<input type="file" accept="image/*" multiple data-library hidden></label>
      </div>
      <div class="thumbs" data-thumbs></div>
      <div class="grid2">
        <label>Structure<select data-structure>${STRUCTURES.map(s => `<option value="${s.id}" ${s.id === pole.structure ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
        <label>Material<select data-material>${MATERIALS.map(m => `<option ${m === pole.material ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      </div>
      <label>What you noticed (optional)<textarea data-notes rows="3" placeholder="Leaning toward road, woodpecker holes near top, transformer leaking…">${esc(saved.notes)}</textarea></label>
      <p class="small muted">${session.ai ? 'AI will grade the photos, then a reviewer confirms (or it is accepted automatically once the AI is trusted for that grade).' : 'No AI is connected: a reviewer will grade these photos.'} Works offline; uploads when you have signal.</p>
      <button class="btn primary huge" data-submit disabled>Submit</button>
    </div>`, { className: 'full', onClose: () => { cam?.stop(); stopCompass?.(); camera.keepAwake(false); } });
  const el = p.el;
  const video = $('video', el);

  const persist = () => writeDraft(poleId, { photos: photos.map(({ blob, url, ...rest }) => rest), notes: $('[data-notes]', el).value });

  function render() {
    $('[data-guide]', el).innerHTML = VIEWS.map(v => {
      const n = photos.filter(x => x.view === v.id).length;
      return `<button class="guide ${v.id === view ? 'on' : ''} ${n ? 'done' : ''}" data-view="${v.id}"><b>${n ? '✓' : ''}</b>${esc(v.label)}${n > 1 ? ` <small>${n}</small>` : ''}</button>`;
    }).join('');
    $('[data-hint]', el).textContent = `${VIEWS.find(v => v.id === view)?.label}: ${VIEWS.find(v => v.id === view)?.hint}`;
    $('[data-thumbs]', el).innerHTML = photos.map((x, i) => `<figure><img src="${x.url}" alt=""><figcaption>${esc(VIEWS.find(v => v.id === x.view)?.label || 'Photo')}${x.heading != null ? ` · ${compass.cardinal(x.heading)}` : ''}</figcaption><button data-remove="${i}" aria-label="Remove photo">✕</button></figure>`).join('');
    const btn = $('[data-submit]', el);
    btn.disabled = !photos.length || submitting;
    btn.textContent = photos.length ? `Submit ${photos.length} photo${photos.length === 1 ? '' : 's'}` : 'Take at least one photo';
  }

  // heading: compass direction at the shutter, only known for the in-app camera.
  async function addPhoto(blob, takenAt, fromCamera, heading = null) {
    if (photos.length >= MAX_PHOTOS) return toast(`Up to ${MAX_PHOTOS} photos per inspection.`, 'error');
    const id = store.uid();
    await store.blobSet(id, blob);
    photos.push({
      // Library photos are not labelled with the selected view: the AI works out what each one shows.
      id, blob, url: URL.createObjectURL(blob), view: fromCamera ? view : '', takenAt: takenAt || new Date().toISOString(),
      heading: heading == null ? null : Math.round(heading),
    });
    // Move the guide on to the next view that still has no photo.
    if (fromCamera && photos.filter(x => x.view === view).length === 1) view = VIEWS.find(v => !photos.some(x => x.view === v.id))?.id || view;
    persist();
    render();
  }

  el.addEventListener('click', async e => {
    const v = e.target.closest('[data-view]');
    if (v) { view = v.dataset.view; render(); return; }
    const r = e.target.closest('[data-remove]');
    if (r) {
      const [gone] = photos.splice(Number(r.dataset.remove), 1);
      store.blobDel(gone.id).catch(() => {});
      persist(); render();
      return;
    }
    if (e.target.closest('[data-live]')) return openLive();
    if (e.target.closest('[data-shutter]')) {
      try {
        const heading = compass.current();
        const blob = await camera.snap(video);
        el.querySelector('.camera').classList.add('flash');
        setTimeout(() => el.querySelector('.camera')?.classList.remove('flash'), 150);
        navigator.vibrate?.(20);
        await addPhoto(blob, null, true, heading);
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (e.target.closest('[data-submit]')) return submitAll();
  });

  let torchOn = false;
  $('[data-torch]', el).onclick = () => { torchOn = !torchOn; cam?.torch?.(torchOn); };

  function showCompass(h, acc) {
    const badge = $('[data-compass]', el);
    if (!badge) return;
    badge.hidden = false;
    badge.innerHTML = h == null
      ? '<b>Compass</b> hold the phone upright'
      : `<i aria-label="North is this way" title="North" style="transform:rotate(${-Math.round(h)}deg)">▲</i><b>Facing ${esc(compass.describe(h))}</b>${acc != null && acc > 25 ? ' <small>weak: wave phone in a figure 8</small>' : ''}`;
  }

  async function openLive() {
    // Started from this tap: iPhones only allow the compass after a user gesture.
    compass.start().then(ok => {
      if (!ok) return;
      stopCompass = compass.onChange(showCompass);
      showCompass(compass.current(), compass.currentAccuracy());
    });
    try {
      cam = await camera.openStream(video);
      $('[data-camera]', el).hidden = false;
      $('[data-live]', el).hidden = true;
      camera.keepAwake(true);
      if (cam.zoom) {
        const z = $('[data-zoom]', el);
        Object.assign(z, { min: cam.zoom.min, max: cam.zoom.max, step: 0.1, value: cam.zoom.min, hidden: false });
        z.oninput = () => cam.zoom.set(Number(z.value));
      }
      if (cam.torch) $('[data-torch]', el).hidden = false;
    } catch (err) {
      toast(err.name === 'NotAllowedError' ? 'Camera permission is off. Use Phone camera instead, or allow the camera in settings.' : 'Could not open the camera. Use Phone camera instead.', 'error', 6000);
    }
  }

  for (const sel of ['[data-native]', '[data-library]']) {
    $(sel, el).onchange = async e => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const f of files) {
        try { const { blob, takenAt } = await camera.prepareFile(f); await addPhoto(blob, takenAt, sel === '[data-native]'); }
        catch (err) { toast(err.message, 'error'); }
      }
    };
  }
  $('[data-notes]', el).oninput = persist;

  async function submitAll() {
    if (!photos.length || submitting) return;
    const missing = VIEWS.filter(v => !photos.some(x => x.view === v.id) && v.id !== 'equipment');
    if (missing.length >= 3 && !(await confirmDialog(`No photos of: ${missing.map(m => m.label).join(', ')}. Missing views can make the grade "Needs more evidence". Submit anyway?`, { ok: 'Submit anyway' }))) return;
    submitting = true; render();
    try {
      const structure = $('[data-structure]', el).value, material = $('[data-material]', el).value;
      if (structure !== pole.structure || material !== pole.material) store.savePole({ ...pole, structure, material });
      await store.submitInspection({ poleId, notes: $('[data-notes]', el).value.trim(), checklist: {}, photos });
      localStorage.removeItem(draftKey(poleId));
      toast(store.state.online ? 'Submitted. Uploading photos…' : 'Saved on this phone. It will upload when you have signal.', 'ok', 5000);
      p.close();
    } catch (err) {
      submitting = false; render();
      toast(`Could not save: ${err.message}`, 'error', 6000);
    }
  }

  render();
}
