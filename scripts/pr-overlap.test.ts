import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stampLine } from "./verify-gate.ts";
import { branchFiles, findOverlaps, ghSeam, gitConflicts, overlapMessage, overlapWarning, parseMergeTree, type Exec, type OpenPr, type OverlapSeam } from "./pr-overlap.ts";

// GitHub and git sit behind OverlapSeam, so these tests read no network: the open PRs and the conflicts are given.
const openPr = (number: number, files: string[], overrides: Partial<OpenPr> = {}): OpenPr => ({ number, ref: `RP-${number}-x`, head: `sha${number}`, files, stamped: false, ...overrides });

function fakeSeam(prs: OpenPr[], conflicts: Record<number, string[] | Error> = {}): OverlapSeam & { asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    openPrs: async () => prs,
    conflictsWith: async (pr) => {
      asked.push(pr.number);
      const found = conflicts[pr.number] ?? [];
      if (found instanceof Error) throw found;
      return found;
    },
  };
}

const branch = { branch: "RP-1172-shared-file-warning", files: ["scripts/a.ts", "scripts/b.ts"] };

describe("findOverlaps", () => {
  it("finds no overlap when no open PR changes one of the branch's files, and asks git nothing", async () => {
    const seam = fakeSeam([openPr(10, ["docs/x.md"]), openPr(11, ["scripts/c.ts"])]);
    const report = await findOverlaps(branch, seam);
    expect(report.overlaps).toEqual([]);
    expect(seam.asked).toEqual([]);
    expect(overlapMessage(report)).toBe("");
  });

  it("lists a shared file that merges cleanly and marks it clean, with no voided warning", async () => {
    const report = await findOverlaps(branch, fakeSeam([openPr(10, ["scripts/b.ts", "docs/x.md"])]));
    expect(report.overlaps).toEqual([{ number: 10, ref: "RP-10-x", shared: ["scripts/b.ts"], conflicts: [], stamped: false }]);
    const text = overlapMessage(report);
    expect(text).toContain("#10 (RP-10-x) shares scripts/b.ts: merges clean");
    expect(text).not.toContain("voided");
  });

  it("names every file git says would conflict, even one outside the shared list, and warns that this verify is voided if the PR merges first", async () => {
    const report = await findOverlaps(branch, fakeSeam([openPr(10, ["scripts/a.ts", "scripts/b.ts"])], { 10: ["scripts/a.ts", "scripts/old-name.ts"] }));
    expect(report.overlaps[0]).toMatchObject({ number: 10, shared: ["scripts/a.ts", "scripts/b.ts"], conflicts: ["scripts/a.ts", "scripts/old-name.ts"] });
    const text = overlapMessage(report);
    expect(text).toContain("#10 (RP-10-x) would conflict in: scripts/a.ts, scripts/old-name.ts");
    expect(text).toContain("this verify will be voided by #10 if #10 merges first");
    expect(text).toContain("Merge order: #10, then this branch.");
  });

  it("handles several PRs: clean, conflicting and unrelated, asking git only about the ones that share a file", async () => {
    const seam = fakeSeam([openPr(20, ["scripts/a.ts"]), openPr(21, ["scripts/zzz.ts"]), openPr(22, ["scripts/b.ts"]), openPr(23, ["scripts/a.ts"])], { 22: ["scripts/b.ts"], 23: ["scripts/a.ts"] });
    const report = await findOverlaps(branch, seam);
    expect(report.overlaps.map((o) => o.number)).toEqual([20, 22, 23]);
    expect(seam.asked).toEqual([20, 22, 23]);
    const text = overlapMessage(report);
    expect(text).toContain("voided by #22 if #22 merges first");
    expect(text).toContain("voided by #23 if #23 merges first");
    expect(text).not.toContain("voided by #20");
    expect(text).toContain("Merge order: #22, then #23, then this branch.");
  });

  it("orders a PR with a stamped verify line first, then the lower number, and places the branch's own PR by the same rule", async () => {
    const own = openPr(30, ["scripts/a.ts"], { ref: branch.branch });
    const seam = fakeSeam([own, openPr(10, ["scripts/a.ts"]), openPr(11, ["scripts/b.ts"], { stamped: true }), openPr(40, ["scripts/b.ts"])], { 10: ["scripts/a.ts"], 11: ["scripts/b.ts"], 40: ["scripts/b.ts"] });
    const report = await findOverlaps(branch, seam);
    expect(report.overlaps.map((o) => o.number)).toEqual([10, 11, 40]);
    expect(report.self).toEqual({ number: 30, stamped: false });
    expect(overlapMessage(report)).toContain("Merge order: #11, then #10, then #30 (this branch), then #40.");
  });

  it("keeps the other overlaps when git can't say for one PR, and lists that one as unknown, not clean", async () => {
    const seam = fakeSeam([openPr(10, ["scripts/a.ts"]), openPr(11, ["scripts/b.ts"])], { 10: new Error("git fetch origin pull/10/head failed (exit 128)"), 11: ["scripts/b.ts"] });
    const report = await findOverlaps(branch, seam);
    expect(report.overlaps.map((o) => [o.number, o.unknown])).toEqual([
      [10, "git fetch origin pull/10/head failed (exit 128)"],
      [11, undefined],
    ]);
    const text = overlapMessage(report);
    expect(text).toContain("#10 (RP-10-x) shares scripts/a.ts: could not tell whether it conflicts (git fetch origin pull/10/head failed (exit 128))");
    expect(text).toContain("voided by #11 if #11 merges first");
    expect(text).not.toContain("voided by #10");
    expect(text).not.toContain("#10 (RP-10-x) shares scripts/a.ts: merges clean");
  });

  it("puts the branch's own PR first when its body has the stamped line and the other PR's has none", async () => {
    const own = openPr(30, ["scripts/a.ts"], { ref: branch.branch, stamped: true });
    const report = await findOverlaps(branch, fakeSeam([own, openPr(10, ["scripts/a.ts"])], { 10: ["scripts/a.ts"] }));
    expect(overlapMessage(report)).toContain("Merge order: #30 (this branch), then #10.");
  });
});

describe("parseMergeTree", () => {
  it("reads the conflicted file names after the tree id, up to the blank line before the messages", () => {
    const out = "0123456789abcdef\nscripts/a.ts\nscripts/b.ts\n\nAuto-merging scripts/a.ts\nCONFLICT (content): Merge conflict in scripts/a.ts\n";
    expect(parseMergeTree(1, out)).toEqual(["scripts/a.ts", "scripts/b.ts"]);
  });

  it("reads a clean merge as no conflicts", () => {
    expect(parseMergeTree(0, "0123456789abcdef\n")).toEqual([]);
  });

  it("throws on any other exit status, and on a conflict that names no file, rather than call it clean", () => {
    expect(() => parseMergeTree(128, "")).toThrow(/merge-tree failed \(exit 128\)/);
    expect(() => parseMergeTree(1, "0123456789abcdef\n\nCONFLICT (distinct types)\n")).toThrow(/names no file/);
    expect(() => parseMergeTree(1, "")).toThrow(/names no file/);
  });
});

/** A scripted command runner: the first rule whose `match` is in "command args" answers; every call is recorded. */
function scripted(rules: { match: string; code?: number; stdout?: string; delayMs?: number }[]) {
  const calls: string[] = [];
  let running = 0;
  let peak = 0;
  const run: Exec = async (command, args) => {
    const line = [command, ...args].join(" ");
    calls.push(line);
    const rule = rules.find((r) => line.includes(r.match));
    if (!rule) throw new Error(`unscripted command: ${line}`);
    running += 1;
    peak = Math.max(peak, running);
    if (rule.delayMs) await new Promise((done) => setTimeout(done, rule.delayMs));
    running -= 1;
    return { code: rule.code ?? 0, stdout: rule.stdout ?? "" };
  };
  return { run, calls, peak: () => peak };
}

const HEAD_A = "a".repeat(40);
const pull = (number: number, body: string | null, head = `${number}`.repeat(40).slice(0, 40)) => JSON.stringify({ number, ref: `RP-${number}-x`, head, body });

describe("ghSeam", () => {
  it("lists the open PRs with their files, a rename's old path too, reading gh's CRLF output", async () => {
    const { run, calls } = scripted([
      { match: "pulls?state=open", stdout: `${pull(7, null)}\n${pull(8, "")}\n` },
      { match: "pulls/7/files", stdout: "scripts/a.ts\r\nold/path.ts\r\n" },
      { match: "pulls/8/files", stdout: "docs/x.md\n" },
    ]);
    const prs = await ghSeam("repo", run).openPrs();
    expect(prs.map((p) => [p.number, p.ref, p.files])).toEqual([
      [7, "RP-7-x", ["scripts/a.ts", "old/path.ts"]],
      [8, "RP-8-x", ["docs/x.md"]],
    ]);
    expect(calls[0]).toContain("gh api repos/{owner}/{repo}/pulls?state=open&per_page=100 --paginate --jq");
    expect(calls.some((c) => c.includes("pulls/7/files?per_page=100 --paginate --jq"))).toBe(true);
  });

  it("counts a PR as stamped only when a valid stamped verify line names its current head, not an older commit", async () => {
    const fresh = stampLine(`pnpm verify passed on ${HEAD_A.slice(0, 9)}: lint, unit.`);
    const stale = stampLine("pnpm verify passed on bbbbbbbbb: lint, unit.");
    const { run } = scripted([
      { match: "pulls?state=open", stdout: [pull(1, `done\n${fresh}`, HEAD_A), pull(2, `done\n${stale}`, HEAD_A), pull(3, "pnpm verify passed on aaaaaaaaa: lint, unit. Stamp 0000000000000000.", HEAD_A)].join("\n") },
      { match: "/files", stdout: "x.ts\n" },
    ]);
    expect((await ghSeam("repo", run).openPrs()).map((p) => [p.number, p.stamped])).toEqual([
      [1, true],
      [2, false],
      [3, false],
    ]);
  });

  it("asks gh for at most five PRs' files at once", async () => {
    const lines = Array.from({ length: 12 }, (_, i) => pull(i + 1, null)).join("\n");
    const script = scripted([
      { match: "pulls?state=open", stdout: lines },
      { match: "/files", stdout: "x.ts\n", delayMs: 5 },
    ]);
    expect(await ghSeam("repo", script.run).openPrs()).toHaveLength(12);
    expect(script.peak()).toBeLessThanOrEqual(5);
  });

  it("throws when gh fails, rather than report no open PRs", async () => {
    const { run } = scripted([{ match: "pulls?state=open", code: 1 }]);
    await expect(ghSeam("repo", run).openPrs()).rejects.toThrow(/gh api .*failed \(exit 1\)/);
  });

  const openOne: OpenPr = { number: 9, ref: "RP-9-x", head: HEAD_A, files: ["a.ts"], stamped: false };

  it("merges a head the clone already has without fetching it", async () => {
    const { run, calls } = scripted([
      { match: "cat-file", code: 0 },
      { match: "merge-tree", code: 1, stdout: "tree\na.ts\n\nCONFLICT\n" },
    ]);
    expect(await ghSeam("repo", run).conflictsWith(openOne)).toEqual(["a.ts"]);
    expect(calls.some((c) => c.includes("fetch"))).toBe(false);
    expect(calls.at(-1)).toContain(`merge-tree --write-tree --name-only HEAD ${HEAD_A}`);
  });

  it("fetches the PR's head first when the clone lacks it, and throws if the fetch fails", async () => {
    const fetched = scripted([
      { match: "cat-file", code: 128 },
      { match: "fetch", code: 0 },
      { match: "merge-tree", code: 0, stdout: "tree\n" },
    ]);
    expect(await ghSeam("repo", fetched.run).conflictsWith(openOne)).toEqual([]);
    expect(fetched.calls.map((c) => c.split(" ").find((word) => ["cat-file", "fetch", "merge-tree"].includes(word)))).toEqual(["cat-file", "fetch", "merge-tree"]);
    expect(fetched.calls[1]).toContain("fetch --quiet origin pull/9/head");
    const refused = scripted([
      { match: "cat-file", code: 128 },
      { match: "fetch", code: 128 },
    ]);
    await expect(ghSeam("repo", refused.run).conflictsWith(openOne)).rejects.toThrow(/git fetch origin pull\/9\/head failed \(exit 128\)/);
  });
});

describe("branchFiles", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();
  const commit = (path: string, text: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
    git("add", "-A");
    git("commit", "-q", "-m", "x");
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-branch-files-"));
    git("init", "-q", "-b", "main");
    commit("keep.txt", "one\n");
    commit("gone.txt", "two\n");
    commit("old/name.txt", "three three three three\n");
    git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
    git("checkout", "-q", "-b", "RP-1-x");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("lists what HEAD changed since origin/main: edits, deletions, and a rename's old and new paths", async () => {
    commit("keep.txt", "one more\n");
    git("rm", "-q", "gone.txt");
    git("mv", "old/name.txt", "old/renamed.txt");
    git("commit", "-q", "-m", "delete and rename");
    expect(await branchFiles(repo)).toEqual({ branch: "RP-1-x", files: ["gone.txt", "keep.txt", "old/name.txt", "old/renamed.txt"] });
  });

  it("leaves out uncommitted and untracked files, which git merge-tree would not see in HEAD", async () => {
    commit("keep.txt", "one more\n");
    writeFileSync(join(repo, "gone.txt"), "dirty\n");
    writeFileSync(join(repo, "untracked.txt"), "new\n");
    expect((await branchFiles(repo)).files).toEqual(["keep.txt"]);
  });

  it("overlapWarning prints the overlaps of the checked-out branch, and nothing when no open PR shares a file", async () => {
    commit("keep.txt", "one more\n");
    const shared = await overlapWarning(repo, fakeSeam([openPr(5, ["keep.txt"])], { 5: ["keep.txt"] }));
    expect(shared).toContain("#5 (RP-5-x) would conflict in: keep.txt");
    expect(shared).toContain("Merge order: #5, then this branch.");
    expect(await overlapWarning(repo, fakeSeam([openPr(5, ["other.txt"])]))).toBe("");
  });

  it("overlapWarning warns instead of throwing when GitHub or git can't answer", async () => {
    commit("keep.txt", "one more\n");
    const down: OverlapSeam = {
      openPrs: async () => {
        throw new Error("gh api failed (exit 4)");
      },
      conflictsWith: async () => [],
    };
    expect(await overlapWarning(repo, down)).toBe("Warning: check:claims could not look for open PRs that change the same files (gh api failed (exit 4)); it did not check for overlaps.");
    expect(await overlapWarning(join(repo, "no-such-folder"), fakeSeam([]))).toMatch(/^Warning: check:claims could not look for open PRs/);
  });
});

describe("gitConflicts", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();
  const edit = (path: string, text: string) => {
    writeFileSync(join(repo, path), text);
    git("add", "-A");
    git("commit", "-q", "-m", "x");
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-pr-overlap-"));
    git("init", "-q", "-b", "main");
    edit("a.txt", "one\ntwo\nthree\n");
    edit("b.txt", "one\ntwo\nthree\n");
    edit("c.txt", "one\n");
    git("checkout", "-q", "-b", "other");
    edit("a.txt", "one\nOTHER\nthree\n");
    edit("b.txt", "one\ntwo\nthree\nmore\n");
    edit("c.txt", "one\nother\n");
    git("checkout", "-q", "main");
    git("checkout", "-q", "-b", "mine");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("names the files that would conflict merging a commit into HEAD, and none for files that merge cleanly", async () => {
    edit("a.txt", "one\nMINE\nthree\n");
    edit("b.txt", "zero\none\ntwo\nthree\n");
    expect(await gitConflicts(repo, git("rev-parse", "other"))).toEqual(["a.txt"]);
  });

  it("names a file this branch deleted that the other PR edited", async () => {
    git("rm", "-q", "c.txt");
    git("commit", "-q", "-m", "delete c");
    expect(await gitConflicts(repo, git("rev-parse", "other"))).toEqual(["c.txt"]);
  });

  it("is clean when the two sides change different files", async () => {
    edit("d.txt", "mine\n");
    expect(await gitConflicts(repo, git("rev-parse", "other"))).toEqual([]);
  });

  it("throws, rather than say clean, for a commit git can't find", async () => {
    await expect(gitConflicts(repo, "0".repeat(40))).rejects.toThrow(/git merge-tree/);
  });
});
