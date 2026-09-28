# Five parallel Claude Code sessions

The walking skeleton (RP-186 → RP-196) is a chain: each ticket builds on the previous one, and only RP-194 and RP-195 can run side by side. Five sessions can't all implement it at once. Instead, run **five lanes**, each owning a different part of the repo.

## Wave 1: now, while RP-186 is being built

| Lane | Session does | Skill route | Writes to |
|---|---|---|---|
| **1. Skeleton** | Implement RP-186, then RP-187 … in order | `/implement RP-186`, `/clear`, `/implement RP-187` … | the whole monorepo (owner of the base) |
| **2. Design system in code** | Spec + tickets for tokens, shadcn/ui components, AgeDots, StagePill, CodeBadge, `.docno`, RTL, Storybook (Epic RP-10) | `/to-spec` → `/to-tickets` (planning only until RP-186 merges) | Jira only |
| **3. AWS dev environment** | Spec + tickets for IaC, dev environment, CI deploy (Epic RP-12) | `/to-spec` → `/to-tickets`, then `/wizard` for the AWS account steps you must do | Jira only, then `infra/` |
| **4. Engine cores** | Spec + tickets for the pure logic that needs no database: Form schema validation, the shared condition evaluator, Transition guard rules (Epics RP-18, RP-20) | `/to-spec` → `/to-tickets` | Jira only |
| **5. Design (Claude Design)** | Paste change requests and design prompts; write the next prompts (Project Settings, Inspections, Drawings…) | normal chat + `/grill-with-docs` when decisions come up | `design/` only |

## Wave 2: after RP-186 is merged to `main`

Lanes 2–4 switch from planning to `/implement`, each on its own tickets:

- **Lane 1:** RP-187 → RP-193, then RP-194 and RP-195 (these two can be split across two sessions), then RP-196.
- **Lane 2:** design-system tickets (owns the `web` UI components folder and the Storybook setup).
- **Lane 3:** AWS tickets (owns `infra/` and the deploy workflow).
- **Lane 4:** engine-core tickets (owns its folders inside the `domain` package; no database).
- **Lane 5:** keeps designing; later runs `/prototype` for UI questions.

## Rules that keep parallel lanes from colliding

1. **One worktree and one branch per session.** Never run two sessions in the same folder.
2. **Branch name starts with the ticket key**, e.g. `RP-187-company-onboarding`. One ticket per branch, one PR per ticket.
3. **Claim before starting:** assign the Jira ticket to yourself (the `/implement` session can do it) so no two sessions take the same ticket.
4. **Only start a ticket whose blockers are Done** in Jira.
5. **Stay in your lane's folders.** Shared files (root package.json, lockfile, CI workflow) are changed only by Lane 1 or in a small PR of their own.
6. **Database migrations** are named with a timestamp so two lanes never pick the same number.
7. **Merge to `main` through a PR with green CI** (the visibility suites must pass). Pull `main` into your branch often; use `/resolving-merge-conflicts` if needed.
8. **`/clear` between tickets** in the same session; each ticket is self-contained.
9. Five sessions use five times the usage. Pause planning lanes when they're done rather than letting them idle.
