import { describe, expect, it } from "vitest";
import { verifyOverlap } from "./verify-overlap.ts";

// The open-PR overlap look before pnpm verify's first step (RP-1191).
describe("verifyOverlap", () => {
  it("returns the look's text for the checked-out repo", async () => {
    const asked: string[] = [];
    const text = await verifyOverlap("/work", async (repo) => {
      asked.push(repo);
      return "check:claims: other open PRs change files this branch changes:\n  #7 (RP-7-x) would conflict in: scripts/a.ts";
    });
    expect(text).toContain("#7 (RP-7-x) would conflict in: scripts/a.ts");
    expect(asked).toEqual(["/work"]);
  });

  it("is empty when no open PR shares a file, so nothing is printed", async () => {
    expect(await verifyOverlap("/work", async () => "")).toBe("");
  });

  it("says it could not look, and does not throw, when the look itself fails: a warning never stops a verify", async () => {
    const text = await verifyOverlap("/work", async () => {
      throw new Error("gh: not logged in");
    });
    expect(text).toMatch(/^Warning: .*could not look.*gh: not logged in/);
    expect(text).not.toContain("\n");
  });

  it("does not wait on a look that never answers", async () => {
    const text = await verifyOverlap("/work", () => new Promise<string>(() => {}), 20);
    expect(text).toMatch(/^Warning: .*could not look.*20 ms/);
  });
});
