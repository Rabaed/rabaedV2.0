import { describe, expect, it } from "vitest";
import { divisorOf, formatBits, interleavedCodewords, penaltyScore, qrCode, qrMasks, qrSvg, remainderOf, type QrCode } from "./qr.ts";

// The expected values below are from the QR standard's worked examples (the
// Thonky tutorial's "HELLO WORLD"), never worked out by the encoder itself.

describe("Reed-Solomon", () => {
  it("gives the standard's error correction codewords for HELLO WORLD (1-Q)", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
    expect(remainderOf(data, divisorOf(13))).toEqual([168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
  });
});

describe("format information", () => {
  it("is the standard's for level M, whichever mask", () => {
    expect(formatBits(0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatBits(1).toString(2).padStart(15, "0")).toBe("101000100100101");
  });
});

/** Reads the text back the way a scanner does: the format's mask, the zigzag, the blocks, the byte mode. */
function decode(code: QrCode): string {
  const { size, modules } = code;
  const get = (x: number, y: number) => (modules[y]![x] ? 1 : 0);
  let format = 0;
  for (let i = 0; i <= 5; i++) format |= get(8, i) << i;
  format |= get(8, 7) << 6;
  format |= get(8, 8) << 7;
  format |= get(7, 8) << 8;
  for (let i = 9; i < 15; i++) format |= get(14 - i, 8) << i;
  const decoded = format ^ 0x5412;
  expect(decoded >> 13, "error correction level M").toBe(0);
  const mask = (decoded >> 10) & 7;
  // The second copy of the format information agrees with the first.
  let second = 0;
  for (let i = 0; i < 8; i++) second |= get(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) second |= get(8, size - 15 + i) << i;
  expect(second).toBe(format);

  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!code.isFunction[y]![x]) bits.push(get(x, y) ^ (qrMasks[mask]!(x, y) ? 1 : 0));
      }
    }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(Number.parseInt(bits.slice(i, i + 8).join(""), 2));

  // Undo the interleaving: the data codewords come first, block by block.
  const total = codewords.length;
  const blocks = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5][code.version - 1]!;
  const ecc = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26][code.version - 1]!;
  const shortLen = Math.floor(total / blocks);
  const shortBlocks = blocks - (total % blocks);
  const perBlock: number[][] = Array.from({ length: blocks }, () => []);
  let k = 0;
  for (let i = 0; i < shortLen - ecc + 1; i++) {
    for (let b = 0; b < blocks; b++) {
      if (i === shortLen - ecc && b < shortBlocks) continue;
      perBlock[b]!.push(codewords[k++]!);
    }
  }
  const data = perBlock.flat();
  // Every block's error correction checks.
  const checks: number[][] = Array.from({ length: blocks }, () => []);
  for (let i = 0; i < ecc; i++) for (let b = 0; b < blocks; b++) checks[b]!.push(codewords[k++]!);
  perBlock.forEach((block, b) => expect(remainderOf(block, divisorOf(ecc)), `block ${b}`).toEqual(checks[b]));

  const stream = data.map((c) => c.toString(2).padStart(8, "0")).join("");
  expect(stream.slice(0, 4), "byte mode").toBe("0100");
  const countBits = code.version <= 9 ? 8 : 16;
  const length = Number.parseInt(stream.slice(4, 4 + countBits), 2);
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(Number.parseInt(stream.slice(4 + countBits + i * 8, 12 + countBits + i * 8), 2));
  return new TextDecoder().decode(new Uint8Array(out));
}

describe("qrCode", () => {
  it("reads back as the text it was made from, for every size it makes", () => {
    for (const text of ["HELLO WORLD", "https://rabaed.test/verify/" + "a".repeat(43), "x".repeat(100), "y".repeat(150), "اختبار ✓ " + "z".repeat(190)]) {
      const code = qrCode(text);
      expect(decode(code)).toBe(text);
    }
  });

  it("uses a larger version for more text, and refuses what version 10 can't hold", () => {
    expect(qrCode("a").version).toBe(1);
    expect(qrCode("a".repeat(100)).version).toBe(6);
    expect(() => qrCode("a".repeat(300))).toThrow("too long");
  });

  it("draws the finder patterns in three corners and the timing patterns", () => {
    const { modules, size } = qrCode("HELLO WORLD");
    expect(size).toBe(21);
    for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
      expect(modules[y]!.slice(x, x + 7)).toEqual([true, true, true, true, true, true, true]);
      expect(modules[y + 3]!.slice(x, x + 7)).toEqual([true, false, true, true, true, false, true]);
    }
    for (let i = 8; i < size - 8; i++) expect(modules[6]![i]).toBe(i % 2 === 0);
  });
});

// ISO/IEC 18004's tables, which this encoder doesn't share: the byte-mode capacity at level M of each version
// (Table 7) and its total codewords (Table 1), 26 44 70 100 134 172 196 242 292 346, whose 8 bits each plus the
// version's remainder bits (0, then 7 for versions 2 to 6, then 0) are the modules that hold data. Any module
// that a function pattern covers wrongly (a finder, timing, alignment, format or version module) changes that count.
// The standard's worked symbol ("01234567" at 1-M) was not to hand offline; these tables stand in for it.
describe("the symbol's layout, against the standard's tables", () => {
  const capacity = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  const dataModules = [208, 359, 567, 807, 1079, 1383, 1568, 1936, 2336, 2768];

  it.each(capacity.map((bytes, i) => [i + 1, bytes, dataModules[i]!] as const))("version %i holds %i bytes and %i data modules", (version, bytes, modules) => {
    expect(qrCode("a".repeat(bytes)).version).toBe(version);
    if (version > 1) expect(qrCode("a".repeat(capacity[version - 2]! + 1)).version).toBe(version);
    const code = qrCode("a".repeat(bytes));
    expect(code.size).toBe(version * 4 + 17);
    expect(code.isFunction.flat().filter((isFunction) => !isFunction)).toHaveLength(modules);
    // The one module that is always dark, beside the lower-left finder.
    expect(code.modules[code.size - 8]![8]).toBe(true);
    expect(code.isFunction[code.size - 8]![8]).toBe(true);
  });

  it("puts alignment patterns where the standard does: one at (18, 18) in version 2, and a version block from version 7", () => {
    const v2 = qrCode("a".repeat(26));
    const ring = (cx: number, cy: number) => {
      const at = (dx: number, dy: number) => v2.modules[cy + dy]![cx + dx];
      return [at(0, 0), at(1, 0), at(2, 0), at(2, 2), at(1, 1), at(-1, -1), at(-2, -2)];
    };
    expect(ring(18, 18)).toEqual([true, false, true, true, false, false, true]);
    expect(qrCode("a".repeat(122)).version).toBe(7);
  });
});

describe("the mask penalty, worked by hand from the standard's four rules", () => {
  const grid = (dark: (x: number, y: number) => boolean) => Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => dark(x, y)));

  it("is 2088 for an all-light 21 by 21: 42 runs of 21 (3 + 16 each), 400 blocks of 3, and 0% dark (9 steps of 10)", () => {
    expect(penaltyScore(grid(() => false))).toBe(42 * 19 + 400 * 3 + 90);
  });

  it("is 0 for a checkerboard: no run of 5, no block, no finder-like pattern, and half dark", () => {
    expect(penaltyScore(grid((x, y) => (x + y) % 2 === 0))).toBe(0);
  });

  it("adds 40 for a finder-like pattern, 1011101 with four light modules after it", () => {
    const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const flawed = grid((x, y) => (y === 0 ? (x < 11 ? pattern[x] === 1 : x % 2 === 1) : (x + y) % 2 === 0));
    expect(penaltyScore(flawed)).toBe(40);
  });
});

describe("interleaving", () => {
  it("puts a one-block version's data first, then its error correction", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    const out = interleavedCodewords(data, 1);
    expect(out.slice(0, 16)).toEqual(data);
    expect(out).toHaveLength(26);
  });
});

describe("qrSvg", () => {
  it("is a square SVG with a quiet zone", () => {
    const svg = qrSvg("HELLO WORLD", 100);
    expect(svg).toMatch(/^<svg [^>]*width="100" height="100" viewBox="0 0 29 29"/);
  });
});
