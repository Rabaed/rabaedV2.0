import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every slash command the agent docs name (`/plugin:skill` or `/skill`) must be
// a skill the session can run: a project skill under `.claude/skills/`, or a
// plugin skill on the allowlist in `doc-skills.json` (RP-609). The plugin cache
// lives outside the repo and is not on CI, so the allowlist stands in for it;
// refresh it from the installed plugin's `skills/` folder when the plugin is
// upgraded. `notSkills` lists slash words that are not skills: built-in CLI
// commands and app routes.
//
// Checked by `scripts/check-doc-skills.test.ts` in `pnpm test:unit`.

export type SkillReference = { plugin: string | undefined; name: string; line: number };
export type SkillAllowlist = { plugins: Record<string, string[]>; notSkills: string[] };

/** The docs whose slash commands are checked, relative to the repo root. */
export function agentDocs(repo: string): string[] {
  const inFolder = (folder: string) =>
    existsSync(join(repo, folder))
      ? readdirSync(join(repo, folder))
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((f) => `${folder}/${f}`)
      : [];
  return ["CLAUDE.md", "README.md", ...inFolder("planning"), ...inFolder("docs/agents")].filter((f) => existsSync(join(repo, f)));
}

// A slash command starts a word (not inside a path, URL or `<port>/x`) and
// ends the word: a route or path such as `/en/health` goes on with another `/`.
const command = /(?<![\w.:/<>*-])\/([a-z][a-z0-9-]*)(?::([a-z][a-z0-9-]*))?(?![\w/.*:-])/g;

/** Each slash command in the text, with its 1-based line. */
export function skillReferences(text: string): SkillReference[] {
  return text.split("\n").flatMap((lineText, i) =>
    [...lineText.matchAll(command)].map((m) =>
      m[2] === undefined ? { plugin: undefined, name: m[1]!, line: i + 1 } : { plugin: m[1], name: m[2], line: i + 1 },
    ),
  );
}

function repoSkills(repo: string): Set<string> {
  const dir = join(repo, ".claude", "skills");
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((name) => existsSync(join(dir, name, "SKILL.md"))));
}

/** One message per slash command, in the given docs, that names no known skill. */
export function docSkillProblems(repo: string, docs: string[], allow: SkillAllowlist): string[] {
  const local = repoSkills(repo);
  const pluginSkills = new Set(Object.values(allow.plugins).flat());
  const notSkills = new Set(allow.notSkills);
  return docs.flatMap((doc) =>
    skillReferences(readFileSync(join(repo, doc), "utf8")).flatMap(({ plugin, name, line }) => {
      const where = `${doc}:${line} names /${plugin === undefined ? "" : `${plugin}:`}${name}`;
      if (plugin === undefined) {
        if (local.has(name) || pluginSkills.has(name) || notSkills.has(name)) return [];
        return [`${where}, which is not in .claude/skills/ or a plugin on the allowlist`];
      }
      const skills = allow.plugins[plugin];
      if (skills === undefined) return [`${where}, but the plugin ${plugin} is not on the allowlist`];
      return skills.includes(name) ? [] : [`${where}, which the plugin ${plugin} does not have`];
    }),
  );
}
