# Parallel Claude Code sessions (lanes)

Four lanes. **main** plans; **A, B and C** implement. Each implementing session works on **one ticket** in its **own app-made worktree**, so the desktop app binds its PR and sends CI / PR notifications.

| Lane | Session | Job | `pnpm lane:env N` | Web |
|---|---|---|---|---|
| 1 | **main** | Planning only: grilling, `/to-spec`, `/to-tickets`, reviews, questions, design prompts. It edits docs in its own worktree, never in the main folder. | 1 (only to run the app) | lane1.localhost:3100 |
| 2 | **Agent A** | Implements tickets labelled `lane-a` | 2 | lane2.localhost:3200 |
| 3 | **Agent B** | Implements tickets labelled `lane-b` | 3 | lane3.localhost:3300 |
| 4 | **Agent C** | Implements tickets labelled `lane-c` | 4 | lane4.localhost:3400 |

Each lane has its own ports, database and Docker Compose project: see "Several worktrees at once" in the README.

**Which ticket is next** comes from Jira, not this file: a lane's frontier is its `lane-x` tickets that are `ready-for-agent` and have every "Blocks" blocker Done. The ticket gives a suggested model (Opus or Sonnet). To list a lane's open tickets:

```
project = RP AND labels = lane-a AND labels = ready-for-agent AND statusCategory != Done ORDER BY rank
```

A lane takes work in one of two ways: **one ticket per session** (below), or **a whole spec in one session** with `/implement-spec`.

## How to start every implementing ticket

1. In the Claude desktop app → Code tab → **new session** on `G:\Rabaed Contech` with the **worktree** option on (the app creates the worktree and branch). Never start an implementing session in the main folder, and never run `git worktree add` by hand for it — the app wouldn't see the PR.
2. Name it `Agent X – RP-nnn`.
3. First message:
   ```
   Lane N. Run `pnpm lane:env N --force`, then /mattpocock-skills:implement RP-nnn
   ```
   `lane:env` refuses a lane whose ports are taken, or whose compose project (`rabaed-laneN`) another worktree still uses, and names the container holding it. Add `--free` to take the next free lane instead, or run `pnpm lanes:prune` (below) first.
4. When the PR opens, it appears in that session's PR bar: turn on **Auto-fix**. CI failures, merge conflicts and review comments will wake that session.
5. After the PR merges, run `/mattpocock-skills:retro` in that session (see below), then archive it. The next ticket gets a fresh session (this replaces `/clear`).

## Pruning old lanes

Every worktree that ran `pnpm dev` leaves a `rabaed-*` Docker Compose project behind (its containers, database volume and network), holding its lane's ports. `pnpm lanes:prune` lists those whose worktree no longer exists, that are not running, or that only have volumes left, and removes them with their volumes after you confirm (`--yes` skips the prompt). It never removes the current worktree's project. Run it from the planning session after archiving finished sessions, or in a lane when `lane:env` says a lane is taken.

## A whole spec in one session (`/implement-spec`)

Use it when a spec's tickets form a chain that one lane would otherwise work through one session at a time (e.g. RP-290 → RP-294 under spec RP-289). Implementer subagents build the ready tickets in parallel, each in its own worktree, and merge them onto one **integration branch**; one `/code-review` runs over the whole branch at the end, which counts as the spec's epic review.

1. Start the session as in step 1 above, named `Agent X – RP-nnn (spec)`, with the spec's key.
2. First message:
   ```
   Lane N. Run `pnpm lane:env N --force`, then /mattpocock-skills:implement-spec RP-nnn. Name the integration branch RP-nnn-<spec-name> and open its draft PR after the first merge.
   ```
3. Label every ticket of the spec with this lane, so no other lane starts one of them.
4. The subagents share the lane's Postgres, but each uses its own databases. In its worktree, each implementer subagent runs `pnpm lane:env N --force --db rp<n>` (`<n>` is its ticket number, e.g. `--db rp322`). The three database URLs then name `rabaed_rp<n>`, so its seam suites use `rabaed_rp<n>_test`, and parallel seam suites never migrate the same database. `lane:env` still refuses a lane whose ports are taken, but a `--db` run in a second worktree of the same lane is allowed. Drop a rerun's `rabaed_rp<n>_test` before seam 1, and when the spec is done run `pnpm lanes:drop-dbs` to list and drop the `rabaed_*` databases of worktrees that no longer exist (`--yes` skips the prompt).
   Migration timestamps: each ticket gets its own day, in the order of the spec's tickets (the first ticket takes `<yyyymmdd>xxxxxx`, the next the following day, and so on), and its migrations use only that range, so parallel migrations never collide. Say the ranges in each subagent's brief. Migrations already on main stay unchanged.
5. Jira's automation closes only the ticket named in the branch, which is the spec. When the PR merges, close the spec's other tickets with `transitionJiraIssue` and a comment naming the PR.
6. Run `/mattpocock-skills:retro`, then archive the session.

## Retro before archiving

`/mattpocock-skills:retro` looks back at the session and suggests changes to the agents' environment, not the code. A mistake that a rule could catch becomes a check (a lint rule, a pre-commit hook or a CI job). A judgement call becomes a line in `CODING_STANDARDS.md`. Each accepted suggestion becomes a `ready-for-agent` Task, as RP-287 did. A new required CI check also has to be added to the `main` ruleset.

## Epic review when a spec is finished

Every ticket already gets a `/code-review` inside `/implement`. When all of a spec's tickets are merged, one more review looks at the whole spec:

- Before the spec's first ticket, tag `main` as `epic-start/<name>`. When running `/to-tickets`, add a review ticket blocked by the spec's last tickets.
- The review runs in a fresh session with no worktree (it only reads): `/mattpocock-skills:code-review since tag epic-start/<name>, only <folders>, against spec RP-nnn`.
- Every confirmed finding becomes a `ready-for-agent` Task under the same Epic, linked to the review ticket. Visibility and security findings are Highest.

## Rules that keep lanes from colliding

1. One ticket = one app-made worktree session = one branch named with the key (`RP-191-...`) = one PR. With `/implement-spec`, one spec = one session = one integration branch named with the spec's key = one PR.
2. Start only tickets whose blockers are Done.
3. When another lane's open ticket touches the same files (the ticket names them), keep your changes to those files in their own commits, and merge `main` right before opening the PR. Shared root files (root `package.json`, lockfile, CI workflows) change in small PRs of their own.
4. Migrations are timestamp-named (and follow `CODING_STANDARDS.md`).
5. Merge only through a PR with green CI (both visibility suites must pass). Merge `main` into your branch when it moves, and resolve any conflicts in that session.
6. Parallel sessions multiply usage — close finished sessions.
