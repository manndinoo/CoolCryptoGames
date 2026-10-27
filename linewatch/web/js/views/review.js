// Review queue and the review panel, where a person confirms or corrects
// the AI. Every correction is a training signal, so the form asks for why.
import * as store from '../store.js';
import { $, $$, esc, toast, panel, gradeChip, pct, timeAgo, viewPhotos } from '../ui.js';
import { GRADES, GRADE_INFO, VIEWS } from '../grades.js';
import { session, showPoleOnMap } from '../app.js';
import { describe } from '../compass.js';

export async function renderReviewQueue(el) {
  if (!el.dataset.loaded) el.innerHTML = '<div class="pad"><h1>Review</h1><p class="muted">Loading…</p></div>';
  let items;
  try { items = (await store.api('GET', '/api/review-queue')).items; }
  catch (err) {
    const local = [...store.state.inspections.values()].filter(i => ['needs_review', 'urgent_review'].includes(i.status));
    el.innerHTML = `<div class="pad"><h1>Review</h1><p class="alert">${esc(err.message)} Reviewing needs a connection${local.length ? `; ${local.length} inspection${local.length === 1 ? '' : 's'} waiting` : ''}.</p></div>`;
    return;
  }
  el.dataset.loaded = '1';
  const aiPending = items.filter(i => i.status === 'submitted');
  const ready = items.filter(i => i.status !== 'submitted');
  const card = i => `<button class="queue-item ${i.status === 'urgent_review' ? 'urgent' : ''}" data-open="${i.id}">
      ${i.cover_photo ? `<img src="/api/photos/${i.cover_photo}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
      <div><div class="row between"><b>${esc(i.tag)}</b>${i.ai_grade ? gradeChip(i.ai_grade, `AI ${pct(i.ai_confidence)}`) : '<span class="chip">No AI grade</span>'}</div>
      <p class="small">${esc(i.ai_report?.summary || i.notes || (i.ai_error ? `AI: ${i.ai_error}` : 'Awaiting review'))}</p>
      <p class="small muted">${i.photo_count} photos · ${esc(i.inspector_name || '')} · ${timeAgo(i.submitted_at)}${i.autonomy?.audit ? ' · random audit' : ''}</p></div></button>`;
  el.innerHTML = `<div class="pad"><h1>Review</h1>
    ${ready.length ? '' : '<p class="muted">Nothing waiting for review.</p>'}
    <div class="queue">${ready.map(card).join('')}</div>
    ${aiPending.length ? `<h3>AI is inspecting (${aiPending.length})</h3><div class="queue">${aiPending.map(card).join('')}</div>` : ''}</div>`;
  el.onclick = e => { const id = e.target.closest('[data-open]')?.dataset.open; if (id) openReview(id, () => renderReviewQueue(el)); };
}

export async function openReview(id, onDone) {
  let data;
  try { data = await store.api('GET', `/api/inspections/${id}`); }
  catch (err) { return toast(err.message, 'error'); }
  const { inspection: ins, photos } = data;
  const pole = store.state.poles.get(ins.pole_id) || {};
  const rep = ins.ai_report;
  const photoIndex = new Map(photos.map((ph, i) => [ph.id, i]));
  const urls = photos.map(ph => `/api/photos/${ph.id}`);
  const captions = photos.map(ph => [VIEWS.find(v => v.id === ph.view)?.label, ph.heading != null && `facing ${describe(ph.heading)}`].filter(Boolean).join(' · '));
  const done = ins.status === 'complete';
  let grade = ins.final_grade || ins.ai_grade || null;
  const feedback = (rep?.findings || []).map(() => 'agree');

  const findingHtml = (f, i) => `<div class="finding">
      <div class="row between"><b>${esc(f.component)}</b>${gradeChip(f.grade, f.kind === 'suspected' ? 'suspected' : '')}</div>
      <p>${esc(f.observation)}</p>
      <p class="small muted">Follow-up: ${esc(f.follow_up)}</p>
      <div class="row wrap small">${f.photo_ids.map(pid => `<button class="link" data-photo="${photoIndex.get(pid)}">Photo ${photoIndex.get(pid) + 1}</button>`).join(' ')}</div>
      ${done ? '' : `<div class="seg" data-feedback="${i}"><button class="on" data-v="agree">Correct</button><button data-v="wrong">Wrong</button><button data-v="unsure">Unsure</button></div>`}
    </div>`;

  const p = panel(`
    <div class="sheet-head"><div><h2>${esc(pole.tag || 'Pole')}</h2><p class="small muted">${esc(ins.inspector_name || '')} · ${new Date(ins.submitted_at || ins.created_at).toLocaleString()}</p></div><button class="btn icon" data-close aria-label="Close">✕</button></div>
    <div class="review pad">
      <div class="gallery">${photos.map((ph, i) => `<button data-photo="${i}"><img src="${urls[i]}" alt="" loading="lazy"><span>${i + 1}${captions[i] ? ` · ${esc(captions[i])}` : ''}</span></button>`).join('')}</div>
      ${ins.notes ? `<p><b>Inspector notes:</b> ${esc(ins.notes)}</p>` : ''}
      ${pole.open_critical ? '<p class="alert">This pole has an unresolved Critical on record.</p>' : ''}
      ${rep ? `<section class="ai-report">
          <div class="row between"><h3>AI assessment</h3>${gradeChip(rep.grade, `${pct(rep.confidence)} confident`)}</div>
          <p><b>${esc(rep.summary)}</b></p><p class="small">${esc(rep.rationale)}</p>
          ${rep.grade === 'critical' ? `<div class="gate"><p><b>Hazard:</b> ${esc(rep.critical_gate.hazard)}</p><p><b>Consequence:</b> ${esc(rep.critical_gate.consequence)}</p><p><b>Why immediate:</b> ${esc(rep.critical_gate.why_immediate)}</p></div>` : ''}
          ${rep.flags?.length ? `<ul class="flags">${rep.flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
          ${rep.findings.map(findingHtml).join('') || '<p class="muted">No defects reported.</p>'}
          ${rep.coverage.missing_views.length ? `<p class="small"><b>Missing views:</b> ${esc(rep.coverage.missing_views.join(', '))}</p>` : ''}
          ${rep.field_verification.length ? `<p class="small"><b>Verify in field:</b> ${esc(rep.field_verification.join('; '))}</p>` : ''}
          ${ins.autonomy ? `<p class="small muted">Why this came to a person: ${esc(ins.autonomy.reasons.join(' '))}</p>` : ''}
          <p class="small muted">${esc(ins.ai_model || '')}</p>
        </section>` : `<section class="ai-report"><p class="muted">${ins.ai_status === 'queued' || ins.ai_status === 'running' ? 'The AI is still inspecting. You can grade it yourself now or wait.' : ins.ai_error ? `AI could not inspect: ${esc(ins.ai_error)}` : 'No AI assessment.'}</p>
          ${['failed', 'none'].includes(ins.ai_status) && session.ai ? `<button class="btn" data-retry>${ins.ai_status === 'failed' ? 'Retry AI' : 'Run AI inspection'}</button>` : ''}</section>`}
      ${done ? `<section><h3>Final grade</h3>${gradeChip(ins.final_grade, ins.final_source === 'ai' ? 'accepted from AI' : `by ${ins.reviewer_name || 'reviewer'}`)}
          ${ins.review?.reason ? `<p>${esc(ins.review.reason)}</p>` : ''}</section>` : `
      <form class="review-form">
        <h3>Your grade</h3>
        <div class="grade-pick">${[...GRADES, 'inconclusive'].map(g => `<button type="button" data-grade="${g}" style="--c:${GRADE_INFO[g].color}" class="${g === grade ? 'on' : ''}"><b>${esc(GRADE_INFO[g].label)}</b><small>${esc(GRADE_INFO[g].response)}</small></button>`).join('')}</div>
        <label data-reason-wrap hidden>Why is the AI grade wrong? <small>(required; the AI learns from this)</small><textarea name="reason" rows="2"></textarea></label>
        <label>Anything the AI missed?<textarea name="missed" rows="2" placeholder="e.g. cracked insulator on the B phase, photo 3"></textarea></label>
        <label class="check"><input type="checkbox" name="saveLesson"> Save as a lesson for future inspections</label>
        <label data-lesson-wrap hidden>Lesson<textarea name="lesson" rows="2" placeholder="e.g. Rust staining on galvanized hardware alone is Monitor, not Priority."></textarea></label>
        ${pole.open_critical ? '<label class="check"><input type="checkbox" name="resolveCritical"> The earlier Critical hazard is resolved</label>' : ''}
        <label>Notes for the work order<textarea name="notes" rows="2"></textarea></label>
        <button class="btn primary huge" data-save>Save grade</button>
      </form>`}
      <button class="btn" data-map>Show on map</button>
    </div>`, { className: 'full' });
  const el = p.el;

  const form = $('.review-form', el);
  const syncReason = () => {
    if (!form) return;
    const overriding = ins.ai_grade && grade !== ins.ai_grade;
    $('[data-reason-wrap]', el).hidden = !overriding;
    $('[data-save]', el).disabled = !grade;
    $('[data-save]', el).textContent = grade ? `Save: ${GRADE_INFO[grade].label}` : 'Choose a grade';
  };
  syncReason();

  el.addEventListener('click', async e => {
    const ph = e.target.closest('[data-photo]');
    if (ph && ph.dataset.photo !== 'undefined') { e.preventDefault(); return viewPhotos(urls, Number(ph.dataset.photo), captions); }
    const g = e.target.closest('[data-grade]');
    if (g) { grade = g.dataset.grade; $$('[data-grade]', el).forEach(b => b.classList.toggle('on', b === g)); syncReason(); return; }
    const fb = e.target.closest('[data-feedback] button');
    if (fb) {
      const seg = fb.parentElement;
      feedback[Number(seg.dataset.feedback)] = fb.dataset.v;
      $$('button', seg).forEach(b => b.classList.toggle('on', b === fb));
      return;
    }
    if (e.target.closest('[data-map]')) { p.close(); setTimeout(() => showPoleOnMap(ins.pole_id), 50); return; }
    if (e.target.closest('[data-retry]')) {
      try { await store.api('POST', `/api/inspections/${ins.id}/retry-ai`); toast('AI inspection restarted.', 'ok'); p.close(); onDone?.(); }
      catch (err) { toast(err.message, 'error'); }
    }
  });

  if (form) {
    form.saveLesson.onchange = () => { $('[data-lesson-wrap]', el).hidden = !form.saveLesson.checked; if (form.saveLesson.checked && !form.lesson.value) form.lesson.value = form.reason.value; };
    form.onsubmit = async e => {
      e.preventDefault();
      if (!grade) return;
      if (ins.ai_grade && grade !== ins.ai_grade && !form.reason.value.trim()) { form.reason.focus(); return toast('Say why the AI grade is wrong.', 'error'); }
      $('[data-save]', el).disabled = true;
      try {
        await store.api('POST', `/api/inspections/${ins.id}/review`, {
          grade, reason: form.reason.value, missed: form.missed.value, notes: form.notes.value,
          lesson: form.saveLesson.checked ? form.lesson.value : '', findings: feedback,
          resolveCritical: !!form.resolveCritical?.checked,
        });
        toast(`${pole.tag}: ${GRADE_INFO[grade].label}`, 'ok');
        store.sync().catch(() => {});
        p.close();
        onDone?.();
      } catch (err) {
        $('[data-save]', el).disabled = false;
        toast(err.message, 'error');
      }
    };
  }
}
