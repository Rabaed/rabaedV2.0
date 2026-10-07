# UAT browser tests (spike)

Prototype branch `prototype/uat-e2e`: can UAT cases run as Playwright browser tests, with a video per person? One case so far: the Consultant issues Code C.

Run against a running local demo (`pnpm demo` in the repo's main folder; web on lane 1, `http://localhost:3100`):

```
cd apps/web
DEMO_ENV_FILE="<main folder>/.env.demo" npx playwright test -c e2e/playwright.config.ts
```

Videos: `apps/e2e-results/videos/`, one `.webm` per person (browser context). HTML report: `apps/e2e-report/`.

## What the spike showed

- The case runs in about 7 seconds and records one video per person: Mohammed (Consultant Manager) claims, verifies, issues Code C with Remarks; Hafiz (TMC) sees the Code, Remarks and verification; Yousef (Beta Build) gets 404.
- Twice the test's own visibility rule was wrong and the app right (V14: the final Code's signer is named to the other Company; TMC sees its own internal Claim). A UAT test must be written from `docs/visibility.md`, not from memory.
- It uses the seeded `TWR-MAR-01-0003 Rev 1`, so it runs once per seed. A real suite should create its own items (Hafiz → Ali → Consultant) or reset the demo per run.
- **The demo password ends up in test artifacts**: the trace records the typed value and a failure snapshot shows the field's value. Before CI uploads any artifact on this public repo, sign in without typing the password into a traced page (e.g. a setup step that calls the session API and saves a storage state), and keep traces off or scrubbed.
- `pnpm db:reset` under a running demo crashes the api and worker (unhandled pool `error`, 57P01): filed as RP-402.
- `@playwright/test` was added to `apps/web` here only; the real suite decides where it lives (lockfile is a shared root file: own PR).
