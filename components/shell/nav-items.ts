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
