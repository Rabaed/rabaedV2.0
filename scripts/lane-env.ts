// Writes .env for this worktree from .env.example with its own ports, so several
// worktrees (parallel Claude Code sessions) can run `pnpm dev` and the tests at once.
//
//   pnpm lane:env <n> [--force] [--free]     n = 0..9, one number per worktree
//
// Lane n uses Postgres 5432+100n, api 4000+100n, Rabaed Admin 4050+100n, web 3000+100n,
// Mailpit 8025+100n, the file store 9000+100n and its own Docker Compose project (container + volume). Lane 0 keeps the defaults.
//
// It refuses a lane whose ports are taken, or whose compose project another worktree
// already uses, and names the holder. --free takes the next lane that is free instead.
// `pnpm lanes:prune` removes the compose projects old worktrees left behind.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { firstFreeLane, laneClashes, lanePorts, laneProject, listContainers, takenLanePorts } from "./lanes.ts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const free = args.includes("--free");
const positional = args.filter((a) => !a.startsWith("--"));
const n = positional.length === 0 && free ? 1 : Number(positional[0]);
if (!Number.isInteger(n) || n < 0 || n > 9 || positional.length > 1 || args.some((a) => a.startsWith("--") && a !== "--force" && a !== "--free")) {
  console.error("Usage: pnpm lane:env <n> [--force] [--free]   (n = 0..9, one per worktree)");
  process.exit(1);
}
if (existsSync(".env") && !force) {
  console.error(".env already exists. Re-run with --force to overwrite it.");
  process.exit(1);
}

const containers = listContainers();
if (!containers) console.warn("Docker is not running, so only the ports were checked, not the compose projects.");
const check = { containers: containers ?? [], takenPorts: await takenLanePorts(), cwd: process.cwd() };
const clashesOf = (lane: number) => laneClashes(lane, check);

let lane = n;
const clashes = clashesOf(n);
if (clashes.length > 0) {
  const next = firstFreeLane(n, clashesOf);
  const prune = "`pnpm lanes:prune` removes rabaed-* compose projects whose worktree is gone or that are not running.";
  const why = `Lane ${n} is not free:\n${clashes.map((c) => `  - ${c}`).join("\n")}`;
  if (!free || next === undefined) {
    console.error(why);
    console.error(next === undefined ? `No lane is free. ${prune}` : `Lane ${next} is free: pnpm lane:env ${next}${force ? " --force" : ""} (or add --free). ${prune}`);
    process.exit(1);
  }
  console.log(`${why}\nUsing lane ${next}, the next free one.`);
  lane = next;
}

const { postgres: pg, api, admin, web, mailpit, files } = lanePorts(lane);

const env = readFileSync(".env.example", "utf8")
  .replace(/^COMPOSE_PROJECT_NAME=.*$/m, `COMPOSE_PROJECT_NAME=${laneProject(lane)}`)
  .replace(/^POSTGRES_PORT=.*$/m, `POSTGRES_PORT=${pg}`)
  .replace(/^PORT=.*$/m, `PORT=${web}`)
  .replace(/^API_PORT=.*$/m, `API_PORT=${api}`)
  .replace(/^ADMIN_PORT=.*$/m, `ADMIN_PORT=${admin}`)
  .replace(/^WEB_URL=.*$/m, `WEB_URL=http://lane${lane}.localhost:${web}`)
  .replace(/^MAILPIT_PORT=.*$/m, `MAILPIT_PORT=${mailpit}`)
  .replace(/^FILE_STORE_PORT=.*$/m, `FILE_STORE_PORT=${files}`)
  .replace(/^FILE_STORE_ENDPOINT=http:\/\/127\.0\.0\.1:9000$/m, `FILE_STORE_ENDPOINT=http://127.0.0.1:${files}`)
  .replace(/^MAIL_CATCHER_URL=http:\/\/127\.0\.0\.1:8025$/m, `MAIL_CATCHER_URL=http://127.0.0.1:${mailpit}`)
  .replace(/@localhost:5432\//g, `@localhost:${pg}/`)
  .replace(/^API_URL=http:\/\/127\.0\.0\.1:4000$/m, `API_URL=http://127.0.0.1:${api}`);

writeFileSync(".env", env);
console.log(`Wrote .env for lane ${lane}: Postgres ${pg}, api ${api}, Rabaed Admin ${admin}, web ${web}, Mailpit ${mailpit}, file store ${files}, compose project ${laneProject(lane)}.`);
console.log(`Open the web app at http://lane${lane}.localhost:${web}/en (its own host keeps sign-in cookies separate).`);
