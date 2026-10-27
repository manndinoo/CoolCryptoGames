// Phone compass: which way the back camera is facing when a photo is taken.
// Independent of GPS. Headings are magnetic, and steel (towers, transformer
// tanks, trucks) close to the phone can throw them off.

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const cardinal = deg => (deg == null ? '' : POINTS[Math.round(deg / 45) % 8]);
export const describe = deg => (deg == null ? '' : `${cardinal(deg)} ${Math.round(deg)}°`);

// Direction the back camera points, from W3C device orientation angles
// (alpha about z, beta about x, gamma about y, earth frame x=east, y=north).
// The back camera looks along the device's -z axis; its horizontal part
// gives the heading. Returns null when the phone is lying flat and the
// camera points at the ground, because then there is no meaningful heading.
export function cameraHeading(alpha, beta, gamma) {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  const r = Math.PI / 180;
  const sA = Math.sin(alpha * r), cA = Math.cos(alpha * r);
  const sB = Math.sin(beta * r), cB = Math.cos(beta * r);
  const sG = Math.sin(gamma * r), cG = Math.cos(gamma * r);
  const east = -(cA * sG + sA * sB * cG);
  const north = -(sA * sG - cA * sB * cG);
  if (Math.hypot(east, north) < 0.25) return null; // within ~15° of straight down or up
  return (Math.atan2(east, north) / r + 360) % 360;
}

let heading = null, accuracy = null, started = false, lastAt = 0;
const listeners = new Set();
export const current = () => (Date.now() - lastAt < 3000 ? heading : null);
export const currentAccuracy = () => accuracy;
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

function update(h, acc) {
  // Light smoothing so the readout does not jitter; handles the 359°→0° wrap.
  if (h != null && heading != null && Date.now() - lastAt < 1000) {
    const d = ((h - heading + 540) % 360) - 180;
    h = (heading + d * 0.3 + 360) % 360;
  }
  heading = h; accuracy = acc; lastAt = Date.now();
  for (const fn of listeners) fn(heading, accuracy);
}

// Must be called from a tap: iPhones only grant motion access on a user gesture.
export async function start() {
  if (started || typeof window.DeviceOrientationEvent === 'undefined') return started;
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function' && (await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
  } catch { return false; }
  started = true;
  // iPhone: webkitCompassHeading already points where the camera faces when held upright.
  window.addEventListener('deviceorientation', e => {
    if (typeof e.webkitCompassHeading === 'number') {
      const tilted = Math.abs(e.beta ?? 90) > 15;
      update(tilted ? e.webkitCompassHeading : null, e.webkitCompassAccuracy ?? null);
    }
  });
  // Android: absolute orientation, converted to the camera's direction.
  window.addEventListener('deviceorientationabsolute', e => update(cameraHeading(e.alpha, e.beta, e.gamma), null));
  return true;
}
