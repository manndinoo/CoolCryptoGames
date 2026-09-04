/**
 * Stream embed allow-list.
 *
 * Phase 1 carries approved external embeds only — no open broadcasting. An
 * embed URL reaches an iframe, so this is the boundary that decides which
 * origins may run inside the page. It is deliberately strict and deliberately
 * boring.
 */

export type EmbedCheck = { allowed: true; url: string } | { allowed: false; reason: string }

/** Hosts come from ALLOWED_STREAM_EMBED_HOSTS as a comma-separated list. */
export function allowedHosts(): string[] {
  return (process.env.ALLOWED_STREAM_EMBED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Whether an embed URL may be framed.
 *
 * The subdomain rule is the part worth reading twice. Matching with
 * `endsWith(host)` would accept `evil-youtube.com` for an allow-list entry of
 * `youtube.com`, because the string does end that way. A subdomain match must
 * test for the dot separator explicitly, so only `player.youtube.com` style
 * hosts pass and a lookalike registration does not.
 */
export function checkEmbedUrl(rawUrl: string, hosts: string[] = allowedHosts()): EmbedCheck {
  if (hosts.length === 0) return { allowed: false, reason: 'no_allowlist_configured' }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { allowed: false, reason: 'malformed_url' }
  }

  // Framing anything over plain HTTP would break the page's security context.
  if (url.protocol !== 'https:') return { allowed: false, reason: 'not_https' }

  // Credentials in a URL are never legitimate here and confuse host parsing.
  if (url.username || url.password) return { allowed: false, reason: 'credentials_in_url' }

  const host = url.hostname.toLowerCase()
  const match = hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  if (!match) return { allowed: false, reason: 'host_not_allowed' }

  return { allowed: true, url: url.toString() }
}
