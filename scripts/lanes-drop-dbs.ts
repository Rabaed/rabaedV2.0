// Drops the per-worktree databases (rabaed_<suffix> and rabaed_<suffix>_test, made by
// `pnpm lane:env <n> --db <suffix>`) that no existing worktree uses any more. It looks in
// the Postgres of every running rabaed-* compose project and keeps a database while some
// worktree of this clone (see `git worktree list`) names it in its .env. Other clones
// share the lanes' Postgres but are not looked at, so it also keeps any database with an
// open connection, and drops without force: a connection that opens meanwhile makes the
// drop fail instead of being cut. Never rabaed or rabaed_test.
//
//   pnpm lanes:drop-dbs [--yes]     --yes skips the confirmation
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmOrExit } from "./confirm.ts";
import { databasesInUse, dbContainers, dropOrKeep, listContainers, orphanDatabases, parseConnections, psql } from "./lanes.ts";
import { listWorktrees } from "./worktrees.ts";

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

const worktrees = listWorktrees()
  .map((w) => w.path)
  .filter((dir) => existsSync(dir));
const readEnv = (dir: string) => {
  const file = join(dir, ".env");
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
};
const inUse = databasesInUse([...worktrees, process.cwd()], readEnv);

const found = dbContainers(containers)
  .map((c) => {
    const orphans = orphanDatabases(psql(c.name, "select datname from pg_database where datname like 'rabaed\\_%'"), inUse);
    const connections = parseConnections(psql(c.name, "select datname, count(*) from pg_stat_activity where datname like 'rabaed\\_%' group by datname"));
    return { container: c.name, ...dropOrKeep(orphans, connections) };
  })
  .filter((o) => o.drop.length > 0 || o.busy.length > 0);

console.log("Only this clone's worktrees are checked; a database with an open connection is kept.");
for (const o of found.filter((f) => f.busy.length > 0)) {
  console.log(`Kept, in use right now: ${o.container}: ${o.busy.map((b) => `${b.name} (${b.connections} connection${b.connections === 1 ? "" : "s"})`).join(", ")}`);
}
const toDrop = found.filter((o) => o.drop.length > 0);
if (toDrop.length === 0) {
  console.log("No databases to drop.");
  process.exit(0);
}
console.log("Databases of worktrees that no longer exist:");
for (const o of toDrop) console.log(`  ${o.container}: ${o.drop.join(", ")}`);

await confirmOrExit("Drop them? Their data is lost.", { yes: args.includes("--yes"), verb: "drop", done: "dropped" });

let failed = 0;
for (const o of toDrop) {
  for (const name of o.drop) {
    try {
      psql(o.container, `drop database "${name}"`);
      console.log(`Dropped ${name} in ${o.container}.`);
    } catch (error) {
      failed++;
      console.error(`Could not drop ${name}: ${(error as { stderr?: string }).stderr?.trim() || String(error)}`);
    }
  }
}
if (failed > 0) process.exit(1);
