'use strict';
/* Roadmap level select: a vertically scrolling coin roadmap drawn as a rising
   candlestick chart through five regions. Level 1 at the bottom, 50 on top. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  const D = RTB.Draw; const TAU = Math.PI * 2;
  const STEP = 150; const PAD_TOP = 260; const PAD_BOTTOM = 200;
  const LAB_DARK = { bg: ['#0a1f1b', '#10352e'], ink: '#dff7ea', accent: '#3fd987', text: '#dff7ea' };
  const THEMES = {
    lab: { bg: ['#f6f1e6', '#e6f6ec'], ink: '#17423d', accent: '#3fd987', text: '#17423d' },
    climb: { bg: ['#0f2f2b', '#1c5747'], ink: '#dff7ea', accent: '#3fd987', text: '#dff7ea' },
    junction: { bg: ['#06151b', '#0d2b36'], ink: '#c9f4ff', accent: '#29c8ef', text: '#c9f4ff' },
    city: { bg: ['#0a0a1f', '#1a1240'], ink: '#e2d4ff', accent: '#9b6cff', text: '#e2d4ff' },
    orbit: { bg: ['#03080b', '#0c2a24'], ink: '#dff7ea', accent: '#3fd987', text: '#dff7ea' },
    ocean: { bg: ['#03131f', '#0a3a4a'], ink: '#d6f6ff', accent: '#29c8ef', text: '#d6f6ff' },
    canyon: { bg: ['#1d0c08', '#5a2414'], ink: '#ffe6d6', accent: '#f2b418', text: '#ffe6d6' },
    alps: { bg: ['#dbe8f7', '#f4f8ff'], ink: '#17323d', accent: '#29c8ef', text: '#17323d' },
    core: { bg: ['#0f0404', '#3a0d0d'], ink: '#ffe0da', accent: '#ff6b5b', text: '#ffe0da' },
    diamond: { bg: ['#06081a', '#1a1e4a'], ink: '#eef2ff', accent: '#c9b6ff', text: '#eef2ff' },
  };
  const N_LEVELS = () => RTB.MAX_LEVEL || 50;
  const released = (id) => (RTB.released ? RTB.released(id) : true);

  class Roadmap {
    constructor(scrollEl, spacerEl, canvas, hooks) {
      this.scroll = scrollEl; this.spacer = spacerEl; this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hooks = hooks || {};
      this.nodes = []; this.total = 0; this.W = 0; this.H = 0; this.dpr = 1; this.save = null; this.anim = null; this.raf = 0; this.running = false;
      this.rng = RTB.Rng.create('roadmap');
      this.decor = []; this.candles = [];
      this.scroll.addEventListener('scroll', () => this._dirty = true, { passive: true });
      let down = null;
      canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
      canvas.addEventListener('pointerup', (e) => {
        if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; const d0 = down; down = null;
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || performance.now() - d0.t > 600) return;
        const r = canvas.getBoundingClientRect(); this._tap(e.clientX - r.left, e.clientY - r.top + this.scroll.scrollTop);
      });
      window.addEventListener('resize', () => { this.layout(); this._dirty = true; });
    }
    layout() {
      const r = this.scroll.getBoundingClientRect(); this.W = r.width; this.H = r.height; this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
      this.canvas.style.height = this.H + 'px'; this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.total = PAD_TOP + (N_LEVELS() - 1) * STEP + PAD_BOTTOM; this.spacer.style.height = this.total + 'px';
      this.canvas.style.marginTop = (-this.total) + 'px';
      // node positions: winding chart path
      this.nodes = [];
      const rng = RTB.Rng.create('nodes');
      for (let i = 1; i <= N_LEVELS(); i++) {
        const y = this.total - PAD_BOTTOM - (i - 1) * STEP;
        const phase = ((i - 1) % 6) / 6 * TAU; const x = this.W * (0.5 + 0.3 * Math.sin(phase + (i > 25 ? 0.6 : 0))) + (RTB.Rng.next(rng) - 0.5) * 30;
        this.nodes.push({ id: i, x: Math.max(48, Math.min(this.W - 48, x)), y, region: RTB.regionOf(i), milestone: i % 10 === 0 });
      }
      // bonus side nodes
      this.bonusNodes = (RTB.BONUS || []).map(B => { const n = this.nodes[B.after - 1]; const side = n.x < this.W / 2 ? 1 : -1; return { id: B.id, after: B.after, x: Math.max(40, Math.min(this.W - 40, n.x + side * 100)), y: n.y - 66, region: n.region }; });
      // candles between nodes
      this.candles = [];
      const crng = RTB.Rng.create('candles');
      for (let i = 0; i < N_LEVELS() - 1; i++) {
        const a = this.nodes[i], b = this.nodes[i + 1]; const n = 4;
        for (let k = 0; k < n; k++) {
          const t0 = (k + 0.5) / n; const x = a.x + (b.x - a.x) * t0; const yBase = a.y + (b.y - a.y) * t0;
          const red = RTB.Rng.next(crng) < 0.28 && k !== n - 1; const h = 18 + RTB.Rng.next(crng) * 26;
          this.candles.push({ level: i + 1, x, y: yBase, h, red, wick: 8 + RTB.Rng.next(crng) * 14 });
        }
      }
      this.decor = []; const drng = RTB.Rng.create('decor');
      for (let i = 0; i < 260; i++) this.decor.push({ x: RTB.Rng.next(drng) * this.W, y: RTB.Rng.next(drng) * this.total, s: 0.5 + RTB.Rng.next(drng) * 2, k: RTB.Rng.int(drng, 5) });
    }
    setData(save) { this.save = save; this._dirty = true; }
    start() { if (this.running) return; this.running = true; const loop = () => { if (!this.running) return; this._frame(); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
    stop() { this.running = false; cancelAnimationFrame(this.raf); }
    nodeOf(id) { if (id > 1000) { const b = this.bonusNodes.find(x => x.id === id); return b || this.nodes[0]; } return this.nodes[Math.min(id, N_LEVELS()) - 1]; }
    centerOn(id, smooth) {
      const n = this.nodeOf(id); if (!n) return;
      const top = Math.max(0, Math.min(this.total - this.H, n.y - this.H * 0.55));
      if (smooth && !document.getElementById('shell').classList.contains('motion-reduced')) this.scroll.scrollTo({ top, behavior: 'smooth' }); else this.scroll.scrollTop = top;
      this._dirty = true;
    }
    nodeScreenPos(id) { const n = this.nodeOf(id); const r = this.scroll.getBoundingClientRect(); return { x: r.left + n.x, y: r.top + n.y - this.scroll.scrollTop }; }
    _tap(x, y) {
      let best = null, bd = 1e9;
      for (const n of this.nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < (n.milestone ? 40 : 30) && d < bd) { bd = d; best = n; } }
      for (const b of this.bonusNodes) { const d = Math.hypot(b.x - x, b.y - y); if (d < 26 && d < bd) { bd = d; best = b; } }
      if (!best) return;
      if (best.after) { if (best.after < this.save.unlocked && released(best.id)) this.hooks.onSelect && this.hooks.onSelect(best.id); else this.hooks.onLocked && this.hooks.onLocked(best.id); return; }
      if (!released(best.id)) { this.hooks.onSoon && this.hooks.onSoon(best.id); return; }
      if (best.id > this.save.unlocked) this.hooks.onLocked && this.hooks.onLocked(best.id); else this.hooks.onSelect && this.hooks.onSelect(best.id);
    }
    celebrate(id) { this.anim = { type: 'print', id, t0: performance.now(), dur: 1400 }; this._dirty = true; return new Promise(res => setTimeout(res, 1450)); }
    finale() { this.anim = { type: 'finale', t0: performance.now(), dur: 2600 }; this._dirty = true; return new Promise(res => setTimeout(res, 2600)); }
    _frame() {
      const t = performance.now(); const ctx = this.ctx; const W = this.W, H = this.H; if (!W) return;
      const top = this.scroll.scrollTop; const bottom = top + H;
      ctx.clearRect(0, 0, W, H);
      ctx.save(); ctx.translate(0, -top);
      // region bands
      for (const R of RTB.REGIONS) {
        const yTop = this.nodeOf(R.to).y - STEP * 0.6, yBot = this.nodeOf(R.from).y + STEP * 0.6 + (R.from === 1 ? PAD_BOTTOM : 0);
        if (yBot < top || yTop > bottom) continue;
        const th = this.themeOf(R); const g = ctx.createLinearGradient(0, yTop, 0, yBot); g.addColorStop(0, th.bg[1]); g.addColorStop(1, th.bg[0]);
        ctx.fillStyle = g; ctx.fillRect(0, yTop - (R.id === 5 ? PAD_TOP : 0), W, yBot - yTop + (R.id === 5 ? PAD_TOP : 0));
        this._environment(ctx, R, yTop, yBot, t);
        // region title
        ctx.save(); ctx.fillStyle = th.text; ctx.globalAlpha = 0.9; ctx.font = 'bold 13px "Space Grotesk", sans-serif'; ctx.textAlign = 'center'; ctx.letterSpacing = '4px';
        ctx.fillText('MAP ' + R.id + ' · ' + R.name, W / 2, yBot - 22); ctx.restore();
      }
      // grid
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; for (let y = Math.floor(top / 40) * 40; y < bottom; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } ctx.restore();
      // route line
      const unlocked = this.save ? this.save.unlocked : 1;
      ctx.save(); ctx.lineWidth = 3; ctx.lineJoin = 'round';
      for (let i = 0; i < N_LEVELS() - 1; i++) { const a = this.nodes[i], b = this.nodes[i + 1]; if (Math.max(a.y, b.y) < top - 60 || Math.min(a.y, b.y) > bottom + 60) continue; const done = i + 1 < unlocked; ctx.strokeStyle = done ? 'rgba(63,217,135,.8)' : 'rgba(255,255,255,.18)'; ctx.setLineDash(done ? [] : [6, 8]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      ctx.restore();
      // candles
      for (const c of this.candles) {
        if (c.y < top - 60 || c.y > bottom + 60) continue;
        const done = c.level < unlocked; const printing = this.anim && this.anim.type === 'print' && this.anim.id === c.level;
        let k = done ? 1 : 0;
        if (printing) { const idx = this.candles.filter(x => x.level === c.level).indexOf(c); k = Math.max(0, Math.min(1, ((t - this.anim.t0) / this.anim.dur) * 4 - idx * 0.7)); }
        if (k <= 0 && !done) { ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = THEMES[RTB.regionOf(c.level).theme].ink; ctx.fillRect(c.x - 5, c.y - c.h / 2, 10, c.h); ctx.fillRect(c.x - 1, c.y - c.h / 2 - c.wick, 2, c.h + c.wick * 1.5); ctx.restore(); continue; }
        ctx.save(); const col = c.red ? '#e5484d' : '#3fd987'; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8 * k; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(c.x, c.y - c.h / 2 - c.wick * k); ctx.lineTo(c.x, c.y + c.h / 2 + c.wick * 0.5); ctx.stroke();
        const hh = c.h * k; ctx.fillRect(c.x - 6, c.y + c.h / 2 - hh, 12, hh); ctx.restore();
      }
      // bonus side nodes
      for (const b of this.bonusNodes) {
        if (b.y < top - 60 || b.y > bottom + 60) continue;
        const open = b.after < unlocked && released(b.id); const g = this.save && this.save.levels[b.id]; const played = g && g.best > 0;
        const mainNode = this.nodes[b.after - 1];
        ctx.save(); ctx.strokeStyle = open ? 'rgba(242,180,24,.7)' : 'rgba(255,255,255,.15)'; ctx.setLineDash([3, 5]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mainNode.x, mainNode.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.translate(b.x, b.y); ctx.rotate(Math.PI / 4); const s = 18;
        if (open) { ctx.shadowColor = '#f2b418'; ctx.shadowBlur = 14; const gg = ctx.createLinearGradient(-s, -s, s, s); gg.addColorStop(0, '#ffe58a'); gg.addColorStop(1, '#b3760a'); ctx.fillStyle = gg; } else ctx.fillStyle = '#1b2a2a';
        ctx.fillRect(-s, -s, s * 2, s * 2); ctx.shadowColor = 'transparent'; ctx.strokeStyle = open ? '#2b2416' : 'rgba(255,255,255,.3)'; ctx.lineWidth = 3; ctx.strokeRect(-s, -s, s * 2, s * 2); ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = open ? '#2b2416' : 'rgba(255,255,255,.5)'; ctx.font = 'bold 11px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(open ? (played ? '★' : 'B') : '🔒'.length ? 'B' : 'B', 0, 1);
        ctx.font = 'bold 8px "JetBrains Mono", monospace'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = this.themeOf(b.region).text; ctx.globalAlpha = open ? 0.9 : 0.4; ctx.fillText('BONUS', 0, s + 14); ctx.restore();
      }
      // nodes
      for (const n of this.nodes) {
        if (n.y < top - 80 || n.y > bottom + 80) continue;
        const rel = released(n.id);
        const state = !rel ? 'soon' : n.id < unlocked ? 'done' : n.id === unlocked ? 'current' : 'locked';
        const grade = this.save && this.save.levels[n.id] ? this.save.levels[n.id].grade : 0;
        const r = n.milestone ? 30 : 22; const pulse = state === 'current' ? 1 + 0.08 * Math.sin(t / 300) : 1;
        ctx.save(); ctx.translate(n.x, n.y); ctx.scale(pulse, pulse);
        if (state === 'current') { ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 24; ctx.strokeStyle = 'rgba(63,217,135,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 8 + 3 * Math.sin(t / 250), 0, TAU); ctx.stroke(); }
        if (n.milestone) { ctx.strokeStyle = state === 'locked' ? 'rgba(255,255,255,.25)' : '#3fd987'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(0, 0, r + 6, t / 1500, t / 1500 + TAU); ctx.stroke(); ctx.setLineDash([]); }
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
        if (state === 'soon') { ctx.globalAlpha = 0.45; ctx.fillStyle = '#1b2a2a'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 3; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = 'bold 8px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SOON', 0, 1); ctx.restore(); continue; }
        if (state === 'locked') { ctx.fillStyle = '#1b2a2a'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 3; ctx.stroke(); }
        else { const g = ctx.createLinearGradient(-r, -r, r, r); g.addColorStop(0, state === 'done' ? '#7dffbb' : '#ffffff'); g.addColorStop(1, state === 'done' ? '#1d8a58' : '#3fd987'); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#17423d'; ctx.lineWidth = 3; ctx.stroke(); }
        ctx.shadowColor = 'transparent';
        if (state === 'locked') { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2.5; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(0, -4, 6, Math.PI, 0); ctx.stroke(); ctx.fillRect(-8, -3, 16, 12); ctx.font = 'bold 9px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = this.themeOf(n.region).text; ctx.globalAlpha = 0.7; ctx.fillText(String(n.id), 0, r + 14); ctx.globalAlpha = 1; }
        else {
          if (state === 'done') { ctx.fillStyle = '#0b2320'; ctx.fillRect(-4, -12, 8, 20); ctx.fillRect(-1, -16, 2, 30); }
          ctx.fillStyle = '#0b2320'; ctx.font = 'bold ' + (n.milestone ? 16 : 13) + 'px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (state === 'done') { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0b2320'; ctx.lineWidth = 3; ctx.strokeText(String(n.id), 0, 1); ctx.fillText(String(n.id), 0, 1); }
          else ctx.fillText(String(n.id), 0, 1);
          if (grade) { ctx.fillStyle = '#0b2320'; ctx.font = 'bold 8px "JetBrains Mono", monospace'; ctx.textBaseline = 'alphabetic'; const label = ['', 'LISTED', 'MOVING', 'TRENDING'][grade]; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0b2320'; ctx.lineWidth = 3; ctx.strokeText(label, 0, r + 14); ctx.fillText(label, 0, r + 14); }
        }
        ctx.restore();
        const L = RTB.levelById(n.id); ctx.save(); ctx.fillStyle = this.themeOf(n.region).text; ctx.globalAlpha = state === 'locked' ? 0.45 : 0.9; ctx.font = 'bold 11px "Space Grotesk", sans-serif'; ctx.textAlign = n.x < W / 2 ? 'left' : 'right'; ctx.fillText(L.name.toUpperCase(), n.x + (n.x < W / 2 ? r + 12 : -(r + 12)), n.y + 4); ctx.restore();
      }
      // "next update" banner above the released campaign
      const rel = RTB.CONFIG.releasedLevels; if (rel < N_LEVELS()) { const gate = this.nodes[rel]; if (gate && gate.y > top - 100 && gate.y < bottom + 100) { ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, gate.y + STEP * 0.45, W, 26); ctx.fillStyle = '#f2b418'; ctx.font = 'bold 11px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('▲ NEXT UPDATE · MAPS 6-10 · 50 MORE LEVELS ▲', W / 2, gate.y + STEP * 0.45 + 13); ctx.restore(); } }
      // top brand mark + finale
      const topNode = this.nodeOf(N_LEVELS()); if (topNode.y - 200 < bottom) {
        ctx.save(); ctx.textAlign = 'center';
        ctx.font = 'bold 22px "Space Grotesk", sans-serif'; ctx.globalAlpha = 0.9; ctx.fillStyle = '#3fd987'; ctx.fillText('BONDED', W / 2, topNode.y - 90);
        if (this.save && this.save.campaignDone) { D.pill(ctx, W / 2 - 34, topNode.y - 210, 68, t, { glow: 1 }); }
        ctx.restore();
      }
      if (this.anim && this.anim.type === 'finale') {
        const k = Math.min(1, (t - this.anim.t0) / this.anim.dur); ctx.save(); ctx.fillStyle = '#3fd987'; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 40; const h = k * (this.H + 200); ctx.globalAlpha = 0.85; ctx.fillRect(topNode.x - 24, topNode.y - h, 48, h); ctx.restore();
      }
      ctx.restore();
      if (this.anim && t - this.anim.t0 > this.anim.dur) this.anim = null;
    }
    themeOf(R) { return this.dark && R.theme === 'lab' ? LAB_DARK : THEMES[R.theme]; }
    _environment(ctx, R, yTop, yBot, t) {
      const W = this.W; const labInk = this.dark ? 'rgba(125,255,187,' : 'rgba(23,66,61,';
      ctx.save(); ctx.beginPath(); ctx.rect(0, yTop - 300, W, yBot - yTop + 300); ctx.clip();
      const inBand = this.decor.filter(d => d.y >= yTop - 20 && d.y <= yBot + 20);
      if (R.theme === 'lab') { ctx.strokeStyle = labInk + '.12)'; ctx.lineWidth = 1; for (let x = 0; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBot); ctx.stroke(); } for (const d of inBand) { ctx.fillStyle = 'rgba(63,217,135,.25)'; ctx.beginPath(); ctx.arc(d.x, d.y, d.s * 2, 0, TAU); ctx.fill(); } ctx.fillStyle = labInk + '.08)'; for (let i = 0; i < 6; i++) { const x = (i * 97) % W; D.rr(ctx, x, yBot - 90 - (i % 3) * 30, 26, 60 + (i % 3) * 20, 6); ctx.fill(); } }
      else if (R.theme === 'climb') { ctx.strokeStyle = 'rgba(63,217,135,.25)'; ctx.lineWidth = 2; for (let k = 0; k < 4; k++) { ctx.beginPath(); for (let x = 0; x <= W; x += 20) { const y = yBot - (x / W) * (yBot - yTop) * 0.7 - k * 60 + Math.sin(x / 30 + k) * 12; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); } for (const d of inBand) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(d.x, d.y, d.s, d.s); } }
      else if (R.theme === 'junction') { ctx.strokeStyle = 'rgba(41,200,239,.25)'; ctx.lineWidth = 10; ctx.lineCap = 'round'; for (let k = 0; k < 5; k++) { const y = yTop + (yBot - yTop) * (k + 0.5) / 5; ctx.beginPath(); ctx.moveTo(-10, y); ctx.lineTo(W * 0.3, y); ctx.lineTo(W * 0.45, y + 40); ctx.lineTo(W + 10, y + 40); ctx.stroke(); } ctx.fillStyle = 'rgba(41,200,239,.6)'; for (const d of inBand) { const off = (t / 20 + d.x) % W; ctx.fillRect(off, d.y, 6, 2); } }
      else if (R.theme === 'city') { ctx.fillStyle = 'rgba(0,0,0,.45)'; for (let i = 0; i < 14; i++) { const x = i * (W / 12) - 10; const h = 80 + ((i * 53) % 120); ctx.fillRect(x, yBot - h, W / 14, h); ctx.fillStyle = Math.floor(t / 900 + i) % 3 ? 'rgba(242,180,24,.6)' : 'rgba(155,108,255,.6)'; for (let wy = yBot - h + 10; wy < yBot - 10; wy += 16) ctx.fillRect(x + 6, wy, 5, 7); ctx.fillStyle = 'rgba(0,0,0,.45)'; } ctx.strokeStyle = 'rgba(155,108,255,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W * 0.8, yTop + 80, 26, Math.PI, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(W * 0.8, yTop + 80); ctx.lineTo(W * 0.8 + Math.cos(t / 500) * 26, yTop + 80 - Math.abs(Math.sin(t / 500)) * 26); ctx.stroke(); for (const d of inBand) { ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(d.x, d.y, d.s, d.s); } }
      else { for (const d of inBand) { ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + 0.4 * Math.abs(Math.sin(t / 700 + d.x))) + ')'; ctx.fillRect(d.x, d.y, d.s, d.s); } ctx.strokeStyle = 'rgba(63,217,135,.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); let px = 30, py = yBot - 40; for (let i = 0; i < 10; i++) { const nx = 30 + ((i * 131) % (W - 60)), ny = yBot - 40 - i * ((yBot - yTop) / 11); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.fillStyle = '#3fd987'; ctx.fillRect(nx - 2, ny - 2, 4, 4); px = nx; py = ny; } ctx.stroke(); ctx.strokeStyle = 'rgba(63,217,135,.15)'; ctx.beginPath(); ctx.arc(W / 2, yTop + 120, 160, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
  }
  RTB.Roadmap = Roadmap;
})();
