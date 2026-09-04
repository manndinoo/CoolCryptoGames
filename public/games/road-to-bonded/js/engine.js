'use strict';
/* BONDED - authoritative match-3 model.
   Pure, deterministic, animation-free. Produces a list of "steps" for every
   player action; the renderer replays them. State is plain JSON. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  const Rng = RTB.Rng;

  const SYM_NAMES = ['MINT CORE', 'LIQUIDITY DROP', 'HOLDER SHIELD', 'SIGNAL PULSE', 'VOLUME BOLT', 'LAUNCH SPARK'];
  const SPECIAL_NAMES = { ch: 'BREAKOUT CANDLE', cv: 'BREAKOUT CANDLE', burst: 'VOLUME BURST', sweep: 'MARKET SWEEP', bot: 'SMART BOT', pill: 'BONDED' };
  const PILL_CHANCE = 1 / 230; // rare natural drop per spawned piece
  const NEXT_KINDS = ['ch', 'cv', 'burst', 'sweep', 'bot', 'pill'];
  const NEXT_WEIGHTS = [22, 22, 22, 14, 12, 8]; // the BONDED pill is the rare prize
  const OBJ_PRIORITY = ['halt', 'wallet', 'printer', 'wall', 'wallall', 'fud', 'paper', 'node', 'keys', 'capsule', 'dust', 'lane', 'collect'];
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const MAX_LOOPS = 400;

  function clone(o) { return (typeof structuredClone === 'function') ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }

  function mkCell() {
    return { a: 1, p: null, dust: 0, paper: 0, fud: 0, bl: null, exit: 0, pout: -1, pin: -1, pc: -1, lane: -1, sp: 0 };
  }

  /* ---------- state construction ---------- */

  function tokensOf(grid, w, h) {
    const out = [];
    for (let r = 0; r < h; r++) {
      const row = (grid[r] || '').trim().split(/\s+/).filter(Boolean);
      for (let c = 0; c < w; c++) out.push(row[c] || '.');
    }
    return out;
  }

  function applyToken(st, i, tok, def, portalMap) {
    const cell = st.cells[i];
    const parts = tok.split('+');
    for (const t of parts) {
      if (t === '.' || t === '') continue;
      if (t === '#') { cell.a = 0; cell.p = null; continue; }
      if (t === 'd') { cell.dust = 1; continue; }
      if (t === 'D') { cell.dust = 2; continue; }
      if (t === 'p') { cell.paper = 1; continue; }
      if (t === 'f') { cell.fud = 1; continue; }
      if (t === 'w') { cell.bl = { k: 'wall', hp: 1, max: 1 }; cell.p = null; continue; }
      if (t === 'W') { cell.bl = { k: 'wall', hp: 2, max: 2 }; cell.p = null; continue; }
      if (t === 'X') { cell.bl = { k: 'wall', hp: 3, max: 3 }; cell.p = null; continue; }
      if (t === 'c') { cell.p = { t: 'cap', u: st.uid++ }; continue; }
      if (t === 'e') { cell.exit = 1; continue; }
      if (t === 'k') { cell.p = { t: 'key', u: st.uid++ }; continue; }
      if (t[0] === 'g') { const n = parseInt(t.slice(1), 10); cell.bl = { k: 'gate', need: isNaN(n) ? (def.gateNeed || 1) : n }; cell.p = null; continue; }
      if (t === 'n') { cell.bl = { k: 'node', hp: 1, max: 1, ch: 0 }; cell.p = null; continue; }
      if (t === 'N') { cell.bl = { k: 'node', hp: 2, max: 2, ch: 0 }; cell.p = null; continue; }
      if (t === 'M') { cell.bl = { k: 'node', hp: 3, max: 3, ch: 0 }; cell.p = null; continue; }
      if (t === 'b') { cell.bl = { k: 'printer', hp: 3, max: 3 }; cell.p = null; continue; }
      if (t === 'q') { cell.bl = { k: 'wallet', id: -1 }; cell.p = null; continue; }
      if (t === 'h') { cell.bl = { k: 'halt', hp: 1, max: 1 }; cell.p = null; continue; }
      if (t === '^') { cell.sp = 1; continue; }
      if (t[0] === 'i' && t.length === 2) { portalMap.in[t[1]] = i; continue; }
      if (t[0] === 'o' && t.length === 2) { portalMap.out[t[1]] = i; continue; }
      if (/^[0-5]$/.test(t)) { cell.p = { t: 'chip', s: parseInt(t, 10), u: st.uid++ }; continue; }
      throw new Error('Unknown token ' + t + ' in level ' + def.id);
    }
  }

  function applyLayout(st, def, layout, initial) {
    const w = st.w, h = st.h;
    const toks = tokensOf(layout.grid, w, h);
    const portalMap = { in: {}, out: {} };
    if (initial) { st.cells = []; for (let i = 0; i < w * h; i++) st.cells.push(mkCell()); }
    for (let i = 0; i < w * h; i++) applyToken(st, i, toks[i], def, portalMap);
    // portals
    const letters = Object.keys(portalMap.in).sort();
    let pid = st.portals.length;
    for (const L of letters) {
      const from = portalMap.in[L], to = portalMap.out[L];
      if (to === undefined) throw new Error('Portal ' + L + ' has no exit in level ' + def.id);
      st.portals.push({ id: pid, from, to });
      st.cells[from].pout = to; st.cells[from].pc = pid;
      st.cells[to].pin = from; st.cells[to].pc = pid;
      pid++;
    }
    // wallets
    for (let i = 0; i < w * h; i++) {
      const c = st.cells[i];
      if (c.bl && c.bl.k === 'wallet' && c.bl.id < 0) {
        const id = Object.keys(st.wallets).length;
        const cells = [];
        const stack = [i];
        while (stack.length) {
          const j = stack.pop();
          const cj = st.cells[j];
          if (!cj.bl || cj.bl.k !== 'wallet' || cj.bl.id >= 0) continue;
          cj.bl.id = id; cells.push(j);
          const r = Math.floor(j / w), cc = j % w;
          for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = cc + dc;
            if (nr < 0 || nc < 0 || nr >= h || nc >= w) continue;
            stack.push(nr * w + nc);
          }
        }
        cells.sort((a, b) => a - b);
        st.wallets[id] = { id, hp: 3, max: 3, cells, contents: (layout.wallets && layout.wallets.contents) || (def.wallets && def.wallets.contents) || 'chips' };
      }
    }
    // lanes
    const lanes = layout.lanes || (initial ? def.lanes : null) || [];
    if (initial) st.lanes = [];
    for (const L of lanes) {
      const cells = [];
      if (L.row !== undefined) { for (let c = 0; c < w; c++) if (st.cells[L.row * w + c].a) cells.push(L.row * w + c); }
      else { for (let r = 0; r < h; r++) if (st.cells[r * w + L.col].a) cells.push(r * w + L.col); }
      const idx = st.lanes.length;
      st.lanes.push({ id: idx, row: L.row, col: L.col, dir: L.dir || 1, cells });
      for (const i of cells) st.cells[i].lane = idx;
    }
    // spawners: topmost active cell of each column (never a portal exit)
    for (let c = 0; c < w; c++) {
      for (let r = 0; r < h; r++) {
        const i = r * w + c;
        if (st.cells[i].a) { if (st.cells[i].pin < 0) st.cells[i].sp = 1; break; }
      }
    }
    for (let i = 0; i < w * h; i++) if (st.cells[i].pin >= 0) st.cells[i].sp = 0;
    // queues
    if (layout.capsules) {
      const onBoard = st.cells.filter(c => c.p && c.p.t === 'cap').length;
      st.caps = { left: Math.max(0, layout.capsules.total - onBoard), cols: layout.capsules.cols || [], maxOn: layout.capsules.maxOn || 2, cool: 0 };
    } else if (initial) st.caps = null;
    if (layout.keys) {
      const onBoard = st.cells.filter(c => c.p && c.p.t === 'key').length;
      const inWallets = Object.values(st.wallets).filter(wl => wl.contents === 'keys').length;
      st.keys = { left: Math.max(0, layout.keys.total - onBoard - inWallets), cols: layout.keys.cols || [], maxOn: layout.keys.maxOn || 1, cool: 0 };
    } else if (initial) st.keys = null;
    const fudDef = layout.fud || (initial ? def.fud : null);
    if (fudDef) st.fud = { cap: fudDef.cap === undefined ? 4 : fudDef.cap, every: fudDef.every || 3, spread: 0, next: -1, protect: fudDef.protect || [] };
    else if (initial) st.fud = null;
    st.printers = { every: (def.printer && def.printer.every) || 2, next: {} };
  }

  function setupObjectives(st, defObjs) {
    st.obj = defObjs.map(o => {
      const ob = { t: o.t, n: o.n || 0, p: 0 };
      if (o.s !== undefined) ob.s = o.s;
      if (o.t === 'fud') ob.n = st.cells.filter(c => c.fud).length;
      if (o.t === 'wallall') ob.n = 1;
      return ob;
    });
  }

  /* ---------- Engine ---------- */

  class Engine {
    constructor(def, st) { this.def = def; this.st = st; }

    static create(def, seed, seedIdx) {
      const st = {
        id: def.id, stage: 0, w: def.w, h: def.h, cells: [], portals: [], lanes: [], wallets: {},
        moves: def.moves, movesUsed: 0, score: 0, charge: 0, cap: def.cap || 60, lock: 0,
        obj: [], rng: Rng.create(seed), seed, seedIdx: seedIdx || 0, syms: def.syms, uid: 1,
        caps: null, keys: null, fud: null, printers: { every: 2, next: {} }, status: 'READY',
        bonded: 0, resets: 0, lastText: '',
      };
      applyLayout(st, def, def, true);
      setupObjectives(st, def.objectives);
      const e = new Engine(def, st);
      e.generateBoard();
      e.rollNext(true);
      e.refreshPreviews();
      return e;
    }

    static restore(def, st) { return new Engine(def, st); }
    clone() { return new Engine(this.def, clone(this.st)); }

    /* --- geometry helpers --- */
    idx(r, c) { return r * this.st.w + c; }
    rc(i) { return [Math.floor(i / this.st.w), i % this.st.w]; }
    inb(r, c) { return r >= 0 && c >= 0 && r < this.st.h && c < this.st.w; }
    cell(i) { return this.st.cells[i]; }
    neighbors(i) {
      const [r, c] = this.rc(i); const out = [];
      for (const [dr, dc] of DIRS) { const nr = r + dr, nc = c + dc; if (this.inb(nr, nc)) out.push(this.idx(nr, nc)); }
      return out;
    }
    symOf(p) { return p && (p.t === 'chip' || p.t === 'sp') && p.s >= 0 ? p.s : -1; }
    isMatchable(i) { const c = this.cell(i); return !!(c.a && !c.bl && c.p && !c.fud && this.symOf(c.p) >= 0); }
    isMovable(i) { const c = this.cell(i); return !!(c.a && !c.bl && c.p && !c.paper && !c.fud); }
    snapshot() { return clone(this.st.cells); }

    /* --- board generation --- */
    neededSyms() {
      const set = new Set();
      for (const o of this.st.obj) if (o.t === 'collect' && o.p < o.n) set.add(o.s);
      return set;
    }
    chipWeights(quota) {
      const w = [];
      const need = quota ? this.neededSyms() : new Set();
      for (let s = 0; s < this.st.syms; s++) w.push(need.has(s) ? 1.45 : 1);
      return w;
    }
    randomChipAvoiding(i, weights) {
      const st = this.st; const [r, c] = this.rc(i);
      const sym = (rr, cc) => this.inb(rr, cc) ? this.symOf(st.cells[this.idx(rr, cc)].p) : -1;
      const bad = new Set();
      const l1 = sym(r, c - 1), l2 = sym(r, c - 2), u1 = sym(r - 1, c), u2 = sym(r - 2, c);
      if (l1 >= 0 && l1 === l2) bad.add(l1);
      if (u1 >= 0 && u1 === u2) bad.add(u1);
      const ul = sym(r - 1, c - 1);
      if (l1 >= 0 && l1 === u1 && l1 === ul) bad.add(l1);
      const ur = sym(r - 1, c + 1), r1 = sym(r, c + 1);
      if (r1 >= 0 && r1 === u1 && r1 === ur) bad.add(r1);
      const ww = weights.map((x, s) => bad.has(s) ? 0 : x);
      let tot = 0; for (const x of ww) tot += x;
      const s = tot > 0 ? Rng.weighted(st.rng, ww) : Rng.weighted(st.rng, weights);
      return { t: 'chip', s, u: st.uid++ };
    }
    generateBoard() {
      const st = this.st;
      const targets = [];
      for (let i = 0; i < st.cells.length; i++) { const c = st.cells[i]; if (c.a && !c.bl && !c.p) targets.push(i); }
      const weights = this.chipWeights(false);
      for (let attempt = 0; attempt < 80; attempt++) {
        for (const i of targets) st.cells[i].p = null;
        for (const i of targets) st.cells[i].p = this.randomChipAvoiding(i, weights);
        if (this.findMatches().matched.size === 0 && this.legalSwaps().length >= 3) return;
      }
      // fallback: force no matches by full shuffle attempts
      this.shuffleBoard(null);
    }

    /* --- matching --- */
    findMatches(swapCells) {
      const st = this.st, w = st.w, h = st.h;
      const sq = swapCells && swapCells.length ? swapCells : null;
      const runs = [], squares = [];
      const symAt = (i) => this.isMatchable(i) ? st.cells[i].p.s : -1;
      for (let r = 0; r < h; r++) {
        let c = 0;
        while (c < w) {
          const s = symAt(this.idx(r, c));
          if (s < 0) { c++; continue; }
          let e = c + 1;
          while (e < w && symAt(this.idx(r, e)) === s) e++;
          if (e - c >= 3) { const cells = []; for (let x = c; x < e; x++) cells.push(this.idx(r, x)); runs.push({ cells, dir: 'h', len: e - c, s }); }
          c = e;
        }
      }
      for (let c = 0; c < w; c++) {
        let r = 0;
        while (r < h) {
          const s = symAt(this.idx(r, c));
          if (s < 0) { r++; continue; }
          let e = r + 1;
          while (e < h && symAt(this.idx(e, c)) === s) e++;
          if (e - r >= 3) { const cells = []; for (let y = r; y < e; y++) cells.push(this.idx(y, c)); runs.push({ cells, dir: 'v', len: e - r, s }); }
          r = e;
        }
      }
      for (let r = 0; r + 1 < h; r++) for (let c = 0; c + 1 < w; c++) {
        const a = this.idx(r, c), s = symAt(a);
        if (s < 0) continue;
        if (symAt(a + 1) === s && symAt(a + w) === s && symAt(a + w + 1) === s) {
          const cells = [a, a + 1, a + w, a + w + 1];
          if (sq && cells.some(x => sq.includes(x))) squares.push({ cells, s });
        }
      }
      const matched = new Set();
      for (const rn of runs) for (const i of rn.cells) matched.add(i);
      for (const sq of squares) for (const i of sq.cells) matched.add(i);
      // clusters via union-find on groups
      const groups = runs.map(g => ({ g, type: 'run' })).concat(squares.map(g => ({ g, type: 'sq' })));
      const parent = groups.map((_, i) => i);
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      const owner = new Map();
      groups.forEach((gr, gi) => {
        for (const i of gr.g.cells) {
          if (owner.has(i)) { const a = find(owner.get(i)), b = find(gi); if (a !== b) parent[a] = b; }
          else owner.set(i, gi);
        }
      });
      const byRoot = new Map();
      groups.forEach((gr, gi) => {
        const root = find(gi);
        if (!byRoot.has(root)) byRoot.set(root, { cells: new Set(), runs: [], squares: [], s: gr.g.s });
        const cl = byRoot.get(root);
        for (const i of gr.g.cells) cl.cells.add(i);
        if (gr.type === 'run') cl.runs.push(gr.g); else cl.squares.push(gr.g);
      });
      const clusters = [];
      for (const cl of byRoot.values()) {
        let kind = null, at = -1;
        const maxRun = cl.runs.reduce((m, rn) => Math.max(m, rn.len), 0);
        const hasH = cl.runs.some(rn => rn.dir === 'h'), hasV = cl.runs.some(rn => rn.dir === 'v');
        if (maxRun >= 5) { kind = 'sweep'; const rn = cl.runs.find(x => x.len === maxRun); at = rn.cells[Math.floor(rn.len / 2)]; }
        else if (hasH && hasV) {
          kind = 'burst';
          const hr = cl.runs.find(x => x.dir === 'h'), vr = cl.runs.find(x => x.dir === 'v');
          at = hr.cells.find(i => vr.cells.includes(i));
          if (at === undefined) at = hr.cells[Math.floor(hr.len / 2)];
        }
        else if (maxRun === 4) { const rn = cl.runs.find(x => x.len === 4); kind = rn.dir === 'h' ? 'ch' : 'cv'; at = rn.cells[2]; }
        else if (cl.runs.length === 0 && cl.squares.length) { kind = 'bot'; at = cl.squares[0].cells[0]; }
        clusters.push({ cells: [...cl.cells], s: cl.s, kind, at, runs: cl.runs, squares: cl.squares });
      }
      return { matched, clusters, runs, squares };
    }

    hasMatchAt(i) {
      const st = this.st, w = st.w, h = st.h;
      if (!this.isMatchable(i)) return false;
      const s = st.cells[i].p.s; const [r, c] = this.rc(i);
      const same = (rr, cc) => this.inb(rr, cc) && this.isMatchable(this.idx(rr, cc)) && st.cells[this.idx(rr, cc)].p.s === s;
      let n = 1; for (let x = c - 1; x >= 0 && same(r, x); x--) n++; for (let x = c + 1; x < w && same(r, x); x++) n++;
      if (n >= 3) return true;
      n = 1; for (let y = r - 1; y >= 0 && same(y, c); y--) n++; for (let y = r + 1; y < h && same(y, c); y++) n++;
      if (n >= 3) return true;
      for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
        const r0 = r + dr, c0 = c + dc;
        if (same(r0, c0) && same(r0, c0 + 1) && same(r0 + 1, c0) && same(r0 + 1, c0 + 1)) return true;
      }
      return false;
    }

    comboKind(pa, pb) {
      if (!pa || !pb) return null;
      if (pa.t === 'pill' || pb.t === 'pill') return 'pill';
      const A = pa.t === 'sp' ? pa.k : (pa.t === 'chip' ? 'chip' : null);
      const B = pb.t === 'sp' ? pb.k : (pb.t === 'chip' ? 'chip' : null);
      if (!A || !B) return null;
      const isC = (k) => k === 'ch' || k === 'cv';
      if (A === 'chip' && B === 'chip') return null;
      if (A === 'sweep' && B === 'chip') return 'sweepChip';
      if (B === 'sweep' && A === 'chip') return 'sweepChip';
      if (A === 'chip' || B === 'chip') return null; // special + chip = normal match rules
      if (A === 'sweep' && B === 'sweep') return 'sweepSweep';
      if ((A === 'sweep' && isC(B)) || (B === 'sweep' && isC(A))) return 'sweepCandle';
      if ((A === 'sweep' && B === 'burst') || (B === 'sweep' && A === 'burst')) return 'sweepBurst';
      if (A === 'bot' && B === 'bot') return 'botBot';
      if (A === 'bot' || B === 'bot') return 'botSpecial';
      if (isC(A) && isC(B)) return 'candleCandle';
      if ((isC(A) && B === 'burst') || (isC(B) && A === 'burst')) return 'candleBurst';
      if (A === 'burst' && B === 'burst') return 'burstBurst';
      return null;
    }

    isAdjacent(a, b) {
      const [ra, ca] = this.rc(a), [rb, cb] = this.rc(b);
      return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
    }

    isValidSwap(a, b) {
      if (a === b || !this.isAdjacent(a, b)) return false;
      if (!this.isMovable(a) || !this.isMovable(b)) return false;
      const st = this.st;
      const pa = st.cells[a].p, pb = st.cells[b].p;
      if (this.comboKind(pa, pb)) return true;
      st.cells[a].p = pb; st.cells[b].p = pa;
      const ok = this.hasMatchAt(a) || this.hasMatchAt(b);
      st.cells[a].p = pa; st.cells[b].p = pb;
      return ok;
    }

    legalSwaps() {
      const st = this.st, w = st.w, h = st.h, out = [];
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = this.idx(r, c);
        if (c + 1 < w && this.isValidSwap(i, i + 1)) out.push([i, i + 1]);
        if (r + 1 < h && this.isValidSwap(i, i + w)) out.push([i, i + w]);
      }
      return out;
    }

    /* Best hint: swap producing most matched cells (deterministic). */
    hint() {
      const st = this.st; let best = null, bestScore = -1;
      for (const [a, b] of this.legalSwaps()) {
        const pa = st.cells[a].p, pb = st.cells[b].p;
        let sc = 0;
        const ck = this.comboKind(pa, pb);
        if (ck) sc = ck === 'pill' ? 80 : 50;
        else { st.cells[a].p = pb; st.cells[b].p = pa; sc = this.findMatches().matched.size; st.cells[a].p = pa; st.cells[b].p = pb; }
        if (sc > bestScore) { bestScore = sc; best = [a, b]; }
      }
      return best;
    }

    /* --- objectives --- */
    obj(t, s) { return this.st.obj.find(o => o.t === t && (s === undefined || o.s === s)); }
    objProgress(t, amount, s) {
      const o = this.obj(t, s);
      if (o) o.p = Math.min(o.n, o.p + (amount || 1));
      if (t === 'keys') this.openGates();
    }
    objRemaining(o) {
      if (o.t === 'fud') return this.st.cells.filter(c => c.fud).length;
      if (o.t === 'wallall') return this.st.cells.filter(c => c.bl && (c.bl.k === 'wall' || c.bl.k === 'printer')).length;
      if (o.t === 'score') return Math.max(0, o.n - this.st.score);
      return Math.max(0, o.n - o.p);
    }
    objectivesDone() { return this.st.obj.every(o => this.objRemaining(o) === 0); }
    openGates() {
      const keysO = this.obj('keys'); if (!keysO) return;
      for (const c of this.st.cells) if (c.bl && c.bl.k === 'gate' && keysO.p >= c.bl.need) { c.bl = null; this._gateOpened = true; }
    }
    keysCollected() { const o = this.obj('keys'); return o ? o.p : 0; }

    /* --- charge & score --- */
    gain(n) { if (this.st.lock) return; this.st.charge = Math.min(this.st.cap, this.st.charge + n); }

    /* --- targeting (deterministic) --- */
    pickTargets(n, exclude) {
      const st = this.st; const out = []; const ex = new Set(exclude || []);
      const push = (i) => { if (i >= 0 && !ex.has(i) && !out.includes(i)) out.push(i); return out.length >= n; };
      const cells = st.cells;
      const chipAt = (i) => cells[i].p && cells[i].p.t === 'chip';
      for (const t of OBJ_PRIORITY) {
        const o = st.obj.find(x => x.t === t); if (!o || this.objRemaining(o) === 0) continue;
        if (t === 'halt') { for (let i = 0; i < cells.length; i++) if (cells[i].bl && cells[i].bl.k === 'halt') { if (push(i)) return out; } }
        else if (t === 'wallet') { const seen = new Set(); for (let i = 0; i < cells.length; i++) if (cells[i].bl && cells[i].bl.k === 'wallet' && !seen.has(cells[i].bl.id)) { seen.add(cells[i].bl.id); if (push(i)) return out; } }
        else if (t === 'printer') { for (let i = 0; i < cells.length; i++) if (cells[i].bl && cells[i].bl.k === 'printer') { if (push(i)) return out; } }
        else if (t === 'wall' || t === 'wallall') { for (let i = 0; i < cells.length; i++) if (cells[i].bl && (cells[i].bl.k === 'wall' || (t === 'wallall' && cells[i].bl.k === 'printer'))) { if (push(i)) return out; } }
        else if (t === 'fud') { for (let i = 0; i < cells.length; i++) if (cells[i].fud) { if (push(i)) return out; } }
        else if (t === 'paper') { for (let i = 0; i < cells.length; i++) if (cells[i].paper) { if (push(i)) return out; } }
        else if (t === 'node') { for (let i = 0; i < cells.length; i++) if (cells[i].bl && cells[i].bl.k === 'node' && !cells[i].bl.ch) { if (push(i)) return out; } }
        else if (t === 'keys') { for (let i = 0; i < cells.length; i++) if (cells[i].p && cells[i].p.t === 'key') { if (push(i)) return out; } }
        else if (t === 'capsule') {
          for (let i = cells.length - 1; i >= 0; i--) if (cells[i].p && cells[i].p.t === 'cap') {
            const j = this.downOf(i);
            if (j >= 0 && cells[j].a && !cells[j].bl && chipAt(j)) { if (push(j)) return out; }
            else if (j >= 0 && cells[j].a && cells[j].bl && cells[j].bl.k !== 'gate' && cells[j].bl.k !== 'node') { if (push(j)) return out; }
          }
        }
        else if (t === 'dust') { for (let i = 0; i < cells.length; i++) if (cells[i].dust > 0 && (chipAt(i) || !cells[i].p)) { if (push(i)) return out; } }
        else if (t === 'lane') { for (let i = 0; i < cells.length; i++) if (cells[i].lane >= 0 && chipAt(i)) { if (push(i)) return out; } }
        else if (t === 'collect') { for (let i = 0; i < cells.length; i++) if (chipAt(i) && cells[i].p.s === o.s) { if (push(i)) return out; } }
      }
      for (let i = 0; i < cells.length; i++) if (cells[i].bl && cells[i].bl.k !== 'gate' && !(cells[i].bl.k === 'node' && cells[i].bl.ch)) { if (push(i)) return out; }
      for (let i = 0; i < cells.length; i++) if (cells[i].fud || cells[i].paper) { if (push(i)) return out; }
      const common = this.mostCommonSym();
      for (let i = 0; i < cells.length; i++) if (chipAt(i) && cells[i].p.s === common) { if (push(i)) return out; }
      for (let i = 0; i < cells.length; i++) if (chipAt(i)) { if (push(i)) return out; }
      return out;
    }
    botTarget(i) { const t = this.pickTargets(1, [i]); return t.length ? t[0] : -1; }
    mostCommonSym(exclude) {
      const cnt = new Array(6).fill(0);
      for (const c of this.st.cells) if (c.p && c.p.t === 'chip' && !c.fud) cnt[c.p.s]++;
      if (exclude !== undefined && exclude >= 0) cnt[exclude] = -1;
      let best = 0; for (let s = 1; s < 6; s++) if (cnt[s] > cnt[best]) best = s;
      return best;
    }
    pillOnBoard() { for (let i = 0; i < this.st.cells.length; i++) { const c = this.st.cells[i]; if (c.p && c.p.t === 'pill') return i; } return -1; }
    bondedReady() { return this.st.status === 'READY' && this.pillOnBoard() >= 0; }

    /* --- effect cells --- */
    rowCells(i) { const [r] = this.rc(i); const out = []; for (let c = 0; c < this.st.w; c++) out.push(this.idx(r, c)); return out; }
    colCells(i) { const [, c] = this.rc(i); const out = []; for (let r = 0; r < this.st.h; r++) out.push(this.idx(r, c)); return out; }
    areaCells(i, rad) { const [r, c] = this.rc(i); const out = []; for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) if (this.inb(r + dr, c + dc)) out.push(this.idx(r + dr, c + dc)); return out; }
    symCells(s) { const out = []; for (let i = 0; i < this.st.cells.length; i++) { const c = this.st.cells[i]; if (c.a && c.p && this.symOf(c.p) === s && !c.fud) out.push(i); } return out; }

    /* ---------- resolution pass ---------- */
    newCtx() {
      return { matched: new Set(), struck: new Set(), activated: new Map(), dmg: {}, clusters: [], swapCells: [], events: { cleared: [], specials: [], creations: [], hits: [], converted: [], gates: [], keys: [], wallets: [] }, combo: null, converts: [], pass: 1, src: 'match' };
    }

    activate(ctx, i, kind, s, opts) {
      if (ctx.activated.has(i)) return;
      const entry = { i, kind, s, cells: [], target: -1 };
      ctx.activated.set(i, entry);
      let cells;
      if (kind === 'ch') cells = this.rowCells(i);
      else if (kind === 'cv') cells = this.colCells(i);
      else if (kind === 'burst') cells = this.areaCells(i, 1);
      else if (kind === 'sweep') { const sym = (opts && opts.sym >= 0) ? opts.sym : this.mostCommonSym(); entry.s = sym; cells = this.symCells(sym); cells.push(i); }
      else if (kind === 'bot') { const t = this.pickTargets(1, [i]); entry.target = t.length ? t[0] : -1; cells = entry.target >= 0 ? [entry.target, i] : [i]; }
      else if (kind === 'pill') {
        // BONDED: every chip of the chosen symbol, then three Smart Rockets on the top objectives.
        const st = this.st;
        let sym = (opts && opts.sym >= 0) ? opts.sym : -1;
        if (sym < 0 || !this.symCells(sym).some(x => st.cells[x].p.t === 'chip')) sym = this.mostCommonSym(opts && opts.exclude);
        entry.s = sym; entry.kind = 'bonded';
        cells = this.symCells(sym); cells.push(i);
        st.lock = 1; st.bonded++; st.score += 1000;
        const o = this.obj('bonded'); if (o) o.p = Math.min(o.n, o.p + 1);
        entry.cells = cells;
        for (const j of cells) this.strike(ctx, j, 'sp');
        const targets = this.pickTargets(3, cells);
        entry.targets = targets;
        targets.forEach((t, k) => { ctx.events.specials.push({ i: -1, kind: 'rocket', s: -1, cells: [t], target: t }); this.strike(ctx, t, 'rocket' + k); });
        ctx.events.specials.push(entry);
        return;
      }
      else cells = [i];
      entry.cells = cells;
      for (const j of cells) this.strike(ctx, j, kind === 'bot' ? 'bot' + i : 'sp');
      const o = this.obj(kind === 'ch' || kind === 'cv' ? 'candle' : kind === 'sweep' ? 'sweep' : null);
      if (o) o.p = Math.min(o.n, o.p + 1);
      ctx.events.specials.push(entry);
    }

    strike(ctx, j, src) {
      const st = this.st; const c = st.cells[j];
      if (!c.a) return;
      ctx.struck.add(j);
      if (c.bl) { this.damage(ctx, j, src || 'sp'); return; }
      if (c.fud || c.paper) return;
      const p = c.p;
      if (p && p.t === 'sp' && !ctx.activated.has(j)) this.activate(ctx, j, p.k, p.s);
      else if (p && p.t === 'pill' && !ctx.activated.has(j)) this.activate(ctx, j, 'pill', -1);
    }

    damage(ctx, j, src) {
      const st = this.st; const c = st.cells[j]; const bl = c.bl;
      if (!bl || bl.k === 'gate') return;
      if (bl.k === 'node' && bl.ch) return;
      if (bl.k === 'halt' && src === 'adj') return;
      const key = bl.k === 'wallet' ? 'w' + bl.id : 'c' + j;
      const bucket = ctx.dmg[src] || (ctx.dmg[src] = new Set());
      if (bucket.has(key)) return;
      bucket.add(key);
      if (bl.k === 'wallet') {
        const wl = st.wallets[bl.id]; wl.hp--; this.gain(2); st.score += 30 * ctx.pass;
        ctx.events.hits.push({ i: j, what: 'wallet', left: wl.hp, id: wl.id });
        if (wl.hp <= 0) this.openWallet(ctx, wl);
        return;
      }
      bl.hp--; this.gain(2); st.score += 30 * ctx.pass;
      ctx.events.hits.push({ i: j, what: bl.k, left: bl.hp });
      if (bl.hp <= 0) {
        if (bl.k === 'wall') { c.bl = null; this.objProgress('wall'); }
        else if (bl.k === 'printer') { c.bl = null; delete st.printers.next[j]; this.objProgress('printer'); }
        else if (bl.k === 'halt') { c.bl = null; this.objProgress('halt'); }
        else if (bl.k === 'node') { bl.hp = 0; bl.ch = 1; this.objProgress('node'); }
      }
    }

    openWallet(ctx, wl) {
      const st = this.st;
      const chips = this.chipWeights(true);
      wl.cells.forEach((i, k) => {
        const c = st.cells[i]; c.bl = null;
        if (k === 0 && wl.contents === 'keys') c.p = { t: 'key', u: st.uid++ };
        else if (k === 0 && wl.contents === 'capsule') c.p = { t: 'cap', u: st.uid++ };
        else c.p = { t: 'chip', s: Rng.weighted(st.rng, chips), u: st.uid++ };
      });
      delete st.wallets[wl.id];
      this.objProgress('wallet'); st.score += 300 * ctx.pass;
      ctx.events.wallets.push({ id: wl.id, cells: wl.cells });
    }

    removeFud(ctx, j) { const c = this.st.cells[j]; if (!c.fud) return; c.fud = 0; this.gain(2); this.st.score += 30 * ctx.pass; ctx.events.hits.push({ i: j, what: 'fud', left: 0 }); }
    removePaper(ctx, j) { const c = this.st.cells[j]; if (!c.paper) return; c.paper = 0; this.gain(2); this.st.score += 30 * ctx.pass; this.objProgress('paper'); ctx.events.hits.push({ i: j, what: 'paper', left: 0 }); }
    removeDust(ctx, j) { const c = this.st.cells[j]; if (c.dust <= 0) return; c.dust--; this.gain(2); this.st.score += 20 * ctx.pass; this.objProgress('dust'); ctx.events.hits.push({ i: j, what: 'dust', left: c.dust }); }
    collectKey(ctx, j) { const c = this.st.cells[j]; if (!c.p || c.p.t !== 'key') return; ctx.events.keys.push({ i: j, u: c.p.u }); c.p = null; this.st.score += 200; this.gain(3); this.objProgress('keys'); }

    clearChip(ctx, j) {
      const st = this.st; const c = st.cells[j]; const p = c.p;
      if (!p || p.t !== 'chip') return;
      ctx.events.cleared.push({ i: j, p });
      c.p = null;
      this.gain(1); st.score += 10 * ctx.pass;
      this.objProgress('collect', 1, p.s);
      if (c.lane >= 0) this.objProgress('lane');
      this.removeDust(ctx, j);
    }

    applyPass(ctx) {
      const st = this.st;
      const cells = st.cells;
      // matched cells
      for (const j of ctx.matched) {
        const c = cells[j];
        if (c.paper) this.removePaper(ctx, j);
        if (c.p && c.p.t === 'chip') this.clearChip(ctx, j);
      }
      // activated specials (remove pieces)
      for (const j of ctx.activated.keys()) {
        const c = cells[j];
        if (c.p && (c.p.t === 'sp' || c.p.t === 'pill')) { c.p = null; this.gain(1); st.score += 60 * ctx.pass; this.removeDust(ctx, j); }
      }
      // struck cells
      for (const j of ctx.struck) {
        const c = cells[j];
        if (!c.a || c.bl) continue;
        if (c.fud) { this.removeFud(ctx, j); continue; }
        if (c.paper) { this.removePaper(ctx, j); continue; }
        if (c.p) {
          if (c.p.t === 'chip') this.clearChip(ctx, j);
          else if (c.p.t === 'key') this.collectKey(ctx, j);
        } else this.removeDust(ctx, j);
      }
      // adjacency damage from matches
      for (const j of ctx.matched) {
        for (const nb of this.neighbors(j)) {
          const c = cells[nb];
          if (!c.a) continue;
          if (c.bl && ['wall', 'printer', 'wallet', 'node'].includes(c.bl.k)) this.damage(ctx, nb, 'adj');
          else if (c.fud) { const key = 'f' + nb; const b = ctx.dmg.adj || (ctx.dmg.adj = new Set()); if (!b.has(key)) { b.add(key); this.removeFud(ctx, nb); } }
          else if (c.p && c.p.t === 'key') this.collectKey(ctx, nb);
        }
      }
      // conversions (sweep+candle / sweep+burst): the converted cells' specials were activated already
      // creations
      for (const cl of ctx.clusters) {
        if (!cl.kind) continue;
        let at = cl.at;
        const sw = ctx.swapCells.find(x => cl.cells.includes(x));
        if (sw !== undefined) at = sw;
        const c = cells[at];
        if (!c.a || c.bl || c.p) continue;
        c.p = { t: 'sp', k: cl.kind, s: cl.kind === 'sweep' ? -1 : cl.s, u: st.uid++ };
        this.gain(cl.kind === 'sweep' ? 6 : 4); st.score += 100 * ctx.pass;
        if (cl.kind === 'burst') this.objProgress('burst');
        ctx.events.creations.push({ i: at, p: c.p });
      }
      // cascade bonus
      if (ctx.pass >= 2) this.gain(ctx.pass - 1);
      if (this._gateOpened) { this._gateOpened = false; ctx.events.gates.push(1); }
    }

    /* ---------- gravity ---------- */
    downOf(i) {
      const c = this.st.cells[i];
      if (c.pout >= 0) return c.pout;
      const [r, cc] = this.rc(i);
      return r + 1 < this.st.h ? this.idx(r + 1, cc) : -1;
    }
    canFillFromAbove(t) {
      const st = this.st; const c = st.cells[t];
      if (c.pin >= 0 || c.sp) return true;
      const [r, cc] = this.rc(t);
      if (r === 0) return false;
      const ab = st.cells[this.idx(r - 1, cc)];
      if (!ab.a || ab.bl || ab.pout >= 0) return false;
      if (ab.p && (ab.paper || ab.fud)) return false;
      return true;
    }
    settle(step) {
      const st = this.st, w = st.w, h = st.h, cells = st.cells;
      let guard = 0;
      while (guard++ < MAX_LOOPS) {
        let changed = false;
        // straight / portal falls, bottom-up
        for (let r = h - 1; r >= 0; r--) for (let c = 0; c < w; c++) {
          const i = this.idx(r, c);
          if (!this.isMovable(i)) continue;
          const j = this.downOf(i);
          if (j < 0) continue;
          const cj = cells[j];
          if (!cj.a || cj.bl || cj.p) continue;
          cj.p = cells[i].p; cells[i].p = null;
          step.moves.push({ u: cj.p.u, from: i, to: j });
          changed = true;
        }
        if (changed) continue;
        // diagonal slides: an empty cell that cannot be filled from above pulls
        // from the cell diagonally above it (left first, then right)
        for (let r = h - 1; r >= 1; r--) for (let c = 0; c < w; c++) {
          const t = this.idx(r, c); const ct = cells[t];
          if (!ct.a || ct.bl || ct.p || this.canFillFromAbove(t)) continue;
          for (const dc of [-1, 1]) {
            const nc = c + dc;
            if (!this.inb(r - 1, nc)) continue;
            const i = this.idx(r - 1, nc);
            if (!this.isMovable(i) || cells[i].pout >= 0) continue;
            ct.p = cells[i].p; cells[i].p = null;
            step.moves.push({ u: ct.p.u, from: i, to: t });
            changed = true; break;
          }
          if (changed) break;
        }
        if (changed) continue;
        // refill spawners
        for (let c = 0; c < w; c++) for (let r = 0; r < h; r++) {
          const i = this.idx(r, c); const ci = cells[i];
          if (!ci.a || !ci.sp || ci.bl || ci.p) continue;
          ci.p = this.spawnPiece(c);
          step.spawns.push({ u: ci.p.u, i, p: ci.p });
          changed = true;
        }
        if (changed) continue;
        // capsule exits
        let exited = false;
        for (let i = 0; i < cells.length; i++) {
          const ci = cells[i];
          if (ci.exit && ci.p && ci.p.t === 'cap') {
            step.exits.push({ u: ci.p.u, i });
            ci.p = null; exited = true;
            st.score += 500; this.gain(4); this.objProgress('capsule');
          }
        }
        if (exited) continue;
        break;
      }
    }
    spawnPiece(col) {
      const st = this.st;
      const count = (t) => st.cells.reduce((n, c) => n + (c.p && c.p.t === t ? 1 : 0), 0);
      if (st.caps && st.caps.left > 0 && st.caps.cols.includes(col) && st.caps.cool <= 0 && count('cap') < st.caps.maxOn) {
        st.caps.left--; st.caps.cool = 1;
        return { t: 'cap', u: st.uid++ };
      }
      if (st.keys && st.keys.left > 0 && st.keys.cols.includes(col) && st.keys.cool <= 0 && count('key') < st.keys.maxOn) {
        st.keys.left--; st.keys.cool = 1;
        return { t: 'key', u: st.uid++ };
      }
      if (!st.lock && st.charge >= st.cap && st.next) {
        const k = st.next;
        if (k !== 'pill' || count('pill') === 0) {
          st.charge = 0; st.drops = (st.drops || 0) + 1; this.rollNext(false);
          if (k === 'pill') { st.pills = (st.pills || 0) + 1; return { t: 'pill', u: st.uid++ }; }
          return { t: 'sp', k, s: k === 'sweep' ? -1 : Rng.weighted(st.rng, this.chipWeights(true)), u: st.uid++ };
        }
      }
      if (count('pill') === 0 && !st.lock && st.movesUsed >= 3 && Rng.next(st.rng) < PILL_CHANCE) { st.pills = (st.pills || 0) + 1; return { t: 'pill', u: st.uid++ }; }
      return { t: 'chip', s: Rng.weighted(st.rng, this.chipWeights(true)), u: st.uid++ };
    }
    /* Decide what the candle meter drops when it next fills. Levels that require a BONDED activation get the pill first. */
    rollNext(initial) {
      const st = this.st;
      if (initial && this.obj('bonded')) { st.next = 'pill'; return; }
      st.next = NEXT_KINDS[Rng.weighted(st.rng, NEXT_WEIGHTS)];
    }
    /* Place a BONDED pill directly on the board (stage transitions). */
    dropPill() {
      const st = this.st; const w = st.w; const mid = Math.floor(w / 2);
      const order = [mid, mid - 1, mid + 1, mid - 2, mid + 2, mid - 3, mid + 3].filter(c => c >= 0 && c < w);
      for (const c of order) for (let r = 0; r < st.h; r++) { const cell = st.cells[r * w + c]; if (cell.a && !cell.bl && !cell.paper && !cell.fud && cell.p && cell.p.t === 'chip') { cell.p = { t: 'pill', u: st.uid++ }; st.charge = 0; st.pills = (st.pills || 0) + 1; return r * w + c; } }
      return -1;
    }
    gravityStep(steps) {
      const step = { type: 'gravity', moves: [], spawns: [], exits: [] };
      this.settle(step);
      if (step.moves.length || step.spawns.length || step.exits.length) {
        step.board = this.snapshot(); step.hud = this.hud();
        steps.push(step);
      }
    }

    /* ---------- cascade loop ---------- */
    cascadeLoop(steps, firstCtx) {
      let pass = firstCtx ? firstCtx.pass : 1;
      let ctx = firstCtx;
      let guard = 0;
      while (guard++ < MAX_LOOPS) {
        if (!ctx) {
          const m = this.findMatches();
          if (m.matched.size === 0) break;
          ctx = this.newCtx(); ctx.pass = pass;
          this.seedCtxFromMatches(ctx, m);
        }
        this.applyPass(ctx);
        const step = { type: 'clear', pass: ctx.pass, ev: ctx.events, combo: ctx.combo, bonded: ctx.src === 'bonded', board: this.snapshot(), hud: this.hud() };
        steps.push(step);
        this.gravityStep(steps);
        pass = ctx.pass + 1;
        ctx = null;
      }
    }
    seedCtxFromMatches(ctx, m) {
      const st = this.st;
      for (const j of m.matched) {
        const c = st.cells[j];
        if (c.p && c.p.t === 'sp') this.activate(ctx, j, c.p.k, c.p.s);
        else ctx.matched.add(j);
      }
      ctx.clusters = m.clusters;
    }

    hud() {
      const st = this.st;
      return { moves: st.moves, score: st.score, charge: st.charge, cap: st.cap, pill: this.pillOnBoard(), bonded: st.bonded, next: st.next, pressure: st.pressure || 0, obj: st.obj.map(o => ({ t: o.t, s: o.s, n: o.n, p: o.p, left: this.objRemaining(o) })), status: st.status };
    }

    /* ---------- player actions ---------- */
    applySwap(a, b) {
      const st = this.st; const steps = [];
      if (st.status !== 'READY') return steps;
      if (!this.isAdjacent(a, b) || !this.isMovable(a) || !this.isMovable(b)) {
        steps.push({ type: 'swap', a, b, valid: false });
        return steps;
      }
      const pa = st.cells[a].p, pb = st.cells[b].p;
      st.cells[a].p = pb; st.cells[b].p = pa;
      const combo = this.comboKind(pa, pb);
      let ctx = null;
      if (combo === 'pill') return this.pillSwap(a, b, steps);
      if (combo) {
        ctx = this.newCtx(); ctx.swapCells = [a, b]; ctx.combo = { kind: combo, a, b };
        this.applyCombo(ctx, combo, a, b);
      } else {
        const m = this.findMatches([a, b]);
        if (m.matched.size === 0) {
          st.cells[a].p = pa; st.cells[b].p = pb;
          steps.push({ type: 'swap', a, b, valid: false });
          return steps;
        }
        ctx = this.newCtx(); ctx.swapCells = [a, b];
        this.seedCtxFromMatches(ctx, m);
      }
      st.moves--; st.movesUsed++;
      steps.push({ type: 'swap', a, b, valid: true, board: this.snapshot(), hud: this.hud() });
      this.cascadeLoop(steps, ctx);
      this.pressureTick(steps);
      this.endOfMove(steps);
      return steps;
    }

    /* Swapping the BONDED pill with any piece fires it on that piece's symbol. Costs no move. */
    pillSwap(a, b, steps) {
      const st = this.st; const P = (i) => st.cells[i].p;
      const pillAt = P(a).t === 'pill' ? a : b; const other = pillAt === a ? b : a; const op = P(other);
      const ctx = this.newCtx(); ctx.swapCells = [a, b]; ctx.combo = { kind: 'pill', a, b }; ctx.src = 'bonded';
      let sym = -1;
      if (op.t === 'chip') sym = op.s;
      else if (op.t === 'sp') { sym = op.s; this.activate(ctx, other, op.k, op.s); }
      else if (op.t === 'pill') { this.activate(ctx, other, 'pill', -1); sym = -1; }
      const first = ctx.activated.get(other);
      this.activate(ctx, pillAt, 'pill', sym, { sym, exclude: op.t === 'pill' && first ? first.s : -1 });
      steps.push({ type: 'swap', a, b, valid: true, board: this.snapshot(), hud: this.hud() });
      this.cascadeLoop(steps, ctx);
      st.lock = 0;
      if (this.checkWin(steps)) return steps;
      this.refreshPreviews();
      if (this.legalSwaps().length === 0) this.marketReset(steps);
      steps.push({ type: 'end', status: st.status, hud: this.hud() });
      return steps;
    }

    applyCombo(ctx, combo, a, b) {
      const st = this.st;
      // identify pieces by position after swap
      const P = (i) => st.cells[i].p;
      const center = b;
      const mark = (i) => { ctx.activated.set(i, { i, kind: 'combo', s: -1, cells: [], target: -1 }); };
      st.score += 200;
      if (combo === 'sweepChip') {
        const sweepAt = P(a).t === 'sp' ? a : b; const chipAt = sweepAt === a ? b : a;
        const s = P(chipAt).s;
        this.activate(ctx, sweepAt, 'sweep', -1, { sym: s });
      } else if (combo === 'sweepSweep') {
        mark(a); mark(b);
        for (let i = 0; i < st.cells.length; i++) { const c = st.cells[i]; if (!c.a) continue; if (c.bl || c.fud || c.paper) this.strike(ctx, i, 'sp'); else if (c.p && c.p.t === 'chip') ctx.struck.add(i); else if (c.p && c.p.t === 'sp' && i !== a && i !== b) this.strike(ctx, i, 'sp'); }
        ctx.events.specials.push({ i: center, kind: 'sweepSweep', s: -1, cells: [], target: -1 });
        const o = this.obj('sweep'); if (o) o.p = Math.min(o.n, o.p + 2);
      } else if (combo === 'sweepCandle' || combo === 'sweepBurst') {
        const sweepAt = P(a).k === 'sweep' ? a : b; const other = sweepAt === a ? b : a;
        const s = P(other).s; const kindBase = combo === 'sweepCandle' ? 'candle' : 'burst';
        mark(sweepAt);
        const cellsOf = this.symCells(s).filter(i => st.cells[i].p.t === 'chip');
        cellsOf.forEach((i, k) => { st.cells[i].p = { t: 'sp', k: kindBase === 'candle' ? (k % 2 === 0 ? 'ch' : 'cv') : 'burst', s, u: st.uid++ }; ctx.events.converted.push({ i, p: st.cells[i].p }); });
        ctx.events.specials.push({ i: sweepAt, kind: 'sweep', s, cells: cellsOf.slice(), target: -1 });
        const o = this.obj('sweep'); if (o) o.p = Math.min(o.n, o.p + 1);
        this.activate(ctx, other, P(other).k, s);
        for (const i of cellsOf) this.activate(ctx, i, st.cells[i].p.k, s);
      } else if (combo === 'candleCandle') {
        mark(a); mark(b);
        const cells = this.rowCells(center).concat(this.colCells(center));
        ctx.events.specials.push({ i: center, kind: 'cross', s: -1, cells, target: -1 });
        for (const j of cells) this.strike(ctx, j, 'sp');
        const o = this.obj('candle'); if (o) o.p = Math.min(o.n, o.p + 2);
      } else if (combo === 'candleBurst') {
        mark(a); mark(b);
        const [r, c] = this.rc(center); const cells = [];
        for (let dr = -1; dr <= 1; dr++) if (this.inb(r + dr, c)) cells.push(...this.rowCells(this.idx(r + dr, c)));
        for (let dc = -1; dc <= 1; dc++) if (this.inb(r, c + dc)) cells.push(...this.colCells(this.idx(r, c + dc)));
        ctx.events.specials.push({ i: center, kind: 'bigcross', s: -1, cells, target: -1 });
        for (const j of cells) this.strike(ctx, j, 'sp');
        this.objProgress('combo'); const o = this.obj('candle'); if (o) o.p = Math.min(o.n, o.p + 1);
      } else if (combo === 'burstBurst') {
        mark(a); mark(b);
        const cells = this.areaCells(center, 2);
        ctx.events.specials.push({ i: center, kind: 'megaburst', s: -1, cells, target: -1 });
        for (const j of cells) this.strike(ctx, j, 'sp');
      } else if (combo === 'botBot') {
        mark(a); mark(b);
        const ts = this.pickTargets(2, [a, b]);
        ctx.events.specials.push({ i: a, kind: 'bot', s: -1, cells: ts.slice(0, 1), target: ts[0] === undefined ? -1 : ts[0] });
        ctx.events.specials.push({ i: b, kind: 'bot', s: -1, cells: ts.slice(1, 2), target: ts[1] === undefined ? -1 : ts[1] });
        for (const t of ts) this.strike(ctx, t, 'bot' + t);
      } else if (combo === 'botSpecial') {
        const botAt = P(a).k === 'bot' ? a : b; const spAt = botAt === a ? b : a; const sp = P(spAt);
        mark(botAt); mark(spAt);
        const ts = this.pickTargets(1, [a, b]); const t = ts.length ? ts[0] : center;
        ctx.events.specials.push({ i: botAt, kind: 'botcarry', s: sp.s, carry: sp.k, cells: [t], target: t });
        // activate carried special centered at target
        const fake = { i: t, kind: sp.k, s: sp.s, cells: [], target: -1 };
        let cells;
        if (sp.k === 'ch') cells = this.rowCells(t); else if (sp.k === 'cv') cells = this.colCells(t);
        else if (sp.k === 'burst') cells = this.areaCells(t, 1);
        else { const sym = st.cells[t].p && st.cells[t].p.t === 'chip' ? st.cells[t].p.s : this.mostCommonSym(); fake.s = sym; cells = this.symCells(sym); cells.push(t); }
        fake.cells = cells;
        ctx.events.specials.push(fake);
        for (const j of cells) this.strike(ctx, j, 'sp');
        const o = this.obj(sp.k === 'ch' || sp.k === 'cv' ? 'candle' : sp.k === 'sweep' ? 'sweep' : null); if (o) o.p = Math.min(o.n, o.p + 1);
      }
      // remove the swapped special pieces themselves (marked ones)
    }

    /* Sell Pressure: lazy three-piece swaps with no cascade or special build
       pressure; three in a row is a DIP that burns a move. A cascade of four
       or more passes is PARABOLIC and refunds a move. */
    pressureTick(steps) {
      const st = this.st;
      const clears = steps.filter(s => s.type === 'clear');
      const cleared = clears.reduce((n, s) => n + s.ev.cleared.length, 0);
      const passes = clears.length;
      const special = clears.some(s => s.ev.specials.length || s.ev.creations.length || s.combo);
      if (passes >= 4) { st.moves++; st.pressure = 0; st.parabolic = (st.parabolic || 0) + 1; steps.push({ type: 'bonus', kind: 'parabolic', hud: this.hud() }); return; }
      if (cleared <= 3 && passes <= 1 && !special) {
        st.pressure = (st.pressure || 0) + 1;
        if (st.pressure >= 3) { st.pressure = 0; st.moves = Math.max(0, st.moves - 1); st.dips = (st.dips || 0) + 1; steps.push({ type: 'dip', hud: this.hud() }); }
        else steps.push({ type: 'pressure', hud: this.hud() });
      } else st.pressure = 0;
    }
    endOfMove(steps) {
      const st = this.st; st.lock = 0;
      if (this.checkWin(steps)) return steps;
      if (st.lanes.length) {
        this.shiftLanes(steps);
        this.cascadeLoop(steps, null);
        if (this.checkWin(steps)) return steps;
      }
      this.fudTick(steps);
      this.printerTick(steps);
      if (st.caps) st.caps.cool = Math.max(0, st.caps.cool - 1);
      if (st.keys) st.keys.cool = Math.max(0, st.keys.cool - 1);
      this.refreshPreviews();
      if (st.moves <= 0) { st.status = 'LOSE'; steps.push({ type: 'end', status: 'LOSE', hud: this.hud() }); return steps; }
      if (this.legalSwaps().length === 0) this.marketReset(steps);
      steps.push({ type: 'end', status: st.status, hud: this.hud() });
      return steps;
    }

    checkWin(steps) {
      const st = this.st;
      if (!this.objectivesDone()) return false;
      const stages = this.def.stages || [];
      if (st.stage < stages.length) { this.transitionStage(steps, stages[st.stage]); return true; }
      st.status = 'WIN';
      st.score += st.moves * 150;
      steps.push({ type: 'end', status: 'WIN', hud: this.hud() });
      return true;
    }

    transitionStage(steps, stageDef) {
      const st = this.st;
      st.stage++;
      applyLayout(st, this.def, stageDef, false);
      setupObjectives(st, stageDef.objectives);
      this.dropPill();
      // fill any emptied active cells (e.g. gate leftovers) and add FUD only on chips
      for (let i = 0; i < st.cells.length; i++) { const c = st.cells[i]; if (c.fud && (!c.p || c.p.t !== 'chip')) { c.p = { t: 'chip', s: Rng.weighted(st.rng, this.chipWeights(false)), u: st.uid++ }; } }
      steps.push({ type: 'stage', stage: st.stage, board: this.snapshot(), hud: this.hud() });
      this.gravityStep(steps);
      this.cascadeLoop(steps, null);
      this.refreshPreviews();
      if (st.moves <= 0 && st.status === 'READY') { st.status = 'LOSE'; steps.push({ type: 'end', status: 'LOSE', hud: this.hud() }); return; }
      if (this.legalSwaps().length === 0) this.marketReset(steps);
      steps.push({ type: 'end', status: st.status, hud: this.hud() });
    }

    shiftLanes(steps) {
      const st = this.st;
      for (const L of st.lanes) {
        const n = L.cells.length; if (n < 2) continue;
        const contents = L.cells.map(i => { const c = st.cells[i]; return { p: c.p, paper: c.paper, fud: c.fud }; });
        const moves = [];
        for (let k = 0; k < n; k++) {
          const to = ((k + L.dir) % n + n) % n;
          const src = contents[k]; const cell = st.cells[L.cells[to]];
          cell.p = src.p; cell.paper = src.paper; cell.fud = src.fud;
          if (src.p) moves.push({ u: src.p.u, from: L.cells[k], to: L.cells[to] });
        }
        steps.push({ type: 'lane', lane: L.id, dir: L.dir, moves, board: this.snapshot(), hud: this.hud() });
      }
      const g = { type: 'gravity', moves: [], spawns: [], exits: [] };
      this.settle(g);
      if (g.moves.length || g.spawns.length || g.exits.length) { g.board = this.snapshot(); g.hud = this.hud(); steps.push(g); }
    }

    fudCandidates() {
      const st = this.st; const out = new Set();
      for (let i = 0; i < st.cells.length; i++) {
        if (!st.cells[i].fud) continue;
        for (const nb of this.neighbors(i)) {
          const c = st.cells[nb];
          if (!c.a || c.bl || c.fud || c.paper || c.exit || !c.p || c.p.t !== 'chip') continue;
          if (st.fud.protect.includes(nb)) continue;
          out.add(nb);
        }
      }
      return [...out].sort((a, b) => a - b);
    }
    fudTick(steps) {
      const st = this.st; if (!st.fud) return;
      if (st.movesUsed % st.fud.every !== 0) return;
      if (st.fud.spread >= st.fud.cap) return;
      let t = st.fud.next;
      const cands = this.fudCandidates();
      if (t < 0 || !cands.includes(t)) t = cands.length ? cands[Rng.int(st.rng, cands.length)] : -1;
      if (t < 0) return;
      const from = this.neighbors(t).find(nb => st.cells[nb].fud);
      st.cells[t].fud = 1; st.fud.spread++; st.fud.next = -1;
      steps.push({ type: 'fud', from, to: t, board: this.snapshot(), hud: this.hud() });
    }
    printerTargetFor(i) {
      const st = this.st; const [pr, pc] = this.rc(i);
      let best = -1, bestD = 1e9;
      for (let j = 0; j < st.cells.length; j++) {
        const c = st.cells[j];
        if (!c.a || c.bl || c.fud || c.paper || c.exit || !c.p || c.p.t !== 'chip') continue;
        if (st.fud && st.fud.protect.includes(j)) continue;
        const [r, cc] = this.rc(j); const d = Math.abs(r - pr) + Math.abs(cc - pc);
        if (d < bestD) { bestD = d; best = j; }
      }
      return best;
    }
    printerTick(steps) {
      const st = this.st;
      const printers = []; for (let i = 0; i < st.cells.length; i++) if (st.cells[i].bl && st.cells[i].bl.k === 'printer') printers.push(i);
      if (!printers.length) return;
      if (st.movesUsed % st.printers.every !== 0) return;
      for (const i of printers) {
        let t = st.printers.next[i];
        const c = t !== undefined && t >= 0 ? st.cells[t] : null;
        if (!c || !c.a || c.bl || c.fud || c.paper || c.exit || !c.p || c.p.t !== 'chip') t = this.printerTargetFor(i);
        if (t < 0) continue;
        st.cells[t].p = null; st.cells[t].bl = { k: 'wall', hp: 1, max: 1 };
        delete st.printers.next[i];
        steps.push({ type: 'print', printer: i, at: t, board: this.snapshot(), hud: this.hud() });
      }
    }
    refreshPreviews() {
      const st = this.st;
      if (st.fud) {
        const cands = this.fudCandidates();
        if (st.fud.next < 0 || !cands.includes(st.fud.next)) st.fud.next = cands.length ? cands[Rng.int(st.rng, cands.length)] : -1;
      }
      for (let i = 0; i < st.cells.length; i++) if (st.cells[i].bl && st.cells[i].bl.k === 'printer') {
        const t = st.printers.next[i]; const c = t !== undefined && t >= 0 ? st.cells[t] : null;
        if (!c || !c.a || c.bl || c.fud || c.paper || c.exit || !c.p || c.p.t !== 'chip') st.printers.next[i] = this.printerTargetFor(i);
      }
    }
    fudTimer() { const st = this.st; if (!st.fud) return 0; return st.fud.every - (st.movesUsed % st.fud.every); }
    printTimer() { const st = this.st; return st.printers.every - (st.movesUsed % st.printers.every); }

    shuffleBoard(steps) {
      const st = this.st;
      const idxs = [];
      for (let i = 0; i < st.cells.length; i++) { const c = st.cells[i]; if (c.a && !c.bl && !c.paper && !c.fud && c.p && c.p.t === 'chip') idxs.push(i); }
      const pieces = idxs.map(i => st.cells[i].p);
      let ok = false;
      for (let attempt = 0; attempt < 400 && !ok; attempt++) {
        Rng.shuffle(st.rng, pieces);
        idxs.forEach((i, k) => { st.cells[i].p = pieces[k]; });
        ok = this.findMatches().matched.size === 0 && this.legalSwaps().length >= 3;
      }
      if (!ok) {
        // regenerate symbols entirely (still deterministic)
        for (let attempt = 0; attempt < 200 && !ok; attempt++) {
          for (const i of idxs) st.cells[i].p = null;
          const weights = this.chipWeights(true);
          for (const i of idxs) st.cells[i].p = this.randomChipAvoiding(i, weights);
          ok = this.findMatches().matched.size === 0 && this.legalSwaps().length >= 3;
        }
      }
      if (steps) { st.resets++; steps.push({ type: 'reset', board: this.snapshot(), hud: this.hud() }); }
    }
    marketReset(steps) {
      this.shuffleBoard(steps);
      // If reset somehow created matches, resolve them (never happens when ok)
      if (this.findMatches().matched.size) this.cascadeLoop(steps, null);
    }

  }

  RTB.Engine = Engine;
  RTB.SYM_NAMES = SYM_NAMES;
  RTB.SPECIAL_NAMES = SPECIAL_NAMES;
  RTB.OBJ_PRIORITY = OBJ_PRIORITY;
  RTB.cloneState = clone;
})();
