import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// Plain white shapes (unit square coordinates) for the 96px home-screen shortcut icons.
const SHAPES = {
  plus: (u, v) => (Math.abs(u - 0.5) < 0.07 && Math.abs(v - 0.5) < 0.25) || (Math.abs(v - 0.5) < 0.07 && Math.abs(u - 0.5) < 0.25),
  clock: (u, v) => { const d = Math.hypot(u - 0.5, v - 0.5); return (d < 0.3 && d > 0.22) || (Math.abs(u - 0.5) < 0.04 && v > 0.32 && v < 0.5) || (Math.abs(v - 0.5) < 0.04 && u > 0.5 && u < 0.64); },
  spark: (u, v) => Math.abs(u - 0.5) + Math.abs(v - 0.5) < 0.28 && Math.abs(u - 0.5) * Math.abs(v - 0.5) < 0.012,
  search: (u, v) => { const d = Math.hypot(u - 0.45, v - 0.45); return (d < 0.22 && d > 0.15) || (Math.abs(u - v) < 0.05 && u > 0.6 && u < 0.76); },
};
function png(size, shape) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  const bar = Math.round(size * 0.13);
  const top = Math.round(size * 0.27);
  const bottom = Math.round(size * 0.75);
  const left = Math.round(size * 0.27);
  const right = size - left;
  const mid = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const crossbar = y >= top && y < top + bar && x >= left && x < right;
      const stem = x >= mid - bar / 2 && x < mid + bar / 2 && y >= top && y < bottom;
      const on = shape ? SHAPES[shape]((x + 0.5) / size, (y + 0.5) / size) : crossbar || stem;
      const [r, g, b] = on ? [255, 255, 255] : [0x2e, 0x55, 0xe6];
      const o = y * stride + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(`public/icons/${name}`, png(size));
}
for (const [name, shape] of [["shortcut-event.png", "plus"], ["shortcut-free-time.png", "clock"], ["shortcut-assistant.png", "spark"], ["shortcut-search.png", "search"]]) {
  writeFileSync(`public/icons/${name}`, png(96, shape));
}
console.log("icons written to public/icons");
