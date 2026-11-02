import { describe, expect, it } from "vitest";
import { hasPnpmQueueMarker, pnpmQueueComment, pnpmQueueMarker } from "./queue-marker.ts";

const sha = "0123456789abcdef0123456789abcdef01234567";

describe("the pnpm queue marker (RP-1195 item 3)", () => {
  it("is a hidden comment naming the head", () => {
    expect(pnpmQueueMarker(sha)).toBe("<!-- pnpm-queue: 0123456789abcdef0123456789abcdef01234567 -->");
  });

  it("the comment holds the marker and one plain line", () => {
    expect(pnpmQueueComment(sha)).toBe("<!-- pnpm-queue: 0123456789abcdef0123456789abcdef01234567 -->\nQueued by `pnpm queue` at 0123456789abcdef0123456789abcdef01234567.");
  });

  it("matches a body holding the marker for that head only", () => {
    expect(hasPnpmQueueMarker(pnpmQueueComment(sha), sha)).toBe(true);
    expect(hasPnpmQueueMarker(pnpmQueueComment(sha), "f".repeat(40))).toBe(false);
    expect(hasPnpmQueueMarker(`Queued by \`pnpm queue\` at ${sha}.`, sha)).toBe(false);
  });

  it("never holds the code-review marker text, so reviewed-add skips the comment", () => {
    expect(pnpmQueueComment(sha)).not.toContain("<!-- code-review: ");
  });
});
