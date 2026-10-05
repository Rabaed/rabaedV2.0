# Rabaed v2.0

Rabaed is a B2B construction management platform for KSA (Project Module first; Tendering, Financial and Schedule later).

## Read first

- `GLOSSARY.md`: the glossary. Use its terms; avoid the terms it lists under _Avoid_.
- `docs/visibility.md`: **visibility is the top requirement.** No company may see another company's work beyond these rules. Every feature is checked against it, and its scenarios are automated tests.
- `docs/adr/`, `docs/data-model.md`, `docs/workflow-engine.md`, `docs/form-engine.md`.
- `docs/tech-stack.md`: what Rabaed is built with, and why.
- **Implementing a ticket:** `planning/parallel-sessions.md` (app-made worktree, lane ports, collision rules). When CI fails: `docs/agents/ci-logs.md`.
- `design/`: UI prompts, the Claude Design reference (UI intent only; its mock data is not a visibility test) and review notes.

## Rules

- **No secrets in the repo.** Never commit keys, tokens, passwords, certificates or real customer data. Use environment variables and a secrets manager; commit only `.env.example`. The repo is public.
- Rabaed shows no due dates, deadlines or SLAs: only Step Age (weeks, 1–4+ dots). Never write "overdue".
- Arabic and English from day one, RTL, Latin digits; Document Numbers always left-to-right.
- Do not commit the Thmanyah font files (licence forbids redistribution).

## Agent skills

### Issue tracker

Jira project RP on rabaedsa.atlassian.net via the Atlassian MCP; code in GitHub Rabaed/rabaedV2.0. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix) as Jira labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
