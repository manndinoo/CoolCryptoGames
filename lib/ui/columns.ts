/**
 * Column count for a grid, chosen by how much is in it.
 *
 * A fixed multi-column grid holding fewer items than columns renders the items
 * and then a row of holes, which reads as a page that failed rather than as a
 * page with two things on it. Matching the columns to the content keeps the row
 * full at any size of catalogue, and the grid widens on its own as more arrives.
 *
 * Returned as whole class strings rather than assembled from a template, because
 * Tailwind scans source text for class names and never sees an interpolated one.
 */
const BY_COUNT: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
}

export function gridColumns(count: number, max: 2 | 3 = 3): string {
  if (count >= max) return BY_COUNT[max]
  return BY_COUNT[Math.max(count, 1)] ?? BY_COUNT[max]
}
