// AI learning dashboard: how well the AI agrees with reviewers, which grades
// it has earned the right to finalise alone, and the lessons it is given.
import * as store from '../store.js';
import { $, esc, toast, pct, timeAgo, gradeChip, download } from '../ui.js';
import { GRADE_INFO } from '../grades.js';
import { isAdmin, session } from '../app.js';

const ORDER = ['critical', 'high', 'monitor', 'clear', 'inconclusive'];

export async function renderLearning(el) {
  el.innerHTML = '<div class="pad"><h1>AI learning</h1><p class="muted">Loading…</p></div>';
  let data;
  try { data = await store.api('GET', '/api/learning'); }
  catch (err) { el.innerHTML = `<div class="pad"><h1>AI learning</h1><p class="alert">${esc(err.message)}</p></div>`; return; }
  const { metrics: m, lessons, recentOverrides } = data;
  const s = m.settings;

  const tile = (label, value, note) => `<div class="tile"><span>${esc(label)}</span><b>${value}</b><small>${esc(note)}</small></div>`;
  const maxCell = Math.max(1, ...ORDER.flatMap(a => ORDER.map(h => m.matrix[a][h])));

  el.innerHTML = `<div class="pad learning">
    <h1>AI learning</h1>
    <p class="small muted">${session.ai ? `Inspecting with ${esc(session.ai.label)} (${esc(session.ai.model)}).` : 'No AI provider is configured. Set ANTHROPIC_API_KEY on the server.'}
      Every review teaches it: reviewer corrections and lessons are sent with each new inspection, and agreement is measured per grade. A grade is accepted without a person only after it earns trust.</p>

    <div class="tiles">
      ${tile('Agreement', pct(m.agreement), `last ${m.reviewed} reviews`)}
      ${tile('Critical caught', pct(m.criticalRecall), `${m.humanCritical} reviewer-confirmed Critical`)}
      ${tile('Auto-accepted', String(m.autoApproved), 'no reviewer needed')}
      ${tile('Autonomy', s.enabled ? 'On' : 'Off', s.enabled ? 'for trusted grades' : 'everything reviewed')}
    </div>

    <h2>Trust by grade</h2>
    <p class="small muted">Trust is the 95% lower bound of agreement, so a short lucky streak does not count. Needs ${s.minSamples}+ reviews and ${pct(s.minAgreement)} trust.</p>
    <div class="trust">${ORDER.map(g => {
      const t = m.perGrade[g];
      const progress = Math.min(1, t.samples / s.minSamples);
      return `<div class="trust-row">
        <div class="row between">${gradeChip(g)}<b class="${t.autonomous ? 'ok' : ''}">${t.autonomous ? 'Trusted · no review' : g === 'critical' ? 'Always reviewed' : 'Learning'}</b></div>
        <div class="meter" title="${t.samples} of ${s.minSamples} reviews"><i style="width:${progress * 100}%"></i></div>
        <p class="small">${t.samples} reviewed · agreement ${pct(t.agreement)} · trust ${pct(t.trust)}${t.severe ? ` · <b class="bad">${t.severe} severe under-call${t.severe > 1 ? 's' : ''}</b>` : ''}</p>
        ${t.reasons.length && !t.autonomous ? `<p class="small muted">${esc(t.reasons.join(' '))}</p>` : ''}
      </div>`;
    }).join('')}</div>

    <h2>AI grade vs reviewer grade</h2>
    <div class="table-wrap"><table class="matrix"><thead><tr><th>AI said ↓ / Reviewer →</th>${ORDER.map(h => `<th>${esc(GRADE_INFO[h].short)}</th>`).join('')}</tr></thead>
      <tbody>${ORDER.map(a => `<tr><th>${esc(GRADE_INFO[a].short)}</th>${ORDER.map(h => {
        const n = m.matrix[a][h];
        return `<td class="${a === h ? 'diag' : ''}" style="--a:${n ? 0.12 + 0.6 * (n / maxCell) : 0}" title="AI ${GRADE_INFO[a].label}, reviewer ${GRADE_INFO[h].label}: ${n}">${n || ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="small muted">Diagonal = agreed. Right of the diagonal the AI was more cautious; left of it the AI under-called a problem.</p>

    ${m.trend.length > 1 ? `<h2>Agreement over time</h2>${trendSvg(m.trend)}` : ''}

    <h2>Is its confidence honest?</h2>
    <div class="table-wrap"><table><thead><tr><th>AI confidence</th><th>Reviews</th><th>Actually agreed</th></tr></thead><tbody>
      ${m.bands.map(b => `<tr><td>${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%</td><td>${b.n}</td><td>${pct(b.accuracy)}</td></tr>`).join('')}
    </tbody></table></div>

    <h2>Lessons the AI is given</h2>
    <form class="row" data-add-lesson><input name="text" class="grow" placeholder="e.g. Treat any guy wire touching a primary conductor as Critical."><button class="btn primary">Add</button></form>
    <ul class="plain lessons">${lessons.map(l => `<li class="${l.active ? '' : 'off'}"><span>${esc(l.text)}<small> · ${esc(l.author || '')} ${timeAgo(l.created_at)}</small></span>
      <button class="btn small" data-lesson="${l.id}" data-active="${l.active ? 0 : 1}">${l.active ? 'Turn off' : 'Turn on'}</button></li>`).join('') || '<li class="muted">No lessons yet. They are added when reviewers correct the AI.</li>'}</ul>

    ${recentOverrides.length ? `<h2>Recent corrections</h2><ul class="plain">${recentOverrides.map(o => `<li><b>${esc(o.tag)}</b> AI ${gradeChip(o.ai_grade)} → ${gradeChip(o.final_grade)}<br><small>${esc(o.review?.reason || '')}</small></li>`).join('')}</ul>` : ''}

    ${isAdmin() ? `<h2>Autonomy settings</h2>
    <form class="settings" data-settings>
      <label class="check"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Allow the AI to finalise trusted grades without a reviewer</label>
      <fieldset><legend>Grades the AI may finalise once trusted</legend>
        <label class="check"><input type="checkbox" name="g_clear" ${s.grades.clear ? 'checked' : ''}> No issues</label>
        <label class="check"><input type="checkbox" name="g_monitor" ${s.grades.monitor ? 'checked' : ''}> Monitor</label>
        <label class="check"><input type="checkbox" name="g_high" ${s.grades.high ? 'checked' : ''}> Priority</label>
        <p class="small muted">Critical is always confirmed by a person.</p></fieldset>
      <div class="grid2">
        <label>Reviews needed per grade<input name="minSamples" type="number" min="5" value="${s.minSamples}"></label>
        <label>Required trust (%)<input name="minAgreement" type="number" min="50" max="99.9" step="0.5" value="${(s.minAgreement * 100).toFixed(1)}"></label>
        <label>Minimum AI confidence (%)<input name="minConfidence" type="number" min="0" max="100" value="${Math.round(s.minConfidence * 100)}"></label>
        <label>Random audit (%)<input name="auditRate" type="number" min="0" max="100" value="${Math.round(s.auditRate * 100)}"></label>
        <label>Measure over last N reviews<input name="window" type="number" min="20" value="${s.window}"></label>
      </div>
      <button class="btn primary">Save settings</button>
    </form>
    <h2>Training data</h2><p class="small muted">Every reviewed inspection with its photos and reviewer grade, for evaluating or training a dedicated model.</p>
    <button class="btn" data-export>Download training set (JSONL)</button>` : ''}
  </div>`;

  el.onclick = async e => {
    const b = e.target.closest('[data-lesson]');
    if (b) {
      try { await store.api('PATCH', `/api/lessons/${b.dataset.lesson}`, { active: b.dataset.active === '1' }); renderLearning(el); }
      catch (err) { toast(err.message, 'error'); }
    }
    if (e.target.closest('[data-export]')) download('/api/export/training.jsonl');
  };
  el.onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.matches('[data-add-lesson]')) {
        if (!f.text.value.trim()) return;
        await store.api('POST', '/api/lessons', { text: f.text.value });
      } else if (f.matches('[data-settings]')) {
        await store.api('PUT', '/api/learning/settings', {
          enabled: f.enabled.checked,
          grades: { clear: f.g_clear.checked, monitor: f.g_monitor.checked, high: f.g_high.checked },
          minSamples: Number(f.minSamples.value), minAgreement: Number(f.minAgreement.value) / 100,
          minConfidence: Number(f.minConfidence.value) / 100, auditRate: Number(f.auditRate.value) / 100, window: Number(f.window.value),
        });
        toast('Settings saved', 'ok');
      }
      renderLearning(el);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function trendSvg(trend) {
  const W = 320, H = 120, P = 24;
  const x = i => P + (i * (W - 2 * P)) / Math.max(1, trend.length - 1);
  const y = v => H - P - v * (H - 2 * P);
  const pts = trend.map((t, i) => `${x(i).toFixed(1)},${y(t.agreement).toFixed(1)}`).join(' ');
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Agreement per block of 10 reviews">
    ${[0, 0.5, 1].map(v => `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="2" y="${y(v) + 4}" class="axis">${v * 100}%</text>`).join('')}
    <polyline points="${pts}" class="line"/>
    ${trend.map((t, i) => `<circle cx="${x(i)}" cy="${y(t.agreement)}" r="4" class="dot"><title>Reviews up to ${new Date(t.upTo).toLocaleDateString()}: ${Math.round(t.agreement * 100)}% agreed (${t.n})</title></circle>`).join('')}
  </svg>`;
}
