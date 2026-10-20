import { createHash } from "node:crypto";
import type { DocumentFact } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import { formAssets } from "./assets.ts";
import type { RecordFiles } from "./files.ts";
import { goldenFacts } from "./golden-fixtures.ts";

// The Form's photos as the record job reads them (form-engine.md §6, element 8; RP-155, RP-982):
// each is inlined within the limits, and every one, inlined or not, carries its fingerprint, so
// the record names each file it shows by its fingerprint (RP-147's rule).

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

describe("formAssets: the Form's photos", () => {
  const small = bytes("a photo within the limits");
  const big = bytes("a photo past the 6 MB limit");
  const old = bytes("a large photo from before RP-618");
  const large = { size: 7 * 1024 * 1024 };
  const facts = {
    ...goldenFacts("wir", "en"),
    documents: [photo("small", small), photo("big", big, large), photo("old", old, { ...large, sha256: null })],
  };

  it("inlines a photo within the limits, with the fingerprint of the bytes it inlined", async () => {
    const assets = await formAssets(facts, store({ small, big, old }));
    expect([...assets.images.keys()]).toEqual(["small"]);
    expect(assets.fingerprints.get("small")).toBe(sha(small));
  });

  it("gives one past the limits its Document's fingerprint, and one from before RP-618 its streamed bytes' fingerprint, with no image", async () => {
    const assets = await formAssets(facts, store({ small, big, old }));
    expect(assets.fingerprints.get("big")).toBe(sha(big));
    expect(assets.fingerprints.get("old")).toBe(sha(old));
    expect(assets.images.has("big")).toBe(false);
  });

  it("gives none to one from before RP-618 whose file is gone", async () => {
    const assets = await formAssets(facts, store({ small, big }));
    expect(assets.fingerprints.has("old")).toBe(false);
  });
});
