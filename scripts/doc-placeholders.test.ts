import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PlaceholderBaseline, placeholderDocs, placeholderHits, placeholderProblems } from "./doc-placeholders.ts";

const fence = (info: string, ...lines: string[]) => ["```" + info, ...lines, "```"].join("\n");

describe("placeholderHits in fenced code blocks", () => {
  it("flags `pnpm lane:done <pr> --yes` in a bash fence, with its line", () => {
    const text = ["Intro", "", fence("bash", "pnpm lane:done <pr> --yes")].join("\n");
    expect(placeholderHits(text)).toEqual([{ kind: "fence", code: "pnpm lane:done <pr> --yes", line: 4 }]);
  });

  it("flags the same line in an untagged fence", () => {
    expect(placeholderHits(fence("", "pnpm lane:done <pr> --yes"))).toEqual([{ kind: "fence", code: "pnpm lane:done <pr> --yes", line: 2 }]);
  });

  it("flags every shell-like tag, in any case, and an indented fence", () => {
    for (const tag of ["bash", "sh", "shell", "zsh", "console", "powershell", "pwsh", "ps1", "ps", "PowerShell"]) {
      expect(placeholderHits(fence(tag, "pnpm queue <n>")), tag).toHaveLength(1);
    }
    expect(placeholderHits(["1. Step", "   ```bash", "   pnpm queue <n>", "   ```"].join("\n"))).toEqual([{ kind: "fence", code: "pnpm queue <n>", line: 3 }]);
  });

  it("does not flag fences with another tag, such as mermaid, json or ts", () => {
    for (const tag of ["mermaid", "json", "ts", "typescript", "yaml", "sql", "html"]) {
      expect(placeholderHits(fence(tag, "A[x<br/>y] --> B", "pnpm queue <n>")), tag).toEqual([]);
    }
  });

  it("flags placeholders that are one word, several words or hyphenated, and one hit per line", () => {
    const text = fence("", "a <n>", "b <two words>", "c <spec-name>", "d RP-nnn-<spec-name> <n>", "e <RP-nnn>", "f --x=<path>");
    expect(placeholderHits(text).map((h) => h.code)).toEqual(["a <n>", "b <two words>", "c <spec-name>", "d RP-nnn-<spec-name> <n>", "e <RP-nnn>", "f --x=<path>"]);
  });

  it("leaves out comparisons, arrows, heredocs, redirects and HTML", () => {
    const text = fence("", "if (a <= b) {}", "x -> y", "cat <<EOF", "cmd < in.txt > out.txt", "line<br/>break", "a<br>b", "<details>");
    expect(placeholderHits(text)).toEqual([]);
  });

  it("flags a placeholder that follows a word, as in `--db rp<n>`", () => {
    expect(placeholderHits(fence("", "pnpm lane:env 1 --db rp<n>"))).toHaveLength(1);
  });

  it("does not flag a placeholder inside a double- or single-quoted string", () => {
    const text = fence("bash", 'gh pr view "<pr number>"', "git commit -m '<message>'", 'echo "a" <n>');
    expect(placeholderHits(text).map((h) => h.code)).toEqual(['echo "a" <n>']);
  });

  it("flags a slash-command fence like any untagged fence", () => {
    expect(placeholderHits(fence("", "/mattpocock-skills:implement-spec RP-nnn <spec-name>"))).toHaveLength(1);
  });

  it("closes a fence only with a matching fence, so text after it is prose", () => {
    const text = ["````bash", "```", "pnpm queue <n>", "```", "````", "<n> in prose"].join("\n");
    expect(placeholderHits(text)).toEqual([{ kind: "fence", code: "pnpm queue <n>", line: 3 }]);
  });
});

describe("placeholderHits in inline code", () => {
  it("flags a span that starts with pnpm, node, git, gh or docker", () => {
    const text = "Run `pnpm lane:done <pr>`, `node scripts/x.ts <file>`, `git switch <branch>`, `gh pr view <n>` or `docker rm <name>`.";
    expect(placeholderHits(text).map((h) => h.code)).toEqual([
      "pnpm lane:done <pr>",
      "node scripts/x.ts <file>",
      "git switch <branch>",
      "gh pr view <n>",
      "docker rm <name>",
    ]);
    expect(placeholderHits("Run `pnpm lane:done <pr> --yes`.")).toEqual([{ kind: "inline", code: "pnpm lane:done <pr> --yes", line: 1 }]);
  });

  it("allows a leading `$ ` and a double-backtick span", () => {
    expect(placeholderHits("`$ pnpm queue <n>` and ``pnpm queue <n>``")).toHaveLength(2);
  });

  it("ignores spans that start with anything else, and prose", () => {
    const text = "See `RP-nnn-<spec-name>`, `docs/<file>.md`, `/job/<id>`, `pnpmx <n>`, `git-lfs <n>`, and pnpm queue <n> in prose.";
    expect(placeholderHits(text)).toEqual([]);
  });

  it("ignores a quoted placeholder, a comparison and an arrow in a span", () => {
    const text = "`pnpm x \"<a b>\"`, `git log --format='<fmt>'`, `node a.ts <= 3`, `git a -> b`.";
    expect(placeholderHits(text)).toEqual([]);
  });

  it("does not look for spans inside a fence", () => {
    expect(placeholderHits(fence("mermaid", "A[`pnpm queue <n>`]"))).toEqual([]);
  });
});

describe("placeholderDocs and placeholderProblems", () => {
  let repo: string;
  const write = (path: string, content: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  const bad = "Run `pnpm lane:done <pr> --yes`.\n";

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rabaed-doc-placeholders-"));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("checks CLAUDE.md and every .md under planning/ and docs/, however deep", () => {
    for (const f of ["CLAUDE.md", "README.md", "planning/p.md", "planning/uat/u.md", "docs/d.md", "docs/adr/0001.md", "docs/visibility/scenarios/RP-1.md", "docs/x.txt", "other/o.md"]) {
      write(f, "\n");
    }
    expect(placeholderDocs(repo)).toEqual(["CLAUDE.md", "docs/adr/0001.md", "docs/d.md", "docs/visibility/scenarios/RP-1.md", "planning/p.md", "planning/uat/u.md"]);
  });

  it("fails on a `pnpm lane:done <pr>` fixture, naming the doc, line and code", () => {
    write("planning/a.md", `ok\n${bad}`);
    expect(placeholderProblems(repo, ["planning/a.md"], {})).toEqual([
      "planning/a.md:2 has a <placeholder> in inline code: pnpm lane:done <pr> --yes (PowerShell reads < as a redirect: write a real value, or say it in prose)",
    ]);
  });

  it("passes a hit the baseline lists, and lists a repeat as often as it occurs", () => {
    write("planning/a.md", bad + bad);
    const code = "pnpm lane:done <pr> --yes";
    expect(placeholderProblems(repo, ["planning/a.md"], { "planning/a.md": [code, code] })).toEqual([]);
    expect(placeholderProblems(repo, ["planning/a.md"], { "planning/a.md": [code] })).toEqual([
      "planning/a.md:2 has a <placeholder> in inline code: pnpm lane:done <pr> --yes (PowerShell reads < as a redirect: write a real value, or say it in prose)",
    ]);
  });

  it("keys the baseline by the code text, not the line, so an edit elsewhere does not break it", () => {
    write("planning/a.md", `new first line\n\n${bad}`);
    expect(placeholderProblems(repo, ["planning/a.md"], { "planning/a.md": ["pnpm lane:done <pr> --yes"] })).toEqual([]);
  });

  it("names a baseline entry the doc no longer has, so the list only shrinks", () => {
    write("planning/a.md", "Run `pnpm lane:done 580 --yes`.\n");
    const baseline: PlaceholderBaseline = { "planning/a.md": ["pnpm lane:done <pr> --yes"], "planning/gone.md": ["pnpm queue <n>"] };
    expect(placeholderProblems(repo, ["planning/a.md"], baseline)).toEqual([
      "planning/a.md: scripts/doc-placeholders-baseline.json lists pnpm lane:done <pr> --yes, which the doc no longer has: delete that entry",
      "planning/gone.md: scripts/doc-placeholders-baseline.json lists pnpm queue <n>, which the doc no longer has: delete that entry",
    ]);
  });
});

describe("the repository", () => {
  it("has no <placeholder> in a shell command except the ones the baseline lists", () => {
    const baseline = JSON.parse(readFileSync("scripts/doc-placeholders-baseline.json", "utf8")) as PlaceholderBaseline;
    expect(placeholderProblems(".", placeholderDocs("."), baseline)).toEqual([]);
  });
});
