#!/usr/bin/env node
/* Level verification harness: validates every level config, finds tested seed
   pools with a greedy solver bot, checks determinism and board fillability,
   and writes js/seeds.js. Usage: node tools/verify.mjs [--levels 1-50] [--seeds 3] [--tries 14] [--write] */
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
require(path.join(here, '../js/rng.js'));
require(path.join(here, '../js/engine.js'));
require(path.join(here, '../js/config.js'));
require(path.join(here, '../js/levels.js'));
require(path.join(here, '../js/levels2.js'));
const RTB = globalThis.RTB;
const { Engine, LEVELS } = RTB;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const range = opt('--levels', '1-100').split('-').map(Number);
const withBonus = args.includes('--bonus');
const wantSeeds = parseInt(opt('--seeds', '3'), 10);
const tries = parseInt(opt('--tries', '14'), 10);
const write = args.includes('--write');
const verbose = args.includes('--v');

function countBoard(L) {
  const e = Engine.create(L, 1, 0); const st = e.st; const cnt = { dust: 0, paper: 0, fud: 0, wall: 0, halt: 0, node: 0, printer: 0, wallet: Object.keys(st.wallets).length, keys: (st.keys ? st.keys.left : 0) + st.cells.filter(c => c.p && c.p.t === 'key').length + Object.values(st.wallets).filter(w => w.contents === 'keys').length, capsule: (st.caps ? st.caps.left : 0) + st.cells.filter(c => c.p && c.p.t === 'cap').length };
  for (const c of st.cells) { cnt.dust += c.dust; cnt.paper += c.paper; cnt.fud += c.fud; if (c.bl) { if (c.bl.k === 'wall') cnt.wall++; if (c.bl.k === 'halt') cnt.halt++; if (c.bl.k === 'node') cnt.node++; if (c.bl.k === 'printer') cnt.printer++; } }
  for (const o of L.objectives) { if (cnt[o.t] !== undefined && o.t !== 'fud' && cnt[o.t] < o.n) throw new Error(`Level ${L.id}: objective ${o.t} needs ${o.n} but board only has ${cnt[o.t]}`); if (cnt[o.t] !== undefined && o.t !== 'fud' && cnt[o.t] > o.n && ['dust','paper','halt','node','printer','wallet','keys','capsule'].includes(o.t)) console.warn(`  note L${L.id}: board has ${cnt[o.t]} ${o.t} but objective is ${o.n}`); }
  // portal cycle check
  for (const p of st.portals) {
    let cur = p.to; const seen = new Set([p.from]); let guard = 0;
    while (guard++ < 50) {
      // fall to bottom of the column segment from cur
      let i = cur; while (true) { const j = e.downOf(i); if (j < 0 || !st.cells[j].a || st.cells[i].pout >= 0) break; i = j; }
      if (st.cells[i].pout < 0) break;
      if (seen.has(i)) throw new Error(`Level ${L.id}: portal cycle through cell ${i}`);
      seen.add(i); cur = st.cells[i].pout;
    }
  }
}
function validateLevel(L) {
  countBoard(L);
  if (L.grid.length !== L.h) throw new Error(`Level ${L.id}: grid has ${L.grid.length} rows, expected ${L.h}`);
  L.grid.forEach((r, i) => { const n = r.trim().split(/\s+/).length; if (n !== L.w) throw new Error(`Level ${L.id}: row ${i} has ${n} tokens, expected ${L.w}`); });
  if (L.stages) for (const s of L.stages) { if (s.grid.length !== L.h) throw new Error(`Level ${L.id} stage grid rows`); s.grid.forEach((r, i) => { const n = r.trim().split(/\s+/).length; if (n !== L.w) throw new Error(`Level ${L.id} stage row ${i}`); }); }
}

function evalState(e) {
  const st = e.st; let v = 0;
  for (const o of st.obj) {
    const left = e.objRemaining(o);
    const weight = o.t === 'capsule' ? 260 : o.t === 'keys' ? 200 : o.t === 'wallet' ? 220 : o.t === 'halt' ? 150 : o.t === 'fud' ? 120 : o.t === 'combo' ? 300 : o.t === 'sweep' ? 250 : o.t === 'bonded' ? 400 : o.t === 'burst' ? 200 : o.t === 'candle' ? 120 : o.t === 'printer' ? 200 : o.t === 'node' ? 150 : 60;
    v -= left * weight;
  }
  // capsule descent progress
  const capO = st.obj.find(o => o.t === 'capsule');
  if (capO) for (let i = 0; i < st.cells.length; i++) { const c = st.cells[i]; if (c.p && c.p.t === 'cap') v += Math.floor(i / st.w) * 12; }
  // blocker health
  for (const c of st.cells) { if (c.bl && c.bl.k !== 'gate' && !(c.bl.k === 'node' && c.bl.ch)) v -= (c.bl.hp || 1) * 25; if (c.fud) v -= 30; if (c.paper) v -= 20; v -= c.dust * 18; }
  for (const w of Object.values(st.wallets)) v -= w.hp * 25;
  // specials on board are latent value
  for (const c of st.cells) if (c.p && c.p.t === 'sp') v += c.p.k === 'sweep' ? 70 : c.p.k === 'bot' ? 45 : c.p.k === 'burst' ? 45 : 35; else if (c.p && c.p.t === 'pill') v += 30;
  v += st.charge * 2.5 + st.score * 0.03 + st.stage * 20000;
  if (st.status === 'WIN') v += 100000;
  if (st.status === 'LOSE') v -= 100000;
  return v;
}

function botPlay(L, seed) {
  const e = Engine.create(L, seed, 0);
  const moves = [];
  const legal0 = e.legalSwaps().length;
  if (e.findMatches().matched.size) return { ok: false, reason: 'opening match' };
  if (legal0 < 3) return { ok: false, reason: 'few opening moves' };
  let guard = 0;
  while (e.st.status === 'READY' && guard++ < 400) {
    checkFilled(e, L);
    const swaps = e.legalSwaps();
    if (!swaps.length) return { ok: false, reason: 'no legal swaps despite reset' };
    let best = null, bv = -Infinity;
    for (const [a, b] of swaps) {
      const c = e.clone(); c.applySwap(a, b);
      const v = evalState(c);
      if (v > bv) { bv = v; best = [a, b]; }
    }
    const before = e.st.moves;
    e.applySwap(best[0], best[1]);
    const pillSwap = e.st.cells[best[0]] && false; void pillSwap;
    if (![before - 1, before - 2, before].includes(e.st.moves) && e.st.status !== 'WIN') throw new Error('move count mismatch');
    moves.push(best);
  }
  const left = e.st.obj.map(o => o.t + (o.s !== undefined ? o.s : '') + ':' + e.objRemaining(o)).join(' ');
  return { ok: e.st.status === 'WIN', status: e.st.status, left, movesLeft: e.st.moves, score: e.st.score, moves, resets: e.st.resets, bonded: e.st.bonded, legal0, st: e.st };
}

function checkFilled(e, L) {
  // static fillability: every active cell must have some potential fill route
  const w = e.st.w;
  for (let i = 0; i < e.st.cells.length; i++) {
    const c = e.st.cells[i]; if (!c.a || c.p || c.bl) continue;
    const [r, cc] = e.rc(i);
    const act = (rr, x) => e.inb(rr, x) && e.st.cells[rr * w + x].a;
    const ok = c.sp || c.pin >= 0 || act(r - 1, cc) || act(r - 1, cc - 1) || act(r - 1, cc + 1);
    if (!ok) throw new Error(`Level ${L.id}: cell ${i} can never be filled`);
  }
}

function replay(L, seed, moves) {
  const e = Engine.create(L, seed, 0);
  for (const m of moves) e.applySwap(m[0], m[1]);
  return JSON.stringify(e.st);
}

const results = {};
const targetsOut = existsSync(path.join(here, '../js/seeds.js')) ? (() => { try { const src = readFileSync(path.join(here, '../js/seeds.js'), 'utf8'); const m = src.match(/RTB\.SCORE_TARGETS = (\{[\s\S]*?\});/); return m ? JSON.parse(m[1]) : {}; } catch { return {}; } })() : {};
const seedsOut = existsSync(path.join(here, '../js/seeds.js')) ? (() => { try { const src = readFileSync(path.join(here, '../js/seeds.js'), 'utf8'); const m = src.match(/RTB\.SEEDS = (\{[\s\S]*?\});/); return m ? JSON.parse(m[1]) : {}; } catch { return {}; } })() : {};
let allOk = true;
const ALL = withBonus ? LEVELS.concat(RTB.BONUS) : LEVELS;
for (const L of ALL) {
  if (!L.bonus && (L.id < range[0] || L.id > range[1])) continue;
  validateLevel(L);
  const t0 = Date.now();
  const wins = []; let played = 0, won = 0; const scores = [];
  for (let k = 0; k < tries && wins.length < wantSeeds + 2; k++) {
    const seed = L.id * 1000 + k * 7 + 11;
    let r;
    try { r = botPlay(L, seed); } catch (err) { console.error(`Level ${L.id} seed ${seed}: ${err.message}`); allOk = false; continue; }
    if (r.reason) { if (verbose) console.log(`  L${L.id} seed ${seed} rejected: ${r.reason}`); continue; }
    played++;
    if (r.ok) {
      won++; scores.push(r.score);
      // determinism check
      const a = replay(L, seed, r.moves), b = replay(L, seed, r.moves);
      if (a !== b) { console.error(`Level ${L.id}: NON-DETERMINISTIC replay for seed ${seed}`); allOk = false; }
      if (JSON.stringify(r.st) !== a) { console.error(`Level ${L.id}: replay diverges from live play (seed ${seed})`); allOk = false; }
      wins.push({ seed, movesLeft: r.movesLeft, score: r.score });
    }
    if (verbose) console.log(`  L${L.id} seed ${seed}: ${r.status} left=${r.movesLeft} score=${r.score} resets=${r.resets} bonded=${r.bonded} obj[${r.left}]`);
  }
  const rate = played ? Math.round(100 * won / played) : 0;
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  L._botAvg = avg;
  results[L.id] = { name: L.name, played, won, rate, avgScore: avg, seeds: wins.slice(0, wantSeeds + 2).map(w => w.seed), avgLeft: wins.length ? (wins.reduce((a, w) => a + w.movesLeft, 0) / wins.length).toFixed(1) : '-' };
  const ok = wins.length >= wantSeeds;
  if (!ok) allOk = false;
  console.log(`L${String(L.id).padStart(2)} ${L.name.padEnd(18)} bot win ${String(won).padStart(2)}/${String(played).padStart(2)} (${String(rate).padStart(3)}%) avgLeft=${String(results[L.id].avgLeft).padStart(4)} avgScore=${String(avg).padStart(6)} seeds=${wins.length} ${ok ? 'OK' : 'NEEDS WORK'} ${Date.now() - t0}ms`);
  if (ok) seedsOut[L.id] = wins.slice(0, wantSeeds + 2).map(w => w.seed);
  if (ok) targetsOut[L.id] = [Math.round(avg * 0.45 / 100) * 100, Math.round(avg * 0.8 / 100) * 100];
}
if (write) {
  const src = `'use strict';\n/* Tested seed pools per level (generated by tools/verify.mjs). Every seed has a verified winning route within the move budget, no opening match and at least three legal opening moves. */\n(function(){ const RTB = globalThis.RTB || (globalThis.RTB = {}); RTB.SEEDS = ${JSON.stringify(seedsOut)}; RTB.SCORE_TARGETS = ${JSON.stringify(targetsOut)}; })();\n`;
  writeFileSync(path.join(here, '../js/seeds.js'), src);
  console.log('wrote js/seeds.js');
}
console.log(allOk ? 'ALL LEVELS VERIFIED' : 'SOME LEVELS NEED WORK');
process.exit(allOk ? 0 : 1);
