Design the **Map View** for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support).

## Context
Large Rabaed projects are spread over a site: villa compounds, multi-tower developments, road projects. A Project Admin uploads a **site map image** (a masterplan or aerial render) and draws **zones** on it: polygons for each Zone, Phase, Building or Villa cluster, linked to the project's Locations. The Map View shows the whole site with each zone coloured by its status, so managers and executives see at a glance where work is going well and where attention is needed. Clicking a zone drills into its buildings: Map → Floor View → Plan View.

**Zone status** for now is calculated from Work Items in that zone (open issues, failed inspections, pending approvals, completed inspections). Schedule progress % and budget come later from the Schedule and Financial modules. Design the status panel so those metrics can slot in later, and show them as "coming soon" placeholders in one variant.

**Visibility rule (critical):** all statuses and counts cover only what the viewer's company is allowed to see. A Contractor sees their own work only. The Owner sees the whole site within their assigned Trades.

## What the screen must show
1. **Site map canvas:** a large aerial/masterplan image with pan and zoom. Zones are drawn as semi-transparent coloured polygons. Each zone has a status marker and a label on hover, e.g. "Phase 02 – Central Blocks · 3 open issues".
2. **Status legend:** On Track (blue), Needs Attention (orange), Issues (red), Complete (green), Not Started (grey). Define each in a tooltip, based on Work Item counts.
3. **Zone popover or side panel** on click:
   - zone name, buildings or villas count;
   - counts: open snags, failed inspections, submittals pending approval, completed inspections;
   - top 3 open issues;
   - buttons: "Open Floor View" and "Open in list".
4. **Right panel, "Project overview":**
   - totals across the visible zones;
   - a zone ranking (most issues first);
   - an executive summary card;
   - in the future variant, placeholder cards for Schedule progress %, Budget utilisation and Forecast finish date, marked "Available with Schedule / Financial modules".
5. **Filters:** Trade, Work Item Type, Company (only visible ones), Phase.
6. **Admin edit mode** (Project Admins only):
   - Upload or replace the site map image.
   - Draw, edit and delete zone polygons.
   - Link each polygon to a Location from the project's Location tree.
   - Name and colour override.
   - A "Save layout" action.
7. Left app navigation: Home, Projects, Map View (active), My Company.

## States to design
- Default, light theme: a villa compound masterplan with ~8 zones in mixed statuses.
- Zone selected, with the side panel open.
- Executive variant in a **dark theme**, big-number cards and the future Schedule/Budget placeholders (inspired by an "Executive Project Insight" screen).
- Admin edit mode: drawing a polygon, the Location link picker.
- Empty state: "Upload a site map to get started", with guidance.
- **Arabic RTL version** of the default state. Panels mirror; the map image does not mirror.
- A tablet layout.

## Visual direction
- Clean, modern SaaS in the style of the existing Rabaed screens: orange primary accent (~#E8552B). The light theme is the default; the dark theme is for the executive variant.
- Zone polygons must stay readable over a busy aerial image: soft fill, strong outline, status colour plus an icon or pattern so colour isn't the only signal.
- Status colours consistent across the product.
- Desktop first, at 1440px.

## Sample data
- Project "Al Nakheel Villas Compound", 113 villas, 8 zones: Phase 01 North Villas, Phase 02 Central Blocks, Phase 03 East Villas, Clubhouse, Mosque, Main Gate & Roads, Phase 04 South Villas, Landscaping.
- Phase 02 – Central Blocks: 3 open snags, 1 failed inspection, 5 submittals pending approval, 42 inspections passed → "Needs Attention".
- Phase 01: 0 open issues, 60 inspections passed → "On Track".
- Main Gate & Roads: 4 open snags, 2 failed inspections → "Issues".

Produce an interactive prototype: pan and zoom, hovering and clicking zones, the side panel, filters changing statuses, a light/dark toggle for the executive variant, and admin edit mode with polygon drawing.
