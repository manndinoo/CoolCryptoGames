// In-app camera for rapid multi-shot capture, with the phone's own camera
// app as a fallback. Photos are resized on the phone before upload so a
// 25-photo inspection is practical on a weak cellular signal.

const MAX_EDGE = 2400;
const QUALITY = 0.88;

export const liveCameraSupported = () => !!navigator.mediaDevices?.getUserMedia;

export async function openStream(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  return {
    stream,
    zoom: caps.zoom ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 10), set: z => track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {}) } : null,
    torch: caps.torch ? on => track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}) : null,
    stop: () => { stream.getTracks().forEach(t => t.stop()); video.srcObject = null; },
  };
}

// Grab the current video frame as a JPEG blob.
export async function snap(video) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) throw new Error('Camera is not ready yet.');
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  return drawToJpeg(video, Math.round(w * scale), Math.round(h * scale));
}

// Resize a picked or native-camera file. Orientation from EXIF is applied by
// the browser when decoding.
export async function prepareFile(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error(`${file.name} is not a photo.`);
  let source;
  try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`${file.name} could not be read on this device.`));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width || source.naturalWidth, h = source.height || source.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const blob = await drawToJpeg(source, Math.round(w * scale), Math.round(h * scale));
  source.close?.();
  return { blob, takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString() };
}

function drawToJpeg(source, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))), 'image/jpeg', QUALITY));
}

// Keep the screen on while working, where supported.
let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
