// Live phone GPS. One watch is shared by the map, line walking and photos.
import { averageFixes } from './geo.js';

const fixes = [];           // recent fixes, newest last
const listeners = new Set();
let watchId = null, last = null, error = null;

export const current = () => last;
export const lastError = () => error;
export const onFix = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export function start() {
  if (watchId != null) return true;
  if (!('geolocation' in navigator)) { error = 'This device has no GPS access.'; notify(); return false; }
  watchId = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy, altitude, heading, speed } = pos.coords;
    last = { lat, lng, accuracy, altitude, heading, speed, time: pos.timestamp || Date.now() };
    error = null;
    fixes.push(last);
    while (fixes.length && last.time - fixes[0].time > 180000) fixes.shift();
    notify();
  }, err => {
    error = err.code === 1 ? 'Location permission is off. Allow location for this site in your phone settings.' : err.code === 3 ? 'Waiting for a GPS fix…' : 'GPS signal unavailable.';
    notify();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  return true;
}

export function stop() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function notify() { for (const fn of listeners) fn(last, error); }

// Collect fixes while the user stands at the pole and return the averaged
// position. Resolves early once the estimate is good enough, or when the
// user taps "use now" via the returned controller.
//   onProgress({ estimate, samples, elapsed })
export function lockPosition({ targetAccuracy = 3, minSamples = 5, maxSeconds = 20, onProgress } = {}) {
  start();
  const startedAt = Date.now();
  const collected = [];
  let done, timer, unsub;
  const finish = () => {
    clearInterval(timer); unsub?.();
    const estimate = averageFixes(collected, { maxAgeMs: Infinity });
    done(estimate);
  };
  const promise = new Promise(resolve => { done = resolve; });
  unsub = onFix(fix => {
    if (!fix || fix.time < startedAt - 1000) return;
    collected.push(fix);
    const estimate = averageFixes(collected, { maxAgeMs: Infinity });
    onProgress?.({ estimate, samples: collected.length, elapsed: (Date.now() - startedAt) / 1000 });
    if (estimate && collected.length >= minSamples && estimate.accuracy <= targetAccuracy) finish();
  });
  // Seed with a fresh fix so a phone that already has a lock starts instantly.
  if (last && Date.now() - last.time < 3000) collected.push(last);
  timer = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    onProgress?.({ estimate: averageFixes(collected, { maxAgeMs: Infinity }), samples: collected.length, elapsed });
    if (elapsed >= maxSeconds && collected.length) finish();
  }, 500);
  return { promise, useNow: () => { if (collected.length) finish(); }, cancel: () => { clearInterval(timer); unsub?.(); done(null); } };
}
