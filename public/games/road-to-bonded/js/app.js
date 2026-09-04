'use strict';
/* BONDED - application shell: screens, flows, HUD, tutorials, persistence. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  const { Engine, Save, Audio, Draw, Board, Meter, Roadmap, Backdrop } = RTB;
  const $ = (id) => document.getElementById(id);
  const shell = $('shell');
  const GRADES = ['', 'LISTED', 'MOVING', 'TRENDING'];
  const OBJ_LABEL = { collect: (o) => Draw.SYM[o.s].name, dust: () => 'LAUNCH DUST', paper: () => 'PAPER HANDS', candle: () => 'BREAKOUT CANDLES', burst: () => 'VOLUME BURSTS', sweep: () => 'MARKET SWEEPS', combo: () => 'CANDLE + BURST', capsule: () => 'COIN CAPSULES', wall: () => 'SELL WALLS', wallall: () => 'CLEAR ALL WALLS', keys: () => 'MINT KEYS', node: () => 'VOLUME NODES', lane: () => 'TICKER LANE', fud: () => 'FUD CLOUDS', printer: () => 'BOT PRINTERS', wallet: () => 'DEAD WALLETS', halt: () => 'HALT SHIELDS', bonded: () => 'ACTIVATE BONDED', score: () => 'MCAP TARGET' };
  const RANKS = [[0, 'SHRIMP'], [400, 'FISH'], [1200, 'DOLPHIN'], [2500, 'SHARK'], [4500, 'WHALE']];
  const rankName = (pts) => { let n = RANKS[0][1]; for (const [p, name] of RANKS) if (pts >= p) n = name; return n; };

  const TUTORIALS = {
    swap: { title: 'MAKE A MATCH', pages: ['Swap two neighbouring Market Chips to line up three or more of the same symbol. Drag a chip, or tap one then tap its neighbour.', 'A swap only counts when it creates a match. Bad swaps bounce back and cost nothing. Good swaps cost exactly one move; cascades are free.'], art: 'swap' },
    goals: { title: 'GOALS, MOVES & LIVES', pages: ['Every level lists objectives at the top and the Bonding Curve bar shows how close you are. Clear them all before the move counter hits zero and the level closes green.', 'Finishing on your very last move still counts. Every cascade after your final swap is resolved before the market decides.', 'Losing a level costs a life. Lives come back one at a time over real time, and three wins in a row earn a bonus life.'], art: 'goals' },
    pressure: { title: 'SELL PRESSURE & PARABOLIC', pages: ['Lazy three-piece swaps with no cascade and no special build Sell Pressure. Three in a row is a DIP: you lose an extra move.', 'Big plays are rewarded. A cascade that chains four or more times goes PARABOLIC and refunds a move. Set up specials and combos, then cash them in.'], art: 'combo' },
    dust: { title: 'LAUNCH DUST', pages: ['Launch Dust sits under a cell. Match on top of it or hit it with a special to clear a layer. Some dust has two layers.'], art: 'dust' },
    candle: { title: 'BREAKOUT CANDLE', pages: ['Match four in a line to create a Breakout Candle. Horizontal creation clears a whole row, vertical creation a whole column.', 'Fire it by matching it, swapping it with another special, or hitting it with an effect. Swap two candles for a full cross.'], art: 'candle' },
    paper: { title: 'PAPER HANDS', pages: ['Paper Hands wrap a chip so it cannot move. Match it in place, or strike it with a special, to free the holder.'], art: 'paper' },
    bonded: { title: 'CANDLE DROPS & THE PILL', pages: ['Clearing chips, breaking blockers and chaining cascades fills the green candle beside the board. When it fills, the power-up shown in the NEXT slot drops onto the board.', 'Most drops are Candles, Bursts, Sweeps or Bots. The rare prize is the BONDED pill: the strongest piece in the game. It can also appear on its own once in a long while.', 'Swap the pill with any chip: every copy of that symbol clears and three Smart Rockets strike your top objectives. Swap it with a special to fire both. It costs no move and never fires by itself.'], art: 'bonded' },
    capsule: { title: 'COIN CAPSULE', pages: ['Coin Capsules fall with gravity but never match. Clear the chips beneath them to guide each capsule down to a glowing exit.'], art: 'capsule' },
    burst: { title: 'VOLUME BURST', pages: ['Match in a T or L shape to compress a Volume Burst. It detonates a 3×3 area with a two-pulse shockwave.', 'Swap a Burst with a Candle to clear three rows and three columns at once.'], art: 'burst' },
    holes: { title: 'RUG HOLES', pages: ['Dark stamped cells are inactive. Pieces flow around them, so plan for the gaps when you route capsules.'], art: 'holes' },
    wall: { title: 'SELL WALL', pages: ['Sell Walls are red barriers with one to three layers. Match beside them or strike them with specials. Each hit removes one layer.'], art: 'wall' },
    keys: { title: 'MINT KEYS & CURVE GATES', pages: ['Collect Mint Keys by matching next to them or striking them. When the quota is reached the matching Curve Gate opens and the board connects.'], art: 'keys' },
    node: { title: 'VOLUME NODE', pages: ['Volume Nodes are fixed terminals. Match beside them or strike them to charge. Fully charged nodes turn bright green.'], art: 'node' },
    lane: { title: 'TICKER LANE', pages: ['An arrowed lane shifts one cell after every completed move, once cascades finish. The direction never changes: plan around it.', 'Chips cleared while inside the lane count as marked pieces.'], art: 'lane' },
    portal: { title: 'LIQUIDITY PORTAL', pages: ['Colour-matched portals route falling pieces from an entrance to its exit. The route is fixed and never random.'], art: 'portal' },
    fud: { title: 'FUD CLOUD', pages: ['FUD Clouds cover chips. Clear them with adjacent matches or specials. Every third move one cloud spreads.', 'The exact next destination is previewed with a countdown. Spread is capped per level, but containment is on you.'], art: 'fud' },
    printer: { title: 'BOT PRINTER', pages: ['A Bot Printer prints a Sell Wall every two moves until you destroy it with three hits. Its next print location is previewed.'], art: 'printer' },
    wallet: { title: 'DEAD WALLET', pages: ['A Dead Wallet is a 2×2 vault with three shared hits. Damage it from any side. Opening it can release keys, capsules or chips.'], art: 'wallet' },
    sixth: { title: 'SIXTH SYMBOL', pages: ['Launch Spark joins the board. Six symbols means fewer easy matches: build specials and keep your setups alive.'], art: 'sixth' },
    halt: { title: 'HALT SHIELD', pages: ['Halt Shields ignore normal matches. Only special effects or BONDED can break them.'], art: 'halt' },
    combo: { title: 'SPECIAL COMBINATIONS', pages: ['Swap two specials together for bigger effects: Candle + Candle, Candle + Burst, Burst + Burst, and anything with a Market Sweep or Smart Bot.'], art: 'combo' },
    sweep: { title: 'MARKET SWEEP', pages: ['Match five in a line to create a Market Sweep. Swap it with any chip to clear every piece of that symbol. Swap it with a special to convert and detonate.'], art: 'sweep' },
    bot: { title: 'SMART BOT', pages: ['Match a 2×2 square to build a Smart Bot. When it fires it flies to your highest-priority objective, shown by its targeting ring.'], art: 'bot' },
    finale: { title: 'ALL-TIME HIGH', pages: ['The finale has two stages sharing one move counter. Finish stage one to transform the board, and a BONDED pill is placed for you as the reward.'], art: 'finale' },
  };
  const HELP_ORDER = ['swap', 'goals', 'pressure', 'candle', 'burst', 'sweep', 'bot', 'combo', 'bonded', 'dust', 'paper', 'wall', 'capsule', 'holes', 'keys', 'node', 'lane', 'portal', 'fud', 'printer', 'wallet', 'halt', 'sixth', 'finale'];

  const App = {
    screen: null, engine: null, level: null, board: null, meter: null, roadmap: null, bondedBusy: false, inputArmed: false, tutQueue: [],
    save: null, cascadeMax: 1, hintTimer: 0,

    init() {
      this.save = Save.load();
      this.applySettings();
      this.board = new Board($('board'), {
        onSwap: (a, b) => this.trySwap(a, b), onSelect: () => Audio.play('click'),
        onHud: (hud, step) => this.updateHud(hud, step), onText: (t, k) => this.status(t, k), onShake: (k) => this.shake(k), onCascade: (p) => this.cascade(p), onBanner: (t) => this.toast(t),
      });
      this.meter = new Meter($('meter-canvas'), $('pill-btn')); this.board.meter = this.meter;
      this.backdrop = new Backdrop($('backdrop'));
      this.roadmap = new Roadmap($('map-scroll'), $('map-spacer'), $('map-canvas'), { onSelect: (id) => this.openPrelevel(id), onLocked: (id) => this.showLocked(id), onSoon: (id) => this.showSoon(id) });
      this.bind();
      this.buildHelp();
      this.loading();
    },

    /* ---------- settings ---------- */
    applySettings() {
      const s = this.save.settings;
      shell.classList.toggle('motion-reduced', !!s.motion); shell.classList.toggle('motion-full', !s.motion);
      shell.classList.toggle('dark', !!s.dark);
      if (this.roadmap) { this.roadmap.dark = !!s.dark; this.roadmap._dirty = true; }
      if (this.backdrop) this.backdrop.dark = !!s.dark;
      const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', s.dark ? '#06120f' : '#17423d');
      Audio.setSound(s.sound); Audio.setMusic(s.music); Audio.setHaptic(s.haptic);
      if (this.board) this.board.setSettings({ motion: s.motion, fx: s.fx });
      if (this.meter) this.meter.settings = { motion: s.motion, fx: s.fx };
      Save.commit();
    },
    buildSettings(el) {
      const s = this.save.settings; el.innerHTML = '';
      const toggle = (key, name) => { const row = document.createElement('div'); row.className = 'setting'; row.innerHTML = `<span class="s-name">${name}</span>`; const b = document.createElement('button'); b.className = 'toggle' + (s[key] ? ' on' : ''); b.setAttribute('aria-label', name); b.onclick = () => { s[key] = !s[key]; b.classList.toggle('on', s[key]); Audio.play('click'); this.applySettings(); }; row.appendChild(b); el.appendChild(row); };
      toggle('dark', 'DARK MODE'); toggle('sound', 'SOUND'); toggle('music', 'MUSIC'); toggle('haptic', 'HAPTICS'); toggle('motion', 'REDUCED MOTION');
      const row = document.createElement('div'); row.className = 'setting'; row.innerHTML = '<span class="s-name">EFFECTS</span>'; const seg = document.createElement('div'); seg.className = 'seg';
      ['OFF', 'LOW', 'FULL'].forEach((lbl, i) => { const b = document.createElement('button'); b.textContent = lbl; b.className = s.fx === i ? 'on' : ''; b.onclick = () => { s.fx = i; [...seg.children].forEach((c, k) => c.classList.toggle('on', k === i)); Audio.play('click'); this.applySettings(); }; seg.appendChild(b); });
      row.appendChild(seg); el.appendChild(row);
    },

    /* ---------- screens ---------- */
    show(id, zoomFrom) {
      document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active', 'zoom-in'); s.style.transformOrigin = ''; });
      const el = $(id); el.classList.add('active');
      if (zoomFrom) { const r = shell.getBoundingClientRect(); el.style.transformOrigin = `${zoomFrom.x - r.left}px ${zoomFrom.y - r.top}px`; el.classList.add('zoom-in'); }
      this.screen = id;
      if (id === 's-map') { this.roadmap.layout(); this.roadmap.setData(this.save); this.roadmap.start(); this.updateMapBar(); } else this.roadmap.stop();
      if (id === 's-game') { this.board.start(); this.backdrop.start(); requestAnimationFrame(() => { this.board.resize(); this.meter.resize(); this.backdrop.resize(); }); } else { this.board.stop(); this.backdrop.stop(); }
    },
    modal(id, open) { $(id).classList.toggle('open', open); },
    toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(this._toastT); this._toastT = setTimeout(() => { t.hidden = true; }, 1400); },
    confirm(title, text) { return new Promise(res => { $('confirm-title').textContent = title; $('confirm-text').textContent = text; this.modal('m-confirm', true); $('confirm-yes').onclick = () => { this.modal('m-confirm', false); res(true); }; $('confirm-no').onclick = () => { this.modal('m-confirm', false); res(false); }; }); },

    loading() {
      const chart = $('load-chart');
      for (let i = 0; i < 9; i++) { const b = document.createElement('i'); b.style.height = (30 + (i * 37) % 60) + 'px'; b.style.animationDelay = (i * 0.1) + 's'; if (i === 3 || i === 6) b.classList.add('red'); chart.appendChild(b); }
      let p = 0; const t0 = performance.now();
      const tick = () => {
        p = Math.min(100, ((performance.now() - t0) / 1300) * 100);
        $('load-fill').style.width = p + '%'; $('load-pct').textContent = Math.round(p) + '%';
        if (p < 100) requestAnimationFrame(tick); else this.title();
      };
      // warm sprite cache
      for (let s = 0; s < 6; s++) Draw.sprite('chip' + s, 48, (c, size) => Draw.chip(c, s, 0, 0, size));
      requestAnimationFrame(tick);
    },
    title() {
      const run = this.save.run;
      $('btn-play').textContent = run ? 'CONTINUE' : 'PLAY';
      const done = Object.keys(this.save.levels).length;
      $('title-progress').textContent = this.save.campaignDone ? 'CAMPAIGN COMPLETE · ' + done + '/50 LEVELS' : done ? 'PROGRESS · LEVEL ' + this.save.unlocked + ' OF 50' : 'NEW LAUNCH';
      this.drawTitleChart();
      $('title-lives').textContent = this.livesText();
      $('title-rank').textContent = 'RANK ' + rankName(this.save.rank) + ' · ' + this.save.rank + ' PTS';
      this.show('s-title');
      Audio.setRegion('title');
    },
    drawTitleChart() {
      const host = $('title-chart'); let cv = host.querySelector('canvas'); if (!cv) { cv = document.createElement('canvas'); host.appendChild(cv); }
      const dpr = Math.min(devicePixelRatio || 1, 2); const W = host.clientWidth || 300, H = 54; cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
      const rng = RTB.Rng.create('title'); let y = H * 0.8;
      for (let x = 6; x < W; x += 12) { const up = RTB.Rng.next(rng) < 0.68; const h = 6 + RTB.Rng.next(rng) * 16; ctx.fillStyle = up ? '#3fd987' : '#e5484d'; const ny = Math.max(6, Math.min(H - 6, y + (up ? -h * 0.5 : h * 0.4))); ctx.fillRect(x, Math.min(y, ny), 6, Math.abs(y - ny) + 3); ctx.fillRect(x + 2.5, Math.min(y, ny) - 4, 1, Math.abs(y - ny) + 10); y = ny; }
    },
    livesText() { const n = Save.lives(); const ms = Save.nextLifeMs(); const t = ms ? ' · NEXT ' + this.fmtTime(ms) : ''; return '♥'.repeat(n) + '♡'.repeat(Save.MAX_LIVES - n) + ' ' + n + ' LIVES' + t + (this.save.streak ? ' · STREAK ' + this.save.streak : ''); },
    fmtTime(ms) { const s = Math.ceil(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0'); },
    updateMapBar() { const R = RTB.regionOf(this.save.unlocked); $('map-region-name').textContent = R.name; $('map-progress').textContent = '♥ ' + Save.lives() + ' · ' + (this.save.campaignDone ? 50 : this.save.unlocked - 1) + ' / 50 CLEARED'; },
    showLives() {
      this.modal('m-lives', true); Audio.play('lose');
      const tick = () => { if (!$('m-lives').classList.contains('open')) return; const ms = Save.nextLifeMs(); $('lives-timer').textContent = Save.lives() > 0 ? 'READY' : this.fmtTime(ms); if (Save.lives() > 0) { $('lives-ok').textContent = 'PLAY'; } setTimeout(tick, 1000); };
      $('lives-ok').textContent = 'BACK TO ROADMAP'; tick();
    },
    openMap(centerId) { this.show('s-map'); requestAnimationFrame(() => this.roadmap.centerOn(centerId || this.save.unlocked, false)); },

    /* ---------- pre-level ---------- */
    openPrelevel(id) {
      const L = RTB.levelById(id); this.pendingLevel = id; Audio.play('click');
      const R = RTB.regionOf(id);
      $('pl-region').textContent = L.bonus ? R.name + ' · BONUS AFTER LEVEL ' + L.after : R.name + ' · LEVEL ' + String(id).padStart(2, '0'); $('pl-name').textContent = L.name;
      $('pl-diff').textContent = L.bonus ? 'BONUS · NO LIVES · RANK POINTS' : L.diff; $('pl-diff').className = 'pl-diff mono ' + L.diff;
      const ol = $('pl-objectives'); ol.innerHTML = '';
      const objs = L.objectives.concat(L.stages ? L.stages.flatMap(s => s.objectives) : []);
      for (const o of objs) { const d = document.createElement('div'); d.className = 'pl-obj'; const cv = this.iconCanvas(o, 44); d.appendChild(cv); const n = document.createElement('div'); n.className = 'n'; n.textContent = o.t === 'fud' ? 'ALL' : o.t === 'wallall' ? 'ALL' : String(o.n); const t = document.createElement('div'); t.className = 't'; t.textContent = OBJ_LABEL[o.t](o); d.appendChild(n); d.appendChild(t); ol.appendChild(d); }
      $('pl-moves').textContent = L.moves + ' MOVES';
      const g = this.save.levels[id]; const gl = $('pl-grades'); gl.innerHTML = ''; GRADES.slice(1).forEach((name, i) => { const s = document.createElement('span'); s.className = 'grade' + (g && g.grade >= i + 1 ? ' on' : ''); s.textContent = name; gl.appendChild(s); });
      const targets = (RTB.SCORE_TARGETS && RTB.SCORE_TARGETS[id]) || L.thresholds;
      $('pl-lives').textContent = L.bonus ? 'RANK ' + rankName(this.save.rank) + ' · ' + this.save.rank + ' PTS · BEST SCORE BANKS POINTS' : this.livesText();
      $('pl-note').textContent = (g ? 'BEST ' + g.best.toLocaleString() + ' · ' : '') + 'MOVING ' + targets[0].toLocaleString() + ' · TRENDING ' + targets[1].toLocaleString() + (L.stages ? ' · TWO STAGES' : '') + (id === 50 ? '' : '');
      this.modal('m-prelevel', true);
    },
    iconCanvas(o, size) { const cv = document.createElement('canvas'); const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = size * dpr; cv.height = size * dpr; cv.style.width = size + 'px'; cv.style.height = size + 'px'; const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr); Draw.objIcon(ctx, o, size, 400); return cv; },

    /* ---------- level lifecycle ---------- */
    startLevel(id, fromNode) {
      const L0 = RTB.levelById(id); if (!L0 || !RTB.released(id)) { this.showSoon(id); return; }
      if (!L0.bonus && Save.lives() <= 0) { this.modal('m-prelevel', false); if (this.screen !== 's-map') this.openMap(id); this.showLives(); return; }
      const L = L0; this.level = L;
      const pool = (RTB.SEEDS && RTB.SEEDS[id]) || [id * 1000 + 11];
      const attempt = this.save.attempts[id] || 0; this.save.attempts[id] = attempt + 1;
      const seedIdx = attempt % pool.length; const seed = pool[seedIdx];
      this.engine = Engine.create(L, seed, seedIdx);
      this.save.run = { levelId: id, seed, seedIdx, st: this.engine.st, attempt }; Save.commit();
      this.enterGame(fromNode);
    },
    resumeRun() {
      const run = this.save.run; if (!run) return false;
      const L = RTB.levelById(run.levelId); if (!L) return false;
      this.level = L; this.engine = Engine.restore(L, RTB.cloneState(run.st)); this.save.run.st = this.engine.st;
      this.enterGame(null);
      if (this.engine.st.status === 'WIN') this.onWin(); else if (this.engine.st.status === 'LOSE') this.onLose();
      return true;
    },
    enterGame(fromNode) {
      const L = this.level; const R = RTB.regionOf(L.id);
      $('hud-level').textContent = L.bonus ? R.name + ' · BONUS · ' + RTB.SCENES[L.after - 1] : R.name + ' · ' + String(L.id).padStart(2, '0') + ' · ' + RTB.SCENES[L.id - 1]; $('hud-name').textContent = L.name;
      this.buildObjectives();
      const game = $('s-game'); game.className = 'screen theme-' + R.theme; Audio.setRegion(R.theme);
      this.backdrop.reduced = !!this.save.settings.motion; this.backdrop.dark = !!this.save.settings.dark; this.backdrop.setLevel(L);
      this.show('s-game', fromNode);
      this.board.setSettings({ motion: this.save.settings.motion, fx: this.save.settings.fx });
      this.board.setEngine(this.engine);
      this.meter.settings = { motion: this.save.settings.motion, fx: this.save.settings.fx };
      this.meter.set(this.engine.st.charge, this.engine.st.cap, true); this._lastNext = null; this.drawNext(this.engine.st.next);
      this.cascadeMax = 1; this.updateHud(this.engine.hud());
      this.status('READY');
      $('cinematic').hidden = true;
      this.board.setMode('locked'); this.bondedBusy = false;
      const stageTut = L.tutorial && !this.save.tutorials[L.tutorial] ? [L.tutorial] : [];
      this.runTutorials(stageTut).then(() => { this.board.setMode('play'); this.armHint(); });
    },
    buildObjectives() {
      const host = $('objectives'); host.innerHTML = ''; this.objEls = [];
      for (const o of this.engine.st.obj) { const d = document.createElement('div'); d.className = 'obj'; const cv = this.iconCanvas(o, 30); d.appendChild(cv); const c = document.createElement('span'); c.className = 'cnt mono'; d.appendChild(c); host.appendChild(d); this.objEls.push({ el: d, cnt: c, t: o.t, s: o.s }); }
    },
    updateHud(hud, step) {
      const mv = $('hud-moves'); if (mv.textContent !== String(hud.moves)) { mv.textContent = hud.moves; mv.parentElement.classList.remove('bump'); void mv.offsetWidth; mv.parentElement.classList.add('bump'); }
      mv.parentElement.classList.toggle('low', hud.moves <= 5);
      $('hud-score').textContent = '$' + hud.score.toLocaleString();
      const pr = $('hud-pressure'); [...pr.querySelectorAll('i')].forEach((el, i) => el.classList.toggle('on', i < (hud.pressure || 0))); pr.classList.toggle('hot', (hud.pressure || 0) > 0);
      this.updateCurve(hud);
      if (step && step.type === 'stage') this.buildObjectives();
      if (this.objEls && this.objEls.length === hud.obj.length) hud.obj.forEach((o, i) => { const e = this.objEls[i]; const txt = o.left === 0 ? '✓' : String(o.left); if (e.cnt.textContent !== txt) { e.cnt.textContent = txt; e.el.classList.remove('bump'); void e.el.offsetWidth; e.el.classList.add('bump'); } e.el.classList.toggle('done', o.left === 0); });
      this.meter.set(hud.charge, hud.cap, false);
      this.drawNext(hud.next);
      if (step && step.type === 'clear') { const m = $('hud-mult'); m.textContent = 'VOL ×' + step.pass; m.classList.toggle('hot', step.pass >= 2); }
      if (step && step.type === 'end') { const m = $('hud-mult'); m.textContent = 'VOL ×1'; m.classList.remove('hot'); }
    },
    updateCurve(hud) {
      let total = 0, done = 0;
      for (const o of hud.obj) { const n = Math.max(1, o.n || 1); total += n; done += Math.max(0, n - Math.min(n, o.left)); }
      const pct = total ? Math.round(done / total * 100) : 0; const fill = $('curve-fill'); fill.style.width = pct + '%'; fill.classList.toggle('bonded', pct >= 100);
      $('curve-label').textContent = pct >= 100 ? 'BONDED ✓' : 'BONDING CURVE ' + pct + '%';
    },
    status(text, kind) { const s = $('hud-status'); s.textContent = text; s.classList.remove('pop', 'red'); void s.offsetWidth; if (kind === 'pop') s.classList.add('pop'); if (kind === 'red') s.classList.add('red'); },
    shake(kind) { if (this.save.settings.motion) return; const f = $('board-frame'); f.classList.remove('shake', 'punch', 'dip'); void f.offsetWidth; f.classList.add(kind); },
    cascade(pass) { const f = $('board-flash'); f.classList.remove('pulse', 'bonus'); void f.offsetWidth; f.classList.add(pass >= 9 ? 'bonus' : 'pulse'); if (pass < 9) this.cascadeMax = Math.max(this.cascadeMax, pass); },
    armHint() {
      clearTimeout(this.hintTimer); this.board.setHint(null); $('tutorial-hand').hidden = true;
      const delay = this.level.id === 1 && !this.save.tutorials.swapDone ? 400 : 6000;
      this.hintTimer = setTimeout(() => { if (this.board.busy || this.board.mode !== 'play' || this.engine.st.status !== 'READY') return; const h = this.engine.hint(); if (!h) return; this.board.setHint(h); if (this.level.id === 1 && !this.save.tutorials.swapDone) this.showHand(h); }, delay);
    },
    showHand(h) {
      const hand = $('tutorial-hand'); const cs = this.board.cell; const r = $('board').getBoundingClientRect(); const sr = $('s-game').getBoundingClientRect();
      const [ra, ca] = this.board._rc(h[0]), [rb, cb] = this.board._rc(h[1]);
      hand.style.left = (r.left - sr.left + (ca + 0.5) * cs - 22) + 'px'; hand.style.top = (r.top - sr.top + (ra + 0.5) * cs - 22) + 'px';
      hand.style.setProperty('--dx', ((cb - ca) * cs) + 'px'); hand.style.setProperty('--dy', ((rb - ra) * cs) + 'px'); hand.hidden = false;
    },

    async trySwap(a, b) {
      if (!this.engine || this.board.busy || this.engine.st.status !== 'READY' || this.bondedBusy) return;
      clearTimeout(this.hintTimer); this.board.setHint(null); $('tutorial-hand').hidden = true;
      const steps = this.engine.applySwap(a, b);
      const valid = steps.length && steps[0].valid;
      if (valid) { this.save.tutorials.swapDone = true; this.save.run.st = this.engine.st; Save.commit(); }
      this.board.setMode('locked');
      const bonded = steps.some(s => s.type === 'clear' && s.ev && s.ev.specials.some(x => x.kind === 'bonded'));
      if (bonded) { this.bondedBusy = true; await this.cinematic(); }
      await this.board.play(steps);
      this.bondedBusy = false;
      this.afterAction();
    },
    afterAction() {
      const st = this.engine.st;
      if (st.status === 'WIN') { this.onWin(); return; }
      if (st.status === 'LOSE') { this.onLose(); return; }
      this.board.setMode('play'); this.status(this.engine.bondedReady() ? 'PILL ON BOARD' : 'READY'); this.armHint();
      if (this.engine.bondedReady() && !this.save.tutorials.bondedReadyTip) { this.save.tutorials.bondedReadyTip = true; Save.commit(); this.toast('BONDED PILL · SWAP IT WITH ANY CHIP'); }
    },

    /* ---------- NEXT DROP / BONDED ---------- */
    drawNext(kind) {
      if (kind === this._lastNext) return; this._lastNext = kind;
      const cv = $('next-canvas'); const ctx = cv.getContext('2d'); const size = cv.width; ctx.clearRect(0, 0, size, size);
      if (!kind) return;
      const p = kind === 'pill' ? { t: 'pill' } : { t: 'sp', k: kind, s: kind === 'sweep' ? -1 : 0 };
      Draw.piece(ctx, p, size * 0.08, size * 0.08, size * 0.84, 600);
    },
    pillTap() {
      if (!this.engine) return; Audio.play('click');
      const st = this.engine.st; const pct = Math.round(st.charge / st.cap * 100);
      const name = st.next === 'pill' ? 'BONDED PILL' : (RTB.SPECIAL_NAMES[st.next] || 'POWER-UP');
      if (this.engine.bondedReady()) this.toast('BONDED PILL ON BOARD · SWAP IT WITH ANY CHIP');
      else this.toast('NEXT DROP · ' + name + ' · CANDLE ' + pct + '%');
      if (!this.board.busy && !this.save.tutorials.nextTip) { this.save.tutorials.nextTip = true; Save.commit(); this.showTutorial('bonded', true); }
    },
    cinematic() {
      const c = $('cinematic'); c.hidden = false; const reduced = this.save.settings.motion;
      const tick = c.querySelector('.cine-ticker'); const syms = ['+VOL', 'BREAKOUT', 'CURVE 100%', 'BONDED', 'PARABOLIC', 'GREEN PRINT']; tick.textContent = syms.map(s => '▲ ' + s).join('   ');
      c.querySelector('.cine-pill').style.animation = 'none'; void c.offsetWidth; c.querySelector('.cine-pill').style.animation = '';
      Audio.play('bonded'); Audio.haptic([60, 40, 120]); this.shake('punch');
      return new Promise(res => setTimeout(() => { c.hidden = true; res(); }, reduced ? 450 : 950));
    },

    /* ---------- win / lose ---------- */
    gradeFor(id, score) { const t = (RTB.SCORE_TARGETS && RTB.SCORE_TARGETS[id]) || RTB.levelById(id).thresholds; return score >= t[1] ? 3 : score >= t[0] ? 2 : 1; },
    onWin() {
      const L = this.level; const score = this.engine.st.score; const grade = this.gradeFor(L.id, score);
      const prevUnlocked = this.save.unlocked;
      if (L.bonus) { this.save.run = null; const gained = Save.bankRank(L.id, score); const Lrec = this.save.levels[L.id]; Lrec.grade = Math.max(Lrec.grade || 0, grade); Save.commit(); Audio.play('win'); $('win-name').textContent = L.name; $('win-grade').textContent = 'BONUS CLEARED · +' + gained + ' RANK PTS'; $('win-score').textContent = score.toLocaleString(); $('win-detail').textContent = 'RANK ' + rankName(this.save.rank) + ' · ' + this.save.rank + ' PTS · NO LIFE AT STAKE'; $('win-next').textContent = 'ROADMAP'; this.board.setMode('locked'); this.modal('m-win', true); return; }
      this.save.run = null; Save.recordWin(L.id, score, grade);
      const bonusLife = Save.winStreak();
      Audio.play('win'); Audio.haptic([30, 40, 30, 40, 80]);
      if (bonusLife) setTimeout(() => { Audio.play('life'); this.toast('STREAK ×' + this.save.streak + ' · +1 LIFE'); }, 900);
      $('win-name').textContent = L.name; $('win-grade').textContent = GRADES[grade]; $('win-score').textContent = score.toLocaleString();
      $('win-detail').textContent = 'MOVES LEFT ' + this.engine.st.moves + ' · BEST VOL ×' + this.cascadeMax + ' · BONDED ×' + this.engine.st.bonded + ' · STREAK ' + this.save.streak + (L.id === prevUnlocked && L.id < 50 ? ' · LEVEL ' + (L.id + 1) + ' UNLOCKED' : '');
      $('win-next').textContent = L.id === RTB.CONFIG.releasedLevels ? 'CELEBRATE' : 'NEXT LEVEL'; $('win-next').disabled = false;
      const wc = $('win-candle'); wc.querySelector('.body').style.animation = 'none'; void wc.offsetWidth; wc.querySelector('.body').style.animation = '';
      this.board.setMode('locked'); this.modal('m-win', true);
    },
    onLose() {
      if (this.level.bonus) { this.save.run = null; const gained = Save.bankRank(this.level.id, this.engine.st.score); Audio.play('lose'); $('lose-detail').textContent = 'Out of moves at $' + this.engine.st.score.toLocaleString() + '. Bonus levels never cost a life' + (gained ? ', and that run banked ' + gained + ' rank points.' : '.'); $('lose-retry').disabled = false; this.board.setMode('locked'); this.modal('m-lose', true); return; }
      this.save.run = null; Save.loseLife(); Audio.play('lose');
      const rem = this.engine.st.obj.map(o => ({ o, left: this.engine.objRemaining(o) })).filter(x => x.left > 0);
      const dips = this.engine.st.dips || 0;
      $('lose-detail').textContent = 'The move counter hit zero. ' + (rem.length ? 'Still open: ' + rem.map(x => x.left + ' ' + OBJ_LABEL[x.o.t](x.o).toLowerCase()).join(', ') + '.' : '') + (dips ? ' Sell pressure cost you ' + dips + (dips === 1 ? ' move.' : ' moves.') : '') + ' That cost a life: ' + this.livesText() + '.';
      $('lose-retry').disabled = Save.lives() <= 0;
      this.board.setMode('locked'); this.modal('m-lose', true);
    },
    async afterWinFlow(action) {
      const L = this.level; this.modal('m-win', false);
      if (action === 'replay') { this.startLevel(L.id, null); return; }
      if (L.bonus) { this.openMap(L.after); return; }
      if (L.id === RTB.CONFIG.releasedLevels) { this.show('s-complete'); $('cp-stats').textContent = '50 / 50 LEVELS · ' + Object.values(this.save.levels).filter(x => x.grade >= 3).length + ' TRENDING GRADES'; Audio.play('milestone'); return; }
      if (L.milestone && !this.save.milestones[L.id]) { this.save.milestones[L.id] = true; Save.commit(); this.showMilestone(L.id + 1); return; }
      this.openMap(L.id);
      await this.roadmap.celebrate(L.id);
      this.roadmap.setData(this.save); this.roadmap.centerOn(Math.min(RTB.MAX_LEVEL, L.id + 1), true);
      if (action === 'next' && L.id < RTB.CONFIG.releasedLevels) setTimeout(() => this.openPrelevel(L.id + 1), 350);
    },
    showMilestone(nextId) {
      const R = RTB.regionOf(nextId); $('ms-title').textContent = R.name; $('ms-desc').textContent = R.tag; $('ms-bg').className = 'ms-bg ' + R.theme;
      Audio.play('milestone'); this.show('s-milestone');
      $('ms-continue').onclick = async () => { Audio.play('click'); this.openMap(nextId - 1); await this.roadmap.celebrate(nextId - 1); this.roadmap.setData(this.save); this.roadmap.centerOn(nextId, true); };
    },
    showLocked(id) { const L = RTB.levelById(id); if (L.bonus) { $('locked-title').textContent = 'BONUS · ' + L.name; $('locked-text').textContent = RTB.released(id) ? 'Beat Level ' + L.after + ' to open this bonus level. Bonus levels never cost a life and bank rank points.' : 'This bonus level arrives with the next update.'; } else { $('locked-title').textContent = 'LEVEL ' + id + ' · ' + L.name; $('locked-text').textContent = 'Beat Level ' + (id - 1) + ' (' + RTB.levelById(id - 1).name + ') to open this node. Only the next level unlocks after a win.'; } this.modal('m-locked', true); Audio.play('invalid'); },
    showSoon(id) { const R = RTB.regionOf(id); $('locked-title').textContent = 'NEXT UPDATE · ' + R.name; $('locked-text').textContent = 'Levels ' + R.from + ' to ' + R.to + ' are part of the next campaign drop: ' + R.tag + ' They unlock when the update is posted.'; this.modal('m-locked', true); Audio.play('click'); },

    /* ---------- store ---------- */
    async openStore() {
      const S = RTB.Store; this.modal('m-store', true); const msg = $('store-msg'); msg.className = 'store-msg';
      $('store-wallet').textContent = this.walletKey ? 'WALLET ' + S.shortKey(this.walletKey) : 'NO WALLET CONNECTED';
      $('store-rate').textContent = 'FETCHING SOL PRICE…';
      const packs = $('store-packs'); packs.innerHTML = '';
      if (!S.isOpen()) { msg.textContent = 'THE STORE OPENS WITH THE NEXT UPDATE'; msg.className = 'store-msg err'; }
      const pr = await S.price();
      $('store-rate').textContent = '1 SOL ≈ $' + pr.usd.toLocaleString(undefined, { maximumFractionDigits: 2 }) + (pr.live ? ' · LIVE RATE' : ' · ESTIMATED RATE');
      for (const pack of RTB.CONFIG.packs) {
        const b = document.createElement('button'); b.className = 'pack'; if (!S.isOpen()) b.disabled = true;
        b.innerHTML = '<div class="pk-lives">♥ ' + pack.lives + '</div><div class="pk-sol">' + S.fmtSol(S.lamportsFor(pack.usd, pr.usd)) + '</div><div class="pk-usd">≈ $' + pack.usd.toFixed(2) + '</div>';
        b.onclick = () => this.storeBuy(pack); packs.appendChild(b);
      }
    },
    async storeConnect() {
      const msg = $('store-msg'); Audio.play('click');
      try { const r = await RTB.Store.connect(); this.walletKey = r.key; $('store-wallet').textContent = 'WALLET ' + RTB.Store.shortKey(r.key); msg.className = 'store-msg'; msg.textContent = 'WALLET CONNECTED'; }
      catch (e) { msg.className = 'store-msg err'; msg.textContent = (e && e.message ? e.message : 'Could not connect the wallet.').toUpperCase(); }
    },
    async storeBuy(pack) {
      const msg = $('store-msg'); Audio.play('click');
      if (this._buying) return; this._buying = true;
      [...$('store-packs').children].forEach(b => { b.disabled = true; });
      msg.className = 'store-msg'; msg.textContent = 'CONFIRM THE TRANSFER IN YOUR WALLET…';
      try {
        const r = await RTB.Store.buy(pack); this.walletKey = r.key;
        Save.addLives(r.lives, { signature: r.signature, lamports: r.lamports, lives: r.lives });
        msg.textContent = '+' + r.lives + ' LIVES CREDITED · ' + RTB.Store.shortKey(r.signature); Audio.play('life');
        $('store-wallet').textContent = 'WALLET ' + RTB.Store.shortKey(r.key) + ' · ' + this.livesText();
        if ($('m-lives').classList.contains('open')) { $('lives-timer').textContent = 'READY'; $('lives-ok').textContent = 'PLAY'; }
      } catch (e) { msg.className = 'store-msg err'; msg.textContent = (e && e.message ? e.message : 'The purchase did not go through.').toUpperCase(); }
      finally { this._buying = false; [...$('store-packs').children].forEach(b => { b.disabled = !RTB.Store.isOpen(); }); }
    },

    /* ---------- tutorials ---------- */
    runTutorials(keys) {
      return keys.reduce((p, k) => p.then(() => this.showTutorial(k, true)), Promise.resolve());
    },
    showTutorial(key, markSeen) {
      const T = TUTORIALS[key]; if (!T) return Promise.resolve();
      return new Promise(res => {
        let page = 0; const render = () => { $('tut-title').textContent = T.title; $('tut-text').textContent = T.pages[page]; $('tut-dots').textContent = T.pages.map((_, i) => i === page ? '●' : '○').join(' '); $('tut-next').textContent = page < T.pages.length - 1 ? 'NEXT' : 'GOT IT'; this.tutArt(T.art); };
        render(); this.modal('m-tutorial', true);
        $('tut-next').onclick = () => { Audio.play('click'); if (page < T.pages.length - 1) { page++; render(); } else { this.modal('m-tutorial', false); if (markSeen) { this.save.tutorials[key] = true; Save.commit(); } res(); } };
      });
    },
    tutArt(kind) {
      const host = $('tut-art'); let cv = host.querySelector('canvas'); if (!cv) { cv = document.createElement('canvas'); host.appendChild(cv); }
      const dpr = Math.min(devicePixelRatio || 1, 2); const W = host.clientWidth || 300, H = host.clientHeight || 130; cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
      ctx.fillStyle = '#0b2320'; Draw.rr(ctx, 0, 0, W, H, 14); ctx.fill();
      const s = Math.min(56, H * 0.6); const cx = W / 2 - s / 2, cy = H / 2 - s / 2; const t = 500;
      const row = (items) => { const total = items.length * s + (items.length - 1) * 6; let x = W / 2 - total / 2; for (const it of items) { Draw.cellBase(ctx, x, cy, s, true); it(x, cy); x += s + 6; } };
      const chip = (n) => (x, y) => Draw.chip(ctx, n, x, y, s);
      const arrow = (x, y) => { ctx.fillStyle = '#7dffbb'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('⇄', x + s / 2, y + s * 0.68); };
      switch (kind) {
        case 'swap': row([chip(0), chip(0), chip(2), chip(0)]); ctx.fillStyle = 'rgba(0,0,0,0)'; arrow(W / 2 + s * 0.5 + 3 - s, cy - 2); break;
        case 'goals': row([(x, y) => Draw.chip(ctx, 1, x, y, s), (x, y) => { ctx.fillStyle = '#fff'; ctx.font = 'bold 30px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('12', x + s / 2, y + s * 0.7); }, (x, y) => { ctx.fillStyle = '#7dffbb'; ctx.font = 'bold 12px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('MOVES', x + s / 2, y + s * 0.4); ctx.fillStyle = '#fff'; ctx.font = 'bold 26px "JetBrains Mono", monospace'; ctx.fillText('20', x + s / 2, y + s * 0.85); }]); break;
        case 'dust': row([(x, y) => { Draw.dust(ctx, x, y, s, 1); Draw.chip(ctx, 3, x, y, s); }, (x, y) => { Draw.dust(ctx, x, y, s, 2); Draw.chip(ctx, 4, x, y, s); }, (x, y) => Draw.chip(ctx, 1, x, y, s)]); break;
        case 'candle': row([(x, y) => Draw.special(ctx, 'ch', 1, x, y, s, t), (x, y) => Draw.special(ctx, 'cv', 4, x, y, s, t)]); break;
        case 'paper': row([(x, y) => { Draw.chip(ctx, 2, x, y, s); Draw.paper(ctx, x, y, s); }, chip(2), chip(2)]); break;
        case 'bonded': Draw.pill(ctx, W / 2 - 40, H / 2 - 40, 80, t, { glow: 1 }); break;
        case 'capsule': row([(x, y) => Draw.capsule(ctx, x, y, s, t), chip(0), (x, y) => Draw.exit(ctx, x, y, s, t)]); break;
        case 'burst': row([(x, y) => Draw.special(ctx, 'burst', 3, x, y, s, t)]); break;
        case 'holes': row([chip(1), (x, y) => Draw.cellBase(ctx, x, y, s, false), chip(5)]); break;
        case 'wall': row([(x, y) => Draw.wall(ctx, x, y, s, 1, 1), (x, y) => Draw.wall(ctx, x, y, s, 2, 2), (x, y) => Draw.wall(ctx, x, y, s, 3, 3)]); break;
        case 'keys': row([(x, y) => Draw.key(ctx, x, y, s, t), (x, y) => Draw.gate(ctx, x, y, s, 3, 1, t)]); break;
        case 'node': row([(x, y) => Draw.node(ctx, x, y, s, 2, 2, 0, t), (x, y) => Draw.node(ctx, x, y, s, 0, 2, 1, t)]); break;
        case 'lane': row([(x, y) => { Draw.lane(ctx, x, y, s, true, 1, t); Draw.chip(ctx, 0, x, y, s); }, (x, y) => { Draw.lane(ctx, x, y, s, true, 1, t); Draw.chip(ctx, 3, x, y, s); }, (x, y) => { Draw.lane(ctx, x, y, s, true, 1, t); Draw.chip(ctx, 1, x, y, s); }]); break;
        case 'portal': row([(x, y) => { Draw.portal(ctx, x, y, s, 0, false, t); Draw.chip(ctx, 2, x + s * 0.12, y + s * 0.12, s * 0.76); }, (x, y) => Draw.portal(ctx, x, y, s, 0, true, t)]); break;
        case 'fud': row([(x, y) => { Draw.chip(ctx, 1, x, y, s); Draw.fud(ctx, x, y, s, t); }, (x, y) => { Draw.chip(ctx, 4, x, y, s); ctx.save(); ctx.globalAlpha = 0.4; Draw.fud(ctx, x, y, s, t); ctx.restore(); }]); break;
        case 'printer': row([(x, y) => Draw.printer(ctx, x, y, s, 3, t), (x, y) => Draw.wall(ctx, x, y, s, 1, 1)]); break;
        case 'wallet': Draw.wallet(ctx, W / 2 - s * 0.9, H / 2 - s * 0.9, s * 0.9, 3, t); break;
        case 'sixth': row([chip(0), chip(1), chip(2), chip(3), chip(4), chip(5)]); break;
        case 'halt': row([(x, y) => Draw.halt(ctx, x, y, s, t), (x, y) => Draw.special(ctx, 'ch', 0, x, y, s, t)]); break;
        case 'combo': row([(x, y) => Draw.special(ctx, 'ch', 2, x, y, s, t), (x, y) => Draw.special(ctx, 'burst', 5, x, y, s, t), (x, y) => Draw.special(ctx, 'sweep', -1, x, y, s, t)]); break;
        case 'sweep': row([(x, y) => Draw.special(ctx, 'sweep', -1, x, y, s, t), chip(3)]); break;
        case 'bot': row([(x, y) => Draw.special(ctx, 'bot', 4, x, y, s, t), (x, y) => Draw.wall(ctx, x, y, s, 2, 2)]); break;
        case 'finale': row([(x, y) => Draw.key(ctx, x, y, s, t), (x, y) => Draw.pill(ctx, x, y, s, t, { glow: 1 }), (x, y) => Draw.capsule(ctx, x, y, s, t)]); break;
        default: row([chip(0), chip(1), chip(2)]);
      }
      void cx;
    },
    buildHelp() {
      const list = $('help-list'); list.innerHTML = '';
      for (const key of HELP_ORDER) {
        const T = TUTORIALS[key]; const card = document.createElement('div'); card.className = 'help-card';
        const cv = this.iconCanvas({ t: { swap: 'collect', goals: 'collect', pressure: 'combo', candle: 'candle', burst: 'burst', sweep: 'sweep', bot: 'collect', combo: 'combo', bonded: 'bonded', dust: 'dust', paper: 'paper', wall: 'wall', capsule: 'capsule', holes: 'collect', keys: 'keys', node: 'node', lane: 'lane', portal: 'collect', fud: 'fud', printer: 'printer', wallet: 'wallet', halt: 'halt', sixth: 'collect', finale: 'bonded' }[key], s: key === 'sixth' ? 5 : key === 'portal' ? 1 : key === 'bot' ? 4 : key === 'holes' ? 2 : 0, n: 20 }, 56);
        card.appendChild(cv); const body = document.createElement('div'); body.className = 'hc-body'; body.innerHTML = `<div class="hc-title">${T.title}</div><div class="hc-text">${T.pages[0]}</div>`; card.appendChild(body);
        const b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'REPLAY'; b.onclick = () => { Audio.play('click'); this.showTutorial(key, false); }; card.appendChild(b); list.appendChild(card);
      }
    },

    /* ---------- pause / quit ---------- */
    pause() { if (this.screen !== 's-game') return; this.buildSettings($('settings-panel')); $('pause-lives').textContent = this.livesText(); this.modal('m-pause', true); Audio.play('click'); },
    async restart() { this.modal('m-pause', false); if (this.engine.st.movesUsed > 0) { if (!(await this.confirm('RESTART LEVEL?', 'Abandoning a level you have started counts as a loss and costs a life. A fresh tested board is dealt.'))) { this.modal('m-pause', true); return; } this.save.run = null; Save.loseLife(); } this.startLevel(this.level.id, null); },
    async quit() { this.modal('m-pause', false); if (this.engine && this.engine.st.status === 'READY' && this.engine.st.movesUsed > 0) { if (!(await this.confirm('QUIT LEVEL?', 'Leaving a level you have started counts as a loss and costs a life. Your progress on it is discarded.'))) { this.modal('m-pause', true); return; } this.save.run = null; Save.loseLife(); } this.openMap(this.level.id); },

    bind() {
      const click = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); fn(e); });
      document.addEventListener('pointerdown', () => Audio.unlock(), { once: false, passive: true });
      click('btn-play', () => { Audio.play('click'); if (this.save.run) this.resumeRun(); else this.openMap(); });
      click('btn-roadmap', () => { Audio.play('click'); this.openMap(); });
      click('btn-help', () => { Audio.play('click'); this._helpBack = 's-title'; this.show('s-help'); });
      click('btn-settings-title', () => { Audio.play('click'); this.buildSettings($('settings-panel-2')); this.modal('m-settings', true); });
      click('settings-close', () => { Audio.play('click'); this.modal('m-settings', false); });
      click('settings-reset', async () => { if (await this.confirm('RESET ALL PROGRESS?', 'Every level, grade, active run and tutorial flag is erased. Settings are kept.')) { const s = this.save.settings; Save.reset(); this.save = Save.data; this.save.settings = s; Save.commit(); this.modal('m-settings', false); this.title(); this.toast('PROGRESS RESET'); } });
      click('map-back', () => { Audio.play('click'); this.title(); });
      click('map-settings', () => { Audio.play('click'); this.buildSettings($('settings-panel-2')); this.modal('m-settings', true); });
      click('map-center', () => { Audio.play('click'); this.roadmap.centerOn(this.save.unlocked, true); });
      click('pl-close', () => { Audio.play('click'); this.modal('m-prelevel', false); });
      click('pl-launch', () => { Audio.play('click'); this.modal('m-prelevel', false); const pos = this.screen === 's-map' ? this.roadmap.nodeScreenPos(this.pendingLevel) : null; this.startLevel(this.pendingLevel, pos); });
      click('btn-pause', () => this.pause());
      click('pause-resume', () => { Audio.play('click'); this.modal('m-pause', false); });
      click('pause-restart', () => this.restart());
      click('pause-help', () => { Audio.play('click'); this.modal('m-pause', false); this._helpBack = 's-game'; this.show('s-help'); });
      click('pause-quit', () => this.quit());
      click('help-back', () => { Audio.play('click'); if (this._helpBack === 's-game') { this.show('s-game'); this.modal('m-pause', true); } else this.title(); });
      click('pill-btn', () => this.pillTap());
      click('win-next', () => { Audio.play('click'); this.afterWinFlow('next'); });
      click('win-replay', () => { Audio.play('click'); this.afterWinFlow('replay'); });
      click('win-map', () => { Audio.play('click'); this.afterWinFlow('map'); });
      click('lose-retry', () => { Audio.play('click'); this.modal('m-lose', false); this.startLevel(this.level.id, null); });
      click('lives-buy', () => { Audio.play('click'); this.openStore(); });
      click('pause-store', () => { Audio.play('click'); this.openStore(); });
      click('settings-store', () => { Audio.play('click'); this.openStore(); });
      click('store-close', () => { Audio.play('click'); this.modal('m-store', false); });
      click('store-connect', () => this.storeConnect());
      click('lives-ok', () => { Audio.play('click'); this.modal('m-lives', false); if (Save.lives() > 0 && this.pendingLevel) this.openPrelevel(this.pendingLevel); else this.openMap(); });
      click('lose-map', () => { Audio.play('click'); this.modal('m-lose', false); this.openMap(this.level.id); });
      click('cp-map', () => { Audio.play('click'); this.openMap(RTB.CONFIG.releasedLevels); this.roadmap.finale(); });
      click('locked-ok', () => { Audio.play('click'); this.modal('m-locked', false); });
      window.addEventListener('resize', () => { if (this.screen === 's-game') { this.board.resize(); this.meter.resize(); this.backdrop.resize(); } });
      const persist = () => { if (this.engine && this.save.run && this.engine.st.status === 'READY') { this.save.run.st = this.engine.st; } Save.commit(); };
      document.addEventListener('visibilitychange', () => { persist(); if (document.hidden) Audio.suspend(); else Audio.resume(); });
      window.addEventListener('pagehide', persist); window.addEventListener('beforeunload', persist);
      document.addEventListener('gesturestart', (e) => e.preventDefault());
      let lastTouch = 0; document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTouch < 300) e.preventDefault(); lastTouch = n; }, { passive: false });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.screen === 's-game') { if ($('m-pause').classList.contains('open')) this.modal('m-pause', false); else this.pause(); } });
    },
  };

  RTB.App = App;
  window.addEventListener('DOMContentLoaded', () => App.init());
})();
