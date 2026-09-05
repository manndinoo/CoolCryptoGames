import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

function ruleBody(selector: string): string {
  const at = css.indexOf(`${selector} {`)
  expect(at, `${selector} is missing from globals.css`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

/**
 * A guard on a failure that leaves no trace.
 *
 * `.ccg-reveal` wraps every page and `.ccg-stagger` wraps list sections, so
 * both are ancestors of most of the site. An animation on them that fills
 * forwards keeps an animated `transform` applied for the life of the element,
 * and a filled `transform: none` computes to the identity matrix rather than to
 * the keyword. Any transform but the keyword makes the element the containing
 * block for its `position: fixed` descendants — which silently boxed the
 * fullscreen game stage inside the content column, with no error anywhere and
 * nothing visibly wrong until you measured it.
 *
 * The stage renders through a portal now and no longer depends on this, but the
 * next fixed thing somebody writes will, so the trap is worth keeping shut.
 */
describe('page-level animation wrappers', () => {
  for (const selector of ['.ccg-reveal', '.ccg-stagger > *']) {
    it(`${selector} does not fill forwards`, () => {
      const body = ruleBody(selector)
      expect(body).toContain('animation:')
      expect(body).not.toMatch(/\bforwards\b/)
      expect(body).not.toMatch(/\bboth\b/)
    })
  }

  it('the keyframes they run still end at no transform', () => {
    const at = css.indexOf('@keyframes ccg-rise')
    expect(at).toBeGreaterThan(-1)
    expect(css.slice(at, at + 300)).toContain('transform: none')
  })
})
