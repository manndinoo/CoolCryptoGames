/**
 * CCG letterforms.
 *
 * Drawn as stroked geometry rather than set in a typeface, so the mark carries
 * no font licence, renders identically everywhere, and keeps its proportions
 * when scaled to a favicon. Each letter is drawn inside a 48x48 box with a
 * consistent stroke weight so the three can be composed without optical drift.
 */

export const LETTER_BOX = 48
const STROKE = 9

/** Squared-off C: a rounded rectangle opened on the right. */
export const PATH_C = 'M34 13 H21 a8 8 0 0 0 -8 8 v6 a8 8 0 0 0 8 8 h13'

/** The same shape with a tongue turned back in, making a G. */
export const PATH_G = 'M34 13 H21 a8 8 0 0 0 -8 8 v6 a8 8 0 0 0 8 8 h13 v-7 h-6'

type LetterProps = {
  letter: 'C' | 'G'
  color: string
  /** Width of the background-coloured halo drawn beneath, for overlap gaps. */
  knockout?: number
  knockoutColor?: string
}

export function Letter({ letter, color, knockout = 0, knockoutColor = '#0B0C0F' }: LetterProps) {
  const d = letter === 'G' ? PATH_G : PATH_C
  return (
    <>
      {knockout > 0 && (
        <path
          d={d}
          fill="none"
          stroke={knockoutColor}
          strokeWidth={STROKE + knockout}
          strokeLinecap="butt"
        />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="butt" />
    </>
  )
}
