'use strict';
/* Versioned local persistence with a last-known-good backup. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  const KEY = 'rtb.save.v1', BACKUP = 'rtb.save.v1.backup';
  const VERSION = 1;

  function defaults() {
    return {
      v: VERSION, unlocked: 1, levels: {}, tutorials: {}, attempts: {},
      settings: { sound: true, music: true, haptic: true, motion: false, fx: 2, dark: false },
      run: null, campaignDone: false, milestones: {}, lives: 5, livesAt: Date.now(), streak: 0, best: 0, rank: 0, purchases: [],
    };
  }
  function valid(d) {
    return d && typeof d === 'object' && d.v === VERSION && typeof d.unlocked === 'number' && d.unlocked >= 1 && d.unlocked <= 50 && d.levels && typeof d.levels === 'object' && d.settings && typeof d.settings === 'object';
  }
  function readKey(k) {
    try { const raw = localStorage.getItem(k); if (!raw) return null; const d = JSON.parse(raw); return valid(d) ? d : null; } catch { return null; }
  }
  const Save = {
    data: null,
    load() {
      let d = readKey(KEY);
      if (!d) { d = readKey(BACKUP); if (d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ } } }
      if (!d) d = defaults();
      const base = defaults();
      d.settings = Object.assign(base.settings, d.settings);
      d.levels = d.levels || {}; d.tutorials = d.tutorials || {}; d.attempts = d.attempts || {}; d.milestones = d.milestones || {};
      if (d.run && (!d.run.st || !d.run.levelId || !RTB.levelById(d.run.levelId))) d.run = null;
      if (typeof d.lives !== 'number') { d.lives = 5; d.livesAt = Date.now(); }
      if (typeof d.streak !== 'number') d.streak = 0;
      if (typeof d.rank !== 'number') d.rank = 0; if (!Array.isArray(d.purchases)) d.purchases = [];
      Save.data = d;
      return d;
    },
    commit() {
      try {
        const cur = localStorage.getItem(KEY);
        const next = JSON.stringify(Save.data);
        if (cur && cur !== next) localStorage.setItem(BACKUP, cur);
        localStorage.setItem(KEY, next);
      } catch { /* storage unavailable: play continues in memory */ }
    },
    reset() { Save.data = defaults(); try { localStorage.removeItem(KEY); localStorage.removeItem(BACKUP); } catch { /* ignore */ } Save.commit(); },
    MAX_LIVES: 5, REGEN_MS: 6 * 60 * 60 * 1000,
    /* Apply time-based regeneration and return current lives. */
    lives() {
      const d = Save.data; const now = Date.now();
      if (d.lives >= Save.MAX_LIVES) { d.livesAt = now; return d.lives; }
      while (d.lives < Save.MAX_LIVES && now - d.livesAt >= Save.REGEN_MS) { d.lives++; d.livesAt += Save.REGEN_MS; }
      if (d.lives >= Save.MAX_LIVES) d.livesAt = now;
      return d.lives;
    },
    nextLifeMs() { const d = Save.data; if (d.lives >= Save.MAX_LIVES) return 0; return Math.max(0, Save.REGEN_MS - (Date.now() - d.livesAt)); },
    loseLife() { Save.lives(); const d = Save.data; if (d.lives >= Save.MAX_LIVES) d.livesAt = Date.now(); d.lives = Math.max(0, d.lives - 1); d.streak = 0; Save.commit(); },
    /* Purchased lives can exceed the regen cap. */
    addLives(n, receipt) { Save.lives(); const d = Save.data; d.lives += n; if (receipt) d.purchases.push(Object.assign({ at: Date.now() }, receipt)); Save.commit(); },
    /* Rank points from bonus levels: only improvements over the best score count. */
    bankRank(id, score) { const L = Save.data.levels[id] || { grade: 0, best: 0, wins: 0 }; const before = Math.floor((L.best || 0) / 50); const after = Math.floor(Math.max(L.best || 0, score) / 50); L.best = Math.max(L.best || 0, score); Save.data.levels[id] = L; const gained = Math.max(0, after - before); Save.data.rank += gained; Save.commit(); return gained; },
    /* Returns true when the streak just earned a bonus life. */
    winStreak() { const d = Save.data; d.streak = (d.streak || 0) + 1; d.best = Math.max(d.best || 0, d.streak); let bonus = false; if (d.streak % 3 === 0 && Save.lives() < Save.MAX_LIVES) { d.lives++; bonus = true; } Save.commit(); return bonus; },
    gradeOf(id) { const L = Save.data.levels[id]; return L ? L.grade : 0; },
    bestOf(id) { const L = Save.data.levels[id]; return L ? L.best : 0; },
    recordWin(id, score, grade) {
      const L = Save.data.levels[id] || { grade: 0, best: 0, wins: 0 };
      L.grade = Math.max(L.grade, grade); L.best = Math.max(L.best, score); L.wins = (L.wins || 0) + 1;
      Save.data.levels[id] = L;
      if (id === Save.data.unlocked && id < (RTB.MAX_LEVEL || 50)) Save.data.unlocked = id + 1;
      if (id === (RTB.CONFIG ? RTB.CONFIG.releasedLevels : 50)) Save.data.campaignDone = true;
      Save.commit();
    },
  };
  RTB.Save = Save;
})();
