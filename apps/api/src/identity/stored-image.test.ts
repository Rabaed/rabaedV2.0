import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FileStore } from "../documents/file-store.ts";
import { isImageOf, storeImage } from "./stored-image.ts";

// The api's own image save (a Signature, a logo, a Stamp): stored, then recorded; an image
// nothing records is removed again, so the bucket keeps no file nothing points at.

/** A file store that keeps what is put in memory: only put and remove are used. */
function memoryStore() {
  const kept = new Map<string, Uint8Array>();
  const files = {
    put: async (key: string, bytes: Uint8Array) => void kept.set(key, bytes),
    remove: async (key: string) => void kept.delete(key),
  } as unknown as FileStore;
  return { files, kept };
}

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const image = { key: "members/m/signatures/s.png", bytes: png, contentType: "image/png" as const };

describe("storeImage", () => {
  it("stores the image and records it, with its fingerprint and size, keeping it once recorded", async () => {
    const { files, kept } = memoryStore();
    const outcome = await storeImage(files, image, async (stored) => stored, () => true);
    expect(outcome).toEqual({ key: image.key, sha256: createHash("sha256").update(png).digest(), size: 11, mime: "image/png" });
    expect([...kept.keys()]).toEqual([image.key]);
  });

  it("removes the image when the record keeps nothing, and gives back the outcome", async () => {
    const { files, kept } = memoryStore();
    expect(await storeImage(files, image, async () => "forbidden", (o) => o === "set")).toBe("forbidden");
    expect(kept.size).toBe(0);
  });

  it("removes the image when recording it fails, and rethrows", async () => {
    const { files, kept } = memoryStore();
    const failed = new Error("database down");
    await expect(storeImage(files, image, () => Promise.reject(failed), () => true)).rejects.toBe(failed);
    expect(kept.size).toBe(0);
  });
});

describe("isImageOf", () => {
  it("takes the bytes of the type named, within the size, and nothing else", () => {
    expect(isImageOf(png, "image/png", 11)).toBe(true);
    expect(isImageOf(png, "image/png", 10)).toBe(false);
    expect(isImageOf(png, "image/jpeg", 100)).toBe(false);
    expect(isImageOf(new Uint8Array(), "image/png", 100)).toBe(false);
  });
});
