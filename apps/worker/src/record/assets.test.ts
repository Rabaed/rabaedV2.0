import { createHash } from "node:crypto";
import type { DocumentFact } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { documentAssets, formAssets } from "./assets.ts";
import type { RecordFiles } from "./files.ts";
import { goldenFacts } from "./golden-fixtures.ts";

// The Form's photos as the record job reads them (form-engine.md §6, element 8; RP-155, RP-982):
// the photos the record prints are inlined within the limits, in the order they were added, and
// every one, inlined or not, carries the fingerprint of its stored bytes, so the record names each
// file it shows by its fingerprint (RP-147's rule).

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = (text: string) => new TextEncoder().encode(text);

function store(contents: Record<string, Uint8Array>): RecordFiles {
  return {
    put: async () => undefined,
    get: async (key) => contents[key] ?? null,
    sha256: async (key) => (contents[key] ? sha(contents[key]) : null),
  };
}

const photo = (storageKey: string, body: Uint8Array, extra: Partial<DocumentFact> = {}): DocumentFact => ({
  fileName: `${storageKey}.jpg`,
  contentType: "image/jpeg",
  size: body.length,
  storageKey,
  sha256: sha(body),
  fieldKey: "inspection_checklist",
  itemKey: "formwork",
  takenAt: null,
  ...extra,
});

describe("the Form's photos on the record", () => {
  const small = bytes("a photo within the limits");
  const big = bytes("a photo past the 6 MB limit");
  const old = bytes("a large photo from before RP-618");
  const large = { size: 7 * 1024 * 1024 };
  const facts = (documents: DocumentFact[]) => ({ ...goldenFacts("wir", "en"), documents });
  const all = facts([photo("small", small), photo("big", big, large), photo("old", old, { ...large, sha256: null })]);

  it("inlines a photo within the limits, with the fingerprint of the bytes it inlined", async () => {
    const assets = await documentAssets(all, store({ small, big, old }));
    expect([...assets.images.keys()].filter((k) => !k.startsWith("logo-") && !k.startsWith("stamp-") && !k.startsWith("sig-"))).toEqual(["small"]);
    expect(assets.fingerprints.get("small")).toBe(sha(small));
  });

  it("gives one past the limits the fingerprint of its stored bytes (streamed), with no image, from before RP-618 too", async () => {
    const assets = await documentAssets(all, store({ small, big, old }));
    expect(assets.fingerprints.get("big")).toBe(sha(big));
    expect(assets.fingerprints.get("old")).toBe(sha(old));
    expect(assets.images.has("big")).toBe(false);
  });

  it("gives none to one whose file is gone, even with the fingerprint taken at its upload", async () => {
    const assets = await documentAssets(all, store({ small }));
    expect(assets.fingerprints.has("big")).toBe(false);
    expect(assets.fingerprints.has("old")).toBe(false);
  });

  it("reads only the photos it prints: never a reply Screen's own photos field's file, which no block prints", async () => {
    const screenPhoto = bytes("a reply Screen's photos field");
    const assets = await documentAssets(facts([photo("screen", screenPhoto, { fieldKey: "site_photos", itemKey: null }), photo("small", small)]), store({ screen: screenPhoto, small }));
    expect(assets.images.has("screen")).toBe(false);
    expect(assets.fingerprints.has("screen")).toBe(false);
    expect(assets.images.has("small")).toBe(true);
  });

  it("a Working Copy inlines the same photos and fingerprints none past the limits (it prints no fingerprint)", async () => {
    const assets = await formAssets(all, store({ small, big, old }));
    expect([...assets.images.keys()]).toEqual(["small"]);
    expect(assets.fingerprints.has("big")).toBe(false);
  });
});
