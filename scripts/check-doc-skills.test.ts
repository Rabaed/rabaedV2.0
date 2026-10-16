import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentDocs, docSkillProblems, type SkillAllowlist, skillReferences } from "./check-doc-skills.ts";

describe("skillReferences", () => {
  it("reads plugin and bare slash commands with their line numbers", () => {
    const text = ["Run `/mattpocock-skills:implement RP-1` first.", "", "Then `/code-review`, and (/retro)."].join("\n");
    expect(skillReferences(text)).toEqual([
      { plugin: "mattpocock-skills", name: "implement", line: 1 },
      { plugin: undefined, name: "code-review", line: 3 },
      { plugin: undefined, name: "retro", line: 3 },
    ]);
  });

  it("ignores paths, URLs and routes that go on past the first segment", () => {
    const text = "See `/en/health`, http://localhost:3000/en, `apps/api/src`, `/api/v1/*`, `<port>/en`, `/job/<id>` and `/rabaed/dev/x`.";
    expect(skillReferences(text)).toEqual([]);
  });
});

describe("docSkillProblems", () => {
  let repo: string;
  const write = (path: string, content: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  const allow = { plugins: { "mattpocock-skills": ["implement", "retro"] }, notSkills: ["clear", "en"] };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-doc-skills-"));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("accepts plugin skills on the allowlist, repo skills, and names that are not skills", () => {
    write(".claude/skills/lane-check/SKILL.md", "---\nname: lane-check\n---\n");
    write("planning/a.md", "`/mattpocock-skills:implement`, `/retro`, `/lane-check`, `/clear`, `/en`\n");
    expect(docSkillProblems(repo, ["planning/a.md"], allow)).toEqual([]);
  });

  it("names the doc and line of a skill in neither place", () => {
    write("planning/a.md", "ok\n`/mattpocock-skills:implement-ticket`\n");
    write("docs/agents/b.md", "Run `/wayfinder`.\n");
    write("README.md", "`/lane-check`\n");
    expect(docSkillProblems(repo, ["planning/a.md", "docs/agents/b.md", "README.md"], allow)).toEqual([
      "planning/a.md:2 names /mattpocock-skills:implement-ticket, which the plugin mattpocock-skills does not have",
      "docs/agents/b.md:1 names /wayfinder, which is not in .claude/skills/ or a plugin on the allowlist",
      "README.md:1 names /lane-check, which is not in .claude/skills/ or a plugin on the allowlist",
    ]);
  });

  it("checks CLAUDE.md, README.md, planning/*.md and docs/agents/*.md", () => {
    for (const f of ["CLAUDE.md", "README.md", "planning/p.md", "docs/agents/d.md", "docs/other.md", "planning/x.txt"]) write(f, "\n");
    expect(agentDocs(repo)).toEqual(["CLAUDE.md", "README.md", "planning/p.md", "docs/agents/d.md"]);
  });

  it("names a plugin that is not on the allowlist", () => {
    write("CLAUDE.md", "`/other-plugin:retro`\n");
    expect(docSkillProblems(repo, ["CLAUDE.md"], allow)).toEqual(["CLAUDE.md:1 names /other-plugin:retro, but the plugin other-plugin is not on the allowlist"]);
  });
});

describe("the repository", () => {
  it("names only skills that exist in .claude/skills/ or on the plugin allowlist", () => {
    const allowlist = JSON.parse(readFileSync("scripts/doc-skills.json", "utf8")) as SkillAllowlist;
    expect(docSkillProblems(".", agentDocs("."), allowlist)).toEqual([]);
  });
});
