Design the **Snag List** module for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support). It works on desktop and on a phone on site.

## Context
The Snag List is a tab inside every Rabaed project. It holds the follow-up items that come out of the rest of the work, all tracked in one place. Each item is a **Work Item** with a type:

- **Snag:** a defect or an action found on site or during an inspection, e.g. "Cable tray not bonded", "Ceiling plasterboard – rework needed". It often has photos and a Pin on a floor plan. It can be raised manually, or automatically when an inspection checklist item fails.
- **Comment:** created automatically when a consultant approves a submittal with **Code B (Approved with Comments)**. Each review comment becomes one Comment item, assigned to the Contractor and linked to the submittal it came from.
- More types can be added later by the project, e.g. **Question** or a plain **Task**. Design the type as a visible chip or filter so new types fit naturally.

Every item has:
- a Document Number (e.g. `TWR-TMC-EL-SNG-014`, or `TWR-DCL-EL-CMT-003` for a comment);
- a title and description;
- a Trade and a Location (Zone / Building / Floor);
- the company it is assigned to;
- a **Stage**;
- **"Raised from"**: a link to the source item (a submittal, an inspection or a daily report) that opens it;
- photos and attachments;
- a Chat thread.

**Stages** are configurable per project. Defaults: **Open → In Progress → On Hold → Resolved → Closed**. The usual flow:
1. The Contractor fixes it and marks it **Resolved**.
2. The Consultant verifies it.
3. The Consultant either **Closes** it or **re-opens** it with a note.

**Age:** each item shows how many weeks it has sat at its current step, as up to 4 dots (1 week = 1 dot; 4+ = all red). **Never show "overdue", deadlines or SLAs.** Rabaed shows age only.

**Visibility rule (critical):** each viewer sees only the items their company is allowed to see. A Contractor sees the items raised on their own work or assigned to them, never another Contractor's. All counts and badges count only visible items.

## What to design

### 1. Snag List: list view (desktop)
- Toolbar: "+ New Snag", type filter chips (All · Snags · Comments · Questions), Trade, Location, Company, Stage, "Assigned to me", "Raised from" (e.g. all comments from MAR-041), and search.
- Items grouped by **Stage** (collapsible groups with counts, as on the Rabaed submittals list).
- Columns: number, title, type chip, Trade chip, Location, raised from (linked number + its Review Code badge, e.g. "MAR-041 · Code B"), assigned company and person, age dots, photo thumbnail.
- Bulk select: reassign within my company, move stage, export.
- Export: PDF snag report and Excel.

### 2. Kanban view
- Columns = Stages. Cards show the type icon, number, title, Location, Trade, assignee avatar, age dots and a photo thumbnail.
- Toggle List / Kanban / Plan (the Plan view opens the floor plan with pins; just show the toggle).

### 3. Item detail (drawer or full page)
- Header: number, type chip, Stage, age, action buttons such as "Mark Resolved", "Put On Hold", "Close", "Re-open". Only the buttons the viewer is allowed to use appear.
- **"Raised from" card:**
  - For a Comment: the source submittal's number and title, its Code B badge, the reviewer's original comment quoted, and "Open submittal".
  - For a Snag from an inspection: the failed checklist item, with its photo.
- Details: description, Trade, Location with a mini floor-plan thumbnail showing the pin, photos gallery, attachments.
- **Response section:** the Contractor's fix note plus "after" photos when marking Resolved, shown next to the "before" photos.
- Tabs: **Details · Chat · Internal Communication.** Internal Communication holds notes seen only inside the viewer's company.
- History: stage changes, who did what, when.

### 4. Comments seen from the submittal
A small panel design for the **submittal detail page**:
- "Comments from Code B: 3 of 5 closed", with a progress bar.
- The list of its Comment items with their stages.
- A link to the Snag List filtered to this submittal.

### 5. Create a Snag (desktop and phone)
- Type, title, description, Trade, Location picker (Zone → Building → Floor), "Pin on plan" (opens the plan), photos (camera on phone), assign to company.
- On phone: a fast one-handed flow: camera first → pin → title → assign → save. Autosaved as a draft.

### 6. Mobile Snag List
- Card list with filters in a bottom sheet, swipe actions (Resolve / Hold), a large "+" button, and photo-first cards.

## States to design
- Desktop list with ~30 mixed Snags and Comments across stages.
- Kanban.
- Detail of a **Comment** raised from a Code B submittal.
- Detail of a **Snag** with before/after photos, being marked Resolved.
- The consultant's verification: "Close" or "Re-open with note".
- The submittal page "Comments 3 of 5 closed" panel.
- Empty state: "No snags. Nice work."
- Mobile: list, create flow, detail.
- **Arabic RTL version** of the desktop list and the detail. Document numbers stay Latin, left to right.

## Visual direction
- Clean, modern SaaS in the style of the existing Rabaed screens (the submittals list and Kanban): white cards, light grey background, orange primary accent (~#E8552B), stage group headers as coloured pills with counts.
- Type icons: Snag = warning/triangle, Comment = speech bubble, Question = question mark. Use shape plus colour, never colour alone.
- Review Code badges consistent with submittals: A green, B green with a comment icon, C orange, D red.
- Age dots: grey, turning red week by week.

## Sample data
- Project "Dubai Marina Tower – Phase 2". Companies: TMC Constructions (Contractor, Electrical), Design Consultants LLC (Consultant).
- Comments from `TWR-TMC-EL-MAR-041` "Lighting Fixtures" (Code B, by Mohammed Al Shamsi):
  1. "Provide IP65 certificate for corridor fittings": Resolved, 1 week
  2. "Update luminaire schedule to Rev C": Open, 2 weeks
  3. "Confirm emergency lighting duration (3h)": Closed
- Snags:
  - `TWR-TMC-EL-SNG-014` "Cable tray not bonded", Tower 1 / Floor 02 / Riser 01, raised from inspection `IR-045` (failed item "Earthing continuity"), Open, 3 weeks, 2 photos.
  - `SNG-015` "Ceiling plasterboard – rework needed", Floor 01 / Corridor, Dryliner subcontractor, In Progress.
  - `SNG-016` "SVP firestopping – potential rework", Floor 02 / Riser 01, On Hold.

Produce an interactive prototype: switch views, open item details, mark Resolved with photos, the consultant Close / Re-open, filters, and the mobile frame.
