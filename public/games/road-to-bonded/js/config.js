'use strict';
/* Deployment configuration. Edit this file before publishing an update. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  RTB.CONFIG = {
    /* Highest main-campaign level currently released. Levels above this stay
       locked on the roadmap ("NEXT UPDATE") even though they ship in the code.
       Raise to 100 when you post the second campaign. */
    releasedLevels: 50,

    /* ---- Store ----
       Removed for the Cool Crypto Games build. js/store.js is a permanently
       closed stub; setting a treasury here does nothing. Purchased lives and
       attempts are excluded mechanics on this platform. */
    treasury: '',
    /* RPC endpoint used to fetch a recent blockhash and confirm transfers. */
    rpc: 'https://api.mainnet-beta.solana.com',
    /* Price packs: dollar equivalents; converted to SOL at purchase time. */
    packs: [
      { lives: 1, usd: 1 },
      { lives: 3, usd: 2 },
      { lives: 5, usd: 4 },
      { lives: 10, usd: 8 },
    ],
    /* Live SOL/USD price source, plus a fallback used only when the fetch fails. */
    priceUrl: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    solUsdFallback: 150,
    /* Solana web3 library (IIFE build) loaded lazily when the store opens. */
    web3Url: 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.3/lib/index.iife.min.js',
  };
})();
