# Tech stack

What Rabaed is built with, and why. Exact versions live in each `package.json`; the major versions are listed here. Decisions with real trade-offs are recorded as ADRs in [`docs/adr/`](adr/).

## Shape

One TypeScript **pnpm monorepo**: four apps and shared packages, all on Node 24.

| App | What it is |
|---|---|
| `apps/web` | The customer app that every Company's Members use: Next.js |
| `apps/api` | The customer API: Fastify |
| `apps/admin` | **Rabaed Admin**, the separate service and portal for Rabaed Engineers. It's the only holder of the database role that bypasses row-level security ([ADR 0010](adr/0010-rabaed-admin-is-a-separate-service.md)) |
| `apps/worker` | Background jobs: delivers the outbox (in-app notifications, email) with retries |

| Package | What it holds |
|---|---|
| `packages/domain` | Shared rules and types: the Form schema and validator, the condition and formula evaluators, Step Age, visibility helpers. Pure and portable, so the browser, the server and the future offline app use the same code (ADR 0004) |
| `packages/db` | PostgreSQL migrations (plain SQL), the Kysely client, and role bootstrap |
| `packages/auth` | Passwords, sessions and invitation tokens |
| `packages/mailer` | Email behind one interface: Amazon SES on AWS, SendGrid on Vercel (ADR 0026), Mailpit locally |
| `packages/ui` | The design system: tokens, components, Storybook |
| `packages/eslint-plugin` | Rabaed's own lint rules: no hard-coded colours, no physical left/right CSS, no deadline words |
| `packages/infra` | AWS infrastructure as code (CDK) |

## Language and tooling

| | Choice |
|---|---|
| Language | TypeScript 6, strict |
| Runtime | Node.js 24 |
| Package manager | pnpm 10 (through corepack) |
| Validation | Zod 4, for API requests and responses and for config |
| Lint | ESLint 10 with `typescript-eslint`, plus `@rabaed/eslint-plugin` |
| Tests | Vitest 5 (unit, both seams, infra, mail); Vitest browser mode with Playwright for UI stories |

## Frontend

| | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Styling | Tailwind CSS 4, with design tokens; logical CSS only (RTL-safe) |
| Components | Radix UI primitives behind our own components (`@rabaed/ui`), `class-variance-authority`, Tabler icons |
| Languages | next-intl. Arabic and English from day one, RTL, Latin digits, Document Numbers always left-to-right |
| Fonts | IBM Plex Sans Arabic and IBM Plex Sans (open), Montserrat. The licensed **Thmanyah** fonts come from a private S3 bucket at build time and are never committed. The product owner has Thmanyah's consent to embed them in the Documental Record's PDFs (RP-23 grilling, 2026-10-16); the worker reads them from the same private bucket |
| Design system | Storybook 10, with story tests for behaviour, axe accessibility and EN/AR screenshots |

## Backend and data

| | Choice | Why |
|---|---|---|
| API | Fastify 5 with `fastify-type-provider-zod` | Fast, typed routes, schema-validated |
| Database | **PostgreSQL 16** | One database; the Project is the tenancy boundary, enforced by **row-level security** ([ADR 0007](adr/0007-project-is-the-tenancy-boundary.md)) |
| Query builder | Kysely; no ORM | SQL stays visible, which RLS and security-definer functions need |
| Schema | Plain SQL migrations | RLS policies, functions and grants are first-class |
| Form answers | One JSONB document per Work Item, against a pinned, unchangeable Form Version ([ADR 0006](adr/0006-form-data-as-jsonb-against-versioned-schemas.md)), read only through a function that strips references the reader may not see ([ADR 0012](adr/0012-answers-read-only-through-a-stripping-function.md)) | Customer-built Forms without runtime schema changes |
| Engines | One generic Form engine and one in-house Workflow engine on Postgres ([ADR 0002](adr/0002-generic-form-and-workflow-engines.md), [ADR 0008](adr/0008-in-house-workflow-engine-on-postgres.md)) | Every module is configuration, not new code |
| IDs | Random UUIDv4 | Carry no time, so safe to expose; nothing to guess ([ADR 0015](adr/0015-random-ids-not-uuidv7.md)) |
| Audit | Append-only `work_item_event` with a hash chain; `admin_action` for every Rabaed Engineer action | Evidence that can't be quietly changed ([ADR 0001](adr/0001-compliance-ready-from-day-one.md)) |
| Background work | Outbox table written in the same transaction, delivered by the worker | No lost or premature notifications |
| Auth | In-house: argon2id passwords, server-side sessions in HttpOnly, SameSite, Secure cookies, one-time expiring invitation tokens. Rabaed Engineers sign in with a password plus an email code | Our own Postgres, under our own rules |
| Files | S3, keys prefixed by Project, short-lived signed URLs signed by the api only | Storage follows tenancy (ADR 0007) |
| Documental Records | The worker writes the Record Data (XML), renders the one layout with **headless Chromium** (Playwright), converts to **PDF/A-3** with the XML attached, checks it (veraPDF), and seals it with **PAdES B-LT**: a KMS key (`pdf-sealing`) under Rabaed's own certificate, plus a free RFC 3161 timestamp ([ADR 0023](adr/0023-the-record-is-a-sealed-pdf-a-3-made-from-record-data.md)) | Arabic shaping and mixed RTL/LTR as the browser draws them; tamper-evident with no paid certificate; a record can be made again from the same facts |
| Logging | pino; database error codes only, never raw messages (they can quote row values) | No data leaks through logs |

## Local development

| | Choice |
|---|---|
| Services | Docker Compose: PostgreSQL 16, **Mailpit** (mail catcher), **RustFS** (S3-compatible file store). Nothing local touches AWS |
| Commands | `pnpm dev` (stack and apps), `pnpm demo` (reset, seed the demo Project, run), `pnpm storybook` |
| Parallel lanes | One git worktree per lane, each with its own ports (`pnpm lane:env`) |

## Cloud: AWS

All defined as code with **AWS CDK 2** in TypeScript. The region is a parameter, so the same code serves the standard Instance and, later, the KSA Instance ([ADR 0005](adr/0005-two-independent-instances-inside-and-outside-ksa.md)). Dev runs in **Frankfurt (eu-central-1)** and holds demo data only.

| | Choice |
|---|---|
| Compute | ECS Fargate services for web, api, admin and worker; images in ECR (scanned on push); circuit-breaker rollback |
| Entry | Application Load Balancers over HTTPS: one for the customer app, a separate one for Rabaed Admin |
| Database | RDS PostgreSQL 16, private subnets, encrypted with a customer-managed KMS key, backups and deletion protection on |
| Secrets | Secrets Manager with rotation; each service's role reads only its own secrets |
| Storage | S3 for Project files, build assets (fonts) and logs; private, KMS- or SSE-encrypted, TLS-only, versioned |
| Email | Amazon SES |
| Observability | CloudWatch logs and alarms (api, worker and outbox, database), CloudTrail, load-balancer access logs |
| Cost | AWS Budgets monthly alert |

Stacks: account, network, data, storage, registry, migrations, app and monitoring. A guided wizard (`packages/infra/scripts/setup-aws-account.sh`) covers the steps only a human can do.

## Dev and UAT: Vercel

Dev, demo and UAT run on Vercel with demo data only, so builders get a link to every change ([ADR 0026](adr/0026-dev-and-uat-run-on-vercel.md)). Production and the KSA Instance are not decided yet.

| | Choice |
|---|---|
| Apps | Three Vercel projects in Frankfurt: web, api (Fastify unchanged) and Admin (alone holds the bypass role) |
| Database | Supabase in Frankfurt as plain PostgreSQL 16: Data API off, no Supabase Auth or Storage, no anon or service keys |
| Background work | Vercel Cron delivers the outbox (RP-1039, below); Documental Records run on an always-on container in Frankfurt with a UAT test signer |
| Files | Cloudflare R2, through the same S3 client as local RustFS: `FILE_STORE_ENDPOINT` is R2's S3 address and `FILE_STORE_REGION=auto`; checksums only where an operation requires one, so a browser's PUT to a signed URL works (RP-1041). Only the api signs URLs, for 5 minutes; keys stay Project-prefixed (ADR 0007). The app's key (`FILE_STORE_ACCESS_KEY_ID`, `FILE_STORE_SECRET_ACCESS_KEY`) is **Object Read & Write** on that bucket only, and the app never creates the bucket or sets its CORS (`ensureLocalBucket` acts only on a store on this machine). **CORS is a one-off owner step in the Cloudflare dashboard**: the UAT web origin only, PUT and GET, `content-type`, 10 minutes (the exact JSON is in PR #418's body; `uatCorsRules` in `apps/api/src/documents/uat-cors.ts` gives the same rules). `pnpm --filter @rabaed/api r2:cors --origin <url>` is an optional way to set the same rules: it reads an R2 admin key of its own (`R2_ADMIN_ACCESS_KEY_ID`, `R2_ADMIN_SECRET_ACCESS_KEY`), refuses to run with only the app's key, and refuses `*`; no app or Vercel project is ever given the admin key |
| Fonts | Thmanyah Sans sits in the R2 build assets bucket (`BUILD_ASSETS_BUCKET`), which has **no public URL** (no r2.dev, no custom domain), so the fonts are private by construction. The UAT deploy Action is to fetch them on its runner, with a read-only key (`FONTS_ACCESS_KEY_ID`, `FONTS_SECRET_ACCESS_KEY`), into the git-ignored `packages/ui/fonts/thmanyah/` before `vercel build` (`pnpm --filter @rabaed/api fonts:fetch`); RP-1043 builds that step, and until it lands every UAT build uses the fallback. That key is never in a Vercel project, so a pull-request preview Vercel builds itself uses the IBM Plex fallback. The Records image takes the same folder as its `fonts` build context (Dockerfile) and, with `RECORD_FONTS_DIR=/opt/record-fonts/thmanyah`, prints Records in Thmanyah; that image goes to a private registry only (the licence). None there: a warning, and IBM Plex Sans Arabic |
| Email | SendGrid, tracking off |
| Deploy | A GitHub Action on `main`: migrate, deploy, visibility smoke tests. Pull requests without a migration get a preview behind Vercel Authentication |
| Connections | The apps use Supabase's **transaction pooler** (port 6543): the Member is set per transaction, so a pooled connection carries nothing to the next request. Migrations and the Supabase gate use the **session pooler** (port 5432 on the same host): migrations hold a session advisory lock. Supabase's direct connection is IPv6-only, unreachable from GitHub runners. Pooler logins are `<role>.<project ref>`; the roles are the plain names |
| Projects | `vercel.json` in `apps/web`, `apps/api` and `apps/admin` (RP-1038, below): `fra1`, the pnpm workspace installed from the repo, Vercel's own Git deploy of `main` off (the Action is the only way to production; pull-request previews stay on), `X-Robots-Tag: noindex` and a `robots.txt` that disallows everything, no sitemap |
| Supabase gate | `pnpm --filter @rabaed/db gate:supabase` (RP-1037): bootstrap with the bypass role, every migration, seam 2 unchanged, an api call's transaction through the transaction pooler, and the Data API off (a call with the publishable key, read only by the gate, gets PostgREST's no-exposed-schema answer). Locally it runs against the lane's Postgres and skips the Data API check |

### The three Vercel projects (RP-1038)

**How api and Admin run.** Each is one Node function, `api/index.ts` in its app: it builds the Fastify app once per instance (`fastifyHandler`, `apps/api/src/vercel.ts`) and hands it every request unchanged; `vercel.json` rewrites every path to it. There is no `listen`, no outbox report on a timer and no signal handler there, and the api never creates its bucket (`src/server.ts` keeps all of that for local runs). Vercel's Node builder compiles each TypeScript file it traces to `.js`, but leaves `.ts` import paths and the workspace packages' `exports` (`./src/index.ts`) pointing at `.ts` files it renamed, so the function would not load. So `includeFiles` ships the TypeScript sources of the app and the workspace packages it reaches, and Node runs them itself: `NODE_OPTIONS=--experimental-transform-types` (transform, not strip-only, because some classes use parameter properties). `src/vercel-entry.test.ts` in both apps loads the entry that way and checks nothing keeps the process alive. Admin's function also ships `dist/**` (built by `vite build`, its project's build command) and the rest of `src/`: `routes/pages.ts` reads `src/pages/` and `dist/` at start. `public/robots.txt` is each project's only static file (an empty output directory is refused). The `vercel.json` header rule sends `X-Robots-Tag` on what the app does not answer itself (that file, Vercel's own error pages); the apps send it on everything else. Functions: 60 s for the api, 300 s for Admin (register imports), Next's defaults for web (300 s on Pro).

**Pool size.** `DATABASE_POOL_MAX` overrides a process's pool size (`poolMaxFromEnv`, `packages/db`): each Vercel instance holds its own small pool on the transaction pooler.

**Client address in Admin** (the new-device alert): Admin trusts one proxy hop, as behind the AWS load balancer. Vercel overwrites `X-Forwarded-For` with the client's address and forwards none a client wrote (Vercel docs, Request headers), so the one hop it adds is read the same way; no setting is needed.

**Project settings the deploy workflow applies** (RP-1043; `PATCH https://api.vercel.com/v9/projects/{idOrName}?teamId=$VERCEL_ORG_ID`, Vercel REST API "Update an existing project"). The rest is in each `vercel.json`.

| Project | `rootDirectory` | `framework` | Also |
|---|---|---|---|
| web | `apps/web` | `nextjs` | |
| api | `apps/api` | `null` (Other: not Vercel's Fastify preset, which would pick `src/app.ts` as the entry) | |
| Admin | `apps/admin` | `null` | `passwordProtection: { deploymentType: "all", password }` |

All three: `nodeVersion: "24.x"`, `sourceFilesOutsideRootDirectory: true`, `serverlessFunctionRegion: "fra1"`, and `ssoProtection: { deploymentType: "preview" }` (Vercel Authentication on previews, ADR 0026). Admin's password covers `all`, its production `*.vercel.app` address included (`prod_deployment_urls_and_all_previews` would leave the production domain open). **Password Protection costs $20 a month per protected project on Pro** (Vercel docs, Password Protection, 2026-09); the legacy Advanced Deployment Protection package ($150 a month per team) is not needed. The password is a new secret in environment `uat`. The smoke reaches Admin with the header `x-vercel-protection-bypass` and the project's Protection Bypass for Automation secret (all plans; it bypasses Password Protection and Vercel Authentication).

**Environment variables**, every one Sensitive (ADR 0026). _uat_ means built from the GitHub environment `uat`'s secrets; the rest are plain values or `uat` variables. The anon, publishable and service keys go into no project, and only Admin gets an admin-role connection.

| Variable | web | api | Admin | Source |
|---|---|---|---|---|
| `API_URL` | the api's production URL | | | |
| `APP_VERSION` | ✓ | ✓ | ✓ | the commit SHA |
| `NODE_OPTIONS` | | `--experimental-transform-types` | `--experimental-transform-types` | |
| `NODEJS_HELPERS` | | `0` | `0` | hands Fastify the request as Node gave it |
| `DATABASE_APP_URL` | | ✓ | | _uat_: login `rabaed_app.<project ref>`, `DATABASE_APP_PASSWORD`, `DATABASE_POOLER_HOST` port 6543 (transaction pooler), as the gate's `appTransaction` |
| `DATABASE_ADMIN_URL` | | | ✓ | _uat_: as above with `rabaed_admin` and `DATABASE_ADMIN_PASSWORD` |
| `DATABASE_POOL_MAX` | | `2` | `2` | |
| `SESSION_COOKIE_SECURE` | | `true` | `true` | cookies stay host-only, Secure; SameSite as locally (Lax for the api, Strict for Admin) |
| `SESSION_TTL_HOURS`, `INVITATION_TTL_HOURS`, `DOCUMENT_MAX_MB`, `DOCUMENT_CONTENT_TYPES` | | optional | `INVITATION_TTL_HOURS` optional | defaults otherwise |
| `PROJECT_FILES_BUCKET` | | ✓ | | `uat` variable (R2, RP-1041) |
| `FILE_STORE_ENDPOINT` | | ✓ | | `uat` variable: R2's S3 address |
| `FILE_STORE_ACCESS_KEY_ID`, `FILE_STORE_SECRET_ACCESS_KEY` | | ✓ | | _uat_ (R2 key, Object Read & Write on the files bucket only) |
| `FILE_STORE_REGION` | | `auto` | | R2's region (RP-1041); never `AWS_REGION`, which Vercel sets to its own |
| `WEB_URL` | | ✓ | ✓ | web's production URL: invitation links (Admin), and the links in notification emails, digests and Step Age reports (the api's cron pass, RP-1039) |
| `MAIL_FROM` | | ✓ | ✓ | `uat` variable |
| `SENDGRID_API_KEY` | | ✓ | ✓ | _uat_ (Mail Send only); no `MAIL_CATCHER_URL` or `MAIL_SES_CONFIGURATION_SET` beside it |
| `CRON_SECRET` | | ✓ | | _uat_: random, 16 characters or more (a shorter one counts as none); Vercel Cron sends it as `Authorization: Bearer …` (RP-1039) |

**The outbox on Vercel (RP-1039).** There is no always-on worker: Vercel Cron calls `GET /internal/cron/outbox` on the api **every minute** (`crons` in `apps/api/vercel.json`, `* * * * *`). Vercel runs crons on production deployments only, and a schedule more often than once a day needs the **Pro plan** (Hobby allows once a day, within the hour, and refuses the deploy otherwise; Vercel docs, Cron Jobs › Usage & Pricing, 2026-07). Each call runs one pass (`apps/api/src/cron/outbox-cron.ts`): the scheduled jobs that are due (the daily digest, the weekly Step Age report, the import clean-up; each run claimed in the database, so a duplicate or late call runs nothing twice; on AWS the worker's loop runs them, and with no worker on Vercel the pass must, or no digest or Step Age report would ever be queued), then one `processOutbox` run of the kinds the api delivers, `notification`, `email`, `digest`, `step_age_report` and `record_ready`, at most 100 rows and no new row after 40 s, so it ends inside the function's 60 s (a SendGrid send gives up after 10 s and its row is retried). The Documental Record kinds (`documental_record`, `documental_record_reproduce`, `working_copy`, `snag_report`) are never taken there: they stay due, attempts unspent, for the Records container (RP-1042, parked). Two overlapping passes never take one row twice (`app.take_outbox_row` skips locked rows), and Vercel does not retry a failed call: the next minute's pass picks up. The route refuses with 401, running nothing, any call without the right bearer (compared in constant time, never logged), and every call when `CRON_SECRET` is unset; it answers with counts only. The emails are re-checked against what the recipient may see at send time, as on AWS. Locally the worker's loop delivers every kind, as before.

Never in any project: `DATABASE_SUPERUSER_URL`, `DATABASE_MIGRATOR_PASSWORD` (the deploy's migrate step only), `VERCEL_TOKEN`, Supabase's keys, the fonts key and `BUILD_ASSETS_BUCKET` (the deploy Action's runner only), the R2 admin key (`R2_ADMIN_*`, `r2:cors` only).

## CI/CD: GitHub Actions

| Workflow | Does |
|---|---|
| `ci.yml` | Lint (including the rule against logging an error's message), typecheck, unit tests, seam 1 (the API as a Member), seam 2 (database RLS, and every `security definer` function sets `search_path` and is written in plpgsql), story tests, infra assertions, mail, web build, web image start, and on pull requests that no existing migration was changed |
| `secret-scan.yml` | gitleaks; refuses font files |
| `infra-diff.yml` | Runs `cdk diff` against dev on each PR, using a read-only role, and writes it to the job summary; comments on the PR only when the PR itself changes an IAM or stateful resource (RP-1018) |
| `deploy-dev.yml` | On merge to `main`: build and push images → migrate → deploy → smoke tests (including the visibility checks in the cloud); serialised; rolls back on smoke failure |
| `update-screenshots.yml` | Refreshes story screenshot baselines on a PR that touches stories or `packages/ui/src` (or carries the label), and adds new stories' baselines after CI, with least privilege |

GitHub reaches AWS through **OIDC only**: no stored AWS keys. The deploy role is trusted only by the deploy job on `main`, and deploys run under a least-privilege execution policy, not AdministratorAccess. Third-party actions are pinned to commit SHAs (Dependabot updates them).

## Testing approach

Tests check behaviour from outside, never internals, at a few seams:

1. **Seam 1, the API as a signed-in Member.** The `docs/visibility.md` scenarios run here.
2. **Seam 2, the database as the app role.** RLS proves isolation even if the app forgets a filter.
3. **Pure modules** in `packages/domain`: validator, evaluators.
4. **UI stories:** behaviour, axe, EN/AR screenshots.
5. **Infra assertions** on the synthesised templates, plus **smoke tests** after every deploy.

A failing visibility test blocks merge.

## Ways of working

- Jira project **RP** for tickets; code in GitHub `Rabaed/rabaedV2.0`. See [`docs/agents/`](agents/).
- Claude Code agents work in parallel lanes, from grilling to spec to tickets to implement, using the Matt Pocock skills.

## Planned, not built yet

- **Workflow builder:** a visual graph editor (React Flow or similar), ADR 0002.
- **Native mobile apps** with offline support, later; the web app is responsive first (ADR 0004).
- **More languages** beyond Arabic and English, through a translation service such as Lokalise.
- **The KSA Instance:** the same code in a KSA region, kept independent (ADR 0005).
