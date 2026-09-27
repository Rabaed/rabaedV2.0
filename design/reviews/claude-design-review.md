# Claude Design review: Rabaed prototypes vs written rules

Reviewed: `design/reference/claude-design/` (readme, `ui_kits/app/*` and JS/CSS, `guidelines/*`, `tokens/*`), 2026-09-27.
Rules: `docs/visibility.md` (V1–V14, E1/E2, leak channels), `CONTEXT.md`, the prompts in `design/prompts/*.md`, and the product rules (no due dates, deadlines or SLAs; no subscriptions; permissions come from Project Role + Position; RTL from day one; Document Numbers stay LTR).
Paths below are relative to `design/reference/claude-design/`. Line numbers are 1-based and refer to the file named.

> **Re-scoped 2026-09-27:** the prototypes show UI intent only. Section 1's data-level leaks (mock rows mixing companies, "All companies" viewer switchers, unfiltered counts) are **not** design defects; they become **build acceptance tests** for visibility. Only leaks baked into the UI structure itself (a column, swimlane or panel whose job is to show another company's internal step) stay as design issues.

> **Decisions 2026-09-27:** Thmanyah web-use licence handled by the product owner (resolved). One theme for now, the cool light palette (canvas `#f6f7f9`); 4 user-selectable themes are a later feature (backlog, Personalisation). The Subcontractor in the mocks is sample data only. Digits are always Latin (0123), in Arabic too. Other companies' Steps are always grouped under the company name (visibility.md V14).

**Original main finding:** only Floor, Map, Plan (desktop), Snag and Workflow View have a viewer ("view as") switch. The Submittals List and Kanban, Home/Overview, Site Reports and the Plan phone view don't filter data by viewer at all. Their counts and names come from every company's items.

---

## 1. Visibility leaks

| # | Sev | Where | What leaks to whom | Rule | Fix |
|---|---|---|---|---|---|
| 1 | **High** | `ui_kits/app/list/list.js:17,27,30-34`; `list/kanban.js:21,28` | The Submittals List and Kanban mix items from 3 Contractors (Al Futtaim, Arabtec, ALEC: `ctr:i%3`) in every Stage, Draft and Internal Review included. The Kanban column counts (`rs.length`) are totals across all companies. A "Contractor" column and filter are available (`list.js:17`, `guidelines/filter-panel.js:17,65`). | V1, V3, leak channel "column counts" | Add a viewer switch. Show only items the viewer's Participant raised, holds a Step on, or oversees. Hide the Contractor column and filter from Contractors. Compute counts from visible items only. |
| 2 | **High** | `list/kanban.js:6-8,25-27`; `guidelines/kanban-board-anatomy.html:151-163,203` | Role swimlanes split columns by who holds the item inside a company. A Contractor sees "Consultant Engineer / Consultant PM" lanes with counts under Pending Approval, and a Consultant sees "Contractor Engineer / PM" lanes under Internal Review. This exposes the other company's internal Steps. | V5, V14 | Show swimlanes only for the viewer's own Participant's Steps. Collapse another company's part into one "<Company> review" lane with no sub-counts. |
| 3 | **High** | `list/list.js:16,26,50`; `list/kanban.js:18`; `list/list.js:55` (Owner filter); `guidelines/filter-panel.js:7-8` | "Current owner" names the Consultant's individual reviewer (Mohammed Al Shamsi, Sarah Al Mansoori) while the item sits in the Consultant's internal Steps. The Owner filter lists people from both companies. The "Role" filter exposes internal Positions. | V14 (no names in the collapsed block) | When another company holds the item, show "With Design Consultants LLC" and no person. The person filter lists only own-company Members. |
| 4 | **High** | `floor/data.js:15`, `map/data.js:16`, `plan/data.js:10`, `snag/data.js:9` (`admin: sees:null, can:[all]`) | The "Project Admin" viewer sees "All companies" / "Whole site", and on Snag it can also take both Contractor and Consultant actions. Project Admin only configures Settings. It is not a visibility layer. | V2, V4 | Remove "All companies" for Project Admin. A Project Admin sees what their own Participant sees. For demos, use an Owner (oversight) viewer instead. |
| 5 | **High** | `plan/mobile.js:9` (`canSee(p,'admin')`), `:23` (`badges(f.id,'admin')`), `:86` (creates as `tmc`) | The phone Plan View is used by a TMC site engineer but shows every company's pins and floor counts (Gulf Dryliners, FireSafe, ALEC). | V3, leak channel "Pins on shared Drawings" | Apply the viewer's Participant filter to pins, clusters, floor badges and "Show N items". |
| 6 | **High** | `reports/reports.js:17-18` (strip), `:20-21` (calendar), `:23-26` (day preview), `:29-31` (register), `:53`/`:77` (role switch) | Calendar, register, feed and summary strip aren't filtered by viewer. With the "Consultant" role, the viewer can open the Draft (31 Aug), the "Manager review" report (28 Aug) and the internally Returned report (12 Aug) with their full contents, and the strip counts them. | V1 (report private until Submit), V5 | For a Consultant or Owner Rep, show only Submitted/Issued reports. A missing day is only "no report submitted" (don't reveal drafts). Filter the strip counts to match. |
| 7 | Med | `reports/reports.js:43-44` (`flow()`) | The report stepper shows "Manager review · Ali Sonour" (Contractor's internal Step and person) to the Consultant. It also names the Consultant reviewer to the Contractor before signing. | V5, V14 | Collapse the other company's Steps into "<Company> review". Name a person only on the Submit hand-over and the final signature. |
| 8 | Med | `snag/data.js:9` (`sees:['tmc','gdl']`), `snag/snag.js:70` (internal-note filter includes `gdl`), `snag/mobile.js:6,29` | The main Contractor sees its Subcontractor's (Gulf Dryliners) items and its **Internal Communication**. Subcontractor is a separate Participant, and no rule allows this. | V5; "not covered = hidden" | Treat the Subcontractor as its own Participant. If main-contractor oversight is wanted, add a rule to `visibility.md` first. Never share Internal Communication across Participants. |
| 9 | Med | `settings/numbering.js:16-17,23,46,51` | "Next numbers" and the counter examples show a competitor's live counter ("Gulf Builders · Electrical → …-008", i.e. GLF has 7 MARs). It also appears in the read-only mode shown to ordinary Members (`D.ro`). | Leak channel "Document Numbers" | Build the preview from the viewer's own Company plus fictitious values ("Company B → …-001"). Never show another Company's real counter. |
| 10 | Med | `wf/view.js:9` (scenario `internal`), `:58` (view switch) | The "View workflow" drawer lets a Consultant or Owner Rep open an item that is still in the Contractor's Internal Review ("TMC Constructions internal review · 1 week"). The item's existence leaks. | V1, leak channel "Direct URL → 404" | For other Participants, an item still in Internal Review is not found. Show that state only to Contractor viewers. |
| 11 | Med | `wf/wf.js:45` | The builder's "Who holds it" preview lists other companies' Members by name ("TMC Constructions → Nasser, Ahmed", "Design Consultants LLC → pool: Ahmed, Sara") to whichever company's Project Admin edits. | Not covered = hidden | Show "Design Consultants LLC · 2 people" for other companies. Show names only for the admin's own Company. |
| 12 | Med | `shell/pages.js:5-9,17` (project cards: submittals, snags, progress), `:83` (Overview KPIs: Progress %, Submittals, Open snags) | Project-wide totals are shown with no viewer scoping. For a Contractor these must be its visible items only. The "Progress %" (`p:62`) isn't in the model yet. | Leak channel "Dashboard: no project-wide totals for a Contractor" | Label and compute every KPI as "your visible items". Remove Progress % until the Schedule module exists. |
| 13 | Med | `map/data.js:18`, `map/map.js:14-16` | Owner Representative counts use Trade only. Nothing limits them to Submitted items (oversight starts at Submit), so Draft or internal items would be counted. | V2 (oversight after Submit) | Add a "submitted" condition to Owner and Owner Rep aggregates in Map, Floor and Plan. |
| 14 | Med | `snag/snag.js:78` (History) | History lists every Step move with the other company's people ("Nasser Al Kaabi · started work / put on hold"). | V5 (internal Step moves) | Filter History by audience. Other Participants see only hand-overs (Resolved → verify, Close, Re-open) and the signer. |
| 15 | Low | `wf/view.js:57` (Approvals Log) | Under-disclosure: the Consultant viewer doesn't see the Contractor's **Submit ✍** hand-over, because entries inside the collapsed group are dropped. | V14 (hand-overs shown) | Always show the Submit entry with the signer. |
| 16 | Low | `snag/snag.js:66`; `snag/data.js:14` (`sar012 by:'sara'`) | A Code B comment quote names the reviewer who wrote it. If that is the Consultant Engineer rather than the signer, an internal reviewer is named. | V14 | Attribute comments to the Issued Code signer, or show "Design Consultants LLC". |
| 17 | Low | `shell/pages.js:64,71` | "Request To Join" shows people and emails from other companies (Arabtec, ALEC, Aldar, Meraas). Users lists `sarah@consult.ae` as a user of the Contractor. | Model and V4 | See §3. Show only own-company Members. |
| 18 | Low | `saas-shell.html:23-27`, `shell/pages.js:32` | ⌘K search and "Recent activity" are static samples. They need a note that results pass the same RLS and there is no "12 results, 3 shown". | Leak channel "Search", "Activity Feed" | Add an annotation or empty-result state. |

**These parts already follow the rules:** Floor View (`floor.js:8` filter, company filter "Only your company", legend note), Map's per-role filter, the desktop Plan's `canSee`, Snag Kanban counts, and Workflow View grouping. In that grouping, the Recommended Code shows only to its own company (`wf/view.js:33`), the collapsed block has no names, and the Issued Code signer is shown.

---

## 2. Forbidden wording (overdue / due / deadline / SLA / subscription)

| # | File:line | Text | Change |
|---|---|---|---|
| 1 | `guidelines/kanban-card-anatomy.html:186` (+ `.kc.od` `:85`, `.late` `:20`) | Card state "Overdue · warm border + red dots" | Rename to "4+ weeks at this step". Keep the dots and remove the "late" styling. |
| 2 | `ui_kits/app/list/list.js:19,33-34,40-41,51` | "Due date" column, `due` field, red "late" highlight | Remove the column. Replace it with Step Age (weeks, dots). |
| 3 | `guidelines/filter-panel.js:18-19` | Saved filter "My overdue MEP items" | "My MEP items · 4+ weeks at step" |
| 4 | `ui_kits/app/shell/pages.js:25` | KPI "Overdue 8+ days / متأخرة ٨+ أيام" | "At their step 4+ weeks" |
| 5 | `ui_kits/app/shell/pages.js:29` | Pill "Overdue / متأخر" | Stage pill plus age dots |
| 6 | `ui_kits/app/shell/pages.js:5-9,17,83` | Project `due:'Mar 2027'` with a calendar icon; "Completion / الإنجاز المتوقع" | Remove until the Schedule module exists |
| 7 | `ui_kits/app/shell/pages.js:11` | Project status "On track (ضمن الجدول) / At risk (معرّض للتأخير) / Delayed (متأخر)" | Remove, or use Location Status wording (Issues / In Progress / Complete) |
| 8 | `ui_kits/app/floor/data.js:24` | "energisation date at risk / موعد التشغيل معرّض للتأخير" | "…readings not uploaded" |
| 9 | `ui_kits/app/shell/shell.js:7,14,23`; `shell/pages.js:73-81` | "Subscription Management" nav and page (plan, renews, AED 18,000, Upgrade, Billing history) | Delete. Subscriptions are deferred. |
| 10 | `readme.md:27` | Tone guidance: state "what is requested, **by when**" | "…what is requested." Rabaed sets no deadlines. |
| 11 | `map/data.js:4`, `map/map.js:39,75` | "On Track / ضمن المسار", "Zones on track" | The prompt asked for this, but it implies a schedule. Consider "No issues". |
| 12 | `list/list.js:57-58`; `snag/snag.js:28` | Saved filters "Stuck 8+ days", "Stuck 3+ weeks" | "4+ weeks at step" (neutral) |

Allowed and correct: "Missing" day and "Add it late / إضافته متأخرًا" (`reports/reports.js:24,34,38`), and "Issues & delays" (the prompt's own section name).

---

## 3. Model and terminology mismatches with CONTEXT.md

| # | File:line | As designed | Should be |
|---|---|---|---|
| 1 | `shell/pages.js:56-63` (+ `:59` "Roles apply to every project and module in the company") | Company-wide **Roles** with a View/Create/Approve/Edit/Delete matrix per module | Per-project **Position** (Function Permissions View, Create, Submit, Review, Approve, Assign, Close, Attach) held within a **Project Role**. Move it to Project → Settings → Positions. |
| 2 | `shell/pages.js:56` "Company Admin"; `wf/wf.js:59` "Company admins" (notification recipient) | Company Admin | **Authorized Person** |
| 3 | `shell/shell.js:12`, `pages.js:56,64` "Client Representative"; `pages.js:83` "Client"; `reports/data.js:9` "for the client" | Client / Client Representative | **Owner / Owner Representative** |
| 4 | `shell/shell.js:7` "Users"; `pages.js:68-72` | Users | **Members** (a Member belongs to exactly one Company, so the external `sarah@consult.ae` shouldn't appear) |
| 5 | `shell/shell.js:9,24`; `guidelines/shell-anatomy.html:46` | "Switch/Add workspace" across 3 companies | A Member belongs to one Company, so there is no company switcher. At most an **Instance** or project picker. |
| 6 | `shell/pages.js:64-67` | "Request To Join" from other companies' people, with a Project Role | Companies are onboarded by Rabaed Engineers, and only the Authorized Person adds Members. Remove, or change to "Invite Member". |
| 7 | `shell/pages.js:51` "Company type: Main contractor" | Fixed company type | Project Role is **per Project** ("Avoid: company role, company type") |
| 8 | `shell/pages.js:51` "Trade licence / TRN"; AED; Dubai | UAE identifiers | **CR number, VAT number**, SAR, KSA sample data |
| 9 | `shell/shell.js:7,22`; `pages.js:24,41-46` "Payment Requests… interim payment applications" | Module in the nav | **Claim** (Financial Module, not designed). Remove from the nav. |
| 10 | `shell/shell.js:11` tabs | Overview, Reports, Approved Suppliers, Activity as tabs; no Inspections, Schedule or Drawings | Modules: **Dashboard**, Submittals, Inspections, Snag List, **Site Reports**, Schedule, Files, Drawings, Settings. The readme itself says Activity and Approved Suppliers moved into Settings. |
| 11 | `list/list.js:9`, `guidelines/workflow-submittal.card.html:25` | "Discipline" | **Trade** |
| 12 | `list/list.js:11`; `guidelines/filter-panel.js:4`; `kanban-board-anatomy.html:179` | "Status" | **Stage** |
| 13 | `list/list.js:16,55`; `kanban-card-anatomy.html:126` | "Current owner", "Owner" filter | "With" / **holder** of the Step. "Owner" is a Project Role. |
| 14 | `list/list.js:55`; `guidelines/filter-panel.js:6` | "Document type" | **Work Item Type** |
| 15 | `list/list.js:56`; `workflow-submittal.card.html:24` | "Approval code" | **Review Code** |
| 16 | `list/list.js:6,34`; `pages.js:29` (`12789331`) | "Submittal No." `SUB-1280` | **Document Number** in the project pattern (`TWR-TMC-EL-MAR-041`) |
| 17 | `list/list.js:20,39`; `kanban-card-anatomy.html:161-162,236` | "Days in column" dots at 2/3/5/8/12/20 **days** | **Step Age**: weeks 1, 2, 3, 4+ as up to 4 dots |
| 18 | `list/kanban.js:34-35`; `snag/snag.js:47,127` (bulk "Move stage") | Drag or bulk-move sets the Stage (and Code A/D) directly | Stages change only through **Transitions** with an Action Form and Signature. Dragging opens the matching Transition, or isn't allowed. |
| 19 | `list/list.js:65` row menu | "Edit", "Delete" on any submittal | No Delete (Work Items are **Cancelled**). Documents are frozen after Submit. |
| 20 | `floor/data.js:13`; `floor/floor.js:36` | Filter "Stage" = Structure / MEP rough-in / Finishes | Clashes with **Stage**. Rename (e.g. "Works phase") or drop it. |
| 21 | `plan/data.js:4-6` vs `snag/data.js:3,5` vs `wf/data.js:69` | Plan: Open / In review / Failed / Closed, code `COM`. Snag: Open / In Progress / On Hold / Resolved / Closed, code `CMT`. Snag workflow: "Done · under confirmation", "Reopened", no On Hold | One Snag List Stage set and one Type code (`CMT`) everywhere |
| 22 | `wf/data.js:69-70` perms "Fix", "Verify" | Invented permissions | Function Permissions (Submit, Review, Close…) |
| 23 | `reports/data.js:12`; `reports/reports.js:45-49` | Stages "Manager review", "Affirmed", no "Issued"; Consultant action "Affirm ✍" / "Ask a question → Send & return" | Prompt: Internal Review → Submitted → **Acknowledged ✍** → **Issued**. The Consultant's "Return with comments" isn't a **Return** (Return stays within one Participant). |
| 24 | `reports/data.js:12` "Returned" | Used for both the PM's internal Return and the Consultant sending back | Separate them. The internal Return is invisible to others (V5). |
| 25 | `readme.md:3,33` | Scope "official correspondence, NCRs", "Super Admin"; status words "requires your reply / awaiting owner" | Not in CONTEXT modules. Status vocabulary must be **Stages**. |
| 26 | `list/list.js:25`, `workflow-submittal.card.html:20` | Code B uses the same check icon as A | B = green **with a comment icon** (as in `snag/snag.js:9`, `wf/view.js:16`) |
| 27 | `floor/floor.js:51,61`; `map/map.js:90` | Priority High/Med/Low; "Open for N days", "Nd open" | Priority isn't in the model. Use Step Age dots (weeks). |
| 28 | `shell/shell.js:11` "Multiple View → Map View" | Map is a View | CONTEXT View = List, Kanban, Floor, Plan. Add **Map** to CONTEXT, or place it elsewhere. |

---

## 4. Missing states per screen (vs `design/prompts/*.md`)

- **Site Reports** (`site-reports.md`) has the largest gaps:
  - No **phone** Daily form. Only a desktop modal; sections 3–8 are placeholders ("Fields for this section come from the template"). There are no manpower rows as cards with swipe-delete and no Equipment/Materials tables.
  - No **Weekly Safety checklist on phone** (Pass/Fail/N/A, Fail → required photo + "Raise Snag"). There is only a summary list.
  - The report detail lacks the **tabs** (Report · PDF preview · Chat · Internal Communication · History), the **Approvals log**, and the **Distribution List** with sent/opened status.
  - No **Report Type settings** page (Expected Frequency, reminder time, working days, holidays, Distribution List, PDF template).
  - The register has no Company/Trade/Location/date/Stage filters and no Type or Company columns.
  - No Hijri option next to Gregorian.
  - No Consultant-view calendar (see leak #6).
  - RTL exists only through the global toggle. The prompt asks for the RTL calendar and the RTL phone form.
- **Plan View** (`plan-view.md`): the viewer switch has no Consultant or Owner Rep. There's no state for a floor with no drawing uploaded, and no RTL desktop capture (toggle only). The phone view has no viewer scoping (leak #5).
- **Snag List** (`snag-list.md`): mostly complete. Missing: a Consultant viewer on mobile (hard-coded `tmc`), the before/after comparison on the phone detail, and the Kanban → Plan toggle doesn't carry filters.
- **Workflows** (`workflows.md`): Part A and Part B are complete, including compare, publish, simulate and phone. The builder ignores RTL (`wf/wf.js:65` `rtl:false`). The "item in Internal Review viewed by others" state should be not-found (leak #10).
- **Floor View** (`floor-view.md`): complete (stack/list, hover by trade, Electrical filter, empty building, tablet, RTL toggle). The tablet drawer and RTL captures exist only as toggles.
- **Map View** (`map-view.md`): complete (selected, exec dark, admin draw + Location link, empty, tablet, RTL). No Consultant viewer.
- **Document Numbering** (`document-numbering-settings.md`): complete (default, drag, no-Company warning, override drawer, save modal, read-only, RTL). Fix the preview data (leak #9).
- **Submittals List/Kanban** (no prompt): no viewer states, no RTL capture, no phone layout, and no zero-items empty state (only "no match").
- **Shell:**
  - Tabs 2, 5, 6, 7 are "Module not designed yet".
  - The Map View page is a placeholder (`pages.js:47`) even though `map-view.html` exists.
  - The Settings pages **Participants, Visibility and Positions** don't exist. They are the core of the visibility model.
  - No notification-bell state.

---

## 5. Design-system readiness for code

1. **Two unsettled palettes.** `tokens/theme.css:6-20` is cool grey (`#f6f7f9`) with a navy dark theme (`#0f1524`). The readme calls the warm off-white `#FDF9F5` "a brand signature". The warm version exists only as a URL hack (`?bg=warm|br|inv`) that injects about 60 hard-coded overrides at runtime (`shell/shell.js:2`). Pick one and move it into tokens.
2. **Light/dark.** Only the `.theme-dark` class; there's no `prefers-color-scheme` mapping. The body background is hard-coded (`saas-shell.html:40`, `submittals-*.html:30-32`, `reports.html:39`).
3. **Hard-coded colours.** 91 hex values in ui-kit CSS and 256 in ui-kit JS, e.g. `snag/snag.js:11`, `reports/reports.js:8`, `wf/view.js:13`, and the status hexes in `guidelines/filter-panel.js:4`.
4. **Step Age has 5 implementations** with different scales and colours: `list/list.js:39` (days), `plan/plan.js:12-13`, `snag/snag.js:11-12`, `reports/reports.js:8` (amber from 3), `wf/view.js:13`. Define one AgeDots component and the tokens `--age-1..4`.
5. **Stage and Code tokens aren't unified.** `--status-*` covers submittals only; Snag, Plan and Reports each use their own tone maps. The Code B icon differs between files (§3 #26).
6. **RTL.** Mostly logical properties (151 logical vs 60 physical). Physical properties remain in `list/filter-panel.css` (24), `plan/mobile.css` (16), `plan/plan.css` (8), `map/map.css` (7), `wf/wf.css` (4), `floor/floor.css` (1). JS positioning branches on `rtl` by hand. The Kanban card pins the code badge to the physical left in both directions (`kanban-card-anatomy.html:168`); confirm that's intended.
7. **Document Numbers LTR.** `direction:ltr; unicode-bidi:isolate` is applied only in `snag/snag.css:12` and `settings/numbering.css`. It's missing in `list/list.css:64`, `shell/pages.css:31` and the Plan `code` styles. Make one global `.docno` utility.
8. **Numerals.** The readme (`:25`) says Arabic-Indic digits, but the code forces `numberingSystem:'latn'` (`list/list.js:38`, `floor/floor.js:6`). Decide, and make it a token or setting.
9. **Fonts.**
   - The readme says Arabic = IBM Plex Sans Arabic, but `tokens/typography.css:12,15` uses **Thmanyah Sans** first.
   - `--font-display` falls back to "Montserrat Arabic", which isn't loaded.
   - **Caveat** is a marketing-only substitute; keep it out of the app bundle.
   - **Tabler Icons** substitutes Vuesax/Iconsax (unconfirmed), and its font binary streams from jsDelivr (`readme.md:66`). Self-host it and confirm the icon set.
10. **Thmanyah licence** (`assets/fonts/thmanyah/LICENSE.pdf`, read in full):
    - It allows commercial use in websites and apps. It allows embedding "only as part of a compiled, packaged, or obfuscated product".
    - It **prohibits** uploading, hosting or making the fonts available on any server. It also prohibits making them extractable by end users "including through web embedding". Modification is prohibited.
    - Governed by KSA law; contact ask@thmanyah.com.
    - Plain `@font-face` `.woff2` files served by a web app (`tokens/thmanyah.css`) are downloadable. Storing them in Claude Design or the repo may also count as "upload/host".
    - Before shipping, get written permission from Thmanyah, or fall back to IBM Plex Sans Arabic.
11. **Components.** The React primitives in `components/` (15) aren't used by the ui-kit screens, which are vanilla string templates. Table, Drawer, Modal, Popover, StagePill, CodeBadge, AgeDots, Pin, EmptyState, FilterPanel and ViewAs are missing as components.
12. **Readme is stale:**
    - It references `ui_kits/app/correspondence-surfaces.html` and a `brand-imagery` card, neither of which exists.
    - The token index omits `theme.css`, `forms.css` and `thmanyah.css`.
    - The last line is truncated (`readme.md:111`).
    - Scope text mentions Correspondence and NCR.
13. **Sample data** is UAE (Dubai, AED, Trade licence/TRN). Switch to KSA (SAR, CR/VAT, Riyadh) so screenshots don't mislead.

---

## 6. Prioritised fix list (paste into Claude Design)

1. "Add a 'View as' switch (Contractor A, Contractor B, Consultant, Owner Rep, Owner) to Submittals List and Kanban. Filter rows, column counts, filters and export to what that company may see: its own items, items where it holds a Step, and for Owner/Owner Rep only Submitted items in their Trades. Contractors never see Drafts, internal items, the Contractor column or other contractors' names."
2. "In the Kanban, show role swimlanes only for the viewer's own company. Collapse another company's steps into one lane '<Company> review' with no person names and no sub-counts. When another company holds an item, show 'With <Company>' instead of a person on the card and in the list."
3. "Remove 'Project Admin · All companies' from every 'view as' menu (Floor, Map, Plan, Snag). A Project Admin sees only what their own company sees, and Project Admin doesn't grant Contractor or Consultant actions."
4. "Plan View on phone: use the signed-in engineer's company for pins, clusters, floor badges and counts. Never show other contractors' pins."
5. "Site Reports: when the viewer is the Consultant or Owner Rep, hide Draft, Manager review and internally Returned reports from the calendar, register, feed and summary counts. Collapse the Contractor's internal steps in the report stepper into 'TMC Constructions internal review'."
6. "Remove all due dates and 'overdue/late/delayed/at risk' wording. Delete the 'Due date' column and red late dates in the List, the 'Overdue' Kanban card state, the 'My overdue MEP items' filter, and the Home KPI 'Overdue 8+ days'. Also remove the project due dates, the On track/At risk/Delayed pills and 'Expected completion'. Use Step Age only: weeks at the current step, 1–4+ dots."
7. "Replace 'Days in column' everywhere with one Step Age component: up to 4 dots, 1 dot per week, grey to red, the same colours in every module."
8. "Delete the Subscription Management nav item and page, and the Payment Requests module from the sidebar."
9. "Replace My Company → Roles (company-wide View/Create/Approve/Edit/Delete) with Project → Settings → Positions: per-project Positions holding Function Permissions (View, Create, Submit, Review, Approve, Assign, Close, Attach) inside a Project Role. Also design the Participants and Visibility settings pages."
10. "Rename per the glossary: Discipline→Trade, Status→Stage, Document type→Work Item Type, Approval code→Review Code, Current owner→With/holder, Client/Client Representative→Owner/Owner Representative, Users→Members, Company Admin→Authorized Person, Overview→Dashboard, Reports→Site Reports, Submittal No.→Document Number (pattern TWR-TMC-EL-MAR-041). Remove the workspace switcher and 'Request to join'."
11. "Snag List: treat Gulf Dryliners (subcontractor) as a separate company. TMC must not see its Internal Communication or items. History shows another company's actions only at hand-overs, without person names except signers."
12. "Document Numbering: in 'Next numbers' and the counter examples, show the viewer's own company plus a fictitious 'Company B' starting at 001. Never show another company's real counter, especially in read-only mode."
13. "Workflow builder 'Who holds it': show names only for my own company. Other companies show '<Company> · N people'. In View workflow, an item still in Internal Review isn't openable by other companies. The Consultant's Approvals Log shows the Contractor's Submit ✍ entry."
14. "Kanban drag and Snag bulk 'Move stage' must open the matching Transition (Action Form + signature), never set a Stage or Review Code directly. Remove 'Delete' and 'Edit' from submitted items (use Cancel)."
15. "Site Reports: add the phone Daily form (all 9 sections, manpower rows as cards with steppers and swipe-delete, Copy from yesterday), the phone Safety checklist (Pass/Fail/N/A, Fail → photo + Raise Snag), the report detail tabs (Report, PDF preview, Chat, Internal Communication, History) with Approvals log and Distribution List, and the Report Type settings page. Use the stages Draft → Internal Review → Submitted → Acknowledged ✍ → Issued."
16. "Unify the tokens: one canvas palette (decide warm vs cool) in `tokens/`, no runtime `?bg=` overrides, no hard-coded hex in screens. Add Stage, Review Code (B has a comment icon) and Step Age tokens, a global `.docno` LTR-isolated style, and logical CSS properties only. Switch sample data to KSA (SAR, CR/VAT)."
17. "Fonts: keep IBM Plex Sans Arabic as the Arabic fallback until Thmanyah grants written web-embedding permission. Drop Caveat from the app. Self-host the icon font and confirm Tabler vs Vuesax."
