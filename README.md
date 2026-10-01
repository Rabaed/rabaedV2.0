# Rabaed v2.0

B2B construction management platform for KSA. Start with `CLAUDE.md`, `CONTEXT.md` and `docs/visibility.md`.

## Run it locally

You need Node 24, Docker, and pnpm (`corepack enable`).

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` starts Postgres 16 and Mailpit (the mail catcher) in Docker, creates the database roles, applies migrations, then runs:

| App | URL |
|---|---|
| web | http://localhost:3000 (`/en`, `/ar`; health page at `/en/health`) |
| api | http://127.0.0.1:4000 (`GET /health`) |
| worker | background process, logs only |
| Mailpit | http://127.0.0.1:8025: every email the apps send locally lands here, never in a real mailbox |

## Demo: the MAR journey

One command resets the local database, seeds the demo Project and starts the stack:

```bash
pnpm demo
```

It starts Postgres, drops and rebuilds the local database (`pnpm db:reset`, which refuses any database that isn't on this machine), seeds the demo (`pnpm demo:seed`) and runs web, api and worker. The seed is built through the API itself, and the Rabaed Engineer onboards each Company through Rabaed Admin, so `admin_action` records each onboarding with its reason (V9). The names, emails (on the reserved `.test` domain), CR and VAT numbers are made up.

Everyone signs in with one password, generated on your machine the first time and kept in `.env.demo` (git-ignored; it stays the same across resets). The seed prints the list below.

**Project:** Riyadh Gate Tower – Phase 2 (`TWR`). Trades Electrical Works (`EL`) and Mechanical Works (`ME`); Locations Main Zone › Tower 1 (Floors 01–03) and Tower 2 (Floor 01).

| Company | Role on the Project | Covers | Person | Email |
|---|---|---|---|---|
| TMC Constructions | Contractor, Project Admin | Electrical, everywhere | Saeed Al Qahtani (Authorized Person) | `saeed.alqahtani@tmc.demo.rabaed.test` |
| | | | Hafiz Hamdan (Engineer) | `hafiz.hamdan@tmc.demo.rabaed.test` |
| | | | Ali Sonour (Project Manager) | `ali.sonour@tmc.demo.rabaed.test` |
| Beta Build | Contractor | Electrical, everywhere (like TMC: only the Company boundary hides TMC's work) | Yousef Karim (Engineer) | `yousef.karim@betabuild.demo.rabaed.test` |
| Design Consultants LLC | Consultant | Electrical and Mechanical | Ahmed bin Said, Sara (Engineers) | `ahmed.binsaid@…`, `sara@designconsultants.demo.rabaed.test` |
| | | | Mohammed Al Shamsi (Manager) | `mohammed.alshamsi@designconsultants.demo.rabaed.test` |
| Al Waha PMC | Owner Representative | Electrical, everywhere | Faisal Al Otaibi (Engineer, Arabic) | `faisal.alotaibi@alwaha.demo.rabaed.test` |

Each Company's Authorized Person (`<first>.<last>@<company>.demo.rabaed.test`) can sign in too, and the Rabaed Engineer is `engineer@rabaed.demo.rabaed.test`. The seed also leaves one Draft of Hafiz's, "Emergency lighting – Tower 2", which only TMC sees; the walkthrough's MARs come on top of it.

**A second Project:** Jeddah Corniche Villas (`JCV`), Beta Build's own, with one Trade (Plumbing Works) and one Draft MAR ("Pump room ventilation"). Its only Member is Beta Build's Authorized Person, Nasser Al Dosari (`nasser.aldosari@betabuild.demo.rabaed.test`), who is on no other Project. Nobody on Riyadh Gate Tower can see it, and Nasser cannot see Riyadh Gate Tower: each gets 404. Dev's deploy checks exactly that after every deploy (see "Demo in dev").

### Walkthrough

Open http://localhost:3000/en (or `http://laneN.localhost:<port>/en` in a lane). Use a private window per person, or sign out between steps. Every step works the same in Arabic: switch with the language button, or use `/ar/…`. The buttons there are:

| English | العربية |
|---|---|
| Submittals · New Material Submittal · Save Draft | الاعتمادات · اعتماد مواد جديد · حفظ المسودة |
| Send for Review | إرسال للمراجعة |
| Claim · Release to pool | استلام · إعادة إلى المجموعة |
| Return (Reason) | إعادة (السبب) |
| Submit | تقديم |
| Approve · A · Revise & Resubmit · C | اعتماد · A · مراجعة وإعادة تقديم · C |
| Notifications · Mark all as read | الإشعارات · تعليم الكل كمقروء |
| With | لدى |

| # | Who | Do | What each Company sees |
|---|---|---|---|
| 1 | Hafiz | Riyadh Gate Tower – Phase 2 → Submittals → New Material Submittal: "Lighting Fixtures", Electrical Works, Tower 1 Floor 02 → Save Draft | TMC sees the Draft (no number yet). Beta Build, Design Consultants and Al Waha see nothing, not even in the counts. |
| 2 | Hafiz | Send for Review | It gets its Document Number (`TWR-MAR-01-0001`) and waits in Ali's pool. Ali's bell shows 1 (the worker delivers within seconds). Still nothing outside TMC. |
| 3 | Ali | Open it from the bell → Claim → Return, with the reason "Add emergency duration" | Back in Hafiz's Draft, the reason in TMC's history, marked internal. |
| 4 | Hafiz | Send for Review again | Hafiz's bell showed the Return; now Ali's pool has it again. |
| 5 | Ali | Claim → Submit | Pending Approval. TMC sees "With Design Consultants LLC", never a Consultant's name. Mohammed's bell shows it. Ahmed and Sara see it but have no buttons (only a Manager can issue a Code). Faisal (Al Waha) sees it as oversight, read-only. Yousef (Beta Build) still sees nothing. The Consultant's history shows the Submit only, never the Return. |
| 6 | Mohammed | Claim → Approve · A | Approved, Code A. TMC and Al Waha see the Code and that Mohammed Al Shamsi issued it; nobody else of the Consultant is named to them. The item accepts no more moves. |
| 7 | Hafiz, Ali, Mohammed | Repeat with "Cable tray layout – Level 2" and end with Revise & Resubmit · C | Revise & Resubmit, Code C. |

Step Age dots (1–4+ weeks at the current Step) show on the list and the item; there are no due dates.

Both seam suites run against this seeded setup: their global setup (`apps/api/test/support/seed-demo.ts`) seeds the same demo into the test database, where the demo people sign in with the test harness's password, and `apps/api/test/demo-seed.test.ts` follows the walkthrough above through the API.

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
| Mailpit | 8025 | 8025 + 100n |

Open each lane's web app at `http://laneN.localhost:<web port>/en`. Browsers keep cookies per host name, not per port, so a separate `laneN.localhost` host stops one lane's sign-in from replacing another's. Tests read the same `.env`, so each lane's test runs use its own database.

## Layout

| Package | What it holds |
|---|---|
| `apps/web` | Next.js, React, Tailwind + shadcn/ui, next-intl (English and Arabic, RTL, Latin digits). UI strings live in `apps/web/messages/*.json` as translation keys. |
| `apps/api` | Fastify with zod validation. |
| `apps/worker` | Outbox processor (in-app notifications, from RP-195). |
| `packages/domain` | Shared rules and types, no I/O. |
| `packages/mailer` | Email: `send({ to, template, locale, values })`, with the templates in English and Arabic (RTL, Latin digits). Amazon SES in AWS; locally and in CI, Mailpit (`MAIL_CATCHER_URL`). |
| `packages/db` | Kysely, the migration runner, role bootstrap and `withMember`. Migrations are plain SQL in `packages/db/migrations`, named `YYYYMMDDHHMMSS_what.sql`. |
| `packages/infra` | AWS CDK (TypeScript). One entry per environment in `src/config.ts` (name, region, GitHub repository, budget); dev is `eu-central-1`. `pnpm --filter @rabaed/infra cdk synth` prints the templates. |

## AWS account setup

Each environment has its own AWS account. The steps only a person can do are one re-runnable wizard; run it from Git Bash (Windows), macOS or Linux:

```bash
bash packages/infra/scripts/setup-aws-account.sh dev
```

| Stage | What happens |
|---|---|
| 1. Tools | Checks for the AWS CLI v2 (with `aws login`), the GitHub CLI, OpenSSL and Node, and signs `gh` in. |
| 2. AWS account | Optionally walks you through creating the account and putting MFA on the root user, then signs the CLI in with `aws login` (short-lived console credentials; no access keys) and confirms the account ID. |
| 3. Billing contact | Sets the account's billing alternate contact with `aws account put-alternate-contact`. |
| 4. Alert emails | Asks where budget alerts go (the amount is `monthlyBudgetUsd` in `src/config.ts`) and where CloudWatch alarms go. |
| 5. CDK bootstrap | `cdk bootstrap` for the account and region: the CDK's own deploy, publishing and lookup roles and asset bucket. |
| 6. Account stack | Deploys `Rabaed-<env>-Account` (`src/account-stack.ts`): GitHub's OIDC provider; `rabaed-<env>-github-deploy`, assumable only from `Rabaed/rabaedV2.0` `main`, which can assume the CDK bootstrap roles, push to the `rabaed-<env>/*` image repositories, run the `rabaed-<env>-migrate` task and pass it only its own roles; `rabaed-<env>-github-diff`, assumable only from this repository's pull requests and read-only (it can only assume the CDK lookup role); the monthly budget, alerting at 80% of actual and 100% of forecast spend; and the alarm topic `rabaed-<env>-alarms`, which emails the alarm address (confirm the subscription in the email AWS sends). The CDK shows the IAM changes for approval. |
| 7. Interim HTTPS certificate | Creates a self-signed certificate for `*.<region>.elb.amazonaws.com` with OpenSSL, imports it into ACM and deletes the private key locally (see "Dev environment on AWS"). Offers to replace it on later runs; it is valid for 397 days. |
| 8. GitHub variables | Records `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `AWS_DIFF_ROLE_ARN`, `AWS_CERTIFICATE_ARN` and `AWS_CERTIFICATE_PEM` (the certificate, which is public) as repository variables. |
| 9. Email sender | Asks for the address every email comes from and has SES verify it (AWS emails it a link), records it as the `MAIL_FROM_ADDRESS` repository variable, requests SES production access (leaving the sandbox; AWS reviews it, usually within a day) and offers a test email from the sender to itself. See "Email" below. |
| 10. Thmanyah fonts | Uploads the licensed `thmanyahsans-*.woff2` files from a folder on your computer to the private build assets bucket, under `fonts/thmanyah/`. Needs the storage stack, so on a new account it is skipped until the first deploy; re-run the wizard then. See "Thmanyah fonts" below. |
| 11. Test alarm | Sets `rabaed-<env>-load-balancer-5xx` to ALARM with `aws cloudwatch set-alarm-state` and asks whether the email arrived. CloudWatch sets it back within minutes (an OK email follows). Needs the monitoring stack, so it is skipped until the first deploy. |

Your answers are remembered in `.env.aws` (git-ignored), so a re-run offers them as defaults; every stage is safe to repeat. Nothing secret goes into the repo or GitHub: the budget and alarm emails are `NoEcho` deploy-time parameters, never in a template or a diff, and GitHub holds only role ARNs, the region, the interim certificate (which is public) and its ARN, and the email sender's address (a variable, so it stays out of the repo).

Both roles check GitHub's immutable OIDC subject, which carries the owner and repository IDs (`repo:Rabaed@328426410/rabaedV2.0@1391344568:…`, set in `src/config.ts`), so a renamed or re-created repository cannot match. The wizard warns if GitHub's subject (`gh api repos/Rabaed/rabaedV2.0/actions/oidc/customization/sub`) ever differs from the config.

Once the variables exist, every pull request from this repository gets a `cdk diff` comment (account ID removed). Pull requests from forks get no AWS access and skip it. Because a pull request runs its own copy of the workflow, anyone who can push a branch here can read the account through the diff role (AWS ReadOnlyAccess, `kms:Decrypt` denied). That is acceptable for dev, which holds only demo data; production accounts need a narrower read role.

Note for later: CloudFormation has no `AWS::Budgets::Budget` in `me-central-1`, so if the standard Instance's production environment goes there, its budget must be created from another region.

## Dev environment on AWS

Every merge to `main` that passes CI is deployed to dev by `.github/workflows/deploy-dev.yml`. The workflow's summary shows the address; open `/en/health` there to see the API and database status and the deployed commit.

| Stack | What it holds |
|---|---|
| `Rabaed-dev-Network` | VPC over two zones: public subnets for the load balancer and the NAT gateway only; private subnets for the Fargate tasks; isolated subnets (no route out) for the database. The ECS cluster, the private DNS name `api.rabaed-dev.internal`, and every security group. |
| `Rabaed-dev-Data` | RDS PostgreSQL 16, single-AZ, not publicly accessible, TLS required, encrypted with a customer-managed KMS key, daily backups kept 1 day (the dev account is on AWS's Free plan, which refuses more; upgrading the plan allows 7), fixed 20 GB storage, deletion protection on. One JSON secret per database user (`database/master`, and `database/roles/<role>` for the three roles), each rotated every 30 days by a Secrets Manager Lambda inside the VPC. |
| `Rabaed-dev-Registry` | ECR repositories `rabaed-dev/web`, `api`, `worker`: scanned on push, tags immutable. |
| `Rabaed-dev-Storage` | The storage KMS key (rotating) and a signing key reserved for sealing PDFs. Buckets, all private, versioned, owner-enforced and TLS-only: **Project files** (storage key; objects under `projects/<Project>/…`, ADR 0007), **build assets** (storage key; the Thmanyah fonts under `fonts/`, which the deploy role may read and nothing else of the bucket) and **logs** (S3 access logs of the other two, the load balancer's access logs under `load-balancer/` and CloudTrail under `cloudtrail/`; kept a year). |
| `Rabaed-dev-Migrations` | The one-off migration task (`packages/db/src/setup.ts` in the api image). |
| `Rabaed-dev-App` | The load balancer (HTTPS, HTTP redirected; access logs to the logs bucket), the `web`, `api` and `worker` Fargate services at the fixed sizes in `src/config.ts`, each logging to `/rabaed/dev/<service>`, and the SES configuration set `rabaed-dev` (see "Email"). |
| `Rabaed-dev-Monitoring` | CloudTrail, the alarms and a saved Logs Insights query over all three services (see "Monitoring and audit trail"). |

Traffic paths (security groups, asserted in `test/network.test.ts`): internet → load balancer on 443 (and 80, only to redirect) → web → api → database; worker, the migration task and the password rotation Lambda → database. The load balancer forwards to web only; the browser reaches the api through web's `/api/v1` proxy, so Rabaed Admin is not reachable from the internet. Tasks may also call out over HTTPS (image pulls, logs, secrets) through the NAT gateway.

**The deploy, in order.** The workflow runs only after CI (lint, typecheck, unit, seam 1 and 2, infra assertions) passes on `main`, one deploy at a time; a run whose commit is no longer `main`'s head skips itself.

1. Deploy the network, data, registry and storage stacks, then download the Thmanyah fonts from the build assets bucket, if any were uploaded.
2. Build the three images from the root `Dockerfile` and push them tagged with the commit SHA (a re-run reuses them). Only web gets the fonts.
3. Deploy the migrations stack with that image, run the task, print its log and stop if it does not exit 0. The app is not touched. Dev is a demo environment, so the same task then seeds the demo if it is missing (or resets it, see "Demo in dev").
4. Deploy the app stack with that image, then the monitoring stack. ECS rolls each service over; if new tasks fail their health checks (web: the load balancer's `GET /api/health`; api: `GET /health`, which answers 503 without the database), the circuit breaker rolls the service back to the previous version and the deploy fails.
5. Smoke test (`packages/infra/src/smoke.ts`): HTTP redirects to HTTPS; `/api/health` shows web and the api both run this commit and the database is ok; `/en/health` loads, every font in its stylesheets comes from our own origin, and Arabic is in the font web was built with (Thmanyah Sans when the fonts were available), whose file loads. In dev it also signs in as Hafiz and Nasser, through web's `/api/v1` proxy, and checks that each gets 404 on the other's Project, its Work Item list and its Work Items and never sees it listed (the seeded Drafts, plus up to four more of Riyadh Gate Tower's Work Items from walkthroughs; a Project with none fails the check). Retries for five minutes, then fails the workflow. By then ECS has already switched over, so a failed smoke test marks the deploy red but does not restore the previous version (redeploy the last good commit with Actions → Deploy dev, or revert on `main`).
6. App role check: the migration task again, with `packages/db/src/check-app-role.ts`, connected as `rabaed_app` inside the VPC. It fails the deploy if the role is a superuser or bypasses row-level security, sees any row of `company`, `member`, `project`, `participant`, `work_item` or `work_item_event` with no Member set, can switch row security off, or may update, delete or truncate the append-only audit tables, `work_item_event` and `admin_action`. It reads and changes nothing.

No AWS keys exist anywhere: the workflow gets short-lived credentials through GitHub OIDC. Configuration reaches the containers as environment variables; nothing secret is in an image or a variable.

**Secrets and rotation.** Each task role reads only its own secrets (`test/services.test.ts`): api the `rabaed_app` and `rabaed_admin` secrets, worker `rabaed_app` only, web none. api and worker are given each secret's ARN (`DATABASE_APP_SECRET_ARN`, `DATABASE_ADMIN_SECRET_ARN`) and read the current password when the pool opens a connection, cached for five minutes (`packages/db/src/rotating-password.ts`). A rotation changes the password in the database and then in the secret, seconds apart. Connections already open are unaffected. A new connection refused in between rereads the secret and tries once more. So rotation needs no restart and causes no downtime. The one-off migration task gets its passwords injected at start, but in AWS it sets a role's password only when it creates the role (`DATABASE_ROLE_PASSWORDS=on-create`); after that rotation owns it, so a deploy never sets a rotated password back. There are no application secrets yet (only database credentials); when one is needed it follows the same pattern: its own secret, readable only by the task role that needs it.

**Test a rotation** (acceptance check, once per environment, as an account administrator):

```bash
aws secretsmanager rotate-secret --region eu-central-1 --secret-id rabaed/dev/database/roles/rabaed_app
aws secretsmanager describe-secret --region eu-central-1 --secret-id rabaed/dev/database/roles/rabaed_app --query '{last:LastRotatedDate,versions:VersionIdsToStages}'
```

Rotation takes a few seconds. `describe-secret` shows a new `LastRotatedDate` and a single `AWSCURRENT` version. Secrets Manager leaves the `AWSPENDING` label on that same version after a successful rotation; an `AWSPENDING` on any other version means the rotation is stuck. Then wait two minutes: the pool closes idle connections after 10 seconds and ECS checks the api's health every 15, so by then the api has opened new connections with the old (cached) password, been refused, reread the secret and connected. `/en/health` must still show "database: ok", the api service must have had no task replaced (ECS console → rabaed-dev → api → Tasks), and its log must show no errors. Repeat for `roles/rabaed_admin`, `roles/rabaed_migrator` and `master`, then run Actions → Deploy dev once to confirm migrations still sign in. If a rotation fails, the Lambda's log group (`/aws/lambda/rabaed-dev-rotate-<secret>`) says why.

**Project files.** Only the api's task role (`rabaed-dev-api-task`) can read or write objects, only under `projects/`, and the bucket policy refuses object access to every other principal, administrators included. Browsers will get files through signed URLs the api creates, which carry the api role's permissions; the bucket refuses any signature older than 15 minutes. The api is told the bucket as `PROJECT_FILES_BUCKET`. The bucket cannot tell one Project from another: before signing a URL the api must check the Member may see that Project's file (visibility.md), which arrives with the first file feature.

**Thmanyah fonts.** Thmanyah Sans is licensed: its files are never in the repo, the build context or GitHub. The wizard (stage 10) uploads them to the build assets bucket. The deploy role, which builds the images, may list and read only the bucket's `fonts/` prefix and decrypt only through S3 for that bucket (`test/storage.test.ts`; together with `test/ci-access.test.ts`, that is everything the role itself may do). Through the CDK deploy role it hands over to, a deploy can still change any stack, and so the bucket. The workflow hands the files to the web build alone as a separate build context (`--build-context fonts=…`, see the `Dockerfile`). Next.js bundles them, so dev serves them from its own address, never a font CDN. Without the files (a fork, a pull request, a local build, or before stage 10), everything builds with IBM Plex Sans Arabic. CI's web build checks exactly that. Uploaded fonts reach dev with the next merge to `main`. A re-run of the same commit reuses its web image, fonts or not. Two checks keep font files out of the public repo. `scripts/check-no-fonts.ts` refuses any font file anywhere in the history, by path, since font files are binary and gitleaks skips binary files. A gitleaks rule in `.gitleaks.toml` catches fonts inlined as base64 into CSS, HTML or JS.

**Email** (`src/email.ts`, asserted in `test/email.test.ts`). Rabaed sends email through Amazon SES in the environment's region, through `packages/mailer`. The sender is verified by the wizard (stage 9), outside CloudFormation: one address until Rabaed has a domain. Its address is never in the repo: the wizard records it as the `MAIL_FROM_ADDRESS` repository variable and the deploy passes it to the App stack as the `MailFromAddress` parameter (until it is set, the parameter is empty and nothing can send). Only the api's task role may call `ses:SendEmail`, only with that From address and only through the configuration set; the Rabaed Admin service gets the same grant when it exists (ADR 0010, RP-254). The api is told `MAIL_FROM` and `MAIL_SES_CONFIGURATION_SET`, which makes the mailer use SES. The configuration set `rabaed-dev` requires TLS, suppresses addresses that bounced or complained, and publishes bounces and complaints to CloudWatch (namespace `AWS/SES`), split by the `template` dimension, so CloudWatch → Metrics → SES shows them per template. A new account's SES is in the sandbox (sends only to verified addresses, 200 a day) until AWS grants production access, which the wizard requests.

When Rabaed's domain is chosen, verify the domain instead of the single address, and publish:

- *DKIM:* in SES, create an identity for the domain with Easy DKIM (RSA 2048). SES gives three CNAME records, `<token>._domainkey.<domain>` → `<token>.dkim.amazonses.com`; publish all three.
- *Custom MAIL FROM and SPF:* set the identity's MAIL FROM domain to `mail.<domain>` and publish `mail.<domain>` MX `10 feedback-smtp.<region>.amazonses.com` and TXT `"v=spf1 include:amazonses.com ~all"`, so SPF aligns with the From domain.
- *DMARC:* TXT on `_dmarc.<domain>`: start with `"v=DMARC1; p=none; rua=mailto:<reports mailbox>"`, then move to `p=quarantine` once the reports show only SES sending.

Then set `MAIL_FROM_ADDRESS` to an address on the domain (for example `no-reply@<domain>`). The grant already allows a domain identity (`identity/*`, limited by the From address), so no infrastructure change is needed.

**Logs bucket.** It is encrypted with S3-managed keys, not KMS, because S3 access logs and the load balancer's can only be delivered to such a bucket. Every other bucket uses the storage key.

**Demo in dev** (RP-213). Dev holds the demo and nothing else: the two demo Projects above, made up from end to end. There is no way to import data, and nobody should type real Companies, people or documents into it. Other environments are not demo ones (`demo` in `src/config.ts`): they have no demo password, and the demo command refuses to run there.

- *Seeded by the deploy.* After the migrations, every deploy runs `apps/api/src/cli/demo-environment.ts ensure` in the migration task. It seeds the demo, through the API as `pnpm demo:seed` does, only if the database does not have it yet, so the first deploy seeds it and later deploys leave it as it is. A seed that stopped part way fails every later deploy until the demo is reset.
- *Password.* Every demo person signs in with one password, generated in Secrets Manager (`rabaed/dev/demo/password`) and never in the repo. Read it with `aws secretsmanager get-secret-value --region eu-central-1 --secret-id rabaed/dev/demo/password --query SecretString --output text`. The migration task gets it at start, and the deploy role may read it (only it) for the smoke test.
- *Walkthrough.* Follow "Demo: the MAR journey" above at the dev address (the deploy's summary shows it) instead of localhost.
- *Reset.* Actions → Deploy dev → Run workflow, with "Reset the demo" ticked. The deploy then drops dev's database (closing the api's and worker's connections, which reconnect), migrates it again and seeds the demo afresh. For the few seconds in between, the running api answers 503 and dev may show errors. Everything anyone did in dev is gone, including its audit trail; that is only acceptable because dev holds demo data only.

**Monitoring and audit trail** (`src/monitoring-stack.ts`, asserted in `test/monitoring.test.ts`).

- *Logs.* Every log group is kept 30 days (`logRetentionDays` in `src/config.ts`), including the Lambdas': CDK's custom-resource Lambdas log to `/rabaed/dev/lambda/<stack>`, and each password-rotation Lambda is named so its `/aws/lambda/rabaed-dev-rotate-<secret>` group is created first. To search web, api and worker together: CloudWatch → Logs Insights → Queries → Saved → `rabaed-dev/all-services`, or pick the three `/rabaed/dev/…` groups yourself. api and worker log JSON lines with no customer content: requests by method and path (no query string), database errors by code and constraint only (their messages can quote a row), and the outbox as counts (`apps/api/src/logging.ts`, `apps/worker/src/log.ts`).
- *Alarms*, emailed through `rabaed-dev-alarms` when they fire and when they clear; thresholds in `src/config.ts`:

  | Alarm | Fires when |
  |---|---|
  | `rabaed-dev-api-5xx-rate` | more than 5% of api responses in 5 minutes are 5xx (with at least 10 requests), from the api's request log, which leaves out `/health` |
  | `rabaed-dev-load-balancer-5xx` | the load balancer itself answers 5 or more 5xx in 5 minutes (web down or not answering) |
  | `rabaed-dev-unhealthy-targets` | a web task fails the load balancer's health check for 5 minutes |
  | `rabaed-dev-outbox-age` / `-outbox-backlog` | the oldest unprocessed outbox row is over 5 minutes old / more than 100 rows wait for 15 minutes, from the worker's `outbox` log line. The worker logs it once it processes the outbox (RP-195); until then these alarms have no data and stay OK. |
  | `rabaed-dev-database-cpu` / `-storage` / `-connections` | CPU over 80% for 15 minutes / under 2 GB free / over 60 connections for 10 minutes |

- *Audit trail.* CloudTrail (`rabaed-dev`) records every management call in every region of the account, with log file validation, to the logs bucket under `cloudtrail/`. The load balancer's access logs go there too, under `load-balancer/`. Both are kept a year.

To test an alarm by hand (acceptance check): `aws cloudwatch set-alarm-state --region eu-central-1 --alarm-name rabaed-dev-load-balancer-5xx --state-value ALARM --state-reason test`, or run the wizard's stage 11.

**To see a rollback** (acceptance check): on a branch, make the api's `/health` return 503 only on ECS (for example when `ECS_CONTAINER_METADATA_URI_V4`, which ECS sets, is present; failing it everywhere fails seam 1, and CI never deploys), merge, and watch the workflow of the first commit that includes it (a newer merge cancels the older deploy): the App step fails with "circuit breaker", the service returns to the previous task definition, and `/en/health` keeps showing the previous commit. Revert afterwards.

**Interim HTTPS (until Rabaed has a domain).** No public certificate authority issues certificates for the load balancer's own AWS address, so the wizard (stage 7) imports a self-signed certificate for `*.eu-central-1.elb.amazonaws.com` and the listener uses it. Traffic is encrypted, but browsers warn the first time ("Your connection is not private"): choose Advanced → Proceed. The smoke test trusts exactly that certificate (`AWS_CERTIFICATE_PEM`). When the domain is decided: request an ACM certificate for `dev.<domain>` (DNS validation), point `dev.<domain>` at the load balancer, set `AWS_CERTIFICATE_ARN` to the new certificate and clear `AWS_CERTIFICATE_PEM`. The next deploy switches over; no code changes.

**Before the first deploy** (from `main`, after this is merged): re-run the wizard so stage 6 redeploys the account stack with the deploy role's new permissions and the alarm topic, and stages 7–8 create the certificate and record the variables. Then run the workflow by hand (Actions → Deploy dev → Run workflow) or merge anything.

## Database roles

| Role | Used by | Can |
|---|---|---|
| superuser (`DATABASE_SUPERUSER_URL`) | `pnpm db:setup` only | create roles and the database |
| `rabaed_migrator` | migrations, `pnpm engineer:create` | own the schema; as table owner it is not subject to RLS |
| `rabaed_app` | api, worker | read and write tables only through row-level security; cannot bypass it, create tables or own anything. It reaches sessions, passwords and invitations, writes Members and creates Projects only through narrow `SECURITY DEFINER` functions (`app.sign_in_candidate`, `app.session_principal`, `app.invite_member`, `app.create_project`, …). |
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

The Authorized Person then manages their Company's Members at `/en/members`: invite a Member (the page shows the one-time invitation link to pass on until email delivery exists), mark Members as Project Creators, and deactivate Members who leave, which ends their sessions at once. Every Member of the Company can read the list; no other Company can.

Members sign in at `/en/sign-in`. The web app forwards `/api/v1/*` to the API at runtime, so the session cookie stays first-party; Rabaed Admin (`/admin/...`) is not reachable through the web origin.

## Tests

All config comes from environment variables. The database suites use `<database>_test` on the same server, so they never touch your dev data.

```bash
pnpm test:unit    # pure logic, no database
pnpm test:seam1   # the API called as a given signed-in Member (apps/api/test)
pnpm test:seam2   # the database as the app role with a Member set (packages/db/test)
pnpm test:infra   # assertions on the synthesised AWS templates (packages/infra/test)
pnpm test:mail    # the mailer against Mailpit (packages/mailer/test); start it with docker compose up -d mailpit
pnpm lint
pnpm typecheck
```

Seam 1 is the primary suite: scenarios call the API through `createTestApi()` (`apps/api/test/support/harness.ts`) with real sign-in: `api.authorizedPerson()` onboards a Company and signs its Authorized Person in, `api.engineer()` gives a signed-in Rabaed Engineer, and `api.advanceClock()` moves time to test expiry.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit, web build, seam 1 and seam 2 against Postgres 16, the mailer against Mailpit, and the infra assertions, on every push and pull request; `secret-scan.yml` runs gitleaks (default rules plus `.gitleaks.toml`) and `scripts/check-no-fonts.ts` over the full history; `infra-diff.yml` posts `cdk diff` on pull requests once the AWS account is set up; `deploy-dev.yml` deploys `main` to dev after CI passes. For a failure to block merging, `main`'s branch protection must list these jobs as required status checks.

## Secrets

The repo is public. Commit only `.env.example`; real values come from the secrets manager.
