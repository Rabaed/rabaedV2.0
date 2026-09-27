Design the **Plan View** for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support). It works on desktop and on a phone on site.

## Context
Each floor (or other Location) in a Rabaed project can have plan **Drawings**: floor plans and elevations. Work Items such as snags, inspection requests and comments can have a **Pin**: an exact point on a plan drawing. The Plan View opens a floor's plan and shows every Work Item pinned on it, so a site engineer or consultant can see *where* problems are and add new ones by tapping the plan.

Drawings have revisions. When a newer drawing revision is uploaded, pins stay on the sheet they were placed on, and the user can switch sheets.

**Visibility rule (critical):** a plan can be shared by several companies, but each viewer sees **only the pins of Work Items their company is allowed to see**. A Contractor must never see a competitor's snags on the same floor plan. Counts on badges also include only visible items.

## What the screen must show
1. **Header:** breadcrumb (Project / Tower 1 / Floor 02), a drawing selector (e.g. "A-102 Floor 02 Plan – Rev C (current)"), and a floor switcher (previous and next floor).
2. **Left panel, "Plans":** the list of floors, each with coloured count badges by status or type (e.g. 8 orange, 1 red, 1 blue), and an elevation sheet at the top that works as a floor picker.
3. **Plan canvas:** a large drawing with pan and zoom. **Pins** appear as coloured markers by Work Item Type or status (Snag, Inspection, Comment); overlapping pins cluster into a count bubble when zoomed out.
4. **Pin popover** on click: number (e.g. `TWR-TMC-EL-SNG-014`), title, status/Stage, Trade, assignee company, age in weeks shown as up to 4 dots, a photo thumbnail, and an "Open" button.
5. **Add a pin:** a "+" mode. Tap a point on the plan, then pick the Work Item Type (Snag, Inspection Request…), and a short create form slides in with the Location already filled.
6. **Filters:** Work Item Type, Trade, Stage/status, "Assigned to me", date range.
7. **List toggle:** a side list of the same pinned items, synced with the plan (hovering a list row highlights its pin).
8. **Mobile version:**
   - Full-screen plan with a bottom sheet for the item list and filters.
   - A big "+" button to drop a pin with the camera ready.
   - Designed for one-handed use on site.

## States to design
- Desktop default: Floor 02 plan with about 25 pins of mixed types, a filter bar, and the side list.
- Pin popover open.
- Adding a new snag: pin placed, create form.
- Zoomed out with clusters.
- Mobile: plan with bottom sheet collapsed and expanded, and the add-pin flow with photo capture.
- **Arabic RTL version** of the desktop default. Panels mirror; the drawing itself does not mirror.

## Visual direction
- Clean, modern SaaS in the style of the existing Rabaed screens: orange primary accent (~#E8552B), white panels, light grey chrome.
- The drawing is the hero. Keep the chrome minimal and translucent around it.
- Pins must stay readable on busy black-and-white CAD drawings: solid colours with a white outline, clear shapes per type (e.g. circle for snag, diamond for inspection, square for comment) so colour isn't the only signal.
- Status colours consistent across the product: green, blue, red, grey.

## Sample data
- Project "Dubai Marina Tower – Phase 2", Tower 1, Floors GF–03 and Roof, plus an elevation sheet.
- Floor 02 badges: 27 snags, 24 open, 1 inspection, 3 comments, 1 failed; 2 items have sat at their step for 3+ weeks. Never label anything "overdue": Rabaed shows age only, with no deadlines.
- Example pin: Snag `TWR-TMC-EL-SNG-014` "Cable tray not bonded", Electrical, assigned to TMC Constructions, Open, 2 weeks old, 1 photo.

Produce an interactive prototype: pan and zoom the plan, click pins to open popovers, filters hide and show pins, the add-pin flow works, and the mobile frame is included.
