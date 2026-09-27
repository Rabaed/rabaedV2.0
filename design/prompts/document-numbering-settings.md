Design the **Document Numbering** settings page for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support).

## Context
Rabaed projects are shared by several companies: Contractors, Consultants, an Owner and an Owner Representative. Every Work Item (submittal, inspection, snag, report) gets a **Document Number** the first time it leaves Draft, e.g. `TWR-TMC-EL-MAR-001`. A Project Admin configures how these numbers are built on this page, inside **Project → Settings → Document Numbering**. The user is a document controller or project admin: detail-oriented, and anxious about breaking the official numbering register.

## What the page must let the admin do
1. **Build the pattern from segment chips** (maximum **6 segments** plus the sequence, which is always last):
   - Project code (e.g. `TWR`)
   - Work Item Type code (e.g. `MAR` Material Approval Request, `SAR` Shop Drawing, `DAR` Document)
   - Trade code (e.g. `EL` Electrical, `CV` Civil, `ME` Mechanical)
   - Company code: the raising company (e.g. `TMC`)
   - Location level: pick one level: Zone, Building or Floor (e.g. `BLDA`)
   - Fixed text: a custom literal (e.g. `SUB`)

   Admins add chips from the list of available segments, drag to reorder, and remove them. Each chip shows its name and an example value.
2. **Separator:** `-` or `/`.
3. **Sequence digits:** 3 to 7, zero-padded (`001` … `0000001`).
4. **Sequence scope:** checkboxes on the chosen segments saying which ones get *their own counter*. Explain it plainly: "Count separately for each Trade → EL-001 and CV-001 both exist." Show a small example of what the counters would look like.
5. **Live preview**, big and prominent at the top. It updates instantly with realistic example values, and shows 2 or 3 sample numbers (e.g. the next number for Electrical and for Civil) so the scope choice is visible.
6. **Project default vs per-type overrides:** the main pattern is the Project default. Below it is a table of Work Item Types (MAR, SAR, DAR, IR, Snag, Daily Report…) showing "Uses Project default" or a custom pattern, with an action to override or reset each one.
7. **Revision suffix:** show read-only that Revisions keep the same number plus ` Rev 1`, ` Rev 2`… Not editable. Explain in one line.
8. **Save with confirmation:** a modal saying that changes apply **only to new items** and that existing numbers never change. Show the before and after preview.
9. **Warnings (inline, not blocking):**
   - "No Company segment: contractors sharing this pattern share one counter, so each can infer how many submittals the others raised." Suggest adding the Company segment with one click.
   - Maximum of 6 segments reached.
   - Estimated length warning if a number would exceed ~30 characters.
10. **Read-only mode:** members who are not Project Admins see the same page with no editing controls and a small "Only Project Admins can change this" note.

## States to design
- Default: a pattern with Project, Company, Trade, Type and the sequence.
- Editing: dragging a chip, and the preview updating.
- The "no Company segment" warning.
- The per-type override editor (a drawer or inline).
- The save confirmation modal.
- Read-only view.
- **Arabic RTL version** of the default state: chips flow right to left, labels in Arabic. The number itself stays Latin, left to right, e.g. `TWR-TMC-EL-MAR-001`.

## Visual direction
- A clean, modern SaaS settings page in the style of the existing Rabaed screens: white cards on a light grey background, orange primary accent (~#E8552B), rounded chips, generous spacing.
- Left: the project settings navigation (General, Participants, Visibility, Positions, Trades & Locations, Stages, **Document Numbering**, Workflows, Forms).
- Main content: the preview card on top, then the pattern builder, then the sequence options, then the per-type overrides.
- Desktop first, at 1440px width. It also needs to stay usable at tablet width.

## Sample data
- Project: "Dubai Marina Tower – Phase 2", code `TWR`.
- Companies: TMC Constructions (`TMC`), Gulf Builders (`GLF`).
- Trades: Electrical (`EL`), Civil (`CV`), Mechanical (`ME`).
- Locations: Zone A → Tower 1 (`T1`) → Floor 01 (`F01`).
- Existing counter: TMC / EL / MAR is at 041, so the next is `TWR-TMC-EL-MAR-042`.

Produce the page as an interactive prototype: chips can be added, removed and reordered; the options change the preview live; the override drawer and save modal open.
