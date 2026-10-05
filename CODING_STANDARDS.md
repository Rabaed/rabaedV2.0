# Coding standards

The rules `/code-review` checks a diff against, besides `CLAUDE.md`'s Rules. Most of them come from defects that reached `main` once (the ticket is named); the rest guard the same boundaries. For the full reasoning, follow the pointer.

A line marked **(checked)** is enforced by lint, a test or CI; review spends its attention on the rest.

## Visibility

Visibility is the top requirement (`docs/visibility.md`). Check every read path against its **layers** and its **leak-channel table**.

- **Hidden means not found.** A Member asking for anything they may not see gets a 404 whose body names nothing, identical to a made-up id. Check permission **before** existence, so 403 vs 404 never reveals that something exists (RP-233). In routes, `idOrNotFound` turns a malformed id into that 404, and `visibleOrNotFound` turns a read that returns nothing (hidden or absent) into the same 404. In seam-1 tests, assert with `expectHidden`, which checks status and body.
- **One answer for every refusal.** A refusal that crosses Companies gives the same response whatever the reason, such as `next_step_unavailable` for a Gap, an Overlap or an empty pool. Narrow, documented exceptions only: V17 says "registered with another Company", never which one.
- **Another Company appears by name only,** as the leak-channel rows for history and Form answers require. The display, the API payload and the database read all show that Company's name, never its people.
- **Answers are read through the stripping function** (ADR 0012). The app role never reads `work_item.data` directly. A new field type that stores an id adds its strip rule to that function, plus a seam-2 test showing another Company can't read the id.
- **Side channels follow the same rule.** Check visibility before taking a lock, giving validation detail, or returning anything derived from hidden rows: a stored sequence number, a hash, a count, list membership, or a state that differs by whether a Company is on Rabaed. Number and count only what the viewer sees (RP-193, RP-239, RP-224, RP-275).
- **Every channel applies the same layers:** lists, counts, search, history, notifications, file links, logs, exports. A new channel adds a row to the leak-channel table and a scenario to the matrix.

## Database

- **Row-level security on every Project table,** keyed by `project_id`, with a seam-2 test that Project B's rows never return to a Member of Project A.
- **Grant the app role only what every Member who sees the row may read.** `work_item` is read through column grants, and a new column joins that list only when it passes that test. A whole-table grant (e.g. `work_item_scope`) states its reason in the migration. (checked for `work_item`: seam-2 `grants.test.ts`)
- **Every `security definer` function pins `set search_path = pg_catalog, public`,** re-checks the caller's access (e.g. `app.sees_work_item`), and is granted only to the role that needs it. (search_path checked by a seam-2 test)
- **No function in `app` is executable by PUBLIC.** A new function revokes the default grant and grants EXECUTE to the roles that call it. (checked: seam-2 `grants.test.ts`, with a commented allow-list; seam-2 `function-grants.test.ts` also fails on a role granted EXECUTE outside the function's allow-list)
- **Migrations already on `main` stay byte-for-byte as they are.** A change is a new, timestamp-named migration. (checked: CI `migrations immutable`)
- **A function, view or policy redefined on both sides of a merge ends with one body that has both changes.** Migrations run in name order, so the later-sorting `create or replace` wins and git won't flag it (RP-311 lost its `app.take_transition` this way); one with another argument list leaves a stale overload beside main's (RP-312). The check's message says how to fix what it names. (checked: CI `migration drift and timestamps`, `scripts/check-migration-drift.ts`)
- **One transaction per save, a lock per check-then-write.** A save that writes several rows is one transaction. When a check and the write that depends on it could be split by another request, lock the checked thing first, a row or an advisory lock (RP-191, RP-252).
- **The audit trail is append-only:** `work_item_event` is insert-only with its hash chain, and every Rabaed Engineer action writes `admin_action` with a reason.

## Logging and errors

- **Log database errors by class and code only** (checked: `rabaed/no-raw-error-logging`), following `failureOf` (outbox) and the worker's logger. Database messages can quote row values such as titles and names (RP-238).
- **User-facing errors and logs never include another item's title, number or Company.**

## UI (`packages/ui/README.md`)

- **Use the shared piece, not a copy:** `@rabaed/ui` components (`AgeDots`, `StagePill`, `WithChip`, form controls inside `Field`, …), its `focusRing` and tone helpers, and the shared test fixtures under each package's `test/support/` (RP-237, RP-289).
- **Landmarks and labels:** every page has its landmarks, and every group of controls has a visible or accessible label.
- Design tokens and logical CSS (checked: `rabaed/no-hardcoded-colour`, `rabaed/no-physical-direction`).

## Domain language

- **Use `GLOSSARY.md` terms** in identifiers, UI strings and docs, e.g. Subject (not title), Participant, Visibility, Internal Note. A term on a glossary entry's _Avoid_ list is a finding (e.g. `Coverage` for Visibility, RP-240).

## Tests

- **Test behaviour from outside,** at the agreed seams (seam 1 API, seam 2 database, pure domain modules, UI stories, infra assertions). A visibility rule ships with its scenario test.
- **Derive the list under test from the source** (every template, icon, Form Version), so a new one can't be left out, and give each test its own setup.
- **A rule enforced in SQL and in TypeScript has one definition per layer,** both tested against the same cases. A rule shared by api and web lives once in `@rabaed/domain`.

## Docs

- **A change to a table, a database function or an error code updates its design doc in the same PR:** `docs/data-model.md`, `docs/workflow-engine.md` or `docs/form-engine.md`.
