# UAT Round 0 Playwright harness

Runs against the lane 7 demo (`WEB_URL` from the worktree `.env`). It never reads a password: sessions come from `scripts/demo-session.ts` and are kept in `.sessions/` (git-ignored).

## Run

```
node planning/uat/round-0/harness/run.ts --fixtures [--only FX-C2,FX-K1M,FX-OR,FX-OW,FX-SB]
node planning/uat/round-0/harness/run.ts [--part VIS[,SUB]] [--id VIS-01,VIS-02]
```

In Git Bash prefix `MSYS_NO_PATHCONV=1` (it rewrites a `/work-items/...` argument). Results merge into `results/results.json`, fixtures into `results/fixtures.json`, screenshots go to `evidence/<ID>-<n>-<what>.jpg`.

**Down stack, no results (RP-1099).** Before the run, before and after each case, and after each fixture, the harness checks the lane's api (`API_URL`, `GET /health`) and Postgres (`POSTGRES_PORT`) with `scripts/stack-health.ts` (`harness/stack.ts`). If either is down, it prints what is down and stops. Nothing is written for the case or fixture it stopped at; what was written before is kept. An outage that starts and ends inside one case is not seen, so a Fail with 500s or a refused database in its checks still gets a re-run. Report it; don't start or restart Docker yourself. `node scripts/stack-health.ts` runs the same check by hand.

## Write a case

`cases/<PART>.ts` (file name = Part, e.g. `VIS.ts`), one `defineCase` per Test Case id of `test-cases.json`:

```ts
import { pageAs } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { openProject, openList, listRows } from "../harness/helpers.ts";

defineCase("VIS-99", async (t) => {
  const { page } = await pageAs("hafiz", { locale: "en" }); // { phone: true } for 375x812
  const projectId = await openProject(page);
  await openList(page, projectId);
  t.check("Hafiz sees his Draft", (await listRows(page)).some((r) => r.subject.startsWith("UAT VIS-99")));
  await t.shot(page, "list");
});
```

- `t.check(text, ok, detail?)`: one check of the Expected result. Pass = all ok.
- `t.shot(page, what, { fullPage? })`: JPEG, viewport only by default.
- `t.notRun(reason)`, `t.manual(reason)`, `t.blocked(reason)`: a declared status (never a failure).
- A thrown error is `error` (a script problem), never `fail`. A case with no check and no declared status is `error`.
- People: saeed, hafiz, ali, omar, yousef, ahmed, sara, mohammed, faisal, nasser, plus layla, noura, hind (see `people` in `browser.ts`).
- Items you create get a Subject starting `UAT <id>`. Resolve ids from the List (`listRows` gives `href`); the seed's ids change on every reset.

## Helpers (`helpers.ts`)

`Api.as(person)` (get/put/post/transition from inside a signed-in page), `apiStatus(person, path)`, `projectIdOf`, `openProject`, `openList`, `openKanban`, `openModule`, `listRows`, `openItem(page, projectId, numberOrSubject)`, `takeTransition(page, name, { note })` (confirm pop-up, waits for it to close), `readNotFound` / `notFoundFor(person, path)` (the plain 404 page: `data-testid="not-found"`), `mailTo(address)` (Mailpit).

Locators are role and name, scoped to a region. Wait for a dialog to close before the next step.

## Fixtures

`FX-C2`, `FX-K1M`, `FX-OR`, `FX-SB` are applied through the api as the seeded people and are idempotent. `FX-OW` is manual (Rabaed Admin needs the Engineer's password and an emailed code). `FX-SB` makes two Project copies of the MAR Workflow; the Comment only copy is bound to MAR. For the Edit the Form one, call `bindSendBack(api, projectId, "edit_form")` from `fixtures-sb.ts` (and back to `"comment"`).
