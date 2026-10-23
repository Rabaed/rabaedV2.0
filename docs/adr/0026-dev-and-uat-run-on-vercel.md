# Dev and UAT run on Vercel, with Supabase, R2 and SendGrid

Non-technical product builders need a link to every change and a stable UAT link, without the AWS setup. On 2026-10-22 AWS dev was not running: every `deploy-dev.yml` run stopped because GitHub could not assume the OIDC deploy role. UAT ran on lane 7, a laptop stack shared through a Cloudflare Tunnel. We decided that dev, demo and UAT run on Vercel, holding demo data only. Production and the KSA Instance stay undecided: the product owner means to host production on Vercel too, and that, with residency and SOC 2 sub-processors, gets its own grill with DevOps help. Until then ADR 0005 stands for them.

| Part | Where it runs |
|---|---|
| `apps/web`, `apps/api`, `apps/admin` | Three Vercel projects in Frankfurt (`fra1`). The api is the Fastify app unchanged, not rewritten into Next.js route handlers. Admin is its own project, the only one holding the bypass role's password (ADR 0010) |
| Database | Supabase in Frankfurt, used as plain PostgreSQL 16 only: the Data API off, no Supabase Auth or Storage, the anon and service keys in no project. The apps connect through the transaction pooler (the Member is set per transaction); migrations use a direct connection (they take a session advisory lock) |
| Outbox | Vercel Cron calls the worker's delivery every minute |
| Documental Records | The worker's Docker image (Chromium, veraPDF) on an always-on container in Frankfurt (Railway or Fly.io), with the local signer and a UAT-only test certificate, never KMS. Every UAT Record carries a "UAT" mark |
| Files, Thmanyah fonts | Cloudflare R2 (S3-compatible, so only the endpoint and keys change). The fonts sit in a private bucket read at build time with a read-only key |
| Email | SendGrid from the product owner's authenticated domain, a Mail Send-only key, click and open tracking off (in SendGrid's settings and on every send), so invitation and reset tokens never pass through a tracking redirect |
| Addresses | `*.vercel.app` until UAT ends; then the product owner's domain. Members sign in again after the move. Cookies stay host-only, Secure and SameSite |

- **Deploys:** a GitHub Action on `main` migrates the database, deploys api and Admin, then web, then runs the visibility smoke tests. Vercel's own deploy on `main` is off. Pull requests get Vercel previews automatically, behind Vercel Authentication, only when they add no migration; a migration is seen on UAT after merge.
- **Data:** UAT keeps its data between deploys; a "reset UAT" Action re-seeds the demo by hand. No real customer data goes to any of these services.
- **Access:** the product owner alone holds the Vercel team (Pro) for now. Every environment variable is Sensitive; builders who join later get Vercel's Viewer or Developer role. UAT and Admin are `noindex`.

## Considered Options

- **Wait for AWS dev:** rejected; builders need links now, and the AWS setup needs DevOps help the team doesn't have yet.
- **Neon instead of Supabase:** the product owner chose Supabase. Its extras are switched off, because the Data API would be a second, untested way past our visibility rules.
- **One database per preview (Supabase branching):** deferred; it needs a paid plan and Supabase's own migration format. Taken up if builders need to preview database changes.
- **Records on Vercel functions:** rejected; veraPDF is Java and can't run there, and a Record that skipped its PDF/A validation isn't the product.
- **Microsoft Graph or SMTP through Microsoft 365 for email:** rejected for SendGrid, which the product owner already has: one key, no Azure app registration.

## Consequences

Vercel becomes the only deployed stack: the UAT deploy replaces `deploy-dev.yml` and the `cdk diff` check, which are retired (product owner, 2026-10-23). The AWS CDK code in `packages/infra` stays in the repo, undeployed, so the production grill can still choose AWS. `packages/mailer` gains a SendGrid adapter, and the worker's outbox delivery gains an entry Vercel Cron can call. The seam 2 tests run once against Supabase, to prove the bootstrap creates the roles (the bypass role included) and the RLS policies behave as on RDS. Lane 7 is retired once the product owner's colleague works on the UAT link.
