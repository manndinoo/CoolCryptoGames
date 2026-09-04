'use strict';
/* Procedural artwork for every board element. Nothing here is an image file
   except the BONDED pill reference (assets/pill.png), which is also
   reproduced as a vector for crisp scaling. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  const TAU = Math.PI * 2;
  const OUT = '#12302c';

  const SYM = [
    { name: 'MINT CORE', main: '#3fd987', dark: '#1d8a58', light: '#b8ffd6' },
    { name: 'LIQUIDITY DROP', main: '#29c8ef', dark: '#127ea0', light: '#c9f4ff' },
    { name: 'HOLDER SHIELD', main: '#3b82f6', dark: '#1e4fb5', light: '#c7dcff' },
    { name: 'SIGNAL PULSE', main: '#9b6cff', dark: '#5b34b8', light: '#e2d4ff' },
    { name: 'VOLUME BOLT', main: '#f2b418', dark: '#b3760a', light: '#fff0b8' },
    { name: 'LAUNCH SPARK', main: '#ff6b5b', dark: '#b8362b', light: '#ffd3cc' },
  ];
  const PORTAL_COLORS = ['#29c8ef', '#ff8ac2', '#f2b418', '#9b6cff', '#3fd987', '#ff6b5b'];

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function poly(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); }
  function hexPts(cx, cy, r, rot) { const p = []; for (let i = 0; i < 6; i++) { const a = rot + i * TAU / 6; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return p; }
  function starPts(cx, cy, ro, ri, n, rot) { const p = []; for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n; const r = i % 2 ? ri : ro; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return p; }

  function gloss(ctx, cx, cy, r) {
    ctx.save(); ctx.globalAlpha = 0.55;
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, 0, cx - r * 0.35, cy - r * 0.45, r * 0.8);
    g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.restore();
  }

  const shapePath = {
    0(ctx, cx, cy, r) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); },
    1(ctx, cx, cy, r) { ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.05); ctx.bezierCurveTo(cx + r * 0.25, cy - r * 0.5, cx + r, cy - r * 0.2, cx + r, cy + r * 0.25); ctx.arc(cx, cy + r * 0.25, r, 0, Math.PI, false); ctx.bezierCurveTo(cx - r, cy - r * 0.2, cx - r * 0.25, cy - r * 0.5, cx, cy - r * 1.05); ctx.closePath(); },
    2(ctx, cx, cy, r) { poly(ctx, [[cx - r * 0.95, cy - r * 0.75], [cx + r * 0.95, cy - r * 0.75], [cx + r * 0.95, cy + r * 0.15], [cx, cy + r * 1.05], [cx - r * 0.95, cy + r * 0.15]]); },
    3(ctx, cx, cy, r) { poly(ctx, [[cx, cy - r * 1.05], [cx + r * 0.95, cy], [cx, cy + r * 1.05], [cx - r * 0.95, cy]]); },
    4(ctx, cx, cy, r) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); },
    5(ctx, cx, cy, r) { poly(ctx, starPts(cx, cy, r * 1.08, r * 0.42, 4, -Math.PI / 2)); },
  };

  /* Market chips: thick enamel tokens with a coloured halo, rim light, embossed glyph and a hard specular. */
  function chip(ctx, s, x, y, size) {
    const col = SYM[s]; const cx = x + size / 2, cy = y + size / 2; const r = size * 0.39; const lw = Math.max(1.6, size * 0.07);
    ctx.save();
    // halo + drop shadow
    ctx.save(); ctx.globalAlpha = 0.55; ctx.shadowColor = col.main; ctx.shadowBlur = size * 0.16; shapePath[s](ctx, cx, cy, r); ctx.fillStyle = col.main; ctx.fill(); ctx.restore();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = size * 0.07; ctx.shadowOffsetY = size * 0.06;
    shapePath[s](ctx, cx, cy, r);
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.05, cx, cy, r * 1.15);
    g.addColorStop(0, col.light); g.addColorStop(0.42, col.main); g.addColorStop(1, col.dark);
    ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.lineJoin = 'round'; ctx.stroke();
    // rim light (upper-left) and shade (lower-right) inside the outline
    ctx.save(); shapePath[s](ctx, cx, cy, r); ctx.clip();
    ctx.lineWidth = lw * 0.9; ctx.strokeStyle = 'rgba(255,255,255,.55)'; shapePath[s](ctx, cx + lw * 0.5, cy + lw * 0.55, r - lw * 0.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; shapePath[s](ctx, cx - lw * 0.55, cy - lw * 0.6, r - lw * 0.2); ctx.stroke();
    ctx.restore();
    // embossed glyph: dark ink with a light offset
    const glyph = (fillStyle, dx, dy) => {
      ctx.save(); ctx.translate(dx, dy); ctx.fillStyle = fillStyle; ctx.strokeStyle = fillStyle; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lw * 0.85;
      if (s === 0) { ctx.beginPath(); ctx.arc(cx, cy, r * 0.56, 0, TAU); ctx.stroke(); rr(ctx, cx - r * 0.17, cy - r * 1.02, r * 0.34, r * 0.5, r * 0.08); ctx.fill(); ctx.beginPath(); ctx.arc(cx, cy, r * 0.2, 0, TAU); ctx.fill(); }
      else if (s === 1) { ctx.beginPath(); for (let i = 0; i <= 8; i++) { const px = cx - r * 0.6 + i * r * 0.15; const py = cy + r * 0.38 + Math.sin(i * 1.3) * r * 0.15; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy - r * 0.05, r * 0.16, 0, TAU); ctx.fill(); }
      else if (s === 2) { poly(ctx, [[cx - r * 0.58, cy - r * 0.45], [cx + r * 0.58, cy - r * 0.45], [cx + r * 0.58, cy + r * 0.05], [cx, cy + r * 0.62], [cx - r * 0.58, cy + r * 0.05]]); ctx.stroke(); rr(ctx, cx - r * 0.1, cy - r * 0.25, r * 0.2, r * 0.58, r * 0.1); ctx.fill(); }
      else if (s === 3) { ctx.beginPath(); ctx.arc(cx, cy + r * 0.12, r * 0.56, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy + r * 0.12, r * 0.3, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy + r * 0.14, r * 0.14, 0, TAU); ctx.fill(); }
      else if (s === 4) { poly(ctx, [[cx + r * 0.14, cy - r * 0.66], [cx - r * 0.36, cy + r * 0.08], [cx - r * 0.02, cy + r * 0.08], [cx - r * 0.18, cy + r * 0.66], [cx + r * 0.36, cy - r * 0.1], [cx + r * 0.02, cy - r * 0.1]]); ctx.fill(); }
      else if (s === 5) { ctx.beginPath(); ctx.arc(cx, cy, r * 0.2, 0, TAU); ctx.fill(); ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.86); ctx.lineTo(cx, cy - r * 0.4); ctx.stroke(); }
      ctx.restore();
    };
    glyph('rgba(255,255,255,.5)', 0, lw * 0.45); glyph(OUT, 0, 0);
    // hard specular + soft gloss
    gloss(ctx, cx, cy, r * 0.95);
    ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = '#fff'; ctx.translate(cx - r * 0.42, cy - r * 0.5); ctx.rotate(-0.7); ctx.beginPath(); ctx.ellipse(0, 0, r * 0.22, r * 0.09, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.7; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx + r * 0.3, cy - r * 0.62, r * 0.05, 0, TAU); ctx.fill(); ctx.restore();
    ctx.restore();
  }

  /* The BONDED pill as a board piece: floats, pulses, sheds mint light. */
  function pillPiece(ctx, x, y, size, t) {
    t = t || 0; const cx = x + size / 2, cy = y + size / 2 + Math.sin(t / 320) * size * 0.03;
    const pulse = 0.6 + 0.4 * Math.sin(t / 240);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.25 * pulse; ctx.fillStyle = '#3fd987'; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = size * 0.3; ctx.beginPath(); ctx.arc(cx, cy, size * 0.36, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1; ctx.shadowColor = 'transparent';
    // orbiting ticks
    for (let i = 0; i < 6; i++) { const a = t / 500 + i * TAU / 6; ctx.fillStyle = i % 2 ? '#7dffbb' : '#ffffff'; ctx.globalAlpha = 0.7; ctx.fillRect(cx + Math.cos(a) * size * 0.42 - 1.5, cy + Math.sin(a) * size * 0.42 - 3, 3, 6); }
    ctx.globalAlpha = 1;
    pill(ctx, x + size * 0.08, cy - size * 0.42, size * 0.84, t, { glow: 0.6 + 0.4 * pulse, rot: Math.sin(t / 700) * 0.12 });
    ctx.restore();
  }

  function glowRing(ctx, cx, cy, r, color, alpha) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.shadowColor = color; ctx.shadowBlur = r * 0.6; ctx.strokeStyle = color; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); ctx.restore();
  }

  function special(ctx, kind, s, x, y, size, t) {
    t = t || 0; const cx = x + size / 2, cy = y + size / 2; const r = size * 0.38; const lw = Math.max(1.5, size * 0.065);
    const col = s >= 0 ? SYM[s] : { main: '#3fd987', dark: '#1d8a58', light: '#b8ffd6' };
    ctx.save();
    if (kind === 'ch' || kind === 'cv') {
      ctx.shadowColor = col.main; ctx.shadowBlur = size * 0.12;
      rr(ctx, cx - r, cy - r, r * 2, r * 2, r * 0.35); const g = ctx.createLinearGradient(x, y, x, y + size); g.addColorStop(0, '#24443f'); g.addColorStop(1, '#0d2320'); ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.lineWidth = lw * 0.6; ctx.strokeStyle = col.main; rr(ctx, cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7, r * 0.28); ctx.stroke();
      // candlestick
      const pulse = 0.85 + 0.15 * Math.sin(t / 180);
      ctx.strokeStyle = '#3fd987'; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.75); ctx.lineTo(cx, cy + r * 0.75); ctx.stroke();
      ctx.shadowColor = '#3fd987'; ctx.shadowBlur = size * 0.15 * pulse; ctx.fillStyle = '#5ee9a2'; rr(ctx, cx - r * 0.22, cy - r * 0.42, r * 0.44, r * 0.84, r * 0.06); ctx.fill();
      ctx.shadowColor = 'transparent';
      // direction chevrons
      ctx.fillStyle = col.light; ctx.strokeStyle = OUT; ctx.lineWidth = 1;
      const d = r * 0.62, a = r * 0.22;
      if (kind === 'ch') { poly(ctx, [[cx - d - a, cy], [cx - d + a * 0.2, cy - a], [cx - d + a * 0.2, cy + a]]); ctx.fill(); ctx.stroke(); poly(ctx, [[cx + d + a, cy], [cx + d - a * 0.2, cy - a], [cx + d - a * 0.2, cy + a]]); ctx.fill(); ctx.stroke(); }
      else { poly(ctx, [[cx, cy - d - a], [cx - a, cy - d + a * 0.2], [cx + a, cy - d + a * 0.2]]); ctx.fill(); ctx.stroke(); poly(ctx, [[cx, cy + d + a], [cx - a, cy + d - a * 0.2], [cx + a, cy + d - a * 0.2]]); ctx.fill(); ctx.stroke(); }
    } else if (kind === 'burst') {
      const pulse = (t / 900) % 1;
      glowRing(ctx, cx, cy, r * (0.55 + pulse * 0.5), col.main, 0.7 * (1 - pulse));
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.78, 0, TAU); const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.05, cx, cy, r * 0.8); g.addColorStop(0, col.light); g.addColorStop(0.5, col.main); g.addColorStop(1, '#0d2320'); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = lw * 0.5;
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + t / 900; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45); ctx.lineTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7); ctx.stroke(); }
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, TAU); ctx.fill();
      ctx.fillStyle = col.light; ctx.beginPath(); ctx.arc(cx, cy, r * 0.1, 0, TAU); ctx.fill();
    } else if (kind === 'sweep') {
      ctx.shadowColor = '#3fd987'; ctx.shadowBlur = size * 0.12;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, TAU); const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 0.85); g.addColorStop(0, '#244b44'); g.addColorStop(1, '#071613'); ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
      // moving chart ticks
      for (let i = 0; i < 10; i++) {
        const a = i * TAU / 10 + t / 700; const rad = r * 0.62; const h = r * (0.12 + 0.12 * Math.abs(Math.sin(i * 1.7 + t / 400)));
        ctx.strokeStyle = i % 3 === 2 ? '#ff6b5b' : '#3fd987'; ctx.lineWidth = lw * 0.55; ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (rad - h), cy + Math.sin(a) * (rad - h)); ctx.lineTo(cx + Math.cos(a) * (rad + h), cy + Math.sin(a) * (rad + h)); ctx.stroke();
      }
      ctx.fillStyle = '#3fd987'; ctx.shadowColor = '#3fd987'; ctx.shadowBlur = size * 0.2; ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, TAU); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.08, 0, TAU); ctx.fill();
    } else if (kind === 'bot') {
      const hover = Math.sin(t / 260) * size * 0.03; const by = cy + hover;
      ctx.shadowColor = col.main; ctx.shadowBlur = size * 0.1;
      rr(ctx, cx - r * 0.7, by - r * 0.3, r * 1.4, r * 0.8, r * 0.25); const g = ctx.createLinearGradient(0, by - r * 0.3, 0, by + r * 0.5); g.addColorStop(0, '#5a7a74'); g.addColorStop(1, '#1b3a35'); ctx.fillStyle = g; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
      // rotors
      const spin = t / 60;
      for (const sx of [-1, 1]) {
        ctx.strokeStyle = OUT; ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(cx + sx * r * 0.45, by - r * 0.3); ctx.lineTo(cx + sx * r * 0.62, by - r * 0.62); ctx.stroke();
        ctx.save(); ctx.translate(cx + sx * r * 0.62, by - r * 0.66); ctx.scale(1, 0.35); ctx.rotate(spin); ctx.strokeStyle = 'rgba(200,255,230,.9)'; ctx.lineWidth = lw * 0.5; ctx.beginPath(); ctx.moveTo(-r * 0.45, 0); ctx.lineTo(r * 0.45, 0); ctx.stroke(); ctx.restore();
      }
      // lens
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(cx, by + r * 0.1, r * 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = col.main; ctx.shadowColor = col.main; ctx.shadowBlur = size * 0.15; ctx.beginPath(); ctx.arc(cx, by + r * 0.1, r * 0.18, 0, TAU); ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - r * 0.06, by + r * 0.04, r * 0.06, 0, TAU); ctx.fill();
      // legs
      ctx.strokeStyle = OUT; ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(cx - r * 0.35, by + r * 0.5); ctx.lineTo(cx - r * 0.35, by + r * 0.72); ctx.moveTo(cx + r * 0.35, by + r * 0.5); ctx.lineTo(cx + r * 0.35, by + r * 0.72); ctx.stroke();
    }
    ctx.restore();
  }

  function capsule(ctx, x, y, size, t) {
    const cx = x + size / 2, cy = y + size / 2 + Math.sin((t || 0) / 300) * size * 0.015; const r = size * 0.4; const lw = Math.max(1.5, size * 0.065);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = size * 0.1; ctx.shadowOffsetY = size * 0.05;
    poly(ctx, hexPts(cx, cy, r, Math.PI / 6));
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r); g.addColorStop(0, '#ffe58a'); g.addColorStop(0.4, '#f2b418'); g.addColorStop(1, '#8a5a06'); ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
    poly(ctx, hexPts(cx, cy, r * 0.72, Math.PI / 6)); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = lw * 0.5; ctx.stroke();
    ctx.fillStyle = '#2b2416'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.42, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f2b418'; ctx.lineWidth = lw * 0.9; ctx.beginPath(); ctx.arc(cx, cy, r * 0.27, Math.PI * 0.25, Math.PI * 1.75); ctx.stroke();
    ctx.fillStyle = '#f2b418'; ctx.beginPath(); ctx.arc(cx + r * 0.2, cy, r * 0.08, 0, TAU); ctx.fill();
    // down arrow tab
    ctx.fillStyle = OUT; poly(ctx, [[cx - r * 0.2, cy + r * 0.62], [cx + r * 0.2, cy + r * 0.62], [cx, cy + r * 0.9]]); ctx.fill();
    gloss(ctx, cx, cy, r * 0.85);
    ctx.restore();
  }

  function key(ctx, x, y, size, t) {
    const cx = x + size / 2, cy = y + size / 2; const r = size * 0.36; const lw = Math.max(1.5, size * 0.06);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 4 + Math.sin((t || 0) / 500) * 0.06);
    ctx.shadowColor = '#f2b418'; ctx.shadowBlur = size * 0.15;
    ctx.beginPath(); ctx.arc(-r * 0.45, 0, r * 0.42, 0, TAU);
    const g = ctx.createLinearGradient(-r, -r, r, r); g.addColorStop(0, '#fff0b8'); g.addColorStop(0.5, '#f2b418'); g.addColorStop(1, '#a56c08'); ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.fillStyle = '#2b2416'; ctx.beginPath(); ctx.arc(-r * 0.45, 0, r * 0.16, 0, TAU); ctx.fill();
    rr(ctx, -r * 0.05, -r * 0.13, r * 1.1, r * 0.26, r * 0.08); ctx.fillStyle = g; ctx.fill(); ctx.stroke();
    rr(ctx, r * 0.55, 0, r * 0.18, r * 0.42, 2); ctx.fill(); ctx.stroke(); rr(ctx, r * 0.85, 0, r * 0.18, r * 0.32, 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function piece(ctx, p, x, y, size, t) {
    if (!p) return;
    if (p.t === 'chip') chip(ctx, p.s, x, y, size);
    else if (p.t === 'sp') special(ctx, p.k, p.s, x, y, size, t);
    else if (p.t === 'cap') capsule(ctx, x, y, size, t);
    else if (p.t === 'key') key(ctx, x, y, size, t);
    else if (p.t === 'pill') pillPiece(ctx, x, y, size, t);
  }

  /* ---------- board cell layers ---------- */
  function cellBase(ctx, x, y, size, active) {
    if (!active) {
      ctx.save(); rr(ctx, x + 1, y + 1, size - 2, size - 2, size * 0.14); ctx.fillStyle = '#071512'; ctx.fill();
      ctx.clip(); ctx.strokeStyle = 'rgba(63,217,135,.08)'; ctx.lineWidth = 1;
      for (let i = -size; i < size * 2; i += size * 0.25) { ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + size, y + size); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(63,217,135,.18)'; ctx.lineWidth = Math.max(1, size * 0.04); ctx.beginPath(); ctx.moveTo(x + size * 0.38, y + size * 0.38); ctx.lineTo(x + size * 0.62, y + size * 0.62); ctx.moveTo(x + size * 0.62, y + size * 0.38); ctx.lineTo(x + size * 0.38, y + size * 0.62); ctx.stroke();
      ctx.restore(); return;
    }
    rr(ctx, x + 1, y + 1, size - 2, size - 2, size * 0.16); ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke();
  }
  function dust(ctx, x, y, size, layers) {
    ctx.save(); rr(ctx, x + 2, y + 2, size - 4, size - 4, size * 0.14); ctx.clip();
    ctx.fillStyle = layers >= 2 ? 'rgba(63,217,135,.42)' : 'rgba(63,217,135,.22)'; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = 'rgba(200,255,225,.55)';
    const n = layers >= 2 ? 14 : 8;
    for (let i = 0; i < n; i++) { const px = x + ((i * 37) % 100) / 100 * size, py = y + ((i * 61 + 13) % 100) / 100 * size; ctx.beginPath(); ctx.arc(px, py, size * (0.03 + (i % 3) * 0.012), 0, TAU); ctx.fill(); }
    if (layers >= 2) { ctx.strokeStyle = 'rgba(63,217,135,.9)'; ctx.lineWidth = Math.max(1.5, size * 0.05); rr(ctx, x + 3, y + 3, size - 6, size - 6, size * 0.12); ctx.stroke(); ctx.lineWidth = 1; rr(ctx, x + 7, y + 7, size - 14, size - 14, size * 0.08); ctx.stroke(); }
    ctx.restore();
  }
  function exit(ctx, x, y, size, t) {
    ctx.save(); rr(ctx, x + 2, y + 2, size - 4, size - 4, size * 0.14); ctx.clip();
    const g = ctx.createLinearGradient(x, y, x, y + size); g.addColorStop(0, 'rgba(63,217,135,0)'); g.addColorStop(1, 'rgba(63,217,135,.5)'); ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
    const ph = ((t || 0) / 700) % 1;
    for (let i = 0; i < 3; i++) { const yy = y + size * (0.15 + ((i * 0.3 + ph) % 0.9)); ctx.strokeStyle = 'rgba(120,255,190,' + (0.35 + 0.3 * i) + ')'; ctx.lineWidth = Math.max(1.5, size * 0.05); ctx.beginPath(); ctx.moveTo(x + size * 0.3, yy); ctx.lineTo(x + size * 0.5, yy + size * 0.12); ctx.lineTo(x + size * 0.7, yy); ctx.stroke(); }
    ctx.fillStyle = '#3fd987'; ctx.fillRect(x + 2, y + size - 5, size - 4, 3);
    ctx.restore();
  }
  function portal(ctx, x, y, size, id, isOut, t) {
    const col = PORTAL_COLORS[id % PORTAL_COLORS.length]; const cx = x + size / 2;
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, size * 0.07); ctx.shadowColor = col; ctx.shadowBlur = size * 0.2;
    ctx.setLineDash([size * 0.12, size * 0.08]); ctx.lineDashOffset = -((t || 0) / 40) * (isOut ? -1 : 1);
    rr(ctx, x + 3, y + 3, size - 6, size - 6, size * 0.18); ctx.stroke(); ctx.setLineDash([]);
    ctx.shadowColor = 'transparent'; ctx.fillStyle = col; ctx.globalAlpha = 0.9;
    const a = size * 0.1; const yy = isOut ? y + size * 0.16 : y + size * 0.84;
    if (isOut) poly(ctx, [[cx, yy - a], [cx - a, yy + a], [cx + a, yy + a]]); else poly(ctx, [[cx, yy + a], [cx - a, yy - a], [cx + a, yy - a]]);
    ctx.fill(); ctx.restore();
  }
  function lane(ctx, x, y, size, horizontal, dir, t) {
    ctx.save(); rr(ctx, x + 2, y + 2, size - 4, size - 4, size * 0.14); ctx.clip();
    ctx.fillStyle = 'rgba(41,200,239,.13)'; ctx.fillRect(x, y, size, size);
    const ph = (((t || 0) / 900) % 1) * size * 0.5 * dir;
    ctx.strokeStyle = 'rgba(41,200,239,.5)'; ctx.lineWidth = Math.max(1.5, size * 0.045);
    for (let k = -1; k <= 2; k++) {
      const o = k * size * 0.5 + ph; const a = size * 0.12;
      ctx.beginPath();
      if (horizontal) { const px = x + size * 0.5 + o; ctx.moveTo(px - a * dir, y + size * 0.1); ctx.lineTo(px, y + size * 0.2); ctx.lineTo(px - a * dir, y + size * 0.3); ctx.moveTo(px - a * dir, y + size * 0.7); ctx.lineTo(px, y + size * 0.8); ctx.lineTo(px - a * dir, y + size * 0.9); }
      else { const py = y + size * 0.5 + o; ctx.moveTo(x + size * 0.1, py - a * dir); ctx.lineTo(x + size * 0.2, py); ctx.lineTo(x + size * 0.3, py - a * dir); ctx.moveTo(x + size * 0.7, py - a * dir); ctx.lineTo(x + size * 0.8, py); ctx.lineTo(x + size * 0.9, py - a * dir); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function paper(ctx, x, y, size) {
    ctx.save(); const lw = Math.max(1.5, size * 0.05);
    ctx.translate(x + size / 2, y + size / 2); ctx.rotate(-0.12);
    const w = size * 0.7, h = size * 0.86;
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = size * 0.1;
    ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-w / 2 + (i / 6) * w, -h / 2 + (i % 2 ? size * 0.05 : 0));
    ctx.lineTo(w / 2, h / 2); for (let i = 6; i >= 0; i--) ctx.lineTo(-w / 2 + (i / 6) * w, h / 2 - (i % 2 ? size * 0.05 : 0)); ctx.closePath();
    ctx.fillStyle = 'rgba(250,244,230,.93)'; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.strokeStyle = 'rgba(27,42,42,.45)'; ctx.lineWidth = Math.max(1, size * 0.03);
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-w * 0.35, -h * 0.3 + i * h * 0.17); ctx.lineTo(w * (i % 2 ? 0.2 : 0.35), -h * 0.3 + i * h * 0.17); ctx.stroke(); }
    ctx.strokeStyle = '#e5484d'; ctx.lineWidth = lw * 0.8; ctx.beginPath(); ctx.arc(w * 0.12, h * 0.28, size * 0.1, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  function fud(ctx, x, y, size, t) {
    const cx = x + size / 2, cy = y + size / 2; const w = Math.sin((t || 0) / 700) * size * 0.02;
    ctx.save(); ctx.globalAlpha = 0.9;
    const blobs = [[-0.25, 0.08, 0.28], [0.05, -0.12, 0.34], [0.3, 0.1, 0.26], [0, 0.22, 0.3]];
    ctx.fillStyle = 'rgba(34,26,58,.88)'; ctx.shadowColor = 'rgba(80,60,140,.7)'; ctx.shadowBlur = size * 0.2;
    ctx.beginPath(); for (const [bx, by, br] of blobs) { ctx.moveTo(cx + bx * size + br * size, cy + by * size); ctx.arc(cx + bx * size + w, cy + by * size - w, br * size, 0, TAU); } ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#0a0716'; ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.beginPath(); for (const [bx, by, br] of blobs) { ctx.moveTo(cx + bx * size + br * size, cy + by * size); ctx.arc(cx + bx * size + w, cy + by * size - w, br * size, 0, TAU); } ctx.stroke();
    ctx.strokeStyle = '#c9b6ff'; ctx.lineWidth = Math.max(1.5, size * 0.05); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - size * 0.08, cy - size * 0.02); ctx.lineTo(cx + size * 0.02, cy + size * 0.06); ctx.lineTo(cx - size * 0.04, cy + size * 0.1); ctx.lineTo(cx + size * 0.08, cy + size * 0.24); ctx.stroke();
    ctx.restore();
  }
  function pips(ctx, cx, y, n, max, size, color) {
    const w = size * 0.13, gap = size * 0.05; const total = max * w + (max - 1) * gap; let x = cx - total / 2;
    for (let i = 0; i < max; i++) { rr(ctx, x, y, w, size * 0.09, 2); ctx.fillStyle = i < n ? color : 'rgba(0,0,0,.45)'; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 1; ctx.stroke(); x += w + gap; }
  }
  function wall(ctx, x, y, size, hp, max) {
    const lw = Math.max(1.5, size * 0.06);
    ctx.save(); rr(ctx, x + 3, y + 3, size - 6, size - 6, size * 0.14);
    const g = ctx.createLinearGradient(x, y, x, y + size); g.addColorStop(0, '#ff7a72'); g.addColorStop(0.5, '#e5484d'); g.addColorStop(1, '#8c1f24'); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = lw; ctx.strokeStyle = '#3a0d10'; ctx.stroke();
    ctx.clip(); ctx.strokeStyle = 'rgba(58,13,16,.7)'; ctx.lineWidth = Math.max(1, size * 0.035);
    for (let r = 1; r < 4; r++) { const yy = y + size * r * 0.25; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + size, yy); ctx.stroke(); const off = r % 2 ? 0 : size * 0.25; for (let c = 0; c < 3; c++) { const xx = x + off + c * size * 0.5; ctx.beginPath(); ctx.moveTo(xx, yy - size * 0.25); ctx.lineTo(xx, yy); ctx.stroke(); } }
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, y, size, size * 0.12);
    ctx.restore();
    pips(ctx, x + size / 2, y + size * 0.72, hp, max, size, '#ffd9d6');
  }
  function halt(ctx, x, y, size, t) {
    const cx = x + size / 2, cy = y + size / 2; const r = size * 0.42; const lw = Math.max(1.5, size * 0.06);
    ctx.save(); poly(ctx, hexPts(cx, cy, r, 0));
    const g = ctx.createLinearGradient(x, y, x + size, y + size); g.addColorStop(0, '#8d97a6'); g.addColorStop(0.5, '#4a5461'); g.addColorStop(1, '#22282f'); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = lw; ctx.strokeStyle = '#0d1114'; ctx.stroke();
    ctx.clip(); ctx.strokeStyle = 'rgba(229,72,77,.55)'; ctx.lineWidth = Math.max(1, size * 0.04);
    for (let i = -size; i < size * 2; i += size * 0.22) { ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i - size, y + size); ctx.stroke(); }
    ctx.restore();
    ctx.save(); ctx.fillStyle = '#e5484d'; ctx.shadowColor = '#e5484d'; ctx.shadowBlur = size * 0.15 * (0.6 + 0.4 * Math.sin((t || 0) / 300));
    rr(ctx, cx - r * 0.72, cy - size * 0.13, r * 1.44, size * 0.26, 3); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#0d1114'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(size * 0.19) + 'px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('HALT', cx, cy + 1);
    ctx.restore();
  }
  function printer(ctx, x, y, size, hp, t) {
    const lw = Math.max(1.5, size * 0.06);
    ctx.save(); rr(ctx, x + 3, y + 4, size - 6, size - 8, size * 0.14);
    const g = ctx.createLinearGradient(x, y, x, y + size); g.addColorStop(0, '#6b7683'); g.addColorStop(1, '#232a33'); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = '#0d1114'; ctx.stroke();
    // slot with emerging red paper
    rr(ctx, x + size * 0.2, y + size * 0.55, size * 0.6, size * 0.1, 2); ctx.fillStyle = '#0d1114'; ctx.fill();
    const emerge = ((t || 0) / 1200) % 1;
    ctx.fillStyle = '#e5484d'; ctx.fillRect(x + size * 0.26, y + size * 0.6, size * 0.48, size * 0.22 * emerge);
    // led + antenna
    ctx.fillStyle = Math.floor((t || 0) / 400) % 2 ? '#ff6b5b' : '#5a1a1c'; ctx.beginPath(); ctx.arc(x + size * 0.78, y + size * 0.25, size * 0.06, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#0d1114'; ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(x + size * 0.22, y + size * 0.2); ctx.lineTo(x + size * 0.22, y + size * 0.04); ctx.stroke();
    ctx.fillStyle = '#d5dde6'; rr(ctx, x + size * 0.3, y + size * 0.18, size * 0.36, size * 0.16, 2); ctx.fill();
    ctx.fillStyle = '#e5484d'; for (let i = 0; i < 4; i++) ctx.fillRect(x + size * (0.34 + i * 0.08), y + size * 0.22, size * 0.04, size * 0.08 * ((i % 3) / 2 + 0.4));
    ctx.restore();
    pips(ctx, x + size / 2, y + size * 0.86, hp, 3, size, '#ffd9d6');
  }
  function node(ctx, x, y, size, hp, max, charged, t) {
    const lw = Math.max(1.5, size * 0.06);
    ctx.save(); rr(ctx, x + 3, y + 3, size - 6, size - 6, size * 0.14);
    if (charged) { ctx.shadowColor = '#3fd987'; ctx.shadowBlur = size * 0.25 * (0.7 + 0.3 * Math.sin((t || 0) / 250)); }
    const g = ctx.createLinearGradient(x, y, x, y + size); g.addColorStop(0, charged ? '#4fe59a' : '#2c4a45'); g.addColorStop(1, charged ? '#1d8a58' : '#0f2320'); ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
    // screen
    rr(ctx, x + size * 0.18, y + size * 0.16, size * 0.64, size * 0.44, 3); ctx.fillStyle = '#061311'; ctx.fill();
    const filled = max - hp; const bars = 4;
    for (let i = 0; i < bars; i++) { const on = charged || i < Math.round(filled / max * bars); ctx.fillStyle = on ? '#3fd987' : 'rgba(63,217,135,.18)'; const h = size * (0.1 + i * 0.07); ctx.fillRect(x + size * (0.23 + i * 0.14), y + size * 0.56 - h, size * 0.1, h); }
    if (charged) { ctx.strokeStyle = '#fff'; ctx.lineWidth = lw * 0.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + size * 0.3, y + size * 0.76); ctx.lineTo(x + size * 0.45, y + size * 0.88); ctx.lineTo(x + size * 0.72, y + size * 0.66); ctx.stroke(); }
    else pips(ctx, x + size / 2, y + size * 0.72, filled, max, size, '#3fd987');
    ctx.restore();
  }
  function gate(ctx, x, y, size, need, have, t) {
    const lw = Math.max(1.5, size * 0.06);
    ctx.save(); rr(ctx, x + 3, y + 3, size - 6, size - 6, size * 0.12);
    const g = ctx.createLinearGradient(x, y, x, y + size); g.addColorStop(0, '#f6c95a'); g.addColorStop(1, '#8a5a06'); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = '#2b2416'; ctx.stroke();
    ctx.strokeStyle = '#2b2416'; ctx.lineWidth = Math.max(2, size * 0.08);
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + size * i * 0.25, y + size * 0.1); ctx.lineTo(x + size * i * 0.25, y + size * 0.9); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x + size * 0.1, y + size * 0.5); ctx.lineTo(x + size * 0.9, y + size * 0.5); ctx.stroke();
    // key glyph + counter
    ctx.fillStyle = '#2b2416'; rr(ctx, x + size * 0.28, y + size * 0.34, size * 0.44, size * 0.32, 4); ctx.fill();
    ctx.fillStyle = '#fff0b8'; ctx.font = 'bold ' + Math.round(size * 0.2) + 'px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(Math.min(have, need) + '/' + need, x + size / 2, y + size * 0.5 + 1);
    ctx.restore(); void t;
  }
  /* 2x2 dead wallet; x,y top-left of the 2x2 block, size of one cell */
  function wallet(ctx, x, y, size, hp, t) {
    const S = size * 2; const lw = Math.max(2, size * 0.07); const cx = x + S / 2, cy = y + S / 2;
    ctx.save(); rr(ctx, x + 4, y + 4, S - 8, S - 8, size * 0.22);
    const g = ctx.createLinearGradient(x, y, x + S, y + S); g.addColorStop(0, '#5b6570'); g.addColorStop(0.5, '#2c333b'); g.addColorStop(1, '#151a1f'); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = lw; ctx.strokeStyle = '#0a0d10'; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.15)'; rr(ctx, x + 10, y + 10, S - 20, S - 20, size * 0.18); ctx.stroke();
    // rivets
    ctx.fillStyle = '#8d97a6'; for (const [rx, ry] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) { ctx.beginPath(); ctx.arc(x + S * rx, y + S * ry, size * 0.06, 0, TAU); ctx.fill(); }
    // dial
    ctx.beginPath(); ctx.arc(cx, cy, size * 0.42, 0, TAU); ctx.fillStyle = '#1b2026'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = '#0a0d10'; ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(((t || 0) / 3000) % TAU);
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; ctx.strokeStyle = i % 3 ? 'rgba(255,255,255,.35)' : '#e5484d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * size * 0.28, Math.sin(a) * size * 0.28); ctx.lineTo(Math.cos(a) * size * 0.36, Math.sin(a) * size * 0.36); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#e5484d'; ctx.font = 'bold ' + Math.round(size * 0.22) + 'px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('DEAD', cx, cy - size * 0.05); ctx.fillStyle = '#cfd8e3'; ctx.font = 'bold ' + Math.round(size * 0.14) + 'px "JetBrains Mono", monospace'; ctx.fillText('WALLET', cx, cy + size * 0.16);
    // cracks by damage
    if (hp < 3) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + S * 0.2, y + S * 0.3); ctx.lineTo(x + S * 0.32, y + S * 0.42); ctx.lineTo(x + S * 0.25, y + S * 0.55); ctx.stroke(); }
    if (hp < 2) { ctx.beginPath(); ctx.moveTo(x + S * 0.8, y + S * 0.25); ctx.lineTo(x + S * 0.7, y + S * 0.45); ctx.lineTo(x + S * 0.82, y + S * 0.62); ctx.lineTo(x + S * 0.72, y + S * 0.8); ctx.stroke(); }
    ctx.restore();
    pips(ctx, cx, y + S - size * 0.28, hp, 3, size * 1.3, '#ffd9d6');
  }

  /* ---------- BONDED pill (vector reproduction of the reference) ---------- */
  function pill(ctx, x, y, size, t, opts) {
    opts = opts || {}; const cx = x + size / 2, cy = y + size / 2;
    const L = size * 0.86, W = size * 0.42, r = W / 2; const lw = Math.max(2, size * 0.075);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 4 + (opts.rot || 0));
    if (opts.glow) { ctx.shadowColor = '#3fd987'; ctx.shadowBlur = size * 0.25 * opts.glow; }
    // body outline path
    const body = () => { ctx.beginPath(); ctx.moveTo(-L / 2 + r, -r); ctx.lineTo(L / 2 - r, -r); ctx.arc(L / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(-L / 2 + r, r); ctx.arc(-L / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); };
    body(); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.save(); body(); ctx.clip();
    // right (upper) half is white with light-teal shadow band along its lower edge
    ctx.fillStyle = '#bcd3d1'; ctx.fillRect(0, r * 0.35, L, r); 
    // left (lower) half green, with darker green band
    const split = opts.split === undefined ? 0 : opts.split; // 0 = locked halves; >0 opens gap
    ctx.fillStyle = '#57d69b'; ctx.fillRect(-L, -r, L - split, r * 2);
    ctx.fillStyle = '#1f8f66'; ctx.fillRect(-L, r * 0.4, L - split, r);
    // highlight dashes on green half
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw * 0.55; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-L * 0.3, -r * 0.55); ctx.lineTo(-L * 0.18, -r * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-L * 0.39, -r * 0.3); ctx.lineTo(-L * 0.39, r * 0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-L * 0.32, r * 0.42); ctx.lineTo(-L * 0.22, r * 0.55); ctx.stroke();
    // divider
    ctx.strokeStyle = '#1b4a45'; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(-split, -r); ctx.lineTo(-split, r); ctx.stroke();
    ctx.restore();
    body(); ctx.strokeStyle = '#1b4a45'; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore(); void t;
  }

  /* ---------- HUD / objective icons ---------- */
  function objIcon(ctx, o, size, t) {
    ctx.clearRect(0, 0, size, size);
    const s = size;
    switch (o.t) {
      case 'collect': chip(ctx, o.s, 0, 0, s); break;
      case 'lane': lane(ctx, 0, 0, s, true, 1, t); chip(ctx, 1, s * 0.15, s * 0.15, s * 0.7); break;
      case 'dust': { ctx.fillStyle = '#123833'; rr(ctx, 1, 1, s - 2, s - 2, s * 0.16); ctx.fill(); dust(ctx, 0, 0, s, o.n && o.n > 12 ? 2 : 1); break; }
      case 'paper': chip(ctx, 2, s * 0.08, s * 0.08, s * 0.84); paper(ctx, 0, 0, s); break;
      case 'candle': special(ctx, 'ch', 0, 0, 0, s, t); break;
      case 'burst': special(ctx, 'burst', 3, 0, 0, s, t); break;
      case 'sweep': special(ctx, 'sweep', -1, 0, 0, s, t); break;
      case 'combo': special(ctx, 'ch', 0, -s * 0.12, -s * 0.05, s * 0.8, t); special(ctx, 'burst', 3, s * 0.3, s * 0.3, s * 0.72, t); break;
      case 'capsule': capsule(ctx, 0, 0, s, t); break;
      case 'wall': case 'wallall': wall(ctx, 0, 0, s, 2, 2); break;
      case 'keys': key(ctx, 0, 0, s, t); break;
      case 'node': node(ctx, 0, 0, s, 0, 2, true, t); break;
      case 'fud': { ctx.fillStyle = '#123833'; rr(ctx, 1, 1, s - 2, s - 2, s * 0.16); ctx.fill(); fud(ctx, 0, 0, s, t); break; }
      case 'printer': printer(ctx, 0, 0, s, 3, t); break;
      case 'wallet': wallet(ctx, 0, 0, s / 2, 3, t); break;
      case 'halt': halt(ctx, 0, 0, s, t); break;
      case 'bonded': pillPiece(ctx, 0, 0, s, t); break;
      case 'score': chip(ctx, 4, 0, 0, s); break;
      default: chip(ctx, 0, 0, 0, s);
    }
  }

  /* ---------- sprite cache ---------- */
  const cache = new Map();
  function sprite(key, size, draw) {
    const k = key + '@' + size;
    let c = cache.get(k);
    if (!c) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c = document.createElement('canvas'); c.width = Math.ceil(size * dpr); c.height = Math.ceil(size * dpr);
      const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); draw(ctx, size);
      c._size = size; cache.set(k, c);
      if (cache.size > 400) cache.clear();
    }
    return c;
  }

  RTB.Draw = { chip, special, capsule, key, piece, pillPiece, cellBase, dust, exit, portal, lane, paper, fud, wall, halt, printer, node, gate, wallet, pill, objIcon, sprite, rr, SYM, PORTAL_COLORS, OUT };
})();
