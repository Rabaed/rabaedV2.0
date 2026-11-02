# Building a page from an owner reference

When the product owner gives a reference page for a screen (the anatomy and design files in `D:\Artifacts`, such as `Rabaed Kanban Card Anatomy.html` or `Rabaed Settings Workflows.html`), it decides the UX: the owner's reference outranks the Claude Design kit (`design/reference/claude-design/`), which outranks earlier decisions. `GLOSSARY.md`, `docs/visibility.md` and `CLAUDE.md` Rules still win over any sample (a clash is the designer's mistake: flag it, follow the rule). The owner's files are large (fonts embedded); never commit them.

Only rule-forced deviations are made without asking. Everything else is built as the reference shows, or put to the owner as a question.

## The steps

1. **Reference.** Open the owner's page and say which one the ticket builds from.
2. **Screenshot every view.** Render the page with Playwright to text and full-page screenshots, one for each way the page can look (each tab, open menu, selection, empty page and error). Number them: `screenshot 1`, `screenshot 2`, … The numbers are what the gap table cites.
3. **Gap table.** One row per element of the reference, in the format below. Run `node scripts/check-gap-table.ts <file> --refs <folder with the reference files>`; it must pass before the table goes to the owner.
4. **Owner's answers.** The owner approves the table and answers its `question` rows. The answers go into the table.
5. **Build** to the approved table (`/mattpocock-skills:implement`).
6. **Independent review against the reference.** A reviewer who did not write the table compares the built page with the reference, row by row: screenshots side by side, and **every citation** opened at its source (the CSS selector's rule, the script line, the screenshot, the quoted rule line). A row whose source says something else is a finding, even when the screenshots look alike. The reviewer runs `node scripts/check-gap-table.ts` with `--refs` too.
7. **Owner.** The owner sees the built page beside the reference.

## The gap table

```markdown
| # | Element | Reference source | Built | Verdict | Proposal | Rule |
|---|---|---|---|---|---|---|
| 1 | Selected Transition label | Rabaed Settings Workflows.html › `.wl.sel` | outlined | gap | fill it, as the reference does | |
| 2 | Signature on a Transition | Rabaed Settings Workflows.html › screenshot 3 | none | rule-forced | sign it | ADR 0017: "Every Transition is signed" |
| 3 | Due date chip | Rabaed Kanban Card Anatomy.html › screenshot 2 | not built | rule-forced | Step Age dots | CLAUDE.md: "Rabaed shows no due dates, deadlines or SLAs" |
```

- **Reference source:** every row cites what it relies on, as `<file> › <part>`. The part is a CSS selector in backticks, a script line (`line 42`, `lines 40–48`), or a numbered screenshot (`screenshot 3`). Several citations go in one cell, split by `;`. A file alone is not a citation: "the reference outlines it" was wrong on spec RP-528, where the reference's CSS fills it (`.wl.sel{background:var(--ec);color:#fff}`).
- **Verdict:** `match`, `gap`, `rule-forced` or `question`.
- **Rule:** a `rule-forced` row quotes the line that forces it, word for word, after the file it comes from: `ADR nnnn: "…"`, `docs/visibility.md V14: "…"`, `GLOSSARY.md <term>: "…"` or `CLAUDE.md: "…"`. Spec RP-528's table read ADR 0017 as "no signatures" where it says every Transition is signed; a quote makes that misreading visible.

`scripts/check-gap-table.ts` checks every row: a citation of the right shape, a known verdict, and each quote (three words or more; a line holding straight quotes goes in curly quotes “…”) found word for word in the repo file it names. With `--refs`, it also checks that each cited file is in that folder, that each selector is a whole CSS rule's selector there (`.wl.sel` is not found in `.wl.selected{…}`) and that each line exists in the file as written. A rule in a `<style>` block and a rule packed into a script string, each after a literal `\n`, are found alike, so a page that packs its CSS is cited by selector like any other. Block comments are ignored (a stray `/*` in a string hides the rules up to the next `*/`: then cite `line N`); a selector in a `//` comment still matches, so the reviewer opens the rule. It can't check that a screenshot shows what the row says, that a quote comes from the rule the label names (V14, a glossary term), or that the cited source says what the row claims; the reviewer does.

Gap tables live in the session's notes (its scratchpad or the shared notes folder), not in the repo. The PR body says the table passed and where it is.
