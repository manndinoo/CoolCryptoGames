'use client'

/**
 * The CCG mark, in three directions drawn from the reference boards.
 *
 * All are original geometry — per REFERENCE_MAP.md the generated concepts are
 * art direction, not production vectors.
 *
 * Letters are knocked out to transparency with an SVG mask rather than painted
 * in a background colour. Painting the backdrop only works while you know what
 * the backdrop is; a knockout is correct on carbon, on acid, on a screenshot,
 * and in one colour, which is what "must work in one colour" actually demands.
 *
 * Mask ids are unique per instance, via useId.
 *
 * They used to be fixed strings, on the reasoning that identical geometry
 * resolves identically. That held until the shell gained a sidebar hidden
 * below the lg breakpoint: `url(#ccg-tile)` resolves to the FIRST element with
 * that id in document order, and on a phone that became a mask inside a
 * `display: none` subtree, which the browser never builds. Every mark on the
 * page then rendered as a solid blob with no letters knocked out of it.
 *
 * Unique ids are the only version of this that cannot be broken by where a
 * component happens to be mounted. useId is why this file is a client
 * component; the ids it produces contain characters that are illegal in a CSS
 * url() reference, so they are stripped down to a safe alphabet first.
 */

import { useId } from 'react'
import { Letter, PATH_C, PATH_G } from './letterforms'

/** React's generated ids carry delimiters that url(#...) cannot address. */
function safeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '')
}

type MarkProps = {
  size?: number
  monochrome?: boolean
  className?: string
  title?: string
}

const STROKE = 9

/** Letter geometry as mask cutters: white keeps, black removes. */
function LetterCutter({ letter, x = 0, y = 0, scale = 1 }: {
  letter: 'C' | 'G'
  x?: number
  y?: number
  scale?: number
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path
        d={letter === 'G' ? PATH_G : PATH_C}
        fill="none"
        stroke="black"
        strokeWidth={STROKE}
        strokeLinecap="butt"
      />
    </g>
  )
}

/**
 * A — Cascade. Three letterforms overlapping down a diagonal. Each letter
 * behind is cut by the one in front, so the stacking order reads without
 * relying on colour.
 */
export function CcgCascade({ size = 48, monochrome = false, className, title = 'Cool Crypto Games' }: MarkProps) {
  const uid = safeId(useId())
  const colors = monochrome
    ? ['currentColor', 'currentColor', 'currentColor']
    : ['#E8EAED', '#4C7DFF', '#3563E9']

  return (
    <svg width={size} height={size} viewBox="0 0 78 78" fill="none" role="img" aria-label={title} className={className}>
      <defs>
        {/* Each mask removes the letters that sit in front of this one. */}
        <mask id={`ccg-cascade-1-${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="78" height="78">
          <rect width="78" height="78" fill="white" />
          <g transform="translate(15,15)"><LetterCutter letter="C" /></g>
        </mask>
        <mask id={`ccg-cascade-2-${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="78" height="78">
          <rect width="78" height="78" fill="white" />
          <g transform="translate(30,30)"><LetterCutter letter="G" /></g>
        </mask>
      </defs>

      <g mask={`url(#ccg-cascade-1-${uid})`} transform="translate(0,0)">
        <Letter letter="C" color={colors[0]} />
      </g>
      <g mask={`url(#ccg-cascade-2-${uid})`} transform="translate(15,15)">
        <Letter letter="C" color={colors[1]} />
      </g>
      <g transform="translate(30,30)">
        <Letter letter="G" color={colors[2]} />
      </g>
    </svg>
  )
}

/**
 * B — Tri-tile. Three connected game tiles on their points, each carrying one
 * letter knocked through it. Below 28px the letters are dropped — at that size
 * a 9-unit stroke is under a pixel and turns to mush — leaving three solid
 * tiles that still read as the mark.
 */
export function CcgTriTile({ size = 48, monochrome = false, className, title = 'Cool Crypto Games' }: MarkProps) {
  const uid = safeId(useId())
  const tiles = monochrome
    ? ['currentColor', 'currentColor', 'currentColor']
    : ['#4C7DFF', '#E8EAED', '#4C7DFF']
  const showLetters = size >= 28

  // The inscribed square of a 42-unit diamond is only ~30 across, so letters
  // are scaled to 0.62 and centred on their tile.
  const S = 0.62
  const positions = [
    { x: 50, y: 22, letter: 'C' as const },
    { x: 22, y: 56, letter: 'C' as const },
    { x: 78, y: 56, letter: 'G' as const },
  ]

  const maskId = `ccg-tri-${uid}`

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" role="img" aria-label={title} className={className}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="white" />
          {showLetters &&
            positions.map((p, i) => (
              <LetterCutter key={i} letter={p.letter} x={p.x - 23.5 * S} y={p.y - 24 * S} scale={S} />
            ))}
        </mask>
      </defs>

      <g mask={`url(#${maskId})`}>
        {positions.map((p, i) => (
          <rect
            key={i}
            x={p.x - 21}
            y={p.y - 21}
            width="42"
            height="42"
            rx="9"
            fill={tiles[i]}
            transform={`rotate(45 ${p.x} ${p.y})`}
          />
        ))}
      </g>
    </svg>
  )
}

/**
 * C — Tile. One rounded tile with a notched corner and the letters cut through
 * it, two up and one down. The most robust of the three when small: the
 * silhouette carries recognition on its own, so it survives 16px in one colour.
 */
export function CcgTile({ size = 48, monochrome = false, className, title = 'Cool Crypto Games' }: MarkProps) {
  const uid = safeId(useId())
  const maskId = `ccg-tile-${uid}`
  const fill = monochrome ? 'currentColor' : '#4C7DFF'

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" role="img" aria-label={title} className={className}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="white" />
          {/* The empty lower-right quadrant is where the notch cuts, so the
              letters and the silhouette reinforce each other. */}
          <LetterCutter letter="C" x={8} y={8} />
          <LetterCutter letter="C" x={42} y={8} />
          <LetterCutter letter="G" x={8} y={42} />
        </mask>
      </defs>

      <path
        d="M22 4h56a18 18 0 0 1 18 18v42L64 96H22A18 18 0 0 1 4 78V22A18 18 0 0 1 22 4Z"
        fill={fill}
        mask={`url(#${maskId})`}
      />
    </svg>
  )
}

/** Horizontal lockup: mark plus the name on one or two lines. */
export function CcgWordmark({
  size = 40,
  monochrome = false,
  className,
  stacked = false,
  Mark = CcgTile,
}: MarkProps & { stacked?: boolean; Mark?: (p: MarkProps) => React.JSX.Element }) {
  return (
    <span className={`flex items-center gap-3 ${className ?? ''}`}>
      <Mark size={size} monochrome={monochrome} />
      {stacked ? (
        <span className="font-display text-[13px] leading-[1.05] font-bold tracking-[-0.02em] uppercase">
          <span className="block">Cool</span>
          <span className="block text-accent">Crypto</span>
          <span className="block">Games</span>
        </span>
      ) : (
        <span className="font-display text-[15px] leading-none font-bold tracking-[-0.02em] whitespace-nowrap uppercase">
          Cool <span className="text-accent">Crypto</span> Games
        </span>
      )}
    </span>
  )
}

/** Default mark used across the product. Change here to change it everywhere. */
export const CcgMonogram = CcgTile
