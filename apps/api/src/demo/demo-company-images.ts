import { encodePng } from "./demo-signature.ts";

// A demo Company's logo and Stamp (RP-617): PNGs made up for the Rabaed demo, so every demo
// Company's Members can take Transitions and its records print both. No real Company's mark:
// plain shapes in one ink, each `seed` its own colour and pattern.

/** Inks for the demo images: printed on the white record, so not theme tokens. */
const inks: [number, number, number][] = [
  [0x1f, 0x3a, 0x93],
  [0x9b, 0x1c, 0x1c],
  [0x14, 0x6c, 0x43],
  [0x5b, 0x21, 0xb6],
];

function canvas(size: number) {
  const pixels = Buffer.alloc(size * size * 4);
  const paint = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 0xff;
  };
  return { pixels, paint };
}

/** A round Stamp: two rings and a band of ticks between them, in the seed's ink, on a transparent ground. */
export function demoStampPng(seed: number): Buffer {
  const size = 200;
  const ink = inks[seed % inks.length]!;
  const { pixels, paint } = canvas(size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c);
      const angle = Math.atan2(y - c, x - c);
      const outer = r >= 88 && r <= 95;
      const inner = r >= 62 && r <= 65;
      // Ticks round the band, as a stamp's lettering would sit there.
      const tick = r > 70 && r < 83 && Math.abs(Math.sin(angle * (18 + (seed % 5)))) > 0.85;
      // A five-pointed mark in the middle.
      const star = r < 40 && r < 22 + 16 * Math.abs(Math.cos((angle * 5) / 2 + seed));
      if (outer || inner || tick || star) paint(x, y, ink);
    }
  }
  return encodePng(size, size, pixels);
}

/** A square logo: the seed's ink with a white bar across it, on a transparent ground. */
export function demoLogoPng(seed: number): Buffer {
  const size = 120;
  const ink = inks[(seed + 1) % inks.length]!;
  const { pixels, paint } = canvas(size);
  for (let y = 8; y < size - 8; y++) {
    for (let x = 8; x < size - 8; x++) {
      const bar = Math.abs(x - y + (seed % 3) * 12 - 12) < 10;
      paint(x, y, bar ? [0xff, 0xff, 0xff] : ink);
    }
  }
  return encodePng(size, size, pixels);
}
