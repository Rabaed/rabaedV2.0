# Parallel Claude Code sessions (lanes)

Four lanes. **main** plans; **A, B and C** implement. Each implementing session works on **one ticket** in its **own app-made worktree**, so the desktop app binds its PR and sends CI / PR notifications.

| Lane | Session | Job | Tickets | `pnpm lane:env N` | Web |
|---|---|---|---|---|---|
| 1 | **main** | Planning only: grilling, `/to-spec`, `/to-tickets`, questions, design prompts. No implementation. | — | 1 (only if you want to run the app) | lane1.localhost:3100 |
| 2 | **Agent A** | Walking skeleton | RP-186 → RP-196 (spec RP-185) | 2 | lane2.localhost:3200 |
| 3 | **Agent B** | Design system in code | RP-198 → RP-206 (spec RP-197) | 3 | lane3.localhost:3300 |
| 4 | **Agent C** | AWS dev environment | RP-208 → RP-213 (spec RP-207) | 4 | lane4.localhost:3400 |

Lane `n` has its own Postgres (5432+100n), api (4000+100n), web (3000+100n) and Docker Compose project `rabaed-laneN`. See "Several worktrees at once" in the README.

## How to start every implementing ticket

1. In the Claude desktop app → Code tab → **new session** on `G:\Rabaed Contech` with the **worktree** option on (the app creates the worktree and branch). Never start an implementing session in the main folder, and never run `git worktree add` by hand for it — the app wouldn't see the PR.
2. Name it `Agent X – RP-nnn`.
3. First message:
   ```
   Lane N. Run `pnpm lane:env N --force`, then /mattpocock-skills:implement RP-nnn
   ```
4. When the PR opens, it appears in that session's PR bar: turn on **Auto-fix**. CI failures, merge conflicts and review comments will wake that session.
5. After the PR merges, archive the session. The next ticket gets a fresh session (this replaces `/clear`).

## Status (2026-09-28)

| Lane | Done | Open PR | Next ticket(s) that can start now |
|---|---|---|---|
| A | RP-186, 187, 188, 189, 190 | — | **RP-191** Trades, Locations and Visibility grants |
| B | RP-198, 199 | #10 RP-200 (fonts, digits, DocNo, Icon) | **RP-201, RP-202, RP-203** (only need RP-198; can run as three parallel B sessions). RP-204 waits for RP-200. |
| C | RP-208 | #11 RP-209 (first deploy) | none until #11 merges → then RP-210 |

## Order and cross-lane dependencies

```
A: 186 → 187 → 188 → 189 → 190 → 191 → 192 → 193 → ┬ 194 ┬→ 196
                                                     └ 195 ┘
B: 198 → ┬ 199
         ├ 200 → 204 ┐
         ├ 201       ├→ 205
         ├ 202       │
         └ 203 ──────┴→ 206 (also needs 200)
C: 208 → 209 → 210 → ┬ 211 (also needs B's 200)
                     └ 212
         209 ────────→ 213 (also needs A's 196)
```

## Rules that keep lanes from colliding

1. One ticket = one app-made worktree session = one branch named with the key (`RP-191-...`) = one PR.
2. Assign the Jira ticket before starting; start only tickets whose blockers are Done.
3. Stay in your lane's folders: A owns `apps/*` and `packages/db|domain`; B owns `packages/ui` and Storybook; C owns the CDK package and deploy workflow. Shared root files (root package.json, lockfile, CI workflow) change in small PRs of their own.
4. Migrations are timestamp-named.
5. Merge only through a PR with green CI (both visibility suites must pass). Merge `main` into your branch when it moves; use `/resolving-merge-conflicts` if needed.
6. main never commits while an implementing session has the main folder checked out on another branch.
7. Parallel sessions multiply usage — close finished sessions.
