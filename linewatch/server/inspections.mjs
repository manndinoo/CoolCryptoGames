// Inspection lifecycle:
//   draft -> submitted -> (AI) -> needs_review | urgent_review -> complete
// A grade reaches the pole only through finalize(), whether a person or a
// trusted AI result supplied it.
import fs from 'node:fs';
import path from 'node:path';
import { tx, now, audit, getSetting } from './db.mjs';
import { RANK, GRADES } from '../web/js/grades.js';
import { validateReport, InspectionError, PROMPT_VERSION } from './ai/policy.mjs';
import { buildContext, decide } from './ai/learning.mjs';

export const MAX_AI_PHOTOS = 20;

export function parseInspection(row) {
  if (!row) return null;
  const j = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  return { ...row, checklist: j(row.checklist) || {}, ai_report: j(row.ai_report), autonomy: j(row.autonomy), review: j(row.review) };
}

// Recompute the pole's displayed grade from its finalized inspections.
// The most recent finalized inspection sets the grade, except that an
// unresolved Critical stays Critical until someone explicitly resolves it.
export function refreshPoleGrade(db, poleId) {
  const latest = db.prepare(`SELECT final_grade, final_source, COALESCE(reviewed_at, updated_at) AS at FROM inspections
    WHERE pole_id = ? AND status = 'complete' AND final_grade IS NOT NULL
    ORDER BY submitted_at DESC, COALESCE(reviewed_at, updated_at) DESC LIMIT 1`).get(poleId);
  const pole = db.prepare('SELECT open_critical FROM poles WHERE id = ?').get(poleId);
  let grade = latest?.final_grade || 'unreviewed';
  if (pole?.open_critical) grade = 'critical';
  db.prepare('UPDATE poles SET grade = ?, grade_source = ?, graded_at = ?, updated_at = ? WHERE id = ?')
    .run(grade, latest?.final_source || '', latest?.at || null, now(), poleId);
}

export function finalize(db, inspectionId, { grade, source, reviewerId = null, review = null, resolveCritical = false, workOrder = true }) {
  const t = now();
  const ins = db.prepare('SELECT * FROM inspections WHERE id = ?').get(inspectionId);
  db.prepare(`UPDATE inspections SET status = 'complete', final_grade = ?, final_source = ?, reviewer_id = ?, review = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`)
    .run(grade, source, reviewerId, review ? JSON.stringify(review) : null, t, t, inspectionId);
  if (grade === 'critical') db.prepare('UPDATE poles SET open_critical = 1 WHERE id = ?').run(ins.pole_id);
  else if (resolveCritical && source === 'human') db.prepare('UPDATE poles SET open_critical = 0 WHERE id = ?').run(ins.pole_id);
  refreshPoleGrade(db, ins.pole_id);

  const woGrades = getSetting(db, 'workOrderGrades', ['critical', 'high']);
  if (workOrder && woGrades.includes(grade)) {
    const report = ins.ai_report ? JSON.parse(ins.ai_report) : null;
    const title = review?.title || report?.summary || `${grade} condition found`;
    const due = new Date(Date.now() + (grade === 'critical' ? 1 : 14) * 864e5).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO work_orders (id, pole_id, inspection_id, title, priority, status, due, notes, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,'open',?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(`wo-${inspectionId}`, ins.pole_id, inspectionId, title.slice(0, 200), grade, due, review?.notes || '', reviewerId, t, t);
  }
  audit(db, reviewerId, 'inspection', inspectionId, 'finalized', { grade, source, resolveCritical });
}

export function submit(db, inspectionId, userId, aiAvailable) {
  const t = now();
  const photos = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE inspection_id = ?').get(inspectionId).n;
  const status = aiAvailable && photos ? 'submitted' : 'needs_review';
  const aiStatus = aiAvailable && photos ? 'queued' : 'none';
  db.prepare(`UPDATE inspections SET status = ?, ai_status = ?, ai_error = '', submitted_at = COALESCE(submitted_at, ?), updated_at = ? WHERE id = ? AND status IN ('draft','submitted','needs_review')`)
    .run(status, aiStatus, t, t, inspectionId);
  audit(db, userId, 'inspection', inspectionId, 'submitted', { photos, ai: aiStatus });
}

// Background worker that runs AI inspections one at a time. Retryable
// failures back off and try again; permanent ones hand the inspection to a
// person with the reason attached.
export function startAiWorker({ db, provider, dataDir, log = console, intervalMs = 3000 }) {
  if (!provider) return { stop() {}, kick() {} };
  let busy = false, timer = null, stopped = false;
  const retryAt = new Map();
  // Inspections left "running" by a crash or restart go back in the queue.
  db.prepare(`UPDATE inspections SET ai_status = 'queued' WHERE ai_status = 'running'`).run();

  async function tick() {
    if (busy || stopped) return;
    const row = db.prepare(`SELECT * FROM inspections WHERE ai_status = 'queued' ORDER BY submitted_at LIMIT 20`).all()
      .find(r => !retryAt.has(r.id) || retryAt.get(r.id).at <= Date.now());
    if (!row) return;
    busy = true;
    try { await runOne(row); } finally { busy = false; }
    setImmediate(tick);
  }

  async function runOne(row) {
    db.prepare(`UPDATE inspections SET ai_status = 'running', updated_at = ? WHERE id = ?`).run(now(), row.id);
    const pole = db.prepare('SELECT * FROM poles WHERE id = ?').get(row.pole_id);
    const photoRows = db.prepare('SELECT * FROM photos WHERE inspection_id = ? ORDER BY taken_at, created_at').all(row.id);
    const chosen = choosePhotos(photoRows, MAX_AI_PHOTOS);
    try {
      const photos = chosen.map(p => ({ id: p.id, view: p.view, mime: p.mime, taken_at: p.taken_at, base64: fs.readFileSync(path.join(dataDir, 'photos', p.file)).toString('base64') }));
      const request = {
        structure_tag: pole.tag,
        recorded_structure_type: pole.structure,
        recorded_material: pole.material,
        recorded_equipment: safeParse(pole.equipment),
        inspector_notes: row.notes,
        inspector_checklist: safeParse(row.checklist),
        unresolved_critical_on_record: !!pole.open_critical,
        photo_count: photos.length,
        photos_not_sent: photoRows.length - photos.length,
      };
      const result = await provider.inspect({ context: buildContext(db, pole), request, photos });
      const report = validateReport(result.report, photos.map(p => p.id));
      tx(db, () => {
        // A reviewer may have graded it while the AI was working. Keep their
        // grade; the AI's answer is still recorded as a blind comparison.
        if (db.prepare('SELECT status FROM inspections WHERE id = ?').get(row.id).status === 'complete') {
          db.prepare(`UPDATE inspections SET ai_status = 'done', ai_error = '', ai_grade = ?, ai_confidence = ?, ai_report = ?, ai_model = ?, ai_prompt_version = ?, updated_at = ? WHERE id = ?`)
            .run(report.grade, report.confidence, JSON.stringify(report), result.model, PROMPT_VERSION, now(), row.id);
          return;
        }
        const decision = decide(db, { grade: report.grade, confidence: report.confidence, report });
        if (pole.open_critical && decision.action === 'auto') {
          decision.action = 'review';
          decision.reasons = ['This pole has an unresolved Critical on record. Only a person can clear it.'];
        }
        const t = now();
        const status = decision.action === 'urgent_review' ? 'urgent_review' : decision.action === 'auto' ? 'complete' : 'needs_review';
        db.prepare(`UPDATE inspections SET ai_status = 'done', ai_error = '', ai_grade = ?, ai_confidence = ?, ai_report = ?, ai_model = ?, ai_prompt_version = ?, autonomy = ?, status = ?, updated_at = ? WHERE id = ?`)
          .run(report.grade, report.confidence, JSON.stringify(report), result.model, PROMPT_VERSION, JSON.stringify(decision), status, t, row.id);
        // Photos picked from the library arrive unlabelled; keep the AI's view label.
        for (const ph of report.photos) db.prepare(`UPDATE photos SET view = ? WHERE id = ? AND view = '' AND ? != 'other'`).run(ph.view, ph.photo_id, ph.view);
        audit(db, null, 'inspection', row.id, 'ai_completed', { grade: report.grade, confidence: report.confidence, decision: decision.action, model: result.model });
        if (decision.action === 'auto') finalize(db, row.id, { grade: report.grade, source: 'ai' });
      });
      retryAt.delete(row.id);
      log.info?.(`AI ${row.id}: ${report.grade} (${Math.round(report.confidence * 100)}%)`);
    } catch (err) {
      const code = err instanceof InspectionError ? err.code : 'internal_error';
      const message = err instanceof InspectionError ? err.message : 'The AI step failed unexpectedly.';
      const retryable = ['rate_limited', 'provider_unavailable', 'connection_failed', 'invalid_response', 'incomplete_response'].includes(code);
      const attempt = (retryAt.get(row.id)?.attempt || 0) + 1;
      if (retryable && attempt < 6) {
        retryAt.set(row.id, { attempt, at: Date.now() + Math.min(15 * 60e3, 5000 * 2 ** attempt) });
        db.prepare(`UPDATE inspections SET ai_status = 'queued', ai_error = ?, updated_at = ? WHERE id = ?`).run(`${message} (attempt ${attempt})`, now(), row.id);
      } else {
        retryAt.delete(row.id);
        // The inspection is not lost: it goes to a person with the photos.
        db.prepare(`UPDATE inspections SET ai_status = 'failed', ai_error = ?, status = CASE WHEN status = 'submitted' THEN 'needs_review' ELSE status END, updated_at = ? WHERE id = ?`)
          .run(message, now(), row.id);
      }
      log.warn?.(`AI ${row.id} failed: ${code} ${err.message}`);
    }
  }

  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop() { stopped = true; clearInterval(timer); }, kick: () => setImmediate(tick) };
}

// Up to `max` photos, keeping at least one of each labelled view first.
export function choosePhotos(rows, max) {
  if (rows.length <= max) return rows;
  const picked = [], seen = new Set();
  for (const r of rows) if (r.view && !seen.has(r.view)) { seen.add(r.view); picked.push(r); }
  for (const r of rows) if (picked.length < max && !picked.includes(r)) picked.push(r);
  return picked.slice(0, max);
}

const safeParse = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// Order for the review queue: urgent first, then by AI grade, oldest first.
export function queueOrder(a, b) {
  const pri = s => (s.status === 'urgent_review' ? 0 : 1);
  return pri(a) - pri(b) || (RANK[a.ai_grade] ?? 9) - (RANK[b.ai_grade] ?? 9) || String(a.submitted_at).localeCompare(String(b.submitted_at));
}

export const isGrade = g => GRADES.includes(g) || g === 'inconclusive';
