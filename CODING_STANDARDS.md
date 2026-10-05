# Coding standards

The rules `/code-review` checks a diff against, besides `CLAUDE.md`'s Rules. Most of them come from defects that reached `main` once (the ticket is named); the rest guard the same boundaries. For the full reasoning, follow the pointer.

## Visibility

Visibility is the top requirement (`docs/visibility.md`). Check every read path against its **layers** and its **leak-channel table**.

- **Hidden means not found.** A Member asking for anything they may not see gets a 404 whose body names nothing, identical to a made-up id. Check permission **before** existence, so 403 vs 404 never reveals that something exists (RP-233). In routes, `idOrNotFound` turns a malformed id into that 404, and `visibleOrNotFound` turns a read that returns nothing (hidden or absent) into the same 404. In seam-1 tests, assert with `expectHidden`, which checks status and body.
- **One answer for every refusal.** A refusal that crosses Companies gives the same response whatever the reason, such as `next_step_unavailable` for a Gap, an Overlap or an empty pool. Narrow, documented exceptions only: V17 says "registered with another Company", never which one.
- **Another Company appears by name only,** as the leak-channel rows for history and Form answers require. The display, the API payload and the database read all show that Company's name, never its people.
- **Answers are read through the stripping function** (ADR 0012). The app role never reads `work_item.data` directly. A new field type that stores an id adds its strip rule to that function, plus a seam-2 test showing another Company can't read the id.
- **Every channel applies the same layers:** lists, counts, search, history, notifications, file links, logs, exports. A new channel adds a row to the leak-channel table and a scenario to the matrix.

## Database

- **Row-level security on every Project table,** keyed by `project_id`, with a seam-2 test that Project B's rows never return to a Member of Project A.
- **Grant the app role only what every Member who sees the row may read.** `work_item` is read through column grants, and a new column joins that list only when it passes that test. A whole-table grant (e.g. `work_item_scope`) states its reason in the migration. (Checked for `work_item`: seam-2 `grants.test.ts` fails on a table-level SELECT, INSERT, UPDATE, DELETE or TRUNCATE grant to the app role.)
- **Every `security definer` function pins `set search_path = pg_catalog, public`,** re-checks the caller's access (e.g. `app.sees_work_item`), and is granted only to the role that needs it. (Checked for `search_path` by seam-2 `definer-search-path.test.ts`.)
- **No function in `app` is executable by PUBLIC.** A new function revokes the default grant and grants EXECUTE to the roles that call it. (Checked by seam-2 `grants.test.ts`, which has a commented allow-list.)
- **Migrations already on `main` stay byte-for-byte as they are.** A change is a new, timestamp-named migration.
- **The audit trail is append-only:** `work_item_event` is insert-only with its hash chain, and every Rabaed Engineer action writes `admin_action` with a reason.

## Logging and errors

- **Log database errors by class and code only,** following `failureOf` (outbox) and the worker's logger. Database messages can quote row values such as titles and names (RP-238).
- **User-facing errors and logs never include another item's title, number or Company.**

## UI (`packages/ui/README.md`)

- **Use `@rabaed/ui` components** (`AgeDots`, `StagePill`, `WithChip`, form controls inside `Field`, …) rather than local copies in an app (RP-237).
- **Design tokens and logical CSS** (`ms-*`, `inline-start`); the lint guard rails enforce this.

## Domain language

- **Use `GLOSSARY.md` terms** in identifiers, UI strings and docs, e.g. Subject (not title), Participant, Visibility, Internal Note. A term on a glossary entry's _Avoid_ list is a finding (e.g. `Coverage` for Visibility, RP-240).

## Tests

- **Test behaviour from outside,** at the agreed seams (seam 1 API, seam 2 database, pure domain modules, UI stories, infra assertions). A visibility rule ships with its scenario test.
