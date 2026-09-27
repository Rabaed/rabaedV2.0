# Change requests for the Rabaed Design System (Claude Design)

Decided in the design review of 2026-09-27 (see `design/reviews/claude-design-review.md`).
Paste one section at a time into the Claude Design project, check the result, then re-export the zip into `design/reference/claude-design/`.

These prototypes show UI intent only. Sample data may mix companies; visibility is enforced and tested in the real build. The changes below are about layout, navigation, wording and the design system.

---

## 1. Navigation and pages

Apply these changes to the SaaS shell (`saas-shell.html`, `shell/`):

- **Project tabs**, in this order: **Dashboard · Submittals · Inspections · Snag List · Site Reports · Drawings · Files · Views · Schedule · Settings**.
  - Schedule is shown greyed out with a "Coming soon" tooltip.
  - "Overview" is renamed Dashboard, and the Activity Feed becomes a panel inside it.
  - "Packages" is no longer a tab. It becomes a filter and grouping inside Submittals (a Package chip on each card, plus a "Packages" view toggle next to List / Kanban).
  - "Approved Suppliers" is no longer a tab. It moves to Project Settings → Approved Supplier List, and appears as a supplier picker inside forms.
  - "Activity" is no longer a tab.
  - "Multiple View" is renamed **Views**, with Floor · Plan · Map inside it. Link the existing floor-view, plan-view and map-view screens there and remove the Map View placeholder page.
  - "Reports" is renamed **Site Reports**.
- **Sidebar, remove:**
  - Payment Requests. It comes back later as "Claims" in the Financial Module.
  - Subscription Management (both the page and the nav item).
  - Roles.
  - Request To Join, along with its badge and the Home activity line "requested to join".
  - The workspace switcher. A Member belongs to exactly one company.
- **My Company → Members** (renamed from Users):
  - Mark each Member as **Authorized Person** (exactly one) or **Project Creator**.
  - Add an **"Invite Member"** button that only the Authorized Person sees.
  - The company-level permission matrix is gone. Permissions are designed later under Project → Settings → Positions.

## 2. No deadlines: Step Age only

Rabaed shows no due dates, deadlines or SLAs, and never says "overdue", "late", "delayed" or "at risk". It shows only **Step Age**: whole weeks at the current step, as 1–4 dots that go from grey to red.

- **Submittals list** (`list/list.js`):
  - Delete the "Due date" column, the `due` field and the red late-date styling.
  - Rename the "Days in column" column to **"Step Age"**, shown as dots with a tooltip such as "2 weeks at this step".
- **Filters:** replace the day buckets (2+/3+/5+/8+/12+/20+ days) with **1+ / 2+ / 3+ / 4+ weeks at step**.
- **Saved filters, rename:**
  - "My overdue MEP items" becomes "My MEP items · 4+ weeks at step".
  - "Stuck 8+ days" and "Stuck 3+ weeks" become "4+ weeks at step".
- **Kanban card anatomy:** the "Overdue" state becomes **"4+ weeks at this step"**, with 4 red dots only. Remove the warm border and the `.late` styling.
- **Home:**
  - The KPI "Overdue 8+ days" becomes **"4+ weeks at a step"**.
  - The "Overdue" pill in the list becomes the item's Stage pill plus its age dots.
  - Remove the project status pills On track / At risk / Delayed.
- **Project card and project details:** "Completion Mar 2027" becomes **"Planned completion · Mar 2027"**, shown as plain grey text: no calendar-warning icon, never red, no countdown.
- **Floor View sample text:** "energisation date at risk" becomes "test readings not uploaded".
- **Map View:** "On Track" / "Zones on track" become **"No issues"**.
- **readme tone rule:** "what is requested, by when" becomes "what is requested".
- The Site Reports wording "Missing" and "Add it late" stays as it is. Both are correct.

## 3. Other companies' steps are grouped under the company name

This is a new design-system pattern. Add a guideline card **"Grouped company steps"**.

- On any screen that shows Steps or who holds an item, the viewer's **own company** is shown in full: step names and people.
- **Another company** is shown as **one grouped block with the company name**, e.g. "With Design Consultants LLC". It never shows a person's name, its internal steps, internal returns or a recommended code. The only exception is a signer on a final issued code.
- Apply it to:
  - **Kanban swimlanes:** own-company Steps are separate lanes; another company's Steps become one lane "With <Company>".
  - **List:** rename "Current owner" to **"With"**. It shows a person for your own company and a company chip for another.
  - **Site Report stepper:** the Contractor's internal steps appear to the Consultant as "TMC Constructions internal review".
  - **Workflow builder, "Who holds it" preview:** names for my own company; "<Company> · N people" for others.
  - **View workflow:** keep it as it is. It already follows this rule.

## 4. Stage moves always go through a Transition

- Dragging a Kanban card to another column, or using bulk "Move stage" in Snag List, opens the matching **Transition**: its Action Form, plus the signature confirmation where the Transition needs one. It never sets a Stage or Review Code directly. If no Transition connects the two columns, the drop is refused with a short hint.
- Remove "Edit" and "Delete" on submitted items. Use the **Cancel** Transition instead.

## 5. Site Reports

- **Consultant actions:** **"Acknowledge ✍"** and **"Return with comments"**. Remove "Affirm" and "Ask a question". Questions that don't block the report go in its Chat.
- **Stages:** Draft → Internal Review → Submitted → Acknowledged ✍ → Issued. No Review Codes.
- **Missing states to add:**
  - **Phone Daily form:** all 9 sections, with manpower, equipment and materials rows as cards with steppers and swipe-to-delete, plus "Copy from yesterday".
  - **Phone Safety checklist:** Pass / Fail / N/A. A Fail requires a photo and a comment, and has a "Raise Snag" toggle.
  - **Report detail:** tabs Report · PDF preview · Chat · Internal Communication · History, an Approvals log with ✍ markers, and the Distribution List with sent/opened status.
  - **Report Type settings page:** Expected Frequency, reminder time, working days and holidays, Distribution List, and PDF template.
  - **Register:** filters for Company, Trade, Location, date and Stage, and Type and Company columns.
  - Optional Hijri date next to the Gregorian one.
  - RTL captures of the calendar and the phone form.

## 6. Terminology (match the Rabaed glossary)

Rename throughout:

| From | To |
|---|---|
| Discipline | Trade |
| Status | Stage |
| Document type | Work Item Type |
| Approval code | Review Code |
| Current owner | With |
| Client / Client Representative | Owner / Owner Representative |
| Users | Members |
| Company Admin | Authorized Person |
| Overview | Dashboard |
| Reports | Site Reports |
| Multiple View | Views |
| Submittal No. | Document Number (pattern `TWR-TMC-EL-MAR-041`) |

## 7. Design system

- **One theme for now: the cool light palette** already in `tokens/theme.css` (canvas `#f6f7f9`). Make it the only base token set.
  - Remove the runtime `?bg=warm|br|inv` overrides from `shell/shell.js`.
  - Remove hard-coded body backgrounds.
  - Replace every hard-coded hex colour in the ui-kit CSS and JS with tokens.
  - Build the tokens so that 4 user-selectable themes can be added later (a later-phase feature) without touching components.
- **New tokens and components:**
  - **Stage** colour tokens shared by every module.
  - **Review Code** tokens: A green, B green with a comment icon (the same icon everywhere), C orange, D red.
  - **Step Age** tokens `--age-1..4` and one **AgeDots** component, replacing the 5 current versions.
  - One global **`.docno`** style: Document Numbers are always LTR-isolated, including in Arabic.
- **RTL:** use logical CSS properties only. Remove the physical left/right in `list/filter-panel.css`, `plan/mobile.css`, `plan/plan.css`, `map/map.css`, `wf/wf.css` and `floor/floor.css`. The workflow builder must also work RTL.
- **Fonts and icons:**
  - Drop **Caveat** from the app; it is for marketing only.
  - Self-host the icon font instead of loading it from jsDelivr, and confirm Tabler versus Vuesax/Iconsax.
- **Digits:** always Latin digits (0123), in Arabic too. Remove the readme rule about Arabic-Indic digits; keep `numberingSystem:'latn'`.
- **Sample data:** switch to KSA everywhere: project **"Riyadh Gate Tower – Phase 2"** (code TWR, Riyadh; keep the TWR Document Numbers), Owner Representative **"Al Waha PMC"** instead of Al Futtaim, amounts in **SAR**, company profile with **CR number** and **VAT number** instead of Trade licence / TRN.
- **readme:**
  - Remove the references to `correspondence-surfaces.html`, the brand-imagery card, and Correspondence / NCR.
  - Add `theme.css`, `forms.css` and `thmanyah.css` to the token index.
  - Fix the truncated last line.

---

**Not asked here** (enforced in the build, not the mock-ups): filtering rows, counts, pins and viewer switchers by company.
