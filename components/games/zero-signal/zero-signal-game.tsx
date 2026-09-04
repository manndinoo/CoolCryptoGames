'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ActivePower,
  type Save,
  SAVE_KEY,
  TRAILS,
  type Theme,
  type Trail,
  buyPowerUp,
  buyRevive,
  buyTrail,
  dayKey,
  grantDailyRevive,
  initialSave,
  levelForGates,
  parseSave,
  recordRun,
  reviveBuysLeft,
  rgba,
  standardBuyUsed,
  themeForLevel,
  trailById,
} from '@/lib/games/zero-signal/rules'
import './zero-signal.css'

/**
 * ZERO SIGNAL.
 *
 * A one-thumb arcade game: the ball drifts sideways, tapping reverses it, and
 * every gate you fit through raises the score. Ported from the standalone
 * handoff build with its gameplay intact — reachable gate generation, full-ball
 * collision, rarity-weighted run-only pickups and the daily-limited shop.
 *
 * What changed on the way in, and why:
 *
 *  - The economy moved to `lib/games/zero-signal/rules.ts`, so the daily limits
 *    are testable without a browser. This file owns the simulation and the
 *    canvas, nothing else.
 *  - The service worker and the "install this app" flow are gone. They belong
 *    to a standalone deployment; registering the game's worker from a page on
 *    this site would hand it the whole origin's cache.
 *  - One AudioContext is created lazily and reused. The original opened one per
 *    sound effect, which browsers cut off after a few dozen and which then
 *    silently killed audio for the rest of the session.
 *  - The run starts from an effect rather than a timer racing the canvas mount.
 *
 * Progress is stored in localStorage on this device only. Scores are unranked:
 * the run is not reproducible from an input log, so the server cannot replay it
 * and this site does not pretend otherwise.
 */

type Screen = 'home' | 'play' | 'shop' | 'over'
type Gate = { y: number; x: number; w: number; speed: number; bonus: boolean; taken: boolean }
type Chip = { x: number; y: number; taken: boolean }
type BoostKind = 'shield' | ActivePower | 'revive'
type Boost = { x: number; y: number; kind: BoostKind; taken: boolean }
type TrailPoint = { x: number; y: number; life: number }

/** Live run state. Mutated in place every frame — never rendered from directly. */
type Sim = {
  w: number
  h: number
  x: number
  y: number
  /** Horizontal drift, px/s. A tap flips its sign. */
  vx: number
  score: number
  chips: number
  last: number
  gates: Gate[]
  drops: Chip[]
  boosts: Boost[]
  points: TrailPoint[]
  alive: boolean
  flash: number
  /** Gates cleared this run. Drives both the score multiplier and the level. */
  combo: number
  level: number
  prevLevel: number
  levelFlash: number
  trail: Trail
  scroll: number
  shield: boolean
  wideTime: number
  phaseWalls: number
  reviveGrace: number
  /** Power-ups usable this run: banked ones plus anything found mid-run. */
  inventory: Record<ActivePower | 'revive', number>
  /** The subset of `inventory` found this run, which expires when it ends. */
  found: Record<ActivePower | 'revive', number>
  gatesCreated: number
  /** Which gate spawns this run's Revive, or -1 if this run has none. */
  reviveSpawnAt: number
  loop: (now: number) => void
}

type PowerHud = {
  wide: number
  phase: number
  revive: number
  shield: boolean
  wideTime: number
  phaseWalls: number
}

/** Vertical spacing between gates, px. Also the reach budget for the next one. */
const GATE_SPACING = 145
const BALL_RADIUS = 11
/** Extra half-width a gate gains while Gate Expander is running. */
const WIDE_BONUS = 44

export function ZeroSignalGame() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const raf = useRef(0)
  const sim = useRef<Sim | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const soundOn = useRef(true)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The save as it stood when the current run launched. */
  const launchSave = useRef<Save>(initialSave)

  const [screen, setScreen] = useState<Screen>('home')
  const [run, setRun] = useState(0)
  const [save, setSave] = useState<Save>(initialSave)
  const [score, setScore] = useState(0)
  const [earned, setEarned] = useState(0)
  const [level, setLevel] = useState(1)
  const [powerHud, setPowerHud] = useState<PowerHud>({
    wide: 0,
    phase: 0,
    revive: 0,
    shield: false,
    wideTime: 0,
    phaseWalls: 0,
  })
  const [sound, setSound] = useState(true)
  const [showHow, setShowHow] = useState(false)
  const [toast, setToast] = useState('')
  const [revivePrompt, setRevivePrompt] = useState(false)

  const notify = useCallback((message: string, ms = 1700) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), ms)
  }, [])

  // Load the save, then grant the free daily Revive if this is today's first launch.
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(SAVE_KEY)
    } catch {
      // Storage blocked (private mode, or third-party cookies off). Play unsaved.
    }
    const daily = grantDailyRevive(parseSave(stored))
    setSave(daily.save)
    if (daily.notice) notify(daily.notice, 1900)
  }, [notify])

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    } catch {
      // As above: an unsaveable session still plays.
    }
  }, [save])

  useEffect(() => {
    soundOn.current = sound
  }, [sound])

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      audio.current?.close().catch(() => {})
    },
    [],
  )

  /**
   * A short square-wave blip.
   *
   * Stable across renders on purpose: the run loop closes over this, and a
   * `ping` that changed identity when the sound toggle flipped would restart
   * the run mid-flight.
   */
  const ping = useCallback((freq = 440, dur = 0.04) => {
    if (!soundOn.current) return
    try {
      audio.current ??= new AudioContext()
      const ctx = audio.current
      if (ctx.state === 'suspended') void ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'square'
      gain.gain.setValueAtTime(0.035, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + dur)
    } catch {
      // No audio available. The game is fully playable silent.
    }
  }, [])

  const syncHud = useCallback((s: Sim) => {
    setPowerHud({
      wide: s.inventory.wide,
      phase: s.inventory.phase,
      revive: s.inventory.revive,
      shield: s.shield,
      wideTime: s.wideTime,
      phaseWalls: s.phaseWalls,
    })
  }, [])

  const endGame = useCallback(
    (s: Sim) => {
      cancelAnimationFrame(raf.current)
      setRevivePrompt(false)
      const final = Math.floor(s.score)
      setScore(final)
      setEarned(s.chips)
      setSave((prev) => recordRun(prev, { score: final, chips: s.chips }))
      setScreen('over')
      ping(90, 0.25)
    },
    [ping],
  )

  /** Arm a new run. The effect below builds it once the canvas is mounted. */
  const start = useCallback(() => {
    launchSave.current = save
    setScore(0)
    setEarned(0)
    setLevel(1)
    setRevivePrompt(false)
    setPowerHud({
      wide: save.powerUps.wide,
      phase: save.powerUps.phase,
      revive: save.powerUps.revive,
      shield: false,
      wideTime: 0,
      phaseWalls: 0,
    })
    setScreen('play')
    setRun((n) => n + 1)
  }, [save])

  useEffect(() => {
    if (screen !== 'play' || run === 0) return
    const element = canvas.current
    if (!element) return

    const launched = launchSave.current
    const dpr = Math.min(devicePixelRatio, 2)
    const w = element.clientWidth
    const h = element.clientHeight
    element.width = w * dpr
    element.height = h * dpr
    const ctx = element.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const s: Sim = {
      w,
      h,
      x: w / 2,
      y: h * 0.72,
      vx: 105,
      score: 0,
      chips: 0,
      last: performance.now(),
      gates: [],
      drops: [],
      boosts: [],
      points: [],
      alive: true,
      flash: 0,
      combo: 0,
      level: 0,
      prevLevel: 0,
      levelFlash: 0,
      trail: trailById(launched.skin),
      scroll: 0,
      shield: false,
      wideTime: 0,
      phaseWalls: 0,
      reviveGrace: 0,
      inventory: { ...launched.powerUps },
      found: { wide: 0, phase: 0, revive: 0 },
      gatesCreated: 7,
      // Roughly one run in five carries a Revive, and never more than one.
      reviveSpawnAt: Math.random() < 0.2 ? 8 + Math.floor(Math.random() * 18) : -1,
      loop: () => {},
    }

    // The opening seven gates are wide and barely offset, so the first seconds
    // of a run are readable rather than a coin flip.
    let pathCenter = w / 2
    for (let i = 0; i < 7; i++) {
      const y = s.y - GATE_SPACING - i * GATE_SPACING
      const gateW = i < 3 ? 156 - i * 12 : 118
      const maxShift = i < 2 ? 24 : 72
      pathCenter = clamp(pathCenter + (Math.random() - 0.5) * maxShift, 35 + gateW / 2, w - 35 - gateW / 2)
      s.gates.push({
        y,
        x: pathCenter - gateW / 2,
        w: gateW,
        speed: 0,
        bonus: i > 2 && Math.random() < 0.18,
        taken: false,
      })
      if (i > 0) s.drops.push({ x: pathCenter, y: y - 70, taken: false })
    }
    sim.current = s

    const drawBackdrop = (theme: Theme) => {
      const grd = ctx.createLinearGradient(0, 0, 0, h)
      grd.addColorStop(0, theme.top)
      grd.addColorStop(1, theme.bottom)
      ctx.fillStyle = grd
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = rgba(theme.accent, 0.1)
      ctx.fillStyle = rgba(theme.accent, 0.12)
      ctx.lineWidth = 1

      if (theme.deco === 'grid') {
        for (let y = -s.scroll % 44; y < h; y += 44) {
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
        }
        for (let x = 0; x < w; x += 52) {
          ctx.beginPath()
          ctx.moveTo(w / 2 + (x - w / 2) * 0.18, 0)
          ctx.lineTo(x, h)
          ctx.stroke()
        }
      }
      if (theme.deco === 'sun') {
        ctx.beginPath()
        ctx.arc(w / 2, h * 0.3, 92, 0, Math.PI * 2)
        ctx.fill()
        for (let y = h * 0.24; y < h * 0.38; y += 13) {
          ctx.fillStyle = theme.bottom
          ctx.fillRect(w / 2 - 100, y, 200, 5)
        }
      }
      if (theme.deco === 'pipes') {
        for (let x = 20; x < w; x += 82) {
          ctx.strokeStyle = rgba(theme.accent, 0.13)
          ctx.lineWidth = 8
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, h)
          ctx.stroke()
          ctx.lineWidth = 1
          for (let y = -s.scroll % 90; y < h; y += 90) {
            ctx.beginPath()
            ctx.arc(x, y, 13, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
      }
      if (theme.deco === 'snow') {
        for (let i = 0; i < 38; i++) {
          const x = (i * 83) % w
          const y = (i * 137 + s.scroll * 0.35) % h
          ctx.globalAlpha = 0.12 + (i % 4) * 0.05
          ctx.beginPath()
          ctx.arc(x, y, 1 + (i % 3), 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }
      if (theme.deco === 'stars') {
        for (let i = 0; i < 55; i++) {
          const x = (i * 97) % w
          const y = (i * 149 + s.scroll * 0.18) % h
          ctx.globalAlpha = 0.15 + (i % 5) * 0.08
          ctx.fillRect(x, y, i % 7 === 0 ? 3 : 1, i % 7 === 0 ? 3 : 1)
        }
        ctx.globalAlpha = 1
      }
      if (theme.deco === 'speed') {
        for (let i = 0; i < 18; i++) {
          const y = (i * 71 + s.scroll * 1.7) % h
          ctx.strokeStyle = rgba(theme.accent, 0.12)
          ctx.beginPath()
          ctx.moveTo((i * 47) % w, y)
          ctx.lineTo(((i * 47) % w) + 42, y + 18)
          ctx.stroke()
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,.08)'
      ctx.fillRect(0, 0, w, h)
    }

    const drawTrail = () => {
      const p = s.points
      const col = s.trail.color
      if (s.trail.kind === 'comet') {
        ctx.lineCap = 'round'
        for (let i = 1; i < p.length; i++) {
          ctx.strokeStyle = rgba(col, p[i].life * 0.38)
          ctx.lineWidth = 1 + p[i].life * 6
          ctx.beginPath()
          ctx.moveTo(p[i - 1].x, p[i - 1].y)
          ctx.lineTo(p[i].x, p[i].y)
          ctx.stroke()
        }
      }
      if (s.trail.kind === 'echo') {
        p.filter((_, i) => i % 5 === 0).forEach((q) => {
          ctx.strokeStyle = rgba(col, q.life * 0.45)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(q.x, q.y, 3 + 8 * q.life, 0, Math.PI * 2)
          ctx.stroke()
        })
      }
      if (s.trail.kind === 'spark') {
        p.filter((_, i) => i % 3 === 0).forEach((q, i) => {
          ctx.fillStyle = rgba(col, q.life * 0.8)
          ctx.fillRect(q.x + Math.sin(i * 9) * 12 * q.life, q.y + Math.cos(i * 7) * 9 * q.life, 2, 2)
        })
      }
      if (s.trail.kind === 'pixel') {
        p.filter((_, i) => i % 4 === 0).forEach((q, i) => {
          ctx.fillStyle = rgba(col, q.life * 0.65)
          const z = 2 + (i % 3) * 2
          ctx.fillRect(q.x - 15 * q.life, q.y - z / 2, z, z)
        })
      }
      if (s.trail.kind === 'plasma') {
        for (const side of [-1, 1]) {
          ctx.strokeStyle = rgba(col, 0.38)
          ctx.lineWidth = 4
          ctx.beginPath()
          p.forEach((q, i) => {
            const yy = q.y + side * Math.sin(i * 0.8) * 8 * q.life
            if (i) ctx.lineTo(q.x, yy)
            else ctx.moveTo(q.x, yy)
          })
          ctx.stroke()
        }
      }
    }

    const loop = (now: number) => {
      if (!s.alive) return
      const dt = Math.min((now - s.last) / 1000, 0.034)
      s.last = now

      const currentLevel = levelForGates(s.combo).level
      const theme = themeForLevel(currentLevel)
      if (currentLevel !== s.level) {
        s.prevLevel = s.level
        s.level = currentLevel
        s.levelFlash = 1
        setLevel(currentLevel + 1)
        ping(1040, 0.08)
      }

      const speed = 104 + currentLevel * 6 + Math.min(s.score * 0.022, 48)
      s.wideTime = Math.max(0, s.wideTime - dt)
      s.reviveGrace = Math.max(0, s.reviveGrace - dt)
      s.scroll += speed * dt

      s.x += s.vx * dt
      if (s.x < 18) {
        s.x = 18
        s.vx = Math.abs(s.vx)
      }
      if (s.x > s.w - 18) {
        s.x = s.w - 18
        s.vx = -Math.abs(s.vx)
      }

      s.points.unshift({ x: s.x, y: s.y, life: 1 })
      s.points = s.points.slice(0, 30)
      s.points.forEach((p) => (p.life -= dt * 1.65))

      for (const g of s.gates) {
        g.y += speed * dt
        g.x += g.speed * dt
        if (g.x < 24 || g.x + g.w > w - 24) g.speed *= -1
        if (g.taken || g.y <= s.y - 5) continue

        g.taken = true
        const expand = s.wideTime > 0 ? WIDE_BONUS : 0
        // The whole ball must fit, not its centre. A hair over the edge is a miss.
        const inside = s.x - BALL_RADIUS > g.x - expand && s.x + BALL_RADIUS < g.x + g.w + expand
        let safe = inside || s.reviveGrace > 0

        if (s.phaseWalls > 0) {
          s.phaseWalls--
          safe = true
          ping(1180, 0.035)
        } else if (!inside && s.shield) {
          s.shield = false
          safe = true
          s.flash = 2
          ping(180, 0.16)
        }

        if (!safe) {
          s.alive = false
          if (s.inventory.revive > 0) {
            setRevivePrompt(true)
            syncHud(s)
            ping(110, 0.2)
          } else {
            endGame(s)
          }
          return
        }

        s.combo++
        s.score += 10 + s.combo * 2 + (g.bonus ? 20 : 0)
        s.flash = Math.max(1, s.flash)
        ping(g.bonus ? 760 : 520, 0.045)
        syncHud(s)
      }

      for (const d of s.drops) {
        d.y += speed * dt
        if (d.taken || Math.hypot(d.x - s.x, d.y - s.y) >= 24) continue
        d.taken = true
        s.chips++
        s.score += 5
        ping(920, 0.05)
      }

      for (const b of s.boosts) {
        b.y += speed * dt
        if (b.taken || Math.hypot(b.x - s.x, b.y - s.y) >= 25) continue
        b.taken = true
        if (b.kind === 'shield') {
          s.shield = true
          notify('FORCE FIELD ACTIVE')
        } else {
          // Found power-ups are run-only. `found` is what expires at the end.
          s.inventory[b.kind]++
          s.found[b.kind]++
          notify(
            b.kind === 'wide'
              ? 'GATE EXPANDER • USE THIS RUN'
              : b.kind === 'phase'
                ? 'GHOST DRIVE • USE THIS RUN'
                : 'REVIVE • USE THIS RUN',
          )
        }
        syncHud(s)
        ping(b.kind === 'revive' ? 1450 : b.kind === 'phase' ? 1280 : b.kind === 'wide' ? 980 : 720, 0.12)
      }

      const top = Math.min(...s.gates.map((g) => g.y))
      if (top > 40) {
        const previous = s.gates.reduce((a, b) => (a.y < b.y ? a : b))
        const gateW = Math.max(76, 126 - currentLevel * 4.5)
        const previousCenter = previous.x + previous.w / 2
        // Never place a gate further sideways than the ball can actually drift
        // in the time it takes to arrive. Hard, but always reachable.
        const travelBudget = Math.min(88, (GATE_SPACING / speed) * Math.abs(s.vx) * 0.64)
        const nextCenter = clamp(
          previousCenter + (Math.random() * 2 - 1) * travelBudget,
          35 + gateW / 2,
          w - 35 - gateW / 2,
        )
        const gate: Gate = {
          y: top - GATE_SPACING,
          x: nextCenter - gateW / 2,
          w: gateW,
          speed: currentLevel < 1 ? 0 : (Math.random() - 0.5) * Math.min(38, 10 + currentLevel * 4),
          bonus: Math.random() < 0.2,
          taken: false,
        }
        s.gates.push(gate)
        s.gatesCreated++
        if (Math.random() < 0.7) s.drops.push({ x: nextCenter, y: gate.y - 70, taken: false })

        if (s.gatesCreated === s.reviveSpawnAt) {
          s.boosts.push({ x: nextCenter, y: gate.y - 102, kind: 'revive', taken: false })
          s.reviveSpawnAt = -1
        } else {
          // Rarity, in one roll: 3.5% Force Field, 1.2% Gate Expander,
          // 0.4% Ghost Drive. Ghost Drive is meant to feel like an event.
          const roll = Math.random()
          const kind: BoostKind | null =
            roll < 0.035 ? 'shield' : roll < 0.047 ? 'wide' : roll < 0.051 ? 'phase' : null
          if (kind) s.boosts.push({ x: nextCenter, y: gate.y - 102, kind, taken: false })
        }
      }

      s.gates = s.gates.filter((g) => g.y < h + 35)
      s.drops = s.drops.filter((d) => d.y < h + 30)
      s.boosts = s.boosts.filter((b) => b.y < h + 30)

      s.score += dt * (2 + currentLevel * 0.5)
      s.flash = Math.max(0, s.flash - dt * 5)
      s.levelFlash = Math.max(0, s.levelFlash - dt * 0.65)
      setScore(Math.floor(s.score))

      ctx.clearRect(0, 0, w, h)
      if (s.levelFlash > 0) {
        // Cross-fade the old world out over the new one, on level change.
        drawBackdrop(themeForLevel(s.prevLevel))
        ctx.globalAlpha = 1 - s.levelFlash
        drawBackdrop(theme)
        ctx.globalAlpha = 1
      } else {
        drawBackdrop(theme)
      }

      for (const g of s.gates) {
        const color = g.bonus ? '#ffd166' : theme.gate
        const expand = s.wideTime > 0 ? WIDE_BONUS : 0
        const left = Math.max(0, g.x - expand)
        const right = Math.min(w, g.x + g.w + expand)
        ctx.shadowBlur = g.bonus ? 18 : 11
        ctx.shadowColor = color
        ctx.fillStyle = color
        ctx.fillRect(0, g.y - 5, left, 10)
        ctx.fillRect(right, g.y - 5, w - right, 10)
        ctx.shadowBlur = 0
        if (g.bonus) {
          ctx.font = '700 10px monospace'
          ctx.textAlign = 'center'
          ctx.fillText('+BONUS', (left + right) / 2, g.y - 12)
        }
      }

      for (const d of s.drops) {
        if (d.taken) continue
        ctx.shadowBlur = 12
        ctx.shadowColor = theme.accent
        ctx.fillStyle = theme.accent
        ctx.beginPath()
        ctx.arc(d.x, d.y, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = theme.bottom
        ctx.font = 'bold 8px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('◆', d.x, d.y + 3)
        ctx.shadowBlur = 0
      }

      for (const b of s.boosts) {
        if (b.taken) continue
        const color =
          b.kind === 'shield' ? '#57e8ff' : b.kind === 'wide' ? '#b8ff45' : b.kind === 'phase' ? '#ffca55' : '#ff63d8'
        const letter = b.kind === 'shield' ? 'S' : b.kind === 'wide' ? 'W' : b.kind === 'phase' ? 'G' : 'R'
        ctx.shadowBlur = b.kind === 'revive' ? 30 : b.kind === 'phase' ? 24 : 14
        ctx.shadowColor = color
        ctx.fillStyle = rgba(color, 0.2)
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.kind === 'revive' ? 13 : b.kind === 'phase' ? 12 : 10, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = color
        ctx.font = '900 10px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(letter, b.x, b.y + 3)
        ctx.shadowBlur = 0
      }

      drawTrail()

      if (s.shield || s.reviveGrace > 0) {
        const ring = s.reviveGrace > 0 ? '#ff63d8' : '#57e8ff'
        ctx.strokeStyle = ring
        ctx.lineWidth = 2
        ctx.shadowBlur = 16
        ctx.shadowColor = ring
        ctx.beginPath()
        ctx.arc(s.x, s.y, 18, 0, Math.PI * 2)
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      ctx.shadowBlur = 18 + s.flash * 18
      ctx.shadowColor = s.trail.color
      ctx.fillStyle = s.phaseWalls > 0 ? '#ffffff' : s.trail.color
      ctx.beginPath()
      ctx.arc(s.x, s.y, 10 + s.flash * 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0

      raf.current = requestAnimationFrame(loop)
    }

    s.loop = loop
    raf.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf.current)
  }, [run, screen, endGame, notify, ping, syncHud])

  const flip = () => {
    if (screen !== 'play') return
    const s = sim.current
    if (s?.alive) {
      s.vx *= -1
      ping(300, 0.025)
    }
  }

  const activatePower = (kind: ActivePower) => {
    const s = sim.current
    if (screen !== 'play' || !s?.alive) return
    if (s.inventory[kind] < 1) {
      notify('NONE AVAILABLE')
      return
    }
    s.inventory[kind]--
    // Spend anything found this run first; only then draw down the bank.
    if (s.found[kind] > 0) s.found[kind]--
    else
      setSave((prev) => ({
        ...prev,
        powerUps: { ...prev.powerUps, [kind]: Math.max(0, prev.powerUps[kind] - 1) },
      }))

    if (kind === 'wide') {
      s.wideTime = 8
      notify('GATES EXPANDED • 8 SEC')
    } else {
      s.phaseWalls = 10
      notify('GHOST DRIVE • 10 GATES')
    }
    syncHud(s)
    ping(kind === 'phase' ? 1250 : 950, 0.16)
  }

  const useRevive = () => {
    const s = sim.current
    if (!s || s.inventory.revive < 1) return
    s.inventory.revive--
    if (s.found.revive > 0) s.found.revive--
    else
      setSave((prev) => ({
        ...prev,
        powerUps: { ...prev.powerUps, revive: Math.max(0, prev.powerUps.revive - 1) },
      }))

    // Grace covers the gates already on screen, so a Revive is not spent into
    // an immediate second crash.
    s.reviveGrace = 2.25
    s.alive = true
    s.last = performance.now()
    setRevivePrompt(false)
    syncHud(s)
    ping(1350, 0.2)
    raf.current = requestAnimationFrame(s.loop)
  }

  const endReviveRun = () => {
    const s = sim.current
    if (s) endGame(s)
  }

  /** Every shop button funnels through here: apply the rule, then say what happened. */
  const apply = (outcome: { save: Save; notice: string | null }) => {
    setSave(outcome.save)
    if (outcome.notice) notify(outcome.notice)
  }

  const today = dayKey()
  const revivesLeft = reviveBuysLeft(save, today)

  return (
    <div className="zs-root" onPointerDown={flip}>
      <div className="phone-frame">
        {screen === 'play' && (
          <>
            <canvas ref={canvas} className="game-canvas" />
            <div className="hud">
              <div>
                <small>SCORE</small>
                <b>{score}</b>
              </div>
              <div className="level-pill">
                <b>LEVEL {level}</b>
              </div>
              <div>
                <small>BEST</small>
                <b>{save.best}</b>
              </div>
            </div>
            {powerHud.shield && <div className="shield-status">◯ SHIELD</div>}
            <div className="power-dock" onPointerDown={(e) => e.stopPropagation()}>
              <button className={powerHud.wideTime > 0 ? 'active' : ''} onClick={() => activatePower('wide')}>
                <i>↔</i>
                <span>WIDE</span>
                <b>{powerHud.wide}</b>
                {powerHud.wideTime > 0 && <em>{Math.ceil(powerHud.wideTime)}s</em>}
              </button>
              <button
                className={powerHud.phaseWalls > 0 ? 'active legendary' : ''}
                onClick={() => activatePower('phase')}
              >
                <i>◈</i>
                <span>GHOST</span>
                <b>{powerHud.phase}</b>
                {powerHud.phaseWalls > 0 && <em>{powerHud.phaseWalls}</em>}
              </button>
              <div className="revive-count">
                <i>↻</i>
                <span>REVIVE</span>
                <b>{powerHud.revive}</b>
              </div>
            </div>
            <div className="tap-hint">TAP TO FLIP</div>
          </>
        )}

        {screen === 'home' && (
          <section className="screen home-screen">
            <div className="topbar">
              <button onClick={() => setSound(!sound)}>{sound ? 'SOUND ON' : 'SOUND OFF'}</button>
              <button onClick={() => setScreen('shop')}>◈ {save.chips}</button>
            </div>
            <div className="signal-mark" aria-label="Zero Signal">
              <span>ZS</span>
              <i />
              <i />
              <i />
            </div>
            <div className="title-lockup">
              <p>ONE-THUMB ARCADE</p>
              <h1>
                ZERO
                <br />
                <i>SIGNAL</i>
              </h1>
              <span>SIX WORLDS. ONE SIGNAL.</span>
            </div>
            <button className="play" onClick={start}>
              PLAY <span>▶</span>
            </button>
            <div className="quick-row">
              <button onClick={() => setShowHow(true)}>
                <b>?</b> HOW TO PLAY
              </button>
              <button onClick={() => setScreen('shop')}>
                <b>◆</b> POWER + TRAIL SHOP
              </button>
            </div>
            <div className="mission">
              <div className="mission-head">
                <span>DAILY SIGNAL</span>
                <b>1/3</b>
              </div>
              <p>Reach Level 4 in one run</p>
              <div className="bar">
                <i style={{ width: `${Math.min(100, save.best / 6)}%` }} />
              </div>
              <small>REWARD: 100 CHIPS</small>
            </div>
            <div className="stats">
              <span>
                BEST <b>{save.best}</b>
              </span>
              <span>
                STREAK <b>{save.streak} DAY</b>
              </span>
              <span>
                RUNS <b>{save.games}</b>
              </span>
            </div>
          </section>
        )}

        {screen === 'over' && (
          <section className="screen over-screen">
            <p className="eyebrow">SIGNAL LOST</p>
            <div className="score-ring">
              <small>SCORE</small>
              <strong>{score}</strong>
              <span>REACHED LEVEL {level}</span>
            </div>
            <div className="earned">◆ +{earned} CHIPS</div>
            <button className="play" onClick={start}>
              RUN IT BACK <span>↻</span>
            </button>
            <button
              className="challenge"
              onClick={() => {
                navigator.clipboard?.writeText(`Beat my ${score} in ZERO SIGNAL`)
                notify('CHALLENGE COPIED')
              }}
            >
              CHALLENGE A FRIEND
            </button>
            <button className="text-btn" onClick={() => setScreen('home')}>
              BACK TO ARCADE
            </button>
          </section>
        )}

        {screen === 'shop' && (
          <section className="screen shop-screen">
            <div className="shop-head">
              <button onClick={() => setScreen('home')}>‹</button>
              <div>
                <small>SIGNAL SHOP</small>
                <h2>LOADOUT</h2>
              </div>
              <b>◆ {save.chips}</b>
            </div>
            <div className="beta-lock">BETA MODE · REAL-MONEY PURCHASES LOCKED</div>

            <h3>POWER-UP LOCKER</h3>
            <div className="power-shop">
              <article>
                <div>
                  <i>↔</i>
                  <span>
                    <b>GATE EXPANDER</b>
                    <small>Rare · Wider gates for 8 seconds</small>
                    <em>BANKED: {save.powerUps.wide}</em>
                  </span>
                </div>
                <button onClick={() => apply(buyPowerUp(save, 'wide', 'chips', today))}>◆ 300 · DAILY</button>
                <button disabled>PREMIUM · LOCKED</button>
              </article>
              <article className="legendary">
                <div>
                  <i>◈</i>
                  <span>
                    <b>GHOST DRIVE</b>
                    <small>Legendary · Ignore the next 10 gates</small>
                    <em>BANKED: {save.powerUps.phase}</em>
                  </span>
                </div>
                <button onClick={() => apply(buyPowerUp(save, 'phase', 'chips', today))}>◆ 650 · DAILY</button>
                <button disabled>PREMIUM · LOCKED</button>
              </article>
              <article className="revive-card">
                <div>
                  <i>↻</i>
                  <span>
                    <b>REVIVE</b>
                    <small>Mythic · Continue after a crash</small>
                    <em>
                      BANKED: {save.powerUps.revive} · {revivesLeft}/2 CHIP BUYS LEFT
                    </em>
                  </span>
                </div>
                <button onClick={() => apply(buyRevive(save, 'chips', today))}>◆ 900 · MAX 2/DAY</button>
                <button disabled>18 CREDITS · LOCKED</button>
              </article>
            </div>
            <p className="daily-note">
              {standardBuyUsed(save, today)
                ? 'DAILY STANDARD POWER-UP PURCHASE USED'
                : 'ONE STANDARD POWER-UP PURCHASE WITH CHIPS AVAILABLE'}{' '}
              · REVIVE HAS ITS OWN 2/DAY LIMIT
            </p>

            <h3>FOLLOW EFFECTS</h3>
            <div className="skins">
              {TRAILS.map((trail) => (
                <button
                  key={trail.id}
                  onClick={() => apply(buyTrail(save, trail.id))}
                  className={save.skin === trail.id ? 'selected' : ''}
                >
                  <i
                    className={`trail-icon ${trail.kind}`}
                    style={{ background: trail.color, boxShadow: `0 0 18px ${trail.color}` }}
                  />
                  <span>
                    <b>{trail.name}</b>
                    <em>{trail.note}</em>
                    <small>
                      {save.owned.includes(trail.id)
                        ? save.skin === trail.id
                          ? 'EQUIPPED'
                          : 'OWNED'
                        : `◆ ${trail.price}`}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <p className="store-note">
              One free Revive is added on the first launch each day. Progress is stored on this device
              only, and scores from this game are unranked.
            </p>
          </section>
        )}

        {revivePrompt && (
          <div className="modal revive-modal" onPointerDown={(e) => e.stopPropagation()}>
            <div>
              <p>SIGNAL INTERRUPTED</p>
              <h2>CONTINUE THIS RUN?</h2>
              <div className="revive-orb">↻</div>
              <strong>
                {powerHud.revive} REVIVE{powerHud.revive === 1 ? '' : 'S'} AVAILABLE
              </strong>
              <button className="play" onClick={useRevive}>
                USE REVIVE
              </button>
              <button className="text-btn" onClick={endReviveRun}>
                END RUN
              </button>
            </div>
          </div>
        )}

        {showHow && (
          <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
            <div>
              <button className="close" onClick={() => setShowHow(false)}>
                ×
              </button>
              <p>HOW TO PLAY</p>
              <h2>KEEP THE SIGNAL ALIVE</h2>
              <div className="demo">
                <i />
                <span>↔</span>
              </div>
              <ol>
                <li>
                  <b>TAP</b> to flip your drift.
                </li>
                <li>Survive enough gates to advance.</li>
                <li>Every level lasts longer and gets harder.</li>
              </ol>
              <button
                className="play"
                onClick={() => {
                  setShowHow(false)
                  start()
                }}
              >
                I GOT IT
              </button>
            </div>
          </div>
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
