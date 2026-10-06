import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeTransition } from "./check-migration-drift.fixtures.ts";
import { mergeGroupSides, migrationProblems } from "./check-migration-drift.ts";
import { migrationsDir as dir } from "./migrations.ts";

// A throwaway repository replaying the RP-311 history: a branch redefines
// app.take_transition, main redefines it later, the branch merges main.
let repo: string;
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();

function commit(files: Record<string, string>, message = "change") {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rabaed-drift-repo-"));
  git("init", "-q", "-b", "main");
  commit({ [`${dir}/20261020000000_start.sql`]: takeTransition("start") }, "start");
  git("switch", "-q", "-c", "branch");
  commit({ [`${dir}/20261026100000_numbering_pattern.sql`]: takeTransition("RP-312") });
  git("switch", "-q", "main");
  commit({ [`${dir}/20261030000100_take_transition_sections.sql`]: takeTransition("RP-299") }, "RP-299");
  commit({ [`${dir}/20261104000000_function_grants.sql`]: "grant execute on function app.take_transition(uuid, text) to rabaed_app;\n" }, "RP-317");
  git("switch", "-q", "branch");
  git("merge", "-q", "--no-edit", "main");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("migrationProblems", () => {
  it("reports the drift main's merge caused, from the head and base commits", () => {
    expect(migrationProblems(repo, "main", "branch")).toEqual({
      drift: [{ object: "function app.take_transition", branch: ["20261026100000_numbering_pattern.sql"], main: ["20261030000100_take_transition_sections.sql"] }],
      overloads: [],
      duplicates: [],
    });
  });

  it("passes once the branch adds a later redefinition after the merge, and flags its reused timestamp", () => {
    commit({ [`${dir}/20261104000000_numbering_after_sections.sql`]: takeTransition("fix-up") });
    expect(migrationProblems(repo, "main", "branch")).toEqual({
      drift: [],
      overloads: [],
      duplicates: [["20261104000000_function_grants.sql", "20261104000000_numbering_after_sections.sql"]],
    });
  });

  it("fails a later redefinition written before the merge", () => {
    git("reset", "-q", "--hard", "HEAD~1");
    commit({ [`${dir}/20261105000000_numbering_again.sql`]: takeTransition("before merging") });
    git("merge", "-q", "--no-edit", "main");
    expect(migrationProblems(repo, "main", "branch").drift).toEqual([
      {
        object: "function app.take_transition",
        branch: ["20261026100000_numbering_pattern.sql", "20261105000000_numbering_again.sql"],
        main: ["20261030000100_take_transition_sections.sql"],
      },
    ]);
  });

  it("fails the RP-312 overload: the branch re-creates the signature main replaced, even after a proper fix-up of main's", () => {
    // Instead of RP-299, main replaces `p_transition text` with `p_answers jsonb` (RP-300) in a
    // migration that sorts before the branch's, whose copy predates it.
    git("reset", "-q", "--hard", "HEAD~1");
    git("switch", "-q", "main");
    git("reset", "-q", "--hard", "HEAD~2");
    commit({
      [`${dir}/20261026000000_action_forms.sql`]: `drop function app.take_transition(uuid, text);\n${takeTransition("RP-300", "p_work_item uuid, p_answers jsonb")}`,
    });
    git("switch", "-q", "branch");
    git("merge", "-q", "--no-edit", "main");
    commit({ [`${dir}/20261106000000_numbering_after_action_forms.sql`]: takeTransition("fix-up of main's", "p_work_item uuid, p_answers jsonb") });
    expect(migrationProblems(repo, "main", "branch")).toEqual({
      drift: [],
      overloads: [{ signature: "app.take_transition(uuid, text)", branch: ["20261026100000_numbering_pattern.sql"], main: ["20261026000000_action_forms.sql"] }],
      duplicates: [],
    });
  });
});

// The merge queue (RP-398) tests a commit that merges the PR's head into the
// queue's base: main plus the entries ahead of it.
describe("mergeGroupSides", () => {
  const sha = (ref: string) => git("rev-parse", ref);
  const groupHead = () => {
    git("switch", "-q", "-c", "queue", "main");
    git("merge", "-q", "--no-ff", "--no-edit", "branch");
    return sha("queue");
  };

  it("takes the PR's head from the queue commit's second parent", () => {
    const head = groupHead();
    expect(mergeGroupSides(repo, sha("main"), head)).toEqual({ base: sha("main"), head: sha("branch") });
  });

  it("checks the PR's head against the queue's base, as on its pull request", () => {
    const { base, head } = mergeGroupSides(repo, sha("main"), groupHead());
    expect(migrationProblems(repo, base, head)).toEqual(migrationProblems(repo, "main", "branch"));
  });

  it("refuses a queue commit that is not a merge", () => {
    expect(() => mergeGroupSides(repo, sha("main~1"), sha("main"))).toThrow(/not a merge/);
  });

  it("refuses a queue commit whose first parent is not the queue's base", () => {
    const head = groupHead();
    expect(() => mergeGroupSides(repo, sha("main~1"), head)).toThrow(/first parent/);
  });
});
