import { deflateSync } from "node:zlib";

// A demo Signature image (RP-85): a PNG of a pen stroke, made up for the Rabaed demo, so
// every demo Member can take Transitions. Each `seed` draws a different stroke.

const WIDTH = 360;
const HEIGHT = 120;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A transparent PNG with a dark-blue pen stroke across it, its loops set by `seed`. */
export function demoSignaturePng(seed: number): Buffer {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  const dot = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) continue;
        const i = (py * WIDTH + px) * 4;
        pixels[i] = 0x1f;
        pixels[i + 1] = 0x2a;
        pixels[i + 2] = 0x6b;
        pixels[i + 3] = 0xff;
      }
    }
  };
  const loops = 3 + (seed % 3);
  for (let t = 0; t <= 1; t += 1 / 4000) {
    const x = 20 + t * (WIDTH - 40) + 14 * Math.sin(t * Math.PI * 2 * loops);
    const y = HEIGHT / 2 + 26 * Math.sin(t * Math.PI * (loops + 1) + seed) * (1 - t * 0.5) - 18 * Math.cos(t * Math.PI * 2 * loops);
    dot(x, y);
  }
  return encodePng(WIDTH, HEIGHT, pixels);
}

/** An RGBA image (`pixels`, 4 bytes a pixel, row by row) as PNG bytes. */
export function encodePng(width: number, height: number, pixels: Buffer): Buffer {
  // Each row starts with filter type 0 (none).
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(6, 9); // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
