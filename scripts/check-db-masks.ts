import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { allDefinitions, currentDefinitions } from "./db-fn.ts";
import { type Migration, workingTreeMigrations } from "./migrations.ts";

// `node scripts/check-db-masks.ts` (RP-1166): an api read that masks what the database hands it names
// the db function that masks the same thing. RP-1138's leak was a holder the api replaced with "Owner
// review" while the database still gave it out (through GET /v1/work-items/:id/form-choices, a read the
// mask was not on). So every mask carries a comment `db-mask: app.<function>`, on its line or up to
// three lines above, and that function's newest body must do the masking too. Changing either one then
// shows the other. Run in `pnpm test:unit` by check-db-masks.test.ts.

/** A file of the api, its path relative to the repo. */
export type SourceFile = { path: string; text: string };

/** One kind of mask: the code that masks, and what the named db function's body must call to mask the same. */
type MaskRule = { what: string; mask: RegExp; db: RegExp; dbNames: string };

const MASK_RULES: readonly MaskRule[] = [
  {
    what: "the holder with the Owner's review label",
    // The label read in place of the holder, a holder kept only when there is no label, or a lane chosen by it.
    mask: /with_owner_review\(|\bowner_review(?:_name)?\s+is\s+(?:not\s+)?null\b|\.owner_review_name\s*\?/,
    db: /\bapp\.with_owner_review(?:_unchecked)?\s*\(/,
    dbNames: "`app.with_owner_review` or `app.with_owner_review_unchecked`",
  },
];

const DB_MASK = /db-mask:\s*app\.(\w+)/g;
const LOOK_BACK = 3;

/** The line without its comment: a `//` or SQL `--` comment to the end, or a line inside a block comment. */
function codeOf(line: string): string {
  if (/^\s*(?:\/\*|\*)/.test(line)) return "";
  return line.replace(/\/\/.*$/, "").replace(/--.*$/, "");
}

const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/** One line per mask with no `db-mask` comment, or whose comment points at a function that is gone or does not mask the same thing. */
export function maskProblems(files: readonly SourceFile[], migrations: readonly Migration[]): string[] {
  const definitions = allDefinitions([...migrations]);
  const newestBody = (name: string): string | undefined => {
    const live = currentDefinitions(definitions.get(name.toLowerCase()) ?? []);
    return live.length === 0 ? undefined : live.map((d) => stripSqlComments(d.text)).join("\n");
  };
  const problems: string[] = [];
  for (const { path, text } of files) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const rule of MASK_RULES) {
        const found = rule.mask.exec(codeOf(line));
        if (!found) continue;
        const near = lines.slice(Math.max(0, i - LOOK_BACK), i + 1).join("\n");
        const pointedAt = [...near.matchAll(DB_MASK)].map((m) => m[1]!);
        const at = `${path}:${i + 1}`;
        if (pointedAt.length === 0) {
          problems.push(
            `${at}: masks ${rule.what} (\`${found[0]}\`) with no db function beside it: add a comment \`db-mask: app.<function>\` for the db function that masks the same thing`,
          );
          continue;
        }
        for (const fn of pointedAt) {
          const body = newestBody(fn);
          const qualified = `app.${fn}`;
          if (body === undefined) problems.push(`${at}: db-mask points at \`${qualified}\`, which nothing in \`packages/db/migrations\` defines`);
          else if (!rule.db.test(body)) {
            problems.push(`${at}: db-mask points at \`${qualified}\`, whose newest body never calls ${rule.dbNames}, so it does not mask ${rule.what}`);
          }
        }
      }
    });
  }
  return problems;
}

/** The api's source files: every `.ts` under apps/api/src but its tests. */
export function apiSourceFiles(repo: string): SourceFile[] {
  const root = join(repo, "apps", "api", "src");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => {
      const full = join(root, name);
      return { path: relative(repo, full).replaceAll("\\", "/"), text: readFileSync(full, "utf8") };
    });
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const repo = resolve(import.meta.dirname, "..");
  const problems = maskProblems(apiSourceFiles(repo), workingTreeMigrations(repo));
  for (const p of problems) console.error(p);
  if (problems.length > 0) process.exit(1);
  console.log("check-db-masks: every api mask names the db function that masks the same thing.");
}
