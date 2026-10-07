# Issue tracker: Jira

Issues and specs for this repo live in **Jira**, project **RP** ("Rabaed Platform") on **https://rabaedsa.atlassian.net** (cloudId `984af652-6673-4feb-be7a-8e261a7da2eb`). Code lives in GitHub **Rabaed/rabaedV2.0**. GitHub Issues are not used.

Use the Atlassian MCP tools (`createJiraIssue`, `editJiraIssue`, `getJiraIssue`, `searchJiraIssuesUsingJql`, `addOrEditJiraIssueComment`, `transitionJiraIssue`, and `discover` + `executeRead`/`executeWrite` for anything else, such as issue links). Always pass the cloudId above.

## Conventions

- **Hierarchy**: Epic → Task / Bug (RP has no Story type; plan stories are Tasks). Every Task has an Epic as `parent`. Epics are RP-9 … RP-39. The first epics come from `planning/backlog.py` (one per plan epic, labelled with its phase, e.g. `phase-1-foundations`).
- **Create an issue**: `createJiraIssue` with `projectKey: "RP"`, `issueType`, `summary`, markdown `description`, `parent` (the Epic key), `labels`.
- **Read an issue**: `getJiraIssue` with `view: "evidence"` (includes links); comments via `listJiraIssueComments`.
- **List issues**: `searchJiraIssuesUsingJql`, e.g. `project = RP AND labels = ready-for-agent AND statusCategory != Done ORDER BY rank`. Pass `fields: ["summary","status","labels"]` to check status; ask for `view: "full"` only when you need the descriptions.
- **Comment**: `addOrEditJiraIssueComment`.
- **Labels**: edit the `labels` field with `editJiraIssue` (add/remove the triage labels in `docs/agents/triage-labels.md`).
- **Close**: `transitionJiraIssue` to a Done-category status, with a comment saying why.
- **Blocking edges**: Jira issue links of type **"Blocks"** (blocker *blocks* blocked). A ticket is unblocked when every issue that blocks it is Done.
- **Specs** (`/to-spec`): one Jira issue (type Task, label `spec`) under the Epic, holding the spec in its description; tickets from `/to-tickets` are Tasks under the same Epic that link back to the spec.
- **Code ↔ ticket**: branch names and commit messages start with the key, e.g. `RP-42-project-rls`; PRs in GitHub mention the key.

## Closing on merge (GitHub Actions)

`.github/workflows/jira-close.yml` closes tickets; the Jira Automation rule that used to do it is **retired** (it missed RP-296 and read only the branch key). The user turns that rule off after the first green run of the workflow.

- **On merge** (`pull_request: closed`, merged only): it collects every `RP-nnn` from the head branch name and from `Closes` / `Fixes` / `Resolves` lines in the PR body (`Closes RP-a, RP-b` closes both). A key only mentioned in passing ("see RP-c") and other projects' keys are left alone. Each open ticket moves to a Done-category status through the Jira Cloud REST API, with the comment "Closed by PR #n (merged)". A ticket already Done is skipped. A ticket that can't be closed fails the run.
- **Nightly backstop** (`schedule`, also runnable by hand): the same script over PRs merged in the last 7 days; it closes any of their tickets that are not Done and lists them in the run summary.
- **Known limits**: the sweep closes a ticket again if it was reopened within 7 days of the PR's merge (reopen it after that, or edit the PR body). If the comment fails after the transition, the run goes red but the ticket is already Done, so the sweep does not add the comment.
- **Integration PRs** (`/implement-spec`): write `Closes RP-a, RP-b, …` in the PR body, listing each ticket; a range such as "RP-290 … RP-294" is not expanded.
- **Credentials**: repo secrets `JIRA_EMAIL` and `JIRA_API_TOKEN`, an API token for a bot account that may transition RP issues. Never committed. The workflow has `contents: read` only and runs the script from the default branch, so PR code never meets the token. A pull request from a fork has no secrets, so its run fails visibly.
- **Code**: `scripts/jira-close-keys.ts` (key parsing, unit-tested) and `scripts/jira-close.ts`.

## When a skill says "publish to the issue tracker"

Create a Jira issue in RP as above.

## When a skill says "fetch the relevant ticket"

`getJiraIssue` with the RP key (e.g. `RP-42`), `view: "evidence"`, plus its comments.

## Checks before publishing a spec or tickets

Run these in `/to-spec` and `/to-tickets`, before the issue is created.

- **Spec: glossary.** Check every domain term against the _Avoid_ lists in `GLOSSARY.md`. A clash gets a glossary entry or a different word before the spec is published (RP-299 used "Remarks", which is Avoid for Comment and Internal Note).
- **Ticket: existing code.** Find every function, table or endpoint the ticket calls "existing" or "as today" on `main` with grep. Each one not found gets a "Blocks" link from the ticket that builds it (RP-305 assumed `create_revision`, which RP-103 and RP-316 build).
  - For every event, status, permission or role the ticket relies on, find on `main` the code that **produces** it: inserts the event, sets the status, seeds or grants the permission. A name found only in a check constraint, enum or type list doesn't count. RP-356 hooked the Vacancy notification to the "existing" `vacated` event, which only a check constraint allows and nothing inserts (RP-108 builds it); RP-359 sent the weekly report to Members holding `assign`, which no seeded Position holds.
  - Anything with no producer gets a "Blocks" link from the ticket that builds it, or the ticket says how its tests set it up.
- **Ticket: shared files.** Name the shared modules the ticket changes, e.g. the work item query (`apps/api/src/work-items/query.ts`), so the planning session can keep two lanes off the same module (`planning/parallel-sessions.md`, rule 4). A ticket that changes root `package.json`, `pnpm-lock.yaml` or `.github/workflows/*` says **own PR** (rule 3).

## Wayfinding operations

Used by `/wayfinder`.

- **Map**: one Epic labelled `wayfinder-map`, whose description holds Notes / Decisions-so-far / Fog.
- **Child ticket**: a Task under that Epic, labelled `wayfinder-research` / `wayfinder-prototype` / `wayfinder-grilling` / `wayfinder-task`.
- **Blocking**: Jira "Blocks" links.
- **Frontier query**: `project = RP AND parent = <map> AND statusCategory != Done AND assignee is EMPTY`, then drop any issue with an open blocker; first by rank wins.
- **Claim**: assign it to the driving dev (first write of the session).
- **Resolve**: comment the answer, transition to Done, and append a pointer to the map's Decisions-so-far.
