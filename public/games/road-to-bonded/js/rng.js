'use strict';
/* Seeded deterministic RNG (sfc32 seeded via splitmix32). State is a plain
   object so it can be saved and restored exactly. */
(function () {
  const RTB = globalThis.RTB || (globalThis.RTB = {});

  function splitmix32(a) {
    return function () {
      a |= 0; a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97);
      return ((t = t ^ (t >>> 15)) >>> 0);
    };
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  const Rng = {
    create(seed) {
      const s = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
      const sm = splitmix32(s);
      const st = { a: sm(), b: sm(), c: sm(), d: sm() };
      for (let i = 0; i < 12; i++) Rng.next(st);
      return st;
    },
    /* returns float in [0,1) */
    next(st) {
      st.a >>>= 0; st.b >>>= 0; st.c >>>= 0; st.d >>>= 0;
      let t = (st.a + st.b) | 0;
      st.a = st.b ^ (st.b >>> 9);
      st.b = (st.c + (st.c << 3)) | 0;
      st.c = (st.c << 21) | (st.c >>> 11);
      st.d = (st.d + 1) | 0;
      t = (t + st.d) | 0;
      st.c = (st.c + t) | 0;
      return (t >>> 0) / 4294967296;
    },
    int(st, n) { return Math.floor(Rng.next(st) * n); },
    pick(st, arr) { return arr[Rng.int(st, arr.length)]; },
    /* weighted pick: weights array of numbers */
    weighted(st, weights) {
      let total = 0;
      for (let i = 0; i < weights.length; i++) total += weights[i];
      let r = Rng.next(st) * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    shuffle(st, arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Rng.int(st, i + 1);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    hashString,
  };
  RTB.Rng = Rng;
})();
