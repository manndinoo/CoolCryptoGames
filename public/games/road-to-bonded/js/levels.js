'use strict';
/* BONDED - the 50-level campaign, data driven.
   Grid tokens (space separated, one per cell, combine with '+'):
   .  active   #  rug hole   d/D dust 1/2   p paper hands   f FUD cloud
   w/W/X sell wall 1/2/3   c capsule   e exit   k mint key   g<n> curve gate (needs n keys)
   n/N/M volume node 1/2/3 hits   b bot printer   q dead wallet (2x2)   h halt shield
   i<x>/o<x> liquidity portal entrance/exit pair x   ^ extra spawner   0-5 preset chip */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});

  const REGIONS = [
    { id: 1, name: 'LAUNCH LAB', from: 1, to: 10, tag: 'Bright cream terminal laboratory. Early mint lighting. Small chart movements.', theme: 'lab' },
    { id: 2, name: 'CURVE CLIMB', from: 11, to: 20, tag: 'A rising chart ridge with pullbacks, gates and locks. Sharper elevation.', theme: 'climb' },
    { id: 3, name: 'LIQUIDITY JUNCTION', from: 21, to: 30, tag: 'Dark exchange pipes, portals, order-flow lanes and shifting routes.', theme: 'junction' },
    { id: 4, name: 'SIGNAL CITY', from: 31, to: 40, tag: 'Night skyline. Radar dishes, ticker lights, FUD clouds, bots and billboards.', theme: 'city' },
    { id: 5, name: 'MARKET ORBIT', from: 41, to: 50, tag: 'A dark orbital terminal. Emerald chart constellations and the final bonding destination.', theme: 'orbit' },
  ];

  const row = (s) => s;
  const fill = (w, tok) => new Array(w).fill(tok).join(' ');
  const plain = (w, h) => new Array(h).fill(fill(w, '.'));

  const LEVELS = [
    { id: 1, name: 'First Mint', moves: 18, w: 6, h: 6, syms: 4, diff: 'EASY', grid: plain(6, 6),
      objectives: [{ t: 'collect', s: 0, n: 15 }], tutorial: 'swap' },
    { id: 2, name: 'Pick a Ticker', moves: 20, w: 7, h: 7, syms: 4, diff: 'EASY', grid: plain(7, 7),
      objectives: [{ t: 'collect', s: 1, n: 12 }, { t: 'collect', s: 2, n: 12 }], tutorial: 'goals' },
    { id: 3, name: 'Green Print', moves: 20, w: 7, h: 7, syms: 5, diff: 'EASY', grid: [
      '. . . . . . .', '. . . . . . .', '. d d d d d .', '. . . . . . .', '. d d d d d .', '. . . . . . .', '. . . . . . .'],
      objectives: [{ t: 'dust', n: 10 }], tutorial: 'dust' },
    { id: 4, name: 'Wick Test', moves: 20, w: 7, h: 8, syms: 5, diff: 'EASY', grid: [
      '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .', 'd d d . d d d', 'd d d . d d d', '. . . . . . .'],
      objectives: [{ t: 'candle', n: 1 }, { t: 'dust', n: 12 }], tutorial: 'candle' },
    { id: 5, name: 'First Holders', moves: 21, w: 7, h: 8, syms: 5, diff: 'EASY', grid: [
      '. . . . . . .', '. . . . . . .', '. . . . . . .', 'p . p . p . p', '. . . . . . .', '. p . . . p .', '. . . . . . .', '. . . . . . .'],
      objectives: [{ t: 'paper', n: 6 }, { t: 'collect', s: 0, n: 15 }], tutorial: 'paper' },
    { id: 6, name: 'BONDED', moves: 22, w: 7, h: 8, syms: 5, cap: 40, diff: 'EASY', grid: [
      '. . . . . . .', '. . . . . . .', 'd d d d d d d', 'd d d d d d d', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .'],
      objectives: [{ t: 'bonded', n: 1 }, { t: 'dust', n: 14 }], tutorial: 'bonded' },
    { id: 7, name: 'Opening Volume', moves: 22, w: 7, h: 8, syms: 5, diff: 'EASY', grid: [
      '. c . . . c .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .', 'e e e e e e e'],
      objectives: [{ t: 'capsule', n: 2 }], capsules: { total: 2, cols: [], maxOn: 2 }, tutorial: 'capsule' },
    { id: 8, name: 'Launch Queue', moves: 23, w: 7, h: 8, syms: 5, diff: 'EASY', grid: plain(7, 8),
      objectives: [{ t: 'burst', n: 1 }, { t: 'collect', s: 4, n: 18 }], tutorial: 'burst' },
    { id: 9, name: 'Curve Starts', moves: 23, w: 7, h: 8, syms: 5, diff: 'EASY', grid: [
      '# c . . . . #', '. . . . . . .', '. . . . . . .', '. . . # . . .', '. . . # . . .', '. . . . . . .', '. . . . . . .', '# e e e e e #'],
      objectives: [{ t: 'capsule', n: 3 }], capsules: { total: 3, cols: [1, 5], maxOn: 2 }, tutorial: 'holes' },
    { id: 10, name: 'Go Live', moves: 26, w: 8, h: 8, syms: 5, diff: 'HARD', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . d d d d . .', '. d d D D d d .', 'd D . . . . D d', 'd D . . . . D d', 'd . . e e . . d'],
      objectives: [{ t: 'dust', n: 26 }, { t: 'capsule', n: 2 }], capsules: { total: 2, cols: [3, 4], maxOn: 1 } },

    { id: 11, name: 'Buy Pressure', moves: 22, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', '. p . . . p .', '. . . p . . .', '. . . . . . .', 'p . . p . . p', '. . . . . . .', '. . p . p . .', '. . . . . . .'],
      objectives: [{ t: 'paper', n: 8 }] },
    { id: 12, name: 'Narrow Range', moves: 23, w: 6, h: 9, syms: 5, diff: 'NORMAL', grid: [
      '# . . . . #', '. . . . . .', '. p . . p .', 'p . . p . p', '. . p . p .', '. p . . p .', 'p . . p . p', '. . . . . .', '# . . . . #'],
      objectives: [{ t: 'paper', n: 12 }, { t: 'collect', s: 3, n: 18 }] },
    { id: 13, name: 'Paper Test', moves: 24, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. c . c . c .', '. . . . . . .', '. . . . . . .', 'p p p p p p p', '. . . . . . .', '. . . p . . .', '. . . . . . .', 'e e e e e e e'],
      objectives: [{ t: 'capsule', n: 3 }, { t: 'paper', n: 8 }], capsules: { total: 3, cols: [], maxOn: 3 } },
    { id: 14, name: 'Dip Test', moves: 24, w: 8, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . # # . . .', '. . . # # . . .', '. . . # # . . .', '. . . # # . . .', '. . . . . . . .', 'd D d . . d D d', 'D d D . . D d D', 'd D d . . d D d'],
      objectives: [{ t: 'dust', n: 26 }] },
    { id: 15, name: 'Locked Liquidity', moves: 24, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', '. . . . . . .', '. W . . . W .', '. . . W . . .', 'W . . . . . W', '. . . W . . .', '. W . . . W .', '. . . . . . .'],
      objectives: [{ t: 'wall', n: 8 }, { t: 'collect', s: 1, n: 20 }], tutorial: 'wall' },
    { id: 16, name: 'Curve Bend', moves: 25, w: 7, h: 9, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', '. . . . . . .', '. . . k . . .', '. . . . . . .', '# # g3 g3 g3 # #', '# . . . . . #', '# . . . . . #', '# . . . . . #', '# . e e e . #'],
      objectives: [{ t: 'keys', n: 3 }, { t: 'capsule', n: 2 }], keys: { total: 3, cols: [3], maxOn: 1 }, capsules: { total: 2, cols: [3], maxOn: 1 }, tutorial: 'keys' },
    { id: 17, name: 'False Breakout', moves: 25, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', '. . . . . . .', 'D D D D D D .', '. . . . . . .', '. . . . . . .', '. D D D D D D', '. . . . . . .', '. . . . . . .'],
      objectives: [{ t: 'candle', n: 3 }, { t: 'dust', n: 24 }] },
    { id: 18, name: 'Sell Wall', moves: 25, w: 5, h: 9, syms: 5, diff: 'NORMAL', grid: [
      '. . . . .', 'W . W . W', '. . . . .', 'W . W . W', '. . . . .', 'W . W . W', '. . . . .', 'W . W . W', '. . . . .'],
      objectives: [{ t: 'wall', n: 12 }] },
    { id: 19, name: 'Last Percent', moves: 26, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', 'p . . p . . p', '. N . . . N .', '. . . p . . .', 'p . . . . . p', '. N . . . N .', '. . . p . . .', '. . . p . . .'],
      objectives: [{ t: 'node', n: 4 }, { t: 'paper', n: 8 }], tutorial: 'node' },
    { id: 20, name: 'Bond Point', moves: 28, w: 8, h: 9, syms: 5, diff: 'HARD', grid: [
      '. . c . . c . .', '. . . . . . . .', '. p . . . . p .', '. . p . . p . .', 'p . . p p . . p', '. . p . . p . .', '. p D D D D p .', 'D D . . . . D D', 'D+e e e e e e e D+e'],
      objectives: [{ t: 'capsule', n: 4 }, { t: 'paper', n: 12 }, { t: 'dust', n: 20 }], capsules: { total: 4, cols: [2, 5], maxOn: 2 } },

    { id: 21, name: 'Pair Created', moves: 23, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: plain(7, 8),
      objectives: [{ t: 'lane', n: 20 }], lanes: [{ row: 4, dir: 1 }], tutorial: 'lane' },
    { id: 22, name: 'Pool Depth', moves: 24, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', '. . . . . . .', '. . . . . . .', 'd d d d d d d', 'd d d d d d d', '. . . . . . .', '. d d . d d .', '. . . . . . .'],
      objectives: [{ t: 'dust', n: 18 }], lanes: [{ row: 2, dir: 1 }, { row: 5, dir: -1 }] },
    { id: 23, name: 'Slippage', moves: 24, w: 7, h: 9, syms: 5, diff: 'NORMAL', grid: [
      'ob . . . . oa .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. ia . . . e ib'],
      objectives: [{ t: 'capsule', n: 2 }], capsules: { total: 2, cols: [1], maxOn: 1 }, tutorial: 'portal' },
    { id: 24, name: 'Red Barrier', moves: 25, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', '. . . . . . .', '. . . . . . .', 'w w w . w w w', '. . . . . . .', 'w w w . w w w', '. . . . . . .', '. . e e e . .'],
      objectives: [{ t: 'wall', n: 12 }, { t: 'capsule', n: 2 }], capsules: { total: 2, cols: [3], maxOn: 1 } },
    { id: 25, name: 'Route Split', moves: 25, w: 7, h: 9, syms: 5, diff: 'HARD', grid: [
      '. ob . . . . oa', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . # . # . .', '. . . # . . .', '. . . # . . .', '. . . # . . .', 'ia . e # e . ib'],
      objectives: [{ t: 'capsule', n: 3 }], capsules: { total: 3, cols: [3], maxOn: 1 } },
    { id: 26, name: 'FUD Lock', moves: 23, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', '. . . . . . .', '. f . . . f .', '. . . f . . .', '. . . f . . .', 'f . . . . . f', '. . . . . . .', '. . . . . . .'],
      objectives: [{ t: 'fud' }], fud: { cap: 4, every: 3 }, tutorial: 'fud' },
    { id: 27, name: 'Whale Wake', moves: 25, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', '. f . . . f .', '. . . f . . .', 'f . . . . . f', '. . f . f . .', 'f . . . . . f', '. . . f . . .', '. . . . . . .'],
      objectives: [{ t: 'fud' }, { t: 'collect', s: 0, n: 15 }], fud: { cap: 5, every: 3 } },
    { id: 28, name: 'Crossed Orders', moves: 26, w: 8, h: 9, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '# # # e e # # #'],
      objectives: [{ t: 'capsule', n: 4 }], capsules: { total: 4, cols: [0, 7], maxOn: 2 }, lanes: [{ row: 7, dir: 1 }, { row: 4, dir: -1 }] },
    { id: 29, name: 'Deep Book', moves: 26, w: 8, h: 8, syms: 5, diff: 'NORMAL', grid: [
      'D D . . . . D D', 'D . . . . . . D', '. . w w w w . .', '. . w . . w . .', '. . w . . w . .', '. . w w w w . .', 'D . . . . . . D', 'D D . . . . D D'],
      objectives: [{ t: 'wall', n: 12 }, { t: 'dust', n: 24 }] },
    { id: 30, name: 'Market Open', moves: 28, w: 8, h: 9, syms: 5, diff: 'HARD', grid: [
      '. . . . . . . .', '. f . . . . f .', '. . w . . w . .', 'f . w . . w . f', '. . . . . . . .', 'f . w . . w . f', '. . w . . w . .', '. f . . . . f .', 'w . . e e . . w'],
      objectives: [{ t: 'capsule', n: 3 }, { t: 'wall', n: 10 }, { t: 'fud' }], capsules: { total: 3, cols: [3, 4], maxOn: 1 }, fud: { cap: 5, every: 3 } },

    { id: 31, name: 'First Signal', moves: 24, w: 7, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . .', '. . . . . . .', '. . . . . . .', '. b . . . b .', '. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . . . . .'],
      objectives: [{ t: 'printer', n: 2 }], tutorial: 'printer' },
    { id: 32, name: 'Reply Chain', moves: 26, w: 8, h: 8, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . b . . b . .', '. . . . . . . .', '. . . . . . . .', '. . . b . . . .', '. . . . . . . .', '. . . . . . . .'],
      objectives: [{ t: 'printer', n: 3 }, { t: 'wallall' }] },
    { id: 33, name: 'Feed Noise', moves: 27, w: 8, h: 9, syms: 5, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '# q q . . q q #', '# q+e q+e # # q+e q+e #'],
      objectives: [{ t: 'wallet', n: 2 }, { t: 'capsule', n: 4 }], capsules: { total: 4, cols: [1, 6], maxOn: 2 }, tutorial: 'wallet' },
    { id: 34, name: 'Bot Stack', moves: 27, w: 8, h: 8, syms: 6, diff: 'NORMAL', grid: plain(8, 8),
      objectives: [{ t: 'collect', s: 0, n: 22 }, { t: 'collect', s: 5, n: 22 }], tutorial: 'sixth' },
    { id: 35, name: 'FUD Front', moves: 27, w: 8, h: 8, syms: 6, diff: 'HARD', grid: [
      '. . . . . . . .', '. . . . . . . .', '. f f . . f f .', 'f q q f f q q f', 'f q q . . q q f', '. f f . . f f .', '. . . . . . . .', '. . . . . . . .'],
      objectives: [{ t: 'fud' }], fud: { cap: 6, every: 3 } },
    { id: 36, name: 'Trend Chase', moves: 28, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . oa ob . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', 'ia e e e e e e ib'],
      objectives: [{ t: 'capsule', n: 5 }], capsules: { total: 5, cols: [0, 7], maxOn: 2 }, lanes: [{ row: 3, dir: 1 }, { row: 6, dir: -1 }] },
    { id: 37, name: 'Hype Relay', moves: 29, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'q q . . . . q q', 'q q . . . . q q', '. . . g2 g2 . . .', '. . . . . . . .', 'q q . . . . . .', 'q q . g4 g4 . . .', '. . . . . . . .', '. . . . . . . .'],
      objectives: [{ t: 'keys', n: 4 }, { t: 'wallet', n: 3 }], keys: { total: 4, cols: [3, 4], maxOn: 1 }, wallets: { contents: 'keys' } },
    { id: 38, name: 'Signal Jam', moves: 28, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . p p . . .', 'p . p . . p . p', '. p . p p . p .', '. D D D D D D .', 'D D D D D D D D', 'D D D D D D D D', 'D D D D D D D D', '. . . . . . . .'],
      objectives: [{ t: 'paper', n: 10 }, { t: 'dust', n: 60 }] },
    { id: 39, name: 'Breakout', moves: 29, w: 8, h: 8, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. f . . . . f .', '. . f . . f . .', 'f . . f f . . f', 'f . . f f . . f', '. . f . . f . .', '. f . . . . f .', '. . . . . . . .'],
      objectives: [{ t: 'combo', n: 2 }, { t: 'fud' }], fud: { cap: 4, every: 3 }, tutorial: 'combo' },
    { id: 40, name: 'Front Page', moves: 30, w: 8, h: 9, syms: 6, diff: 'HARD', grid: [
      '. . . . . . . .', '. . f . . f . .', 'q q . . . . q q', 'q q f . . f q q', '. . . . . . . .', 'q q f . . f q q', 'q q . . . . q q', '. . f . . f . .', '. . . e e . . .'],
      objectives: [{ t: 'wallet', n: 4 }, { t: 'fud' }, { t: 'capsule', n: 3 }], capsules: { total: 3, cols: [3, 4], maxOn: 1 }, fud: { cap: 5, every: 3 } },

    { id: 41, name: 'High Wick', moves: 27, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '# # # # # # . .', '# # # # # . . .', '# # # # . . . .', '# # # . . . . .', '# # D D D D . .', '# D D D D D D .', 'D D D D D D D #', 'D D D D D D # #', 'D D D D D # # #'],
      objectives: [{ t: 'dust', n: 56 }] },
    { id: 42, name: 'Volatility Gate', moves: 28, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . oa ob . . .', '. . . . . . . .', '. . p . . p . .', '. . . p p . . .', '. . p . . p . .', '. . . p p . . .', '. . p . . p . .', '. . . p p . . .', 'ia . . e e . . ib'],
      objectives: [{ t: 'capsule', n: 5 }, { t: 'paper', n: 12 }], capsules: { total: 5, cols: [0, 7], maxOn: 2 } },
    { id: 43, name: 'Red Zone', moves: 28, w: 8, h: 8, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . h . . h . .', 'd d . d d . d d', 'h d d . . d d h', '. d . d d . d .', 'd . d h h d . d', '. d . . . . d .'],
      objectives: [{ t: 'halt', n: 6 }, { t: 'dust', n: 20 }], tutorial: 'halt' },
    { id: 44, name: 'Holder Test', moves: 29, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. f . . . . f .', '. . . . . . . .', 'f . f . . f . f', '. . . . . . . .', 'f . . . . . . f', '. . . . . . . .', '. f . f . f f .', '. . e e e e . .'],
      objectives: [{ t: 'fud' }, { t: 'capsule', n: 3 }], capsules: { total: 3, cols: [3, 4], maxOn: 1 }, fud: { cap: 4, every: 3 }, lanes: [{ row: 2, dir: 1 }, { row: 6, dir: -1 }] },
    { id: 45, name: 'Whale Order', moves: 29, w: 8, h: 8, syms: 6, diff: 'HARD', grid: [
      '. . . . . . . .', 'q q . . . . q q', 'q q . . . . q q', '. . . . . . . .', '. . . . . . . .', 'q q . . . . q q', 'q q . . . . q q', '. . . . . . . .'],
      objectives: [{ t: 'sweep', n: 2 }, { t: 'wallet', n: 4 }], tutorial: 'sweep' },
    { id: 46, name: 'Liquidity Crunch', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      'D D D # # D D D', 'D D D # # D D D', 'D D D # # D D D', '. ia ib # # ic id .', '# # # # # # # #', '# # oa ob oc od # #', '# # D D D D # #', '# # D D D D # #', '# # D D D D # #'],
      objectives: [{ t: 'dust', n: 60 }] },
    { id: 47, name: 'Reversal', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. h . . . . h .', '. . h g2 g2 h . .', '. . . . . . . .', '. h . . . . h .', '. . h g4 g4 h . .', '. . . . . . . .', 'e e e e e e e e'],
      objectives: [{ t: 'keys', n: 4 }, { t: 'halt', n: 8 }, { t: 'capsule', n: 5 }], keys: { total: 4, cols: [3, 4], maxOn: 1 }, capsules: { total: 5, cols: [1, 6], maxOn: 2 } },
    { id: 48, name: 'Breakout Test', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'q q f . . f q q', 'q q . . . . q q', 'f . . f f . . f', '. . . . . . . .', 'f . . f f . . f', 'q q . . . . q q', 'q q f . . f q q', '. . . . . . . .'],
      objectives: [{ t: 'fud' }, { t: 'wallet', n: 4 }, { t: 'combo', n: 1 }], fud: { cap: 5, every: 3 } },
    { id: 49, name: 'Final Curve', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. h . . . . h .', 'h . . . . . . h', '. h . . . . h .', 'h . . . . . . h', 'D D D D D D D D', 'D D D D D D D D', 'D D D D D D D D', 'e e e e e e e e'],
      objectives: [{ t: 'capsule', n: 5 }, { t: 'halt', n: 8 }, { t: 'dust', n: 48 }], capsules: { total: 5, cols: [2, 3, 4, 5], maxOn: 2 }, cap: 90 },
    { id: 50, name: 'All-Time High', moves: 34, w: 8, h: 9, syms: 6, diff: 'FINALE', grid: [
      '. . . . . . . .', '. . . . . . . .', 'q q . . . . q q', 'q q . . . . q q', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .'],
      objectives: [{ t: 'keys', n: 4 }, { t: 'wallet', n: 2 }], keys: { total: 4, cols: [3, 4], maxOn: 1 }, wallets: { contents: 'keys' }, tutorial: 'finale',
      stages: [{
        grid: [
          '. . . . . . . .', '. f . . . . f .', '. . f . . f . .', 'f . . f f . . f', '. . . . . . . .', 'f . . f f . . f', '. . f . . f . .', '. f . . . . f .', 'e e e e e e e e'],
        objectives: [{ t: 'capsule', n: 6 }, { t: 'fud' }], capsules: { total: 6, cols: [1, 3, 4, 6], maxOn: 2 }, fud: { cap: 6, every: 3 },
      }] },
  ];

  for (const L of LEVELS) {
    L.region = REGIONS.find(r => L.id >= r.from && L.id <= r.to).id;
    if (!L.cap) L.cap = [55, 55, 75, 100, 120, 140][L.region];
    if (!L.thresholds) L.thresholds = [Math.round(L.moves * 170), Math.round(L.moves * 300)];
    L.milestone = L.id % 10 === 0;
  }

  RTB.LEVELS = LEVELS;
  RTB.REGIONS = REGIONS;
  RTB.levelById = (id) => LEVELS.find(l => l.id === id);
  RTB.regionOf = (id) => REGIONS.find(r => id >= r.from && id <= r.to);
  void row; void fill;
})();
