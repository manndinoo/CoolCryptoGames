// Work orders. Completing work never changes a pole's grade; only a new
// inspection can, so finishing a ticket cannot silently clear a hazard.
import * as store from '../store.js';
import { $, esc, gradeChip, timeAgo } from '../ui.js';
import { RANK } from '../grades.js';
import { showPoleOnMap } from '../app.js';

const STATUSES = [['open', 'Open'], ['scheduled', 'Scheduled'], ['in_progress', 'In progress'], ['done', 'Done'], ['cancelled', 'Cancelled']];
let showClosed = false;

export function renderWork(el) {
  const all = [...store.state.workOrders.values()];
  const list = all.filter(w => showClosed || !['done', 'cancelled'].includes(w.status))
    .sort((a, b) => (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9) || String(a.due).localeCompare(String(b.due)));
  const html = `<div class="pad"><div class="row between"><h1>Work orders</h1>
      <label class="check small"><input type="checkbox" data-closed ${showClosed ? 'checked' : ''}> Show closed</label></div>
    <p class="small muted">Critical and Priority grades open a work order automatically. Closing one does not change the pole grade; re-inspect the pole after repair.</p>
    ${list.length ? '' : '<p class="muted">No open work orders.</p>'}
    <div class="queue">${list.map(w => {
      const pole = store.state.poles.get(w.pole_id);
      const overdue = w.due && w.due < new Date().toISOString().slice(0, 10) && !['done', 'cancelled'].includes(w.status);
      return `<div class="wo card ${overdue ? 'overdue' : ''}">
        <div class="row between"><b>${esc(pole?.tag || 'Pole')}</b>${gradeChip(w.priority)}</div>
        <p>${esc(w.title)}</p>
        <p class="small muted">${w.due ? `Due ${esc(w.due)}${overdue ? ' · overdue' : ''}` : 'No due date'} · opened ${timeAgo(w.created_at)}</p>
        <div class="grid2">
          <label>Status<select data-wo="${w.id}" data-field="status">${STATUSES.map(([v, l]) => `<option value="${v}" ${v === w.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Assigned to<input data-wo="${w.id}" data-field="assignee" value="${esc(w.assignee || '')}" placeholder="Crew or person"></label>
        </div>
        <button class="btn small" data-map="${w.pole_id}">Show on map</button>
      </div>`;
    }).join('')}</div></div>`;
  // Leave the list alone while someone is typing in it.
  if (el.contains(document.activeElement) && document.activeElement.matches('input')) return;
  if (el._html === html) return;
  el.innerHTML = html; el._html = html;
  el.onchange = e => {
    if (e.target.matches('[data-closed]')) { showClosed = e.target.checked; el._html = null; return renderWork(el); }
    const id = e.target.dataset.wo;
    if (id) store.saveWorkOrder({ ...store.state.workOrders.get(id), [e.target.dataset.field]: e.target.value });
  };
  el.onclick = e => { const id = e.target.closest('[data-map]')?.dataset.map; if (id) showPoleOnMap(id); };
}
