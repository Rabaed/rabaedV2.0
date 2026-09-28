import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareArabicFont } from "./arabic-font.ts";

// A stand-in for the private Thmanyah files, which are never in the repo.
let root: string;
let fontsDir: string;
let outFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rabaed-fonts-"));
  fontsDir = join(root, "fonts", "thmanyah");
  outFile = join(root, "src", "styles", "arabic-font.css");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function addFontFiles(...names: string[]) {
  mkdirSync(fontsDir, { recursive: true });
  for (const name of names) writeFileSync(join(fontsDir, name), "not a real font");
}

describe("prepareArabicFont", () => {
  it("falls back to IBM Plex Sans Arabic when the Thmanyah files are absent", () => {
    const result = prepareArabicFont({ fontsDir, outFile });

    expect(result).toEqual({ font: "IBM Plex Sans Arabic", faces: 0 });
    const css = readFileSync(outFile, "utf8");
    expect(css).toContain("--font-arabic: 'IBM Plex Sans Arabic';");
    expect(css).not.toContain("Thmanyah");
  });

  it("falls back when the folder exists but holds no Thmanyah Sans files", () => {
    addFontFiles("thmanyahserifdisplay-Bold.woff2", "notes.txt");

    expect(prepareArabicFont({ fontsDir, outFile }).font).toBe("IBM Plex Sans Arabic");
    expect(readFileSync(outFile, "utf8")).not.toContain("Thmanyah");
  });

  it("uses Thmanyah Sans for Arabic when its files are present at build time", () => {
    addFontFiles("thmanyahsans-Regular.woff2", "thmanyahsans-Bold.woff2", "thmanyahserifdisplay-Bold.woff2");

    const result = prepareArabicFont({ fontsDir, outFile });

    expect(result).toEqual({ font: "Thmanyah Sans", faces: 2 });
    const css = readFileSync(outFile, "utf8");
    expect(css).toContain("--font-arabic: 'Thmanyah Sans', 'IBM Plex Sans Arabic';");
    // Self-hosted: a path relative to the generated file, bundled onto our own origin.
    expect(css).toMatch(
      /@font-face \{[^}]*font-family: 'Thmanyah Sans';[^}]*font-weight: 400;[^}]*src: url\("\.\.\/\.\.\/fonts\/thmanyah\/thmanyahsans-Regular\.woff2"\) format\("woff2"\);/,
    );
    expect(css).toMatch(/font-weight: 700;[^}]*thmanyahsans-Bold\.woff2/);
    expect(css).not.toContain("serifdisplay");
    expect(css).not.toMatch(/https?:/);
  });

  it("maps every Thmanyah Sans weight name, whatever its case", () => {
    addFontFiles(
      "thmanyahsans-Light.woff2",
      "ThmanyahSans-regular.woff2",
      "thmanyahsans-Medium.woff2",
      "thmanyahsans-Bold.woff2",
      "thmanyahsans-Black.woff2",
    );

    prepareArabicFont({ fontsDir, outFile });

    const weights = [...readFileSync(outFile, "utf8").matchAll(/font-weight: (\d+);/g)].map((m) => Number(m[1]));
    expect(weights).toEqual([300, 400, 500, 700, 900]);
  });

  it("overwrites an earlier result when the files go away", () => {
    addFontFiles("thmanyahsans-Regular.woff2");
    prepareArabicFont({ fontsDir, outFile });
    rmSync(fontsDir, { recursive: true });

    prepareArabicFont({ fontsDir, outFile });

    expect(readFileSync(outFile, "utf8")).not.toContain("Thmanyah");
  });
});
