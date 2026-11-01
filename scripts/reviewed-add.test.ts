import { describe, expect, it } from "vitest";
import type { CiRun } from "./ci-green.ts";
import { addEvent, addReviewed, isTrustedAuthor, overHttp, reviewAt, reviewMarker, writersAmong, type AddSeam, type Permission, type ReviewComment } from "./reviewed-add.ts";
import { BASELINE_BOT_EMAIL, BASELINE_FOLDER, REVIEWED_LABEL, type ReviewedGit } from "./reviewed-label.ts";
import { stampLine } from "./verify-gate.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const MAIN = "c".repeat(40);
const verifyLine = (sha: string) => stampLine(`pnpm verify passed on ${sha.slice(0, 9)}: lint, typecheck, test:unit.`);

const byOwner = (body: string): ReviewComment => ({ login: "mmhaleess90", type: "User", body });
const review = (sha: string) => byOwner(`${reviewMarker(sha)}\n**/code-review summary at ${sha}**\n\nNo findings.`);
const owner = new Set(["mmhaleess90"]);

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
  it("trusts a user who can push to the repo", () => {
    expect(isTrustedAuthor(byOwner(""), owner)).toBe(true);
  });

  it("does not trust a user without write access, nor any bot: a workflow could post as github-actions[bot]", () => {
    expect(isTrustedAuthor({ ...byOwner(""), login: "stranger" }, owner)).toBe(false);
    expect(isTrustedAuthor({ login: "github-actions[bot]", type: "Bot", body: "" }, new Set(["github-actions[bot]"]))).toBe(false);
  });
});

describe("writersAmong", () => {
  it("keeps the markers' authors whose permission is admin or write (GitHub reports maintain as write)", async () => {
    const permissions: Record<string, Permission> = { admin1: "admin", writer: "write", reader: "read", triager: "read", gone: "none" };
    const asked: string[] = [];
    const comments = Object.keys(permissions).map((login) => ({ ...review(HEAD), login }));
    const writers = await writersAmong([...comments, { ...review(OLD), login: "writer" }], async (login) => {
      asked.push(login);
      return permissions[login] ?? "none";
    });
    expect([...writers].sort()).toEqual(["admin1", "writer"]);
    expect(asked.filter((login) => login === "writer")).toHaveLength(1);
  });

  it("asks nothing for comments without a marker, nor for bots", async () => {
    const asked: string[] = [];
    await writersAmong([byOwner("LGTM"), { login: "github-actions[bot]", type: "Bot", body: reviewMarker(HEAD) }], async (login) => {
      asked.push(login);
      return "admin";
    });
    expect(asked).toEqual([]);
  });
});

describe("reviewAt", () => {
  it("finds a trusted review comment for the head", () => {
    expect(reviewAt([review(HEAD)], HEAD, noMerges, owner)).toEqual({ ok: true, commit: HEAD });
  });

  it("refuses a PR with no review comment at all", () => {
    const found = reviewAt([byOwner("LGTM")], HEAD, noMerges, owner);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toContain(reviewMarker("<sha>"));
  });

  it("refuses a review comment for an older head that a code change followed", () => {
    const found = reviewAt([review(OLD)], HEAD, noMerges, owner);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toContain(OLD);
  });

  it("takes a review comment for a commit only clean merges of main led to the head from (RP-1017)", () => {
    expect(reviewAt([review(OLD)], HEAD, git, owner)).toEqual({ ok: true, commit: OLD });
  });

  it("does not count a marker from an author without write access, and says why", () => {
    const found = reviewAt([{ ...review(HEAD), login: "stranger" }], HEAD, noMerges, owner);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toMatch(/stranger.*without write access/);
  });

  it("does not count a marker with an abbreviated sha, or one quoted inside other text", () => {
    expect(reviewAt([byOwner(`<!-- code-review: ${HEAD.slice(0, 9)} -->`)], HEAD, noMerges, owner).ok).toBe(false);
    expect(reviewAt([byOwner(`<!-- code-review: ${HEAD}x -->`)], HEAD, noMerges, owner).ok).toBe(false);
  });
});

describe("addEvent", () => {
  it("reads the PR from a pull_request event", () => {
    expect(addEvent("pull_request", { pull_request: { number: 7 } })).toEqual({ pr: 7 });
    // RP-1148: the workflow moves to pull_request_target, whose payload is the same.
    expect(addEvent("pull_request_target", { pull_request: { number: 7 } })).toEqual({ pr: 7 });
  });

  it("reads the PR from a comment on a PR, and skips a comment on a plain issue", () => {
    expect(addEvent("issue_comment", { issue: { number: 8, pull_request: { url: "u" } } })).toEqual({ pr: 8 });
    expect(addEvent("issue_comment", { issue: { number: 9 } })).toBeUndefined();
  });

  it("refuses any other event", () => {
    expect(() => addEvent("push", {})).toThrow(/pull_request_target \(or pull_request\), issue_comment and workflow_run/);
  });

  it("reads the PR from a finished CI run on its head (RP-1190), and nothing from a fork's, a push's or another workflow's run", () => {
    const ciRun = { event: "pull_request", path: ".github/workflows/ci.yml", head_sha: HEAD, pull_requests: [{ number: 3, head: { sha: OLD } }, { number: 4, head: { sha: HEAD } }] };
    expect(addEvent("workflow_run", { workflow_run: ciRun })).toEqual({ pr: 4 });
    // A fork's PR is not in pull_requests.
    expect(addEvent("workflow_run", { workflow_run: { ...ciRun, pull_requests: [] } })).toBeUndefined();
    expect(addEvent("workflow_run", { workflow_run: { ...ciRun, event: "push" } })).toBeUndefined();
    expect(addEvent("workflow_run", { workflow_run: { ...ciRun, path: ".github/workflows/other.yml" } })).toBeUndefined();
  });
});

type Pull = Awaited<ReturnType<AddSeam["pull"]>>;

function fakeSeam(
  start: Partial<Pull> & {
    comments?: ReviewComment[];
    /** GitHub's `permission` per login; anyone else has "none". */
    permissions?: Record<string, Permission>;
    graph?: ReviewedGit;
    headAfterAdd?: string;
    requiredRuns?: { id: number; status: string; conclusion: string | null }[];
    verifyRuns?: { id: number; status: string; conclusion: string | null }[];
    changed?: string[];
    ci?: CiRun[] | Error;
  },
) {
  const calls: string[] = [];
  let pull: Pull = { body: verifyLine(HEAD), headSha: HEAD, labels: [], draft: false, sameRepo: true, open: true, ...start };
  const permissions = start.permissions ?? { mmhaleess90: "admin" };
  const seam: AddSeam = {
    ...(start.graph ?? noMerges),
    pull: async () => pull,
    comments: async () => start.comments ?? [review(HEAD)],
    permission: async (login) => permissions[login] ?? "none",
    fetchPull: () => void calls.push("fetch"),
    labelRuns: async () => [{ status: "completed" }],
    requiredRuns: async () => start.requiredRuns ?? [{ id: 41, status: "completed", conclusion: "failure" }],
    verifyRuns: async () => start.verifyRuns ?? [{ id: 51, status: "completed", conclusion: "failure" }],
    changedFiles: () => start.changed ?? ["scripts/x.ts"],
    packageJsonVersions: () => ({ before: undefined, after: undefined }),
    requiredChecks: async () => ["lint", "unit", "verify-gate", "reviewed-required"],
    ciRuns: async () => {
      if (start.ci instanceof Error) throw start.ci;
      return start.ci ?? [];
    },
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

describe("addReviewed: CI green on the head counts as the verify (RP-1190)", () => {
  const green = (status = "completed", conclusion: string | null = "success"): CiRun => ({
    id: 61,
    headSha: HEAD,
    event: "pull_request",
    path: ".github/workflows/ci.yml",
    status,
    conclusion,
    repo: "Rabaed/rabaedV2.0",
    headRepo: "Rabaed/rabaedV2.0",
      pulls: [{ number: 5, baseRef: "main" }],
    jobs: ["lint", "unit"].map((name) => ({ name, status, conclusion })),
  });

  it("adds the label with no verify line when CI passed on the head, and re-runs the head's failed verify-gate and reviewed-required runs", async () => {
    const { seam, calls } = fakeSeam({ body: "", ci: [green()] });
    const result = await addReviewed({ pr: 5 }, seam);
    expect(result).toMatchObject({ ok: true, added: true });
    expect(result.summary).toContain("CI green (run 61)");
    expect(calls).toEqual(["fetch", "rerun 51", "add", "rerun 41"]);
  });

  it("re-runs a failed verify-gate run once CI is green, even before a review: the check reads CI only when it runs", async () => {
    const { seam, calls } = fakeSeam({ body: "", ci: [green()], comments: [] });
    const result = await addReviewed({ pr: 5 }, seam);
    expect(result.added).toBe(false);
    expect(calls).toEqual(["fetch", "rerun 51"]);
  });

  it("leaves a verify-gate run that passed or is still running alone", async () => {
    for (const verifyRuns of [[{ id: 52, status: "completed", conclusion: "success" }], [{ id: 53, status: "in_progress", conclusion: null }], []]) {
      const { seam, calls } = fakeSeam({ body: "", ci: [green()], comments: [], verifyRuns });
      await addReviewed({ pr: 5 }, seam);
      expect(calls).toEqual(["fetch"]);
    }
  });

  it("never adds it for a PR that edits ci.yml without the stamped line", async () => {
    const { seam, calls } = fakeSeam({ body: "", ci: [green()], changed: [".github/workflows/ci.yml"] });
    const result = await addReviewed({ pr: 5 }, seam);
    expect(result).toMatchObject({ ok: true, added: false });
    expect(result.summary).toContain("CI's own files");
    expect(calls).toEqual(["fetch"]);
  });

  it("says CI is still running and adds nothing", async () => {
    const { seam, calls } = fakeSeam({ body: "", ci: [green("in_progress", null)] });
    const result = await addReviewed({ pr: 5 }, seam);
    expect(result).toMatchObject({ ok: true, added: false });
    expect(result.summary).toContain(`CI still running on ${HEAD}: 2 jobs left`);
    expect(calls).toEqual(["fetch"]);
  });

  it("adds nothing when CI failed, or on an API error", async () => {
    for (const ci of [[green("completed", "failure")], new Error("GitHub GET actions/workflows/ci.yml/runs answered 500")]) {
      const { seam, calls } = fakeSeam({ body: "", ci });
      const result = await addReviewed({ pr: 5 }, seam);
      expect(result).toMatchObject({ ok: true, added: false });
      expect(calls).toEqual(["fetch"]);
    }
  });

  it("still adds it on a stamped line when CI cannot be read", async () => {
    const { seam, calls } = fakeSeam({ ci: new Error("GitHub GET rules/branches/main answered 403") });
    expect((await addReviewed({ pr: 5 }, seam)).added).toBe(true);
    expect(calls).toEqual(["fetch", "add", "rerun 41"]);
  });
});

describe("addReviewed", () => {
  it("adds the label when a trusted review comment and a stamped verify line both name the head, then re-runs reviewed-required", async () => {
    const { seam, calls } = fakeSeam({});
    const result = await addReviewed({ pr: 5 }, seam);
    expect(result).toMatchObject({ ok: true, added: true });
    expect(calls).toEqual(["fetch", "add", "rerun 41"]);
  });

  it("fails, naming why, and adds nothing when git cannot read a changed package.json (RP-1196)", async () => {
    const { seam, calls } = fakeSeam({ changed: ["apps/admin/package.json"] });
    seam.packageJsonVersions = () => {
      throw new Error("git ls-tree failed: fatal: Not a valid object name abc1234");
    };
    const result = await addReviewed({ pr: 5 }, seam);
    expect(result).toMatchObject({ ok: false, added: false });
    expect(result.summary).toContain("Not a valid object name abc1234");
    expect(calls).toEqual(["fetch"]);
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
    const { seam, calls } = fakeSeam({ comments: [{ ...review(HEAD), login: "github-actions[bot]", type: "Bot" }], permissions: { "github-actions[bot]": "admin" } });
    expect((await addReviewed({ pr: 5 }, seam)).added).toBe(false);
    expect(calls).not.toContain("add");
  });

  it("trusts a review comment by an author with write access, read from their repo permission, not their org membership (RP-1159)", async () => {
    // On PR #542 CI's token saw the owner's private org membership as CONTRIBUTOR; the permission read sees admin.
    for (const permission of ["admin", "write"] as const) {
      const { seam, calls } = fakeSeam({ permissions: { mmhaleess90: permission } });
      expect(await addReviewed({ pr: 5 }, seam)).toMatchObject({ ok: true, added: true });
      expect(calls).toContain("add");
    }
  });

  it("never adds it for a review comment by a user who can only read the repo", async () => {
    for (const permission of ["read", "none"] as const) {
      const { seam, calls } = fakeSeam({ permissions: { mmhaleess90: permission } });
      const result = await addReviewed({ pr: 5 }, seam);
      expect(result).toMatchObject({ ok: true, added: false });
      expect(result.summary).toContain("without write access");
      expect(calls).not.toContain("add");
    }
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
      // The label is read only after the reviewed-label wait, which needs the head's commits.
      expect(calls).toEqual(start.labels ? ["fetch"] : []);
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
    expect(calls).toEqual(["fetch"]);
  });

  it("does not wait for a reviewed-label run on the screenshot bot's baseline commit: a GITHUB_TOKEN push starts none", async () => {
    const bot: ReviewedGit = {
      ...git,
      parents: (commit) => (commit === HEAD ? [OLD] : []),
      identity: () => ({ author: BASELINE_BOT_EMAIL, committer: BASELINE_BOT_EMAIL }),
      changedPaths: () => [`${BASELINE_FOLDER}/button.png`],
    };
    const { seam, calls } = fakeSeam({ comments: [review(HEAD)], graph: bot });
    const result = await addReviewed({ pr: 5 }, { ...seam, labelRuns: async () => [] }, { pollMs: 10, timeoutMs: 30 });
    expect(result).toMatchObject({ ok: true, added: true });
    expect(calls).toContain("add");
  });

  it("still waits when a code commit has no reviewed-label run yet", async () => {
    const { seam } = fakeSeam({});
    expect(await addReviewed({ pr: 5 }, { ...seam, labelRuns: async () => [] }, { pollMs: 10, timeoutMs: 30 })).toMatchObject({ ok: false, added: false });
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
    expect(calls).toEqual(["fetch"]);
  });
});

describe("overHttp", () => {
  const answering = (status: number, body: unknown) => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return new Response(status === 404 ? null : JSON.stringify(body), { status });
    }) as typeof fetch;
    return { http: overHttp("Rabaed/rabaedV2.0", "token", fetcher), urls };
  };

  it("reads a user's permission on the repo from the collaborator permission endpoint", async () => {
    const { http, urls } = answering(200, { permission: "write", role_name: "maintain", user: { login: "mmhaleess90" } });
    expect(await http.permission("mmhaleess90")).toBe("write");
    expect(urls).toEqual(["https://api.github.com/repos/Rabaed/rabaedV2.0/collaborators/mmhaleess90/permission"]);
  });

  it("answers none for a login GitHub does not know", async () => {
    expect(await answering(404, undefined).http.permission("ghost")).toBe("none");
  });

  it("fails on any other error rather than guessing", async () => {
    await expect(answering(403, { message: "Resource not accessible by integration" }).http.permission("mmhaleess90")).rejects.toThrow(/403/);
  });
});

// RP-1148: the gate workflows move from pull_request to pull_request_target, whose runs the API files under that event.
// Both count, so the label's re-runs find the head's run before and after the workflow PR.
describe("overHttp's gate run lookups", () => {
  const byEvent = (answers: Record<string, { id: number; status: string; conclusion: string | null }[]>) => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      const event = new URL(url).searchParams.get("event") ?? "";
      return new Response(JSON.stringify({ workflow_runs: answers[event] ?? [] }), { status: 200 });
    }) as typeof fetch;
    return { http: overHttp("Rabaed/rabaedV2.0", "token", fetcher), urls };
  };

  it("finds the head's reviewed-required and verify-gate runs of either event, newest first", async () => {
    const { http, urls } = byEvent({
      pull_request: [{ id: 40, status: "completed", conclusion: "failure" }],
      pull_request_target: [{ id: 45, status: "completed", conclusion: "failure" }],
    });
    expect((await http.requiredRuns("abc")).map((run) => run.id)).toEqual([45, 40]);
    expect((await http.verifyRuns("abc")).map((run) => run.id)).toEqual([45, 40]);
    expect(urls).toContain("https://api.github.com/repos/Rabaed/rabaedV2.0/actions/workflows/reviewed-required.yml/runs?head_sha=abc&event=pull_request_target");
    expect(urls).toContain("https://api.github.com/repos/Rabaed/rabaedV2.0/actions/workflows/verify-gate.yml/runs?head_sha=abc&event=pull_request");
  });

  it("finds the reviewed-label runs of either event too: it moves with the gate workflows", async () => {
    const { http, urls } = byEvent({ pull_request: [{ id: 30, status: "completed", conclusion: "success" }], pull_request_target: [{ id: 31, status: "queued", conclusion: null }] });
    expect(await http.labelRuns("abc")).toEqual([{ status: "queued" }, { status: "completed" }]);
    expect(urls).toEqual([
      "https://api.github.com/repos/Rabaed/rabaedV2.0/actions/workflows/reviewed-label.yml/runs?head_sha=abc&event=pull_request_target",
      "https://api.github.com/repos/Rabaed/rabaedV2.0/actions/workflows/reviewed-label.yml/runs?head_sha=abc&event=pull_request",
    ]);
  });
});
