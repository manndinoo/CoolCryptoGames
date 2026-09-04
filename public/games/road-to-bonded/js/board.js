'use strict';
/* Board renderer, animation player, input, and the BONDED candlestick meter.
   The engine is authoritative; this file only replays engine steps visually. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  const D = RTB.Draw;
  const TAU = Math.PI * 2;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const easeSpring = (t) => 1 - Math.cos(t * Math.PI * 0.5) * (1 - t) - Math.sin(t * Math.PI * 2.2) * (1 - t) * 0.18;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();

  class Board {
    constructor(canvas, hooks) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hooks = hooks || {};
      this.engine = null; this.cells = null; this.w = 0; this.h = 0; this.cell = 40; this.dpr = 1;
      this.sprites = new Map(); this.tweens = []; this.effects = []; this.particles = []; this.texts = [];
      this.mode = 'locked'; this.selected = -1; this.hint = null; this.busy = false; this.botTargets = {};
      this.settings = { motion: false, fx: 2 };
      this.previews = { fudNext: -1, fudTimer: 0, printNext: {}, printTimer: 0 };
      this.running = false; this.lastFrame = 0; this.priceLine = null; this.flashCells = new Map();
      this.pointer = null;
      this._bindInput();
    }

    /* ---------- setup ---------- */
    setEngine(engine) {
      this.engine = engine; this.w = engine.st.w; this.h = engine.st.h;
      this.tweens = []; this.effects = []; this.particles = []; this.texts = []; this.selected = -1; this.hint = null;
      this.resize(); this.sync();
    }
    sync() {
      const e = this.engine; if (!e) return;
      this.cells = e.snapshot();
      this.sprites.clear();
      for (let i = 0; i < this.cells.length; i++) { const c = this.cells[i]; if (c.p) this.sprites.set(c.p.u, this._mkSprite(c.p, i)); }
      this._refreshPreviews();
    }
    _mkSprite(p, i) { const [r, c] = this._rc(i); return { p, x: c, y: r, s: 1, a: 1, rot: 0, z: p.t === 'cap' || p.t === 'key' ? 2 : 1 }; }
    _rc(i) { return [Math.floor(i / this.w), i % this.w]; }
    _refreshPreviews() {
      const e = this.engine; const st = e.st;
      this.previews.fudNext = st.fud ? st.fud.next : -1; this.previews.fudTimer = e.fudTimer();
      this.previews.printNext = Object.assign({}, st.printers.next); this.previews.printTimer = e.printTimer();
      this.botTargets = {};
      for (let i = 0; i < st.cells.length; i++) { const c = st.cells[i]; if (c.p && c.p.t === 'sp' && c.p.k === 'bot') this.botTargets[i] = e.botTarget(i); }
    }
    resize() {
      const wrap = this.canvas.parentElement; const outer = wrap.parentElement;
      const meterW = 66; const availW = outer.clientWidth - meterW - 20; const availH = outer.clientHeight - 20;
      if (availW <= 0 || availH <= 0 || !this.w) return;
      const cell = Math.floor(Math.min(availW / this.w, availH / this.h));
      this.cell = Math.max(24, cell);
      const cw = this.cell * this.w, ch = this.cell * this.h;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.style.width = cw + 'px'; this.canvas.style.height = ch + 'px';
      this.canvas.width = Math.round(cw * this.dpr); this.canvas.height = Math.round(ch * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const meterEl = document.getElementById('meter'); if (meterEl) { meterEl.style.height = Math.max(160, ch + 12) + 'px'; if (this.meter) requestAnimationFrame(() => this.meter.resize()); }
    }
    start() { if (this.running) return; this.running = true; this.lastFrame = now(); const loop = () => { if (!this.running) return; this._frame(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
    stop() { this.running = false; }
    setMode(m) { this.mode = m; if (m !== 'play') this.selected = -1; }
    setHint(h) { this.hint = h; this.hintT0 = now(); }
    setSettings(s) { this.settings = s; }
    dur(ms) { return this.settings.motion ? ms * 0.55 : ms; }

    /* ---------- input ---------- */
    _bindInput() {
      const cv = this.canvas;
      const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left), y: (ev.clientY - r.top) }; };
      const cellAt = (p) => { const c = Math.floor(p.x / this.cell), r = Math.floor(p.y / this.cell); if (c < 0 || r < 0 || c >= this.w || r >= this.h) return -1; return r * this.w + c; };
      cv.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        if (this.busy || this.mode === 'locked') return;
        const p = pos(ev); const i = cellAt(p); if (i < 0) return;
        this.pointer = { id: ev.pointerId, start: p, cell: i, dragged: false };
        try { cv.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      }, { passive: false });
      cv.addEventListener('pointermove', (ev) => {
        if (!this.pointer || this.pointer.id !== ev.pointerId || this.pointer.dragged || this.busy) return;
        if (this.mode !== 'play') return;
        const p = pos(ev); const dx = p.x - this.pointer.start.x, dy = p.y - this.pointer.start.y;
        const th = this.cell * 0.3;
        if (Math.abs(dx) < th && Math.abs(dy) < th) return;
        this.pointer.dragged = true;
        const [r, c] = this._rc(this.pointer.cell);
        let nr = r, nc = c;
        if (Math.abs(dx) > Math.abs(dy)) nc += dx > 0 ? 1 : -1; else nr += dy > 0 ? 1 : -1;
        if (nr < 0 || nc < 0 || nr >= this.h || nc >= this.w) return;
        this.selected = -1;
        this.hooks.onSwap && this.hooks.onSwap(this.pointer.cell, nr * this.w + nc);
      });
      const up = (ev) => {
        if (!this.pointer || this.pointer.id !== ev.pointerId) return;
        const ptr = this.pointer; this.pointer = null;
        if (ptr.dragged || this.busy) return;
        const i = ptr.cell;
        if (this.mode !== 'play') return;
        if (this.selected >= 0 && this.selected !== i && this.engine.isAdjacent(this.selected, i)) { const a = this.selected; this.selected = -1; this.hooks.onSwap && this.hooks.onSwap(a, i); return; }
        if (this.engine.isMovable(i)) { this.selected = this.selected === i ? -1 : i; this.hooks.onSelect && this.hooks.onSelect(i); }
        else this.selected = -1;
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /* ---------- tweens & effects ---------- */
    tween(obj, props, ms, ease, delay) {
      const t = { obj, from: {}, to: props, t0: now() + (delay || 0), dur: Math.max(1, ms), ease: ease || easeOut, done: false };
      for (const k in props) t.from[k] = obj[k];
      this.tweens.push(t); return t;
    }
    fx(e) { e.t0 = now(); this.effects.push(e); return e; }
    burst(x, y, color, n, speed, shape) {
      if (this.settings.fx === 0) return;
      const cap = this.settings.fx === 1 ? 120 : 260; n = this.settings.fx === 1 ? Math.ceil(n / 2) : n;
      for (let k = 0; k < n && this.particles.length < cap; k++) {
        const a = Math.random() * TAU, sp = (0.4 + Math.random()) * (speed || 1) * this.cell * 0.05;
        this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - this.cell * 0.02, life: 1, decay: 0.02 + Math.random() * 0.03, color, size: this.cell * (0.05 + Math.random() * 0.08), shape: shape || (Math.random() < 0.5 ? 'tick' : 'frag') });
      }
    }
    floatText(i, text, color) { const [r, c] = this._rc(i); this.texts.push({ x: (c + 0.5) * this.cell, y: (r + 0.4) * this.cell, text, color: color || '#fff', t0: now(), dur: this.dur(700) }); }
    cellXY(i) { const [r, c] = this._rc(i); return [(c + 0.5) * this.cell, (r + 0.5) * this.cell]; }

    /* ---------- step playback ---------- */
    async play(steps) {
      this.busy = true; this.selected = -1; this.hint = null;
      try {
        for (const step of steps) {
          await this._animate(step);
          if (step.board) { this.cells = step.board; this._rebuild(); }
          if (step.hud && this.hooks.onHud) this.hooks.onHud(step.hud, step);
        }
      } finally {
        if (this.engine) { this.cells = this.engine.snapshot(); this._rebuild(); this._refreshPreviews(); }
        this.busy = false;
      }
    }
    _rebuild() {
      const seen = new Set();
      for (let i = 0; i < this.cells.length; i++) {
        const c = this.cells[i]; if (!c.p) continue; seen.add(c.p.u);
        let sp = this.sprites.get(c.p.u);
        if (!sp) { sp = this._mkSprite(c.p, i); sp.s = 0.2; this.tween(sp, { s: 1 }, this.dur(220), easeSpring); this.sprites.set(c.p.u, sp); }
        else { const [r, cc] = this._rc(i); sp.p = c.p; sp.x = cc; sp.y = r; sp.s = 1; sp.a = 1; sp.rot = 0; }
      }
      for (const u of [...this.sprites.keys()]) if (!seen.has(u)) this.sprites.delete(u);
      this.tweens = this.tweens.filter(t => t.obj && this.sprites.has(t.obj.p && t.obj.p.u) || !(t.obj && t.obj.p));
    }
    wait(ms) { return new Promise(res => setTimeout(res, ms)); }

    async _animate(step) {
      const H = this.hooks; const A = RTB.Audio;
      switch (step.type) {
        case 'swap': {
          const sa = this._spriteAt(step.a), sb = this._spriteAt(step.b);
          const [ra, ca] = this._rc(step.a), [rb, cb] = this._rc(step.b);
          const ms = this.dur(170);
          if (sa) { sa.z = 3; this.tween(sa, { x: cb, y: rb }, ms, easeSpring); }
          if (sb) this.tween(sb, { x: ca, y: ra }, ms, easeSpring);
          A.play(step.valid ? 'swap' : 'invalid');
          await this.wait(ms);
          if (!step.valid) {
            if (sa) this.tween(sa, { x: ca, y: ra }, ms, easeSpring); if (sb) this.tween(sb, { x: cb, y: rb }, ms, easeSpring);
            this.fx({ type: 'redtick', i: step.b, dur: this.dur(400) });
            H.onText && H.onText('NO FILL', 'red'); A.haptic(20);
            await this.wait(ms);
          }
          if (sa) sa.z = 1;
          break;
        }
        case 'clear': await this._animateClear(step); break;
        case 'gravity': await this._animateGravity(step); break;
        case 'lane': {
          const ms = this.dur(240); A.play('lane');
          const L = this.engine.st.lanes[step.lane];
          const n = L.cells.length;
          for (const m of step.moves) {
            const sp = this.sprites.get(m.u); if (!sp) continue;
            const [r, c] = this._rc(m.to); const [r0, c0] = this._rc(m.from);
            const wrap = Math.abs(r - r0) + Math.abs(c - c0) > 1;
            if (wrap) { this.tween(sp, { a: 0 }, ms * 0.4); setTimeout(() => { sp.x = c; sp.y = r; sp.a = 0; this.tween(sp, { a: 1 }, ms * 0.5); }, ms * 0.45); }
            else this.tween(sp, { x: c, y: r }, ms, easeOut);
          }
          void n;
          await this.wait(ms + 40); break;
        }
        case 'fud': {
          const ms = this.dur(420); A.play('fud');
          this.fx({ type: 'fudflow', from: step.from, to: step.to, dur: ms });
          H.onText && H.onText('FUD SPREADS', 'red');
          await this.wait(ms); break;
        }
        case 'print': {
          const ms = this.dur(380); A.play('print');
          this.fx({ type: 'printflow', from: step.printer, to: step.at, dur: ms });
          const sp = this._spriteAt(step.at); if (sp) this.tween(sp, { s: 0, a: 0 }, ms * 0.6, easeIn, ms * 0.3);
          H.onText && H.onText('SELL WALL PRINTED', 'red');
          await this.wait(ms); break;
        }
        case 'reset': {
          const ms = this.dur(600); A.play('reset');
          H.onText && H.onText('MARKET RESET', 'pop'); H.onBanner && H.onBanner('MARKET RESET');
          for (const sp of this.sprites.values()) if (sp.p.t === 'chip') this.tween(sp, { s: 0.3, a: 0.2, rot: 0.5 }, ms * 0.5, easeIn);
          await this.wait(ms * 0.5);
          this.cells = step.board; this._rebuild();
          for (const sp of this.sprites.values()) { sp.s = 0.3; sp.a = 0.2; sp.rot = -0.5; this.tween(sp, { s: 1, a: 1, rot: 0 }, ms * 0.5, easeSpring); }
          await this.wait(ms * 0.5); break;
        }
        case 'stage': {
          const ms = this.dur(900); A.play('gate');
          H.onText && H.onText('STAGE 2 · BOARD TRANSFORMS', 'pop'); H.onBanner && H.onBanner('STAGE 2');
          this.fx({ type: 'wave', dur: ms });
          await this.wait(ms); break;
        }
        case 'dip': { RTB.Audio.play('dip'); RTB.Audio.haptic([60, 40, 60]); this.hooks.onShake && this.hooks.onShake('dip'); H.onText && H.onText('DIP · -1 MOVE', 'red'); this.fx({ type: 'redwave', dur: this.dur(600) }); await this.wait(this.dur(650)); break; }
        case 'pressure': { H.onText && H.onText('SELL PRESSURE', 'red'); await this.wait(this.dur(120)); break; }
        case 'bonus': { RTB.Audio.play('bonus'); this.hooks.onCascade && this.hooks.onCascade(9); H.onText && H.onText('PARABOLIC · +1 MOVE', 'pop'); this.floatText(Math.floor(this.w * this.h / 2), '+1 MOVE', '#7dffbb'); await this.wait(this.dur(500)); break; }
        case 'end': break;
        default: break;
      }
    }
    _spriteAt(i) { const c = this.cells[i]; return c && c.p ? this.sprites.get(c.p.u) : null; }

    async _animateClear(step) {
      const ev = step.ev; const A = RTB.Audio; const H = this.hooks;
      let ms = this.dur(340); let big = false;
      const bonded = ev.specials.some(s => s.kind === 'bonded');
      if (bonded) { this.fx({ type: 'wave', dur: this.dur(700) }); A.play('bonded'); A.haptic([40, 30, 60, 30, 90]); this.hooks.onShake && this.hooks.onShake('punch'); ms = Math.max(ms, this.dur(1000)); big = true; }
      // specials first (beams, rings, bot flights)
      for (const s of ev.specials) {
        if (s.kind === 'ch' || s.kind === 'cv') { this.fx({ type: 'beam', i: s.i, dir: s.kind, dur: this.dur(380) }); ms = Math.max(ms, this.dur(420)); }
        else if (s.kind === 'burst') { this.fx({ type: 'ring', i: s.i, dur: this.dur(420), rad: 1.6, pulses: 2 }); ms = Math.max(ms, this.dur(440)); }
        else if (s.kind === 'megaburst') { this.fx({ type: 'ring', i: s.i, dur: this.dur(560), rad: 2.7, pulses: 2 }); ms = Math.max(ms, this.dur(600)); big = true; }
        else if (s.kind === 'cross' || s.kind === 'bigcross') { this.fx({ type: 'beam', i: s.i, dir: 'ch', dur: this.dur(420), wide: s.kind === 'bigcross' }); this.fx({ type: 'beam', i: s.i, dir: 'cv', dur: this.dur(420), wide: s.kind === 'bigcross' }); ms = Math.max(ms, this.dur(480)); big = true; }
        else if (s.kind === 'sweep') { this.fx({ type: 'sweep', i: s.i, cells: s.cells, dur: this.dur(520) }); ms = Math.max(ms, this.dur(560)); big = true; }
        else if (s.kind === 'sweepSweep') { this.fx({ type: 'wave', dur: this.dur(700) }); ms = Math.max(ms, this.dur(720)); big = true; }
        else if (s.kind === 'bot' || s.kind === 'botcarry') {
          if (s.target >= 0) { const sp = this._spriteAt(s.i); const fly = this.dur(450); this.fx({ type: 'botfly', i: s.i, to: s.target, dur: fly, sprite: sp, carry: s.carry }); if (sp) { sp.z = 5; const [r, c] = this._rc(s.target); this.tween(sp, { x: c, y: r }, fly, easeOut); } ms = Math.max(ms, fly + this.dur(160)); }
        }
        else if (s.kind === 'rocket') { if (s.target >= 0) this.fx({ type: 'rocket', to: s.target, dur: this.dur(520), delay: (bonded ? this.dur(350) : 0) + 90 * (ev.specials.filter(x => x.kind === 'rocket').indexOf(s)) }); ms = Math.max(ms, this.dur(bonded ? 1000 : 700)); setTimeout(() => A.play('rocket'), bonded ? this.dur(350) : 0); }
        else if (s.kind === 'bonded') { const sp = this._spriteAt(s.i); if (sp) { sp.z = 6; this.tween(sp, { s: 2.2, a: 0, rot: 1.2 }, this.dur(420), easeOut); } for (const ci of s.cells) this.flashCells.set(ci, now() + this.dur(500)); }
      }
      if (bonded) { /* sound already played */ }
      else if (ev.specials.length) { A.play(big ? 'combo' : 'special'); A.haptic(big ? [30, 30, 40] : 25); if (big) this.hooks.onShake && this.hooks.onShake(big ? 'punch' : 'shake'); }
      else if (ev.cleared.length) { A.play(step.pass > 1 ? 'cascade' : 'match', step.pass > 1 ? step.pass : ev.cleared.length); }
      if (step.pass >= 2 && this.hooks.onCascade) this.hooks.onCascade(step.pass);
      if (step.pass >= 3 && this.settings.fx > 0 && !this.priceLine) this.priceLine = { t0: now(), dur: this.dur(1400), pts: [] };
      // clears
      const delay = ev.specials.length ? this.dur(120) : 0;
      for (const cl of ev.cleared) {
        const sp = this.sprites.get(cl.p.u); if (!sp) continue;
        const [x, y] = this.cellXY(cl.i); const col = D.SYM[cl.p.s];
        this.tween(sp, { s: 0.1, a: 0 }, this.dur(220), easeIn, delay);
        setTimeout(() => this.burst(x, y, col.main, 6, 1), delay);
      }
      for (const cv of ev.converted) { const sp = this._spriteAt(cv.i); if (sp) { sp.p = cv.p; sp.s = 0.6; this.tween(sp, { s: 1.15 }, this.dur(160), easeSpring); } }
      // activated specials fade
      for (const s of ev.specials) { if (s.i >= 0 && s.kind !== 'bot' && s.kind !== 'botcarry') { const sp = this._spriteAt(s.i); if (sp) this.tween(sp, { s: 1.5, a: 0 }, this.dur(300), easeOut, delay); } }
      // hits
      for (const h of ev.hits) {
        const [x, y] = this.cellXY(h.i);
        this.flashCells.set(h.i, now() + this.dur(320));
        const col = h.what === 'wall' ? '#ff8a86' : h.what === 'fud' ? '#c9b6ff' : h.what === 'paper' ? '#fff3d6' : h.what === 'dust' ? '#7dffbb' : h.what === 'node' ? '#3fd987' : '#e2e8f0';
        setTimeout(() => this.burst(x, y, col, h.what === 'dust' ? 4 : 8, 0.9, 'frag'), delay);
        if (h.what !== 'dust') setTimeout(() => A.play('hit'), delay);
      }
      for (const k of ev.keys) { this.floatText(k.i, 'KEY', '#f2b418'); A.play('key'); const sp = this.sprites.get(k.u); if (sp) this.tween(sp, { y: sp.y - 0.6, a: 0, s: 1.3 }, this.dur(360), easeOut); }
      for (const w of ev.wallets) { const [x, y] = this.cellXY(w.cells[0]); this.burst(x + this.cell / 2, y + this.cell / 2, '#cfd8e3', 24, 1.6, 'frag'); this.hooks.onShake && this.hooks.onShake('shake'); A.play('combo'); }
      if (ev.gates.length) { A.play('gate'); H.onText && H.onText('CURVE GATE OPEN', 'pop'); }
      // creations pop in after clears
      for (const cr of ev.creations) {
        setTimeout(() => { A.play('create'); const [x, y] = this.cellXY(cr.i); this.burst(x, y, '#ffffff', 10, 1.2, 'tick'); this.fx({ type: 'ring', i: cr.i, dur: this.dur(300), rad: 0.8, pulses: 1, thin: true }); }, ms * 0.6);
      }
      if (bonded) { H.onText && H.onText('BONDED', 'pop'); }
      else if (step.combo) { H.onText && H.onText(comboText(step.combo.kind), 'pop'); }
      else if (ev.specials.some(s => s.kind !== 'rocket' && s.kind !== 'bonded')) H.onText && H.onText('BREAKOUT', 'pop');
      else if (step.pass >= 4) H.onText && H.onText('PARABOLIC', 'pop');
      else if (step.pass >= 2) H.onText && H.onText(step.pass === 2 ? 'VOLUME' : 'REVERSAL', 'pop');
      else if (ev.cleared.length >= 5) H.onText && H.onText('BUY PRESSURE', 'pop');
      await this.wait(ms);
    }

    async _animateGravity(step) {
      const per = this.dur(75); let maxT = 0;
      const byU = new Map();
      for (const m of step.moves) { if (!byU.has(m.u)) byU.set(m.u, []); byU.get(m.u).push(m); }
      const spawned = new Map();
      for (const s of step.spawns) {
        const [r, c] = this._rc(s.i);
        let sp = this.sprites.get(s.u);
        if (!sp) { sp = this._mkSprite(s.p, s.i); this.sprites.set(s.u, sp); }
        sp.x = c; sp.y = r - 1.2; sp.a = 1; sp.s = 1;
        this.tween(sp, { y: r }, per * 1.3, easeOut, 0);
        spawned.set(s.u, per * 1.3); maxT = Math.max(maxT, per * 1.3);
      }
      for (const [u, moves] of byU) {
        const sp = this.sprites.get(u); if (!sp) continue;
        let t = spawned.get(u) || 0;
        for (const m of moves) {
          const [r, c] = this._rc(m.to);
          const portal = this.cells[m.from] && this.cells[m.from].pout === m.to;
          if (portal) { this.tween(sp, { a: 0, s: 0.4 }, per, easeIn, t); const rr = r, cc = c; setTimeout(() => { sp.x = cc; sp.y = rr; sp.a = 0; sp.s = 0.4; }, t + per); this.tween(sp, { a: 1, s: 1 }, per, easeOut, t + per + 10); this.fx({ type: 'portal', from: m.from, to: m.to, dur: this.dur(300), delay: t }); t += per * 2; RTB.Audio.play('portal'); }
          else { this.tween(sp, { x: c, y: r }, per, (x) => x, t); t += per; }
        }
        maxT = Math.max(maxT, t);
      }
      for (const ex of step.exits) {
        const sp = this.sprites.get(ex.u);
        const [x, y] = this.cellXY(ex.i);
        setTimeout(() => { if (sp) this.tween(sp, { y: sp.y + 0.8, a: 0 }, this.dur(300), easeIn); this.burst(x, y + this.cell * 0.4, '#3fd987', 18, 1.4, 'tick'); RTB.Audio.play('capsule'); this.hooks.onText && this.hooks.onText('CAPSULE DELIVERED', 'pop'); this.floatText(ex.i, '+500', '#7dffbb'); }, maxT);
        maxT += this.dur(300);
      }
      // land squash
      setTimeout(() => { for (const sp of this.sprites.values()) { if (byU.has(sp.p.u)) { sp.sy = 0.85; this.tween(sp, { sy: 1 }, this.dur(140), easeOut); } } }, maxT);
      await this.wait(Math.min(maxT + 20, this.dur(900)));
    }

    /* ---------- frame ---------- */
    _frame() {
      const t = now(); const dt = Math.min(48, t - this.lastFrame); this.lastFrame = t;
      // tweens
      for (const tw of this.tweens) {
        if (tw.done) continue; const k = clamp((t - tw.t0) / tw.dur, 0, 1); if (t < tw.t0) continue;
        const e = tw.ease(k);
        for (const p in tw.to) tw.obj[p] = tw.from[p] + (tw.to[p] - tw.from[p]) * e;
        if (k >= 1) { tw.done = true; for (const p in tw.to) tw.obj[p] = tw.to[p]; }
      }
      if (this.tweens.length > 200 || (this.tweens.length && this.tweens.every(x => x.done))) this.tweens = this.tweens.filter(x => !x.done);
      // particles
      for (const p of this.particles) { p.x += p.vx * dt / 16; p.y += p.vy * dt / 16; p.vy += this.cell * 0.004 * dt / 16; p.life -= p.decay * dt / 16; }
      this.particles = this.particles.filter(p => p.life > 0);
      this.effects = this.effects.filter(e => t - e.t0 < e.dur + (e.delay || 0) + 60);
      this.texts = this.texts.filter(x => t - x.t0 < x.dur);
      this._draw(t);
      if (this.meter) this.meter.frame(t, dt);
    }

    _draw(t) {
      const ctx = this.ctx; const cs = this.cell; const cells = this.cells; if (!cells) return;
      ctx.clearRect(0, 0, cs * this.w, cs * this.h);
      const st = this.engine.st;
      // price line behind board on big cascades
      if (this.priceLine) {
        const k = (t - this.priceLine.t0) / this.priceLine.dur;
        if (k > 1) this.priceLine = null;
        else { ctx.save(); ctx.globalAlpha = 0.5 * (1 - k); ctx.strokeStyle = '#3fd987'; ctx.lineWidth = 3; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 12; ctx.beginPath(); const n = 12; for (let i = 0; i <= n * Math.min(1, k * 1.4); i++) { const x = (i / n) * cs * this.w; const y = cs * this.h * (0.9 - (i / n) * 0.75 + Math.sin(i * 2.3) * 0.06); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.restore(); }
      }
      // base cells
      for (let i = 0; i < cells.length; i++) { const c = cells[i]; const [r, cc] = this._rc(i); D.cellBase(ctx, cc * cs, r * cs, cs, c.a); }
      // underlays
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]; if (!c.a) continue; const [r, cc] = this._rc(i); const x = cc * cs, y = r * cs;
        if (c.lane >= 0) { const L = st.lanes[c.lane]; D.lane(ctx, x, y, cs, L.row !== undefined, L.dir, t); }
        if (c.dust) D.dust(ctx, x, y, cs, c.dust);
        if (c.exit) D.exit(ctx, x, y, cs, t);
        if (c.pout >= 0) D.portal(ctx, x, y, cs, c.pc, false, t);
        if (c.pin >= 0) D.portal(ctx, x, y, cs, c.pc, true, t);
      }
      // blockers
      const drawnWallets = new Set();
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]; if (!c.a || !c.bl) continue; const [r, cc] = this._rc(i); let x = cc * cs; const y = r * cs;
        const fl = this.flashCells.get(i); if (fl && fl > t) { const j = (fl - t) / 300; x += Math.sin(t / 12) * cs * 0.06 * j; }
        const b = c.bl;
        if (b.k === 'wall') D.wall(ctx, x, y, cs, b.hp, b.max);
        else if (b.k === 'halt') D.halt(ctx, x, y, cs, t);
        else if (b.k === 'printer') D.printer(ctx, x, y, cs, b.hp, t);
        else if (b.k === 'node') D.node(ctx, x, y, cs, b.hp, b.max, b.ch, t);
        else if (b.k === 'gate') D.gate(ctx, x, y, cs, b.need, this.engine.keysCollected(), t);
        else if (b.k === 'wallet') { if (!drawnWallets.has(b.id)) { drawnWallets.add(b.id); const wl = st.wallets[b.id]; const hp = wl ? wl.hp : 0; D.wallet(ctx, x, y, cs, hp, t); } }
      }
      // select-mode dimming & hint
      if (this.hint && this.mode === 'play' && !this.busy) {
        const k = (Math.sin((t - (this.hintT0 || 0)) / 220) + 1) / 2;
        for (const i of this.hint) { const [r, cc] = this._rc(i); ctx.save(); ctx.strokeStyle = 'rgba(125,255,187,' + (0.5 + 0.5 * k) + ')'; ctx.lineWidth = 3; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 10; D.rr(ctx, cc * cs + 3, r * cs + 3, cs - 6, cs - 6, cs * 0.18); ctx.stroke(); ctx.restore(); }
      }
      if (this.selected >= 0 && this.mode === 'play') { const [r, cc] = this._rc(this.selected); ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; D.rr(ctx, cc * cs + 2, r * cs + 2, cs - 4, cs - 4, cs * 0.18); ctx.stroke(); ctx.restore(); }
      // previews
      if (this.previews.fudNext >= 0 && !this.busy) { const [r, cc] = this._rc(this.previews.fudNext); ctx.save(); ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t / 250); D.fud(ctx, cc * cs, r * cs, cs, t); ctx.restore(); this._badge(ctx, cc * cs + cs - 4, r * cs + 4, String(this.previews.fudTimer), '#c9b6ff'); }
      for (const pi in this.previews.printNext) { const tgt = this.previews.printNext[pi]; if (tgt < 0 || this.busy) continue; const [r, cc] = this._rc(tgt); ctx.save(); ctx.globalAlpha = 0.5; ctx.setLineDash([4, 3]); ctx.strokeStyle = '#ff8a86'; ctx.lineWidth = 2; D.rr(ctx, cc * cs + 4, r * cs + 4, cs - 8, cs - 8, cs * 0.14); ctx.stroke(); ctx.restore(); this._badge(ctx, cc * cs + cs - 4, r * cs + 4, String(this.previews.printTimer), '#ff8a86'); }
      // pieces
      const list = [...this.sprites.values()].sort((a, b) => (a.z || 1) - (b.z || 1));
      for (const sp of list) {
        if (sp.a <= 0.01) continue;
        ctx.save(); ctx.globalAlpha = sp.a;
        const px = sp.x * cs, py = sp.y * cs;
        const s = sp.s, sy = (sp.sy || 1) * s;
        if (s !== 1 || sy !== 1 || sp.rot) { ctx.translate(px + cs / 2, py + cs / 2); ctx.scale(s, sy); ctx.rotate(sp.rot || 0); ctx.translate(-px - cs / 2, -py - cs / 2); }
        if (sp.p.t === 'chip') {
          const spr = D.sprite('chip' + sp.p.s, cs, (c, size) => D.chip(c, sp.p.s, 0, 0, size)); ctx.drawImage(spr, px, py, cs, cs);
          // occasional glint sweeping across a chip
          const ph = ((t / 2600) + (sp.p.u % 37) / 37) % 1; if (ph < 0.12 && this.settings.fx > 0) { ctx.save(); ctx.globalAlpha = Math.sin(ph / 0.12 * Math.PI) * 0.32; ctx.translate(px + cs * (0.25 + ph / 0.12 * 0.5), py + cs * 0.5); ctx.rotate(-0.6); ctx.fillStyle = '#fff'; ctx.fillRect(-cs * 0.03, -cs * 0.26, cs * 0.06, cs * 0.52); ctx.restore(); }
        }
        else D.piece(ctx, sp.p, px, py, cs, t);
        ctx.restore();
      }
      // overlays (paper, fud) from snapshot
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]; if (!c.a) continue; const [r, cc] = this._rc(i);
        if (c.paper) D.paper(ctx, cc * cs, r * cs, cs);
        if (c.fud) D.fud(ctx, cc * cs, r * cs, cs, t);
      }
      // BONDED pill guide ring
      if (!this.busy && this.mode === 'play') for (const sp of this.sprites.values()) if (sp.p.t === 'pill') { ctx.save(); ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t / 250); ctx.strokeStyle = '#7dffbb'; ctx.lineWidth = 3; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 14; D.rr(ctx, sp.x * cs + 2, sp.y * cs + 2, cs - 4, cs - 4, cs * 0.2); ctx.stroke(); ctx.restore(); }
      // bot targeting rings
      if (!this.busy && this.mode === 'play') for (const bi in this.botTargets) { const tg = this.botTargets[bi]; if (tg < 0) continue; const [r, cc] = this._rc(tg); const [br, bc] = this._rc(+bi); ctx.save(); ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t / 300); ctx.strokeStyle = '#7dffbb'; ctx.lineWidth = 2; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(cc * cs + cs / 2, r * cs + cs / 2, cs * 0.42, t / 600, t / 600 + TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.moveTo(bc * cs + cs / 2, br * cs + cs / 2); ctx.lineTo(cc * cs + cs / 2, r * cs + cs / 2); ctx.stroke(); ctx.restore(); }
      // cell flashes
      for (const [i, until] of this.flashCells) { if (until < t) { this.flashCells.delete(i); continue; } const [r, cc] = this._rc(i); ctx.save(); ctx.globalAlpha = 0.5 * (until - t) / 400; ctx.fillStyle = '#fff'; D.rr(ctx, cc * cs + 2, r * cs + 2, cs - 4, cs - 4, cs * 0.16); ctx.fill(); ctx.restore(); }
      // effects
      for (const e of this.effects) this._drawEffect(ctx, e, t);
      // particles
      for (const p of this.particles) { ctx.save(); ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.color; if (p.shape === 'tick') { ctx.fillRect(p.x - p.size * 0.25, p.y - p.size, p.size * 0.5, p.size * 2); } else { ctx.translate(p.x, p.y); ctx.rotate(p.life * 6); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); } ctx.restore(); }
      // float texts
      for (const x of this.texts) { const k = (t - x.t0) / x.dur; ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = x.color; ctx.font = 'bold ' + Math.round(cs * 0.34) + 'px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.fillText(x.text, x.x, x.y - k * cs * 0.8); ctx.restore(); }
    }
    _badge(ctx, x, y, text, color) { ctx.save(); ctx.fillStyle = '#0b2320'; ctx.strokeStyle = color; ctx.lineWidth = 1.5; const r = this.cell * 0.16; ctx.beginPath(); ctx.arc(x - r, y + r, r, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = color; ctx.font = 'bold ' + Math.round(r * 1.3) + 'px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x - r, y + r + 1); ctx.restore(); }

    _drawEffect(ctx, e, t) {
      const cs = this.cell; const k0 = (t - e.t0 - (e.delay || 0)) / e.dur; if (k0 < 0) return; const k = clamp(k0, 0, 1);
      ctx.save();
      if (e.type === 'redtick') { const [r, c] = this._rc(e.i); ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ff4d55'; ctx.lineWidth = 3; ctx.shadowColor = '#ff4d55'; ctx.shadowBlur = 8; ctx.beginPath(); ctx.moveTo(c * cs + cs * 0.5, r * cs + cs * 0.25); ctx.lineTo(c * cs + cs * 0.5, r * cs + cs * 0.75); ctx.moveTo(c * cs + cs * 0.35, r * cs + cs * 0.4); ctx.lineTo(c * cs + cs * 0.65, r * cs + cs * 0.6); ctx.stroke(); }
      else if (e.type === 'beam') {
        const [r, c] = this._rc(e.i); const a = Math.sin(k * Math.PI); ctx.globalAlpha = a; ctx.fillStyle = '#7dffbb'; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 20;
        const th = (e.wide ? 3 : 1) * cs;
        if (e.dir === 'ch') { const grow = easeOut(k) * cs * this.w; ctx.fillRect(c * cs + cs / 2 - grow / 2, r * cs + cs / 2 - th * 0.35, grow, th * 0.7); }
        else { const grow = easeOut(k) * cs * this.h; ctx.fillRect(c * cs + cs / 2 - th * 0.35, r * cs + cs / 2 - grow / 2, th * 0.7, grow); }
      }
      else if (e.type === 'ring') {
        const [x, y] = this.cellXY(e.i);
        for (let p = 0; p < (e.pulses || 1); p++) { const kk = clamp(k * (e.pulses || 1) - p * 0.5, 0, 1); if (kk <= 0) continue; ctx.globalAlpha = 1 - kk; ctx.strokeStyle = e.thin ? '#fff' : '#7dffbb'; ctx.lineWidth = e.thin ? 2 : cs * 0.18 * (1 - kk) + 2; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(x, y, cs * (e.rad || 1.5) * easeOut(kk), 0, TAU); ctx.stroke(); }
      }
      else if (e.type === 'sweep') {
        const [x, y] = this.cellXY(e.i); ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#7dffbb'; ctx.lineWidth = 2; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 10;
        for (const ci of e.cells) { const [cx, cy] = this.cellXY(ci); const kk = clamp(k * 1.6, 0, 1); ctx.beginPath(); ctx.moveTo(x, y); const mx = (x + cx) / 2 + Math.sin(ci * 3.1 + t / 60) * cs * 0.3, my = (y + cy) / 2 + Math.cos(ci * 2.3 + t / 70) * cs * 0.3; ctx.quadraticCurveTo(mx, my, x + (cx - x) * kk, y + (cy - y) * kk); ctx.stroke(); }
      }
      else if (e.type === 'redwave') { ctx.globalAlpha = Math.sin(k * Math.PI) * 0.55; ctx.fillStyle = '#e5484d'; ctx.shadowColor = '#e5484d'; ctx.shadowBlur = 30; const yy = cs * this.h * k; ctx.fillRect(0, yy - cs * 0.25, cs * this.w, cs * 0.5); ctx.globalAlpha = 0.12 * Math.sin(k * Math.PI); ctx.fillRect(0, 0, cs * this.w, yy); }
      else if (e.type === 'wave') { ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8; ctx.fillStyle = '#3fd987'; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 30; const yy = cs * this.h * (1 - k) ; ctx.fillRect(0, yy - cs * 0.3, cs * this.w, cs * 0.6); ctx.globalAlpha = 0.18 * Math.sin(k * Math.PI); ctx.fillRect(0, yy, cs * this.w, cs * this.h - yy); }
      else if (e.type === 'botfly') { const [tx, ty] = this.cellXY(e.to); ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t / 50); ctx.strokeStyle = '#7dffbb'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(tx, ty, cs * 0.45 * (1 - k * 0.4), 0, TAU); ctx.stroke(); if (k >= 0.95) { ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(125,255,187,.5)'; ctx.beginPath(); ctx.arc(tx, ty, cs * 0.5, 0, TAU); ctx.fill(); } }
      else if (e.type === 'rocket') {
        const [tx, ty] = this.cellXY(e.to); const sx = cs * this.w + cs * 0.6, sy = cs * this.h * 0.9;
        const kk = easeIn(k); const x = sx + (tx - sx) * kk, y = sy + (ty - sy) * kk - Math.sin(k * Math.PI) * cs * 1.5;
        ctx.globalAlpha = k < 0.98 ? 1 : 0; ctx.fillStyle = '#3fd987'; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 14;
        const ang = Math.atan2(ty - y, tx - x); ctx.translate(x, y); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(cs * 0.35, 0); ctx.lineTo(-cs * 0.2, -cs * 0.14); ctx.lineTo(-cs * 0.1, 0); ctx.lineTo(-cs * 0.2, cs * 0.14); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cs * 0.12, 0, cs * 0.05, 0, TAU); ctx.fill();
        if (Math.random() < 0.7 && this.settings.fx > 0 && this.particles.length < 250) this.particles.push({ x, y, vx: -Math.cos(ang) * cs * 0.05, vy: -Math.sin(ang) * cs * 0.05, life: 0.7, decay: 0.05, color: '#7dffbb', size: cs * 0.08, shape: 'frag' });
        if (k >= 0.98 && !e.hit) { e.hit = true; this.burst(tx, ty, '#7dffbb', 16, 1.6, 'tick'); this.flashCells.set(e.to, now() + 300); }
      }
      else if (e.type === 'fudflow' || e.type === 'printflow') {
        const [fx, fy] = this.cellXY(e.from >= 0 ? e.from : e.to); const [tx, ty] = this.cellXY(e.to); const kk = easeOut(k);
        const x = fx + (tx - fx) * kk, y = fy + (ty - fy) * kk;
        ctx.globalAlpha = 0.9; if (e.type === 'fudflow') D.fud(ctx, x - cs / 2, y - cs / 2, cs * (0.6 + 0.4 * kk), t); else { ctx.globalAlpha = kk; D.wall(ctx, x - cs / 2, y - cs / 2, cs, 1, 1); }
      }
      else if (e.type === 'portal') { const [fx, fy] = this.cellXY(e.from); const [tx, ty] = this.cellXY(e.to); ctx.globalAlpha = 1 - k; ctx.strokeStyle = D.PORTAL_COLORS[(this.cells[e.from].pc || 0) % D.PORTAL_COLORS.length]; ctx.lineWidth = 4; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12; ctx.setLineDash([cs * 0.3, cs * 0.2]); ctx.lineDashOffset = -k * cs * 3; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.bezierCurveTo(fx, fy + cs * 2, tx, ty - cs * 2, tx, ty); ctx.stroke(); }
      ctx.restore();
    }
  }

  function comboText(k) { return { candleCandle: 'CROSS BREAKOUT', candleBurst: 'TRIPLE BREAKOUT', burstBurst: 'MEGA VOLUME', sweepChip: 'MARKET SWEEP', sweepCandle: 'CANDLE STORM', sweepBurst: 'VOLUME STORM', sweepSweep: 'TOTAL SWEEP', botBot: 'BOT SWARM', botSpecial: 'SMART DELIVERY' }[k] || 'BREAKOUT'; }

  /* ---------- BONDED candlestick meter ---------- */
  class Meter {
    constructor(canvas, pillBtn) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.pill = pillBtn; this.charge = 0; this.cap = 60; this.shown = 0; this.particles = []; this.milestone = 0; this.flash = 0; this.surge = 0; this.settings = { motion: false, fx: 2 }; this.full = false; }
    resize() { const r = this.canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2); this.W = r.width; this.H = r.height; this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr); this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    set(charge, cap, instant) {
      this.cap = cap; const prev = this.charge; this.charge = charge;
      if (instant) this.shown = charge;
      if (charge > prev && this.settings.fx > 0) for (let i = 0; i < Math.min(14, charge - prev); i++) this.particles.push({ x: -20 - Math.random() * 30, y: this.H * (0.2 + Math.random() * 0.7), life: 1 });
      const ms = [0.25, 0.5, 0.75, 1].filter(m => prev / cap < m && charge / cap >= m);
      if (ms.length) { this.flash = 1; this.milestone = ms[ms.length - 1]; }
      const full = charge >= cap; if (full && !this.full) { this.surge = 1; RTB.Audio.play('create'); }
      this.full = full; this.pill.classList.toggle('due', full);
      if (charge < prev) this.surge = 0;
    }
    frame(t, dt) {
      if (!this.W) this.resize(); const ctx = this.ctx; const W = this.W, H = this.H; if (!W) return;
      this.shown += (this.charge - this.shown) * Math.min(1, dt / 160);
      this.flash = Math.max(0, this.flash - dt / 600); this.surge = Math.max(0, this.surge - dt / 1400);
      ctx.clearRect(0, 0, W, H);
      const top = 16, bottom = H - 22, span = bottom - top; const frac = Math.min(1, this.shown / this.cap);
      // frame
      ctx.save(); D.rr(ctx, 4, 2, W - 8, H - 20, 8); ctx.fillStyle = '#0b2320'; ctx.fill(); ctx.strokeStyle = '#17423d'; ctx.lineWidth = 2; ctx.stroke(); ctx.clip();
      // chart line behind
      ctx.strokeStyle = 'rgba(63,217,135,.35)'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i <= 10; i++) { const x = 4 + (W - 8) * i / 10; const y = bottom - span * frac * (i / 10) - Math.sin(i * 1.7 + t / 900) * 4; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      // ticks
      for (const m of [0.25, 0.5, 0.75, 1]) { const y = bottom - span * m; ctx.strokeStyle = frac >= m ? '#3fd987' : 'rgba(255,255,255,.2)'; ctx.lineWidth = frac >= m ? 2 : 1; ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(W - 6, y); ctx.stroke(); }
      // candle
      const cx = W / 2; const bodyW = W * 0.42; const bodyH = span * frac; const glow = 0.4 + frac * 0.6 + this.flash;
      ctx.strokeStyle = '#3fd987'; ctx.lineWidth = 2; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 6 + 14 * frac * glow;
      ctx.beginPath(); ctx.moveTo(cx, bottom); ctx.lineTo(cx, bottom - bodyH - 6 - 10 * frac); ctx.stroke();
      const g = ctx.createLinearGradient(0, bottom - bodyH, 0, bottom); g.addColorStop(0, '#7dffbb'); g.addColorStop(1, '#1d8a58'); ctx.fillStyle = g;
      const over = this.full ? 8 * (1 + this.surge) : 0;
      D.rr(ctx, cx - bodyW / 2, bottom - bodyH - over, bodyW, bodyH + over, 3); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#0b2320'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
      if (this.full) { ctx.save(); ctx.shadowColor = '#3fd987'; ctx.shadowBlur = 20 + 10 * Math.sin(t / 150); ctx.fillStyle = '#7dffbb'; D.rr(ctx, cx - bodyW / 2 - 2, top - 8 - 6 * this.surge, bodyW + 4, 12, 3); ctx.fill(); ctx.restore(); }
      if (this.flash > 0) { ctx.save(); ctx.globalAlpha = this.flash; ctx.fillStyle = '#fff'; ctx.font = 'bold 10px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(Math.round(this.milestone * 100) + '%', cx, bottom - span * this.milestone - 4); ctx.restore(); }
      // inflow particles
      for (const p of this.particles) { p.x += (cx - p.x) * 0.12 + 1; p.y += ((bottom - bodyH) - p.y) * 0.08; p.life -= dt / 500; ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = '#7dffbb'; ctx.fillRect(p.x, p.y, 3, 5); ctx.restore(); }
      this.particles = this.particles.filter(p => p.life > 0);
      // label
      ctx.save(); ctx.fillStyle = this.full ? '#7dffbb' : 'rgba(255,255,255,.7)'; ctx.font = 'bold 9px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(Math.round(Math.min(100, this.shown / this.cap * 100)) + '%', cx, H - 8); ctx.restore();
    }
  }

  RTB.Board = Board; RTB.Meter = Meter;
})();
