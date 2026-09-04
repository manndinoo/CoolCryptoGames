/**
 * Site identity. Values mirror config/design-tokens.json `brand`.
 */
export const site = {
  name: 'Cool Crypto Games',
  shortName: 'CCG',
  domain: 'coolcryptogames.fun',
  tagline: 'Games first. Crypto native.',
  productLine: 'Browse freely. Watch freely. Connect to play. Never pay to play.',
  description:
    'A curated browser gaming network. Browse, watch and discover without a wallet — connect one only when you press play.',
  get url() {
    return `https://${this.domain}`
  },
}
