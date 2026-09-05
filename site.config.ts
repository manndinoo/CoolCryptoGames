/**
 * Site identity. Values mirror config/design-tokens.json `brand`.
 */
export const site = {
  name: 'Cool Crypto Games',
  shortName: 'CCG',
  domain: 'coolcryptogames.fun',
  tagline: 'Games first. Crypto native.',
  productLine: 'Browse freely. Play freely. Connect to keep your progress. Never pay to play.',
  description:
    'A curated browser gaming network. Browse, watch and play without a wallet — connect one when you want your progress and your scores to follow you.',
  get url() {
    return `https://${this.domain}`
  },
}
