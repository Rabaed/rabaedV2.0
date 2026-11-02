---
name: rabaed-implement
description: "Build a Rabaed Jira ticket or a whole spec through the mattpocock implement / implement-spec flow, with Rabaed's PR rules and the implement marker. Use for \"implement RP-nnn\" (one ticket) or \"implement spec RP-nnn\" (a whole spec on an integration branch)."
---

This skill runs the mattpocock plugin's `implement` or `implement-spec` skill (those are user-invoked only, so an agent can't load them itself) and lays Rabaed's rules over it. Where the plugin text and a rule below disagree, the rule below wins (RP-1195 item 9).

## Steps

1. **Pick the mode.** One ticket → `implement`. A spec (the prompt says "spec", or the Jira issue is a spec whose tickets form a task graph) → `implement-spec`. Done when you know the mode and the key `RP-nnn`.

2. **Find the plugin copy.** With the Glob tool (not a shell loop: worktree shells refuse loops and variable paths), match
   `skills/engineering/<mode>/SKILL.md` under `~/.claude/plugins/cache/mattpocock/mattpocock-skills/*/` (`~` is the home folder, e.g. `C:/Users/User`). Several version folders → take the highest by semver, comparing each number as a number (`1.10.0` beats `1.9.2`). None → stop and tell the person to run `pnpm check:doctor`, which reports a plugin that is not enabled. Done when you hold one path.

3. **Read it and follow it step for step**, with the overrides below. Call its skills with the Skill tool: `mattpocock-skills:tdd` for every slice, `mattpocock-skills:code-review` for the review. The plugin folder is read-only: read it, never write into it.

4. **Finish** when every plugin step and every override is done: the PR is open with the marker, the review summary is posted, and the PR is ready for review.

## Rabaed overrides

- **Repo rules first.** Before building, read `planning/parallel-sessions.md`: "How to start every implementing ticket" (one ticket) or "A whole spec in one session" (spec), and "Implementer brief". They own the branch name (`RP-nnn-…`), `pnpm lane:env` (from PowerShell), CLAIMs on RP-603 for shared modules (rule 12), own PRs for root `package.json`, the lockfile and `.github/workflows/*` (rule 3), UI screenshots, Auto-fix and `pnpm queue`.
- **Implement marker.** Open the PR with `gh pr create --body-file <file>` whose body holds the line `<!-- implement: RP-nnn -->`, `RP-nnn` being the ticket's key (one ticket) or the spec's key (integration PR). `review-post` refuses a PR without it. A PR opened earlier without the marker gets it with `gh pr edit <n> --body-file <file>`.
- **One ticket: non-draft.** Open the PR ready for review once the plugin's `/code-review` fixes are committed.
- **Spec: draft until the whole-branch fixes.** Keep the plugin's draft integration PR (step 3). It stays a draft, with no `reviewed` label and no queue command given to anyone, until the whole-branch review's fix commits are pushed and CI has run on them (parallel-sessions.md "A whole spec in one session" step 5, RP-1011). Its body lists every ticket on a `Closes RP-a, RP-b` line.
- **Ready for review.** In place of the plugin's "mark it ready" (implement-spec step 8), write the review summary to a file outside the repo and run `pnpm lane:ready <n> <summary-file>`: it posts the summary with the `code-review` marker and marks the PR ready. Until `lane:ready` is in the root `package.json`, run `node scripts/review-post.ts <n> <summary-file>`, then `gh pr ready <n>` for a draft. CI's `reviewed-add` adds `reviewed`; the label is CI's alone.
- **Closing tickets.** The `jira-close` workflow closes them when the PR merges; that replaces the plugin's "resolve each ticket the way the issue tracker closes work".
