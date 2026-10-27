// Small DOM helpers shared by every view.
import { GRADE_INFO } from './grades.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function gradeChip(grade, extra = '') {
  const g = GRADE_INFO[grade] || GRADE_INFO.unreviewed;
  return `<span class="chip grade-${esc(grade)}" style="--c:${g.color}">${esc(g.label)}${extra ? ` <small>${esc(extra)}</small>` : ''}</span>`;
}

export const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`);

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function toast(message, kind = 'info', ms = 2500) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

// Full-screen modal panel. Returns { el, close }. Browser Back closes it.
export function panel(html, { onClose, className = '' } = {}) {
  const el = document.createElement('div');
  el.className = `panel ${className}`;
  el.innerHTML = `<div class="panel-inner" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(el);
  const close = () => {
    if (!el.isConnected) return;
    el.remove();
    window.removeEventListener('popstate', onPop);
    onClose?.();
  };
  const onPop = () => close();
  history.pushState({ panel: true }, '');
  window.addEventListener('popstate', onPop);
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) { e.preventDefault(); history.back(); } });
  requestAnimationFrame(() => el.classList.add('open'));
  return { el, close: () => history.back() };
}

export function confirmDialog(message, { ok = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const p = panel(`<div class="dialog"><p>${esc(message)}</p><div class="row end">
      <button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button></div></div>`,
      { className: 'small', onClose: () => { if (!answered) resolve(false); } });
    p.el.querySelector('[data-ok]').onclick = () => { answered = true; resolve(true); p.close(); };
  });
}

export function promptDialog(message, value = '', { ok = 'Save' } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const p = panel(`<form class="dialog"><label>${esc(message)}<input name="v" value="${esc(value)}" autocomplete="off"></label>
      <div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${esc(ok)}</button></div></form>`,
      { className: 'small', onClose: () => { if (!answered) resolve(null); } });
    const form = p.el.querySelector('form');
    form.v.focus(); form.v.select();
    form.onsubmit = e => { e.preventDefault(); answered = true; resolve(form.v.value.trim()); p.close(); };
  });
}

// Photo viewer with swipe between photos and pinch/double-tap zoom via CSS.
export function viewPhotos(urls, start = 0, captions = []) {
  let i = start;
  const p = panel(`<div class="viewer"><button class="viewer-close" data-close aria-label="Close">✕</button>
    <div class="viewer-stage"><img alt=""></div><div class="viewer-bar"><button class="btn" data-prev>‹</button><span data-cap></span><button class="btn" data-next>›</button></div></div>`, { className: 'dark' });
  const img = p.el.querySelector('img'), cap = p.el.querySelector('[data-cap]');
  const show = () => { img.src = urls[i]; img.classList.remove('zoomed'); cap.textContent = `${i + 1} / ${urls.length}${captions[i] ? ` · ${captions[i]}` : ''}`; };
  p.el.querySelector('[data-prev]').onclick = () => { i = (i - 1 + urls.length) % urls.length; show(); };
  p.el.querySelector('[data-next]').onclick = () => { i = (i + 1) % urls.length; show(); };
  img.ondblclick = () => img.classList.toggle('zoomed');
  let x0 = null;
  img.addEventListener('touchstart', e => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  img.addEventListener('touchend', e => {
    if (x0 == null || img.classList.contains('zoomed')) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 60) p.el.querySelector(dx < 0 ? '[data-next]' : '[data-prev]').click();
  });
  show();
}

export function download(url) {
  const a = document.createElement('a');
  a.href = url; a.download = '';
  document.body.append(a); a.click(); a.remove();
}
