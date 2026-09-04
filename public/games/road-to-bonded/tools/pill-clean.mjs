#!/usr/bin/env node
/* Removes the white background from the BONDED pill reference PNG and crops
   it to its bounding box. Pure Node (zlib only). Usage: node pill-clean.mjs in.png out.png */
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const [,, inPath, outPath] = process.argv;
const buf = readFileSync(inPath);
let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0; const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
  else if (type === 'IDAT') idat.push(data);
  off += 12 + len;
}
if (bitDepth !== 8) throw new Error('expected 8-bit PNG');
const ch = { 2: 3, 6: 4, 0: 1, 4: 2 }[colorType];
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = w * ch; const px = Buffer.alloc(w * h * ch);
let prev = Buffer.alloc(stride);
for (let y = 0; y < h; y++) {
  const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  const cur = Buffer.alloc(stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0; let v = line[x];
    if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
    else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
    cur[x] = v & 255;
  }
  cur.copy(px, y * stride); prev = cur;
}
// build RGBA with white -> transparent (soft edge)
const rgba = Buffer.alloc(w * h * 4);
let minX = w, minY = h, maxX = 0, maxY = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * ch; const r = px[i], g = px[i + 1], b = px[i + 2];
  const alphaSrc = ch === 4 ? px[i + 3] : 255;
  const whiteness = Math.min(r, g, b);
  // interior of the pill top half is also white, so only treat pixels as background if
  // they are near-white AND connected to the border (flood fill below)
  const o = (y * w + x) * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = alphaSrc;
  rgba[o + 3] = alphaSrc; void whiteness;
}
// flood fill from border over near-white pixels
const visited = new Uint8Array(w * h); const stack = [];
const isWhite = (x, y) => { const o = (y * w + x) * 4; return rgba[o] > 235 && rgba[o + 1] > 235 && rgba[o + 2] > 235; };
for (let x = 0; x < w; x++) { stack.push([x, 0], [x, h - 1]); }
for (let y = 0; y < h; y++) { stack.push([0, y], [w - 1, y]); }
while (stack.length) {
  const [x, y] = stack.pop(); if (x < 0 || y < 0 || x >= w || y >= h) continue;
  const k = y * w + x; if (visited[k]) continue; visited[k] = 1;
  if (!isWhite(x, y)) continue;
  rgba[k * 4 + 3] = 0;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}
// soften edge: background-adjacent light pixels get partial alpha
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const k = y * w + x; if (rgba[k * 4 + 3] === 0) continue;
  let bg = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && rgba[(yy * w + xx) * 4 + 3] === 0) bg++; }
  if (bg) { const o = k * 4; const light = Math.min(rgba[o], rgba[o + 1], rgba[o + 2]); if (light > 200) rgba[o + 3] = Math.round(255 * (1 - (light - 200) / 55) * 0.9); }
  if (rgba[k * 4 + 3] > 0) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
}
const pad = 4; minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
const cw = maxX - minX + 1, chh = maxY - minY + 1;
const out = Buffer.alloc((cw * 4 + 1) * chh);
for (let y = 0; y < chh; y++) { out[y * (cw * 4 + 1)] = 0; rgba.copy(out, y * (cw * 4 + 1) + 1, ((y + minY) * w + minX) * 4, ((y + minY) * w + minX + cw) * 4); }
const crc32 = (b) => { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(cw, 0); ihdr.writeUInt32BE(chh, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(outPath, png);
console.log(`wrote ${outPath} ${cw}x${chh}`);
