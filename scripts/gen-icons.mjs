#!/usr/bin/env node
/**
 * Generates DRIP's PWA icons with nothing but node built-ins.
 *   node scripts/gen-icons.mjs
 * Writes public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png
 *
 * Artwork: #0b0b0f rounded square (maskable: full bleed) with a #c8f542 drip —
 * a circle plus a triangular tail above it — drawn with plain math and
 * supersampled for smooth edges. No text.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const BG = [0x0b, 0x0b, 0x0f];
const ACCENT = [0xc8, 0xf5, 0x42];

// ── minimal PNG encoder ──────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
/** rgba: Uint8Array of size w*h*4 → PNG buffer (8-bit RGBA, no interlace). */
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── artwork ──────────────────────────────────────────────────────────────────

/** Signed coverage helpers, all in unit coordinates (0..1 across the icon). */
function inRoundedSquare(x, y, r) {
  const ax = Math.abs(x - 0.5) - (0.5 - r);
  const ay = Math.abs(y - 0.5) - (0.5 - r);
  if (ax <= 0 || ay <= 0) return true; // in the cross-shaped core
  return ax * ax + ay * ay <= r * r;    // in a corner: inside the corner circle?
}
function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
/**
 * Drip = circle centred at (cx, cy) radius r ∪ triangle from the tip (cx, tipY)
 * to the two points where lines from the tip touch the circle tangentially —
 * the classic teardrop, no kink at the shoulder.
 */
function inDrip(x, y, cx, cy, r, tipY) {
  if (inCircle(x, y, cx, cy, r)) return true;
  const d = cy - tipY;                       // tip → centre distance
  const phi = Math.asin(r / d);              // tangent angle
  const ty = cy - r * Math.sin(phi);         // y of the tangent points
  const halfAtTangent = r * Math.cos(phi);   // half-width of the triangle at the tangent points
  if (y < tipY || y > ty) return false;
  const half = ((y - tipY) / (ty - tipY)) * halfAtTangent;
  return Math.abs(x - cx) <= half;
}

/**
 * Render an icon.
 * @param size px
 * @param opts.maskable full-bleed background (safe zone: keep art in the inner 80%)
 */
function render(size, { maskable = false } = {}) {
  const SS = 4; // supersample factor
  const rgba = new Uint8Array(size * size * 4);
  const cornerR = maskable ? 0 : 0.22;
  // Drip geometry (unit coords). Maskable shrinks the glyph into the safe zone.
  const scale = maskable ? 0.8 : 1;
  const cx = 0.5;
  const r = 0.2 * scale;
  const cy = 0.5 + 0.13 * scale;
  const tipY = 0.5 - 0.36 * scale;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0, dripHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const onBg = maskable ? true : inRoundedSquare(x, y, cornerR);
          if (!onBg) continue;
          bgHits++;
          if (inDrip(x, y, cx, cy, r, tipY)) dripHits++;
        }
      }
      const total = SS * SS;
      const alpha = bgHits / total;
      const dripFrac = bgHits ? dripHits / bgHits : 0;
      const o = (py * size + px) * 4;
      rgba[o] = Math.round(BG[0] + (ACCENT[0] - BG[0]) * dripFrac);
      rgba[o + 1] = Math.round(BG[1] + (ACCENT[1] - BG[1]) * dripFrac);
      rgba[o + 2] = Math.round(BG[2] + (ACCENT[2] - BG[2]) * dripFrac);
      rgba[o + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
const files = [
  ["icon-192.png", render(192)],
  ["icon-512.png", render(512)],
  ["maskable-512.png", render(512, { maskable: true })],
  ["apple-touch-icon.png", render(180, { maskable: true })], // iOS rounds the corners itself; keep it opaque
];
for (const [name, buf] of files) {
  writeFileSync(join(OUT_DIR, name), buf);
  console.log(`wrote public/icons/${name} (${buf.length} bytes)`);
}
