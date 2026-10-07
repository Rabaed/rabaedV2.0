# Design request: New work item (RP-415)

Paste the shared brief from `design-requests-2026-10-07.md` first. See also `submittal-form-and-actions.md`.

**What it is:** starting a new Material Submittal (MAR) inside a Project. It becomes a **Draft** that only the raiser's Company sees until it is Submitted.

**Who uses it:** Hafiz (TMC engineer), from the Submittals list's "New Material Submittal" button.

## Content

- Choose the Type (only Types the Project has; today Material Submittal), then the same Form as the Work Item page (Material details, Items table with total, Documents, References, Classification). Documents can be added once the Draft is saved.
- **Save Draft** (the Draft gets "No number yet"; the Document Number comes when it first leaves Draft), and a "Saved" time once autosave has run.
- Required fields marked; Send for Review is on the Work Item page, not here.
- A clear note that the Draft is seen only by the viewer's own Company.
- Decide in the design: a full page, or a wide drawer over the list (the kit's Snag create drawer, `snag.js:85`). Recommendation: a full page on phone, a drawer or page on desktop.

## Frames

1. Empty form (desktop), Arabic and English.
2. Partly filled, one Items row, after Save Draft ("Saved 10:42").
3. Phone (402).

Desktop 1366 and 1920, tablet 820, phone 402; English and Arabic.
