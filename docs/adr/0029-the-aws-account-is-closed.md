# The AWS account is closed, and the CDK code removed

On 2026-11-02 the product owner closed Rabaed's AWS account and said "from now on all Vercel". The October bill was $298, from `Rabaed-dev-*` stacks still running after [ADR 0026](0026-dev-and-uat-run-on-vercel.md) had moved dev, demo and UAT to Vercel. ADR 0026 had kept `packages/infra` (the AWS CDK app), undeployed, so the production decision could still choose AWS. With no account behind it, that code only cost upkeep: its CI job, its lockfile entries and a README full of steps that could no longer be run. So RP-1214 removed it:

- **Removed:** `packages/infra` with its tests and the account wizard; the `infra (template assertions)` CI job and `pnpm test:infra`; and the AWS sections of the README and `docs/tech-stack.md`.
- **Moved:** the post-deploy smoke test, which the Vercel UAT deploy still uses, to `scripts/smoke.ts` and `scripts/deploy-smoke.ts`. `deploy-uat.yml` runs it with `node`, never through `pnpm --filter`, which exits 0 when no package matches.

Where it runs today is ADR 0026's table: Vercel for web, the api and Rabaed Admin; Supabase as plain PostgreSQL 16; Cloudflare R2 for files and fonts; SendGrid for email; and the worker's image as the Records container.

## Considered Options

- **Keep the CDK code, undeployed (ADR 0026's choice):** rejected. Nothing can deploy it, and code that is never run drifts from the app while it still looks like a working path to production.
- **Also remove the runtime adapters written for AWS:** deferred. These are the SES mail transport, the KMS seal signer (ADR 0023's production seal), Secrets Manager passwords, the RDS CA bundle and the "refused on ECS" checks. Where production's seal key and secrets live is the owner's decision on RP-1215, so RP-1230 removes or replaces them once that is made. `@aws-sdk/client-s3` stays whatever is decided: it is how the api and worker talk to R2, which speaks the S3 API.

## Consequences

ADR 0005 (two independent Instances, one in KSA) still stands. Where production and the KSA Instance run is the open Decide ticket RP-1215. Choosing AWS there would mean writing infrastructure code again; the old code stays in git history only (before RP-1214). The product owner deletes by hand the GitHub variables the retired AWS workflows used and the `dev` environment. Older ADRs that describe AWS (0005, 0010, 0011, 0023, 0026) are left as they were written.
