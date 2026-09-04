/**
 * Single place to change the site's identity.
 * Change a value here and it propagates to metadata, canonical URLs and the sitemap.
 */
export const site = {
  name: 'CoolCryptoGames',
  domain: 'coolcryptogames.fun',
  tagline: 'Games worth losing an afternoon to.',
  description:
    'A small studio building browser games you can start playing in one click.',
  get url() {
    return `https://${this.domain}`
  },
}
