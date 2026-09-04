(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const shell = document.querySelector("#game-shell");
  const menu = document.querySelector("#menu");
  const resultPanel = document.querySelector("#result");
  const pausePanel = document.querySelector("#pause-panel");
  const playButton = document.querySelector("#play");
  const rematchButton = document.querySelector("#rematch");
  const backMenuButton = document.querySelector("#back-menu");
  const pauseButton = document.querySelector("#pause");
  const resumeButton = document.querySelector("#resume");
  const restartButton = document.querySelector("#restart");
  const soundButton = document.querySelector("#sound");
  const joystick = document.querySelector("#joystick");
  const joystickKnob = document.querySelector("#joystick-knob");
  const jumpButton = document.querySelector("#jump-button");
  const attackButton = document.querySelector("#attack-button");
  const dashButton = document.querySelector("#dash-button");
  const toastNode = document.querySelector("#toast");
  const levelLabel = document.querySelector("#level-label");
  const levelButtons = [...document.querySelectorAll("[data-level]")];
  const unlockText = document.querySelector("#unlock-text");

  const WORLD = { w: 1600, h: 900 };
  /** Bottom of the HUD's top band, in world units — the timer card is tallest. */
  const HUD_BAND_H = 102;
  const STEP = 1 / 60;
  const MAX_CATCHUP = 6;
  const GRAVITY = 2250;
  const MAX_FALL = 1280;
  const COLORS = ["#27e7ff", "#ff326f", "#b7ff3c", "#ffc53d"];
  const NAMES = ["YOU", "GLITCH", "BYTE", "SPARK"];
  const ICONS = ["W", "X", "B", "⚡"];
  const STAGE_NAMES = ["SIGNAL FOUNDRY", "ROOFTOP RELAY", "CRUSHER VAULT", "NEON REACTOR", "ZERO-G TERMINAL", "FINAL BROADCAST"];
  const isTouch = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (isTouch) document.body.classList.add("touch");

  let viewScale = 1;
  let viewX = 0;
  let viewY = 0;
  let dpr = 1;
  let lastFrame = performance.now();
  let accumulator = 0;
  let attackSerial = 1;
  let toastTimer = 0;

  /**
   * Persistence.
   *
   * Two hosts have to work. Opening index.html directly gives the game its own
   * origin and `localStorage` behaves normally. A WEBCADE listing frames the
   * same files with `sandbox="allow-scripts"` and deliberately without
   * `allow-same-origin`, which puts the game on an opaque origin where every
   * `localStorage` access throws SecurityError. Swallowing that error keeps the
   * game running but silently kills the thing the game is built around: six
   * levels of progression that would never unlock past the first, for anyone
   * playing on the site.
   *
   * So reads answer from an in-memory cache, and the cache has two backings —
   * `localStorage` when it is reachable, and the host page when it is not. The
   * host's copy arrives by message, which is asynchronous, so it lands after
   * the menu has already drawn itself from defaults; `hydrate` re-applies the
   * real values when they turn up. Nothing here blocks the first frame.
   */
  const save = (() => {
    const KEYS = ["signalBrawlUnlocked", "signalBrawlSelected", "signalBrawlDifficulty", "signalBrawlMuted", "signalBrawlStreak", "signalBrawlBest"];
    const cache = new Map();
    const listeners = [];
    let local = null;
    let host = null;
    let flushTimer = 0;

    // Probe with a write. Some browsers expose `localStorage` and only throw on
    // use, so reading the property is not proof that it works.
    try {
      localStorage.setItem("signalBrawlProbe", "1");
      localStorage.removeItem("signalBrawlProbe");
      local = localStorage;
    } catch (_) {
      local = null;
    }

    if (local) {
      for (const key of KEYS) {
        try {
          const value = local.getItem(key);
          if (value !== null) cache.set(key, value);
        } catch (_) { /* ignore a key that will not read */ }
      }
    } else if (window.parent && window.parent !== window) {
      host = window.parent;
      // Identity, not origin: the frame is opaque, so the host sees "null" for
      // our origin and we see its real one. Comparing windows is the check that
      // another page in the tab cannot forge.
      window.addEventListener("message", (event) => {
        if (event.source !== host) return;
        const data = event.data;
        if (!data || typeof data !== "object") return;
        if (data.channel !== "ccg-save" || data.type !== "SAVE_DATA") return;
        const values = data.values;
        if (!values || typeof values !== "object") return;
        let changed = false;
        for (const key of KEYS) {
          const value = values[key];
          if (typeof value !== "string") continue;
          if (cache.get(key) === value) continue;
          cache.set(key, value);
          changed = true;
        }
        if (changed) for (const listener of listeners) listener();
      });
      host.postMessage({ channel: "ccg-save", type: "SAVE_LOAD" }, "*");
    }

    function flush() {
      if (!host) return;
      flushTimer = 0;
      const values = {};
      for (const [key, value] of cache) values[key] = value;
      host.postMessage({ channel: "ccg-save", type: "SAVE_WRITE", values }, "*");
    }

    return {
      read(key, fallback) {
        const value = cache.get(key);
        return value === undefined ? fallback : value;
      },
      write(key, value) {
        const text = String(value);
        if (cache.get(key) === text) return;
        cache.set(key, text);
        if (local) {
          try { local.setItem(key, text); } catch (_) { /* quota or private mode */ }
        } else if (host && !flushTimer) {
          // Coalesced: a match end writes several keys in a row, and the host
          // only needs the settled result.
          flushTimer = setTimeout(flush, 200);
        }
      },
      /** Runs when a host's saved values arrive after boot. */
      onHydrate(listener) { listeners.push(listener); },
    };
  })();

  const safeRead = (key, fallback) => save.read(key, fallback);
  const safeWrite = (key, value) => save.write(key, value);

  const storedUnlocked = Math.max(0, Math.min(5, Number(safeRead("signalBrawlUnlocked", 0)) || 0));
  const storedLevel = Math.max(0, Math.min(storedUnlocked, Number(safeRead("signalBrawlSelected", 0)) || 0));

  const state = {
    mode: "menu",
    previousMode: "menu",
    difficulty: Math.max(0, Math.min(2, Number(safeRead("signalBrawlDifficulty", 1)) || 0)),
    stageIndex: storedLevel,
    unlockedLevel: storedUnlocked,
    stage: null,
    fighters: [],
    particles: [],
    projectiles: [],
    bombs: [],
    pickups: [],
    floaters: [],
    matchTime: 90,
    countdown: 3.5,
    roundEndTimer: 0,
    winner: null,
    suddenDeath: false,
    spawnTimer: 5.5,
    starTimer: 13,
    hitStop: 0,
    slowTime: 0,
    shake: 0,
    flash: 0,
    muted: safeRead("signalBrawlMuted", "0") === "1",
    streak: Number(safeRead("signalBrawlStreak", 0)),
    bestStreak: Number(safeRead("signalBrawlBest", 0)),
    lastWinner: null,
    lastWin: false,
  };

  const input = {
    keys: new Set(),
    moveTouch: 0,
    moveTouchY: 0,
    jumpPressed: false,
    attackPressed: false,
    heavyPressed: false,
    dashPressed: false,
    dropPressed: false,
    touchAttackHeld: false,
    touchAttackTime: 0,
    touchHeavyFired: false,
    touchDashHeld: false,
    touchDashTime: 0,
    joystickPointer: null,
    attackPointer: null,
    jumpPointer: null,
    dashPointer: null,
  };

  class AudioBus {
    constructor() {
      this.context = null;
      this.master = null;
    }

    unlock() {
      if (state.muted) return;
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.17;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") this.context.resume().catch(() => {});
    }

    tone(freq, duration, type = "square", volume = .45, slide = 1) {
      if (state.muted) return;
      this.unlock();
      if (!this.context || !this.master) return;
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(35, freq * slide), now + duration);
      gain.gain.setValueAtTime(Math.max(.0001, volume), now);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + duration + .02);
    }

    sfx(name) {
      if (name === "jump") this.tone(210, .08, "square", .2, 1.7);
      else if (name === "dash") this.tone(150, .1, "sawtooth", .22, 2.8);
      else if (name === "swing") this.tone(175, .055, "sawtooth", .14, .5);
      else if (name === "hit") { this.tone(92, .09, "square", .48, .45); this.tone(360, .045, "triangle", .24, .6); }
      else if (name === "shot") this.tone(480, .07, "square", .22, .38);
      else if (name === "hammer") { this.tone(72, .13, "square", .38, .55); this.tone(150, .08, "sawtooth", .18, .45); }
      else if (name === "bomb") { this.tone(62, .32, "sawtooth", .58, .18); this.tone(145, .2, "square", .24, .28); }
      else if (name === "star") { this.tone(520, .22, "triangle", .25, 2.3); this.tone(820, .16, "sine", .18, 1.45); }
      else if (name === "pickup") this.tone(520, .1, "triangle", .2, 1.8);
      else if (name === "shield") this.tone(780, .06, "sine", .15, .7);
      else if (name === "ko") { this.tone(120, .38, "sawtooth", .5, .18); this.tone(55, .45, "square", .3, .55); }
      else if (name === "surge") { this.tone(190, .5, "sawtooth", .38, 4.2); this.tone(760, .35, "triangle", .24, .55); }
      else if (name === "count") this.tone(340, .07, "square", .14, 1.15);
      else if (name === "fight") this.tone(250, .18, "sawtooth", .28, 2.2);
    }
  }

  const audio = new AudioBus();

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sign = (v) => v < 0 ? -1 : 1;
  const rand = (min, max) => min + Math.random() * (max - min);
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const overlap = (a, b) => a.x - a.w / 2 < b.x + b.w / 2 && a.x + a.w / 2 > b.x - b.w / 2 && a.y - a.h / 2 < b.y + b.h / 2 && a.y + a.h / 2 > b.y - b.h / 2;

  function segmentHitsRect(x1, y1, x2, y2, rect) {
    const minX = rect.x - rect.w / 2;
    const maxX = rect.x + rect.w / 2;
    const minY = rect.y - rect.h / 2;
    const maxY = rect.y + rect.h / 2;
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const checks = [[-dx, x1 - minX], [dx, maxX - x1], [-dy, y1 - minY], [dy, maxY - y1]];
    for (const [p, q] of checks) {
      if (p === 0 && q < 0) return false;
      if (p !== 0) {
        const r = q / p;
        if (p < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
      }
    }
    return true;
  }

  function makePlatform(id, x, y, w, h, options = {}) {
    return {
      id, x, y, w, h,
      baseX: x,
      baseY: y,
      prevX: x,
      prevY: y,
      moveX: options.moveX || 0,
      moveY: options.moveY || 0,
      speed: options.speed || 0,
      phase: options.phase || 0,
      thin: Boolean(options.thin),
    };
  }

  function createStage(index) {
    if (index === 1) {
      return {
        index,
        name: "ROOFTOP RELAY",
        code: "CH // 02",
        tint: "#9f47ff",
        deep: "#0b0718",
        t: 0,
        wind: 0,
        corruption: null,
        platforms: [
          makePlatform(0, 350, 720, 520, 46),
          makePlatform(1, 1125, 720, 710, 46),
          makePlatform(2, 315, 505, 285, 30, { moveX: 55, speed: .62 }),
          makePlatform(3, 1115, 500, 300, 30, { moveY: 42, speed: .75, phase: 1.2 }),
          makePlatform(4, 690, 610, 180, 27, { moveY: 75, speed: .9, phase: .3, thin: true }),
          makePlatform(5, 815, 382, 245, 28, { moveX: 110, speed: .54, phase: 2.1, thin: true }),
        ],
      };
    }
    if (index === 2) {
      return {
        index,
        name: "CRUSHER VAULT",
        code: "CH // 03",
        tint: "#ff9b32",
        deep: "#150805",
        t: 0,
        crusherY: 85,
        crusherPhase: 0,
        corruption: null,
        platforms: [
          makePlatform(0, 800, 735, 1360, 48),
          makePlatform(1, 320, 535, 310, 32, { moveY: 40, speed: .68 }),
          makePlatform(2, 1280, 535, 310, 32, { moveY: 40, speed: .68, phase: Math.PI }),
          makePlatform(3, 800, 430, 310, 31, { moveX: 95, speed: .58, phase: .7 }),
          makePlatform(4, 605, 620, 190, 25, { moveY: 28, speed: 1.05, phase: 1.7, thin: true }),
          makePlatform(5, 995, 620, 190, 25, { moveY: 28, speed: 1.05, phase: 4.8, thin: true }),
        ],
      };
    }
    if (index === 3) {
      return {
        index,
        name: "NEON REACTOR",
        code: "CH // 04",
        tint: "#ff326f",
        deep: "#150614",
        t: 0,
        pulseRadius: 0,
        previousPulseRadius: 0,
        corruption: null,
        platforms: [
          makePlatform(0, 800, 735, 1250, 46),
          makePlatform(1, 290, 525, 280, 30, { moveY: 55, speed: .75 }),
          makePlatform(2, 1310, 525, 280, 30, { moveY: 55, speed: .75, phase: Math.PI }),
          makePlatform(3, 800, 535, 255, 28, { moveY: 80, speed: .92, phase: 1.4 }),
          makePlatform(4, 525, 390, 210, 26, { moveX: 90, speed: .62, phase: .4, thin: true }),
          makePlatform(5, 1075, 390, 210, 26, { moveX: 90, speed: .62, phase: 3.5, thin: true }),
        ],
      };
    }
    if (index === 4) {
      return {
        index,
        name: "ZERO-G TERMINAL",
        code: "CH // 05",
        tint: "#4d8dff",
        deep: "#03091a",
        gravityScale: .62,
        t: 0,
        corruption: null,
        platforms: [
          makePlatform(0, 350, 735, 520, 42),
          makePlatform(1, 1250, 735, 520, 42),
          makePlatform(2, 800, 625, 245, 28, { moveY: 115, speed: .58, phase: .4, thin: true }),
          makePlatform(3, 340, 455, 260, 28, { moveX: 95, speed: .48, phase: 1.5 }),
          makePlatform(4, 1260, 455, 260, 28, { moveX: 95, speed: .48, phase: 4.6 }),
          makePlatform(5, 800, 285, 310, 28, { moveX: 165, speed: .42, phase: 2.2, thin: true }),
        ],
      };
    }
    if (index === 5) {
      return {
        index,
        name: "FINAL BROADCAST",
        code: "CH // 06",
        tint: "#ffffff",
        deep: "#12040a",
        t: 0,
        lavaY: 830,
        sweepX: -200,
        corruption: null,
        platforms: [
          makePlatform(0, 800, 710, 1120, 46),
          makePlatform(1, 250, 505, 300, 31, { moveY: 58, speed: .9 }),
          makePlatform(2, 1350, 505, 300, 31, { moveY: 58, speed: .9, phase: Math.PI }),
          makePlatform(3, 800, 430, 280, 30, { moveX: 175, speed: .72, phase: .8 }),
          makePlatform(4, 535, 600, 170, 25, { moveY: 52, speed: 1.2, phase: 1.1, thin: true }),
          makePlatform(5, 1065, 600, 170, 25, { moveY: 52, speed: 1.2, phase: 4.2, thin: true }),
        ],
      };
    }
    return {
      index: 0,
      name: "SIGNAL FOUNDRY",
      code: "CH // 01",
      tint: "#27e7ff",
      deep: "#04111a",
      t: 0,
      lavaY: 846,
      corruption: null,
      platforms: [
        makePlatform(0, 800, 720, 1260, 48),
        makePlatform(1, 315, 515, 320, 31, { moveY: 32, speed: .62 }),
        makePlatform(2, 1285, 515, 320, 31, { moveY: 32, speed: .62, phase: Math.PI }),
        makePlatform(3, 800, 405, 330, 32, { moveY: 60, speed: .72, phase: .6 }),
        makePlatform(4, 585, 610, 190, 26, { moveX: 55, speed: .9, phase: 1.4, thin: true }),
        makePlatform(5, 1015, 610, 190, 26, { moveX: 55, speed: .9, phase: 4.5, thin: true }),
      ],
    };
  }

  function createFighter(id, x, y) {
    return {
      id,
      name: NAMES[id],
      icon: ICONS[id],
      color: COLORS[id],
      x, y,
      prevX: x,
      prevY: y,
      w: 54,
      h: 108,
      vx: 0,
      vy: 0,
      facing: id % 2 === 0 ? 1 : -1,
      grounded: false,
      groundPlatform: null,
      coyote: 0,
      jumpBuffer: 0,
      jumpsUsed: 0,
      dropTimer: 0,
      state: "idle",
      health: 100,
      lives: 3,
      alive: true,
      respawnTimer: 0,
      invulnerable: 1.25,
      iframes: 0,
      stun: 0,
      flash: 0,
      dashTimer: 0,
      dashCooldown: 0,
      guard: false,
      guardMeter: 100,
      guardBreak: 0,
      attack: null,
      comboStage: 0,
      comboWindow: 0,
      comboHits: 0,
      comboTimer: 0,
      signal: 0,
      overdrive: 0,
      weapon: null,
      lastAttacker: null,
      hazardCooldown: 0,
      aiTimer: rand(.05, .25),
      aiJumpHold: 0,
      aiPlan: { move: 0, jump: false, attack: false, heavy: false, dash: false, guard: false, drop: false },
      aiCommit: 0,
      anim: Math.random() * 10,
      stats: { kos: 0, deaths: 0, damage: 0, taken: 0, bestCombo: 0 },
    };
  }

  const spawnPoints = [
    { x: 270, y: 380 },
    { x: 1330, y: 380 },
    { x: 600, y: 280 },
    { x: 1000, y: 280 },
  ];

  function resetFighterAtSpawn(fighter, index = fighter.id) {
    const point = spawnPoints[index % spawnPoints.length];
    fighter.x = point.x;
    fighter.y = point.y;
    fighter.prevX = fighter.x;
    fighter.prevY = fighter.y;
    fighter.vx = 0;
    fighter.vy = 0;
    fighter.health = 100;
    fighter.alive = true;
    fighter.respawnTimer = 0;
    fighter.invulnerable = 1.45;
    fighter.iframes = 0;
    fighter.stun = 0;
    fighter.flash = 0;
    fighter.attack = null;
    fighter.weapon = null;
    fighter.signal = Math.min(fighter.signal, 70);
    fighter.overdrive = 0;
    fighter.grounded = false;
    fighter.groundPlatform = null;
    fighter.jumpsUsed = 0;
    fighter.dashTimer = 0;
    fighter.guard = false;
    fighter.guardMeter = 100;
    fighter.guardBreak = 0;
    fighter.comboHits = 0;
    fighter.comboTimer = 0;
    fighter.hazardCooldown = .7;
    fighter.lastAttacker = null;
  }

  function resetInputs() {
    input.keys.clear();
    input.moveTouch = 0;
    input.moveTouchY = 0;
    input.jumpPressed = false;
    input.attackPressed = false;
    input.heavyPressed = false;
    input.dashPressed = false;
    input.dropPressed = false;
    input.touchAttackHeld = false;
    input.touchAttackTime = 0;
    input.touchHeavyFired = false;
    input.touchDashHeld = false;
    input.touchDashTime = 0;
    input.joystickPointer = null;
    input.attackPointer = null;
    input.jumpPointer = null;
    input.dashPointer = null;
    joystick.classList.remove("active");
    joystickKnob.style.transform = "translate(0px, 0px)";
    [jumpButton, attackButton, dashButton].forEach((node) => node.classList.remove("pressed"));
  }

  function setOverlay(node, active) {
    node.classList.toggle("active", active);
  }

  function showToast(text, color = "#27e7ff", seconds = 1.25) {
    toastNode.textContent = text;
    toastNode.style.background = color;
    toastNode.classList.add("show");
    toastTimer = seconds;
  }

  function hideToast() {
    toastTimer = 0;
    toastNode.classList.remove("show");
  }

  function startMatch(advanceStage = false) {
    audio.unlock();
    if (advanceStage && state.stageIndex < state.unlockedLevel) state.stageIndex += 1;
    safeWrite("signalBrawlSelected", state.stageIndex);
    state.stage = createStage(state.stageIndex);
    state.fighters = spawnPoints.map((point, id) => createFighter(id, point.x, point.y));
    state.particles.length = 0;
    state.projectiles.length = 0;
    state.bombs.length = 0;
    state.pickups.length = 0;
    state.floaters.length = 0;
    state.matchTime = Math.max(72, 90 - state.stageIndex * 3);
    state.countdown = 3.35;
    state.roundEndTimer = 0;
    state.winner = null;
    state.suddenDeath = false;
    state.spawnTimer = 5.8;
    state.starTimer = rand(10.5, 14);
    state.hitStop = 0;
    state.slowTime = 0;
    state.shake = 0;
    state.flash = 0;
    state.lastWin = false;
    state.mode = "countdown";
    resetInputs();
    hideToast();
    refreshLevelSelect();
    setOverlay(menu, false);
    setOverlay(resultPanel, false);
    setOverlay(pausePanel, false);
    shell.classList.add("playing");
    updateDashButton();
    attemptImmersiveMode();
  }

  function openMenu() {
    state.mode = "menu";
    resetInputs();
    shell.classList.remove("playing");
    setOverlay(menu, true);
    setOverlay(resultPanel, false);
    setOverlay(pausePanel, false);
    hideToast();
    refreshBestStreak();
    refreshLevelSelect();
  }

  function pauseGame() {
    if (state.mode !== "playing" && state.mode !== "countdown") return;
    state.previousMode = state.mode;
    state.mode = "paused";
    resetInputs();
    setOverlay(pausePanel, true);
  }

  function resumeGame() {
    if (state.mode !== "paused") return;
    state.mode = state.previousMode === "countdown" ? "countdown" : "playing";
    setOverlay(pausePanel, false);
    lastFrame = performance.now();
    accumulator = 0;
  }

  async function attemptImmersiveMode() {
    if (!isTouch) return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch (_) { /* fullscreen is optional */ }
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape");
    } catch (_) { /* orientation lock is optional */ }
  }

  function refreshBestStreak() {
    document.querySelector("#best-streak").textContent = `BEST STREAK ${state.bestStreak}`;
  }

  function refreshLevelSelect() {
    levelLabel.textContent = `${String(state.stageIndex + 1).padStart(2, "0")} // ${STAGE_NAMES[state.stageIndex]}`;
    levelButtons.forEach((button) => {
      const level = Number(button.dataset.level);
      const locked = level > state.unlockedLevel;
      button.disabled = locked;
      button.classList.toggle("locked", locked);
      button.classList.toggle("selected", level === state.stageIndex);
      button.setAttribute("aria-label", locked ? `Level ${level + 1} locked` : `Level ${level + 1}: ${STAGE_NAMES[level]}`);
    });
  }

  function updateDashButton() {
    const player = state.fighters[0];
    const ready = player && player.alive && player.signal >= 100;
    dashButton.classList.toggle("surge", Boolean(ready));
    dashButton.querySelector("span").textContent = ready ? "SURGE" : "DASH";
  }

  function finishMatch(winner) {
    if (state.mode === "result") return;
    state.winner = winner || null;
    state.lastWinner = winner ? winner.id : null;
    state.mode = "result";
    shell.classList.remove("playing");
    const player = state.fighters[0];
    const won = winner && winner.id === 0;
    let unlockedNow = false;
    state.lastWin = Boolean(won);
    if (won) {
      state.streak += 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      if (state.stageIndex === state.unlockedLevel && state.unlockedLevel < STAGE_NAMES.length - 1) {
        state.unlockedLevel += 1;
        unlockedNow = true;
        safeWrite("signalBrawlUnlocked", state.unlockedLevel);
      }
    } else {
      state.streak = 0;
    }
    safeWrite("signalBrawlStreak", state.streak);
    safeWrite("signalBrawlBest", state.bestStreak);
    // The player's fighter is named YOU, so the rival's verb does not fit them.
    const ownsLine = won ? "YOU OWN THE SIGNAL" : winner ? `${winner.name} OWNS THE SIGNAL` : "TRANSMISSION DRAW";
    document.querySelector("#result-eyebrow").textContent = ownsLine;
    document.querySelector("#result-title").textContent = won ? "YOU WIN" : winner ? "YOU GOT DROPPED" : "DRAW";
    document.querySelector("#result-title").style.textShadow = won ? "5px 5px 0 rgba(183,255,60,.65)" : "5px 5px 0 rgba(255,50,111,.65)";
    document.querySelector("#stat-kos").textContent = player.stats.kos;
    document.querySelector("#stat-damage").textContent = Math.round(player.stats.damage);
    document.querySelector("#stat-combo").textContent = player.stats.bestCombo;
    const canAdvance = won && state.stageIndex < state.unlockedLevel;
    unlockText.textContent = unlockedNow ? `LEVEL ${state.stageIndex + 2} UNLOCKED // ${STAGE_NAMES[state.stageIndex + 1]}` : canAdvance ? `NEXT // LEVEL ${state.stageIndex + 2} ${STAGE_NAMES[state.stageIndex + 1]}` : won && state.stageIndex === STAGE_NAMES.length - 1 ? "ALL SIX LEVELS CLEARED" : "";
    rematchButton.querySelector("span").textContent = canAdvance ? "NEXT LEVEL" : won ? "PLAY AGAIN" : "RUN IT BACK";
    rematchButton.querySelector("i").textContent = canAdvance ? "▶" : "↻";
    refreshLevelSelect();
    setTimeout(() => setOverlay(resultPanel, true), 280);
  }

  function chooseTimeWinner() {
    const ranked = [...state.fighters].sort((a, b) => {
      if (b.lives !== a.lives) return b.lives - a.lives;
      if (b.health !== a.health) return b.health - a.health;
      if (b.stats.kos !== a.stats.kos) return b.stats.kos - a.stats.kos;
      return a.stats.taken - b.stats.taken;
    });
    const a = ranked[0];
    const b = ranked[1];
    const tied = a && b && a.lives === b.lives && Math.abs(a.health - b.health) < .1 && a.stats.kos === b.stats.kos;
    return tied ? null : a;
  }

  function enterSuddenDeath() {
    state.suddenDeath = true;
    state.matchTime = 15;
    state.flash = .65;
    showToast("SUDDEN DEATH // SIGNAL OVERLOAD", "#ff326f", 1.8);
    state.fighters.forEach((fighter) => {
      if (fighter.lives <= 0) return;
      fighter.health = Math.min(fighter.health, 35);
      fighter.invulnerable = .6;
    });
    audio.sfx("surge");
  }

  function remainingContenders() {
    return state.fighters.filter((fighter) => fighter.lives > 0);
  }

  function checkForMatchEnd() {
    const contenders = remainingContenders();
    if (contenders.length <= 1) {
      if (state.roundEndTimer <= 0) {
        state.roundEndTimer = 1.15;
        state.slowTime = .55;
        audio.sfx("ko");
      }
    }
  }

  function updateStage(dt) {
    const stage = state.stage;
    stage.t += dt;
    for (const platform of stage.platforms) {
      platform.prevX = platform.x;
      platform.prevY = platform.y;
      if (platform.moveX) platform.x = platform.baseX + Math.sin(stage.t * platform.speed + platform.phase) * platform.moveX;
      if (platform.moveY) platform.y = platform.baseY + Math.sin(stage.t * platform.speed + platform.phase) * platform.moveY;
      const dx = platform.x - platform.prevX;
      const dy = platform.y - platform.prevY;
      if (dx || dy) {
        for (const fighter of state.fighters) {
          if (fighter.alive && fighter.grounded && fighter.groundPlatform === platform.id) {
            fighter.x += dx;
            fighter.y += dy;
          }
        }
      }
    }

    if (stage.index === 0) {
      const target = state.suddenDeath ? 742 : 846;
      stage.lavaY = lerp(stage.lavaY, target, dt * 1.5);
    }

    if (stage.index === 1) {
      const cycle = stage.t % 9;
      stage.wind = cycle > 6.5 && cycle < 8.5 ? Math.sin((cycle - 6.5) / 2 * Math.PI) : 0;
      if (state.suddenDeath) stage.wind = Math.max(stage.wind, .5);
    }

    if (stage.index === 2) {
      const phase = stage.t % 7;
      stage.crusherPhase = phase;
      if (phase < 4.55) stage.crusherY = 95;
      else if (phase < 5.1) stage.crusherY = 95;
      else if (phase < 5.32) stage.crusherY = lerp(95, 585, easeOut((phase - 5.1) / .22));
      else if (phase < 5.9) stage.crusherY = 585;
      else if (phase < 6.35) stage.crusherY = lerp(585, 95, (phase - 5.9) / .45);
      else stage.crusherY = 95;
    }

    if (stage.index === 3) {
      const cycle = stage.t % 7.5;
      stage.previousPulseRadius = stage.pulseRadius;
      stage.pulseRadius = cycle >= 5.5 && cycle < 6.9 ? ((cycle - 5.5) / 1.4) * 980 : 0;
      if (stage.pulseRadius > stage.previousPulseRadius && state.mode === "playing") {
        for (const fighter of state.fighters) {
          if (!fighter.alive || fighter.hazardCooldown > 0) continue;
          const distance = Math.hypot(fighter.x - 800, fighter.y - 625);
          if (distance >= stage.previousPulseRadius - 38 && distance <= stage.pulseRadius + 38) {
            const direction = sign(fighter.x - 800 || 1);
            applyHit(fighter, null, 9, direction * 520, -360, "signal");
            fighter.hazardCooldown = .7;
          }
        }
      }
    }

    if (stage.index === 5) {
      const lavaTarget = state.suddenDeath ? 742 : 830;
      stage.lavaY = lerp(stage.lavaY, lavaTarget, dt * 1.7);
      const cycle = stage.t % 6.5;
      stage.sweepX = cycle >= 5 && cycle < 6.2 ? lerp(80, 1520, (cycle - 5) / 1.2) : -200;
      if (stage.sweepX > 0 && state.mode === "playing") {
        for (const fighter of state.fighters) {
          if (!fighter.alive || fighter.hazardCooldown > 0 || Math.abs(fighter.x - stage.sweepX) > 42) continue;
          applyHit(fighter, null, 13, 650, -360, "signal");
          fighter.hazardCooldown = .78;
        }
      }
    }

    if (stage.corruption) {
      stage.corruption.timer -= dt;
      stage.corruption.tick -= dt;
      const charged = stage.platforms.find((p) => p.id === stage.corruption.platformId);
      if (charged && stage.corruption.tick <= 0) {
        for (const fighter of state.fighters) {
          if (!fighter.alive || fighter.id === stage.corruption.ownerId || fighter.groundPlatform !== charged.id || fighter.hazardCooldown > 0) continue;
          const owner = state.fighters[stage.corruption.ownerId];
          applyHit(fighter, owner, 6, sign(fighter.x - owner.x) * 270, -300, "signal");
          fighter.hazardCooldown = .65;
        }
        stage.corruption.tick = .46;
      }
      if (stage.corruption.timer <= 0) stage.corruption = null;
    }
  }

  function platformSupportAt(x, y, distance = 120) {
    return state.stage.platforms.some((p) => x > p.x - p.w / 2 - 12 && x < p.x + p.w / 2 + 12 && p.y >= y && p.y - y < distance);
  }

  function nearestPickup(fighter) {
    let best = null;
    let bestScore = Infinity;
    for (const pickup of state.pickups) {
      if (fighter.weapon && pickup.type !== "star") continue;
      const dx = pickup.x - fighter.x;
      const dy = pickup.y - fighter.y;
      const score = Math.abs(dx) + Math.abs(dy) * 1.2;
      if (score < bestScore) { best = pickup; bestScore = score; }
    }
    return bestScore < 470 ? best : null;
  }

  function updateAIPlan(fighter, dt) {
    fighter.aiTimer -= dt;
    fighter.aiCommit = Math.max(0, fighter.aiCommit - dt);
    if (fighter.aiTimer > 0 || !fighter.alive || fighter.stun > 0) return;

    const reaction = [rand(.32, .48), rand(.2, .34), rand(.11, .22)][state.difficulty];
    fighter.aiTimer = reaction;
    const plan = fighter.aiPlan;
    plan.jump = false;
    plan.attack = false;
    plan.heavy = false;
    plan.dash = false;
    plan.drop = false;
    plan.guard = false;

    const targets = state.fighters.filter((other) => other.alive && other.id !== fighter.id);
    if (!targets.length) { plan.move = 0; return; }
    let target = targets.reduce((best, current) => {
      const score = Math.abs(current.x - fighter.x) + Math.abs(current.y - fighter.y) * .6 - (current.id === fighter.lastAttacker ? 80 : 0) + Math.random() * 80;
      return !best || score < best.score ? { fighter: current, score } : best;
    }, null).fighter;

    const pickup = nearestPickup(fighter);
    let goalX = pickup ? pickup.x : target.x;
    let goalY = pickup ? pickup.y : target.y;
    const dx = goalX - fighter.x;
    const dy = goalY - fighter.y;
    const desired = Math.abs(dx) > 42 ? sign(dx) : 0;

    if (fighter.aiCommit <= 0 || desired === 0) {
      plan.move = desired;
      fighter.aiCommit = rand(.12, .28);
    }

    const dangerProjectile = state.projectiles.find((shot) => shot.ownerId !== fighter.id && Math.abs(shot.y - fighter.y) < 85 && Math.abs(shot.x - fighter.x) < 280 && sign(shot.vx) === sign(fighter.x - shot.x));
    if (dangerProjectile && Math.random() < [.28, .52, .74][state.difficulty]) {
      if (fighter.grounded && Math.random() < .55) plan.jump = true;
      else plan.dash = true;
    }
    const dangerBomb = state.bombs.find((bomb) => bomb.fuse < .85 && Math.hypot(bomb.x - fighter.x, bomb.y - fighter.y) < 235);
    if (dangerBomb) {
      plan.move = sign(fighter.x - dangerBomb.x || fighter.facing);
      if (fighter.grounded && Math.random() < .65) plan.jump = true;
      else plan.dash = true;
    }

    const lookX = fighter.x + (plan.move || fighter.facing) * 82;
    if (fighter.grounded && !platformSupportAt(lookX, fighter.y + fighter.h / 2 - 4, 105)) {
      plan.jump = true;
      if (Math.random() < .4) plan.move = -plan.move || -fighter.facing;
    }

    if (fighter.y > 690) {
      plan.move = sign(800 - fighter.x);
      plan.jump = true;
    } else if (dy < -100 && Math.abs(dx) < 500 && fighter.grounded) {
      plan.jump = true;
    } else if (dy > 145 && Math.abs(dx) < 260) {
      plan.drop = true;
    }

    const range = fighter.weapon?.type === "blaster" ? 620 : fighter.weapon?.type === "staff" ? 155 : fighter.weapon?.type === "hammer" ? 145 : fighter.weapon?.type === "bomb" ? 420 : 112;
    if (Math.abs(target.x - fighter.x) < range && Math.abs(target.y - fighter.y) < 105) {
      fighter.facing = sign(target.x - fighter.x || fighter.facing);
      const aggression = [.46, .65, .82][state.difficulty];
      if (Math.random() < aggression) {
        if (fighter.weapon?.type === "blaster" || Math.random() < .78) plan.attack = true;
        else plan.heavy = true;
      }
      if (fighter.health < 28 && Math.random() < .3) plan.dash = true;
    }

    if (fighter.signal >= 100 && targets.filter((other) => Math.hypot(other.x - fighter.x, other.y - fighter.y) < 280).length >= 1) plan.dash = true;
  }

  function humanControls(dt) {
    if (input.touchAttackHeld) {
      input.touchAttackTime += dt;
      if (input.touchAttackTime >= .32 && !input.touchHeavyFired) {
        input.heavyPressed = true;
        input.touchHeavyFired = true;
        attackButton.querySelector("small").textContent = "HEAVY";
      }
    }
    if (input.touchDashHeld) input.touchDashTime += dt;
    const keyboardMove = (input.keys.has("KeyD") || input.keys.has("ArrowRight") ? 1 : 0) - (input.keys.has("KeyA") || input.keys.has("ArrowLeft") ? 1 : 0);
    return {
      move: Math.abs(input.moveTouch) > .08 ? input.moveTouch : keyboardMove,
      jump: input.jumpPressed,
      jumpHeld: input.keys.has("KeyW") || input.keys.has("ArrowUp") || input.keys.has("Space") || input.jumpPointer !== null,
      attack: input.attackPressed,
      heavy: input.heavyPressed,
      dash: input.dashPressed,
      drop: input.dropPressed || input.moveTouchY > .68 || input.keys.has("KeyS") || input.keys.has("ArrowDown"),
      guard: input.touchDashHeld && input.touchDashTime > .22 || input.keys.has("ShiftLeft") || input.keys.has("ShiftRight"),
    };
  }

  function aiControls(fighter, dt) {
    updateAIPlan(fighter, dt);
    const plan = fighter.aiPlan;
    if (plan.jump) fighter.aiJumpHold = .19;
    else fighter.aiJumpHold = Math.max(0, fighter.aiJumpHold - dt);
    const output = {
      move: plan.move,
      jump: plan.jump,
      jumpHeld: fighter.aiJumpHold > 0,
      attack: plan.attack,
      heavy: plan.heavy,
      dash: plan.dash,
      drop: plan.drop,
      guard: plan.guard,
    };
    plan.jump = false;
    plan.attack = false;
    plan.heavy = false;
    plan.dash = false;
    plan.drop = false;
    return output;
  }

  function consumeHumanEdges() {
    input.jumpPressed = false;
    input.attackPressed = false;
    input.heavyPressed = false;
    input.dashPressed = false;
    input.dropPressed = false;
  }

  const ATTACKS = {
    light1: { startup: .055, active: .085, recovery: .15, damage: 7, knockback: 330, lift: 280, range: 83, height: 72 },
    light2: { startup: .05, active: .09, recovery: .14, damage: 8, knockback: 360, lift: 310, range: 92, height: 76 },
    light3: { startup: .07, active: .1, recovery: .24, damage: 11, knockback: 500, lift: 390, range: 105, height: 82 },
    heavy: { startup: .22, active: .13, recovery: .38, damage: 18, knockback: 690, lift: 470, range: 128, height: 92 },
    staff: { startup: .09, active: .15, recovery: .24, damage: 14, knockback: 540, lift: 390, range: 165, height: 92 },
    staffHeavy: { startup: .25, active: .17, recovery: .43, damage: 23, knockback: 760, lift: 510, range: 190, height: 104 },
    hammer: { startup: .16, active: .14, recovery: .31, damage: 19, knockback: 720, lift: 470, range: 145, height: 105 },
    hammerHeavy: { startup: .32, active: .16, recovery: .49, damage: 30, knockback: 940, lift: 610, range: 168, height: 118 },
    shoot: { startup: .08, active: .035, recovery: .22, damage: 10, knockback: 420, lift: 230, range: 0, height: 0 },
    bombThrow: { startup: .12, active: .035, recovery: .26, damage: 0, knockback: 0, lift: 0, range: 0, height: 0 },
  };

  function beginAttack(fighter, heavy = false) {
    if (!fighter.alive || fighter.stun > 0 || fighter.guardBreak > 0 || fighter.attack || fighter.dashTimer > 0) return;
    let type;
    if (fighter.weapon?.type === "blaster" && fighter.weapon.ammo > 0) type = "shoot";
    else if (fighter.weapon?.type === "bomb" && fighter.weapon.ammo > 0) type = "bombThrow";
    else if (fighter.weapon?.type === "staff") type = heavy ? "staffHeavy" : "staff";
    else if (fighter.weapon?.type === "hammer") type = heavy ? "hammerHeavy" : "hammer";
    else if (heavy) type = "heavy";
    else {
      fighter.comboStage = fighter.comboWindow > 0 ? (fighter.comboStage % 3) + 1 : 1;
      type = `light${fighter.comboStage}`;
    }
    const spec = ATTACKS[type];
    fighter.attack = {
      id: attackSerial++,
      type,
      time: 0,
      fired: false,
      hitTargets: new Set(),
      ...spec,
    };
    fighter.state = "attack";
    if (type === "hammer" || type === "hammerHeavy") audio.sfx("hammer");
    else if (type !== "shoot" && type !== "bombThrow") audio.sfx("swing");
    if (["staff", "staffHeavy", "hammer", "hammerHeavy"].includes(type)) {
      fighter.weapon.durability -= heavy ? 2 : 1;
    }
  }

  function spawnBullet(fighter) {
    const spread = fighter.id === 0 ? 0 : [.07, .045, .02][state.difficulty] * rand(-1, 1);
    const speed = 1180;
    state.projectiles.push({
      x: fighter.x + fighter.facing * 58,
      y: fighter.y - 14,
      prevX: fighter.x + fighter.facing * 58,
      prevY: fighter.y - 14,
      vx: Math.cos(spread) * speed * fighter.facing,
      vy: Math.sin(spread) * speed,
      w: 22,
      h: 9,
      ownerId: fighter.id,
      damage: 11,
      knockback: 450,
      color: fighter.color,
      life: 1.7,
      trail: [],
    });
    fighter.weapon.ammo -= 1;
    fighter.vx -= fighter.facing * 42;
    spawnMuzzle(fighter.x + fighter.facing * 62, fighter.y - 14, fighter.color, fighter.facing);
    audio.sfx("shot");
    if (fighter.weapon.ammo <= 0) {
      spawnParticles(fighter.x, fighter.y - 5, "#7d8a9b", 6, "debris");
      fighter.weapon = null;
    }
  }

  function spawnBomb(fighter) {
    state.bombs.push({
      x: fighter.x + fighter.facing * 48,
      y: fighter.y - 18,
      prevX: fighter.x + fighter.facing * 48,
      prevY: fighter.y - 18,
      vx: fighter.facing * 570 + fighter.vx * .35,
      vy: -535,
      radius: 20,
      ownerId: fighter.id,
      fuse: 1.55,
      armed: .3,
      rotation: 0,
      bounces: 0,
    });
    fighter.weapon.ammo -= 1;
    fighter.vx -= fighter.facing * 55;
    audio.sfx("swing");
    if (fighter.weapon.ammo <= 0) fighter.weapon = null;
  }

  function updateAttack(fighter, dt) {
    if (!fighter.attack) return;
    const attack = fighter.attack;
    attack.time += dt;
    const activeStart = attack.startup;
    const activeEnd = attack.startup + attack.active;

    if (attack.type === "shoot" && attack.time >= activeStart && !attack.fired) {
      attack.fired = true;
      spawnBullet(fighter);
    }

    if (attack.type === "bombThrow" && attack.time >= activeStart && !attack.fired) {
      attack.fired = true;
      spawnBomb(fighter);
    }

    if (attack.time >= activeStart && attack.time <= activeEnd && !["shoot", "bombThrow"].includes(attack.type)) {
      const reach = attack.range;
      const hitbox = {
        x: fighter.x + fighter.facing * (fighter.w / 2 + reach / 2 - 2),
        y: fighter.y - 7,
        w: reach,
        h: attack.height,
      };
      for (const target of state.fighters) {
        if (!target.alive || target.id === fighter.id || attack.hitTargets.has(target.id) || target.iframes > 0 || target.invulnerable > 0) continue;
        if (overlap(hitbox, target)) {
          attack.hitTargets.add(target.id);
          const finalHit = ["heavy", "staffHeavy", "hammer", "hammerHeavy", "light3"].includes(attack.type);
          const knock = attack.knockback * (state.suddenDeath ? 1.45 : 1);
          applyHit(target, fighter, attack.damage, fighter.facing * knock, -attack.lift, finalHit ? "heavy" : "melee");
          if (["staff", "hammer"].includes(fighter.weapon?.type) && fighter.weapon.durability <= 0) fighter.weapon = null;
        }
      }
    }

    if (attack.time >= activeEnd + attack.recovery) {
      const light = attack.type.startsWith("light");
      if (["staff", "hammer"].includes(fighter.weapon?.type) && fighter.weapon.durability <= 0) fighter.weapon = null;
      fighter.attack = null;
      fighter.comboWindow = light ? .29 : 0;
      fighter.state = fighter.grounded ? "idle" : "fall";
    }
  }

  function applyHit(target, attacker, damage, knockX, knockY, kind = "melee") {
    if (!target.alive || target.invulnerable > 0 || target.iframes > 0 || state.mode !== "playing") return;
    if (attacker?.overdrive > 0) {
      damage *= 1.25;
      knockX *= 1.12;
      knockY *= 1.12;
    }
    const facingAttack = attacker ? sign(attacker.x - target.x || 1) === target.facing : false;
    let guarded = target.guard && facingAttack && target.guardBreak <= 0;
    if (guarded) {
      damage *= .22;
      knockX *= .24;
      knockY *= .22;
      target.guardMeter -= Math.max(14, damage * 4.3);
      target.iframes = .07;
      spawnShieldBurst(target.x + target.facing * 30, target.y - 4, target.color);
      audio.sfx("shield");
      if (target.guardMeter <= 0) {
        target.guardBreak = 1.15;
        target.stun = 1.0;
        target.guard = false;
        target.guardMeter = 0;
        showFloater(target.x, target.y - 95, "GUARD BREAK", "#ffffff", 1);
      }
      return;
    }

    const scaling = 1 + (100 - target.health) / 150;
    target.health = Math.max(0, target.health - damage);
    target.vx = clamp(target.vx * .25 + knockX * scaling, -1050, 1050);
    target.vy = clamp(knockY * scaling, -980, 900);
    target.stun = clamp(.12 + damage * .012, .16, .52);
    target.iframes = .1;
    target.flash = .14;
    target.grounded = false;
    target.groundPlatform = null;
    target.attack = null;
    target.guard = false;
    target.lastAttacker = attacker ? attacker.id : null;
    target.stats.taken += damage;
    if (attacker && attacker.id !== target.id) {
      attacker.stats.damage += damage;
      attacker.signal = clamp(attacker.signal + damage * 1.65, 0, 100);
      attacker.comboHits += 1;
      attacker.comboTimer = .82;
      attacker.stats.bestCombo = Math.max(attacker.stats.bestCombo, attacker.comboHits);
    }

    const impactX = target.x - sign(knockX) * target.w * .3;
    spawnImpact(impactX, target.y - 4, attacker?.color || "#ffffff", sign(knockX), kind === "heavy" ? 18 : 10);
    showFloater(target.x, target.y - 88, `-${Math.ceil(damage)}`, attacker?.color || "#ffffff", .65);
    state.hitStop = reducedMotion ? .025 : kind === "heavy" ? .075 : .045;
    state.shake = reducedMotion ? 2 : kind === "heavy" ? 16 : 7;
    audio.sfx("hit");
    if (target.id === 0 && navigator.vibrate) navigator.vibrate(kind === "heavy" ? 28 : 12);
    if (attacker?.id === 0) updateDashButton();

    if (target.health <= 0) knockOut(target, attacker, "DEPLETED");
  }

  function knockOut(fighter, attacker = null, cause = "RING OUT") {
    if (!fighter.alive) return;
    fighter.alive = false;
    fighter.lives = Math.max(0, fighter.lives - 1);
    fighter.stats.deaths += 1;
    fighter.attack = null;
    fighter.guard = false;
    fighter.respawnTimer = fighter.lives > 0 ? 1.65 : 999;
    if (attacker && attacker.id !== fighter.id) {
      attacker.stats.kos += 1;
      attacker.signal = clamp(attacker.signal + 18, 0, 100);
      showFloater(attacker.x, attacker.y - 110, "+KO", attacker.color, 1.1);
      if (attacker.id === 0) updateDashButton();
    }
    const burstColor = attacker?.color || fighter.color;
    spawnKO(fighter.x, fighter.y, burstColor);
    showFloater(clamp(fighter.x, 120, WORLD.w - 120), clamp(fighter.y - 105, 120, 760), cause, "#ffffff", 1.05);
    state.shake = reducedMotion ? 4 : 22;
    state.flash = .28;
    state.hitStop = .085;
    audio.sfx("ko");
    if (fighter.id === 0 && navigator.vibrate) navigator.vibrate([24, 28, 38]);
    if (fighter.id === 0 && fighter.lives > 0) showToast(`${fighter.lives} ${fighter.lives === 1 ? "LIFE" : "LIVES"} LEFT`, "#ff326f", 1.05);
    checkForMatchEnd();
  }

  function triggerDash(fighter, move) {
    if (fighter.dashCooldown > 0 || fighter.stun > 0 || fighter.guardBreak > 0 || !fighter.alive) return;
    fighter.dashTimer = .13;
    fighter.dashCooldown = fighter.overdrive > 0 ? .55 : .88;
    fighter.invulnerable = Math.max(fighter.invulnerable, .09);
    fighter.vx = (Math.abs(move) > .1 ? sign(move) : fighter.facing) * 820;
    fighter.vy *= .35;
    fighter.attack = null;
    fighter.state = "dash";
    spawnDashTrail(fighter);
    audio.sfx("dash");
  }

  function triggerSurge(fighter) {
    if (fighter.signal < 100 || !fighter.alive) return false;
    fighter.signal = 0;
    fighter.invulnerable = .45;
    fighter.stun = 0;
    fighter.attack = null;
    state.flash = .6;
    state.shake = reducedMotion ? 4 : 24;
    state.hitStop = .1;
    const platform = state.stage.platforms.reduce((best, current) => Math.abs(current.x - fighter.x) < Math.abs(best.x - fighter.x) ? current : best, state.stage.platforms[0]);
    state.stage.corruption = { platformId: platform.id, timer: 4.3, ownerId: fighter.id, tick: .18 };
    for (const target of state.fighters) {
      if (!target.alive || target.id === fighter.id) continue;
      const dx = target.x - fighter.x;
      const dy = target.y - fighter.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 285) {
        const nx = dx / Math.max(1, distance);
        applyHit(target, fighter, 20, nx * 780, -520, "heavy");
      }
    }
    fighter.signal = 0;
    spawnSurge(fighter.x, fighter.y, fighter.color);
    showFloater(fighter.x, fighter.y - 125, "SIGNAL SURGE", fighter.color, 1.35);
    audio.sfx("surge");
    if (fighter.id === 0) updateDashButton();
    return true;
  }

  function updateFighter(fighter, dt) {
    if (!fighter.alive) {
      if (fighter.lives > 0) {
        fighter.respawnTimer -= dt;
        if (fighter.respawnTimer <= 0 && remainingContenders().length > 1) resetFighterAtSpawn(fighter, fighter.id);
      }
      return;
    }

    fighter.prevX = fighter.x;
    fighter.prevY = fighter.y;
    fighter.anim += dt * (2.2 + Math.abs(fighter.vx) / 150);
    fighter.invulnerable = Math.max(0, fighter.invulnerable - dt);
    fighter.iframes = Math.max(0, fighter.iframes - dt);
    fighter.stun = Math.max(0, fighter.stun - dt);
    fighter.flash = Math.max(0, fighter.flash - dt);
    fighter.dashTimer = Math.max(0, fighter.dashTimer - dt);
    fighter.dashCooldown = Math.max(0, fighter.dashCooldown - dt);
    fighter.guardBreak = Math.max(0, fighter.guardBreak - dt);
    fighter.dropTimer = Math.max(0, fighter.dropTimer - dt);
    fighter.comboWindow = Math.max(0, fighter.comboWindow - dt);
    fighter.overdrive = Math.max(0, fighter.overdrive - dt);
    fighter.hazardCooldown = Math.max(0, fighter.hazardCooldown - dt);
    fighter.comboTimer = Math.max(0, fighter.comboTimer - dt);
    if (fighter.comboTimer <= 0) fighter.comboHits = 0;
    if (!fighter.guard) fighter.guardMeter = Math.min(100, fighter.guardMeter + 25 * dt);

    const controls = fighter.id === 0 ? humanControls(dt) : aiControls(fighter, dt);
    if (controls.jump) fighter.jumpBuffer = .125;
    else fighter.jumpBuffer = Math.max(0, fighter.jumpBuffer - dt);
    fighter.coyote = fighter.grounded ? .105 : Math.max(0, fighter.coyote - dt);

    fighter.guard = Boolean(controls.guard && fighter.stun <= 0 && fighter.guardBreak <= 0 && !fighter.attack && fighter.dashTimer <= 0 && fighter.guardMeter > 0);
    if (fighter.guard) {
      fighter.guardMeter = Math.max(0, fighter.guardMeter - 13 * dt);
      fighter.vx *= Math.pow(.04, dt);
    }

    if (fighter.stun <= 0 && !fighter.guard && fighter.dashTimer <= 0) {
      const move = clamp(controls.move, -1, 1);
      if (Math.abs(move) > .08) {
        const powerSpeed = fighter.overdrive > 0 ? 1.2 : 1;
        const accel = (fighter.grounded ? 5900 : 2900) * powerSpeed;
        fighter.vx += move * accel * dt;
        fighter.vx = clamp(fighter.vx, -425 * powerSpeed, 425 * powerSpeed);
        if (!fighter.attack || fighter.attack.time < fighter.attack.startup) fighter.facing = sign(move);
      } else if (fighter.grounded) {
        fighter.vx *= Math.pow(.0007, dt);
        if (Math.abs(fighter.vx) < 4) fighter.vx = 0;
      } else {
        fighter.vx *= Math.pow(.68, dt);
      }

      if (controls.drop && fighter.grounded) {
        fighter.dropTimer = .24;
        fighter.grounded = false;
        fighter.groundPlatform = null;
        fighter.y += 7;
      }

      if (fighter.jumpBuffer > 0 && (fighter.coyote > 0 || fighter.jumpsUsed < 1)) {
        const airJump = fighter.coyote <= 0;
        const starJump = fighter.overdrive > 0 ? 1.08 : 1;
        fighter.vy = (airJump ? -820 : -885) * starJump;
        fighter.grounded = false;
        fighter.groundPlatform = null;
        fighter.jumpBuffer = 0;
        fighter.coyote = 0;
        if (airJump) fighter.jumpsUsed += 1;
        fighter.state = "jump";
        spawnDust(fighter.x, fighter.y + fighter.h / 2, fighter.color, airJump ? 10 : 6);
        audio.sfx("jump");
      }

      if (!controls.jumpHeld && fighter.vy < -330) fighter.vy += 2600 * dt;

      if (controls.dash) {
        if (!triggerSurge(fighter)) triggerDash(fighter, move);
      }
      if (controls.heavy) beginAttack(fighter, true);
      else if (controls.attack) beginAttack(fighter, false);
    }

    updateAttack(fighter, dt);

    const stageGravity = state.stage.gravityScale || 1;
    if (fighter.dashTimer <= 0) fighter.vy = Math.min(MAX_FALL, fighter.vy + GRAVITY * stageGravity * dt);
    else fighter.vy += GRAVITY * stageGravity * .12 * dt;

    const wasGrounded = fighter.grounded;
    fighter.grounded = false;
    fighter.groundPlatform = null;
    fighter.x += fighter.vx * dt;
    fighter.y += fighter.vy * dt;

    if (fighter.dropTimer <= 0 && fighter.vy >= 0) {
      const previousBottom = fighter.prevY + fighter.h / 2;
      const currentBottom = fighter.y + fighter.h / 2;
      let landing = null;
      for (const platform of state.stage.platforms) {
        const top = platform.y - platform.h / 2;
        const withinX = fighter.x + fighter.w * .33 > platform.x - platform.w / 2 && fighter.x - fighter.w * .33 < platform.x + platform.w / 2;
        if (!withinX || previousBottom > top + 12 || currentBottom < top) continue;
        if (!landing || top < landing.top) landing = { platform, top };
      }
      if (landing) {
        const impact = fighter.vy;
        fighter.y = landing.top - fighter.h / 2;
        fighter.vy = 0;
        fighter.grounded = true;
        fighter.groundPlatform = landing.platform.id;
        fighter.jumpsUsed = 0;
        if (!wasGrounded && impact > 470) spawnDust(fighter.x, landing.top, fighter.color, 7);
      }
    }

    if (state.stage.index === 1 && state.stage.wind > 0 && !fighter.grounded) {
      const direction = Math.sin(Math.floor(state.stage.t / 9) * 2.4) > 0 ? 1 : -1;
      fighter.vx += direction * state.stage.wind * 390 * dt;
    }

    if (state.stage.index === 2 && state.stage.crusherY > 140 && fighter.hazardCooldown <= 0) {
      for (const cx of [520, 1080]) {
        const crusher = { x: cx, y: (state.stage.crusherY + 24) / 2, w: 168, h: state.stage.crusherY + 24 };
        if (overlap(fighter, crusher)) {
          applyHit(fighter, null, 32, sign(fighter.x - cx || 1) * 680, 280, "heavy");
          fighter.hazardCooldown = .75;
        }
      }
    }

    const deathY = state.stage.index === 0 || state.stage.index === 5 ? state.stage.lavaY : 875;
    if (fighter.y + fighter.h / 2 > deathY || fighter.x < -150 || fighter.x > WORLD.w + 150 || fighter.y > WORLD.h + 100) {
      const attacker = fighter.lastAttacker !== null ? state.fighters[fighter.lastAttacker] : null;
      knockOut(fighter, attacker, state.stage.index === 0 || state.stage.index === 5 ? "MELTDOWN" : "RING OUT");
    }

    if (fighter.stun > 0) fighter.state = "hurt";
    else if (fighter.guard) fighter.state = "guard";
    else if (fighter.dashTimer > 0) fighter.state = "dash";
    else if (fighter.attack) fighter.state = "attack";
    else if (!fighter.grounded) fighter.state = fighter.vy < 0 ? "jump" : "fall";
    else if (Math.abs(fighter.vx) > 40) fighter.state = "run";
    else fighter.state = "idle";

    if (!Number.isFinite(fighter.x) || !Number.isFinite(fighter.y) || !Number.isFinite(fighter.vx) || !Number.isFinite(fighter.vy)) {
      resetFighterAtSpawn(fighter, fighter.id);
    }
  }

  function updateProjectiles(dt) {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const shot = state.projectiles[i];
      shot.prevX = shot.x;
      shot.prevY = shot.y;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      shot.trail.push({ x: shot.x, y: shot.y, life: .16 });
      if (shot.trail.length > 7) shot.trail.shift();
      shot.trail.forEach((point) => { point.life -= dt; });

      let destroyed = false;
      for (const platform of state.stage.platforms) {
        const rect = { x: platform.x, y: platform.y, w: platform.w, h: platform.h + 5 };
        if (segmentHitsRect(shot.prevX, shot.prevY, shot.x, shot.y, rect)) {
          spawnImpact(shot.x, shot.y, shot.color, -sign(shot.vx), 5);
          destroyed = true;
          break;
        }
      }

      if (!destroyed) {
        for (const fighter of state.fighters) {
          if (!fighter.alive || fighter.id === shot.ownerId || fighter.iframes > 0 || fighter.invulnerable > 0) continue;
          if (segmentHitsRect(shot.prevX, shot.prevY, shot.x, shot.y, fighter)) {
            const owner = state.fighters[shot.ownerId];
            applyHit(fighter, owner, shot.damage, sign(shot.vx) * shot.knockback, -230, "shot");
            destroyed = true;
            break;
          }
        }
      }
      if (destroyed || shot.life <= 0 || shot.x < -80 || shot.x > WORLD.w + 80 || shot.y < -80 || shot.y > WORLD.h + 80) state.projectiles.splice(i, 1);
    }
  }

  function explodeBomb(bomb) {
    const owner = state.fighters[bomb.ownerId];
    const radius = 190;
    for (const fighter of state.fighters) {
      if (!fighter.alive || fighter.invulnerable > 0) continue;
      const dx = fighter.x - bomb.x;
      const dy = fighter.y - bomb.y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      const force = 1 - distance / radius;
      const nx = dx / Math.max(1, distance);
      applyHit(fighter, owner, 17 + force * 15, nx * (620 + force * 430), -430 - force * 260, "heavy");
    }
    spawnParticles(bomb.x, bomb.y, "#ff8a32", 34, "debris");
    spawnParticles(bomb.x, bomb.y, "#fff3a8", 22, "spark");
    state.shake = reducedMotion ? 5 : 25;
    state.flash = .32;
    audio.sfx("bomb");
  }

  function updateBombs(dt) {
    for (let i = state.bombs.length - 1; i >= 0; i--) {
      const bomb = state.bombs[i];
      bomb.prevX = bomb.x;
      bomb.prevY = bomb.y;
      bomb.armed = Math.max(0, bomb.armed - dt);
      bomb.fuse -= dt;
      bomb.vy += GRAVITY * (state.stage.gravityScale || 1) * .58 * dt;
      bomb.x += bomb.vx * dt;
      bomb.y += bomb.vy * dt;
      bomb.rotation += bomb.vx * dt * .012;

      if (bomb.vy > 0) {
        const previousBottom = bomb.prevY + bomb.radius;
        const currentBottom = bomb.y + bomb.radius;
        for (const platform of state.stage.platforms) {
          const top = platform.y - platform.h / 2;
          const withinX = bomb.x + bomb.radius > platform.x - platform.w / 2 && bomb.x - bomb.radius < platform.x + platform.w / 2;
          if (!withinX || previousBottom > top + 9 || currentBottom < top) continue;
          bomb.y = top - bomb.radius;
          bomb.vy = -Math.max(120, Math.abs(bomb.vy) * .48);
          bomb.vx *= .76;
          bomb.bounces += 1;
          spawnParticles(bomb.x, top, "#ff8a32", 4, "spark");
          break;
        }
      }

      if (bomb.fuse <= 0 || bomb.y > WORLD.h + 80 || bomb.x < -120 || bomb.x > WORLD.w + 120) {
        explodeBomb(bomb);
        state.bombs.splice(i, 1);
      }
    }
  }

  function spawnWeapon() {
    if (state.pickups.filter((pickup) => pickup.type !== "star").length >= 2) return;
    const candidates = state.stage.platforms.filter((p) => p.w > 180);
    const platform = candidates[Math.floor(Math.random() * candidates.length)];
    const roll = Math.random();
    const type = roll < .3 ? "blaster" : roll < .55 ? "staff" : roll < .8 ? "hammer" : "bomb";
    const offsetX = rand(-Math.max(0, platform.w / 2 - 75), Math.max(0, platform.w / 2 - 75));
    state.pickups.push({
      type,
      x: platform.x + offsetX,
      y: platform.y - platform.h / 2 - 28,
      baseY: platform.y - platform.h / 2 - 28,
      platformId: platform.id,
      offsetX,
      life: 12,
      pulse: rand(0, 6),
    });
    const labels = { blaster: "PULSE BLASTER ONLINE", staff: "SIGNAL STAFF ONLINE", hammer: "GRAVITY HAMMER ONLINE", bomb: "PLASMA BOMBS ONLINE" };
    const colors = { blaster: "#27e7ff", staff: "#ffc53d", hammer: "#ff326f", bomb: "#ff8a32" };
    showToast(labels[type], colors[type], .8);
  }

  function spawnStar() {
    if (state.pickups.some((pickup) => pickup.type === "star")) return;
    const candidates = state.stage.platforms.filter((p) => p.w > 220);
    const platform = candidates[Math.floor(Math.random() * candidates.length)];
    const offsetX = rand(-Math.max(0, platform.w / 2 - 80), Math.max(0, platform.w / 2 - 80));
    state.pickups.push({
      type: "star",
      x: platform.x + offsetX,
      y: platform.y - platform.h / 2 - 38,
      baseY: platform.y - platform.h / 2 - 38,
      platformId: platform.id,
      offsetX,
      life: 10,
      pulse: rand(0, 6),
    });
    showToast("STAR POWER INBOUND", "#fff36a", 1);
  }

  function updatePickups(dt) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnWeapon();
      state.spawnTimer = rand(8, 11.5);
    }
    state.starTimer -= dt;
    if (state.starTimer <= 0) {
      spawnStar();
      state.starTimer = rand(17, 23);
    }
    for (let i = state.pickups.length - 1; i >= 0; i--) {
      const pickup = state.pickups[i];
      pickup.life -= dt;
      pickup.pulse += dt * 3;
      const platform = state.stage.platforms.find((p) => p.id === pickup.platformId);
      if (platform) {
        pickup.x = platform.x + pickup.offsetX;
        pickup.baseY = platform.y - platform.h / 2 - 29;
        pickup.y = pickup.baseY + Math.sin(pickup.pulse) * 7;
      }
      let claimed = false;
      for (const fighter of state.fighters) {
        if (!fighter.alive || Math.hypot(fighter.x - pickup.x, fighter.y - pickup.y) > 72) continue;
        if (pickup.type !== "star" && fighter.weapon) continue;
        if (pickup.type === "star") {
          fighter.overdrive = 7.5;
          fighter.signal = clamp(fighter.signal + 20, 0, 100);
        } else if (pickup.type === "blaster") fighter.weapon = { type: "blaster", ammo: 7 };
        else if (pickup.type === "staff") fighter.weapon = { type: "staff", durability: 6 };
        else if (pickup.type === "hammer") fighter.weapon = { type: "hammer", durability: 5 };
        else fighter.weapon = { type: "bomb", ammo: 2 };
        spawnPickupBurst(pickup.x, pickup.y, fighter.color);
        const labels = { blaster: "BLASTER", staff: "STAFF", hammer: "HAMMER", bomb: "BOMBS", star: "STAR POWER" };
        showFloater(fighter.x, fighter.y - 100, labels[pickup.type], pickup.type === "star" ? "#fff36a" : fighter.color, 1);
        audio.sfx(pickup.type === "star" ? "star" : "pickup");
        claimed = true;
        break;
      }
      if (claimed || pickup.life <= 0) state.pickups.splice(i, 1);
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.gravity || 0) * dt;
      p.vx *= Math.pow(p.drag || .5, dt);
      p.rotation += (p.spin || 0) * dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      const f = state.floaters[i];
      f.life -= dt;
      f.y -= 35 * dt;
      if (f.life <= 0) state.floaters.splice(i, 1);
    }
  }

  function spawnParticles(x, y, color, count, kind = "spark") {
    const room = Math.max(0, 260 - state.particles.length);
    const amount = Math.min(count, room);
    for (let i = 0; i < amount; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = kind === "dust" ? rand(60, 230) : rand(150, 520);
      state.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (kind === "dust" ? 40 : 0),
        life: rand(.22, kind === "debris" ? .75 : .52),
        maxLife: .75,
        color,
        size: rand(kind === "debris" ? 4 : 2, kind === "debris" ? 10 : 6),
        gravity: kind === "dust" ? -20 : kind === "debris" ? 900 : 380,
        drag: kind === "dust" ? .08 : .48,
        rotation: angle,
        spin: rand(-9, 9),
        kind,
      });
    }
  }

  function spawnImpact(x, y, color, direction, count) {
    for (let i = 0; i < count && state.particles.length < 260; i++) {
      const angle = rand(-.8, .8) + (direction > 0 ? 0 : Math.PI);
      const speed = rand(240, 720);
      state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(.16, .42), maxLife: .42, color, size: rand(2, 7), gravity: 420, drag: .32, rotation: angle, spin: 0, kind: "streak" });
    }
    spawnParticles(x, y, "#ffffff", Math.ceil(count / 3), "spark");
  }

  function spawnMuzzle(x, y, color, direction) {
    spawnImpact(x, y, color, direction, 7);
  }

  function spawnDust(x, y, color, count) {
    spawnParticles(x, y, color, count, "dust");
  }

  function spawnDashTrail(fighter) {
    for (let i = 0; i < 8; i++) {
      state.particles.push({ x: fighter.x - fighter.facing * i * 11, y: fighter.y + rand(-28, 30), vx: -fighter.facing * rand(80, 240), vy: rand(-25, 25), life: rand(.12, .28), maxLife: .28, color: fighter.color, size: rand(3, 8), gravity: 0, drag: .15, rotation: 0, spin: 0, kind: "streak" });
    }
  }

  function spawnShieldBurst(x, y, color) {
    for (let i = 0; i < 12; i++) {
      const angle = -Math.PI / 2 + rand(-1.2, 1.2);
      state.particles.push({ x, y, vx: Math.cos(angle) * rand(100, 300), vy: Math.sin(angle) * rand(100, 300), life: rand(.18, .4), maxLife: .4, color, size: rand(2, 5), gravity: 0, drag: .2, rotation: angle, spin: 0, kind: "spark" });
    }
  }

  function spawnPickupBurst(x, y, color) {
    spawnParticles(x, y, color, 18, "spark");
    state.flash = .12;
  }

  function spawnKO(x, y, color) {
    spawnParticles(x, y, color, 34, "debris");
    spawnParticles(x, y, "#ffffff", 18, "spark");
  }

  function spawnSurge(x, y, color) {
    for (let i = 0; i < 38; i++) {
      const angle = i / 38 * Math.PI * 2;
      state.particles.push({ x, y, vx: Math.cos(angle) * rand(390, 780), vy: Math.sin(angle) * rand(390, 780), life: rand(.42, .75), maxLife: .75, color: i % 4 === 0 ? "#ffffff" : color, size: rand(3, 9), gravity: 0, drag: .28, rotation: angle, spin: 0, kind: "streak" });
    }
  }

  function showFloater(x, y, text, color, life = .7) {
    state.floaters.push({ x, y, text, color, life, maxLife: life });
    if (state.floaters.length > 18) state.floaters.shift();
  }

  function updateGame(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastNode.classList.remove("show");
    }
    state.flash = Math.max(0, state.flash - dt * 2.4);
    state.shake = Math.max(0, state.shake - dt * 42);

    if (state.mode === "menu" || state.mode === "result" || state.mode === "paused") {
      if (state.mode !== "paused" && state.stage) updateStage(dt * .35);
      updateParticles(dt);
      return;
    }

    if (state.hitStop > 0) {
      state.hitStop -= dt;
      updateParticles(dt * .3);
      return;
    }

    const scaledDt = state.slowTime > 0 ? dt * .34 : dt;
    state.slowTime = Math.max(0, state.slowTime - dt);
    updateStage(scaledDt);

    if (state.mode === "countdown") {
      const before = Math.ceil(state.countdown);
      state.countdown -= dt;
      const after = Math.ceil(state.countdown);
      if (after !== before && after > 0) audio.sfx("count");
      updateParticles(dt);
      if (state.countdown <= 0) {
        state.mode = "playing";
        showToast("FIGHT", "#b7ff3c", .6);
        audio.sfx("fight");
      }
      consumeHumanEdges();
      return;
    }

    if (state.mode !== "playing") return;
    state.matchTime = Math.max(0, state.matchTime - scaledDt);
    for (const fighter of state.fighters) updateFighter(fighter, scaledDt);
    updateProjectiles(scaledDt);
    updateBombs(scaledDt);
    updatePickups(scaledDt);
    updateParticles(scaledDt);
    consumeHumanEdges();
    updateDashButton();

    if (state.roundEndTimer > 0) {
      state.roundEndTimer -= dt;
      if (state.roundEndTimer <= 0) finishMatch(remainingContenders()[0] || chooseTimeWinner());
      return;
    }

    if (state.matchTime <= 0) {
      const winner = chooseTimeWinner();
      if (!state.suddenDeath && !winner) enterSuddenDeath();
      else finishMatch(winner || chooseTimeWinner());
    }
  }

  function resizeCanvas() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    viewScale = Math.min(width / WORLD.w, height / WORLD.h);
    viewX = (width - WORLD.w * viewScale) / 2;
    viewY = (height - WORLD.h * viewScale) / 2;

    // The pause and sound buttons are DOM, the HUD is drawn into the world and
    // then letterboxed, so pinning the buttons to the viewport's top-right put
    // them straight through the fourth fighter's card at 16:9 — which is the
    // desktop case and the shape of the WEBCADE player. Anchor them to the
    // world rect instead: inside its right edge, below the HUD band.
    const worldRight = width - (viewX + WORLD.w * viewScale);
    const inset = Math.round(worldRight + 16 * viewScale);
    const below = Math.round(viewY + HUD_BAND_H * viewScale + 10);
    shell.style.setProperty("--chrome-right", `max(${inset}px, env(safe-area-inset-right, 0px))`);
    shell.style.setProperty("--chrome-top", `max(${below}px, env(safe-area-inset-top, 0px))`);
  }

  function roundRect(context, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + w, y, x + w, y + h, radius);
    context.arcTo(x + w, y + h, x, y + h, radius);
    context.arcTo(x, y + h, x, y, radius);
    context.arcTo(x, y, x + w, y, radius);
    context.closePath();
  }

  function drawBackground() {
    const stage = state.stage || createStage(state.stageIndex);
    const gradient = ctx.createLinearGradient(0, 0, 0, WORLD.h);
    gradient.addColorStop(0, stage.deep);
    gradient.addColorStop(.55, "#0a101d");
    gradient.addColorStop(1, "#02040a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    const glow = ctx.createRadialGradient(WORLD.w * .5, WORLD.h * .42, 30, WORLD.w * .5, WORLD.h * .42, 780);
    glow.addColorStop(0, `${stage.tint}17`);
    glow.addColorStop(.45, `${stage.tint}08`);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.save();
    ctx.globalAlpha = .19;
    ctx.strokeStyle = stage.tint;
    ctx.lineWidth = 2;
    const drift = (stage.t * 10) % 80;
    for (let x = -80 + drift; x < WORLD.w + 80; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 110);
      ctx.lineTo(x, 165);
      ctx.lineTo(x + 26, 191);
      ctx.lineTo(x + 26, 260);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#070b14";
    if (stage.index === 1) {
      for (let i = 0; i < 18; i++) {
        const x = i * 105 - 35;
        const h = 120 + ((i * 71) % 190);
        ctx.fillRect(x, 720 - h, 84, h);
        ctx.fillStyle = i % 3 === 0 ? "#11102a" : "#070b14";
        for (let wy = 0; wy < h - 40; wy += 36) {
          if ((i + wy / 36) % 3 === 0) {
            ctx.fillStyle = `${stage.tint}20`;
            ctx.fillRect(x + 16, 735 - h + wy, 8, 3);
          }
        }
        ctx.fillStyle = "#070b14";
      }
    } else if (stage.index === 2) {
      for (let x = 80; x < WORLD.w; x += 220) {
        ctx.fillRect(x, 110, 70, 620);
        ctx.fillStyle = "#12101a";
        ctx.fillRect(x + 15, 130, 40, 540);
        ctx.fillStyle = "#070b14";
      }
    } else if (stage.index === 3) {
      for (let x = 45; x < WORLD.w; x += 155) {
        ctx.fillStyle = x % 2 ? "#130817" : "#090711";
        ctx.fillRect(x, 190, 92, 540);
        ctx.fillStyle = `${stage.tint}18`;
        ctx.fillRect(x + 22, 230, 48, 7);
        ctx.fillRect(x + 22, 290, 31, 5);
      }
    } else if (stage.index === 4) {
      ctx.fillStyle = "#b8d7ff";
      for (let i = 0; i < 78; i++) {
        const x = (i * 197) % WORLD.w;
        const y = 110 + (i * 83) % 560;
        const size = i % 9 === 0 ? 3 : 1.4;
        ctx.globalAlpha = .18 + (i % 5) * .08;
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#071020";
      ctx.beginPath(); ctx.arc(1240, 215, 115, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#173b79";
      ctx.lineWidth = 18;
      ctx.beginPath(); ctx.arc(1240, 215, 142, -.3, 2.6); ctx.stroke();
    } else if (stage.index === 5) {
      for (let i = 0; i < 9; i++) {
        const x = 55 + i * 182;
        const y = 145 + (i % 3) * 72;
        ctx.fillStyle = "#0e0710";
        ctx.fillRect(x, y, 138, 86);
        ctx.strokeStyle = i % 2 ? "#ff326f" : "#d6e3f5";
        ctx.globalAlpha = .18;
        ctx.strokeRect(x + 4, y + 4, 130, 78);
        ctx.beginPath(); ctx.moveTo(x + 14, y + 65); ctx.lineTo(x + 118, y + 21); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(0, 610);
      for (let x = 0; x <= WORLD.w; x += 120) ctx.lineTo(x, 570 - ((x * 13) % 120));
      ctx.lineTo(WORLD.w, 760);
      ctx.lineTo(0, 760);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#0e1522";
      for (let i = 0; i < 8; i++) ctx.fillRect(85 + i * 210, 400 + (i % 2) * 65, 55, 320);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = .35;
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.lineWidth = 1;
    for (let y = 110; y < 780; y += 72) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlatform(platform) {
    const stage = state.stage;
    const corrupted = stage.corruption?.platformId === platform.id;
    const top = platform.y - platform.h / 2;
    const left = platform.x - platform.w / 2;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.fillRect(left + 10, top + 16, platform.w, platform.h + 13);

    const body = ctx.createLinearGradient(0, top, 0, top + platform.h);
    body.addColorStop(0, "#1b2537");
    body.addColorStop(.22, "#101827");
    body.addColorStop(1, "#070b14");
    ctx.fillStyle = body;
    ctx.fillRect(left, top, platform.w, platform.h);
    ctx.fillStyle = corrupted ? "#b7ff3c" : stage.tint;
    ctx.globalAlpha = corrupted ? .9 : .62;
    ctx.fillRect(left, top, platform.w, corrupted ? 7 : 4);
    ctx.shadowColor = corrupted ? "#b7ff3c" : stage.tint;
    ctx.shadowBlur = corrupted ? 24 : 8;
    ctx.fillRect(left + 9, top + 4, Math.max(0, platform.w - 18), 2);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = .22;
    ctx.fillStyle = "#b8c7da";
    for (let x = left + 26; x < left + platform.w - 15; x += 48) ctx.fillRect(x, top + platform.h * .55, 25, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#02050a";
    for (let x = left + 14; x < left + platform.w - 12; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, top + platform.h);
      ctx.lineTo(x + 9, top + platform.h + (platform.thin ? 8 : 14));
      ctx.lineTo(x + 18, top + platform.h);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHazards() {
    const stage = state.stage;
    if (stage.index === 0) {
      const gradient = ctx.createLinearGradient(0, stage.lavaY - 35, 0, WORLD.h);
      gradient.addColorStop(0, "rgba(255,53,91,.18)");
      gradient.addColorStop(.12, "#ff315d");
      gradient.addColorStop(.35, "#9b133f");
      gradient.addColorStop(1, "#290718");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, stage.lavaY);
      for (let x = 0; x <= WORLD.w + 30; x += 30) ctx.lineTo(x, stage.lavaY + Math.sin(stage.t * 3.4 + x * .022) * 8);
      ctx.lineTo(WORLD.w, WORLD.h);
      ctx.lineTo(0, WORLD.h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ff8c55";
      ctx.lineWidth = 4;
      ctx.shadowColor = "#ff315d";
      ctx.shadowBlur = 28;
      ctx.beginPath();
      for (let x = 0; x <= WORLD.w; x += 24) {
        const y = stage.lavaY + Math.sin(stage.t * 3.4 + x * .022) * 8;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (stage.index === 1) {
      const windCycle = stage.t % 9;
      if (stage.wind > 0) {
        const direction = Math.sin(Math.floor(stage.t / 9) * 2.4) > 0 ? 1 : -1;
        ctx.save();
        ctx.globalAlpha = stage.wind * .42;
        ctx.strokeStyle = "#d9c7ff";
        ctx.lineWidth = 4;
        for (let y = 180; y < 770; y += 66) {
          const start = direction > 0 ? -120 : WORLD.w + 120;
          const offset = (stage.t * 450 + y * 2.1) % 420;
          ctx.beginPath();
          ctx.moveTo(start + direction * offset, y);
          ctx.lineTo(start + direction * (offset + 230), y - direction * 18);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (windCycle > 5.7 && windCycle < 6.5) drawWarning("WIND SURGE", "#9f47ff");
    } else if (stage.index === 2) {
      const warning = stage.crusherPhase >= 4.1 && stage.crusherPhase < 5.1;
      for (const x of [520, 1080]) {
        if (warning) {
          ctx.fillStyle = `rgba(255,50,77,${.12 + Math.sin(stage.t * 26) * .08})`;
          ctx.fillRect(x - 86, 95, 172, 640);
          ctx.strokeStyle = "#ff324d";
          ctx.lineWidth = 4;
          ctx.setLineDash([14, 12]);
          ctx.strokeRect(x - 82, 100, 164, 625);
          ctx.setLineDash([]);
        }
        const y = stage.crusherY;
        ctx.fillStyle = "#0a0d15";
        ctx.fillRect(x - 74, 0, 148, Math.max(20, y - 25));
        ctx.fillStyle = "#2a1b20";
        ctx.fillRect(x - 84, y - 40, 168, 42);
        ctx.fillStyle = "#ff324d";
        ctx.fillRect(x - 78, y - 34, 156, 4);
        ctx.fillStyle = "#07090f";
        for (let tx = x - 82; tx < x + 82; tx += 28) {
          ctx.beginPath();
          ctx.moveTo(tx, y + 2);
          ctx.lineTo(tx + 14, y + 24);
          ctx.lineTo(tx + 28, y + 2);
          ctx.fill();
        }
      }
      if (warning) drawWarning("CRUSHER ARMED", "#ff324d");
    } else if (stage.index === 3) {
      const cycle = stage.t % 7.5;
      ctx.save();
      ctx.translate(800, 625);
      ctx.fillStyle = "#18070f";
      ctx.beginPath(); ctx.arc(0, 0, 72, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ff326f";
      ctx.lineWidth = 9;
      ctx.shadowColor = "#ff326f";
      ctx.shadowBlur = 28;
      ctx.beginPath(); ctx.arc(0, 0, 45 + Math.sin(stage.t * 4) * 5, 0, Math.PI * 2); ctx.stroke();
      if (stage.pulseRadius > 0) {
        ctx.globalAlpha = clamp(1 - stage.pulseRadius / 1050, .12, .8);
        ctx.lineWidth = 15;
        ctx.beginPath(); ctx.arc(0, 0, stage.pulseRadius, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      if (cycle > 4.7 && cycle < 5.5) drawWarning("REACTOR PULSE", "#ff326f");
    } else if (stage.index === 4) {
      ctx.save();
      ctx.globalAlpha = .28;
      ctx.strokeStyle = "#4d8dff";
      ctx.lineWidth = 3;
      for (let x = 110; x < WORLD.w; x += 170) {
        const float = Math.sin(stage.t * .9 + x) * 18;
        ctx.beginPath();
        ctx.moveTo(x, 800 + float);
        ctx.lineTo(x, 760 + float);
        ctx.lineTo(x - 10, 773 + float);
        ctx.moveTo(x, 760 + float);
        ctx.lineTo(x + 10, 773 + float);
        ctx.stroke();
      }
      ctx.restore();
    } else if (stage.index === 5) {
      const lava = ctx.createLinearGradient(0, stage.lavaY - 28, 0, WORLD.h);
      lava.addColorStop(0, "rgba(255,255,255,.35)");
      lava.addColorStop(.08, "#ff326f");
      lava.addColorStop(.45, "#650d32");
      lava.addColorStop(1, "#19040d");
      ctx.fillStyle = lava;
      ctx.beginPath();
      ctx.moveTo(0, stage.lavaY);
      for (let x = 0; x <= WORLD.w + 30; x += 30) ctx.lineTo(x, stage.lavaY + Math.sin(stage.t * 5 + x * .03) * 9);
      ctx.lineTo(WORLD.w, WORLD.h); ctx.lineTo(0, WORLD.h); ctx.closePath(); ctx.fill();
      const cycle = stage.t % 6.5;
      if (cycle > 4.15 && cycle < 5) drawWarning("STATIC WALL", "#ffffff");
      if (stage.sweepX > 0) {
        ctx.save();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 13;
        ctx.shadowColor = "#ff326f";
        ctx.shadowBlur = 36;
        ctx.globalAlpha = .85;
        ctx.beginPath();
        ctx.moveTo(stage.sweepX, 105);
        ctx.lineTo(stage.sweepX + Math.sin(stage.t * 50) * 20, 810);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawWarning(text, color) {
    ctx.save();
    ctx.translate(WORLD.w / 2, 128);
    ctx.globalAlpha = .72 + Math.sin(state.stage.t * 22) * .25;
    ctx.fillStyle = color;
    ctx.fillRect(-128, -16, 256, 32);
    ctx.fillStyle = "#050811";
    ctx.font = "900 18px 'Space Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`⚠ ${text}`, 0, 1);
    ctx.restore();
  }

  function drawPickup(pickup) {
    ctx.save();
    ctx.translate(pickup.x, pickup.y);
    const pulse = 1 + Math.sin(pickup.pulse * 1.8) * .07;
    ctx.scale(pulse, pulse);
    const color = { blaster: "#27e7ff", staff: "#ffc53d", hammer: "#ff326f", bomb: "#ff8a32", star: "#fff36a" }[pickup.type];
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#02050a";
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (pickup.type === "star") {
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + i * Math.PI / 5;
        const radius = i % 2 === 0 ? 31 : 13;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else if (pickup.type === "blaster") {
      ctx.moveTo(-28, -5); ctx.lineTo(22, -5); ctx.lineTo(31, 5); ctx.lineTo(2, 9); ctx.lineTo(-8, 23);
    } else if (pickup.type === "staff") {
      ctx.moveTo(-37, 20); ctx.lineTo(32, -22); ctx.moveTo(25, -29); ctx.lineTo(39, -15);
    } else if (pickup.type === "hammer") {
      ctx.moveTo(-25, 25); ctx.lineTo(18, -18); ctx.moveTo(-2, -31); ctx.lineTo(33, 4);
    } else {
      ctx.arc(0, 1, 24, 0, Math.PI * 2); ctx.moveTo(0, -23); ctx.lineTo(10, -38);
    }
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawFighter(fighter, alpha = 1) {
    if (!fighter.alive) return;
    if (fighter.invulnerable > 0 && Math.floor(fighter.invulnerable * 14) % 2 === 0) alpha *= .38;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(fighter.x, fighter.y);

    if (fighter.overdrive > 0) {
      ctx.save();
      ctx.rotate(fighter.anim * .35);
      ctx.strokeStyle = "#fff36a";
      ctx.lineWidth = 4;
      ctx.globalAlpha = .38 + Math.sin(fighter.anim * 8) * .12;
      ctx.shadowColor = "#fff36a";
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(0, -3, 56 + Math.sin(fighter.anim * 5) * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const run = fighter.state === "run" ? Math.sin(fighter.anim * 6) : 0;
    const air = fighter.grounded ? 0 : 1;
    const crouch = fighter.state === "guard" ? 10 : 0;
    const lean = fighter.state === "dash" ? fighter.facing * 13 : clamp(fighter.vx / 50, -6, 6);
    const headX = lean * .35;
    const headY = -37 + crouch;
    const shoulder = { x: lean * .15, y: -14 + crouch };
    const hip = { x: -lean * .1, y: 17 + crouch };
    let frontHand = { x: fighter.facing * (31 + run * 9), y: 2 + crouch - run * 4 };
    let backHand = { x: -fighter.facing * (24 + run * 6), y: -2 + crouch + run * 3 };
    let frontFoot = { x: fighter.facing * (24 + run * 17), y: 52 - air * 8 - Math.max(0, run) * 7 };
    let backFoot = { x: -fighter.facing * (22 + run * 17), y: 52 - air * 8 + Math.min(0, run) * 7 };

    if (fighter.state === "jump") {
      frontFoot = { x: fighter.facing * 27, y: 36 };
      backFoot = { x: -fighter.facing * 18, y: 41 };
      frontHand.y = -16;
      backHand.y = -12;
    } else if (fighter.state === "fall") {
      frontFoot = { x: fighter.facing * 17, y: 48 };
      backFoot = { x: -fighter.facing * 30, y: 35 };
      frontHand = { x: fighter.facing * 35, y: -8 };
      backHand = { x: -fighter.facing * 30, y: -15 };
    } else if (fighter.state === "hurt") {
      frontHand = { x: -fighter.facing * 36, y: -8 };
      backHand = { x: -fighter.facing * 24, y: 10 };
      frontFoot.x = fighter.facing * 12;
      backFoot.x = -fighter.facing * 34;
    } else if (fighter.state === "dash") {
      frontHand = { x: fighter.facing * 43, y: -6 };
      backHand = { x: -fighter.facing * 12, y: 16 };
      frontFoot = { x: -fighter.facing * 18, y: 45 };
      backFoot = { x: -fighter.facing * 38, y: 33 };
    } else if (fighter.state === "guard") {
      frontHand = { x: fighter.facing * 25, y: -26 };
      backHand = { x: fighter.facing * 19, y: -3 };
      frontFoot = { x: fighter.facing * 25, y: 52 };
      backFoot = { x: -fighter.facing * 20, y: 52 };
    }

    if (fighter.attack) {
      const attack = fighter.attack;
      const progress = clamp(attack.time / Math.max(.01, attack.startup), 0, 1);
      const active = attack.time >= attack.startup && attack.time <= attack.startup + attack.active;
      const strength = attack.type.includes("Heavy") || attack.type === "heavy" ? 1.28 : 1;
      if (attack.type === "shoot") {
        frontHand = { x: fighter.facing * 49, y: -9 };
        backHand = { x: fighter.facing * 23, y: 3 };
      } else if (active) {
        frontHand = { x: fighter.facing * 63 * strength, y: -6 };
        backHand = { x: fighter.facing * 34 * strength, y: 11 };
        frontFoot = { x: fighter.facing * 34, y: 51 };
        backFoot = { x: -fighter.facing * 27, y: 51 };
      } else {
        frontHand = { x: -fighter.facing * (20 + progress * 20), y: -22 };
        backHand = { x: -fighter.facing * 30, y: 0 };
      }
    }

    ctx.save();
    ctx.globalAlpha *= .22;
    ctx.fillStyle = fighter.color;
    ctx.beginPath();
    ctx.ellipse(0, 57, 41, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const drawSkeleton = (stroke, width) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(hip.x, hip.y);
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(frontHand.x * .55, lerp(shoulder.y, frontHand.y, .55));
      ctx.lineTo(frontHand.x, frontHand.y);
      ctx.moveTo(shoulder.x, shoulder.y + 2);
      ctx.lineTo(backHand.x * .55, lerp(shoulder.y + 2, backHand.y, .55));
      ctx.lineTo(backHand.x, backHand.y);
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(frontFoot.x * .5, lerp(hip.y, frontFoot.y, .48));
      ctx.lineTo(frontFoot.x, frontFoot.y);
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(backFoot.x * .5, lerp(hip.y, backFoot.y, .48));
      ctx.lineTo(backFoot.x, backFoot.y);
      ctx.stroke();
    };

    drawSkeleton("#02040a", 15);
    drawSkeleton(fighter.flash > 0 ? "#ffffff" : fighter.color, 8);

    ctx.fillStyle = "#02040a";
    ctx.beginPath();
    ctx.arc(headX, headY, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fighter.flash > 0 ? "#ffffff" : fighter.color;
    ctx.beginPath();
    ctx.arc(headX, headY, 19, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(headX, headY);
    ctx.fillStyle = "rgba(2,4,10,.76)";
    ctx.font = fighter.icon === "⚡" ? "900 15px sans-serif" : "900 15px 'Arial Narrow', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fighter.icon, 0, 1);
    ctx.restore();

    if (fighter.weapon) drawHeldWeapon(fighter, frontHand, backHand);

    if (fighter.guard) {
      ctx.save();
      ctx.strokeStyle = fighter.color;
      ctx.lineWidth = 5;
      ctx.globalAlpha = .6;
      ctx.shadowColor = fighter.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(fighter.facing * 25, -4, 48, fighter.facing > 0 ? -1.25 : 1.25, fighter.facing > 0 ? 1.25 : Math.PI * 2 - 1.25, fighter.facing < 0);
      ctx.stroke();
      ctx.restore();
    }

    if (fighter.id === 0) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(0, -80);
      ctx.lineTo(-9, -94);
      ctx.lineTo(9, -94);
      ctx.closePath();
      ctx.fill();
      ctx.font = "900 15px 'Arial Narrow', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("YOU", 0, -101);
    }

    if (fighter.weapon) {
      const label = ["blaster", "bomb"].includes(fighter.weapon.type) ? fighter.weapon.ammo : fighter.weapon.durability;
      ctx.fillStyle = "rgba(2,4,10,.8)";
      roundRect(ctx, -19, 66, 38, 21, 5);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 13px monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(label), 0, 81);
    }
    ctx.restore();
  }

  function drawHeldWeapon(fighter, frontHand, backHand) {
    ctx.save();
    const color = { blaster: "#84f3ff", staff: "#ffc53d", hammer: "#ff326f", bomb: "#ff8a32" }[fighter.weapon.type];
    ctx.strokeStyle = "#02040a";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (fighter.weapon.type === "blaster") {
      const x = frontHand.x;
      const y = frontHand.y;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(x - fighter.facing * 15, y);
      ctx.lineTo(x + fighter.facing * 24, y);
      ctx.lineTo(x + fighter.facing * 30, y + 8);
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x - fighter.facing * 6, y + 17);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.stroke();
    } else if (fighter.weapon.type === "bomb") {
      const x = frontHand.x;
      const y = frontHand.y;
      ctx.fillStyle = "#05070c";
      ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 15); ctx.lineTo(x + fighter.facing * 8, y - 27); ctx.stroke();
    } else if (fighter.weapon.type === "hammer") {
      const attacking = fighter.attack && fighter.attack.type.startsWith("hammer");
      const angle = attacking ? (fighter.facing > 0 ? -.2 : Math.PI + .2) : (fighter.facing > 0 ? -1 : Math.PI + 1);
      const cx = (frontHand.x + backHand.x) / 2;
      const cy = (frontHand.y + backHand.y) / 2;
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.strokeStyle = "#02040a";
      ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(-45, 0); ctx.lineTo(56, 0); ctx.stroke();
      ctx.strokeStyle = "#8a9aad";
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.fillStyle = "#02040a";
      ctx.fillRect(39, -29, 55, 58);
      ctx.fillStyle = color;
      ctx.fillRect(45, -23, 43, 46);
    } else {
      const attacking = fighter.attack && fighter.attack.type.startsWith("staff");
      const angle = attacking ? (fighter.facing > 0 ? -.45 : Math.PI + .45) : (fighter.facing > 0 ? -1.02 : Math.PI + 1.02);
      const cx = (frontHand.x + backHand.x) / 2;
      const cy = (frontHand.y + backHand.y) / 2;
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(-50, 0); ctx.lineTo(62, 0); ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = "#fff5bd";
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillRect(53, -7, 18, 14);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawProjectile(shot) {
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < shot.trail.length; i++) {
      const point = shot.trail[i];
      ctx.globalAlpha = clamp(point.life / .16, 0, 1) * .35;
      ctx.fillStyle = shot.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2 + i * .35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.shadowColor = shot.color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(shot.x - sign(shot.vx) * 18, shot.y);
    ctx.lineTo(shot.x + sign(shot.vx) * 8, shot.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawBomb(bomb) {
    ctx.save();
    ctx.translate(bomb.x, bomb.y);
    ctx.rotate(bomb.rotation);
    const urgency = clamp(1 - bomb.fuse / 1.55, 0, 1);
    ctx.shadowColor = urgency > .65 ? "#ff324d" : "#ff8a32";
    ctx.shadowBlur = 12 + urgency * 18;
    ctx.fillStyle = "#03050a";
    ctx.beginPath();
    ctx.arc(0, 0, bomb.radius + 5, 0, Math.PI * 2);
    ctx.fill();
    const gradient = ctx.createRadialGradient(-6, -7, 2, 0, 0, bomb.radius);
    gradient.addColorStop(0, "#738098");
    gradient.addColorStop(.35, "#263043");
    gradient.addColorStop(1, "#0c111d");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, bomb.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = urgency > .65 && Math.floor(bomb.fuse * 16) % 2 === 0 ? "#ffffff" : "#ff8a32";
    ctx.fillRect(-4, -bomb.radius - 10, 8, 13);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const p of state.particles) {
      const alpha = clamp(p.life / Math.max(.01, p.maxLife), 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.kind === "streak") {
        ctx.lineWidth = p.size;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * .045, p.y - p.vy * .045);
        ctx.stroke();
      } else if (p.kind === "debris") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .65);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const floater of state.floaters) {
      const alpha = clamp(floater.life / Math.min(.3, floater.maxLife), 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(2,4,10,.75)";
      const width = ctx.measureText(floater.text).width + 22;
      ctx.fillRect(floater.x - width / 2, floater.y - 22, width, 29);
      ctx.fillStyle = floater.color;
      ctx.font = "900 20px 'Arial Narrow', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(floater.text, floater.x, floater.y);
    }
    ctx.restore();
  }

  function drawHUD() {
    if (!state.fighters.length || state.mode === "menu") return;
    const positions = [26, 308, WORLD.w - 568, WORLD.w - 286];
    state.fighters.forEach((fighter, index) => {
      const x = positions[index];
      const y = 22;
      const w = 260;
      ctx.save();
      ctx.globalAlpha = fighter.lives > 0 ? 1 : .38;
      ctx.fillStyle = "rgba(3,7,16,.76)";
      roundRect(ctx, x, y, w, 70, 8);
      ctx.fill();
      ctx.fillStyle = fighter.color;
      ctx.fillRect(x, y, 5, 70);
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.beginPath();
      ctx.arc(x + 37, y + 29, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fighter.color;
      ctx.font = "900 17px 'Arial Narrow', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fighter.icon, x + 37, y + 30);
      ctx.textAlign = "left";
      ctx.fillStyle = "#eaf3ff";
      ctx.font = "900 17px 'Arial Narrow', sans-serif";
      ctx.fillText(fighter.name, x + 64, y + 21);
      ctx.fillStyle = "rgba(255,255,255,.1)";
      ctx.fillRect(x + 64, y + 34, 171, 10);
      ctx.fillStyle = fighter.health > 35 ? fighter.color : "#ff324d";
      ctx.fillRect(x + 64, y + 34, 171 * clamp(fighter.health / 100, 0, 1), 10);
      ctx.fillStyle = "#8392a8";
      ctx.font = "700 11px monospace";
      ctx.fillText(`${Math.ceil(fighter.health)} HP`, x + 64, y + 57);
      ctx.textAlign = "right";
      ctx.fillStyle = fighter.color;
      ctx.font = "900 15px 'Arial Narrow', sans-serif";
      ctx.fillText("●".repeat(Math.max(0, fighter.lives)), x + 235, y + 58);
      ctx.restore();
    });

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(3,7,16,.84)";
    roundRect(ctx, WORLD.w / 2 - 92, 18, 184, 84, 8);
    ctx.fill();
    ctx.fillStyle = state.matchTime <= 15 ? "#ff326f" : "#ffffff";
    ctx.font = "900 40px 'Arial Narrow', sans-serif";
    ctx.fillText(String(Math.max(0, Math.ceil(state.matchTime))).padStart(2, "0"), WORLD.w / 2, 57);
    ctx.fillStyle = state.stage.tint;
    ctx.font = "700 11px monospace";
      ctx.fillText(`LEVEL ${state.stage.index + 1} // ${state.stage.name}`, WORLD.w / 2, 81);
    ctx.restore();

    const player = state.fighters[0];
    if (player) {
      ctx.save();
      const x = WORLD.w / 2 - 175;
      const y = WORLD.h - 42;
      ctx.fillStyle = "rgba(3,7,16,.7)";
      ctx.fillRect(x, y, 350, 16);
      const gradient = ctx.createLinearGradient(x, 0, x + 350, 0);
      gradient.addColorStop(0, "#27e7ff");
      gradient.addColorStop(.72, "#b7ff3c");
      gradient.addColorStop(1, "#ffffff");
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 3, y + 3, 344 * clamp(player.signal / 100, 0, 1), 10);
      ctx.fillStyle = player.signal >= 100 ? "#b7ff3c" : "#b9c6d8";
      ctx.font = "700 11px monospace";
      ctx.textAlign = "center";
      const meterLabel = player.overdrive > 0 ? `★ STAR POWER ${player.overdrive.toFixed(1)}s` : player.signal >= 100 ? "SIGNAL SURGE READY" : `SIGNAL ${Math.floor(player.signal)}%`;
      ctx.fillStyle = player.overdrive > 0 ? "#fff36a" : player.signal >= 100 ? "#b7ff3c" : "#b9c6d8";
      ctx.fillText(meterLabel, WORLD.w / 2, y - 7);
      ctx.restore();
    }
  }

  function drawCountdown() {
    if (state.mode !== "countdown") return;
    const value = Math.ceil(state.countdown);
    const label = value > 3 ? "GET READY" : value > 0 ? String(value) : "FIGHT";
    ctx.save();
    ctx.translate(WORLD.w / 2, WORLD.h / 2 - 25);
    const pulse = 1 + Math.sin(state.countdown * Math.PI * 2) * .035;
    ctx.scale(pulse, pulse);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(2,4,10,.76)";
    ctx.fillRect(-190, -92, 380, 144);
    ctx.fillStyle = value === 1 ? "#b7ff3c" : "#ffffff";
    ctx.font = label.length > 3 ? "900 60px 'Arial Narrow', sans-serif" : "900 120px 'Arial Narrow', sans-serif";
    ctx.shadowColor = state.stage.tint;
    ctx.shadowBlur = 30;
    ctx.fillText(label, 0, 22);
    ctx.shadowBlur = 0;
    if (value > 0 && value <= 3) {
      ctx.fillStyle = "#8c9bb0";
      ctx.font = "700 13px monospace";
      ctx.fillText(isTouch ? "MOVE LEFT // JUMP + HIT RIGHT" : "A/D MOVE // W JUMP // J HIT // K HEAVY // L DASH", 0, 67);
    }
    ctx.restore();
  }

  function drawMenuFighters() {
    if (state.mode !== "menu") return;
    const t = performance.now() / 1000;
    const left = createFighter(0, 260 + Math.sin(t * .8) * 35, 640);
    const right = createFighter(1, 1340 + Math.sin(t * .7 + 2) * 32, 640);
    left.grounded = right.grounded = true;
    left.facing = 1;
    right.facing = -1;
    left.state = Math.sin(t * 1.5) > 0 ? "run" : "idle";
    right.state = "guard";
    left.anim = t;
    right.anim = t + 1;
    drawFighter(left, .66);
    drawFighter(right, .55);
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#02040a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const shakeX = state.shake > 0 ? rand(-state.shake, state.shake) : 0;
    const shakeY = state.shake > 0 ? rand(-state.shake * .55, state.shake * .55) : 0;
    ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, dpr * (viewX + shakeX), dpr * (viewY + shakeY));
    drawBackground();
    if (!state.stage) state.stage = createStage(state.stageIndex);
    for (const platform of state.stage.platforms) drawPlatform(platform);
    drawHazards();
    for (const pickup of state.pickups) drawPickup(pickup);
    for (const fighter of state.fighters) drawFighter(fighter);
    drawMenuFighters();
    for (const shot of state.projectiles) drawProjectile(shot);
    for (const bomb of state.bombs) drawBomb(bomb);
    drawParticles();

    // The HUD and the countdown are chrome, not part of the arena, so they are
    // drawn on the steady transform. Inside the shake they juddered with every
    // hit and — because the fighter cards sit 22px from the top of the world —
    // an upward shake clipped their top edge against the canvas.
    ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, dpr * viewX, dpr * viewY);
    drawHUD();
    drawCountdown();

    ctx.save();
    const vignette = ctx.createRadialGradient(WORLD.w / 2, WORLD.h / 2, 320, WORLD.w / 2, WORLD.h / 2, 920);
    vignette.addColorStop(.45, "transparent");
    vignette.addColorStop(1, "rgba(0,0,0,.56)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    if (state.flash > 0) {
      ctx.globalAlpha = state.flash * .5;
      ctx.fillStyle = state.suddenDeath ? "#ff326f" : "#ffffff";
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    }
    ctx.restore();
  }

  function frame(now) {
    let elapsed = Math.min((now - lastFrame) / 1000, .1);
    if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
    lastFrame = now;
    accumulator += elapsed;
    let loops = 0;
    while (accumulator >= STEP && loops < MAX_CATCHUP) {
      updateGame(STEP);
      accumulator -= STEP;
      loops += 1;
    }
    if (loops === MAX_CATCHUP) accumulator = 0;
    render();
    requestAnimationFrame(frame);
  }

  function keyMatches(code) {
    return ["KeyA", "KeyD", "KeyW", "KeyS", "KeyJ", "KeyK", "KeyL", "Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "ShiftLeft", "ShiftRight", "Escape", "KeyP"].includes(code);
  }

  window.addEventListener("keydown", (event) => {
    if (keyMatches(event.code)) event.preventDefault();
    if (event.repeat) { input.keys.add(event.code); return; }
    input.keys.add(event.code);
    if (event.code === "KeyW" || event.code === "ArrowUp" || event.code === "Space") input.jumpPressed = true;
    if (event.code === "KeyJ") input.attackPressed = true;
    if (event.code === "KeyK") input.heavyPressed = true;
    if (event.code === "KeyL") input.dashPressed = true;
    if (event.code === "KeyS" || event.code === "ArrowDown") input.dropPressed = true;
    if (event.code === "Escape" || event.code === "KeyP") {
      if (state.mode === "paused") resumeGame(); else pauseGame();
    }
  }, { passive: false });

  window.addEventListener("keyup", (event) => {
    input.keys.delete(event.code);
  });

  function releasePointer(pointerId) {
    if (input.joystickPointer === pointerId) {
      input.joystickPointer = null;
      input.moveTouch = 0;
      input.moveTouchY = 0;
      joystick.classList.remove("active");
      joystickKnob.style.transform = "translate(0px, 0px)";
    }
    if (input.jumpPointer === pointerId) {
      input.jumpPointer = null;
      jumpButton.classList.remove("pressed");
    }
    if (input.dashPointer === pointerId) {
      input.dashPointer = null;
      input.touchDashHeld = false;
      input.touchDashTime = 0;
      dashButton.classList.remove("pressed");
    }
    if (input.attackPointer === pointerId) {
      if (input.touchAttackHeld && !input.touchHeavyFired) input.attackPressed = true;
      input.attackPointer = null;
      input.touchAttackHeld = false;
      input.touchAttackTime = 0;
      input.touchHeavyFired = false;
      attackButton.classList.remove("pressed");
      attackButton.querySelector("small").textContent = "HOLD";
    }
  }

  joystick.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (input.joystickPointer !== null) return;
    input.joystickPointer = event.pointerId;
    joystick.setPointerCapture?.(event.pointerId);
    joystick.classList.add("active");
    updateJoystick(event);
  });

  joystick.addEventListener("pointermove", (event) => {
    if (event.pointerId === input.joystickPointer) updateJoystick(event);
  });

  function updateJoystick(event) {
    const rect = joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const max = rect.width * .31;
    let dx = event.clientX - centerX;
    let dy = event.clientY - centerY;
    const length = Math.hypot(dx, dy);
    if (length > max) { dx = dx / length * max; dy = dy / length * max; }
    input.moveTouch = Math.abs(dx / max) < .12 ? 0 : clamp(dx / max, -1, 1);
    input.moveTouchY = Math.abs(dy / max) < .12 ? 0 : clamp(dy / max, -1, 1);
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  [joystick, jumpButton, attackButton, dashButton].forEach((node) => {
    node.addEventListener("pointerup", (event) => releasePointer(event.pointerId));
    node.addEventListener("pointercancel", (event) => releasePointer(event.pointerId));
    node.addEventListener("lostpointercapture", (event) => releasePointer(event.pointerId));
  });

  jumpButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (input.jumpPointer !== null) return;
    input.jumpPointer = event.pointerId;
    jumpButton.setPointerCapture?.(event.pointerId);
    jumpButton.classList.add("pressed");
    input.jumpPressed = true;
    audio.unlock();
  });

  attackButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (input.attackPointer !== null) return;
    input.attackPointer = event.pointerId;
    attackButton.setPointerCapture?.(event.pointerId);
    attackButton.classList.add("pressed");
    input.touchAttackHeld = true;
    input.touchAttackTime = 0;
    input.touchHeavyFired = false;
    audio.unlock();
  });

  dashButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (input.dashPointer !== null) return;
    input.dashPointer = event.pointerId;
    dashButton.setPointerCapture?.(event.pointerId);
    dashButton.classList.add("pressed");
    input.dashPressed = true;
    input.touchDashHeld = true;
    input.touchDashTime = 0;
    audio.unlock();
  });

  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    const value = Number(button.dataset.difficulty);
    button.addEventListener("click", () => {
      state.difficulty = value;
      safeWrite("signalBrawlDifficulty", value);
      refreshDifficulty();
      audio.unlock();
      audio.sfx("pickup");
    });
  });

  levelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const level = Number(button.dataset.level);
      if (level > state.unlockedLevel) return;
      state.stageIndex = level;
      state.stage = createStage(level);
      safeWrite("signalBrawlSelected", level);
      refreshLevelSelect();
      audio.unlock();
      audio.sfx("pickup");
    });
  });

  playButton.addEventListener("click", () => startMatch(false));
  rematchButton.addEventListener("click", () => startMatch(state.lastWin && state.stageIndex < state.unlockedLevel));
  backMenuButton.addEventListener("click", openMenu);
  pauseButton.addEventListener("click", pauseGame);
  resumeButton.addEventListener("click", resumeGame);
  restartButton.addEventListener("click", () => startMatch(false));
  soundButton.addEventListener("click", () => {
    state.muted = !state.muted;
    safeWrite("signalBrawlMuted", state.muted ? 1 : 0);
    refreshSoundButton();
    if (!state.muted) { audio.unlock(); audio.sfx("pickup"); }
  });

  window.addEventListener("blur", () => {
    if (state.mode === "playing" || state.mode === "countdown") pauseGame();
    resetInputs();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (state.mode === "playing" || state.mode === "countdown")) pauseGame();
    resetInputs();
    lastFrame = performance.now();
    accumulator = 0;
  });
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));
  document.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });

  function refreshDifficulty() {
    document.querySelectorAll("[data-difficulty]").forEach((node) => {
      node.classList.toggle("selected", Number(node.dataset.difficulty) === state.difficulty);
    });
  }

  function refreshSoundButton() {
    soundButton.textContent = state.muted ? "×" : "♪";
    soundButton.setAttribute("aria-label", state.muted ? "Unmute sound" : "Mute sound");
  }

  // A host that keeps the save for us answers after the menu has already drawn.
  // Only the menu is re-applied: arriving mid-match must not move the player to
  // a different level or change the difficulty they are already fighting.
  save.onHydrate(() => {
    state.unlockedLevel = Math.max(0, Math.min(STAGE_NAMES.length - 1, Number(safeRead("signalBrawlUnlocked", 0)) || 0));
    state.streak = Number(safeRead("signalBrawlStreak", 0)) || 0;
    state.bestStreak = Number(safeRead("signalBrawlBest", 0)) || 0;
    state.muted = safeRead("signalBrawlMuted", "0") === "1";
    refreshSoundButton();
    refreshBestStreak();

    if (state.mode !== "menu") return;
    state.difficulty = Math.max(0, Math.min(2, Number(safeRead("signalBrawlDifficulty", 1)) || 0));
    const selected = Math.max(0, Math.min(state.unlockedLevel, Number(safeRead("signalBrawlSelected", 0)) || 0));
    if (selected !== state.stageIndex) {
      state.stageIndex = selected;
      state.stage = createStage(selected);
    }
    refreshDifficulty();
    refreshLevelSelect();
  });

  state.stage = createStage(state.stageIndex);
  refreshSoundButton();
  refreshDifficulty();
  refreshBestStreak();
  refreshLevelSelect();
  resizeCanvas();
  requestAnimationFrame(frame);
})();
