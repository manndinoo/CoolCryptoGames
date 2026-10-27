// Loads the eight historical test photos from Linewatch v1 as a demo line.
// Locations are SIMULATED (the real photo locations are unknown) and marked as
// such in every pole's notes. Each pole gets a submitted inspection, so with an
// AI key set the server grades them and they land in the review queue.
//
//   npm run seed:demo            (run after creating the admin account)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, now, tx } from '../server/db.mjs';
import { distanceM } from '../web/js/geo.js';
import { loadEnv } from '../server/env.mjs';

loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.LINEWATCH_DATA_DIR || 'data');
const db = openDb(dataDir);
const admin = db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`).get();
if (!admin) { console.error('Create the admin account in the app first, then run this again.'); process.exit(1); }
if (db.prepare(`SELECT 1 AS x FROM lines WHERE id = 'demo-line'`).get()) { console.log('Demo line already loaded.'); process.exit(0); }

const dataset = JSON.parse(fs.readFileSync(path.join(root, 'demo/photo-tests-v1.json'), 'utf8'));
const t = now();
const STRUCTURE = { 'Steel tower': ['tower', 'lattice'], 'Wood pole': ['tangent', 'wood'], 'Concrete pole': ['tangent', 'concrete'] };

tx(db, () => {
  db.prepare(`INSERT INTO lines (id, name, kind, voltage, color, tag_prefix, notes, created_by, created_at, updated_at) VALUES ('demo-line', 'DEMO · historical photos (simulated locations)', 'distribution', '', '#e8590c', 'DEMO-', 'Photos from Wikimedia Commons; see demo/photos/ATTRIBUTION.txt. Locations are simulated.', ?, ?, ?)`).run(admin.id, t, t);
  let prev = null, prevPos = null;
  dataset.records.forEach((r, i) => {
    const poleId = `demo-pole-${i + 1}`, insId = `demo-insp-${i + 1}`;
    const [structure, material] = STRUCTURE[r.type] || ['tangent', 'wood'];
    const lat = 46.608 + i * 0.0006, lng = -120.598 + i * 0.0009 * (i % 2 ? 1 : 0.8);
    db.prepare(`INSERT INTO poles (id, tag, line_id, lat, lng, accuracy_m, gps_samples, location_source, structure, material, notes, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,NULL,0,'import',?,?,?,?,?,?)`)
      .run(poleId, `DEMO-${String(i + 1).padStart(2, '0')}`, 'demo-line', lat, lng, structure, material, `SIMULATED location. v1 provisional assessment: ${r.finding}`, admin.id, t, t);
    if (prev) db.prepare(`INSERT INTO spans (id, from_pole, to_pole, line_id, length_m, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(`demo-span-${i}`, prev, poleId, 'demo-line', Math.round(distanceM(prevPos, { lat, lng }) * 10) / 10, admin.id, t, t);
    prev = poleId; prevPos = { lat, lng };
    const file = `pole-0${i + 1}.jpg`;
    const dest = path.join(dataDir, 'photos', poleId);
    fs.mkdirSync(dest, { recursive: true });
    const buf = fs.readFileSync(path.join(root, 'demo/photos', file));
    const photoId = `demo-photo-${i + 1}`;
    fs.writeFileSync(path.join(dest, `${photoId}.jpg`), buf);
    db.prepare(`INSERT INTO inspections (id, pole_id, inspector_id, notes, status, ai_status, submitted_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(insId, poleId, admin.id, 'Demo: historical photo. Grade from the photo only.', process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ? 'submitted' : 'needs_review', process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ? 'queued' : 'none', t, t, t);
    db.prepare(`INSERT INTO photos (id, inspection_id, pole_id, file, mime, bytes, view, uploaded_by, taken_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(photoId, insId, poleId, `${poleId}/${photoId}.jpg`, 'image/jpeg', buf.length, '', admin.id, t, t);
  });
});
console.log(`Loaded ${dataset.records.length} demo poles. Start the server; with an AI key set they will be graded and appear under Review.`);
