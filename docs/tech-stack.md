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
| `packages/mailer` | Email behind one interface: Amazon SES in the cloud, Mailpit locally |
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
| Fonts | IBM Plex Sans Arabic and IBM Plex Sans (open), Montserrat. The licensed **Thmanyah** fonts come from a private S3 bucket at build time and are never committed |
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
| IDs | UUIDv7 | Time-ordered; nothing to guess |
| Audit | Append-only `work_item_event` with a hash chain; `admin_action` for every Rabaed Engineer action | Evidence that can't be quietly changed ([ADR 0001](adr/0001-compliance-ready-from-day-one.md)) |
| Background work | Outbox table written in the same transaction, delivered by the worker | No lost or premature notifications |
| Auth | In-house: argon2id passwords, server-side sessions in HttpOnly, SameSite, Secure cookies, one-time expiring invitation tokens. Rabaed Engineers sign in with a password plus an email code | Our own Postgres, under our own rules |
| Files | S3, keys prefixed by Project, short-lived signed URLs signed by the api only | Storage follows tenancy (ADR 0007) |
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

## CI/CD: GitHub Actions

| Workflow | Does |
|---|---|
| `ci.yml` | Lint (including the rule against logging an error's message), typecheck, unit tests, seam 1 (the API as a Member), seam 2 (database RLS, and every `security definer` function sets `search_path`), story tests, infra assertions, mail, web build, web image start, and on pull requests that no existing migration was changed |
| `secret-scan.yml` | gitleaks; refuses font files |
| `infra-diff.yml` | Posts a `cdk diff` on each PR, using a read-only role |
| `deploy-dev.yml` | On merge to `main`: build and push images → migrate → deploy → smoke tests (including the visibility checks in the cloud); serialised; rolls back on smoke failure |
| `update-screenshots.yml` | Refreshes story screenshot baselines on a labelled PR, with least privilege (new stories' baselines are committed by `ci.yml` itself) |

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
