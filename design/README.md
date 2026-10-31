# design/

UI intent for Rabaed: the product owner's reference pages, the Claude Design kit, design prompts and review screenshots.

- `reference/`: the owner's reference pages in the repo (`sign-in/`, `submittal-panel/`) and the Claude Design kit (`claude-design/`). The owner's large anatomy pages stay in `D:\Artifacts` (fonts embedded; never commit them).
- **Owner exports stay local.** A Claude Design HTML export (6–11 MB, its fonts embedded, Thmanyah too) goes at the top of `reference/` in the main folder, where `.gitignore` hides it (any `.html` or `.htm` file directly in `design/reference/`, whatever its case; RP-663). Sub-folders are not hidden. The repo is public and the Thmanyah licence forbids redistribution. To commit a page as a reference, strip its fonts first (`pnpm design:strip-fonts <in> <out>`) and put it in its own folder, as `submittal-panel/` does. The pre-commit hook and CI (`scripts/check-no-fonts.ts`) refuse embedded font data anywhere, so a renamed or moved export is caught too.
- **No personal data in `design/`** (RP-1168). A mock screen must show placeholders, not real people: addresses `@example.com` or `@rabaed.test`, phone numbers like `050 000 0000`. The pre-commit hook (`scripts/check-design-personal-data.ts --staged`) refuses an email address on a real mail domain, a Saudi or international phone number, a national ID or Iqama number, a CR number, a VAT number, an IBAN and a card number that a change adds to a text file under `design/`, nested Claude Design exports decoded too. A name on its own cannot be found, so look for one beside an address. A deliberate placeholder goes in `scripts/design-personal-data-allow.json` with its reason. `node scripts/check-design-personal-data.ts --tree` lists everything already in the tracked tree, as a path, line and kind, never the value.
- `prompts/`: "Design: …" requests for pages with no design yet.
- `review/`, `reviews/`: screenshots and notes from design reviews.
- `owner-reference-process.md`: how a page is built from an owner reference (gap table, citations, independent review).

## Which design a page follows

1. **The owner's anatomy or reference page** for that screen (in `reference/` or `D:\Artifacts`) comes first.
2. **The Claude Design kit screen** (`reference/claude-design/`) comes second, where the owner gave no page.
3. **Neither:** the page waits for a "Design: …" task for the product owner (a prompt in `prompts/`).

`GLOSSARY.md`, `docs/visibility.md` and the Rules in `CLAUDE.md` beat all three. A sample that clashes with them is the designer's mistake: flag it, and follow the rule. The kit's and the references' mock data is UI intent only, never a visibility test.
