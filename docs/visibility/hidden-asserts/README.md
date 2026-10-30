# Hidden-from asserts that can pass falsely

Visibility asserts in the seam test files (`apps/api/test/`, `packages/db/test/`) that could pass falsely, as of RP-1095 (2026-10-30). Each test file has its own list here, at the test file's path plus `.txt` (`apps/api/test/chat.test.ts` → `apps/api/test/chat.test.ts.txt`), so parallel PRs edit different files (RP-1134).

One assert a line, keyed `<kind> <titles> :: <line>`:

- `empty`: a "hidden" assert that an empty read passes (`toEqual([])`, `toHaveLength(0)`, `not.toContain`, `toBeUndefined()`, `expectHidden`) outside `expectHiddenFrom`;
- `text`: a compare by a `legalName`, a `name.en` or a length;
- `<titles>`: the `describe` / `it` titles around the assert, joined with ` > ` (`(top level)` outside any);
- `<line>`: the text of the assert's line, spaces collapsed.

No line numbers, so an edit elsewhere in the file doesn't break the check. Two identical asserts in one test are two identical lines, matched by count. An assert split over lines is keyed by the line that matches (`).toEqual([]);`, say), so it is weaker; renaming a test or editing an assert's line changes its key, and the old entry then fails as stale and the new one as unlisted. Not all are visibility asserts; an audit found about 280 that are.

The lists only shrink: `scripts/check-hidden-asserts.ts` fails on an assert that isn't listed, even in a file that also has a fix, and on an entry with no assert left. When you fix an assert, delete its line; when a file's last line goes, delete the file. A new hidden-from assert uses `expectHiddenFrom`; a line that is no visibility assert is marked `// not hidden-from: <why>`.
