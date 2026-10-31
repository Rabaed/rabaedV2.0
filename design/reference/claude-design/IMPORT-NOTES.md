# Claude Design import — "Rabaed Design System"

Source: https://claude.ai/design/p/a8093d43-d516-459d-a1a0-2fc700a381ef

## Import 2026-10-31 (RP-579)

From the owner's new zip export (`Rabaed Design System.zip`, 582 files), diffed file by file against this folder:
127 files unchanged, 15 changed, 440 new, none removed. All changed and new files are here, except:

- **Not committed:** the Thmanyah fonts (`assets/fonts/thmanyah/*.woff2`, `LICENSE.pdf`) and `uploads/` (the owner's
  pasted screenshots, notes and logs, and a second Thmanyah pack). Both are git-ignored; their licence or content keeps
  them out of a public repo.
- **Fonts stripped** from every HTML export with `pnpm design:strip-fonts` (6–18 MB each down to 0.1–1.5 MB). Two
  exports nest whole other exports, each with 63 fonts, base64 and gzipped, where neither the script nor
  `check-no-fonts` looks: `handoff/Inspections (WIR) Screen Board.html` and
  `handoff/submittal-panel/Submittal Panel Anatomy (standalone).html`. Their nested pages were stripped the same way.
- **Two personal email addresses** in the access-settings mock (`ui_kits/app/ac/ac.js` and `_ds_bundle.js`) were
  replaced with `mohamed@nama.example` and `ahmed@nama.example`. The repo is public.

### What changed

| Area | Kit files | Change |
| --- | --- | --- |
| Project tabs | `ui_kits/app/shell/shell.js` | New tabs Drawings & Design, Schedule and Inspections; new order: Overview, Schedule, Multiple View, Drawings & Design, Submittals, Packages, Inspections, Reports, Snag List, Files, Settings. |
| Project Overview | `shell/pages.js` | New sample Project (Al Rayhan) whose Overview opens with a Schedule card. |
| List toolbar | `list/list.js`, `list/list.css` | The Export split button became a ⋯ More menu: Hide closed submittals, Compact rows, Export submenu (Excel or CSV, visible or all columns; PDF; print), Import register, Imports, Bulk change, Column settings. |
| Submittals List and Kanban | `submittals-list.html`, `submittals-kanban.html`, new `list/drawer.*`, `subflow/` | A row or card opens the resizable submittal panel; + Add Submittal opens the create slide-over (`subflow/`). `list/drawer.js` matches `design/reference/submittal-panel/source/drawer.js`. |
| Packages | `packages.html` (now a source page, not a bundle), new `packages/` | Rebuilt: Kanban = type ledger, List = type chips and full columns, full-page Package, Waiting my action, bulk review pop-up. |
| Project Settings nav | `settings/numbering.js`, `wf/wf.js` | New entry Bulk Actions, linking to the new `settings-bulk.html`. |
| Icons | `tokens/icons.css` | 19 new Tabler icons (packages, file-spreadsheet, folders, cloud-upload, fingerprint, hash and others). |
| Generated | `_ds_bundle.js`, `_ds_manifest.json`, `_adherence.oxlintrc.json`, `readme.md`, `background-compare.html` | Regenerated for the new screens; `readme.md` lists them. |

New screens and folders:

- **Settings:** `settings-bulk.html` (`bulk/`: submittals from Excel, drawings folder), `settings-access.html` (`ac/`),
  `settings-workflows-v2.html` (`wf2/`, a Workflow Builder V2), `import-register.html` (`imp/`: import wizard and
  Imports list).
- **Project tabs:** `drawings.html` (`drawings/`), `inspections.html` and `inspections-board.html` (`wir/`),
  `schedule.html` (`sched/`) and `schedule-v3.html` (`schedule-v3/`), Packages (`packages/`).
- **Other:** `sign-in.html`, Responsive Anatomy (`responsive/`), `Package Anatomy Options.html`, `standalone/` "lite"
  pages, and a font-stripped standalone export of most screens (`ui_kits/app/Rabaed *.html`).
- **`guidelines/`:** Kanban Board and Kanban Card anatomy pages.
- **`handoff/`:** the owner's Inspections (WIR) Screen Board, Sign in and Submittal Panel hand-offs (the last also in
  `design/reference/submittal-panel/`, which is unchanged).
- **`assets/brand/`:** logo on dark and on light.
- **`scrap/`:** Claude Design's own working screenshots. Not a design; ignore them.

### Samples that clash with the rules

The kit is UI intent; `CLAUDE.md`, `GLOSSARY.md` and `docs/visibility.md` win (`design/README.md`). New screens show
due dates and late markers in red (Schedule screens, the `subflow/` Due date field, sample Projects' `due`). Rabaed shows no due
dates outside the Schedule module, which has its own grilling session. Build Step Age instead.

## Import 2026-09-27

First via DesignSync `get_file`; then completed from the user's zip export
(`Rabaed Design System.zip`, kept here). Every file present in both was byte-identical.

- Complete: all 211 files in the export are here, except the duplicate font pack
  `uploads/Thmanyah-Font-Family (1)/` (same fonts already live in `assets/fonts/thmanyah/`; the zip still holds it).
- Binary headers verified (PNG / JPG / WOFF2 / PDF).

**Before committing a Claude Design HTML export**, run `pnpm design:strip-fonts <in.html> <out.html>` and commit the output: exports embed every font (Thmanyah too) in their manifest, and CI refuses embedded font data (`scripts/check-no-fonts.ts`, RP-962). Check for nested exports too (a `text/html` manifest entry): their fonts are hidden from both (RP-579).
