Design the **Floor View** for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support).

## Context
A Rabaed project is broken down into **Locations**: Zone → Building (Tower or Villa) → Floor, or Sector → Segment on road projects. Every Work Item (submittal, inspection request, snag, comment, site report) is tagged with a Location and a **Trade** (Electrical, Civil, Mechanical…). The Floor View shows a building floor by floor, so a project manager can see at a glance where work is complete, in progress, blocked by issues, or not started.

**Location Status** for each floor is calculated from the Work Items at that Location:
- **Complete:** passed inspections
- **In Progress:** open inspections or submittals
- **Issues:** open snags or failed inspections
- **Pending:** nothing started

There is no percentage progress yet; that will come later from the schedule module.

**Visibility rule (critical):** every number, badge and item on this screen counts only what the viewer's company is allowed to see. A Contractor never sees another Contractor's snags or counts. Nothing in the design should imply hidden totals ("12 of 40").

## What the screen must show
1. **Breadcrumb:** Project / Zone A – North Wing / Tower 1 / All Floors, with a building switcher.
2. **Building stack:** floors stacked vertically like a building elevation (Roof at the top, Ground Floor at the bottom, basements below). Each floor row shows:
   - the floor name;
   - status tiles or icons for its spaces or components (green complete, blue in progress, red issue, grey pending);
   - counts: Complete · In Progress · Issues · Pending;
   - an arrow to drill into that floor, which opens the Plan View for that floor.
3. **An alternative "card list" layout** of the same floors, one card per floor with the counts and coloured status icons, for users who prefer lists. Provide a toggle between the Stack and List layouts.
4. **Left filter panel:**
   - Trade
   - Work Item Type (Inspections, Snags, Submittals)
   - Company, showing only companies whose work the viewer can see
   - Stage
   - Date / week selector, e.g. "Week 32 – Mon 5 Aug"
5. **View data switch:** Status (default) or "Issues only" (highlights floors with open issues).
6. **Right "Spotlights" panel:** open issues on this building, sorted by priority. Each shows the title, a short description, Location chips (Zone / Tower / Floor), the Trade and the assignee company. Tabs: Open / Resolved. Export to PDF or email.
7. **Legend button**, bottom right, and zoom controls.

## States to design
- A default 8-floor tower plus roof and ground floor, with a mix of statuses.
- A hover or selected floor: highlighted row with a small popover summarising counts by Trade.
- Filtered to Electrical only: counts change.
- Empty state: a building with no Work Items yet.
- **Arabic RTL version** of the default state.
- A tablet layout, where the filters collapse into a drawer.

## Visual direction
- Clean, modern SaaS in the style of the existing Rabaed screens: white cards, light grey background, orange primary accent (~#E8552B).
- Status colours: green (complete), blue (in progress), red (issues), grey (pending), consistent across the product.
- The stack should feel like a building: slight architectural feel, but calm and readable. No 3D.
- Desktop first, at 1440px.

## Sample data
- Project "Dubai Marina Tower – Phase 2", Zone A – North Wing, Tower 1: Ground Floor, Floors 01–08, Roof.
- Floor 07: Complete 1, In Progress 1, Issues 1 (Electrical: "Deficient and possibly inaccessible").
- Floor 06: Complete 2, In Progress 1, Issues 1 (Plumbing: "Leakage detected").
- Floor 05: Complete 1, In Progress 1, Pending 1.
- Spotlights: "Ceiling Plasterboard – Rework Needed" (Floor 01, Corridor, Dryliner); "SVP Firestopping – Potential Rework" (Floor 02, Riser 01, Firestopping subcontractor).

Produce an interactive prototype: the layout toggle works, filters change the counts, clicking a floor shows where it drills to, and Spotlights expand.
