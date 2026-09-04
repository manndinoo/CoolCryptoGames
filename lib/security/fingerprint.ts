import { createHmac } from 'node:crypto'

/**
 * Device fingerprinting.
 *
 * Be clear about what this buys you. A browser fingerprint is a correlation
 * tool, not an identity. It is defeated by a fresh browser profile, a private
 * window in some configurations, a VM, or any of the purpose-built anti-detect
 * browsers that exist precisely to beat it. Someone determined will get a new
 * fingerprint in under a minute.
 *
 * What it does buy you is cost and visibility. Casual multi-accounting stops,
 * and a serious operation has to work for every identity it burns — which
 * leaves a trail in `identity_links` that makes the whole cluster bannable at
 * once instead of one wallet at a time.
 *
 * The component list below is deliberately short. Every extra signal makes the
 * hash more unique and also more brittle: a browser update that shifts one
 * value gives an honest player a brand new device identity and quietly drops
 * them out of every cluster you had them in.
 */

export type FingerprintComponents = {
  /** Platform string, coarse — not the full UA, which changes every release. */
  platform: string
  /** IANA timezone. */
  timezone: string
  /** "1920x1080x24" — screen geometry and colour depth. */
  screen: string
  /** Logical CPU cores, bucketed. */
  cores: string
  /** Hash of a canvas render. Strong signal, stable across sessions. */
  canvas: string
  /** Hash of the WebGL vendor/renderer pair. Tied to the GPU. */
  webgl: string
}

const FIELDS: (keyof FingerprintComponents)[] = [
  'platform',
  'timezone',
  'screen',
  'cores',
  'canvas',
  'webgl',
]

/** Coerces an untrusted client payload into the fixed component shape. */
export function normalizeComponents(raw: unknown): FingerprintComponents | null {
  if (typeof raw !== 'object' || raw === null) return null
  const src = raw as Record<string, unknown>
  const out = {} as FingerprintComponents

  for (const field of FIELDS) {
    const value = src[field]
    if (typeof value !== 'string') return null
    // Cap length so a client cannot push megabytes into the hash input.
    out[field] = value.slice(0, 256).trim().toLowerCase()
  }
  return out
}

function pepper(): string {
  const p = process.env.FINGERPRINT_PEPPER
  if (!p || p.length < 32) {
    throw new Error(
      'FINGERPRINT_PEPPER must be set to at least 32 characters. Rotating it gives every existing device a new identity and drops every device ban.',
    )
  }
  return p
}

/**
 * Order-independent, whitespace-independent hash of the components.
 * Peppered so a database leak cannot be replayed against a rainbow table of
 * common device configurations.
 */
export function hashFingerprint(components: FingerprintComponents): string {
  const canonical = FIELDS.map((f) => `${f}=${components[f]}`).join('|')
  return createHmac('sha256', pepper()).update(`fp:${canonical}`).digest('hex')
}

/**
 * How many of the six components two fingerprints share. Used when reviewing a
 * suspected cluster by hand: a near-miss usually means the same machine after
 * a browser update, rather than a genuinely different device.
 */
export function similarity(
  a: FingerprintComponents,
  b: FingerprintComponents,
): number {
  return FIELDS.filter((f) => a[f] === b[f]).length / FIELDS.length
}
