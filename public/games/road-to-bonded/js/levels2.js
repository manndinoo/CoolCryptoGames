'use strict';
/* BONDED - second campaign (levels 51-100) across five new maps, plus the
   bonus side levels. Same token grammar as levels.js. Gated by
   RTB.CONFIG.releasedLevels until the update is posted. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});
  const plain = (w, h) => new Array(h).fill(new Array(w).fill('.').join(' '));

  RTB.REGIONS.push(
    { id: 6, name: 'WHALE WATERS', from: 51, to: 60, tag: 'Deep ocean order flow. Whales, bubbles, undertow lanes and sunken liquidity.', theme: 'ocean' },
    { id: 7, name: 'LEVERAGE CANYON', from: 61, to: 70, tag: 'Red rock and heat haze. Margin calls, dust devils and cliff-edge gates.', theme: 'canyon' },
    { id: 8, name: 'AIRDROP ALPS', from: 71, to: 80, tag: 'Snow peaks, parachutes and whiteouts. Ice shelves that only specials can break.', theme: 'alps' },
    { id: 9, name: 'MELTDOWN CORE', from: 81, to: 90, tag: 'Magma chambers and halt storms. Everything prints, spreads and burns.', theme: 'core' },
    { id: 10, name: 'DIAMOND HANDS', from: 91, to: 100, tag: 'A crystal cavern at the top of the curve. Hold through the final facets.', theme: 'diamond' },
  );

  const L2 = [
    { id: 51, name: 'Deep Dive', moves: 28, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', 'd d . . . . d d', 'd D d . . d D d', 'D D D d d D D D', 'd D d . . d D d', 'd d . . . . d d', '. . . . . . . .'],
      objectives: [{ t: 'dust', n: 38 }, { t: 'collect', s: 1, n: 20 }] },
    { id: 52, name: 'Bubble Trap', moves: 28, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. p . . . . p .', '. . p . . p . .', 'p . . p p . . p', '. . p . . p . .', '. p . . . . p .', 'p . . p p . . p', '. . . . . . . .', '. . e e e e . .'],
      objectives: [{ t: 'paper', n: 16 }, { t: 'capsule', n: 3 }], capsules: { total: 3, cols: [3, 4], maxOn: 2 } },
    { id: 53, name: 'Whale Alert', moves: 29, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', 'q q . . . . q q', 'q q . . . . q q', '. . . . . . . .', '. . . q q . . .', '. . . q q . . .', '. . . . . . . .', 'e e e e e e e e'],
      objectives: [{ t: 'wallet', n: 3 }, { t: 'capsule', n: 3 }, { t: 'collect', s: 2, n: 18 }], wallets: { contents: 'capsule' }, capsules: { total: 3, cols: [], maxOn: 3 } },
    { id: 54, name: 'Undertow', moves: 29, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', 'd d d d d d d d', 'd d d d d d d d', '. . . . . . . .', 'd d d d d d d d', '. . . . . . . .', '. . . . . . . .'],
      objectives: [{ t: 'dust', n: 24 }], lanes: [{ row: 2, dir: 1 }, { row: 5, dir: -1 }, { row: 7, dir: 1 }] },
    { id: 55, name: 'Kelp Lock', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. f . . . . f .', '. . X . . X . .', 'f . . . . . . f', '. X . . . . X .', 'f . . . . . . f', '. . X . . X . .', '. f . . . . f .', '. . X . . X . .'],
      objectives: [{ t: 'wall', n: 8 }, { t: 'fud' }], fud: { cap: 5, every: 3 } },
    { id: 56, name: 'Sonar', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. p . . . . p .', '. . M . . M . .', 'p . . . . . . p', '. . . M . . . .', 'p . . . . . . p', '. . M . . M . .', '. p . . . . p .', '. . . p p . . .'],
      objectives: [{ t: 'node', n: 5 }, { t: 'paper', n: 10 }] },
    { id: 57, name: 'Tide Portal', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      'oc . . oa ob . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', 'ia . . e e . . ib'],
      objectives: [{ t: 'capsule', n: 4 }], capsules: { total: 4, cols: [0, 7], maxOn: 2 }, gridPortalC: true },
    { id: 58, name: 'Blowhole', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. b . . . . b .', '. . . . . . . .', '. . . . . . . .', '. . . b . . . .', 'd d . . . . d d', 'd d d . . d d d', 'd d d d d d d d'],
      objectives: [{ t: 'printer', n: 3 }, { t: 'wallall' }, { t: 'dust', n: 18 }] },
    { id: 59, name: 'Trench', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '# . . . . . . #', '# . h . . h . #', '# . . . . . . #', '# h . . . . h #', '# . . . . . . #', '# . h . . h . #', '# . . . . . . #', '# . . . . . . #', '# . e e e e . #'],
      objectives: [{ t: 'halt', n: 6 }, { t: 'capsule', n: 3 }], capsules: { total: 3, cols: [3, 4], maxOn: 2 } },
    { id: 60, name: 'Whale Waters', moves: 32, w: 8, h: 9, syms: 6, diff: 'HARD', grid: [
      '. . . . . . . .', '. f . . . . f .', 'q q f . . f q q', 'q q . . . . q q', 'f . . g2 g2 . . f', '. . f . . f . .', 'f . . . . . . f', '. f . . . . f .', '. . e e e e . .'],
      objectives: [{ t: 'fud' }, { t: 'wallet', n: 2 }, { t: 'capsule', n: 3 }, { t: 'keys', n: 2 }], fud: { cap: 6, every: 3 }, keys: { total: 2, cols: [3, 4], maxOn: 1 }, capsules: { total: 3, cols: [3, 4], maxOn: 1 } },

    { id: 61, name: 'Dust Devil', moves: 29, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      'd . d . d . d .', '. D . d . D . d', 'd . d . d . d .', '. D . d . D . d', 'd . d . d . d .', '. D . d . D . d', 'd . d . d . d .', '. D . d . D . d', 'd . d . d . d .'],
      objectives: [{ t: 'dust', n: 44 }] },
    { id: 62, name: 'Margin Call', moves: 29, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'w . W . . W . w', '. . . . . . . .', 'W . w . . w . W', '. . . . . . . .', 'w . W . . W . w', '. . . . . . . .', 'W . . . . . . W', '. . . . . . . .'],
      objectives: [{ t: 'wall', n: 14 }, { t: 'collect', s: 4, n: 20 }] },
    { id: 63, name: 'Liquidation', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. h . . . . h .', '. . . b . . . .', '. . . . . . . .', '. . . . b . . .', '. h . . . . h .', '. . . . . . . .', '. . . . . . . .'],
      objectives: [{ t: 'printer', n: 2 }, { t: 'halt', n: 4 }, { t: 'wallall' }] },
    { id: 64, name: 'Sandstorm', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'f . f . . f . f', '. . . . . . . .', 'f . . f f . . f', '. . . . . . . .', 'f . . f f . . f', '. . . . . . . .', 'f . f . . f . f', '. . . . . . . .'],
      objectives: [{ t: 'fud' }, { t: 'collect', s: 0, n: 16 }], fud: { cap: 7, every: 3 } },
    { id: 65, name: 'Canyon Run', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '# # e e e e # #'],
      objectives: [{ t: 'capsule', n: 4 }], capsules: { total: 4, cols: [0, 7], maxOn: 2 }, lanes: [{ row: 7, dir: 1 }, { row: 4, dir: -1 }] },
    { id: 66, name: 'Heat Haze', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'p . p . . p . p', '. p . p p . p .', 'p . p . . p . p', '. . . . . . . .', 'd d d d d d d d', '. p . . . . p .', 'd d d d d d d d', 'd d . . . . d d'],
      objectives: [{ t: 'paper', n: 14 }, { t: 'dust', n: 20 }] },
    { id: 67, name: 'Mesa', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '# # . . . . # #', '# . . . . . . #', '. . . . . . . .', '. . D D D D . .', '. D D D D D D .', 'D D D D D D D D', '. D D D D D D .', '# . D D D D . #', '# # . . . . # #'],
      objectives: [{ t: 'dust', n: 56 }] },
    { id: 68, name: 'Leverage', moves: 32, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', 'q q . . . . q q', 'q q . . . . q q', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .'],
      objectives: [{ t: 'sweep', n: 2 }, { t: 'combo', n: 2 }, { t: 'wallet', n: 2 }] },
    { id: 69, name: 'Cliff Edge', moves: 32, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . g1 . . g1 . .', '. . . . . . . .', '. . . g3 g3 . . .', '. . . . . . . .', '. g5 . . . . g5 .', '. . . . . . . .', '. . e e e e . .'],
      objectives: [{ t: 'keys', n: 5 }, { t: 'capsule', n: 4 }], keys: { total: 5, cols: [2, 5], maxOn: 1 }, capsules: { total: 4, cols: [3, 4], maxOn: 2 } },
    { id: 70, name: 'Leverage Canyon', moves: 33, w: 8, h: 9, syms: 6, diff: 'HARD', grid: [
      '. . . . . . . .', '. h . f . f h .', '. . . . . . . .', 'h . b . . . . h', '. f . . . . f .', 'h . . . . b . h', '. . . . . . . .', '. h . f . f h .', '. . . e e . . .'],
      objectives: [{ t: 'halt', n: 8 }, { t: 'printer', n: 2 }, { t: 'fud' }, { t: 'capsule', n: 2 }], fud: { cap: 5, every: 3 }, capsules: { total: 2, cols: [3, 4], maxOn: 1 } },

    { id: 71, name: 'First Snow', moves: 29, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', 'D D D D D D D D', 'D D D D D D D D', 'D D D D D D D D', 'D D D D D D D D', 'D D . . . . D D'],
      objectives: [{ t: 'dust', n: 72 }] },
    { id: 72, name: 'Parachute', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . oa ob . . .', '. . . . . . . .', '. p . . . . p .', '. . p . . p . .', '. . . . . . . .', '. . p . . p . .', '. p . . . . p .', '. . . . . . . .', 'ia . . e e . . ib'],
      objectives: [{ t: 'capsule', n: 5 }, { t: 'paper', n: 8 }], capsules: { total: 5, cols: [0, 7], maxOn: 2 } },
    { id: 73, name: 'Avalanche', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', 'X . X . . X . X', '. . . . . . . .', '. . . . . . . .', '. X . X X . X .', '. . . . . . . .', '. . . . . . . .', '. . X . . X . .'],
      objectives: [{ t: 'wall', n: 10 }], lanes: [{ row: 3, dir: 1 }, { row: 6, dir: -1 }] },
    { id: 74, name: 'Ice Shelf', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'h . . h h . . h', '. . . . . . . .', 'd d d . . d d d', 'h . . h h . . h', 'd d d . . d d d', '. . . . . . . .', 'd d d . . d d d', '. . . . . . . .'],
      objectives: [{ t: 'halt', n: 8 }, { t: 'dust', n: 18 }] },
    { id: 75, name: 'Frost Nodes', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. f . M . . f .', '. . . . . . . .', 'M . . f f . . M', '. . . . . . . .', '. f . . . . f .', '. . M . . M . .', '. f . . . . f .', '. . . . M . . .'],
      objectives: [{ t: 'node', n: 6 }, { t: 'fud' }], fud: { cap: 5, every: 3 } },
    { id: 76, name: 'Snowdrift', moves: 32, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'p . p . . p . p', '. p . p p . p .', 'p . p . . p . p', '. p . . . . p .', 'p . . . . . . p', '. p . . . . p .', 'p . . . . . . p', '. . e e e e . .'],
      objectives: [{ t: 'paper', n: 20 }, { t: 'capsule', n: 3 }], capsules: { total: 3, cols: [3, 4], maxOn: 2 } },
    { id: 77, name: 'Summit Push', moves: 32, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'q q . . . . q q', 'q q . h . h q q', '. . . . . . . .', '. . . g2 g2 . . .', '. . . . . . . .', '. h . q q . h .', '. . . q q . . .', '. . . . . . . .'],
      objectives: [{ t: 'keys', n: 4 }, { t: 'wallet', n: 3 }, { t: 'halt', n: 4 }], keys: { total: 4, cols: [3, 4], maxOn: 1 }, wallets: { contents: 'keys' } },
    { id: 78, name: 'Whiteout', moves: 33, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      'f . . f f . . f', '. f . . . . f .', '. . f . . f . .', 'f . . . . . . f', '. . . f f . . .', 'f . . . . . . f', '. . f . . f . .', '. f . . . . f .', '. . . . . . . .'],
      objectives: [{ t: 'fud' }, { t: 'collect', s: 5, n: 20 }], fud: { cap: 8, every: 3 } },
    { id: 79, name: 'Crevasse', moves: 33, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      'D D D # # D D D', 'D . . # # . . D', '. . . # # . . .', '. ia ib # # ic id .', '# # # # # # # #', '# # oa ob oc od # #', '# # D D D D # #', '# # . . . . # #', '# # D D D D # #'],
      objectives: [{ t: 'dust', n: 32 }] },
    { id: 80, name: 'Airdrop Alps', moves: 34, w: 8, h: 9, syms: 6, diff: 'HARD', grid: [
      '. . . . . . . .', '. h . . . . h .', '. . . b . . . .', 'h . . . . . . h', '. . . . . . . .', 'h . . . b . . h', '. . . . . . . .', '. . . . . . . .', 'e e e e e e e e'],
      objectives: [{ t: 'capsule', n: 6 }, { t: 'printer', n: 2 }, { t: 'halt', n: 6 }], capsules: { total: 6, cols: [1, 3, 4, 6], maxOn: 2 } },

    { id: 81, name: 'Ignition', moves: 30, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'w w . . . . w w', 'w . . . . . . w', '. . . . . . . .', '. . w w w w . .', '. . . . . . . .', 'w . . . . . . w', 'w w . . . . w w', '. . . . . . . .'],
      objectives: [{ t: 'wall', n: 16 }, { t: 'burst', n: 3 }] },
    { id: 82, name: 'Lava Lanes', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. f . . . . f .', '. . . . . . . .', 'f . . f f . . f', '. . . . . . . .', 'f . . . . . . f', '. . . . . . . .', '. f . . . . f .', '. . . . . . . .'],
      objectives: [{ t: 'fud' }], fud: { cap: 6, every: 3 }, lanes: [{ row: 2, dir: 1 }, { row: 4, dir: -1 }, { row: 6, dir: 1 }] },
    { id: 83, name: 'Core Sample', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. M . w w . M .', '. . . . . . . .', 'w . M . . M . w', '. . . d d . . .', 'w . . d d . . w', '. . . d d . . .', '. M . w w . M .', '. . . d d . . .'],
      objectives: [{ t: 'node', n: 6 }, { t: 'wall', n: 8 }, { t: 'dust', n: 8 }] },
    { id: 84, name: 'Eruption', moves: 32, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'q q . h . . q q', 'q q . . h . q q', '. . . . . . . .', '. . . . . . . .', 'q q . h . . q q', 'q q . . h . q q', '. . . . . . . .', 'e e e e e e e e'],
      objectives: [{ t: 'wallet', n: 4 }, { t: 'capsule', n: 4 }, { t: 'halt', n: 4 }], wallets: { contents: 'capsule' }, capsules: { total: 4, cols: [], maxOn: 4 } },
    { id: 85, name: 'Ash Cloud', moves: 32, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      'f . f . . f . f', '. p . . . . p .', 'f . . f f . . f', '. . p . . p . .', 'f . . . . . . f', '. . p . . p . .', 'f . . f f . . f', '. p . . . . p .', 'f . . . . . . f'],
      objectives: [{ t: 'fud' }, { t: 'paper', n: 8 }], fud: { cap: 9, every: 3 } },
    { id: 86, name: 'Magma Gate', moves: 33, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . g2 . . g2 . .', '. . . . . . . .', '# # g4 . . g4 # #', '# . . . . . . #', '# . . . . . . #', '# . . g6 g6 . . #', '# . e e e e . #'],
      objectives: [{ t: 'keys', n: 6 }, { t: 'capsule', n: 4 }], keys: { total: 6, cols: [3, 4], maxOn: 1 }, capsules: { total: 4, cols: [3, 4], maxOn: 1 } },
    { id: 87, name: 'Flashpoint', moves: 33, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', 'd d d d d d d d', 'd d d d d d d d', '. . . . . . . .', '. . . . . . . .', 'd d . . . . d d', '. . . . . . . .'],
      objectives: [{ t: 'candle', n: 5 }, { t: 'combo', n: 2 }, { t: 'dust', n: 20 }] },
    { id: 88, name: 'Halt Storm', moves: 34, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'h . . b . . . h', '. h . . . . h .', '. . . . . . . .', 'h . . . b . . h', '. h . . . . h .', '. . . . . . . .', 'h . . b . . . h', '. h . . . . h .'],
      objectives: [{ t: 'halt', n: 12 }, { t: 'printer', n: 3 }] },
    { id: 89, name: 'Meltdown', moves: 34, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . f . . f . .', 'q q . w w . q q', 'q q f . . f q q', '. . . . . . . .', '. w . f f . w .', '. . . . . . . .', 'q q f . . f q q', 'q q . w w . q q', '. . f . . f . .'],
      objectives: [{ t: 'wallet', n: 4 }, { t: 'fud' }, { t: 'wall', n: 6 }], fud: { cap: 6, every: 3 } },
    { id: 90, name: 'Meltdown Core', moves: 35, w: 8, h: 9, syms: 6, diff: 'HARD', grid: [
      '. . . . . . . .', '. h . . . . h .', '. . b . . b . .', '. . . . . . . .', 'h . . . . . . h', '. . . . . . . .', '. . . . . . . .', '. h . . . . h .', '. . . . . . . .'],
      objectives: [{ t: 'halt', n: 6 }, { t: 'printer', n: 2 }, { t: 'wallall' }],
      stages: [{ grid: ['. . . . . . . .', 'f . . . . . . f', '. f . . . . f .', '. . f . . f . .', '. . . f f . . .', '. . f . . f . .', '. f . . . . f .', 'f . . . . . . f', 'e e e e e e e e'], objectives: [{ t: 'capsule', n: 5 }, { t: 'fud' }], capsules: { total: 5, cols: [1, 3, 4, 6], maxOn: 2 }, fud: { cap: 6, every: 3 } }] },

    { id: 91, name: 'Diamond Dust', moves: 31, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . D D . . .', '. . D D D D . .', '. D D D D D D .', 'D D D D D D D D', 'D D D D D D D D', '. D D D D D D .', '. . D D D D . .', '. . . D D . . .', '. . . . . . . .'],
      objectives: [{ t: 'dust', n: 80 }] },
    { id: 92, name: 'Pressure', moves: 32, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. X . . . . X .', '. . X . . X . .', '. . . X X . . .', '. . . . . . . .', '. . . X X . . .', '. . X . . X . .', '. X . . . . X .', '. . . . . . . .'],
      objectives: [{ t: 'wall', n: 12 }, { t: 'sweep', n: 2 }] },
    { id: 93, name: 'Facet', moves: 32, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '# # # . . # # #', '# # . . . . # #', '# . . . . . . #', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '# . . . . . . #', '# # . . . . # #', '# # # . . # # #'],
      objectives: [{ t: 'collect', s: 3, n: 24 }, { t: 'collect', s: 5, n: 24 }] },
    { id: 94, name: 'Cut', moves: 33, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . oa ob . . .', '. . . . . . . .', '. h . . . . h .', '. . . . . . . .', '. . . h h . . .', '. . . . . . . .', '. h . . . . h .', '. . . . . . . .', 'ia . e e e e . ib'],
      objectives: [{ t: 'capsule', n: 6 }, { t: 'halt', n: 6 }], capsules: { total: 6, cols: [0, 7], maxOn: 2 } },
    { id: 95, name: 'Clarity', moves: 33, w: 8, h: 9, syms: 6, diff: 'HARD', grid: [
      'f . . . . . . f', 'q q f . . f q q', 'q q . . . . q q', '. . . b . . . .', 'f . . . . . . f', '. . . . b . . .', 'q q . . . . q q', 'q q f . . f q q', 'f . . . . . . f'],
      objectives: [{ t: 'fud' }, { t: 'wallet', n: 4 }, { t: 'printer', n: 2 }], fud: { cap: 6, every: 3 } },
    { id: 96, name: 'Carat', moves: 34, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', 'M . . M M . . M', '. . . . . . . .', '. . . g2 g2 . . .', 'M . . . . . . M', '. . . . . . . .', '. . . g4 g4 . . .', 'M . . . . . . M', '. . . . . . . .'],
      objectives: [{ t: 'node', n: 8 }, { t: 'keys', n: 4 }], keys: { total: 4, cols: [3, 4], maxOn: 1 } },
    { id: 97, name: 'Polish', moves: 34, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      'p . p . . p . p', '. p . p p . p .', 'p . p . . p . p', '. p . . . . p .', 'd d d d d d d d', 'd d d d d d d d', 'd d d d d d d d', 'd d d . . d d d', '. p . . . . p .'],
      objectives: [{ t: 'paper', n: 16 }, { t: 'dust', n: 30 }] },
    { id: 98, name: 'Setting', moves: 35, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', '# # # e e # # #'],
      objectives: [{ t: 'capsule', n: 6 }], capsules: { total: 6, cols: [0, 7], maxOn: 2 }, lanes: [{ row: 7, dir: 1 }, { row: 5, dir: -1 }, { row: 3, dir: 1 }, { row: 1, dir: -1 }] },
    { id: 99, name: 'Final Facet', moves: 35, w: 8, h: 9, syms: 6, diff: 'NORMAL', grid: [
      'h . . w w . . h', '. h . . . . h .', 'w . h . . h . w', 'w . . d d . . w', '. . . d d . . .', 'w . . d d . . w', 'w . h . . h . w', '. h . . . . h .', 'h . . w w . . h'],
      objectives: [{ t: 'halt', n: 12 }, { t: 'wall', n: 12 }, { t: 'dust', n: 6 }] },
    { id: 100, name: 'Diamond Hands', moves: 36, w: 8, h: 9, syms: 6, diff: 'FINALE', grid: [
      '. . . . . . . .', 'q q . . . . q q', 'q q . . . . q q', '. . . . . . . .', '. . . . . . . .', '. . . . . . . .', 'q q . . . . q q', 'q q . . . . q q', '. . . . . . . .'],
      objectives: [{ t: 'keys', n: 6 }, { t: 'wallet', n: 4 }], keys: { total: 6, cols: [3, 4], maxOn: 1 }, wallets: { contents: 'keys' }, tutorial: 'finale',
      stages: [{ grid: ['. h . . . . h .', 'f . . f f . . f', '. f . . . . f .', '. . f . . f . .', 'h . . . . . . h', '. . f . . f . .', '. f . . . . f .', 'f . . f f . . f', 'e e e e e e e e'], objectives: [{ t: 'capsule', n: 8 }, { t: 'fud' }, { t: 'halt', n: 4 }], capsules: { total: 8, cols: [1, 3, 4, 6], maxOn: 3 }, fud: { cap: 8, every: 3 } }] },
  ];

  /* Bonus side levels: score attack, no lives, rank points. One after every fifth level. */
  const BONUS_NAMES = ['Side Bet', 'Quick Flip', 'Scalp', 'Momentum', 'Volume Spike', 'Green Candle', 'Order Book', 'Flash Rally', 'Squeeze', 'Ticker Tape',
    'Whale Splash', 'Rip', 'Melt Up', 'Bull Run', 'Moon Shot', 'Open Interest', 'Blue Sky', 'Overdrive', 'Parabola', 'Diamond Flip'];
  const BONUS = BONUS_NAMES.map((name, i) => {
    const after = (i + 1) * 5; const id = 1000 + after; const flavor = i % 4; const target = Math.round((4000 + i * 550) * (flavor === 3 ? 0.78 : 1)); const moves = 16 + Math.floor(i / 3);
    const grid = flavor === 1 ? ['. . . . . . . .', '. . . . . . . .', '. . w . . w . .', '. . . . . . . .', '. . . . . . . .', '. . w . . w . .', '. . . . . . . .', '. . . . . . . .']
      : flavor === 2 ? ['. . . . . . . .', '. d d . . d d .', '. d . . . . d .', '. . . . . . . .', '. . . . . . . .', '. d . . . . d .', '. d d . . d d .', '. . . . . . . .']
        : flavor === 3 ? ['# . . . . . . #', '. . . . . . . .', '. . . . . . . .', '. . . # # . . .', '. . . # # . . .', '. . . . . . . .', '. . . . . . . .', '# . . . . . . #'] : plain(8, 8);
    return { id, after, name, moves, w: 8, h: 8, syms: i < 8 ? 5 : 6, diff: 'BONUS', bonus: true, grid, objectives: [{ t: 'score', n: target }], cap: 60, lanes: flavor === 0 && i >= 4 ? [{ row: 4, dir: 1 }] : undefined };
  });

  for (const L of L2) { L.region = RTB.REGIONS.find(r => L.id >= r.from && L.id <= r.to).id; if (!L.cap) L.cap = [0, 0, 0, 0, 0, 0, 120, 125, 130, 135, 140][L.region]; if (!L.thresholds) L.thresholds = [Math.round(L.moves * 170), Math.round(L.moves * 300)]; L.milestone = L.id % 10 === 0; }
  for (const B of BONUS) { B.region = RTB.REGIONS.find(r => B.after >= r.from && B.after <= r.to).id; B.thresholds = [B.objectives[0].n, Math.round(B.objectives[0].n * 1.6)]; B.milestone = false; }
  RTB.LEVELS.push(...L2);
  RTB.BONUS = BONUS;
  const byId = new Map(); for (const L of RTB.LEVELS) byId.set(L.id, L); for (const B of BONUS) byId.set(B.id, B);
  RTB.levelById = (id) => byId.get(id);
  RTB.regionOf = (id) => { const L = byId.get(id); const n = L && L.bonus ? L.after : id; return RTB.REGIONS.find(r => n >= r.from && n <= r.to); };
  RTB.released = (id) => { const L = byId.get(id); if (!L) return false; const n = L.bonus ? L.after : id; return n <= RTB.CONFIG.releasedLevels; };
  RTB.MAX_LEVEL = 100;
})();
