// GPS math shared by the browser and the server. No DOM access here.

const R = 6371008.8; // mean Earth radius, metres
const rad = d => (d * Math.PI) / 180;

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Combine phone GPS fixes into one pole position.
// A phone reports a 68% accuracy radius with every fix. Fixes are weighted by
// 1/accuracy², and fixes much worse than the best one are dropped so a single
// bad reading (multipath off a truck, a fix from before the phone settled)
// cannot drag the pin. The returned accuracy is the standard error of the
// weighted mean, floored at 1 m because consumer GNSS has correlated error that
// averaging alone does not remove.
export function averageFixes(fixes, { maxAgeMs = 120000, now = Date.now() } = {}) {
  const usable = fixes.filter(f => validLatLng(f.lat, f.lng) && f.accuracy > 0 && now - f.time <= maxAgeMs);
  if (!usable.length) return null;
  const best = Math.min(...usable.map(f => f.accuracy));
  const kept = usable.filter(f => f.accuracy <= Math.max(best * 2, best + 3));
  let wSum = 0, lat = 0, lng = 0;
  for (const f of kept) {
    const w = 1 / f.accuracy ** 2;
    wSum += w; lat += f.lat * w; lng += f.lng * w;
  }
  lat /= wSum; lng /= wSum;
  // Spread of the kept fixes around the mean, so a wandering fix set is not reported as precise.
  const spread = Math.sqrt(kept.reduce((s, f) => s + distanceM({ lat, lng }, f) ** 2, 0) / kept.length);
  const accuracy = Math.max(1, Math.sqrt(1 / wSum), spread);
  return { lat, lng, accuracy: Math.round(accuracy * 10) / 10, samples: kept.length, discarded: usable.length - kept.length };
}

// Rough quality label for the accuracy meter.
export function fixQuality(accuracy) {
  if (accuracy == null) return 'none';
  if (accuracy <= 3) return 'excellent';
  if (accuracy <= 6) return 'good';
  if (accuracy <= 15) return 'fair';
  return 'poor';
}

// Poles within `radiusM` of a point, nearest first. Used to catch the same
// pole being dropped twice and to offer "is this pole X?" while walking.
export function nearbyPoles(poles, point, radiusM) {
  return poles
    .filter(p => !p.deleted)
    .map(p => ({ pole: p, distance: distanceM(point, p) }))
    .filter(x => x.distance <= radiusM)
    .sort((a, b) => a.distance - b.distance);
}

// Next tag in a sequence: "NW-1042" -> "NW-1043", "17" -> "18", "A" -> "A-2".
export function nextTag(tag, prefix = '') {
  const m = /^(.*?)(\d+)(\D*)$/.exec(tag || '');
  if (!m) return tag ? `${tag}-2` : `${prefix}1`;
  const n = String(Number(m[2]) + 1).padStart(m[2].length, '0');
  return `${m[1]}${n}${m[3]}`;
}

export function lineLengthM(spans, polesById) {
  let total = 0;
  for (const s of spans) {
    const a = polesById.get(s.from_pole), b = polesById.get(s.to_pole);
    if (a && b) total += distanceM(a, b);
  }
  return total;
}

export const fmtDistance = (m, imperial = true) => {
  if (m == null || !Number.isFinite(m)) return '–';
  if (imperial) {
    const ft = m * 3.28084;
    return ft >= 2640 ? `${(ft / 5280).toFixed(2)} mi` : `${Math.round(ft)} ft`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
};
