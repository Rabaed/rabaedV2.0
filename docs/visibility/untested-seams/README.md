# Visibility scenarios with no test at one seam

The gaps on main as of RP-1095 (2026-10-30), one file per ticket, `RP-nnn.txt`, like `docs/visibility/scenarios/` (RP-1134), so parallel PRs edit different files.

One `RP-nnn-n api` (no test in `apps/api/test/`) or `RP-nnn-n db` (no test in `packages/db/test/`) a line. The comment after a line is the start of its Scenario cell.

A test covers a scenario only when the title of an `it(...)` or `test(...)` that runs, or of a `describe(...)` around one, names its ID; a comment or another string doesn't, and neither does a test that never runs (`skip`, `todo`, `skipIf`, `runIf`, no body) (RP-1134).

The list only shrinks: `scripts/check-scenario-seams.ts` fails on a gap that isn't here, and on a line whose test now exists. When you add the test, delete the line; when a file's last line goes, delete the file. Never add a line for a new scenario: write its test at both seams.
