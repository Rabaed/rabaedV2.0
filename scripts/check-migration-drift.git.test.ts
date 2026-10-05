import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrationProblems } from "./check-migration-drift.ts";

// A throwaway repository replaying the RP-311 history: a branch redefines
// app.take_transition, main redefines it later, the branch merges main.
let repo: string;
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();
const dir = "packages/db/migrations";
const takeTransition = (comment: string) => `-- ${comment}\ncreate or replace function app.take_transition() returns void as $$ $$;\n`;

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
  commit({ [`${dir}/20261104000000_function_grants.sql`]: "grant execute on function app.take_transition() to rabaed_app;\n" }, "RP-317");
  git("switch", "-q", "branch");
  git("merge", "-q", "--no-edit", "main");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("migrationProblems", () => {
  it("reports the drift main's merge caused, from the head and base commits", () => {
    expect(migrationProblems(repo, "main", "branch")).toEqual({
      drift: [{ object: "function app.take_transition", branch: ["20261026100000_numbering_pattern.sql"], main: ["20261030000100_take_transition_sections.sql"] }],
      duplicates: [],
    });
  });

  it("passes once the branch adds a later redefinition after the merge, and flags its reused timestamp", () => {
    commit({ [`${dir}/20261104000000_numbering_after_sections.sql`]: takeTransition("fix-up") });
    expect(migrationProblems(repo, "main", "branch")).toEqual({
      drift: [],
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
});
