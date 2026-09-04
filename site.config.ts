/**
 * Single place to change the site's identity.
 * Update `domain` to the domain you purchased — everything else reads from here.
 */
export const site = {
  name: 'CoolCryptoGames',
  domain: 'YOUR_DOMAIN.com',
  tagline: 'Games worth losing an afternoon to.',
  description:
    'A small studio building browser games you can start playing in one click.',
  get url() {
    return `https://${this.domain}`
  },
}
