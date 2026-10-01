// Writes .env for this worktree from .env.example with its own ports, so several
// worktrees (parallel Claude Code sessions) can run `pnpm dev` and the tests at once.
//
//   pnpm lane:env <n> [--force]     n = 0..9, one number per worktree
//
// Lane n uses Postgres 5432+100n, api 4000+100n, web 3000+100n, Mailpit 8025+100n and its own
// Docker Compose project (container + volume). Lane 0 keeps the defaults.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [arg, flag] = process.argv.slice(2);
const n = Number(arg);
if (!Number.isInteger(n) || n < 0 || n > 9) {
  console.error("Usage: pnpm lane:env <n> [--force]   (n = 0..9, one per worktree)");
  process.exit(1);
}
if (existsSync(".env") && flag !== "--force") {
  console.error(".env already exists. Re-run with --force to overwrite it.");
  process.exit(1);
}

const pg = 5432 + 100 * n;
const api = 4000 + 100 * n;
const web = 3000 + 100 * n;
const mailpit = 8025 + 100 * n;

const env = readFileSync(".env.example", "utf8")
  .replace(/^COMPOSE_PROJECT_NAME=.*$/m, `COMPOSE_PROJECT_NAME=rabaed-lane${n}`)
  .replace(/^POSTGRES_PORT=.*$/m, `POSTGRES_PORT=${pg}`)
  .replace(/^PORT=.*$/m, `PORT=${web}`)
  .replace(/^API_PORT=.*$/m, `API_PORT=${api}`)
  .replace(/^MAILPIT_PORT=.*$/m, `MAILPIT_PORT=${mailpit}`)
  .replace(/^MAIL_CATCHER_URL=http:\/\/127\.0\.0\.1:8025$/m, `MAIL_CATCHER_URL=http://127.0.0.1:${mailpit}`)
  .replace(/@localhost:5432\//g, `@localhost:${pg}/`)
  .replace(/^API_URL=http:\/\/127\.0\.0\.1:4000$/m, `API_URL=http://127.0.0.1:${api}`);

writeFileSync(".env", env);
console.log(`Wrote .env for lane ${n}: Postgres ${pg}, api ${api}, web ${web}, Mailpit ${mailpit}, compose project rabaed-lane${n}.`);
console.log(`Open the web app at http://lane${n}.localhost:${web}/en (its own host keeps sign-in cookies separate).`);
