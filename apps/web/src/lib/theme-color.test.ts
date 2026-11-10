import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeColorOf } from "./theme-color";

const tokens = readFileSync(new URL("../../../../packages/ui/src/styles/tokens.css", import.meta.url), "utf8");
const palette = (name: string) => new RegExp(`--palette-${name}:\\s*(#[0-9a-f]{6})`).exec(tokens)?.[1];
// The surface token in a theme's block, e.g. "warm-dark": its palette colour.
const surfaceOf = (block: string) => {
  const body = tokens.split(`theme "${block}". */`)[1] ?? "";
  const name = /--surface:\s*var\(--palette-([a-z0-9-]+)\)/.exec(body)?.[1];
  return name === undefined ? undefined : palette(name);
};
const light = "(prefers-color-scheme: light)";
const dark = "(prefers-color-scheme: dark)";

// The browser's bar is tinted like the top bar (RP-1272, gap-table row 28): the surface token of the Member's Theme and Mode.
describe("the theme colour", () => {
  it("is the surface token of each Theme, light and dark", () => {
    for (const theme of ["grey", "warm"] as const) {
      expect(themeColorOf({ theme, mode: "system" })).toEqual([
        { media: light, color: surfaceOf(`${theme}-light`) },
        { media: dark, color: surfaceOf(`${theme}-dark`) },
      ]);
    }
  });

  it("keeps a Member's fixed Mode whatever the device is set to", () => {
    const warmDark = surfaceOf("warm-dark");
    expect(themeColorOf({ theme: "warm", mode: "dark" })).toEqual([
      { media: light, color: warmDark },
      { media: dark, color: warmDark },
    ]);
    const greyLight = surfaceOf("grey-light");
    expect(themeColorOf({ theme: "grey", mode: "light" })).toEqual([
      { media: light, color: greyLight },
      { media: dark, color: greyLight },
    ]);
  });
});
