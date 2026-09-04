'use strict';
/* CCG build: the store is removed, not merely switched off.
 *
 * The original module bought lives with real SOL through an injected wallet
 * provider. Every part of that conflicts with the founding product rules:
 *
 *   - "Purchased tournament lives or attempts" is an excluded mechanic
 *   - "Purchased competitive power" is an excluded mechanic
 *   - "Undisclosed wallet transactions or approvals" is excluded, and the SDK
 *     contract states a game may never initiate a wallet transaction
 *   - the product line is "never pay to play"
 *
 * Leaving the code in place with an empty treasury would put the whole flow one
 * config edit away from being live, so the implementation is replaced with a
 * permanently-closed stub that keeps the same shape. Nothing here touches a
 * wallet provider, fetches a price, or loads a web3 library.
 *
 * The frame is also sandboxed without allow-same-origin, so a wallet provider
 * would not be reachable from here anyway. This is the belt to that braces:
 * isolation should not be the only thing preventing a payment.
 *
 * The original is preserved at tools/store.original.js for reference.
 */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});

  function closed() {
    throw new Error('Purchases are not part of Cool Crypto Games. You never pay to play.');
  }

  RTB.Store = {
    isOpen: () => false,
    provider: () => null,
    connect: closed,
    buy: closed,
    price: async () => ({ usd: 0, at: Date.now(), live: false }),
    lamportsFor: () => 0,
    fmtSol: () => '',
    shortKey: (k) => (k ? k.slice(0, 4) + '…' + k.slice(-4) : ''),
  };
})();
