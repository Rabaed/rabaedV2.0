import { describe, expect, it } from "vitest";
import { claudeDesignExport, fakeBase64, font } from "./claude-design-export.fixtures.ts";
import { stripFonts } from "./design-strip-fonts.ts";

const manifestOf = (html: string) => JSON.parse(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/.exec(html)![1]!);
const extResourcesOf = (html: string) => JSON.parse(/<script type="__bundler\/ext_resources">([\s\S]*?)<\/script>/.exec(html)![1]!);

describe("stripFonts", () => {
  it("removes every font resource from the manifest and keeps the rest", () => {
    const page = claudeDesignExport({
      logo: { mime: "image/svg+xml", compressed: true, data: fakeBase64 },
      thmanyah: { mime: font("woff2"), data: fakeBase64 },
      inter: { mime: font("woff"), compressed: true, data: fakeBase64 },
      legacy: { mime: "application/font-woff", data: fakeBase64 },
      app: { mime: "application/javascript", data: fakeBase64 },
    });
    const { html, removed } = stripFonts(page);
    expect(removed).toEqual(["thmanyah", "inter", "legacy"]);
    expect(manifestOf(html)).toEqual({
      logo: { mime: "image/svg+xml", compressed: true, data: fakeBase64 },
      app: { mime: "application/javascript", data: fakeBase64 },
    });
  });

  it("drops the named resources that pointed at a removed font", () => {
    const page = claudeDesignExport(
      { logo: { mime: "image/svg+xml", data: fakeBase64 }, thmanyah: { mime: font("woff2"), data: fakeBase64 } },
      [
        { id: "markSvg", uuid: "logo" },
        { id: "arabicFont", uuid: "thmanyah" },
      ],
    );
    expect(extResourcesOf(stripFonts(page).html)).toEqual([{ id: "markSvg", uuid: "logo" }]);
  });

  it("leaves the rest of the file as it was", () => {
    const page = claudeDesignExport({ thmanyah: { mime: font("woff2"), data: fakeBase64 } });
    const { html } = stripFonts(page);
    expect(html).toBe(claudeDesignExport({}));
  });

  it("refuses a file that is not a Claude Design page", () => {
    expect(() => stripFonts("<html><body>Plain page</body></html>")).toThrow(/not a Claude Design page/);
  });
});
