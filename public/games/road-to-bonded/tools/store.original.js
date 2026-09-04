'use strict';
/* Store: buy lives with SOL through an injected Solana wallet (Phantom,
   Solflare, or any window.solana provider). Prices are dollar packs
   converted to SOL at the live rate when you buy. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  const C = () => RTB.CONFIG;
  let priceCache = { usd: 0, at: 0 }; let web3Promise = null;

  function provider() {
    const w = window;
    return (w.phantom && w.phantom.solana) || w.solana || w.solflare || (w.backpack && w.backpack.solana) || null;
  }
  function shortKey(k) { return k ? k.slice(0, 4) + '…' + k.slice(-4) : ''; }

  async function price() {
    if (priceCache.usd && Date.now() - priceCache.at < 5 * 60 * 1000) return priceCache;
    try {
      const r = await fetch(C().priceUrl, { cache: 'no-store' }); const j = await r.json();
      const usd = j && j.solana && j.solana.usd; if (usd > 0) { priceCache = { usd, at: Date.now(), live: true }; return priceCache; }
    } catch { /* fall through */ }
    priceCache = { usd: C().solUsdFallback, at: Date.now(), live: false }; return priceCache;
  }
  function lamportsFor(usd, solUsd) { return Math.max(1, Math.round(usd / solUsd * 1e9)); }
  function fmtSol(lamports) { return (lamports / 1e9).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + ' SOL'; }

  function loadWeb3() {
    if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3);
    if (web3Promise) return web3Promise;
    web3Promise = new Promise((res, rej) => { const s = document.createElement('script'); s.src = C().web3Url; s.async = true; s.onload = () => window.solanaWeb3 ? res(window.solanaWeb3) : rej(new Error('web3 did not load')); s.onerror = () => rej(new Error('Could not load the Solana library. Check your connection.')); document.head.appendChild(s); });
    return web3Promise;
  }

  async function connect() {
    const p = provider(); if (!p) throw new Error('No Solana wallet found. Install Phantom or Solflare, then reload.');
    const r = await p.connect(); const key = (r && r.publicKey ? r.publicKey : p.publicKey).toString();
    return { provider: p, key };
  }

  /* Buys a pack: returns { signature, lives }. Throws with a readable message on failure. */
  async function buy(pack) {
    if (!C().treasury) throw new Error('The store is not open yet.');
    const { provider: p, key } = await connect();
    const web3 = await loadWeb3(); const pr = await price();
    const lamports = lamportsFor(pack.usd, pr.usd);
    const conn = new web3.Connection(C().rpc, 'confirmed');
    const from = new web3.PublicKey(key); const to = new web3.PublicKey(C().treasury);
    const tx = new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
    const bh = await conn.getLatestBlockhash('confirmed'); tx.recentBlockhash = bh.blockhash; tx.feePayer = from;
    const sent = await p.signAndSendTransaction(tx); const signature = typeof sent === 'string' ? sent : sent.signature;
    const conf = await conn.confirmTransaction({ signature, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
    if (conf && conf.value && conf.value.err) throw new Error('The transaction failed on-chain.');
    return { signature, lives: pack.lives, lamports, key };
  }

  RTB.Store = { provider, connect, price, buy, lamportsFor, fmtSol, shortKey, isOpen: () => !!C().treasury };
})();
