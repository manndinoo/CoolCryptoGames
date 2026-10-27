import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageFixes, distanceM, nearbyPoles, nextTag } from '../web/js/geo.js';
import { validateReport, SCHEMA } from '../server/ai/policy.mjs';
import { wilsonLower } from '../server/ai/learning.mjs';

test('distance between two points about 111 m apart', () => {
  const d = distanceM({ lat: 46.6, lng: -120.5 }, { lat: 46.601, lng: -120.5 });
  assert.ok(Math.abs(d - 111.2) < 0.5, String(d));
});

test('GPS averaging weights good fixes and drops outliers', () => {
  const now = 1_000_000;
  const base = { lat: 46.6, lng: -120.5 };
  const fixes = [
    { ...base, accuracy: 3, time: now },
    { lat: base.lat + 0.00001, lng: base.lng, accuracy: 3, time: now },
    { lat: base.lat - 0.00001, lng: base.lng, accuracy: 4, time: now },
    { lat: base.lat + 0.001, lng: base.lng, accuracy: 40, time: now }, // a bad fix ~110 m off
  ];
  const est = averageFixes(fixes, { now });
  assert.equal(est.samples, 3);
  assert.equal(est.discarded, 1);
  assert.ok(distanceM(est, base) < 1.5, `estimate drifted ${distanceM(est, base)} m`);
  assert.ok(est.accuracy >= 1 && est.accuracy < 3);
});

test('GPS averaging ignores stale and invalid fixes', () => {
  const now = 1_000_000;
  assert.equal(averageFixes([{ lat: 1, lng: 1, accuracy: 5, time: now - 500000 }], { now }), null);
  assert.equal(averageFixes([{ lat: NaN, lng: 1, accuracy: 5, time: now }], { now }), null);
});

test('nearby poles are sorted nearest first and exclude deleted', () => {
  const poles = [{ id: 'a', lat: 46.6, lng: -120.5 }, { id: 'b', lat: 46.60002, lng: -120.5 }, { id: 'c', lat: 46.60001, lng: -120.5, deleted: 1 }];
  const near = nearbyPoles(poles, { lat: 46.60003, lng: -120.5 }, 10);
  assert.deepEqual(near.map(n => n.pole.id), ['b', 'a']);
});

test('next tag increments the trailing number', () => {
  assert.equal(nextTag('NW-1042'), 'NW-1043');
  assert.equal(nextTag('P009'), 'P010');
  assert.equal(nextTag('17A'), '18A');
  assert.equal(nextTag('ABC'), 'ABC-2');
  assert.equal(nextTag('', 'NW-'), 'NW-1');
});

test('Wilson lower bound is conservative for small samples', () => {
  assert.ok(wilsonLower(6, 6) < 0.75);
  assert.ok(wilsonLower(98, 100) > 0.94);
  assert.equal(wilsonLower(0, 0), 0);
});

const report = over => ({
  summary: 'Split crossarm', grade: 'monitor', confidence: 0.9, rationale: 'r',
  critical_gate: { hazard: '', consequence: '', why_immediate: '' }, structure_observed: 'tangent',
  coverage: { adequate: true, missing_views: [] },
  photos: [{ photo_id: 'p1', view: 'full', quality: 'usable', observations: [] }, { photo_id: 'p2', view: 'top', quality: 'usable', observations: [] }],
  findings: [], additional_photos: [], field_verification: [], ...over,
});

test('report grade is raised to its most urgent finding', () => {
  const r = validateReport(report({ findings: [{ component: 'Crossarm', observation: 'Split', kind: 'visible', grade: 'high', photo_ids: ['p2'], follow_up: 'Assess' }] }), ['p1', 'p2']);
  assert.equal(r.grade, 'high');
  assert.equal(r.flags.length, 1);
});

test('No issues without adequate coverage becomes Needs more evidence', () => {
  assert.equal(validateReport(report({ grade: 'clear', coverage: { adequate: false, missing_views: ['groundline'] } }), ['p1', 'p2']).grade, 'inconclusive');
  assert.equal(validateReport(report({ grade: 'clear' }), ['p1', 'p2']).grade, 'clear');
});

test('findings citing photos that were not sent are rejected', () => {
  assert.throws(() => validateReport(report({ findings: [{ component: 'x', observation: 'y', kind: 'visible', grade: 'monitor', photo_ids: ['p9'], follow_up: '' }] }), ['p1', 'p2']), /not linked/);
});

test('every photo must be accounted for exactly once', () => {
  assert.throws(() => validateReport(report({ photos: [report().photos[0]] }), ['p1', 'p2']), /accounted/);
  assert.throws(() => validateReport(report({ photos: [report().photos[0], report().photos[0]] }), ['p1', 'p2']), /photo ids/);
});

test('Critical with an incomplete gate stays Critical but is flagged', () => {
  const r = validateReport(report({ grade: 'critical' }), ['p1', 'p2']);
  assert.equal(r.grade, 'critical');
  assert.equal(r.gate_complete, false);
});

test('confidence is clamped to 0..1', () => {
  assert.equal(validateReport(report({ confidence: 7 }), ['p1', 'p2']).confidence, 1);
});

test('output schema only uses features structured outputs support', () => {
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) assert.ok(!(banned in node), `${path}.${banned}`);
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
    }
    for (const [k, v] of Object.entries(node.properties || {})) walk(v, `${path}.${k}`);
    if (node.items) walk(node.items, `${path}[]`);
  };
  walk(SCHEMA, 'report');
});
