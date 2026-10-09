# Parallel Claude Code sessions (lanes)

Four lanes. **main** plans; **A, B and C** implement. Each implementing session works on **one ticket** in its **own app-made worktree**, so the desktop app binds its PR and sends CI / PR notifications.

| Lane | Session | Job | `pnpm lane:env N` | Web |
|---|---|---|---|---|
| 1 | **main** | Planning only: grilling, `/to-spec`, `/to-tickets`, reviews, questions, design prompts. It edits docs in its own worktree, never in the main folder. | 1 (only to run the app) | lane1.localhost:3100 |
| 2 | **Agent A** | Implements tickets labelled `lane-a` | 2 | lane2.localhost:3200 |
| 3 | **Agent B** | Implements tickets labelled `lane-b` | 3 | lane3.localhost:3300 |
| 4 | **Agent C** | Implements tickets labelled `lane-c` | 4 | lane4.localhost:3400 |

Each lane has its own ports, database and Docker Compose project: see "Several worktrees at once" in the README.

**Which ticket is next** comes from Jira, not this file: a lane's frontier is its `lane-x` tickets that are `ready-for-agent` and have every "Blocks" blocker Done, and that are not In Progress (an implementer claims a ticket by moving it to In Progress and assigning itself: `docs/agents/issue-tracker.md`, Claim). The ticket gives a suggested model (Opus or Sonnet). To list a lane's open tickets:

```
project = RP AND labels = lane-a AND labels = ready-for-agent AND statusCategory != Done AND status != "In Progress" ORDER BY rank
```

A lane takes work in one of two ways: **one ticket per session** (below), or **a whole spec in one session** with `/implement-spec`.

## How to start every implementing ticket

1. In the Claude desktop app → Code tab → **new session** on `G:\Rabaed Contech` with the **worktree** option on (the app creates the worktree and branch). Never start an implementing session in the main folder, and never run `git worktree add` by hand for it — the app wouldn't see the PR.
   **Session already open on the main folder?** Keep it and recover in place, in this order. The rule above still holds: nothing is implemented in the main folder.
   1. Call the `EnterWorktree` tool, named after the branch. It creates `.claude/worktrees/<name>` from `origin/main`.
   2. Rename the branch to the key's name (`git branch -m RP-nnn-...`), then run `pnpm lane:env N --force`.
   3. After `gh pr create`, link the PR to the session with `bind_pr`, so CI and Auto-fix notifications still arrive.
2. Name it `Agent X – RP-nnn`.
3. First message:
   ```
   Lane N. Run `pnpm lane:env N --force`, then /mattpocock-skills:implement RP-nnn
   ```
   `lane:env` refuses a lane whose ports are taken, or whose compose project (`rabaed-laneN`) another worktree still uses, and names the container holding it. Add `--free` to take the next free lane instead, or run `pnpm lanes:prune` (below) first.
4. When the PR opens, it appears in that session's PR bar: turn on **Auto-fix**. CI failures, merge conflicts and review comments will wake that session. To read a failed job's log without waiting for the rest of the run, see `docs/agents/ci-logs.md`.
   Once CI is green and `/code-review` is done, the session queues its own PR; nobody merges by hand. `gh pr merge` cannot queue it: it tries to turn on auto-merge, which this repository does not allow ("Auto merge is not allowed for this repository"). Queue it with one plain command:
   ```
   pnpm queue <number> --wait
   ```
   It works from any checkout (the main folder, another worktree, a lane): it fetches `origin/main` and the PR's own head (`refs/pull/<number>/head`), and refuses, with the fix, when the PR conflicts with `main` or when a migration shares a timestamp with (or sorts before) one on `main`, all checked on the PR's head, not on HEAD (a warning only, when HEAD is on the PR's branch but behind it); then it queues the PR through the API pinned to `expectedHeadOid` = the PR's head, and prints the position and state. `--wait` then polls every 60 s and exits 0 when the PR merges, or exits 1 with the removal reason when it leaves the queue (or closes). Leave `--wait` off to queue and move on. The raw `enqueuePullRequest` GraphQL call is the fallback only when `pnpm queue` itself cannot run; it skips those checks. (PR #149's CI was green hours before it was queued, and `main` had moved: the queue removed it five times.) `expectedHeadOid` is the commit CI passed on: if the branch has moved since, GitHub refuses to queue it. The merge queue tests the PR on top of the PRs queued ahead of it and merges it only when that run is green, so two PRs that are green alone cannot break `main` together. The queue does not resolve text conflicts, and a PR it removes leaves the queue with its own checks still green. When the queue removes a PR for a failed check, the `queue-drop-comment` workflow comments on the PR with the removal reason and each failing job of the queue's run with up to two lines before its first `##[error]` line (RP-401); that comment is what wakes the session's Auto-fix. A PR removed for a conflict shows the conflict on the PR itself, which Auto-fix watches (GitHub does not run `pull_request` workflows while a PR has a merge conflict, so that comment may never post). A PR a person took out of the queue on purpose gets no comment. The session then merges `main`, pushes and queues the PR again.
5. After the queue merges the PR, run `pnpm worktrees:prune` (see "Pruning old lanes"), then `/mattpocock-skills:retro` in that session (see below), then archive it. The next ticket gets a fresh session (this replaces `/clear`).

## Pruning old lanes

Every worktree that ran `pnpm dev` leaves a `rabaed-*` Docker Compose project behind (its containers, database volume and network), holding its lane's ports. `pnpm lanes:prune` lists those whose worktree no longer exists, that are not running, or that only have volumes left, and removes them with their volumes after you confirm (`--yes` skips the prompt). It never removes the current worktree's project. Run it from the planning session after archiving finished sessions, or in a lane when `lane:env` says a lane is taken. `lane:env` says whether the worktree holding the lane is on a branch already merged into `origin/main`; then `pnpm lanes:prune --merged` also removes the projects of such worktrees, unless a worktree that is not merged names the project in its `.env`. Add `--lane N` (`pnpm lanes:prune --merged --lane 3`) to free only `rabaed-lane3`, with the same confirmation and keep rules; `lane:env` suggests exactly that, so never reach other lanes' databases with a bare `--merged` or a raw `docker compose down`. `pnpm lanes:prune --dry-run` (also with `--merged` or `--lane N`) only lists what it would remove, exits 0 and never prompts or removes.

`pnpm lane:env N --force` does not need a prune to take lane N over from a worktree that is gone, or whose branch is merged into `origin/main` and has no uncommitted changes (RP-500): it removes that project's containers, keeps its volumes (the database), and says which worktree it came from; the next `docker compose up` recreates the containers under the new worktree. A holder that is not merged, has uncommitted changes, is locked by a session that still runs, or is a folder git does not list still refuses, as does a not-merged worktree that has the project in its `.env`. A `--db` run never takes a lane over.

`pnpm worktrees:prune` does the whole clean-up after merges. After `git fetch --prune origin` it lists, and after you confirm (`--yes` skips the prompt) removes:

1. Every worktree merged into `origin/main`, or whose upstream branch is gone, with its compose project, its folder and its branch. Desktop-app worktrees under `.claude/worktrees/` go only when merged into `origin/main`.
2. Every other local branch merged into `origin/main` and checked out in no worktree. It checks with `merge-base --is-ancestor origin/main`, not `git branch -d`, and never deletes `main`.
3. The orphaned compose projects `lanes:prune` finds.

It never touches the main checkout or the current worktree. It skips, and lists, worktrees with uncommitted changes (untracked files outside ignored paths included), commits on no origin branch, a lock by hand, or an open Claude desktop session. A compose project that a kept worktree names in its `.env` stays.

Under the skipped list, both `worktrees:prune` and `worktrees:clean` print a **Stale** section (RP-506): the skipped worktrees whose last commit and newest uncommitted file are both older than `--stale-days <n>` (default 7), oldest first, with the age in days, the branch, the skip reason and, when the lock names a pid, whether that process still runs. It only lists; nothing in it is removed, unlocked or changed. Decide on those by hand (a lock whose pid is not running is a leftover of a closed session).

## A whole spec in one session (`/implement-spec`)

Use it when a spec's tickets form a chain that one lane would otherwise work through one session at a time (e.g. RP-290 → RP-294 under spec RP-289). Implementer subagents build the ready tickets in parallel, each in its own worktree, and merge them onto one **integration branch**; one `/code-review` runs over the whole branch at the end, which counts as the spec's epic review.

1. Start the session as in step 1 above, named `Agent X – RP-nnn (spec)`, with the spec's key. First move the spec issue to **In Progress**; if it already is In Progress, another session owns it: stop. `pnpm lane:env` also refuses a worktree locked by another live `claude session`, even with `--force` (RP-461 was run by two sessions at once).
2. First message:
   ```
   Lane N. Run `pnpm lane:env N --force`, then /mattpocock-skills:implement-spec RP-nnn. Name the integration branch RP-nnn-<spec-name> and open its draft PR after the first merge.
   ```
3. Label every ticket of the spec with this lane, so no other lane starts one of them. A ticket marked **own PR** (it changes root `package.json`, `pnpm-lock.yaml` or `.github/workflows/*`; rule 3) is not merged onto the integration branch: its implementer subagent branches from `origin/main`, and it goes up as a PR of its own (RP-331 had to be reverted off spec RP-327's branch and split into PR #130).
4. The subagents share the lane's Postgres, but each uses its own databases.
   1. In its worktree, each implementer subagent first checks that HEAD is the integration branch's tip, and runs `git reset --hard RP-nnn-<spec-name>` if it isn't: a worktree-isolated subagent starts from `origin/main` (two of seven did on spec RP-361). If the ticket's branch already exists, it stops and reports the worktree it is checked out in (`git worktree list`): a taken branch means another implementer has the ticket (on spec RP-461 one implementer built `RP-451-...-2` beside another session's). Otherwise it branches `RP-nnn-...` from there and runs `pnpm lane:env N --force --db rp<n>` (`<n>` is its ticket number, e.g. `--db rp322`). The three database URLs then name `rabaed_rp<n>`, so its seam suites use `rabaed_rp<n>_test`, and parallel seam suites never migrate the same database.
   2. `lane:env` still refuses a lane whose ports are taken, but a `--db` run in a second worktree of the same lane is allowed. `--db` is only for the implementer subagents of the session that owns the lane. A session whose lane is held by another session's worktree never shares it with `--db`: it takes a free lane (`--free`) or frees one with `pnpm lanes:prune` (RP-334's session was stopped sharing RP-337's lane).
   3. Each seam run recreates its `_test` database itself. A second seam run on the same database while one is going refuses with a message; let the first finish.
   4. When the spec is done, run `pnpm lanes:drop-dbs` to list and drop the `rabaed_*` databases of worktrees that no longer exist (`--yes` skips the prompt). It checks only this clone's worktrees, and keeps any database something is connected to.
   5. Migration timestamps: each ticket gets its own day, in the order of the spec's tickets (the first ticket takes `<yyyymmdd>xxxxxx`, the next the following day, and so on), and its migrations use only that range, so parallel migrations never collide. Say the ranges in each subagent's brief. Migrations already on main stay unchanged.
      - The spec's ticket table also reserves one more day, after its last ticket's, for the epic review's fixes (RP-363's review fixes had no day and took a timestamp main already held).
      - Specs that run at the same time get ranges that don't overlap: before handing out days, read the ticket tables of the other open specs (their spec issues) and take the next free block after every range already handed out. The spec issue's table is where the ranges are recorded; the planning session writes it before the spec starts.
      - Before opening or updating a PR, run `pnpm check:migrations` (rule 10 below) to catch a shared timestamp locally.
5. When the last ticket is merged in and the whole-branch `/code-review` is done, mark the draft integration PR ready (`gh pr ready`) and queue it with `pnpm queue <number> --wait`, as in step 4 of "How to start every implementing ticket": the whole spec goes through the queue as one entry. When the PR merges, the `jira-close` workflow closes every ticket the branch name or a `Closes RP-a, RP-b` line in the PR body names (`docs/agents/issue-tracker.md`), so list each of the spec's tickets in the body.
6. Clean up the subagents' worktrees once the last subagent has finished.
   1. Run `pnpm worktrees:clean --into RP-nnn-<spec-name> --yes` (`--into main` once the PR has merged).
   2. It unlocks and removes every `.claude/worktrees/agent-*` worktree whose commits are all in that branch, with its leftover folder (Windows keeps `node_modules` behind). It deletes each branch that is an ancestor of that branch with `git branch -D` (so `--into <integration branch>` works from the main folder, which has `main` checked out), plus the `worktree-agent-*` branch the app created the worktree on; a branch with commits not in the target is kept and named.
   3. It skips, and lists, worktrees with uncommitted changes or unmerged commits, and worktrees with no commits yet, since their subagent may still be running (another lane's, too: all lanes share `.claude/worktrees/agent-*`). `--include-empty` removes those with no commits yet anyway.
   4. Then run `/mattpocock-skills:retro` and archive the session.
   5. When you stop an implementer yourself, remove only its worktree: `pnpm worktrees:clean --only agent-<id> --yes` (several ids may follow `--only`). It removes the named worktree even with no commits, and leaves other sessions' worktrees unlooked at; hand-run `git worktree remove` and `git branch -D` are refused by auto mode.

## Retro before archiving

`/mattpocock-skills:retro` looks back at the session and suggests changes to the agents' environment, not the code. A mistake that a rule could catch becomes a check (a lint rule, a pre-commit hook or a CI job). A judgement call becomes a line in `CODING_STANDARDS.md`. Each accepted suggestion becomes a `ready-for-agent` Task, as RP-287 did. A new required CI check also has to be added to the `main` ruleset.

Only the planning session edits `CODING_STANDARDS.md` (rule 9 below). A Task that brings a standards line quotes the line; the lane builds only the check, and the planning session adds the line, with its "(checked: …)" mark, in a docs-only PR once the check is on `main`.

## Epic review when a spec is finished

Every ticket already gets a `/code-review` inside `/implement`. When all of a spec's tickets are merged, one more review looks at the whole spec:

- Before the spec's first ticket, tag `main` as `epic-start/<name>`. When running `/to-tickets`, add a review ticket blocked by the spec's last tickets.
- The review runs in a fresh session with no worktree (it only reads): `/mattpocock-skills:code-review since tag epic-start/<name>, only <folders>, against spec RP-nnn`.
- Before filing, list the Epic's open tickets: `/implement-spec`'s own review files follow-ups there too (RP-383 repeated RP-336). A finding already filed gets a comment on that ticket; every other confirmed finding becomes a `ready-for-agent` Task under the same Epic, linked to the review ticket. Visibility and security findings are Highest.

## Rules that keep lanes from colliding

1. One ticket = one app-made worktree session = one branch named with the key (`RP-191-...`) = one PR. With `/implement-spec`, one spec = one session = one integration branch named with the spec's key = one PR.
2. Start only tickets whose blockers are Done.
3. When another lane's open ticket touches the same files (the ticket names them), keep your changes to those files in their own commits, and merge `main` right before opening the PR. Shared root files (root `package.json`, lockfile, CI workflows) change in small PRs of their own: `/to-tickets` marks such a ticket **own PR**, and inside a spec it is built from `main` (step 3 of "A whole spec in one session").
4. Two lanes never run specs that change the same shared module at the same time, such as the work item query (`apps/api/src/work-items/query.ts`). Queue one spec behind the other, or give one of them only the UI. `/to-tickets` names the shared files each ticket touches, so the planning session can see the overlap before it assigns lanes. (RP-362 and RP-363 both reworked the query in parallel, and their merge had 10 conflicted files.)
5. Migrations are timestamp-named (and follow `CODING_STANDARDS.md`).
6. Merge only through the merge queue: queue a PR with green CI (both visibility suites must pass) and a finished `/code-review` with `pnpm queue <number>` (step 4 of "How to start every implementing ticket"; `gh pr merge` cannot queue). Merge `main` into your branch when it moves, and resolve any conflicts in that session. Before pushing the merge, run `pnpm lint && pnpm typecheck` and judge them by exit code, not by filtered output: a branch that adds or tightens a check re-checks the code `main` gained meanwhile, so fix what they find in the merge commit (RP-327's lint rule failed CI twice this way).
7. Parallel sessions multiply usage — close finished sessions.
8. A ticket whose spec is being built by `/implement-spec` (its lane label is set and its spec has an open integration PR) stays under that spec. If it must move, the planning session comments on the integration PR.
9. Docs have owners. Replaying the last 60 merges (2026-10-06), 9 of the 24 conflicted files were docs; the translation catalogues and the packages' `index.ts` files, though changed by nearly every PR, conflicted once or never.
   1. `CODING_STANDARDS.md`: only the planning session edits it (see "Retro before archiving").
   2. `docs/data-model.md`, `docs/workflow-engine.md`, `docs/form-engine.md`, `docs/visibility.md`: the lane writes them for what it builds, in the same PR. A grilling session records its decisions in a new ADR and in tickets, never in these files directly; a decision that builds nothing gets a small docs-only ticket.
   3. A new scenario in the `docs/visibility.md` matrix takes its ID from the ticket key (`RP-412-1`), never the next number (RP-397). When two branches add rows at the end of the table, keep both.
   4. Add a new rule at the end of a numbered list; never renumber, since tickets cite rules by number.
10. Before opening or updating a PR that adds a migration, run `pnpm check:migrations`. It fetches `origin/main` and runs the drift check (redefinitions, stale overloads, shared timestamps) on `origin/main` and `HEAD`, the check CI runs, so a clash shows before the push (RP-363 learned of one only on merge). It needs the network for the fetch. A pre-push hook is optional, not installed.
