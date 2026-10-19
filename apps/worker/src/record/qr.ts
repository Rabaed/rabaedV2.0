// A QR code for the Final decision box, made here so the record needs no
// library (RP-151: no new dependencies). Byte mode, error correction level M,
// versions 1 to 10 (up to 213 bytes: the verification link is about 80), the
// mask with the lowest penalty. Follows ISO/IEC 18004; qr.test.ts decodes what
// it makes.

const ECC_CODEWORDS_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26] as const;
const NUM_ERROR_CORRECTION_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] as const;
export const QR_MAX_VERSION = 10;

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** The number of modules that hold data and error correction (not function patterns), for `version`. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (version: number) =>
  Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version]! * NUM_ERROR_CORRECTION_BLOCKS[version]!;

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

// Reed-Solomon over GF(256) with x^8 + x^4 + x^3 + x^2 + 1.
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

export function divisorOf(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = multiply(root, 0x02);
  }
  return result;
}

export function remainderOf(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = result[i]! ^ multiply(coefficient, factor);
    });
  }
  return result;
}

/** The data and error correction codewords of `data`, interleaved across the version's blocks. */
export function interleavedCodewords(data: readonly number[], version: number): number[] {
  const blocks = NUM_ERROR_CORRECTION_BLOCKS[version]!;
  const eccLen = ECC_CODEWORDS_PER_BLOCK[version]!;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (rawCodewords % blocks);
  const shortLen = Math.floor(rawCodewords / blocks);
  const divisor = divisorOf(eccLen);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const part = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += part.length;
    const ecc = remainderOf(part, divisor);
    if (i < shortBlocks) part.push(0);
    all.push([...part, ...ecc]);
  }
  const out: number[] = [];
  for (let i = 0; i < all[0]!.length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i]!);
    });
  }
  return out;
}

/** The mask patterns, by number: whether the module at (x, y) is inverted. */
export const qrMasks: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The 15 format bits of error correction level M with `mask`. */
export function formatBits(mask: number): number {
  const data = (0 << 3) | mask; // level M is 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export interface QrCode {
  readonly version: number;
  readonly size: number;
  /** Row by row, true for a dark module. */
  readonly modules: readonly (readonly boolean[])[];
  /** The function-pattern modules (finders, timing, alignment, format, version): data is read from the rest. */
  readonly isFunction: readonly (readonly boolean[])[];
}

/** The QR code of `text` (UTF-8, byte mode, level M). Throws when it needs more than version 10. */
export function qrCode(text: string): QrCode {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  for (; ; version++) {
    if (version > QR_MAX_VERSION) throw new Error(`The text is too long for a QR code (${bytes.length} bytes)`);
    if (4 + (version <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(version) * 8) break;
  }

  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) append(b, 8);
  const capacity = dataCodewords(version) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(Number.parseInt(bits.slice(i, i + 8).join(""), 2));

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFunction = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };
  const drawFormat = (mask: number) => {
    const b = formatBits(mask);
    for (let i = 0; i <= 5; i++) setFunction(8, i, bit(b, i));
    setFunction(8, 7, bit(b, 6));
    setFunction(8, 8, bit(b, 7));
    setFunction(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(b, i));
    setFunction(8, size - 8, true);
  };

  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const positions = alignmentPositions(version);
  positions.forEach((px, i) => {
    positions.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFunction(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const versionBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, bit(versionBits, i));
      setFunction(b, a, bit(versionBits, i));
    }
  }

  const codewords = interleavedCodewords(data, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!isFunction[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFunction[y]![x] && qrMasks[mask]!(x, y)) modules[y]![x] = !modules[y]![x];
  };
  let best = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    const p = penaltyScore(modules);
    if (p < bestPenalty) {
      best = mask;
      bestPenalty = p;
    }
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return { version, size, modules, isFunction };
}

/**
 * The mask's penalty, the four rules of ISO/IEC 18004 §7.8.3: (1) runs of five or more like modules in a row or
 * column, 3 and 1 for each module more; (2) 2 by 2 blocks of one colour, 3 each; (3) a 1:1:3:1:1 finder-like
 * pattern with four light modules on one side, 40 each; (4) the dark share's distance from half, 10 for each
 * full 5 percent step past the first.
 */
export function penaltyScore(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let result = 0;
  const finderLike = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true],
  ];
  for (const get of [(a: number, b: number) => modules[a]![b]!, (a: number, b: number) => modules[b]![a]!]) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) {
          run++;
          if (run === 5) result += 3;
          else if (run > 5) result++;
        } else run = 1;
      }
      for (let b = 0; b + 11 <= size; b++) {
        for (const pattern of finderLike) if (pattern.every((dark, i) => get(a, b + i) === dark)) result += 40;
      }
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y]![x];
      if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) result += 3;
    }
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return result;
}

/** The QR code of `text` as an SVG with a four-module quiet zone, black on white; `size` is its width and height in CSS pixels. */
export function qrSvg(text: string, size = 120): string {
  const code = qrCode(text);
  const quiet = 4;
  const total = code.size + quiet * 2;
  const path: string[] = [];
  code.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
    }),
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path d="${path.join("")}" fill="#000"/></svg>`
  );
}
