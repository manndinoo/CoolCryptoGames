'use client'

import type { FingerprintComponents } from '@/lib/security/fingerprint'

/**
 * Collects the device signals the server hashes into a device identity.
 *
 * Everything here is client-supplied and therefore forgeable — a modified
 * client can send whatever it likes. That is fine and expected: the value is
 * not that the signal is trustworthy, but that changing it consistently, for
 * every identity you burn, is work. Treat the result as a correlation key,
 * never as proof of who someone is.
 */

function canvasHash(): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 60
    const ctx = canvas.getContext('2d')
    if (!ctx) return 'none'

    // Text rendering differs by font stack, antialiasing and GPU, which is
    // what makes the output machine-specific.
    ctx.textBaseline = 'top'
    ctx.font = '14px "Arial"'
    ctx.fillStyle = '#f60'
    ctx.fillRect(0, 0, 120, 30)
    ctx.fillStyle = '#069'
    ctx.fillText('CoolCryptoGames \u{1F3AE}', 2, 15)
    ctx.fillStyle = 'rgba(102, 200, 0, 0.7)'
    ctx.fillText('CoolCryptoGames \u{1F3AE}', 4, 20)

    return djb2(canvas.toDataURL())
  } catch {
    return 'blocked'
  }
}

function webglHash(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null
    if (!gl) return 'none'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return 'masked'
    const vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL))
    const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
    return djb2(`${vendor}|${renderer}`)
  } catch {
    return 'blocked'
  }
}

/** Small, fast, non-cryptographic. The server applies the real peppered hash. */
function djb2(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function collectFingerprint(): FingerprintComponents {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    // Coarse platform, not the full user agent — the UA string changes on
    // every browser release and would churn device identities constantly.
    platform: nav.platform ?? 'unknown',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown',
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    // Bucketed: exact core counts add uniqueness but flip between readings on
    // some browsers under load.
    cores: String(Math.min(nav.hardwareConcurrency ?? 0, 32)),
    canvas: canvasHash(),
    webgl: webglHash(),
  }
}
