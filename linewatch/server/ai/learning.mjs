// How the AI earns its way out of human review.
//
// 1. Every human review of an AI grade is a labelled example. Reviewer
//    override reasons become "lessons", and recent reviewed cases (overrides
//    first, because they teach the most) are fed back into every prompt.
// 2. For each grade the AI predicts, agreement with the human is measured on
//    a rolling window. Trust is the Wilson lower bound of that agreement, so a
//    lucky streak of 6/6 does not count as proof.
// 3. A grade is accepted without review only when the admin has allowed
//    autonomy for it, it has enough samples, its trust bound clears the bar,
//    no severe under-call happened recently, the AI is confident, and the
//    report is clean. Even then a random share is still sent to a person, so
//    the measurement never goes stale.
// Critical is never finalised by the AI alone.
import { GRADES, RANK, GRADE_INFO } from '../../web/js/grades.js';
import { getSetting, setSetting } from '../db.mjs';

export const DEFAULT_AUTONOMY = {
  enabled: false,          // master switch: off means every inspection is reviewed
  minSamples: 25,          // human-reviewed predictions of a grade before it can be trusted
  minAgreement: 0.9,       // required lower bound on agreement
  minConfidence: 0.8,      // AI's own confidence for this inspection
  auditRate: 0.1,          // share of eligible inspections still sent to a person
  window: 200,             // most recent reviews used for measurement
  grades: { high: false, monitor: true, clear: true },
};

export function getAutonomy(db) {
  const saved = getSetting(db, 'autonomy', {});
  return { ...DEFAULT_AUTONOMY, ...saved, grades: { ...DEFAULT_AUTONOMY.grades, ...(saved.grades || {}) } };
}

export function saveAutonomy(db, input) {
  const cur = getAutonomy(db);
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const next = {
    enabled: input.enabled === undefined ? cur.enabled : !!input.enabled,
    minSamples: Math.round(num(input.minSamples, 5, 5000, cur.minSamples)),
    minAgreement: num(input.minAgreement, 0.5, 0.999, cur.minAgreement),
    minConfidence: num(input.minConfidence, 0, 1, cur.minConfidence),
    auditRate: num(input.auditRate, 0, 1, cur.auditRate),
    window: Math.round(num(input.window, 20, 10000, cur.window)),
    grades: { high: !!(input.grades?.high ?? cur.grades.high), monitor: !!(input.grades?.monitor ?? cur.grades.monitor), clear: !!(input.grades?.clear ?? cur.grades.clear) },
  };
  setSetting(db, 'autonomy', next);
  return next;
}

// One-sided 95% Wilson lower bound for k successes in n trials.
export function wilsonLower(k, n, z = 1.645) {
  if (!n) return 0;
  const p = k / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

const AI_GRADES = [...GRADES, 'inconclusive'];

// Human-reviewed AI predictions, newest first.
function reviewedPairs(db, window) {
  return db.prepare(`SELECT id, ai_grade, final_grade, ai_confidence, reviewed_at FROM inspections
    WHERE final_source = 'human' AND ai_grade IS NOT NULL AND final_grade IS NOT NULL
    ORDER BY reviewed_at DESC LIMIT ?`).all(window);
}

export function computeMetrics(db, settings = getAutonomy(db)) {
  const pairs = reviewedPairs(db, settings.window);
  const matrix = Object.fromEntries(AI_GRADES.map(a => [a, Object.fromEntries(AI_GRADES.map(h => [h, 0]))]));
  for (const p of pairs) if (matrix[p.ai_grade] && p.final_grade in matrix[p.ai_grade]) matrix[p.ai_grade][p.final_grade]++;

  const perGrade = {};
  for (const g of AI_GRADES) {
    const mine = pairs.filter(p => p.ai_grade === g);
    const agree = mine.filter(p => p.final_grade === g).length;
    // Severe under-call: the AI said this grade but a person found something at
    // least two levels more urgent (e.g. AI "No issues", human "Priority").
    // Counted over the 50 most recent predictions of this grade, so one old
    // miss does not block a grade forever once it has been fixed.
    const severe = mine.slice(0, 50).filter(p => GRADES.includes(p.final_grade) && GRADES.indexOf(g) - GRADES.indexOf(p.final_grade) >= 2).length;
    const under = mine.filter(p => RANK[p.final_grade] < RANK[g]).length;
    const trust = wilsonLower(agree, mine.length);
    const allowed = g === 'critical' ? false : g === 'inconclusive' ? false : !!settings.grades[g];
    const reasons = [];
    if (g === 'critical') reasons.push('Critical is always confirmed by a person.');
    else if (g === 'inconclusive') reasons.push('Needs-more-evidence always goes to a person.');
    else if (!allowed) reasons.push('Autonomy is not allowed for this grade.');
    if (mine.length < settings.minSamples) reasons.push(`${mine.length} of ${settings.minSamples} reviewed samples.`);
    if (mine.length && trust < settings.minAgreement) reasons.push(`Trust ${(trust * 100).toFixed(0)}% is below ${(settings.minAgreement * 100).toFixed(0)}%.`);
    if (severe) reasons.push(`${severe} severe under-call${severe > 1 ? 's' : ''} in the window.`);
    perGrade[g] = {
      grade: g, label: GRADE_INFO[g].label, samples: mine.length, agree, under, severe,
      agreement: mine.length ? agree / mine.length : null, trust,
      autonomous: settings.enabled && allowed && mine.length >= settings.minSamples && trust >= settings.minAgreement && severe === 0,
      reasons,
    };
  }

  // Of the structures a person graded Critical, how many did the AI also call Critical?
  const humanCritical = pairs.filter(p => p.final_grade === 'critical');
  const criticalRecall = humanCritical.length ? humanCritical.filter(p => p.ai_grade === 'critical').length / humanCritical.length : null;
  const agreeAll = pairs.filter(p => p.ai_grade === p.final_grade).length;

  // Confidence calibration: within each confidence band, how often was the AI right?
  const bands = [[0, 0.5], [0.5, 0.7], [0.7, 0.85], [0.85, 0.95], [0.95, 1.01]].map(([lo, hi]) => {
    const inBand = pairs.filter(p => p.ai_confidence != null && p.ai_confidence >= lo && p.ai_confidence < hi);
    return { lo, hi: Math.min(1, hi), n: inBand.length, accuracy: inBand.length ? inBand.filter(p => p.ai_grade === p.final_grade).length / inBand.length : null };
  });

  // Agreement over time, oldest to newest, in blocks of 10 reviews.
  const chrono = [...pairs].reverse();
  const trend = [];
  for (let i = 0; i < chrono.length; i += 10) {
    const block = chrono.slice(i, i + 10);
    trend.push({ upTo: block.at(-1).reviewed_at, n: block.length, agreement: block.filter(p => p.ai_grade === p.final_grade).length / block.length });
  }

  const autoCount = db.prepare(`SELECT COUNT(*) AS n FROM inspections WHERE final_source = 'ai'`).get().n;
  return {
    settings, reviewed: pairs.length, agreement: pairs.length ? agreeAll / pairs.length : null,
    criticalRecall, humanCritical: humanCritical.length, matrix, perGrade, bands, trend, autoApproved: autoCount,
  };
}

// Decide what happens to a finished AI report: accept it, or send it to a person.
export function decide(db, { grade, confidence, report }, rng = Math.random) {
  const settings = getAutonomy(db);
  const metrics = computeMetrics(db, settings);
  const g = metrics.perGrade[grade];
  const reasons = [];
  if (grade === 'critical') return { action: 'urgent_review', reasons: ['Critical grade: a person must confirm immediately.'] };
  if (!settings.enabled) return { action: 'review', reasons: ['Autonomy is off. Every inspection is reviewed.'] };
  if (!g || !g.autonomous) reasons.push(...(g?.reasons?.length ? g.reasons : ['This grade is not trusted yet.']));
  if (confidence < settings.minConfidence) reasons.push(`AI confidence ${(confidence * 100).toFixed(0)}% is below ${(settings.minConfidence * 100).toFixed(0)}%.`);
  if (report.flags?.length) reasons.push('The report was corrected by policy checks.');
  if (!report.coverage?.adequate) reasons.push('Photo coverage is not adequate.');
  if (report.field_verification?.length) reasons.push('The AI asked for field verification.');
  if (report.findings?.some(f => f.kind === 'suspected' && RANK[f.grade] <= RANK.high)) reasons.push('A suspected serious condition needs a person.');
  if (reasons.length) return { action: 'review', reasons };
  if (rng() < settings.auditRate) return { action: 'review', audit: true, reasons: ['Random audit: a share of trusted results is still checked so accuracy stays measured.'] };
  return { action: 'auto', reasons: [`${g.label} is trusted: ${(g.trust * 100).toFixed(0)}% agreement lower bound over ${g.samples} reviews, confidence ${(confidence * 100).toFixed(0)}%.`] };
}

// The utility-specific context sent with every inspection prompt.
export function buildContext(db, pole, { maxCases = 12, maxLessons = 40 } = {}) {
  const lessons = db.prepare('SELECT text FROM lessons WHERE active = 1 ORDER BY created_at DESC LIMIT ?').all(maxLessons);
  const rows = db.prepare(`SELECT i.ai_grade, i.final_grade, i.ai_report, i.review, p.structure, p.material
    FROM inspections i JOIN poles p ON p.id = i.pole_id
    WHERE i.final_source = 'human' AND i.ai_grade IS NOT NULL AND i.pole_id != ?
    ORDER BY i.reviewed_at DESC LIMIT 300`).all(pole?.id ?? '');
  // Overrides first, then the same structure type, then everything else; at
  // most a few per final grade so one grade cannot dominate.
  const score = r => (r.ai_grade !== r.final_grade ? 2 : 0) + (pole && r.structure === pole.structure ? 1 : 0);
  const picked = [], perGrade = {};
  for (const r of [...rows].sort((a, b) => score(b) - score(a))) {
    if ((perGrade[r.final_grade] || 0) >= Math.ceil(maxCases / 3)) continue;
    perGrade[r.final_grade] = (perGrade[r.final_grade] || 0) + 1;
    picked.push(r);
    if (picked.length >= maxCases) break;
  }
  const lines = [];
  if (lessons.length) {
    lines.push('## Reviewer lessons from this utility', ...lessons.map(l => `- ${l.text}`));
  }
  if (picked.length) {
    lines.push('', '## Calibration cases (text only; earlier structures graded by this utility\'s reviewers)');
    for (const r of picked) {
      const rep = safeJson(r.ai_report), rev = safeJson(r.review);
      const findings = (rep?.findings || []).slice(0, 4).map(f => `${f.component}: ${f.observation} [${f.grade}]`).join('; ');
      lines.push(`- ${r.structure}/${r.material}. AI graded ${r.ai_grade}: "${rep?.summary ?? ''}"${findings ? ` Findings: ${findings}.` : ''} Reviewer final grade: ${r.final_grade}.${rev?.reason ? ` Reviewer reason: "${rev.reason}"` : ''}${rev?.missed ? ` AI missed: "${rev.missed}"` : ''}`);
    }
  }
  return lines.join('\n');
}

const safeJson = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
