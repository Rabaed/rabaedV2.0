# Parallel Claude Code sessions (lanes)

Four lanes. **main** plans; **A, B and C** implement. Each implementing session works on **one ticket** in its **own app-made worktree**, so the desktop app binds its PR and sends CI / PR notifications.

| Lane | Session | Job | `pnpm lane:env N` | Web |
|---|---|---|---|---|
| 1 | **main** | Planning only: grilling, `/to-spec`, `/to-tickets`, reviews, questions, design prompts. It edits docs in its own worktree, never in the main folder. | 1 (only to run the app) | lane1.localhost:3100 |
| 2 | **Agent A** | Implements tickets labelled `lane-a` | 2 | lane2.localhost:3200 |
| 3 | **Agent B** | Implements tickets labelled `lane-b` | 3 | lane3.localhost:3300 |
| 4 | **Agent C** | Implements tickets labelled `lane-c` | 4 | lane4.localhost:3400 |

Each lane has its own ports, database and Docker Compose project: see "Several worktrees at once" in the README.

**Which ticket is next** comes from Jira, not this file: a lane's frontier is its `lane-x` tickets that are `ready-for-agent` and have every "Blocks" blocker Done. The ticket gives a suggested model (Opus or Sonnet).

## How to start every implementing ticket

1. In the Claude desktop app → Code tab → **new session** on `G:\Rabaed Contech` with the **worktree** option on (the app creates the worktree and branch). Never start an implementing session in the main folder, and never run `git worktree add` by hand for it — the app wouldn't see the PR.
2. Name it `Agent X – RP-nnn`.
3. First message:
   ```
   Lane N. Run `pnpm lane:env N --force`, then /mattpocock-skills:implement RP-nnn
   ```
4. When the PR opens, it appears in that session's PR bar: turn on **Auto-fix**. CI failures, merge conflicts and review comments will wake that session.
5. After the PR merges, archive the session. The next ticket gets a fresh session (this replaces `/clear`).

## Epic review when a spec is finished

Every ticket already gets a `/code-review` inside `/implement`. When all of a spec's tickets are merged, one more review looks at the whole spec:

- Before the spec's first ticket, tag `main` as `epic-start/<name>`. When running `/to-tickets`, add a review ticket blocked by the spec's last tickets.
- The review runs in a fresh session with no worktree (it only reads): `/mattpocock-skills:code-review since tag epic-start/<name>, only <folders>, against spec RP-nnn`.
- Every confirmed finding becomes a `ready-for-agent` Task under the same Epic, linked to the review ticket. Visibility and security findings are Highest.

## Rules that keep lanes from colliding

1. One ticket = one app-made worktree session = one branch named with the key (`RP-191-...`) = one PR.
2. Start only tickets whose blockers are Done.
3. When another lane's open ticket touches the same files (the ticket names them), keep your changes to those files in their own commits, and merge `main` right before opening the PR. Shared root files (root `package.json`, lockfile, CI workflows) change in small PRs of their own.
4. Migrations are timestamp-named (and follow `CODING_STANDARDS.md`).
5. Merge only through a PR with green CI (both visibility suites must pass). Merge `main` into your branch when it moves; use `/resolving-merge-conflicts` if needed.
6. Parallel sessions multiply usage — close finished sessions.
