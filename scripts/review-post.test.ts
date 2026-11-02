import { describe, expect, it } from "vitest";
import { postReview, reviewComment, type PostSeam } from "./review-post.ts";
import { reviewMarker } from "./reviewed-add.ts";
import { baselineMarker } from "./verify-gate.ts";

const HEAD = "a".repeat(40);

function fakeSeam(overrides: Partial<PostSeam> = {}) {
  const posted: { pr: number; body: string }[] = [];
  const seam: PostSeam = {
    head: () => HEAD,
    dirty: () => [],
    prHead: () => HEAD,
    read: () => "No findings.\n",
    body: () => "Builds the thing.\n\n<!-- implement: RP-1 -->\n",
    branch: () => "RP-1-x",
    changedFiles: () => ["scripts/x.ts"],
    post: (pr, body) => void posted.push({ pr, body }),
    ...overrides,
  };
  return { seam, posted };
}

describe("reviewComment", () => {
  it("starts with the marker for the reviewed commit and keeps the summary", () => {
    const body = reviewComment(HEAD, "  1 finding, fixed.\n");
    expect(body.startsWith(`${reviewMarker(HEAD)}\n`)).toBe(true);
    expect(body).toContain("1 finding, fixed.");
  });
});

describe("postReview", () => {
  it("posts the summary with the marker for the PR's head", () => {
    const { seam, posted } = fakeSeam();
    expect(postReview(["12", "summary.md"], seam).ok).toBe(true);
    expect(posted).toEqual([{ pr: 12, body: reviewComment(HEAD, "No findings.\n") }]);
  });

  it("refuses when the checkout's HEAD is not the PR's head: the review would not be of what is pushed", () => {
    const { seam, posted } = fakeSeam({ prHead: () => "b".repeat(40) });
    const result = postReview(["12", "summary.md"], seam);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("push");
    expect(posted).toEqual([]);
  });

  // RP-1195 item 4: a review is posted only on a PR built through /implement or /implement-spec.
  it("refuses a PR whose body has no implement marker, and names the fix", () => {
    const { seam, posted } = fakeSeam({ body: () => "Builds the thing.\n" });
    const result = postReview(["12", "summary.md"], seam);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("build it through the `rabaed-implement` skill, which writes the marker");
    expect(result.message).toContain("<!-- implement: RP-1 -->");
    expect(result.message).toMatch(/a PR opened before RP-1195 merged[^]*gh pr edit 12 --body-file/);
    expect(posted).toEqual([]);
  });

  it("accepts more than one marker when one names the branch's key", () => {
    const { seam, posted } = fakeSeam({ body: () => "<!-- implement: RP-900 -->\n<!-- implement: RP-1 -->", branch: () => "RP-1-x" });
    expect(postReview(["12", "summary.md"], seam).ok).toBe(true);
    expect(posted).toHaveLength(1);
  });

  it("does not take a malformed marker, one inside a line, a fenced block or a quote", () => {
    const fenced = "Example:\n```\n<!-- implement: RP-1 -->\n```\n";
    const tilde = "````md\n<!-- implement: RP-1 -->\n````";
    for (const body of ["<!-- implement: -->", "<!-- implement: rp-1 -->", "<!-- implement: RP- -->", "implement: RP-1", "See <!-- implement: RP-1 --> here", fenced, tilde, "> <!-- implement: RP-1 -->"]) {
      expect(postReview(["12", "s.md"], fakeSeam({ body: () => body }).seam).ok, body).toBe(false);
    }
  });

  it("takes a marker on its own line after a closed fence, and a CRLF body", () => {
    expect(postReview(["12", "s.md"], fakeSeam({ body: () => "```\ncode\n```\n<!-- implement: RP-1 -->\n" }).seam).ok).toBe(true);
    expect(postReview(["12", "s.md"], fakeSeam({ body: () => "Text.\r\n<!-- implement: RP-1 -->\r\n" }).seam).ok).toBe(true);
  });

  it("refuses a marker for another key than the branch's, naming both", () => {
    const { seam, posted } = fakeSeam({ body: () => "<!-- implement: RP-2 -->", branch: () => "RP-1195-pr-tools" });
    const result = postReview(["12", "s.md"], seam);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("RP-2");
    expect(result.message).toContain("RP-1195");
    expect(posted).toEqual([]);
  });

  it("refuses when the branch name has no RP key, and says so", () => {
    for (const branch of ["claude/x", "fix-RP-1", "rp-1-x", "RP-1x"]) {
      const result = postReview(["12", "s.md"], fakeSeam({ branch: () => branch }).seam);
      expect(result.ok, branch).toBe(false);
      expect(result.message).toContain(`branch ${branch} has no RP key`);
    }
  });

  it("needs no marker on a PR whose changed files are all docs, rule files included", () => {
    const files = ["docs/agents/issue-tracker.md", "CODING_STANDARDS.md", "planning/parallel-sessions.md", "docs/visibility/x.png"];
    const { seam, posted } = fakeSeam({ body: () => "", branch: () => "claude/docs", changedFiles: () => files });
    expect(postReview(["12", "s.md"], seam).ok).toBe(true);
    expect(posted).toHaveLength(1);
  });

  it("still needs the marker on a code PR, whatever its labels: a docs-only label is no exemption", () => {
    const { seam, posted } = fakeSeam({ body: () => "", changedFiles: () => ["scripts/x.ts"] });
    expect(postReview(["12", "s.md"], seam).ok).toBe(false);
    expect(posted).toEqual([]);
  });

  it("refuses without a marker when the changed files can't be read, or are none, or one is not a doc", () => {
    const unreadable = fakeSeam({ body: () => "", changedFiles: () => { throw new Error("gh api failed"); } });
    expect(postReview(["12", "s.md"], unreadable.seam).ok).toBe(false);
    expect(postReview(["12", "s.md"], fakeSeam({ body: () => "", changedFiles: () => [] }).seam).ok).toBe(false);
    expect(postReview(["12", "s.md"], fakeSeam({ body: () => "", changedFiles: () => ["README.md", "scripts/x.ts"] }).seam).ok).toBe(false);
    expect(unreadable.posted).toEqual([]);
  });

  it("refuses a checkout with uncommitted or untracked files", () => {
    const { seam, posted } = fakeSeam({ dirty: () => ["?? scripts/new.ts"] });
    expect(postReview(["12", "summary.md"], seam)).toMatchObject({ ok: false });
    expect(posted).toEqual([]);
  });

  it("refuses an empty summary, a summary that already holds a marker, and bad arguments", () => {
    expect(postReview(["12", "s.md"], fakeSeam({ read: () => "  \n" }).seam).ok).toBe(false);
    expect(postReview(["12", "s.md"], fakeSeam({ read: () => reviewMarker("b".repeat(40)) }).seam).ok).toBe(false);
    expect(postReview(["x", "s.md"], fakeSeam().seam).message).toMatch(/Usage/);
    // Main 6's baseline approval (RP-1194) is never the lane's review step's to write.
    const main6 = postReview(["12", "s.md"], fakeSeam({ read: () => `Fixed.\n${baselineMarker(HEAD)}\n` }).seam);
    expect(main6.ok).toBe(false);
    expect(main6.message).toContain("Main 6");
    expect(postReview(["0x10", "s.md"], fakeSeam().seam).message).toMatch(/Usage/);
    expect(postReview(["12"], fakeSeam().seam).message).toMatch(/Usage/);
  });
});
