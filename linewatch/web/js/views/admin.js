// "More" tab: account, lines, exports, users, phone install help.
import * as store from '../store.js';
import { $, esc, toast, download, confirmDialog } from '../ui.js';
import { fmtDistance, lineLengthM } from '../geo.js';
import { session, isAdmin } from '../app.js';

export async function renderAdmin(el) {
  const lines = [...store.state.lines.values()].sort((a, b) => a.name.localeCompare(b.name));
  const spans = store.liveSpans();
  el.innerHTML = `<div class="pad">
    <h1>More</h1>
    <p>Signed in as <b>${esc(session.user?.name)}</b> (${esc(session.user?.role)}). <button class="btn small" data-logout>Sign out</button></p>

    <h2>Lines</h2>
    <ul class="plain">${lines.map(l => {
      const ls = spans.filter(s => s.line_id === l.id);
      const n = store.livePoles().filter(p => p.line_id === l.id).length;
      return `<li class="row between"><span><i class="swatch" style="background:${esc(l.color)}"></i> ${esc(l.name)} <small class="muted">${esc(l.voltage)} · ${n} poles · ${fmtDistance(lineLengthM(ls, store.state.poles))}</small></span></li>`;
    }).join('') || '<li class="muted">No lines yet. Start one from the map with Walk a line.</li>'}</ul>

    <h2>Export</h2>
    <div class="row wrap">
      <button class="btn" data-dl="/api/export/poles.csv">Poles (CSV)</button>
      <button class="btn" data-dl="/api/export/grid.geojson">Grid map (GeoJSON for GIS)</button>
    </div>

    ${isAdmin() ? `<h2>People</h2><div data-users><p class="muted">Loading…</p></div>
    <form class="card" data-new-user><h3>Add a person</h3>
      <div class="grid2"><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label>
      <label>Role<select name="role"><option value="inspector">Inspector: maps poles, takes photos</option><option value="reviewer">Reviewer: also grades and teaches the AI</option><option value="admin">Admin: everything</option></select></label>
      <label>Temporary password<input name="password" minlength="10" required></label></div>
      <button class="btn primary">Add</button></form>` : ''}

    <h2>Put Linewatch on your phone</h2>
    <p class="small"><b>iPhone:</b> open this site in Safari, tap Share, then Add to Home Screen. <b>Android:</b> in Chrome, tap ⋮ then Install app. It then opens full-screen and works offline.</p>
    <p class="small muted">Camera and GPS need the site to be served over HTTPS.</p>

    <h2>This phone</h2>
    <p class="small">${store.state.poles.size} poles cached · ${store.state.pending} changes waiting to send.</p>
    <button class="btn danger" data-clear>Clear data on this phone</button>
  </div>`;

  el.onclick = async e => {
    const dl = e.target.closest('[data-dl]');
    if (dl) return download(dl.dataset.dl);
    if (e.target.closest('[data-logout]')) {
      if (store.state.pending && !(await confirmDialog(`${store.state.pending} changes have not reached the server yet. They stay on this phone and send after you sign back in. Sign out?`, { ok: 'Sign out' }))) return;
      await store.api('POST', '/api/logout').catch(() => {});
      localStorage.removeItem('lw.session');
      location.reload();
    }
    if (e.target.closest('[data-clear]')) {
      if (store.state.pending) return toast(`${store.state.pending} changes have not uploaded yet. Connect and sync first.`, 'error', 6000);
      if (await confirmDialog('Remove the cached map and photos from this phone? Nothing on the server is deleted.', { ok: 'Clear', danger: true })) { await store.clearLocal(); location.reload(); }
    }
    const u = e.target.closest('[data-user]');
    if (u) {
      const body = u.dataset.action === 'toggle' ? { active: u.dataset.active === '1' } : { password: prompt('New temporary password (10+ characters)') || undefined };
      if (u.dataset.action === 'reset' && !body.password) return;
      try { await store.api('PATCH', `/api/users/${u.dataset.user}`, body); toast('Updated', 'ok'); loadUsers(); } catch (err) { toast(err.message, 'error'); }
    }
  };
  el.onchange = async e => {
    const r = e.target.closest('[data-role]');
    if (r) { try { await store.api('PATCH', `/api/users/${r.dataset.role}`, { role: r.value }); toast('Role changed', 'ok'); } catch (err) { toast(err.message, 'error'); loadUsers(); } }
  };
  el.onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try { await store.api('POST', '/api/users', Object.fromEntries(new FormData(f))); f.reset(); toast('Added. Give them the email and temporary password.', 'ok', 6000); loadUsers(); }
    catch (err) { toast(err.message, 'error'); }
  };

  async function loadUsers() {
    const box = $('[data-users]', el);
    if (!box) return;
    try {
      const { users } = await store.api('GET', '/api/users');
      box.innerHTML = `<ul class="plain">${users.map(u => `<li class="row between wrap"><span>${esc(u.name)} <small class="muted">${esc(u.email)}${u.active ? '' : ' · disabled'}</small></span>
        <span class="row"><select data-role="${u.id}">${['inspector', 'reviewer', 'admin'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <button class="btn small" data-user="${u.id}" data-action="reset">Reset password</button>
        <button class="btn small" data-user="${u.id}" data-action="toggle" data-active="${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button></span></li>`).join('')}</ul>`;
    } catch (err) { box.innerHTML = `<p class="alert">${esc(err.message)}</p>`; }
  }
  loadUsers();
}
