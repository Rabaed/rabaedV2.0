import { createHash } from "node:crypto";
import type { ReproductionSource } from "@rabaed/db";
import { describe, expect, it } from "vitest";
import type { RecordFiles } from "./files.ts";
import { findPhotos, replacedRecordKey } from "./reproduce.ts";

// How a Re-produce finds a Form photo's file again (RP-155): by the fingerprint the Record Data
// carries, among the item's Documents, never by a name two photos can share.

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = (text: string) => new TextEncoder().encode(text);

function store(contents: Record<string, Uint8Array>): RecordFiles {
  return { put: async () => undefined, get: async (key) => contents[key] ?? null };
}

const doc = (storageKey: string, body: Uint8Array | null, extra: Partial<ReproductionSource["documents"][number]> = {}): ReproductionSource["documents"][number] => ({
  fileName: "IMG_0001.jpg",
  contentType: "image/jpeg",
  size: body?.length ?? 1,
  storageKey,
  takenAt: null,
  sha256: body ? sha(body) : null,
  ...extra,
});

describe("findPhotos", () => {
  const one = bytes("first photo");
  const two = bytes("second photo");

  it("tells two photos of one name and no time apart by their fingerprints", async () => {
    const found = await findPhotos(new Set([sha(two), sha(one)]), [doc("k1", one), doc("k2", two)], store({ k1: one, k2: two }));
    expect(found.keys).toEqual(new Map([[sha(one), "k1"], [sha(two), "k2"]]));
    expect([...found.images.keys()].sort()).toEqual(["k1", "k2"]);
  });

  it("finds a Document confirmed before its fingerprint was kept, by hashing its bytes", async () => {
    const found = await findPhotos(new Set([sha(one)]), [doc("old", one, { sha256: null }), doc("k2", two)], store({ old: one, k2: two }));
    expect(found.keys).toEqual(new Map([[sha(one), "old"]]));
  });

  it("does not find a photo no Document has", async () => {
    const found = await findPhotos(new Set([sha(one), sha(bytes("gone"))]), [doc("k1", one)], store({ k1: one }));
    expect([...found.keys.keys()]).toEqual([sha(one)]);
  });

  it("does not find a photo whose file in storage is no longer what the record printed", async () => {
    const found = await findPhotos(new Set([sha(one)]), [doc("k1", one)], store({ k1: two }));
    expect(found.keys.size).toBe(0);
  });

  it("does not find a photo whose file is gone from storage", async () => {
    const found = await findPhotos(new Set([sha(one)]), [doc("k1", one)], store({}));
    expect(found.keys.size).toBe(0);
  });
});

describe("replacedRecordKey", () => {
  it("keeps the replaced PDF beside the record, by its fingerprint", () => {
    expect(replacedRecordKey("projects/p/work-items/w/documental-record/record.pdf", "ab")).toBe("projects/p/work-items/w/documental-record/replaced/ab.pdf");
  });
});
