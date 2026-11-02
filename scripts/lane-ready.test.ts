import { describe, expect, it } from "vitest";
import { laneReady, type ReadySeam } from "./lane-ready.ts";
import { reviewComment } from "./review-post.ts";

const HEAD = "a".repeat(40);

function fakeSeam(overrides: Partial<ReadySeam> = {}) {
  const steps: string[] = [];
  const seam: ReadySeam = {
    head: () => HEAD,
    dirty: () => [],
    prHead: () => HEAD,
    read: () => "No findings.\n",
    body: () => "<!-- implement: RP-1 -->",
    labels: () => [],
    changedFiles: () => ["scripts/x.ts"],
    isDraft: () => true,
    markReady: (pr) => void steps.push(`ready ${pr}`),
    post: (pr, body) => void steps.push(`post ${pr} ${body}`),
    ...overrides,
  };
  return { seam, steps };
}

describe("laneReady", () => {
  it("marks a draft PR ready, then posts the review for its head", () => {
    const { seam, steps } = fakeSeam();
    const result = laneReady(["12", "summary.md"], seam);
    expect(result.ok).toBe(true);
    expect(steps).toEqual(["ready 12", `post 12 ${reviewComment(HEAD, "No findings.\n")}`]);
  });

  it("posts without marking ready when the PR is not a draft", () => {
    const { seam, steps } = fakeSeam({ isDraft: () => false });
    expect(laneReady(["12", "summary.md"], seam).ok).toBe(true);
    expect(steps).toEqual([`post 12 ${reviewComment(HEAD, "No findings.\n")}`]);
  });

  it("changes nothing when HEAD is not the PR's head, the checkout is dirty, or the marker is missing", () => {
    for (const overrides of [{ prHead: () => "b".repeat(40) }, { dirty: () => ["?? review.md"] }, { body: () => "" }] satisfies Partial<ReadySeam>[]) {
      const { seam, steps } = fakeSeam(overrides);
      expect(laneReady(["12", "summary.md"], seam).ok).toBe(false);
      expect(steps).toEqual([]);
    }
  });

  it("says the PR is ready but holds no review when posting fails after marking it ready", () => {
    const { seam, steps } = fakeSeam({
      post: () => {
        throw new Error("gh pr comment failed");
      },
    });
    const result = laneReady(["12", "summary.md"], seam);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("is ready");
    expect(result.message).toContain("gh pr comment failed");
    expect(steps).toEqual(["ready 12"]);
  });

  it("shows its usage on bad arguments, saying where the summary may live", () => {
    for (const args of [[], ["12"], ["x", "s.md"], ["12", "s.md", "more"]]) {
      const result = laneReady(args, fakeSeam().seam);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Usage: node scripts\/lane-ready\.ts <pr> <summary-file>/);
      expect(result.message).toContain("outside the worktree");
    }
  });
});
