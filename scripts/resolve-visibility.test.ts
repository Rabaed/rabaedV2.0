import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeVisibility } from "./resolve-visibility.ts";

// docs/visibility.md conflicted in five of the last 40 merges (RP-562): two branches each added a
// row at the end of a table, or each added a sentence to the same long row. The helper merges
// what git cannot, and stops on anything it cannot be sure of.

const doc = (channels: string[], scenarios: string[], rules: string[] = ["- **V1.** Drafts stay inside."]) =>
  [
    "# Visibility specification",
    "",
    "## Rules",
    "",
    ...rules,
    "",
    "## Leak channels",
    "",
    "| Channel | Rule |",
    "|---|---|",
    ...channels,
    "",
    "## Scenario matrix",
    "",
    "| # | Scenario | Who | Expected |",
    "|---|---|---|---|",
    ...scenarios,
    "",
    "Every change must add rows.",
    "",
  ].join("\n");

const baseChannels = ["| Lists | Show only visible items. |", "| Search | Filtered by RLS. |"];
const baseScenarios = ["| 1 | C1 saves a Draft | C2 | Hidden |"];

describe("mergeVisibility", () => {
  it("keeps both sides' rows when each appends a different row to the same table", () => {
    const base = doc(baseChannels, baseScenarios);
    const ours = doc(baseChannels, [...baseScenarios, "| RP-407-1 | C2 opens Home | C2 | Sees nothing of C1 |"]);
    const theirs = doc(baseChannels, [...baseScenarios, "| RP-439-1 | Builder opened | K1 | 404 |"]);
    const { text, stuck } = mergeVisibility(base, ours, theirs);
    expect(stuck).toEqual([]);
    expect(text).toBe(doc(baseChannels, [...baseScenarios, "| RP-407-1 | C2 opens Home | C2 | Sees nothing of C1 |", "| RP-439-1 | Builder opened | K1 | 404 |"]));
  });

  it("merges two sentences added to different places of the same long row", () => {
    const base = doc(["| Search | Filtered by RLS. Covers Subject only. |"], baseScenarios);
    const ours = doc(["| Search | Filtered by RLS. Never answers. Covers Subject only. |"], baseScenarios);
    const theirs = doc(["| Search | Filtered by RLS. Covers Subject only. As built (RP-410): finds the owner. |"], baseScenarios);
    const { text, stuck } = mergeVisibility(base, ours, theirs);
    expect(stuck).toEqual([]);
    expect(text).toBe(doc(["| Search | Filtered by RLS. Never answers. Covers Subject only. As built (RP-410): finds the owner. |"], baseScenarios));
  });

  it("takes a row one side changed and the other left alone, next to a row the other side added", () => {
    const base = doc(baseChannels, baseScenarios);
    const ours = doc(["| Lists | Show only visible items, counts too. |", baseChannels[1]!], baseScenarios);
    const theirs = doc([...baseChannels, "| Watch | Only items the watcher sees. |"], baseScenarios);
    const { text, stuck } = mergeVisibility(base, ours, theirs);
    expect(stuck).toEqual([]);
    expect(text).toBe(doc(["| Lists | Show only visible items, counts too. |", baseChannels[1]!, "| Watch | Only items the watcher sees. |"], baseScenarios));
  });

  it("stops on the same word of the same row changed two ways, and names the row", () => {
    const base = doc(baseChannels, baseScenarios);
    const ours = doc(["| Lists | Show only visible items. |", "| Search | Filtered by RLS, always. |"], baseScenarios);
    const theirs = doc(["| Lists | Show only visible items. |", "| Search | Filtered by RLS, never twice. |"], baseScenarios);
    const { text, stuck } = mergeVisibility(base, ours, theirs);
    expect(stuck).toEqual(["Search"]);
    expect(text).toContain("<<<<<<<");
  });

  it("stops when both sides add a row with the same first cell", () => {
    const base = doc(baseChannels, baseScenarios);
    const ours = doc(baseChannels, [...baseScenarios, "| 2 | A | B | one |"]);
    const theirs = doc(baseChannels, [...baseScenarios, "| 2 | A | B | two |"]);
    expect(mergeVisibility(base, ours, theirs).stuck).toEqual(["2"]);
  });

  it("stops when one side deletes a row the other changed", () => {
    const base = doc(baseChannels, baseScenarios);
    const ours = doc([baseChannels[0]!], baseScenarios);
    const theirs = doc(["| Lists | Show only visible items. |", "| Search | Filtered by RLS, always. |"], baseScenarios);
    expect(mergeVisibility(base, ours, theirs).stuck).toEqual(["Search"]);
  });

  it("merges V-bullets the same way, by their V number", () => {
    const base = doc(baseChannels, baseScenarios, ["- **V1.** Drafts stay inside."]);
    const ours = doc(baseChannels, baseScenarios, ["- **V1.** Drafts stay inside.", "- **V2.** Ours."]);
    const theirs = doc(baseChannels, baseScenarios, ["- **V1.** Drafts stay inside.", "- **V3.** Theirs."]);
    const { text, stuck } = mergeVisibility(base, ours, theirs);
    expect(stuck).toEqual([]);
    expect(text).toBe(doc(baseChannels, baseScenarios, ["- **V1.** Drafts stay inside.", "- **V2.** Ours.", "- **V3.** Theirs."]));
  });
});

// The acceptance test: a real merge. Git alone conflicts; the helper resolves it.
describe("resolve-visibility on a real merge", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();
  const write = (text: string) => {
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeFileSync(join(repo, "docs", "visibility.md"), text);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-visibility-repo-"));
    git("init", "-q", "-b", "main");
    write(doc(baseChannels, baseScenarios));
    git("add", "-A");
    git("commit", "-q", "-m", "start");
    git("switch", "-q", "-c", "RP-a");
    write(doc(baseChannels, [...baseScenarios, "| RP-a-1 | A | B | one |"]));
    git("commit", "-q", "-am", "RP-a");
    git("switch", "-q", "main");
    write(doc(baseChannels, [...baseScenarios, "| RP-b-1 | A | B | two |"]));
    git("commit", "-q", "-am", "RP-b");
    git("switch", "-q", "RP-a");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("git conflicts on two branches adding different rows; the helper merges both without a conflict", () => {
    expect(() => git("merge", "--no-commit", "main")).toThrow();
    const script = join(process.cwd(), "scripts", "resolve-visibility.ts");
    const out = execFileSync(process.execPath, [script], { cwd: repo, encoding: "utf8" });
    expect(out).toContain("merged");
    const merged = readFileSync(join(repo, "docs", "visibility.md"), "utf8");
    expect(merged).toBe(doc(baseChannels, [...baseScenarios, "| RP-a-1 | A | B | one |", "| RP-b-1 | A | B | two |"]));
    expect(merged).not.toContain("<<<<<<<");
  });
});
