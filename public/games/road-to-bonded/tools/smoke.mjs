#!/usr/bin/env node
/* Headless browser smoke test via the Chrome DevTools Protocol.
   Serves the game, loads it at several viewports, plays through real UI code paths,
   fails on any console error / uncaught exception, and writes screenshots. */
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = process.argv[2] || path.join(here, '..', 'screenshots');
const chrome = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'].find(existsSync);
if (!chrome) { console.error('no chromium'); process.exit(1); }
mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const bundle = process.env.SMOKE_BUNDLE || '';
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (bundle && p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(readFileSync(bundle)); return; }
  const f = path.join(root, p); if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html`;

const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=390,844', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=/tmp/rtb-chrome-${process.pid}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
let devtoolsUrl = null;
await new Promise((res, rej) => { proc.stderr.on('data', (d) => { const m = String(d).match(/DevTools listening on (ws:\/\/\S+)/); if (m) { devtoolsUrl = m[1]; res(); } }); setTimeout(() => rej(new Error('chrome did not start')), 15000); });
const listPort = devtoolsUrl.match(/:(\d+)\//)[1];
const targets = await (await fetch(`http://127.0.0.1:${listPort}/json`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = []; const logs = []; const warnings = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled') { const txt = m.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '); logs.push(m.params.type + ': ' + txt); if (m.params.type === 'error') errors.push('console.error: ' + txt); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push('exception: ' + (d.exception && d.exception.description || d.text)); }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') { const t = m.params.entry.text; const u = m.params.entry.url || ''; if (/fonts\.g(oogleapis|static)\.com/.test(u) || /coingecko\.com/.test(u) || /favicon\.ico/.test(u) || /navigator\.vibrate/.test(t)) warnings.push('env: ' + t + ' ' + u); else errors.push('log: ' + t + ' ' + u); }
});
const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r.result.value; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64')); };
const viewport = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
const click = async (sel) => { await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(sel)}); if(!el) throw new Error('no element ${sel}'); el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); el.click(); return true;})()`); await sleep(120); };

await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
await viewport(390, 844);
await send('Page.navigate', { url });
await sleep(2200);
const step = (msg) => console.log('· ' + msg);
try {
  step('title screen'); await shot('01-title');
  const hasApp = await evaluate('!!(window.RTB && RTB.App && RTB.App.screen)');
  if (!hasApp) throw new Error('App did not initialise');
  step('roadmap'); await click('#btn-roadmap'); await sleep(500); await shot('02-roadmap');
  step('locked level tap shows requirement'); await evaluate('RTB.App.showLocked(5)'); await sleep(200); await shot('03-locked'); await click('#locked-ok');
  step('pre-level panel'); await evaluate('RTB.App.openPrelevel(1)'); await sleep(300); await shot('04-prelevel');
  step('launch level 1'); await click('#pl-launch'); await sleep(800); await shot('05-level1-tutorial');
  // dismiss tutorials
  for (let i = 0; i < 4; i++) { const open = await evaluate("document.getElementById('m-tutorial').classList.contains('open')"); if (!open) break; await click('#tut-next'); await sleep(200); }
  await sleep(600); await shot('06-level1-board');
  step('invalid swap costs nothing');
  const movesBefore = await evaluate('RTB.App.engine.st.moves');
  await evaluate(`(async()=>{const e=RTB.App.engine; let bad=null; for(let i=0;i<e.st.cells.length-1;i++){ if(e.isMovable(i)&&e.isMovable(i+1)&&(i%e.st.w)<e.st.w-1&&!e.isValidSwap(i,i+1)){bad=[i,i+1];break;} } if(!bad) return 'none'; await RTB.App.trySwap(bad[0],bad[1]); return 'done';})()`);
  await sleep(200);
  const movesAfter = await evaluate('RTB.App.engine.st.moves');
  if (movesAfter !== movesBefore) throw new Error('invalid swap consumed a move');
  step('play level 1 with hint moves until it ends');
  let guard = 0;
  while (guard++ < 60) {
    const status = await evaluate('RTB.App.engine.st.status');
    if (status !== 'READY') break;
    const busy = await evaluate('RTB.App.board.busy || RTB.App.bondedBusy'); if (busy) { await sleep(150); continue; }
    if (await evaluate('RTB.App.engine.bondedReady()')) {
      await evaluate(`(async()=>{const e=RTB.App.engine; const i=e.pillOnBoard(); const nb=e.neighbors(i).find(j=>e.isValidSwap(i,j)); if(nb===undefined) throw new Error('pill has no legal swap'); await RTB.App.trySwap(i,nb);})()`);
      continue;
    }
    const before = await evaluate('RTB.App.engine.st.moves');
    await evaluate(`(async()=>{const e=RTB.App.engine; const h=e.hint(); if(!h) throw new Error('no hint'); await RTB.App.trySwap(h[0],h[1]);})()`);
    const after = await evaluate('RTB.App.engine.st.moves');
    const st = await evaluate('RTB.App.engine.st.status');
    if (st === 'READY' && ![before - 1, before - 2, before].includes(after)) throw new Error('valid swap moved the counter by an unexpected amount');
    if (guard === 2) await shot('08-mid-level');
  }
  const finalStatus = await evaluate('RTB.App.engine.st.status');
  step('level 1 ended with ' + finalStatus);
  await sleep(700); await shot('09-level-end');
  const unlocked = await evaluate('RTB.Save.data.unlocked');
  if (finalStatus === 'WIN' && unlocked !== 2) throw new Error('win did not unlock exactly level 2 (unlocked=' + unlocked + ')');
  if (finalStatus === 'WIN') { step('next level flow'); await click('#win-next'); await sleep(2200); await shot('10-roadmap-after-win'); }
  else { await click('#lose-retry'); await sleep(800); }
  // persistence: start level 2, make a move, reload, verify board restored
  step('BONDED pill swap fires without costing a move');
  await evaluate('RTB.App.modal("m-prelevel", false); RTB.App.startLevel(3, null)'); await sleep(400);
  for (let i = 0; i < 3; i++) { const open = await evaluate("document.getElementById('m-tutorial').classList.contains('open')"); if (!open) break; await click('#tut-next'); await sleep(120); }
  await evaluate('RTB.App.engine.dropPill(); RTB.App.board.sync(); true');
  await sleep(300); await shot('07a-pill-on-board');
  { const before = await evaluate('RTB.App.engine.st.moves'); const bondedBefore = await evaluate('RTB.App.engine.st.bonded');
    const p = evaluate(`(async()=>{const e=RTB.App.engine; const i=e.pillOnBoard(); const nb=e.neighbors(i).find(j=>e.isValidSwap(i,j)); await RTB.App.trySwap(i,nb);})()`);
    await sleep(500); await shot('07b-bonded-cinematic'); await p; await sleep(200); await shot('07c-bonded-after');
    const after = await evaluate('RTB.App.engine.st.moves'); const bondedAfter = await evaluate('RTB.App.engine.st.bonded');
    if (bondedAfter !== bondedBefore + 1) throw new Error('pill swap did not fire BONDED');
    if (after !== before && (await evaluate('RTB.App.engine.st.status')) === 'READY') throw new Error('BONDED pill swap consumed a move'); }
  step('persistence across reload');
  await evaluate('RTB.App.modal("m-prelevel", false); RTB.App.startLevel(2, null)');
  await sleep(500);
  for (let i = 0; i < 4; i++) { const open = await evaluate("document.getElementById('m-tutorial').classList.contains('open')"); if (!open) break; await click('#tut-next'); await sleep(150); }
  await evaluate(`(async()=>{const e=RTB.App.engine; const h=e.hint(); await RTB.App.trySwap(h[0],h[1]);})()`);
  const snap = await evaluate('JSON.stringify({m:RTB.App.engine.st.moves, c:RTB.App.engine.st.cells.map(c=>c.p?c.p.t+(c.p.s??""):"_").join("")})');
  await send('Page.reload'); await sleep(2200);
  await click('#btn-play'); await sleep(800);
  const snap2 = await evaluate('JSON.stringify({m:RTB.App.engine.st.moves, c:RTB.App.engine.st.cells.map(c=>c.p?c.p.t+(c.p.s??""):"_").join("")})');
  if (snap !== snap2) throw new Error('run was not restored exactly after reload');
  await shot('11-restored');
  step('pause + settings'); await click('#btn-pause'); await sleep(200); await shot('12-pause'); await click('#pause-resume');
  step('help screen'); await evaluate('RTB.App._helpBack="s-title"; RTB.App.show("s-help")'); await sleep(300); await shot('13-help');
  step('replay tutorial from help'); await evaluate('(RTB.App.showTutorial("bonded", false), true)'); await sleep(250); await shot('14-tutorial'); await click('#tut-next'); await click('#tut-next'); await click('#tut-next');
  step('milestone + complete screens'); await evaluate('RTB.App.showMilestone(11)'); await sleep(400); await shot('15-milestone');
  await evaluate('RTB.App.show("s-complete"); document.getElementById("cp-stats").textContent="50 / 50 LEVELS"'); await sleep(1500); await shot('16-complete');
  // every level loads and renders
  step('load every level board');
  await evaluate('RTB.CONFIG.releasedLevels = 100; true');
  for (let lv = 1; lv <= 100; lv++) {
    await evaluate(`RTB.App.save.tutorials = Object.fromEntries(Object.keys(RTB.App.save.tutorials||{}).map(k=>[k,true])); RTB.App.startLevel(${lv}, null)`);
    await sleep(60);
    for (let i = 0; i < 3; i++) { const open = await evaluate("document.getElementById('m-tutorial').classList.contains('open')"); if (!open) break; await click('#tut-next'); }
    const ok = await evaluate(`RTB.App.engine.st.id===${lv} && RTB.App.engine.legalSwaps().length>=3`);
    if (!ok) throw new Error('level ' + lv + ' failed to load with legal moves');
    if ([2, 10, 16, 23, 28, 33, 41, 46, 50, 55, 65, 75, 85, 95, 100].includes(lv)) { await sleep(300); await shot('level-' + String(lv).padStart(2, '0')); }
  }
  step('store, bonus level and update gate');
  await evaluate('RTB.App.openStore(); true'); await sleep(900); await shot('store');
  const packs = await evaluate("document.querySelectorAll('#store-packs .pack').length"); if (packs !== 4) throw new Error('store packs missing');
  await click('#store-close');
  await evaluate('RTB.App.save.unlocked = 6; RTB.App.openMap(5); true'); await sleep(400); await shot('roadmap-bonus');
  await evaluate('RTB.App.openPrelevel(1005); true'); await sleep(300); await shot('prelevel-bonus'); await click('#pl-launch'); await sleep(500);
  for (let i = 0; i < 3; i++) { const open = await evaluate("document.getElementById('m-tutorial').classList.contains('open')"); if (!open) break; await click('#tut-next'); await sleep(120); }
  const livesBefore = await evaluate('RTB.Save.lives()');
  await evaluate('RTB.App.engine.st.moves = 1; RTB.App.updateHud(RTB.App.engine.hud()); true');
  await evaluate(`(async()=>{const e=RTB.App.engine; const h=e.hint(); await RTB.App.trySwap(h[0],h[1]);})()`); await sleep(400);
  const livesAfter = await evaluate('RTB.Save.lives()'); if (livesAfter !== livesBefore) throw new Error('bonus level cost a life');
  await shot('bonus-end'); await evaluate("document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open')); true");
  await evaluate('RTB.App.showSoon(51); true'); await sleep(200); await shot('soon'); await click('#locked-ok');
  await evaluate('RTB.App.save.unlocked = 2; true');
  step('dark mode');
  await evaluate('RTB.App.save.settings.dark = true; RTB.App.applySettings(); RTB.App.title(); true'); await sleep(300); await shot('dark-title');
  await evaluate('RTB.App.openMap(3); true'); await sleep(400); await shot('dark-roadmap');
  await evaluate('RTB.App.startLevel(3, null); true'); await sleep(400); await shot('dark-level-03');
  await click('#btn-pause'); await sleep(200); await shot('dark-pause'); await click('#pause-resume');
  await evaluate('RTB.App.save.settings.dark = false; RTB.App.applySettings(); true');
  await evaluate('RTB.CONFIG.releasedLevels = 50; true');
  step('other viewports');
  for (const [w, h] of [[320, 568], [360, 800], [430, 932], [768, 1024], [1280, 800]]) { await viewport(w, h); await evaluate('RTB.App.startLevel(20, null)'); await sleep(350); await shot(`vp-${w}x${h}`); }
  await viewport(844, 390); await sleep(200); await shot('vp-landscape');
} catch (err) { errors.push('test: ' + err.message); }

console.log('\nconsole log lines: ' + logs.length + (warnings.length ? '\nenvironment warnings (ignored): ' + warnings.length : ''));
if (errors.length) { console.log('ERRORS:'); for (const e of errors) console.log('  ' + e); }
else console.log('NO ERRORS');
ws.close(); proc.kill('SIGKILL'); server.close();
process.exit(errors.length ? 1 : 0);
