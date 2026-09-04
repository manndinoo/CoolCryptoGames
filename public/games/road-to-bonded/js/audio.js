'use strict';
/* Original synthesized terminal/arcade audio. No samples, no external files. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  let ctx = null, master = null, musicGain = null, sfxGain = null, musicTimer = null, musicOn = false, soundOn = true, hapticOn = true;
  let unlocked = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfxGain = ctx.createGain(); sfxGain.gain.value = soundOn ? 1 : 0; sfxGain.connect(master);
      musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
      return true;
    } catch { return false; }
  }
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    unlocked = true;
    if (musicOn && !musicTimer) startMusic();
  }

  function tone(freq, t0, dur, type, vol, dest, slideTo) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfxGain); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(t0, dur, vol, hp) {
    const len = Math.floor(ctx.sampleRate * dur); const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource(); s.buffer = buf; const g = ctx.createGain(); g.gain.value = vol;
    const f = ctx.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.frequency.value = hp ? 2500 : 900;
    s.connect(f); f.connect(g); g.connect(sfxGain); s.start(t0);
  }

  const SFX = {
    click() { const t = ctx.currentTime; tone(880, t, 0.05, 'square', 0.05); },
    swap() { const t = ctx.currentTime; tone(520, t, 0.07, 'triangle', 0.12, null, 700); },
    invalid() { const t = ctx.currentTime; tone(220, t, 0.12, 'square', 0.08, null, 160); tone(160, t + 0.08, 0.12, 'square', 0.06); },
    match(n) { const t = ctx.currentTime; const base = 660 + Math.min(n || 3, 8) * 40; tone(base, t, 0.09, 'triangle', 0.14, null, base * 1.25); tone(base * 2, t + 0.02, 0.06, 'sine', 0.06); },
    cascade(pass) { const t = ctx.currentTime; const f = 520 * Math.pow(1.19, Math.min(pass, 8)); tone(f, t, 0.12, 'triangle', 0.14, null, f * 1.5); tone(f * 1.5, t + 0.06, 0.12, 'sine', 0.09); },
    special() { const t = ctx.currentTime; tone(140, t, 0.25, 'sawtooth', 0.16, null, 60); tone(880, t, 0.18, 'square', 0.06, null, 1760); noise(t, 0.2, 0.12, true); },
    combo() { const t = ctx.currentTime; tone(90, t, 0.4, 'sawtooth', 0.2, null, 45); tone(600, t, 0.3, 'square', 0.07, null, 2400); noise(t, 0.35, 0.18, false); },
    create() { const t = ctx.currentTime; tone(440, t, 0.1, 'sine', 0.1, null, 880); tone(880, t + 0.08, 0.15, 'sine', 0.1, null, 1320); },
    bonded() {
      const t = ctx.currentTime;
      tone(55, t, 0.9, 'sawtooth', 0.28, null, 30); tone(110, t, 0.6, 'square', 0.1, null, 55);
      for (let i = 0; i < 6; i++) tone(440 * Math.pow(1.335, i), t + 0.05 + i * 0.05, 0.25, 'triangle', 0.09);
      noise(t + 0.1, 0.5, 0.2, true); tone(1760, t + 0.4, 0.4, 'sine', 0.1, null, 3520);
    },
    rocket() { const t = ctx.currentTime; tone(300, t, 0.25, 'sawtooth', 0.09, null, 1400); noise(t, 0.2, 0.08, true); },
    capsule() { const t = ctx.currentTime; tone(523, t, 0.12, 'sine', 0.14); tone(659, t + 0.1, 0.12, 'sine', 0.14); tone(784, t + 0.2, 0.25, 'sine', 0.16); },
    key() { const t = ctx.currentTime; tone(1046, t, 0.1, 'triangle', 0.12); tone(1568, t + 0.09, 0.2, 'triangle', 0.12); },
    gate() { const t = ctx.currentTime; tone(200, t, 0.3, 'square', 0.08, null, 400); tone(400, t + 0.2, 0.3, 'triangle', 0.1, null, 800); },
    hit() { const t = ctx.currentTime; tone(180, t, 0.08, 'square', 0.1, null, 120); noise(t, 0.08, 0.1, false); },
    print() { const t = ctx.currentTime; for (let i = 0; i < 3; i++) tone(1200, t + i * 0.05, 0.03, 'square', 0.06); tone(150, t + 0.15, 0.15, 'square', 0.1, null, 100); },
    fud() { const t = ctx.currentTime; tone(160, t, 0.4, 'sine', 0.12, null, 90); noise(t, 0.4, 0.06, false); },
    reset() { const t = ctx.currentTime; for (let i = 0; i < 5; i++) tone(400 + i * 120, t + i * 0.06, 0.08, 'triangle', 0.08); },
    win() { const t = ctx.currentTime; [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.09, 0.35, 'triangle', 0.14)); tone(65, t, 0.8, 'sawtooth', 0.14, null, 40); },
    lose() { const t = ctx.currentTime; [440, 392, 330, 262].forEach((f, i) => tone(f, t + i * 0.16, 0.3, 'square', 0.08)); },
    dip() { const t = ctx.currentTime; tone(320, t, 0.35, 'sawtooth', 0.12, null, 90); tone(160, t + 0.05, 0.4, 'square', 0.08, null, 60); noise(t, 0.3, 0.12, false); },
    bonus() { const t = ctx.currentTime; [660, 880, 1320, 1760].forEach((f, i) => tone(f, t + i * 0.07, 0.25, 'triangle', 0.12)); },
    life() { const t = ctx.currentTime; [523, 784, 1046].forEach((f, i) => tone(f, t + i * 0.1, 0.35, 'sine', 0.14)); },
    lane() { const t = ctx.currentTime; tone(300, t, 0.12, 'triangle', 0.08, null, 450); },
    portal() { const t = ctx.currentTime; tone(700, t, 0.2, 'sine', 0.08, null, 1400); },
    milestone() { const t = ctx.currentTime; [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, t + i * 0.12, 0.6, 'triangle', 0.12)); tone(52, t, 1.4, 'sawtooth', 0.16, null, 30); },
  };

  /* ---------- Generative soundtrack ----------
     A 16th-note step sequencer scheduled ahead of time. The track runs through
     sections (INTRO, GROOVE, LEAD, BREAK, DROP, OUTRO) of 8 bars each, then
     re-rolls its melodic seed so no two cycles repeat; each map region has its
     own key, tempo and instrument mix. */
  const SECTIONS = ['intro', 'groove', 'lead', 'drop', 'break', 'drop2', 'lead2', 'outro'];
  const PROGS = [[0, -4, -7, -2], [0, 5, 3, -2], [0, -2, -4, -7], [0, 3, 5, 7]]; // semitone roots per bar relative to key
  const REGION = {
    title: { key: 45, bpm: 108, mode: 'minor', hats: 0.5, kick: 0.6, lead: 'triangle' },
    lab: { key: 48, bpm: 112, mode: 'major', hats: 0.45, kick: 0.5, lead: 'triangle' },
    climb: { key: 43, bpm: 118, mode: 'minor', hats: 0.6, kick: 0.7, lead: 'square' },
    junction: { key: 41, bpm: 122, mode: 'minor', hats: 0.8, kick: 0.8, lead: 'sawtooth' },
    city: { key: 46, bpm: 126, mode: 'minor', hats: 0.9, kick: 0.9, lead: 'square' },
    orbit: { key: 40, bpm: 104, mode: 'minor', hats: 0.35, kick: 0.5, lead: 'sine' },
  };
  const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11] };
  let region = 'title', mus = null;
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function rand(state) { state.s = (state.s * 1664525 + 1013904223) >>> 0; return state.s / 4294967296; }
  function buildBus() {
    if (mus) return;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(musicGain);
    const delay = ctx.createDelay(1.0); const fb = ctx.createGain(); fb.gain.value = 0.32; const dfilter = ctx.createBiquadFilter(); dfilter.type = 'lowpass'; dfilter.frequency.value = 2200;
    delay.connect(dfilter); dfilter.connect(fb); fb.connect(delay); const dOut = ctx.createGain(); dOut.gain.value = 0.35; dfilter.connect(dOut); dOut.connect(comp);
    const padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 900; padFilter.Q.value = 0.8; padFilter.connect(comp);
    mus = { comp, delay, padFilter, step: 0, next: 0, seed: { s: 7 }, cycle: 0, melody: [], timer: null };
  }
  function regen() {
    const st = mus.seed; st.s = (st.s + 7919 * (mus.cycle + 1)) >>> 0; const scale = SCALES[REGION[region].mode];
    mus.melody = []; let deg = 4;
    for (let i = 0; i < 64; i++) { const r = rand(st); if (r < 0.28) mus.melody.push(null); else { deg += r < 0.5 ? -1 : r < 0.72 ? 1 : r < 0.85 ? 2 : -2; deg = Math.max(0, Math.min(13, deg)); mus.melody.push(scale[deg % 7] + 12 * Math.floor(deg / 7)); } }
    mus.prog = PROGS[mus.cycle % PROGS.length];
  }
  function voice(type, freq, t0, dur, vol, dest, opts) {
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (opts && opts.detune) o.detune.value = opts.detune;
    const a = (opts && opts.attack) || 0.01;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function drum(kind, t0, vol) {
    if (kind === 'kick') { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(42, t0 + 0.12); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28); o.connect(g); g.connect(mus.comp); o.start(t0); o.stop(t0 + 0.3); return; }
    const len = Math.floor(ctx.sampleRate * (kind === 'snare' ? 0.18 : 0.05)); const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, kind === 'snare' ? 1.5 : 3);
    const s = ctx.createBufferSource(); s.buffer = buf; const f = ctx.createBiquadFilter(); f.type = kind === 'snare' ? 'bandpass' : 'highpass'; f.frequency.value = kind === 'snare' ? 1800 : 7000; const g = ctx.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(mus.comp); s.start(t0);
    if (kind === 'snare') voice('triangle', 190, t0, 0.12, vol * 0.6, mus.comp);
  }
  function scheduleStep(step, t) {
    const R = REGION[region]; const bar = Math.floor(step / 16); const inBar = step % 16; const section = SECTIONS[Math.floor(bar / 8) % SECTIONS.length];
    const root = R.key + mus.prog[bar % 4]; const scale = SCALES[R.mode]; const beatLen = 60 / R.bpm;
    const full = section === 'drop' || section === 'drop2'; const quiet = section === 'intro' || section === 'break' || section === 'outro';
    // drums
    if (!quiet || (section === 'break' && inBar % 4 === 2)) {
      if (inBar % 4 === 0 && !quiet) drum('kick', t, 0.5 * R.kick);
      if (full && inBar === 10) drum('kick', t, 0.35 * R.kick);
      if ((inBar === 4 || inBar === 12) && !quiet) drum('snare', t, 0.22);
      if (inBar % 2 === 1 && (full || Math.random() < R.hats)) drum('hat', t, full && inBar % 4 === 3 ? 0.12 : 0.07);
      if (section === 'break' && inBar % 4 === 2) drum('snare', t, 0.12 + 0.02 * bar);
    }
    // bass
    if (section !== 'intro' && section !== 'break' && (inBar % 4 === 0 || (full && (inBar === 6 || inBar === 11)) || (section.startsWith('lead') && inBar === 8))) {
      const n = root - 24 + (inBar === 11 ? scale[4] : 0); const g = ctx.createGain(); g.gain.value = 1; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + 0.25); f.connect(mus.comp); g.connect(f);
      voice('sawtooth', midi(n), t, beatLen * 0.9, 0.16, g); voice('square', midi(n - 12), t, beatLen * 0.9, 0.06, g);
    }
    // pad chords once per bar
    if (inBar === 0) {
      const chord = [0, scale[2], scale[4], 12].map(iv => root + iv); const dur = beatLen * 4 * 0.98;
      mus.padFilter.frequency.setTargetAtTime(quiet ? 700 : full ? 2400 : 1300, t, 0.6);
      for (const n of chord) { voice('sawtooth', midi(n), t, dur, 0.035, mus.padFilter, { detune: -6, attack: 0.6 }); voice('sawtooth', midi(n), t, dur, 0.035, mus.padFilter, { detune: 6, attack: 0.6 }); }
      if (quiet) voice('sine', midi(root - 12), t, dur, 0.08, mus.comp, { attack: 0.8 });
    }
    // lead / arp
    const leadOn = section.startsWith('lead') || full || section === 'outro';
    if (leadOn && (full ? inBar % 2 === 0 : inBar % 2 === 0)) {
      const m = mus.melody[(bar * 16 + inBar) % 64]; if (m !== null) { const n = root + 12 + m; voice(R.lead, midi(n), t, beatLen * (full ? 0.45 : 0.6), full ? 0.06 : 0.05, mus.delay); voice(R.lead, midi(n), t, beatLen * 0.4, 0.03, mus.comp); }
    } else if (section === 'groove' && inBar % 4 === 2) { const n = root + 12 + scale[(bar + inBar) % 7]; voice('triangle', midi(n), t, beatLen * 0.5, 0.04, mus.delay); }
    // sparkle ticks
    if ((full || section === 'groove') && inBar % 8 === 6) voice('square', midi(root + 36), t, 0.05, 0.012, mus.comp);
    if (step % (16 * 8 * SECTIONS.length) === 16 * 8 * SECTIONS.length - 1) { mus.cycle++; regen(); }
  }
  function scheduleMusic() {
    if (!ctx || !musicOn || !mus) return;
    const R = REGION[region]; const stepLen = 60 / R.bpm / 4; const horizon = ctx.currentTime + 0.35;
    if (mus.next < ctx.currentTime - 1) mus.next = ctx.currentTime + 0.05;
    while (mus.next < horizon) { scheduleStep(mus.step, mus.next); mus.step++; mus.next += stepLen; }
  }
  function startMusic() {
    if (!ensure() || !unlocked) return;
    if (musicTimer) return;
    buildBus(); if (!mus.prog) regen();
    mus.next = ctx.currentTime + 0.1;
    musicGain.gain.cancelScheduledValues(ctx.currentTime); musicGain.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    musicTimer = setInterval(scheduleMusic, 120);
  }
  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (musicGain) musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  }
  function setRegion(r) {
    if (!REGION[r] || r === region) return; region = r;
    if (mus) { const bars = Math.floor(mus.step / 16); mus.step = (bars + 1) * 16; regen(); }
  }

  RTB.Audio = {
    unlock,
    play(name, arg) { if (!soundOn || !ctx || !unlocked) return; try { if (ctx.state === 'suspended') ctx.resume(); SFX[name] && SFX[name](arg); } catch { /* ignore */ } },
    setSound(on) { soundOn = on; if (sfxGain) sfxGain.gain.value = on ? 1 : 0; },
    setMusic(on) { musicOn = on; if (on) startMusic(); else stopMusic(); },
    setRegion,
    setHaptic(on) { hapticOn = on; },
    haptic(pattern) { if (!hapticOn || !unlocked) return; try { const ua = navigator.userActivation; if (ua && !ua.hasBeenActive) return; if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ } },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    resume() { if (ctx && unlocked && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
  };
})();
