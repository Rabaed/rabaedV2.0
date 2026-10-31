import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { claudeDesignExport, fakeBase64, font, nestedPage } from "./claude-design-export.fixtures.ts";
import { type ManifestEntry, stripFonts } from "./design-strip-fonts.ts";

const manifestOf = (html: string) => JSON.parse(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/.exec(html)![1]!);
const extResourcesOf = (html: string) => JSON.parse(/<script type="__bundler\/ext_resources">([\s\S]*?)<\/script>/.exec(html)![1]!);

describe("stripFonts", () => {
  it("removes every font resource from the manifest and keeps the rest", () => {
    const page = claudeDesignExport({
      logo: { mime: "image/svg+xml", compressed: true, data: fakeBase64 },
      thmanyah: { mime: font("woff2"), data: fakeBase64 },
      inter: { mime: font("woff"), compressed: true, data: fakeBase64 },
      legacy: { mime: "application/font-woff", data: fakeBase64 },
      upper: { mime: "Font/TTF", data: fakeBase64 },
      eot: { mime: "application/vnd.ms-fontobject", data: fakeBase64 },
      app: { mime: "application/javascript", data: fakeBase64 },
    });
    const { html, removed } = stripFonts(page);
    expect(removed).toEqual(["thmanyah", "inter", "legacy", "upper", "eot"]);
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

  it("never writes a raw </script> into the manifest, whatever a kept entry holds", () => {
    const tricky = { mime: "text/html", data: "</script><script>alert(1)</script>" };
    const page = claudeDesignExport({ thmanyah: { mime: font("woff2"), data: fakeBase64 } }).replace(
      '<script type="__bundler/manifest">{',
      `<script type="__bundler/manifest">{"page":${JSON.stringify(tricky).replace(/<\//g, "<\\/")},`,
    );
    const { html } = stripFonts(page);
    expect(html.match(/<\/script>/g)).toHaveLength(page.match(/<\/script>/g)!.length);
    expect(manifestOf(html)).toEqual({ page: tricky });
  });

  it("finds the manifest when its script tag carries more attributes", () => {
    const page = claudeDesignExport({ thmanyah: { mime: font("woff2"), data: fakeBase64 } }).replace(
      '<script type="__bundler/manifest">',
      '<script id="manifest" type="__bundler/manifest" data-version="2">',
    );
    const { html, removed } = stripFonts(page);
    expect(removed).toEqual(["thmanyah"]);
    expect(html).toContain('<script id="manifest" type="__bundler/manifest" data-version="2">{}</script>');
  });

  describe("a page nested in the manifest (RP-1146)", () => {
    const decoded = (entry: ManifestEntry) => {
      const bytes = Buffer.from(entry.data, "base64");
      return (entry.compressed ? gunzipSync(bytes) : bytes).toString("utf8");
    };
    const inner = () => claudeDesignExport({ app: { mime: "application/javascript", data: fakeBase64 }, thmanyah: { mime: font("woff2"), data: fakeBase64 } });

    it("removes the fonts of a gzipped nested page and gzips it again", () => {
      const page = claudeDesignExport({ logo: { mime: "image/svg+xml", data: fakeBase64 }, board: nestedPage(inner()) });
      const { html, removed } = stripFonts(page);
      expect(removed).toEqual(["board/thmanyah"]);
      const board = manifestOf(html).board as ManifestEntry;
      expect(board).toMatchObject({ mime: "text/html", compressed: true });
      expect(manifestOf(decoded(board))).toEqual({ app: { mime: "application/javascript", data: fakeBase64 } });
      expect(manifestOf(html).logo).toEqual({ mime: "image/svg+xml", data: fakeBase64 });
    });

    it("keeps a nested page that was not compressed plain base64", () => {
      const { html } = stripFonts(claudeDesignExport({ board: nestedPage(inner(), false) }));
      const board = manifestOf(html).board as ManifestEntry;
      expect(board.compressed).toBe(false);
      expect(decoded(board)).toBe(stripFonts(inner()).html);
    });

    it("strips a page nested two deep, and the outer page's own fonts beside it", () => {
      const page = claudeDesignExport({ arabic: { mime: font("woff2"), data: fakeBase64 }, outer: nestedPage(claudeDesignExport({ board: nestedPage(inner()) })) });
      const { html, removed } = stripFonts(page);
      expect(removed).toEqual(["arabic", "outer/board/thmanyah"]);
      const board = manifestOf(decoded(manifestOf(html).outer)).board as ManifestEntry;
      expect(Object.keys(manifestOf(decoded(board)))).toEqual(["app"]);
    });

    it("leaves a nested page without fonts, or one that is no export, byte for byte", () => {
      const plain = nestedPage("<html><body>No manifest</body></html>");
      const clean = nestedPage(claudeDesignExport({ app: { mime: "application/javascript", data: fakeBase64 } }));
      const quoting = nestedPage('<pre><script type="__bundler/manifest">{ ... }</script></pre>');
      const page = claudeDesignExport({ plain, clean, quoting });
      expect(stripFonts(page)).toEqual({ html: page, removed: [] });
    });

    it("refuses a nested page it cannot decode, naming it", () => {
      const page = claudeDesignExport({ board: { mime: "text/html", compressed: true, data: fakeBase64 } });
      expect(() => stripFonts(page)).toThrow(/nested page board .*could not be decoded/);
    });
  });

  it("refuses a file that is not a Claude Design page", () => {
    expect(() => stripFonts("<html><body>Plain page</body></html>")).toThrow(/not a Claude Design page/);
  });
});
