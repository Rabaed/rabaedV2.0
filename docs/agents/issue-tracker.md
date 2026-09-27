# Issue tracker: Jira

Issues and specs for this repo live in **Jira**, project **RP** ("Rabaed Platform") on **https://rabaedsa.atlassian.net** (cloudId `984af652-6673-4feb-be7a-8e261a7da2eb`). Code lives in GitHub **Rabaed/rabaedV2.0**. GitHub Issues are not used.

Use the Atlassian MCP tools (`createJiraIssue`, `editJiraIssue`, `getJiraIssue`, `searchJiraIssuesUsingJql`, `addOrEditJiraIssueComment`, `transitionJiraIssue`, and `discover` + `executeRead`/`executeWrite` for anything else, such as issue links). Always pass the cloudId above.

## Conventions

- **Hierarchy**: Epic → Story / Task / Bug. Every Story or Task has an Epic as `parent`. The first epics come from `planning/backlog.py` (one per plan epic, labelled with its phase, e.g. `phase-1-foundations`).
- **Create an issue**: `createJiraIssue` with `projectKey: "RP"`, `issueType`, `summary`, markdown `description`, `parent` (the Epic key), `labels`.
- **Read an issue**: `getJiraIssue` with `view: "evidence"` (includes links); comments via `listJiraIssueComments`.
- **List issues**: `searchJiraIssuesUsingJql`, e.g. `project = RP AND labels = ready-for-agent AND statusCategory != Done ORDER BY rank`.
- **Comment**: `addOrEditJiraIssueComment`.
- **Labels**: edit the `labels` field with `editJiraIssue` (add/remove the triage labels in `docs/agents/triage-labels.md`).
- **Close**: `transitionJiraIssue` to a Done-category status, with a comment saying why.
- **Blocking edges**: Jira issue links of type **"Blocks"** (blocker *blocks* blocked). A ticket is unblocked when every issue that blocks it is Done.
- **Specs** (`/to-spec`): one Jira issue (type Task, label `spec`) under the Epic, holding the spec in its description; tickets from `/to-tickets` are Stories under the same Epic that link back to the spec.
- **Code ↔ ticket**: branch names and commit messages start with the key, e.g. `RP-42-project-rls`; PRs in GitHub mention the key.

## When a skill says "publish to the issue tracker"

Create a Jira issue in RP as above.

## When a skill says "fetch the relevant ticket"

`getJiraIssue` with the RP key (e.g. `RP-42`), `view: "evidence"`, plus its comments.

## Wayfinding operations

Used by `/wayfinder`.

- **Map**: one Epic labelled `wayfinder-map`, whose description holds Notes / Decisions-so-far / Fog.
- **Child ticket**: a Task under that Epic, labelled `wayfinder-research` / `wayfinder-prototype` / `wayfinder-grilling` / `wayfinder-task`.
- **Blocking**: Jira "Blocks" links.
- **Frontier query**: `project = RP AND parent = <map> AND statusCategory != Done AND assignee is EMPTY`, then drop any issue with an open blocker; first by rank wins.
- **Claim**: assign it to the driving dev (first write of the session).
- **Resolve**: comment the answer, transition to Done, and append a pointer to the map's Decisions-so-far.
