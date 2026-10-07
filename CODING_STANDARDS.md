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
- **A hidden value stays out of everything derived from it.** When a viewer may not see a value, it is also absent from the filters, sort keys and cursors that use it, and from its other reads (the item detail, the Kanban, exports). Hiding a List column is not enough: in RP-348 a Draft's start time still reached another Company through `stepEnteredAt`, the `stepAgeMin` filter, the Step Age cursor and the item detail.
- **A hidden value is hidden in every column it was copied into.** When a value is hidden, find every column the writing function copies it into, and hide each one: `create_work_item`'s `v_at` is the Draft's start time, and also `step_assignment.claimed_at`/`created_at` and `work_item_access.since` (RP-309). A table whose row policy asks only whether the caller sees the item gives every column the app role reads to every Participant who sees it. (checked: seam-2 `item-visibility-tables.test.ts`, with a reviewed allow-list)
- **Every channel applies the same layers:** lists, counts, search, history, notifications, file links, logs, exports. A new channel adds a row to the leak-channel table and a scenario to the matrix. (checked: unit `scripts/check-leak-channels.test.ts`, for every notification and outbox kind)
- **A new scenario's ID comes from its ticket key** (`RP-412-1`, `RP-412-2`), never "the next number": two branches both took 51, and 57/58, and `main` once held two rows 27–31 cited by different tests (RP-397). (checked: unit `scripts/check-scenario-ids.test.ts`: unique IDs, no plain number above 81, every cited scenario exists)

## Database

- **Row-level security on every Project table,** keyed by `project_id`, with a seam-2 test that Project B's rows never return to a Member of Project A.
- **Grant the app role only what every Member who sees the row may read.** `work_item` is read through column grants, and a new column joins that list only when it passes that test. A whole-table grant (e.g. `work_item_scope`) states its reason in the migration. (checked for `work_item`: seam-2 `grants.test.ts`)
- **Every `security definer` function pins `set search_path = pg_catalog, public`,** re-checks the caller's access (e.g. `app.sees_work_item`), and is granted only to the role that needs it. (search_path checked by a seam-2 test; the access re-check, for a function the app role may run that takes a work-item id, by seam-2 `definer-access.test.ts`, with a commented allow-list)
- **Every `security definer` function is `language plpgsql`,** never `language sql`. PostgreSQL never inlines a sql function that is security definer or sets `search_path`, and on PostgreSQL 16 keeps its plan only while one calling query runs, so every query plans it again, nested helpers included; plpgsql keeps its plans for the session (RP-310: `app.can_save_answers` 24 ms → 0.8 ms). Write a one-query helper as `begin return (<query>); end` or `return query <query>`, and `#variable_conflict use_column`, so a name that is both a column and a parameter or output column means the column, as it does in sql. Plain sql stays for small invoker helpers that can be inlined, such as `app.current_member_id`. (checked: seam-2 `definer-language.test.ts`)
- **No function in `app` is executable by PUBLIC.** A new function revokes the default grant and grants EXECUTE to the roles that call it. (checked: seam-2 `grants.test.ts`, with a commented allow-list; seam-2 `function-grants.test.ts` also fails on a role granted EXECUTE outside the function's allow-list)
- **Migrations already on `main` stay byte-for-byte as they are.** A change is a new, timestamp-named migration that sorts after every migration on `main`; the check names the file and `main`'s latest migration. (checked: CI `migrations immutable`)
- **A migration that re-defines a function starts from that function's latest definition on `main` after the last merge of `main`; review diffs each re-defined function against it.** A copy made before `main` moved on brings back an outdated body, or a second signature beside the current one that stays executable with its old body and grants (RP-311's `app.take_transition`). Judgement for review; the checks below catch part of it. (checked in part: CI `migrations immutable` for order, CI `migration drift and timestamps` for a function redefined on both sides, seam-2 `function-grants.test.ts` for a second signature)
- **A function, view or policy redefined on both sides of a merge ends with one body that has both changes.** Migrations run in name order, so the later-sorting `create or replace` wins and git won't flag it (RP-311 lost its `app.take_transition` this way); one with another argument list leaves a stale overload beside main's (RP-312). The check's message says how to fix what it names. (checked: CI `migration drift and timestamps`, `scripts/check-migration-drift.ts`)
- **A function redefined again by a later ticket of the same branch or spec gets its copied block extracted first.** When a migration redefines a function that an earlier migration of the branch or spec already redefined, a block copied between its branches becomes a helper (plpgsql, no grant to the app role unless the app calls it), and the redefinition calls it. Spec RP-361 copied the per-recipient block of `app.deliver_notification` four times; see the helpers in `packages/db/migrations/20261216100000_notification_helpers.sql`.
- **One transaction per save, a lock per check-then-write.** A save that writes several rows is one transaction. When a check and the write that depends on it could be split by another request, lock the checked thing first, a row or an advisory lock (RP-191, RP-252).
- **The audit trail is append-only:** `work_item_event` is insert-only with its hash chain, and every Rabaed Engineer action writes `admin_action` with a reason.

## Logging and errors

- **Log database errors by class and code only** (checked: `rabaed/no-raw-error-logging`), following `failureOf` (outbox) and the worker's logger. Database messages can quote row values such as titles and names (RP-238).
- **User-facing errors and logs never include another item's title, number or Company.**
- **An error or log line names a resource, never its AWS ARN or account id:** "the secret", not its ARN (checked: `rabaed/no-aws-ids-in-errors`, on string and template literals in thrown errors, `Error(…)` or `XxxError(…)` with or without `new`, and log or console calls, not tests; a phone number such as `+9665…` is not an account id).

## UI (`packages/ui/README.md`)

- **Use the shared piece, not a copy:** `@rabaed/ui` components (`AgeDots`, `StagePill`, `WithChip`, form controls inside `Field`, …), its `focusRing` and tone helpers, and the shared test fixtures under each package's `test/support/` (RP-237, RP-289).
- **Landmarks and labels:** every page has its landmarks, and every group of controls has a visible or accessible label.
- Design tokens and logical CSS (checked: `rabaed/no-hardcoded-colour`, `rabaed/no-physical-direction`).
- **Dates and numbers are formatted through `formatDate` and `formatNumber`** (`@rabaed/domain` locale module), so Arabic shows Latin digits and Saudi time. No `new Intl.*(…)` or `toLocale*String` elsewhere unless its locale is `intlLocaleOf(…)` (checked: `rabaed/locale-through-helpers`; a place that only parses or reads the clock says so in a commented `eslint-disable`).
- **Bidi isolates and marks (U+2066 to U+2069, U+200E, U+200F, U+202A to U+202E) are written as `\u` escapes,** never pasted in as invisible characters (checked: `rabaed/no-raw-bidi` in TS, TSX and message files; `eslint --fix` rewrites them).
- **A component that uses hooks or event handlers starts with `"use client"`** (checked: `rabaed/use-client-directive`; RP-362).
- **A page matches its design, judged by looking at the whole page.** A UI ticket names its reference screen in `design/reference/claude-design/` (or the design request it waits for); its PR attaches full-page screenshots at 1366 and 1920 wide, in English and Arabic, beside the reference, plus 820 and 402 once the tablet and phone designs exist (RP-422). Review compares them: a clipped table, a squeezed card or a page that scrolls sideways is a finding even when every test passes. The product owner approves the first PR of each page template (Epic RP-405); the 2026-10-07 audit found pages built to pass tests that looked like a demo next to the kit.
- **Until a page has its tablet and phone design, it at least doesn't break:** no page-level horizontal scroll at any width; tables and the Kanban scroll inside their own labelled region; the sidebar opens as a drawer below `lg`.

## Domain language

- **Use `GLOSSARY.md` terms** in identifiers, UI strings and docs, e.g. Subject (not title), Participant, Visibility, Internal Note. A term on a glossary entry's _Avoid_ list is a finding (e.g. `Coverage` for Visibility, RP-240). (checked: `rabaed/no-avoid-terms` and `json-no-avoid-terms` read the _Avoid_ lines of `GLOSSARY.md`. **Names** — identifiers, JSX attribute names, message keys, and code strings such as SQL, class lists and error, log or console text — may keep a word only where an established code name exists, such as `title` for the Subject. **Copy** — other strings that read as words, JSX text and `messages/*.json` values — allows a word only inside a narrow phrase, such as "user agent", or a message allowed by its key; each exception says why, in `avoid-rules.ts`. Tests, stories, infra and the other paths `eslint.config.js` lists are not checked, and comments and docs stay with the reviewer)

## Tests

- **Test behaviour from outside,** at the agreed seams (seam 1 API, seam 2 database, pure domain modules, UI stories, infra assertions). A visibility rule ships with its scenario test.
- **Derive the list under test from the source** (every template, icon, Form Version), so a new one can't be left out, and give each test its own setup.
- **A rule enforced in SQL and in TypeScript has one definition per layer,** both tested against the same cases. A rule shared by api and web lives once in `@rabaed/domain`.

## Docs

- **A change to a table, a database function or an error code updates its design doc in the same PR:** `docs/data-model.md`, `docs/workflow-engine.md` or `docs/form-engine.md`.
- **A design decision reaches the design docs through the PR that builds it.** A grilling or planning session records the decision in a new ADR and in the tickets, and never edits `docs/data-model.md`, `docs/workflow-engine.md`, `docs/form-engine.md` or `docs/visibility.md` directly; a decision that builds nothing gets a small docs-only ticket. Direct edits collided with lanes changing the same rows, and inserted a second scenario 27–31.
- **Only the planning session edits this file.** A lane's PR that changes `CODING_STANDARDS.md` is a finding: the ticket names the line, and the planning session adds it, and its "(checked: …)" mark once the check is on `main`. Four of the last 60 merges conflicted here, all retro work from parallel lanes.
