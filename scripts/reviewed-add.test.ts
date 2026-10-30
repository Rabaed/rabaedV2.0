import { describe, expect, it } from "vitest";
import { addEvent, addReviewed, isTrustedAuthor, reviewAt, reviewMarker, type AddSeam, type ReviewComment } from "./reviewed-add.ts";
import { REVIEWED_LABEL, type ReviewedGit } from "./reviewed-label.ts";
import { stampLine } from "./verify-gate.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const MAIN = "c".repeat(40);
const verifyLine = (sha: string) => stampLine(`pnpm verify passed on ${sha.slice(0, 9)}: lint, typecheck, test:unit.`);

const byOwner = (body: string): ReviewComment => ({ login: "mmhaleess90", type: "User", association: "MEMBER", body });
const review = (sha: string) => byOwner(`${reviewMarker(sha)}\n**/code-review summary at ${sha}**\n\nNo findings.`);

// HEAD is a clean merge of main into OLD; nothing else has parents.
const git: ReviewedGit = {
  parents: (commit) => (commit === HEAD ? [OLD, MAIN] : []),
  onMain: (commit) => commit === MAIN,
  tree: () => "tree1",
  mergedTree: () => "tree1",
  identity: () => ({ author: "dev@example.com", committer: "dev@example.com" }),
  changedPaths: () => ["scripts/x.ts"],
};
const noMerges: ReviewedGit = { ...git, parents: () => [] };

describe("reviewMarker", () => {
  it("is a hidden HTML comment naming the full head", () => {
    expect(reviewMarker(HEAD)).toBe(`<!-- code-review: ${HEAD} -->`);
  });
});

describe("isTrustedAuthor", () => {
  it("trusts the repo's own accounts: a user who owns, is a member of, or collaborates on the repo", () => {
    for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) expect(isTrustedAuthor({ ...byOwner(""), association })).toBe(true);
  });

  it("does not trust anyone else, nor any bot: a workflow could post as github-actions[bot]", () => {
    for (const association of ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"]) expect(isTrustedAuthor({ ...byOwner(""), association })).toBe(false);
    expect(isTrustedAuthor({ login: "github-actions[bot]", type: "Bot", association: "MEMBER", body: "" })).toBe(false);
  });
});

describe("reviewAt", () => {
  it("finds a trusted review comment for the head", () => {
    expect(reviewAt([review(HEAD)], HEAD, noMerges)).toEqual({ ok: true, commit: HEAD });
  });

  it("refuses a PR with no review comment at all", () => {
    const found = reviewAt([byOwner("LGTM")], HEAD, noMerges);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toContain(reviewMarker("<sha>"));
  });

  it("refuses a review comment for an older head that a code change followed", () => {
    const found = reviewAt([review(OLD)], HEAD, noMerges);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toContain(OLD);
  });

  it("takes a review comment for a commit only clean merges of main led to the head from (RP-1017)", () => {
    expect(reviewAt([review(OLD)], HEAD, git)).toEqual({ ok: true, commit: OLD });
  });

  it("does not count a marker from an untrusted author", () => {
    const found = reviewAt([{ ...review(HEAD), login: "stranger", association: "NONE" }], HEAD, noMerges);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toContain("stranger");
  });

  it("does not count a marker with an abbreviated sha, or one quoted inside other text", () => {
    expect(reviewAt([byOwner(`<!-- code-review: ${HEAD.slice(0, 9)} -->`)], HEAD, noMerges).ok).toBe(false);
    expect(reviewAt([byOwner(`<!-- code-review: ${HEAD}x -->`)], HEAD, noMerges).ok).toBe(false);
  });
});

describe("addEvent", () => {
  it("reads the PR from a pull_request event", () => {
    expect(addEvent("pull_request", { pull_request: { number: 7 } })).toEqual({ pr: 7 });
  });

  it("reads the PR from a comment on a PR, and skips a comment on a plain issue", () => {
    expect(addEvent("issue_comment", { issue: { number: 8, pull_request: { url: "u" } } })).toEqual({ pr: 8 });
    expect(addEvent("issue_comment", { issue: { number: 9 } })).toBeUndefined();
  });

  it("refuses any other event", () => {
    expect(() => addEvent("push", {})).toThrow(/pull_request and issue_comment/);
  });
});

type Pull = Awaited<ReturnType<AddSeam["pull"]>>;

function fakeSeam(start: Partial<Pull> & { comments?: ReviewComment[]; graph?: ReviewedGit; headAfterAdd?: string; requiredRuns?: { id: number; status: string; conclusion: string | null }[] }) {
  const calls: string[] = [];
  let pull: Pull = { body: verifyLine(HEAD), headSha: HEAD, labels: [], draft: false, sameRepo: true, open: true, ...start };
  const seam: AddSeam = {
    ...(start.graph ?? noMerges),
    pull: async () => pull,
    comments: async () => start.comments ?? [review(HEAD)],
    fetchPull: () => void calls.push("fetch"),
    labelRuns: async () => [{ status: "completed" }],
    requiredRuns: async () => start.requiredRuns ?? [{ id: 41, status: "completed", conclusion: "failure" }],
    addLabel: async () => {
      calls.push("add");
      pull = { ...pull, labels: [...pull.labels, REVIEWED_LABEL], headSha: start.headAfterAdd ?? pull.headSha };
    },
    removeLabel: async () => void calls.push("remove"),
    rerun: async (id) => void calls.push(`rerun ${id}`),
    sleep: async () => undefined,
  };
  return { seam, calls };
}

describe("addReviewed", () => {
  it("adds the label when a trusted review comment and a stamped verify line both name the head, then re-runs reviewed-required", async () => {
    const { seam, calls } = fakeSeam({});
    const result = await addReviewed({ pr: 5 }, seam);
    expect(result).toMatchObject({ ok: true, added: true });
    expect(calls).toEqual(["fetch", "add", "rerun 41"]);
  });

  it("never adds it without a review comment at the head", async () => {
    const { seam, calls } = fakeSeam({ comments: [review(OLD)] });
    const result = await addReviewed({ pr: 5 }, seam);
    expect(result).toMatchObject({ ok: true, added: false });
    expect(result.summary).toContain("review");
    expect(calls).not.toContain("add");
  });

  it("never adds it without a stamped verify line for the head", async () => {
    for (const body of ["", verifyLine(OLD), `pnpm verify passed on ${HEAD.slice(0, 9)}: lint.`]) {
      const { seam, calls } = fakeSeam({ body });
      const result = await addReviewed({ pr: 5 }, seam);
      expect(result).toMatchObject({ ok: true, added: false });
      expect(calls).not.toContain("add");
    }
  });

  it("never adds it for a review comment by an untrusted author", async () => {
    const { seam, calls } = fakeSeam({ comments: [{ ...review(HEAD), login: "github-actions[bot]", type: "Bot", association: "CONTRIBUTOR" }] });
    expect((await addReviewed({ pr: 5 }, seam)).added).toBe(false);
    expect(calls).not.toContain("add");
  });

  it("adds it on a clean merge of main after the reviewed and verified commit", async () => {
    const { seam, calls } = fakeSeam({ comments: [review(OLD)], body: verifyLine(OLD), graph: git });
    expect((await addReviewed({ pr: 5 }, seam)).added).toBe(true);
    expect(calls).toContain("add");
  });

  it("leaves a draft, a fork's PR, a closed PR and a PR that already has the label alone", async () => {
    for (const start of [{ draft: true }, { sameRepo: false }, { open: false }, { labels: [REVIEWED_LABEL] }]) {
      const { seam, calls } = fakeSeam(start);
      expect(await addReviewed({ pr: 5 }, seam)).toMatchObject({ ok: true, added: false });
      expect(calls).toEqual([]);
    }
  });

  it("takes the label off again when a push landed while it was being added", async () => {
    const { seam, calls } = fakeSeam({ headAfterAdd: "d".repeat(40) });
    const result = await addReviewed({ pr: 5 }, seam);
    expect(result).toMatchObject({ ok: true, added: false });
    expect(calls).toEqual(["fetch", "add", "remove"]);
  });

  it("waits for the head's reviewed-label run before reading the label, and gives up after the timeout", async () => {
    const { seam, calls } = fakeSeam({});
    const result = await addReviewed({ pr: 5 }, { ...seam, labelRuns: async () => [{ status: "in_progress" }] }, { pollMs: 10, timeoutMs: 30 });
    expect(result).toMatchObject({ ok: false, added: false });
    expect(result.summary).toContain("reviewed-label");
    expect(calls).toEqual([]);
  });

  it("does not re-run a reviewed-required run that passed, and waits for one still running", async () => {
    const passed = fakeSeam({ requiredRuns: [{ id: 41, status: "completed", conclusion: "success" }] });
    await addReviewed({ pr: 5 }, passed.seam);
    expect(passed.calls).toEqual(["fetch", "add"]);

    const states = [
      [{ id: 42, status: "in_progress", conclusion: null }],
      [{ id: 42, status: "completed", conclusion: "failure" }],
    ];
    const running = fakeSeam({});
    await addReviewed({ pr: 5 }, { ...running.seam, requiredRuns: async () => states.shift() ?? [] }, { pollMs: 10, timeoutMs: 100 });
    expect(running.calls).toEqual(["fetch", "add", "rerun 42"]);
  });

  it("reads the label only after the reviewed-label run: a stale label seen before it is about to be removed", async () => {
    const { seam, calls } = fakeSeam({});
    let reads = 0;
    // The first read still shows the label left from the earlier head; the run then removed it.
    const stale: AddSeam = { ...seam, pull: async () => ({ ...(await seam.pull(5)), labels: reads++ === 0 ? [REVIEWED_LABEL] : [] }) };
    expect((await addReviewed({ pr: 5 }, stale)).added).toBe(true);
    expect(calls).toContain("add");
  });

  it("reports a reviewed-required run that never finished instead of passing quietly", async () => {
    const { seam, calls } = fakeSeam({ requiredRuns: [{ id: 43, status: "in_progress", conclusion: null }] });
    const result = await addReviewed({ pr: 5 }, seam, { pollMs: 10, timeoutMs: 30 });
    expect(result).toMatchObject({ ok: false, added: true });
    expect(result.summary).toContain("43");
    expect(calls).toEqual(["fetch", "add"]);
  });

  it("stops when the head moved while it waited: that push's own run decides", async () => {
    const { seam, calls } = fakeSeam({});
    let reads = 0;
    const moving: AddSeam = { ...seam, pull: async () => ({ ...(await seam.pull(5)), headSha: reads++ === 0 ? HEAD : OLD }) };
    expect(await addReviewed({ pr: 5 }, moving)).toMatchObject({ ok: true, added: false });
    expect(calls).toEqual([]);
  });
});
