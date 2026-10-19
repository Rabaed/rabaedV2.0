import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256, toArrayBuffer } from "./pki.ts";

// A small Buffer from Node shares one pool with others: its `buffer` is the whole pool. The record's
// hashes (the PDF's, the Record Data's) must be of the bytes themselves, whatever they are a view of.

describe("the record's SHA-256", () => {
  it("hashes a pooled Buffer's own bytes, never the rest of its pool", async () => {
    const pooled = Buffer.from("a small pooled buffer");
    expect(pooled.buffer.byteLength).toBeGreaterThan(pooled.byteLength);
    expect(Buffer.from(await sha256(pooled)).toString("hex")).toBe(createHash("sha256").update(pooled).digest("hex"));
    expect(toArrayBuffer(pooled).byteLength).toBe(pooled.byteLength);
  });

  it("hashes a view into a larger array as that view", async () => {
    const whole = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const view = whole.subarray(2, 4);
    expect(Buffer.from(await sha256(view)).toString("hex")).toBe(createHash("sha256").update(Uint8Array.from([3, 4])).digest("hex"));
  });
});
