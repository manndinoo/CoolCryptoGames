import Image from 'next/image'

/**
 * The CCG mark, from the supplied brand artwork.
 *
 * These are the identity's own files — the sheet's one-colour lockups, keyed
 * to transparency and issued in both inks with the accent square kept. Nothing
 * here is redrawn: the geometry is the artwork's, so it cannot drift from the
 * brand as the site changes.
 *
 * `light` and `dark` name the ink, not the background: use `light` (cream) on
 * the dark product surfaces, `dark` (near-black) on cream.
 */

type MarkProps = {
  /** Rendered height in CSS pixels. Width follows the artwork's ratio. */
  size?: number
  ink?: 'light' | 'dark'
  className?: string
  priority?: boolean
}

// Intrinsic sizes of the exported files, so next/image reserves the right box
// and never shifts the layout while they load.
const ART = {
  symbol: { w: 322, h: 360 },
  lockup: { w: 402, h: 139 },
  stacked: { w: 244, h: 207 },
} as const

/** The gateway on its own. The smallest form that still reads at 16px. */
export function CcgMonogram({ size = 32, ink = 'light', className, priority }: MarkProps) {
  return (
    <Image
      src={`/brand/symbol-${ink}.png`}
      alt="Cool Crypto Games"
      width={ART.symbol.w}
      height={ART.symbol.h}
      priority={priority}
      className={className}
      style={{ height: size, width: 'auto' }}
    />
  )
}

/** Gateway plus the name, side by side. The default for headers and footers. */
export function CcgWordmark({ size = 34, ink = 'light', className, priority }: MarkProps) {
  return (
    <Image
      src={`/brand/lockup-${ink}.png`}
      alt="Cool Crypto Games"
      width={ART.lockup.w}
      height={ART.lockup.h}
      priority={priority}
      className={className}
      style={{ height: size, width: 'auto' }}
    />
  )
}

/** Gateway above the name, for square spaces. */
export function CcgStacked({ size = 72, className }: MarkProps) {
  return (
    <Image
      src="/brand/stacked-light.png"
      alt="Cool Crypto Games"
      width={ART.stacked.w}
      height={ART.stacked.h}
      className={className}
      style={{ height: size, width: 'auto' }}
    />
  )
}
