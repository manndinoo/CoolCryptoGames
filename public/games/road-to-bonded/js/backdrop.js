'use strict';
/* Per-level animated backdrops. Five regions, each with its own world, and
   every level inside a region gets its own scene name, palette shift and
   decoration mix so no two boards feel the same. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  const TAU = Math.PI * 2;

  const SCENES = [
    'CLEAN ROOM', 'TICKER DESK', 'GREEN LAB', 'WICK BENCH', 'HOLDER FLOOR', 'PILL VAULT', 'VOLUME BAY', 'QUEUE HALL', 'CURVE DECK', 'LAUNCH PAD',
    'DAWN RIDGE', 'NARROW PASS', 'PAPER CLIFFS', 'DIP VALLEY', 'LOCKED FALLS', 'CURVE BEND', 'FALSE PEAK', 'RED WALL', 'LAST PERCENT', 'BOND POINT',
    'PAIR INLET', 'DEEP POOL', 'SLIPPAGE PIPE', 'RED BARRIER', 'SPLIT ROUTE', 'FUD LOCK', 'WHALE WAKE', 'CROSSED FLOW', 'DEEP BOOK', 'MARKET OPEN',
    'RADAR ROOF', 'REPLY TOWER', 'FEED ALLEY', 'BOT STACK', 'FUD FRONT', 'TREND STRIP', 'HYPE RELAY', 'SIGNAL JAM', 'BREAKOUT BLVD', 'FRONT PAGE',
    'HIGH WICK', 'GATE STATION', 'RED ZONE', 'HOLDER RING', 'WHALE ORBIT', 'CRUNCH BELT', 'REVERSAL ARC', 'BREAKOUT DOCK', 'FINAL CURVE', 'ALL-TIME HIGH',
    'DEEP DIVE', 'BUBBLE TRAP', 'WHALE ALERT', 'UNDERTOW', 'KELP LOCK', 'SONAR ROOM', 'TIDE PORTAL', 'BLOWHOLE', 'TRENCH', 'WHALE WATERS',
    'DUST DEVIL', 'MARGIN CALL', 'LIQUIDATION', 'SANDSTORM', 'CANYON RUN', 'HEAT HAZE', 'MESA', 'LEVERAGE', 'CLIFF EDGE', 'LEVERAGE CANYON',
    'FIRST SNOW', 'PARACHUTE', 'AVALANCHE', 'ICE SHELF', 'FROST NODES', 'SNOWDRIFT', 'SUMMIT PUSH', 'WHITEOUT', 'CREVASSE', 'AIRDROP ALPS',
    'IGNITION', 'LAVA LANES', 'CORE SAMPLE', 'ERUPTION', 'ASH CLOUD', 'MAGMA GATE', 'FLASHPOINT', 'HALT STORM', 'MELTDOWN', 'MELTDOWN CORE',
    'DIAMOND DUST', 'PRESSURE', 'FACET', 'CUT', 'CLARITY', 'CARAT', 'POLISH', 'SETTING', 'FINAL FACET', 'DIAMOND HANDS',
  ];

  const THEMES = {
    lab: { light: true, bg: ['#fbf7ee', '#eef6ef'], ink: '#17423d', accent: '#3fd987' },
    climb: { light: false, bg: ['#0f2f2b', '#1c5747'], ink: '#dff7ea', accent: '#3fd987' },
    junction: { light: false, bg: ['#06151b', '#0d2b36'], ink: '#c9f4ff', accent: '#29c8ef' },
    city: { light: false, bg: ['#0a0a1f', '#1a1240'], ink: '#e2d4ff', accent: '#9b6cff' },
    orbit: { light: false, bg: ['#03080b', '#0c2a24'], ink: '#dff7ea', accent: '#3fd987' },
    ocean: { light: false, bg: ['#03131f', '#0a3a4a'], ink: '#d6f6ff', accent: '#29c8ef' },
    canyon: { light: false, bg: ['#1d0c08', '#5a2414'], ink: '#ffe6d6', accent: '#f2b418' },
    alps: { light: true, bg: ['#e9f3ff', '#c9dcf2'], ink: '#17323d', accent: '#29c8ef' },
    core: { light: false, bg: ['#0f0404', '#3a0d0d'], ink: '#ffe0da', accent: '#ff6b5b' },
    diamond: { light: false, bg: ['#06081a', '#1a1e4a'], ink: '#eef2ff', accent: '#c9b6ff' },
  };

  function hsl(h, s, l, a) { return `hsla(${h},${s}%,${l}%,${a === undefined ? 1 : a})`; }

  class Backdrop {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.level = null; this.running = false; this.items = []; this.W = 0; this.H = 0; this.reduced = false; }
    resize() { const p = this.canvas.parentElement; const dpr = Math.min(window.devicePixelRatio || 1, 1.5); this.W = p.clientWidth; this.H = p.clientHeight; this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr); this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this._still = null; }
    setLevel(L) {
      this.level = L; const R = RTB.regionOf(L.id); this.theme = R.theme; this.p = (L.id - R.from) / 9; this.rng = RTB.Rng.create('scene' + L.id);
      this.hue = ((L.id * 47) % 40) - 20; this.items = []; this._still = null;
      const rnd = () => RTB.Rng.next(this.rng);
      const n = this.theme === 'orbit' || this.theme === 'diamond' ? 120 : this.theme === 'city' ? 40 : this.theme === 'alps' ? 90 : 60;
      for (let i = 0; i < n; i++) this.items.push({ x: rnd(), y: rnd(), s: 0.4 + rnd() * 1.6, v: 0.2 + rnd() * 0.8, k: Math.floor(rnd() * 4), ph: rnd() * TAU });
      this.buildings = []; let x = -0.05; while (x < 1.1) { const w = 0.05 + rnd() * 0.09; this.buildings.push({ x, w, h: 0.12 + rnd() * 0.3 + this.p * 0.1, win: Math.floor(rnd() * 3) }); x += w + 0.01; }
      this.ridges = [0, 1, 2].map(k => ({ pts: Array.from({ length: 14 }, (_, i) => 0.55 + k * 0.1 - Math.pow(i / 13, 1.4) * (0.35 - k * 0.06) + Math.sin(i * 1.9 + k) * 0.03 + rnd() * 0.02) }));
      this.resize();
    }
    start() { if (this.running) return; this.running = true; const loop = () => { if (!this.running) return; this.frame(performance.now()); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
    stop() { this.running = false; }
    frame(t) {
      const ctx = this.ctx; const W = this.W, H = this.H; if (!W || !this.level) return;
      if (this.reduced) t = 0;
      const th = THEMES[this.theme]; const p = this.p; const hue = this.hue;
      ctx.clearRect(0, 0, W, H);
      const fn = this['_' + this.theme] || this._orbit; fn.call(this, ctx, W, H, t, p, hue, th);
    }
    _lab(ctx, W, H, t, p, hue) {
      const dark = this.dark;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      if (dark) { g.addColorStop(0, hsl(170 + hue, 40, 8)); g.addColorStop(1, hsl(155 + hue, 45, 13 + p * 3)); } else { g.addColorStop(0, hsl(45 + hue, 45, 96)); g.addColorStop(1, hsl(150 + hue, 35, 92 - p * 6)); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const rg = ctx.createRadialGradient(W * (0.3 + p * 0.4), H * 0.2, 0, W * (0.3 + p * 0.4), H * 0.2, W * 0.8); rg.addColorStop(0, hsl(150 + hue, 70, dark ? 40 : 85, dark ? 0.28 : 0.55)); rg.addColorStop(1, hsl(150, 70, 85, 0)); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = dark ? 'rgba(125,255,187,.08)' : 'rgba(23,66,61,.09)'; ctx.lineWidth = 1; const gs = 26 + Math.round(p * 10);
      for (let x = 0; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      // glass vessels along the bottom
      const vesselFill = dark ? 'rgba(125,255,187,.05)' : 'rgba(23,66,61,.07)'; ctx.fillStyle = vesselFill; ctx.strokeStyle = dark ? 'rgba(125,255,187,.22)' : 'rgba(23,66,61,.16)'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const bx = W * (0.08 + i * 0.21) + Math.sin(i) * 8; const bh = H * (0.08 + ((i * 7) % 3) * 0.03); const bw = 30 + (i % 2) * 14; ctx.beginPath(); ctx.moveTo(bx - 6, H - bh - 30); ctx.lineTo(bx - 6, H - bh); ctx.lineTo(bx - bw / 2, H - 8); ctx.lineTo(bx + bw / 2, H - 8); ctx.lineTo(bx + 6, H - bh); ctx.lineTo(bx + 6, H - bh - 30); ctx.closePath(); ctx.fill(); ctx.stroke(); const lvl = H - 8 - bh * (0.3 + 0.2 * Math.sin(t / 900 + i)); ctx.fillStyle = hsl(150 + hue, 70, 60, dark ? 0.45 : 0.35); ctx.fillRect(bx - bw / 2 + 6, lvl, bw - 12, H - 8 - lvl); ctx.fillStyle = vesselFill; }
      // rising mint bubbles
      for (const it of this.items) { const y = ((it.y - t * 0.00004 * it.v) % 1 + 1) % 1; ctx.fillStyle = hsl(150 + hue, 70, dark ? 65 : 55, (dark ? 0.25 : 0.18) + it.s * 0.08); ctx.beginPath(); ctx.arc(it.x * W + Math.sin(t / 1000 + it.ph) * 6, y * H, 2 + it.s * 3, 0, TAU); ctx.fill(); }
    }
    _climb(ctx, W, H, t, p, hue) {
      // dawn -> day -> dusk across the region
      const sky = p < 0.5 ? [hsl(200 + hue, 60, 22 + p * 30), hsl(30 + hue, 80, 55 + p * 10)] : [hsl(230 + hue, 55, 18), hsl(340 + hue, 70, 40 + (1 - p) * 20)];
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const sunY = H * (0.42 - Math.sin(p * Math.PI) * 0.28); const sunX = W * (0.2 + p * 0.6);
      ctx.save(); ctx.shadowColor = hsl(40, 100, 70); ctx.shadowBlur = 40; ctx.fillStyle = p > 0.85 ? '#f2f5ff' : hsl(45, 100, 78); ctx.beginPath(); ctx.arc(sunX, sunY, 26 + p * 8, 0, TAU); ctx.fill(); ctx.restore();
      for (const it of this.items.slice(0, 14)) { const cx = ((it.x + t * 0.000012 * it.v) % 1.2 - 0.1) * W; const cy = it.y * H * 0.45; ctx.fillStyle = 'rgba(255,255,255,' + (0.12 + it.s * 0.08) + ')'; ctx.beginPath(); ctx.ellipse(cx, cy, 30 + it.s * 24, 10 + it.s * 6, 0, 0, TAU); ctx.fill(); }
      this.ridges.forEach((rd, k) => { ctx.fillStyle = hsl(150 + hue, 40 + k * 8, 14 + k * 9); ctx.beginPath(); ctx.moveTo(0, H); rd.pts.forEach((v, i) => ctx.lineTo(W * i / 13, H * v)); ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); });
      ctx.strokeStyle = 'rgba(63,217,135,.55)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.lineDashOffset = -t / 40; ctx.beginPath(); this.ridges[0].pts.forEach((v, i) => i ? ctx.lineTo(W * i / 13, H * v - 6) : ctx.moveTo(0, H * v - 6)); ctx.stroke(); ctx.setLineDash([]);
    }
    _junction(ctx, W, H, t, p, hue) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, hsl(195 + hue, 60, 5)); g.addColorStop(1, hsl(190 + hue, 55, 12 + p * 8)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const cols = [hsl(190, 90, 55), hsl(330, 80, 65), hsl(45, 90, 60), hsl(150, 80, 55)];
      const nPipes = 3 + Math.round(p * 3);
      for (let i = 0; i < nPipes; i++) {
        const x = W * (0.08 + i * (0.84 / Math.max(1, nPipes - 1))); const col = cols[(i + this.level.id) % cols.length];
        ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x, H * 0.4 + (i % 2) * 60); ctx.lineTo(x + ((i % 2) ? -60 : 60), H * 0.5 + (i % 2) * 60); ctx.lineTo(x + ((i % 2) ? -60 : 60), H + 10); ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.globalAlpha = 0.6; ctx.setLineDash([10, 22]); ctx.lineDashOffset = -t / 12 * (0.6 + (i % 3) * 0.3); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14 + 6 * Math.sin(t / 300 + i); ctx.beginPath(); ctx.arc(x, H * 0.4 + (i % 2) * 60, 7, 0, TAU); ctx.fill(); ctx.shadowColor = 'transparent';
      }
      for (const it of this.items) { const y = ((it.y - t * 0.00006 * it.v) % 1 + 1) % 1; ctx.fillStyle = 'rgba(41,200,239,' + (0.1 + it.s * 0.1) + ')'; ctx.beginPath(); ctx.arc(it.x * W, y * H, 1.5 + it.s * 2, 0, TAU); ctx.fill(); }
    }
    _city(ctx, W, H, t, p, hue) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, hsl(250 + hue + p * 40, 55, 6)); g.addColorStop(1, hsl(280 + hue + p * 40, 60, 16 + p * 8)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (const it of this.items) { ctx.fillStyle = 'rgba(255,255,255,' + (0.25 + 0.4 * Math.abs(Math.sin(t / 900 + it.ph))) + ')'; ctx.fillRect(it.x * W, it.y * H * 0.5, it.s, it.s); }
      // radar dish sweep
      const rx = W * 0.82, ry = H * 0.16; ctx.strokeStyle = 'rgba(155,108,255,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(rx, ry, 34, Math.PI, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(t / 700) * 34, ry - Math.abs(Math.sin(t / 700)) * 34); ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.25; const sg = ctx.createConicGradient ? ctx.createConicGradient(t / 900, rx, ry) : null; if (sg) { sg.addColorStop(0, 'rgba(155,108,255,.8)'); sg.addColorStop(0.15, 'rgba(155,108,255,0)'); sg.addColorStop(1, 'rgba(155,108,255,0)'); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(rx, ry, 120, 0, TAU); ctx.fill(); } ctx.restore();
      // skyline
      for (const b of this.buildings) {
        const bx = b.x * W, bw = b.w * W, bh = b.h * H; ctx.fillStyle = hsl(255 + hue, 40, 9); ctx.fillRect(bx, H - bh, bw, bh);
        const cols = ['rgba(242,180,24,.75)', 'rgba(155,108,255,.75)', 'rgba(41,200,239,.75)'];
        for (let wy = H - bh + 10; wy < H - 10; wy += 14) for (let wx = bx + 5; wx < bx + bw - 6; wx += 11) { const on = Math.sin(wx * 0.7 + wy * 0.3 + Math.floor(t / 1400)) > 0.1; if (on) { ctx.fillStyle = cols[(b.win + Math.floor(wx / 11)) % 3]; ctx.fillRect(wx, wy, 5, 7); } }
      }
      // ticker billboard
      const by = H * 0.9; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, by, W, 22); ctx.fillStyle = hsl(150, 80, 60); ctx.font = 'bold 12px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
      const msg = '▲ BUY PRESSURE   ▲ VOLUME   ▲ BREAKOUT   ▼ FUD   ▲ PARABOLIC   ▲ BONDED   '; const tw = ctx.measureText(msg).width; const off = (t / 25) % tw; ctx.fillText(msg + msg, -off, by + 11);
      if (p > 0.4) { ctx.strokeStyle = 'rgba(200,220,255,.25)'; ctx.lineWidth = 1; for (const it of this.items.slice(0, 25)) { const y = ((it.y + t * 0.0004 * it.v) % 1) * H; ctx.beginPath(); ctx.moveTo(it.x * W, y); ctx.lineTo(it.x * W - 2, y + 12); ctx.stroke(); } }
    }
    _orbit(ctx, W, H, t, p, hue) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#02060a'); g.addColorStop(1, hsl(160 + hue, 50, 8 + p * 6)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // nebula
      for (let i = 0; i < 3; i++) { const nx = W * (0.2 + i * 0.3 + Math.sin(t / 9000 + i) * 0.05), ny = H * (0.25 + i * 0.2); const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, W * 0.35); ng.addColorStop(0, hsl([150, 280, 190][i] + hue, 70, 45, 0.16 + p * 0.06)); ng.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H); }
      for (const it of this.items) { const y = ((it.y + t * 0.00001 * it.v) % 1) * H; ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + 0.5 * Math.abs(Math.sin(t / 700 + it.ph))) + ')'; ctx.fillRect(it.x * W, y, it.s, it.s); }
      // planet with ring
      const px = W * (0.78 - p * 0.5), py = H * 0.14; const pr = 22 + p * 18;
      ctx.save(); ctx.shadowColor = p >= 0.99 ? '#ffd166' : '#3fd987'; ctx.shadowBlur = 30; const pg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, 2, px, py, pr); pg.addColorStop(0, p >= 0.99 ? '#fff3c4' : '#7dffbb'); pg.addColorStop(1, p >= 0.99 ? '#b8860b' : '#0b4a33'); ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill(); ctx.restore();
      ctx.strokeStyle = 'rgba(200,255,225,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(px, py, pr * 1.9, pr * 0.5, -0.3, 0, TAU); ctx.stroke();
      // emerald constellation chart
      ctx.strokeStyle = 'rgba(63,217,135,.45)'; ctx.lineWidth = 1.5; ctx.beginPath(); let lx = 0, ly = H * 0.9;
      for (let i = 0; i < 9; i++) { const nx = W * (i + 1) / 9, ny = H * (0.9 - i * 0.07 - Math.sin(i * 2.1 + this.level.id) * 0.04); ctx.moveTo(lx, ly); ctx.lineTo(nx, ny); lx = nx; ly = ny; ctx.fillStyle = '#3fd987'; ctx.fillRect(nx - 2, ny - 2, 4, 4); }
      ctx.stroke();
      // floating market structures
      for (let i = 0; i < 4; i++) { const sx = W * (0.12 + i * 0.25), sy = H * (0.55 + Math.sin(t / 1500 + i) * 0.02); ctx.strokeStyle = 'rgba(200,255,225,.25)'; ctx.lineWidth = 2; ctx.strokeRect(sx, sy, 34, 14); ctx.beginPath(); ctx.moveTo(sx + 17, sy); ctx.lineTo(sx + 17, sy - 14); ctx.stroke(); ctx.fillStyle = 'rgba(63,217,135,.6)'; ctx.fillRect(sx + 4, sy + 4, 6, 6); }
    }
    _ocean(ctx, W, H, t, p, hue) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, hsl(196 + hue, 70, 14 + p * 4)); g.addColorStop(1, hsl(205 + hue, 80, 4)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // light shafts
      ctx.save(); ctx.globalAlpha = 0.12; for (let i = 0; i < 5; i++) { const x = W * (0.1 + i * 0.2) + Math.sin(t / 3000 + i) * 20; const sg = ctx.createLinearGradient(x, 0, x + 60, H); sg.addColorStop(0, 'rgba(180,240,255,.9)'); sg.addColorStop(1, 'rgba(180,240,255,0)'); ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(x - 20, 0); ctx.lineTo(x + 30, 0); ctx.lineTo(x + 90, H); ctx.lineTo(x - 60, H); ctx.closePath(); ctx.fill(); } ctx.restore();
      // whale silhouette drifting
      const wx = ((t / 60000 + p) % 1.4 - 0.2) * W, wy = H * 0.3; ctx.fillStyle = 'rgba(2,20,30,.75)'; ctx.beginPath(); ctx.ellipse(wx, wy, 90, 26, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(wx + 80, wy); ctx.lineTo(wx + 125, wy - 24); ctx.lineTo(wx + 110, wy); ctx.lineTo(wx + 125, wy + 22); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(180,240,255,.5)'; ctx.beginPath(); ctx.arc(wx - 55, wy - 6, 3, 0, TAU); ctx.fill();
      // bubbles
      for (const it of this.items) { const y = ((it.y - t * 0.00005 * it.v) % 1 + 1) % 1; ctx.strokeStyle = 'rgba(180,240,255,' + (0.15 + it.s * 0.15) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(it.x * W + Math.sin(t / 800 + it.ph) * 5, y * H, 2 + it.s * 3, 0, TAU); ctx.stroke(); }
      // kelp at the bottom
      ctx.strokeStyle = 'rgba(41,200,239,.35)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; for (let i = 0; i < 7; i++) { const x = W * (0.06 + i * 0.15); ctx.beginPath(); ctx.moveTo(x, H); for (let k = 1; k <= 5; k++) ctx.lineTo(x + Math.sin(t / 900 + i + k) * 10 * k / 3, H - k * 26); ctx.stroke(); }
    }
    _canyon(ctx, W, H, t, p, hue) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, hsl(25 + hue, 80, 45 + p * 10)); g.addColorStop(0.5, hsl(15 + hue, 75, 30)); g.addColorStop(1, hsl(10 + hue, 60, 12)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 50; ctx.fillStyle = '#ffe7a8'; ctx.beginPath(); ctx.arc(W * (0.75 - p * 0.5), H * 0.12, 30, 0, TAU); ctx.fill(); ctx.restore();
      // layered rock walls
      for (let k = 0; k < 3; k++) { ctx.fillStyle = hsl(12 + hue, 60, 22 - k * 6); ctx.beginPath(); ctx.moveTo(0, H); for (let i = 0; i <= 10; i++) { const x = W * i / 10; const y = H * (0.45 + k * 0.12) + Math.sin(i * 2.3 + k * 1.7) * 24 + ((i * 37 + k * 11) % 5) * 6; ctx.lineTo(x, y); } ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); }
      // heat haze shimmer lines + dust devils
      ctx.strokeStyle = 'rgba(255,220,180,.12)'; ctx.lineWidth = 1; for (let y = H * 0.3; y < H * 0.5; y += 9) { ctx.beginPath(); for (let x = 0; x <= W; x += 12) ctx.lineTo(x, y + Math.sin(x / 20 + t / 250 + y) * 2); ctx.stroke(); }
      for (const it of this.items.slice(0, 30)) { const x = ((it.x + t * 0.00003 * it.v) % 1) * W; ctx.fillStyle = 'rgba(255,200,150,' + (0.15 + it.s * 0.1) + ')'; ctx.fillRect(x, it.y * H, it.s * 2, it.s); }
    }
    _alps(ctx, W, H, t, p, hue) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, hsl(210 + hue, 60, 30 + p * 20)); g.addColorStop(1, hsl(205 + hue, 50, 88)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // peaks
      for (let k = 0; k < 3; k++) { ctx.fillStyle = k === 2 ? '#f4f8ff' : hsl(210, 30 - k * 8, 60 + k * 12); ctx.beginPath(); ctx.moveTo(0, H); for (let i = 0; i <= 8; i++) { const x = W * i / 8; const y = H * (0.5 + k * 0.12) - ((i * 53 + k * 29) % 7) * 18 - (i % 2 ? 40 : 0); ctx.lineTo(x, y); } ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); }
      // parachutes drifting down
      for (let i = 0; i < 4; i++) { const x = W * (0.15 + i * 0.22) + Math.sin(t / 1500 + i) * 30, y = ((t / 12000 + i * 0.25) % 1) * H; ctx.fillStyle = ['#ff6b5b', '#f2b418', '#3fd987', '#9b6cff'][i]; ctx.beginPath(); ctx.arc(x, y, 16, Math.PI, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x, y + 22); ctx.lineTo(x + 16, y); ctx.stroke(); ctx.fillStyle = '#17323d'; ctx.fillRect(x - 4, y + 20, 8, 8); }
      // snow
      for (const it of this.items) { const y = ((it.y + t * 0.00004 * it.v) % 1) * H; ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + it.s * 0.2) + ')'; ctx.beginPath(); ctx.arc(it.x * W + Math.sin(t / 700 + it.ph) * 8, y, 1 + it.s, 0, TAU); ctx.fill(); }
    }
    _core(ctx, W, H, t, p, hue) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, hsl(0 + hue, 60, 4)); g.addColorStop(1, hsl(10 + hue, 80, 18 + p * 8)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // magma glow pools
      for (let i = 0; i < 3; i++) { const x = W * (0.2 + i * 0.3), y = H * (0.8 + Math.sin(t / 2000 + i) * 0.03); const rg = ctx.createRadialGradient(x, y, 0, x, y, W * 0.3); rg.addColorStop(0, 'rgba(255,120,60,' + (0.5 + 0.2 * Math.sin(t / 600 + i)) + ')'); rg.addColorStop(1, 'rgba(255,60,30,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H); }
      // cracked rock plates
      ctx.strokeStyle = 'rgba(255,140,80,.55)'; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i < 12; i++) { const x = ((i * 97) % W); ctx.moveTo(x, H); ctx.lineTo(x + 30, H - 60 - (i % 3) * 30); ctx.lineTo(x + 10, H - 120 - (i % 4) * 25); } ctx.stroke();
      // embers rising
      for (const it of this.items) { const y = ((it.y - t * 0.00008 * it.v) % 1 + 1) % 1; ctx.fillStyle = 'rgba(255,' + Math.round(120 + it.s * 60) + ',60,' + (0.3 + it.s * 0.25) + ')'; ctx.fillRect(it.x * W + Math.sin(t / 500 + it.ph) * 6, y * H, 2 + it.s, 2 + it.s); }
      // halt warning band
      ctx.fillStyle = 'rgba(229,72,77,.18)'; ctx.fillRect(0, H * 0.17, W, 10); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = 'bold 9px "JetBrains Mono", monospace'; ctx.fillText('TRADING HALTED · CIRCUIT BREAKER · ' + Math.round(70 + p * 25) + '% MELT', 12 - (t / 40) % 200, H * 0.17 + 8);
    }
    _diamond(ctx, W, H, t, p, hue) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, hsl(235 + hue, 55, 6)); g.addColorStop(1, hsl(250 + hue, 50, 18 + p * 6)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // crystal facets
      for (let i = 0; i < 9; i++) { const x = W * ((i * 0.37) % 1), h = 80 + (i * 41) % 120, w = 26 + (i % 3) * 12; const y = i % 2 ? H : 0; const dir = i % 2 ? -1 : 1; ctx.save(); ctx.globalAlpha = 0.45; const cg = ctx.createLinearGradient(x, y, x, y + dir * h); cg.addColorStop(0, 'rgba(201,182,255,.9)'); cg.addColorStop(1, 'rgba(120,200,255,.05)'); ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w * 0.4, y + dir * h); ctx.lineTo(x - w * 0.3, y + dir * h * 0.9); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
      // sparkles
      for (const it of this.items) { const a = 0.3 + 0.7 * Math.abs(Math.sin(t / 500 + it.ph)); ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.fillRect(it.x * W, it.y * H, it.s, it.s); if (it.k === 0) { ctx.strokeStyle = 'rgba(201,182,255,' + a * 0.6 + ')'; ctx.beginPath(); ctx.moveTo(it.x * W - 5, it.y * H); ctx.lineTo(it.x * W + 5, it.y * H); ctx.moveTo(it.x * W, it.y * H - 5); ctx.lineTo(it.x * W, it.y * H + 5); ctx.stroke(); } }
      // prism beam
      ctx.save(); ctx.globalAlpha = 0.2; const bg = ctx.createLinearGradient(0, 0, W, H); ['#ff6b5b', '#f2b418', '#3fd987', '#29c8ef', '#9b6cff'].forEach((c, i) => bg.addColorStop(i / 4, c)); ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(W * 0.1, 0); ctx.lineTo(W * 0.25, 0); ctx.lineTo(W, H * 0.75); ctx.lineTo(W, H * 0.9); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }
  RTB.Backdrop = Backdrop; RTB.SCENES = SCENES; RTB.BACKDROP_THEMES = THEMES;
})();
