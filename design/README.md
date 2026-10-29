# design/

UI intent for Rabaed: the product owner's reference pages, the Claude Design kit, design prompts and review screenshots.

- `reference/`: the owner's reference pages in the repo (`sign-in/`, `submittal-panel/`) and the Claude Design kit (`claude-design/`). The owner's large anatomy pages stay in `D:\Artifacts` (fonts embedded; never commit them).
- `prompts/`: "Design: …" requests for pages with no design yet.
- `review/`, `reviews/`: screenshots and notes from design reviews.
- `owner-reference-process.md`: how a page is built from an owner reference (gap table, citations, independent review).

## Which design a page follows

1. **The owner's anatomy or reference page** for that screen (in `reference/` or `D:\Artifacts`) comes first.
2. **The Claude Design kit screen** (`reference/claude-design/`) comes second, where the owner gave no page.
3. **Neither:** the page waits for a "Design: …" task for the product owner (a prompt in `prompts/`).

`GLOSSARY.md`, `docs/visibility.md` and the Rules in `CLAUDE.md` beat all three. A sample that clashes with them is the designer's mistake: flag it, and follow the rule. The kit's and the references' mock data is UI intent only, never a visibility test.
