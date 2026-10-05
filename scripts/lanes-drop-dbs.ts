// Drops the per-worktree databases (rabaed_<suffix> and rabaed_<suffix>_test, made by
// `pnpm lane:env <n> --db <suffix>`) that no existing worktree uses any more. It looks in
// the Postgres of every running rabaed-* compose project and keeps a database while some
// worktree (see `git worktree list`) names it in its .env. Never rabaed or rabaed_test.
//
//   pnpm lanes:drop-dbs [--yes]     --yes skips the confirmation
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { databaseOfUrl, dbContainers, listContainers, orphanDatabases, psql } from "./lanes.ts";

const args = process.argv.slice(2);
if (args.some((a) => a !== "--yes")) {
  console.error("Usage: pnpm lanes:drop-dbs [--yes]");
  process.exit(1);
}

const containers = listContainers();
if (!containers) {
  console.error("Docker is not running (or not installed); start it and re-run.");
  process.exit(1);
}

const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((l) => l.startsWith("worktree "))
  .map((l) => l.slice("worktree ".length))
  .filter((dir) => existsSync(dir));
const inUse = new Set<string>();
for (const dir of [...worktrees, process.cwd()]) {
  const file = join(dir, ".env");
  if (!existsSync(file)) continue;
  for (const [, url] of readFileSync(file, "utf8").matchAll(/^DATABASE_(?:MIGRATOR|APP|ADMIN)_URL=(.*)$/gm)) {
    const name = databaseOfUrl((url ?? "").trim().replace(/^(["'])(.*)\1$/, "$2"));
    if (name) inUse.add(name);
  }
}

const orphans = dbContainers(containers).map((c) => ({
  container: c.name,
  databases: orphanDatabases(psql(c.name, "select datname from pg_database where datname like 'rabaed\\_%'"), inUse),
}));
const found = orphans.filter((o) => o.databases.length > 0);

if (found.length === 0) {
  console.log("No databases to drop.");
  process.exit(0);
}
console.log("Databases of worktrees that no longer exist:");
for (const o of found) console.log(`  ${o.container}: ${o.databases.join(", ")}`);

if (!args.includes("--yes")) {
  if (!process.stdin.isTTY) {
    console.error("Not dropped: re-run with --yes to drop them without a prompt.");
    process.exit(1);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question("Drop them? Their data is lost. [y/N] ");
  prompt.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log("Nothing dropped.");
    process.exit(0);
  }
}

let failed = 0;
for (const o of found) {
  for (const name of o.databases) {
    try {
      psql(o.container, `drop database "${name}" with (force)`);
      console.log(`Dropped ${name} in ${o.container}.`);
    } catch (error) {
      failed++;
      console.error(`Could not drop ${name}: ${(error as { stderr?: string }).stderr?.trim() || String(error)}`);
    }
  }
}
if (failed > 0) process.exit(1);
