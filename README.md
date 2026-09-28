# Rabaed v2.0

B2B construction management platform for KSA. Start with `CLAUDE.md`, `CONTEXT.md` and `docs/visibility.md`.

## Run it locally

You need Node 24, Docker, and pnpm (`corepack enable`).

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres 16 in Docker, creates the database roles, applies migrations, then runs:

| App | URL |
|---|---|
| web | http://localhost:3000 (`/en`, `/ar`; health page at `/en/health`) |
| api | http://127.0.0.1:4000 (`GET /health`) |
| worker | background process, logs only |

## Several worktrees at once

Parallel Claude Code sessions each work in their own git worktree. Give each worktree its own lane number so they never share a database or a port:

```bash
pnpm lane:env 1        # in the first extra worktree; 2, 3 … in the others
pnpm install
pnpm dev
```

Lane `n` gets its own Docker Compose project (`rabaed-laneN`, with its own container and volume) and these ports:

| | lane 0 (default) | lane n |
|---|---|---|
| Postgres | 5432 | 5432 + 100n |
| api | 4000 | 4000 + 100n |
| web | 3000 | 3000 + 100n |

Open each lane's web app at `http://laneN.localhost:<web port>/en`. Browsers keep cookies per host name, not per port, so a separate `laneN.localhost` host stops one lane's sign-in from replacing another's. Tests read the same `.env`, so each lane's test runs use its own database.

## Layout

| Package | What it holds |
|---|---|
| `apps/web` | Next.js, React, Tailwind + shadcn/ui, next-intl (English and Arabic, RTL, Latin digits). UI strings live in `apps/web/messages/*.json` as translation keys. |
| `apps/api` | Fastify with zod validation. |
| `apps/worker` | Outbox processor (in-app notifications, from RP-195). |
| `packages/domain` | Shared rules and types, no I/O. |
| `packages/db` | Kysely, the migration runner, role bootstrap and `withMember`. Migrations are plain SQL in `packages/db/migrations`, named `YYYYMMDDHHMMSS_what.sql`. |

## Database roles

| Role | Used by | Can |
|---|---|---|
| superuser (`DATABASE_SUPERUSER_URL`) | `pnpm db:setup` only | create roles and the database |
| `rabaed_migrator` | migrations, `pnpm engineer:create` | own the schema; as table owner it is not subject to RLS |
| `rabaed_app` | api, worker | read and write tables only through row-level security; cannot bypass it, create tables or own anything. Before sign-in it reaches sessions, passwords and invitations only through narrow `SECURITY DEFINER` functions (`app.sign_in_candidate`, `app.session_principal`, …). |
| `rabaed_admin` | Rabaed Admin routes (`/admin/...`) | bypasses RLS (ADR 0007); every use (reads of customer data included, per visibility.md V9) goes through `asEngineer`, which records `admin_action` with a reason in the same transaction. The database does not enforce that pairing; the API is this role's only client. Cannot read passwords or sessions, and `admin_action` is insert-only. |

Every request runs in a transaction that sets the acting Member with `withMember` (`set_config('app.member_id', …, true)`); RLS policies read it through `app.current_member_id()`. With no Member set, policies match nothing.

Every table the app role can read must enable row-level security in its migration; the seam-2 suite fails otherwise.

## Sign-in and onboarding (local)

Rabaed Admin has no UI yet, so a Rabaed Engineer works through the API:

1. Create an Engineer; the password is printed once:
   ```bash
   pnpm engineer:create --email you@example.com --name "Your Name"
   ```
2. Sign in with `POST /admin/v1/session` (`{ email, password }`); the session is an HttpOnly cookie.
3. Onboard a Company with `POST /admin/v1/companies` (legal name EN/AR, CR number, VAT number, Authorized Person, and a required `reason`). The response holds the invitation token once.
4. Send the Authorized Person `http://localhost:3000/en/accept-invitation#token=<token>` (`/ar/…` for Arabic). The token sits in the URL fragment, so it never reaches a server log. It works once and expires after `INVITATION_TTL_HOURS`.

Members sign in at `/en/sign-in`. The web app forwards `/api/v1/*` to the API at runtime, so the session cookie stays first-party; Rabaed Admin (`/admin/...`) is not reachable through the web origin.

## Tests

All config comes from environment variables. The database suites use `<database>_test` on the same server, so they never touch your dev data.

```bash
pnpm test:unit    # pure logic, no database
pnpm test:seam1   # the API called as a given signed-in Member (apps/api/test)
pnpm test:seam2   # the database as the app role with a Member set (packages/db/test)
pnpm lint
pnpm typecheck
```

Seam 1 is the primary suite: scenarios call the API through `createTestApi()` (`apps/api/test/support/harness.ts`) with real sign-in: `api.authorizedPerson()` onboards a Company and signs its Authorized Person in, `api.engineer()` gives a signed-in Rabaed Engineer, and `api.advanceClock()` moves time to test expiry.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit, web build, seam 1 and seam 2 against Postgres 16 on every push and pull request; `secret-scan.yml` runs gitleaks. For a failure to block merging, `main`'s branch protection must list these jobs as required status checks.

## Secrets

The repo is public. Commit only `.env.example`; real values come from the secrets manager.
