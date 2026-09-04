export type NavItem = { href: string; label: string }

/** Desktop navigation. Mirrors the approved hybrid direction. */
export const primaryNav: NavItem[] = [
  { href: '/games', label: 'Games' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/live', label: 'Live' },
  { href: '/developers', label: 'Developers' },
  { href: '/leaderboards', label: 'Leaderboards' },
]

/**
 * The desktop sidebar, in two groups.
 *
 * Grouped rather than run together because the first group is the product and
 * the second is your account. A flat list of eight makes a reader scan all
 * eight to find either; two labelled groups of four and two makes the target
 * obvious before they read a single item.
 *
 * Every row here is a real destination. A sidebar is the one place a user
 * trusts to be a complete map of the site, so a disabled or "coming soon" row
 * would make the whole map suspect.
 */
export const sidebarNav: { label: string; items: NavItem[] }[] = [
  {
    label: 'Play',
    items: [
      { href: '/', label: 'Home' },
      { href: '/games', label: 'Games' },
      { href: '/tournaments', label: 'Tournaments' },
      { href: '/live', label: 'Live' },
    ],
  },
  {
    label: 'Compete',
    items: [
      { href: '/leaderboards', label: 'Leaderboards' },
      { href: '/developers', label: 'Developers' },
    ],
  },
  {
    label: 'You',
    items: [
      { href: '/profile', label: 'Profile' },
      { href: '/settings', label: 'Settings' },
    ],
  },
]

/**
 * Mobile bottom navigation — four thumb-sized destinations.
 *
 * Deliberately not the desktop list: the reference direction and acceptance
 * test F both require that desktop navigation is not squeezed into mobile.
 * Everything not here is reachable from the pages these lead to.
 */
export const bottomNav: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/games', label: 'Games' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/profile', label: 'Profile' },
]
