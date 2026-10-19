# UAT strategy and test plan

Rabaed v2.0, whole system. Written 2026-10-19 for the UAT run on lane 7. Saved as `planning/uat/strategy.md`; the same scenarios are in `scenarios.json`.

Terms follow `GLOSSARY.md`. Visibility is the top requirement (`docs/visibility.md`): a visibility failure found in UAT is a Highest-priority Bug.

## 1. Purpose and scope

**Purpose.** Show, in a real browser on a real stack, that what Rabaed has built does what the docs say, that no Company sees another Company's work beyond the rules, and that the Arabic, RTL and phone experience is usable. UAT is the last check before a Project Module release; it does not replace the automated suites (section 3.5).

**In scope (whole system, as built or being built today):**

- Submittals (MAR, SAR, DAR) with Revisions, Review Codes A to D, Comments, Links, Duplicate, Export, Search and filters, List, Kanban, Dashboard, Home, Activity Feed.
- Workflows (builder, publish, bindings, Step Pool, Step Age, Return, Send Back), Forms and Screens, the Library and Company defaults.
- Participants and Visibility setup: invitation by CR number, grants, Authorized Person, narrowing, Handover, numbering.
- Packages, Signing and the Documental Record, Snag List, Inspections (WIR, Checklist Templates, photo annotation), Submittal Register Import.
- Notifications (bell, email through Mailpit, digest, weekly report, mute).
- Arabic and English, RTL, Latin digits, Document Numbers left to right, phone width.
- Rabaed Admin (separate service, Rabaed Engineer).

**Out of scope:**

- Tendering, Financial and Schedule Modules (not designed).
- A native mobile app: there is none. The phone uses the same web app (ADR 0004); phone checks are made at 375 px width.
- Modules and features not built and not in a ticket of the five epics below: Chat, Project close, Participant withdrawal, Files, Drawings, Floor, Plan and Map Views, Site Reports, Subtasks, admin commands on an item. Their matrix rows are listed as "Not scheduled" (section 9) so they are not forgotten.
- Load, penetration and accessibility audits (separate pieces of work). Basic keyboard, focus and contrast observations are noted when seen.

**Build status on 2026-10-19** (from Jira, confirmed against the routes in `apps/web` and `apps/api`):

| Epic | Main | Built (testable now) | Still to come |
|---|---|---|---|
| Workflow engine, Forms and Screens, Participants and Visibility, frontend shell | earlier | everything in sections 5.1 to 5.4 and 5.10 to 5.12, and the Now scenarios of 5.6 to 5.9 | none |
| RP-588 Packages | 1 | nothing: spec RP-616 in progress, build tickets In Progress or To Do | Open Package, Submit Package, board counts, Done status, grouped notification, bulk Transitions, Package filter and Comments, UI RP-659 to RP-662 |
| RP-23 Signing and Documental Record | 2 | Signing on Transitions (RP-142), document fingerprint (RP-618), tracer sealed record and Download PDF (RP-620) | page 1 and Form body (RP-151), logo and Stamp (RP-617), appendix (RP-147), record checks (RP-155), Verification page (RP-157), distribution link (RP-161), Working Copy (RP-621), Signature cards and Stamps (RP-650), Add Signature UI (RP-665, RP-666) |
| RP-28 Snag List | 3 | Snag Type (RP-90), desktop views (RP-94), raiser as Step holder (RP-622), raised-from counts (RP-624), no Comment in New (RP-668) | reply photos (RP-623), Informed Participants (RP-625), Questions (RP-626), Site Observation (RP-627), detail page (RP-628), bulk and exports (RP-629), phone (RP-630), Contractor pick (RP-658), PDF report (RP-677) |
| RP-27 Inspections (WIR) | 4 | WIR Workflow v2 (RP-170), link questions (RP-82), Checklist Templates (RP-651), Show Inspections setting (RP-652), request and on-site screens (RP-654), photo annotation (RP-656) | on-site checklist (RP-86), Snags from failed items (RP-577), re-inspection Revision (RP-653), WIR v3 Review Codes (RP-673), RP-674 |
| RP-589 Submittal Register Import | 5 | upload, map, preview, confirm Drafts (RP-637), xlsx and csv reading (RP-635) | value matching (RP-639), Assign to (RP-640), Packages from import, downloads, saved mappings (RP-644), import by a Rabaed Engineer (RP-645) |

## 2. Environment

### 2.1 Lane 7

UAT runs on **lane 7**, the Main 7 stack. Lane 7 is a legacy single-digit lane, so its ports are the defaults plus 700 (`scripts/lanes.ts`, README "Several worktrees at once"). Open it by its lane host, never by `127.0.0.1`, so its cookies stay apart from other lanes.

| Service | Address on lane 7 |
|---|---|
| Web app (EN) | `http://lane7.localhost:3700/en` |
| Web app (AR) | `http://lane7.localhost:3700/ar` |
| API | `http://127.0.0.1:4700` (testers use the web app; the API is for the automated suite and API checks) |
| Rabaed Admin | `http://127.0.0.1:4750` (its own address and sign-in; password plus a code emailed to the Engineer) |
| Mailpit (all email) | `http://127.0.0.1:8725` |
| File store | port 9700 (Docker; no tester needs it) |
| Postgres | port 6132 (lane engineers only; used for the aged-item fixture, section 2.5) |

**Start and reset a round.** From the lane 7 worktree, in PowerShell: `pnpm lane:env 7`, then `pnpm demo`. It starts Postgres, Mailpit and the file store, resets the database, seeds the demo and runs web, api, worker and Rabaed Admin. The worker must run: it delivers notifications and makes the PDFs. Reset before each round so every tester starts from the same seed. The password for every demo person is the one in `.env.demo` (never written in this plan, never in a screenshot).

**Scripted sign-in** (automated suite and API checks): `pnpm demo:session <name>` writes a Playwright storage-state file for `hafiz`, `ali`, `saeed`, `omar`, `yousef`, `ahmed`, `sara`, `mohammed`, `faisal`, `noura` or `nasser`. The record is sealed locally on lane 7 (`RECORD_SEALING=local`), so a PDF seal shows an unverified signer by design (ADR 0023).

### 2.2 Seed people

Project **Riyadh Gate Tower - Phase 2** (`TWR`; Host Company TMC Constructions). Trades Electrical Works (EL), Mechanical Works (ME), Civil Works (CV, covered by no Participant). Locations Main Zone > Tower 1 (Floors 01 to 03) and Tower 2 (Floor 01). Every email is on the reserved `.test` domain. Use a private window per person.

| Company (CR) | Project Role, Visibility | Person | Position | Email |
|---|---|---|---|---|
| TMC Constructions (9999000001) | Contractor, Host Company, Project Admin. Electrical, all Locations | Saeed Al Qahtani | Authorized Person, Project Creator, Project Admin | `saeed.alqahtani@tmc.demo.rabaed.test` |
| | | Hafiz Hamdan | Engineer | `hafiz.hamdan@tmc.demo.rabaed.test` |
| | | Ali Sonour | Project Manager (the only one) | `ali.sonour@tmc.demo.rabaed.test` |
| | Tower 2 only | Omar Al Harbi | Engineer | `omar.alharbi@tmc.demo.rabaed.test` |
| Beta Build (9999000002) | Contractor. Electrical, all Locations (same as TMC) | Yousef Karim | Engineer | `yousef.karim@betabuild.demo.rabaed.test` |
| | | Nasser Al Dosari | Authorized Person; only Member of Project Jeddah Corniche Villas (JCV) | `nasser.aldosari@betabuild.demo.rabaed.test` |
| Design Consultants LLC (9999000003) | Consultant. Electrical and Mechanical, all Locations | Ahmed bin Said | Engineer | `ahmed.binsaid@designconsultants.demo.rabaed.test` |
| | | Sara | Engineer | `sara@designconsultants.demo.rabaed.test` |
| | | Mohammed Al Shamsi | Manager (the only one) | `mohammed.alshamsi@designconsultants.demo.rabaed.test` |
| | | Layla Mansour | Authorized Person | `layla.mansour@designconsultants.demo.rabaed.test` |
| Al Waha PMC (9999000004) | Owner Representative. Electrical, all Locations | Faisal Al Otaibi (Arabic) | Engineer | `faisal.alotaibi@alwaha.demo.rabaed.test` |
| | | Noura Al Harbi (Arabic) | Project Manager; holds the Owner review | `noura.alharbi@alwaha.demo.rabaed.test` |
| | | Hind Al Mutairi (Arabic) | Authorized Person | `hind.almutairi@alwaha.demo.rabaed.test` |
| Rabaed | Rabaed Admin only | Rabaed Demo Engineer | Rabaed Engineer | `engineer@rabaed.demo.rabaed.test` |

Short names in the scenarios: **TMC**, **Beta Build**, **DCL** (Design Consultants LLC), **Al Waha**.

**Seeded items** (`TWR-MAR-01-nnnn`; the first number a tester creates is `TWR-MAR-01-0004`): `0001` Exit signage - Tower 1 (Code A); `0002` Emergency lighting control panel - Tower 2 (Submitted, with DCL, links `0001`); `0003` Cable tray risers - Tower 1 (Code C) and its Rev 1 (Submitted); a Supplier Approval Request "Tabuk Cable Industries" (Code A, so the supplier is on the Approved Supplier List); a Document Approval Request "Cable sizing calculation - Tower 1" (Code A after the Owner review by Noura); the Draft "Emergency lighting - Tower 2" of Hafiz (TMC only). Project JCV holds one Draft "Pump room ventilation" (Nasser). The Approved Supplier List holds Al-Rimal Building Materials (Civil), Najd Electrical Supplies (Electrical) and Tabuk Cable Industries (Electrical). Two Checklist Templates exist: Concrete pour (Civil) and Cable trays and containment (Electrical).

### 2.3 Matrix mapping: C1, C2, K1, OR, OW

The scenario matrix in `docs/visibility.md` uses invented Companies. In UAT:

| Matrix | Means | Seeded Company | Differences from the matrix, and the fixture that closes them |
|---|---|---|---|
| **C1** (Contractor, Electrical) | the item raiser | **TMC Constructions** | none |
| **C2** (second Contractor, Building B only) | a rival Contractor of the same Trade | **Beta Build** | Beta Build covers every Location, so it overlaps TMC. Fixture **FX-C2** (PAR-14) narrows it to Tower 2 (matrix "Building B"). Building A in the matrix is Tower 1. |
| **K1** (Consultant, Electrical and Mechanical, Members split by Trade) | the reviewer | **Design Consultants LLC** | Every DCL Member covers both Trades. Fixture **FX-K1M** (PAR-15): Layla narrows Sara to Mechanical only, giving "K1 Mechanical-only engineer". |
| **OR** (Owner Representative, Electrical) | oversight | **Al Waha PMC** | For the two-Location rows, fixture **FX-OR** (VIS-13): Hind narrows Faisal to Tower 1 and Noura to Tower 2. |
| **OW** (Owner, all) | Owner | none in the seed | Fixture **FX-OW**: the Engineer onboards "UAT Owner Co" in Rabaed Admin (ADM-02, CR 9999000005) and Saeed invites it as Owner (PAR-16); its PM is "Sami UAT". |

### 2.4 Test data rules

- Seed values only for people and Companies. Created data is fictional and prefixed `UAT <scenario id>` in its Subject or name (for example "UAT SUB-01 Lighting Fixtures"), so the leftovers of a round are easy to find.
- Extra Companies and Members are made-up and use CR numbers `9999000005` upward, VAT `3999900000000n3`, and addresses on `.demo.rabaed.test`. Never a real person, Company, CR or VAT number.
- No passwords, tokens or keys in a Test Case, comment or screenshot. Say "password in `.env.demo`".
- Files to upload are made up: a small PDF, a JPEG with EXIF time and place (the `exif-jpeg` helper of the seed makes one), a valid `.xlsx` and `.csv` register, and a bad file of each kind. Keep each under 5 MB.
- Time cannot be waited for. Scenarios that need an item weeks old, or the 07:00 digest, use the fixtures in section 2.5.

### 2.5 Fixtures

| Fixture | What | Made by | Needed by |
|---|---|---|---|
| FX-C2 | Beta Build narrowed to Tower 2 | PAR-14 | Snag scenarios, VIS-50 to VIS-54 |
| FX-K1M | Sara covers Mechanical only | PAR-15 | VIS-02, VIS-22 and others |
| FX-OW | UAT Owner Co as Owner, with a PM | ADM-02, PAR-16 | VIS-02, VIS-14, VIS-24, VIS-40 |
| FX-OR | Faisal Tower 1 only, Noura Tower 2 only | VIS-13 | VIS-13, VIS-15 |
| FX-SB | a Project copy of the MAR Workflow with a Send Back from Consultant Engineer to the Contractor Draft Step, in two versions (After a Send Back: Comment only, and Edit the Form) | WF-09 | VIS-14, VIS-15, NOT-09 |
| AGE | items whose Step Age is 1, 4 and 5 weeks | a lane engineer (shell and database access to lane 7), by setting the step-entered time of chosen items in the database of lane 7 (the one allowed direct data change) | WF-15, VIS-16, VIS-17, NOT-07 |
| JOBS | the daily digest and the weekly Step Age report run on demand | a lane engineer runs the scheduled jobs of the worker (open question OQ-2) | NOT-06, NOT-07 |

### 2.6 Browsers, widths, languages

- Desktop: Chrome and Edge, latest, at **1366** and **1920** px wide. Phone: Safari on iPhone and Chrome on Android, and Chrome device mode at **375** px. Firefox as an exploratory extra. Tablet (820 px) is exploratory only.
- Each scenario that has a screen is run in **English** (`/en`) and spot-checked in **Arabic** (`/ar`, RTL, Latin digits, Document Numbers left to right). Part I18N is the full check; every other Part notes Arabic where the wording or layout differs.
- Times show Riyadh time; dates are Gregorian.

A **lane engineer** is anyone with shell and database access to the lane 7 worktree; it is not the Rabaed Engineer.

## 3. Approach

UAT has four layers, each with a different job. A scenario is run by the layer that finds its defects best.

### 3.1 Manual and exploratory testing in the browser

A tester signs in as the person named in **Who**, follows **Steps** and checks **Expected**. Each Test Case lists what to look at, in both languages where it matters. Besides the scripted steps, each tester spends a timed session per Part on exploratory testing: unusual order of actions, double clicks, back button, two tabs, a slow network, a refused action, a language switch in the middle of a form. Anything odd is a Bug candidate; the tester states what they expected and which document says so.

Multi-person scenarios use one private window per person. Cross-company checks always include the **must NOT see** side: log in as the other Company and look in every place the Leak channels table of `docs/visibility.md` names (lists, counts, search, URL, downloads, notifications, exports, Activity Feed, Home).

### 3.2 UI against the design (ui-ux-tester agent)

For every built screen, the ui-ux-tester agent compares the page in the browser with its reference screen in `design/reference/claude-design/ui_kits/app/`, at 1366 and 1920 px, in English and Arabic, and at 375 px where a mobile reference exists. The reference wins over the kit. It reports two lists, never mixed:

- **UI issues** (the page differs from the reference without a rule forcing it): each with a screenshot, the reference file, and the element.
- **UX recommendations** (the page matches the reference, or there is none, but a thing is awkward or unclear): each with the reasoning.

Deviations that a rule forces are **correct, not issues**: no due dates, deadlines or SLAs (Step Age dots only); the glossary words (Stage, Trade, With, Subject, Remarks) in place of the prototype words; visibility hiding (another Company shown by name only, no counts of what the viewer cannot see); Latin digits in Arabic; Document Numbers left to right; and, where the licensed Thmanyah font files are not installed on the machine, a fallback font. Where a sample or mock clashes with `docs/visibility.md` or `GLOSSARY.md`, the rule wins (the designer made the mistake) and the case goes in a table for the designer, not in the Bug list.

| Built page | Reference screen |
|---|---|
| Shell, sidebar, Home, Projects, Project Dashboard | `saas-shell.html` |
| Submittals List, Inspections List, Snag List filter panel | `submittals-list.html` (with `list/list.js`, `list/filter-panel.js`) |
| Submittals Kanban, Inspections Kanban | `submittals-kanban.html` (with `list/kanban.js`) |
| Item page, View workflow drawer | `workflow-view.html` |
| Settings > Workflows and the builder (Project, Library, Rabaed Admin) | `settings-workflows.html` (with `wf/`) |
| Settings > Numbering | `settings-numbering.html` |
| Snag List, List and Kanban (desktop) | `snag-list.html` |
| Snag List on a phone (when built) | `snag-list-mobile.html` |
| Packages (when built) | `packages.html`; spec RP-616 wins where it differs (see `design/prompts/packages.md`, table of known differences) |
| Plan, Floor and Map Views, Reports (not built) | `plan-view.html`, `plan-view-mobile.html`, `floor-view.html`, `map-view.html`, `reports.html` |
| Register Import, Signature and Stamp, Inspections on a phone, Participants, Settings pages without a kit screen | the design prompt in `design/prompts/` (`register-import.md`, `signature-and-stamp.md`, `inspection-on-phone.md`, `participants.md`, `project-settings.md`) and the design review notes in `design/review/` |

### 3.3 Automation (Playwright against the demo)

Stable journeys and visibility checks are automated with Playwright against the lane 7 demo, so each round re-runs them with a video.

1. A **test-automator agent** designs the suite from this plan: one test per scenario marked `Automate` or `Both`, signing in with `pnpm demo:session <name>` storage states, one browser context per person, page objects for the List, Kanban, item page, Settings and Rabaed Admin, a helper that asserts the plain 404 page, and a helper that reads Mailpit.
2. Its design is filed as **ready-for-agent Tasks under epic RP-403** (UAT browser tests with video), one Task per Part, each naming the scenario ids it covers and the fixtures it needs. Fixtures that are API calls (narrowing, inviting, publishing a Workflow) are made by setup code, not by clicking.
3. A lane builds them through `/mattpocock-skills:implement` (rule 15), never by hand. A Task is Done when its tests pass on a freshly seeded lane and the video shows the run.
4. A test never reads a password: it takes a session from `pnpm demo:session`. A test never depends on another test's data; each creates its own `UAT <id>` items.
5. A failing automated test is triaged like a manual failure (section 10). A scenario marked `Automate` is not walked by hand again unless its test is red or being rewritten.

Meaning of **Mode**: `Manual` = a person only (judgement, layout, a phone, a job that needs a lane engineer). `Automate` = Playwright only, because the outcome is a deterministic yes or no (a 404, a count, a missing row). `Both` = a person runs it in its first round, and it is then automated for regression, or a person keeps the part that needs judgement.

### 3.4 What a person checks that a script does not

Layout against the reference, wording in Arabic, whether a refusal is understandable, behaviour on a phone, PDF and email appearance, and anything the doc does not foresee. The scripts check that the right thing is shown or hidden; the person checks that it is shown well.

### 3.5 What the automated suites already cover (UAT does not repeat them blindly)

| Suite | Where | Covers |
|---|---|---|
| Seam 1: API | `apps/api/test/*.test.ts` (about 120 files), `apps/admin/test/` | every route as a Member: access, refusals, the plain 404 (`expectHidden`), the scenario IDs of `docs/visibility.md`, and the README walkthrough (`demo-seed.test.ts`) |
| Seam 2: database and row-level security | `packages/db/test/*.test.ts` | what the app role can read or write: columns not granted, hash columns, `security definer` functions, RLS per table |
| Seam 3: domain | `packages/domain/src/*.test.ts` | pure rules: conditions, Form validation, queries |
| UI stories | Storybook in `packages/ui` | components in isolation, English and Arabic |
| Repository checks | `scripts/check-leak-channels.test.ts`, `check-scenario-ids.test.ts`, `check-migrations*.ts`, `check-workflows.ts`, `hidden-columns.ts`, `doc-index.test.ts` | every notification and outbox kind is checked; scenario ids; migrations; Workflow documents; hidden sort keys |

UAT adds what they cannot: the real browser and the whole stack together (web, api, worker, Postgres, file store, Mailpit, PDF maker), what a person sees (layout, wording, Arabic, phone), cross-service flows (email arriving, a PDF opening), people acting in turn, and time-based behaviour on the fixtures. Where an automated test already proves a database-level fact (for example `document-rls.test.ts`), the UAT scenario checks the same rule **through the screen**, not the table. Matrix rows that are purely internal are listed in section 6.5 with the test that covers them.

## 4. Roles and journeys

Each role below is played by the seeded person shown. The journeys are the end-to-end paths a role runs; a journey is a chain of scenarios in section 5 and is run in the order shown.

| Role | Played by | What the role does | Journeys |
|---|---|---|---|
| Contractor engineer | Hafiz (TMC); Omar (TMC, Tower 2 only); Yousef (Beta Build, the rival) | Raises Drafts (MAR, SAR, DAR, WIR, Snag), fills the Form, sends for review, answers Returns, creates Revisions and replacements, imports registers, builds Packages | J1, J3, J4, J10, J11, J12, J14 |
| Contractor PM | Ali (TMC) | Holds internal review, Returns, Submits with a Cover Note, resolves Comments and Snags, watches, reads Home and the weekly report | J1, J2, J3, J6 |
| Consultant engineer | Ahmed, Sara (DCL) | Picks up from the Step Pool, reads the Form, replies with the verification and a Recommended Code, fills the WIR checklist on site | J1, J9, J14 |
| Consultant manager | Mohammed (DCL) | Issues Review Codes A to D with Remarks, Comments and the final verification; raises Snags; recommends Code to the Owner | J1 to J6, J9, J10 |
| Owner Representative / Owner | Faisal, Noura (Al Waha); Sami UAT (UAT Owner Co) | Oversees Submitted items; Noura holds the Owner review and confirms the Code | J6; all oversight checks in Part VIS |
| Project Admin | Saeed (TMC) | Configures the Project: Trades, Locations, Scopes, Participants and their Visibility, numbering, Workflows, Screens, Stages, Checklist Templates, Approved Supplier List | J7, J8 |
| Authorized Person | Saeed (TMC), Layla (DCL), Hind (Al Waha), Nasser (Beta Build) | Accepts invitations, adds Members, sets Members Visibility, hands over Steps, marks Library defaults, uploads logo and Stamp | J7, J13 |
| Rabaed Engineer | Rabaed Demo Engineer (Rabaed Admin) | Onboards Companies, manages Option Lists, numbering and the Rabaed Default Workflows; never takes a Transition | J7, ADM scenarios |

| Journey | Path | Scenarios |
|---|---|---|
| J1 Raise to approval (the money path) | Draft, Send for Review, Return, resend, Submit with Cover Note, Pick up, Send to Manager, Code A, Download PDF | SUB-01 to SUB-11, SIG-02, SIG-03 |
| J2 Code B to closed Comments | Code B with comment rows; TMC resolves; DCL closes | SUB-12, SNG-06 |
| J3 Code C to Revision | Code C with Remarks; Create Revision; resubmit; switch Revisions | SUB-13, SUB-15 |
| J4 Code D to replacement | Reject; Create replacement; new number | SUB-14 |
| J5 SAR to supplier list | SAR Code A adds the supplier; MAR chooses it | SUB-20, PAR-12, FRM-03 |
| J6 DAR with Owner review | Recommend to the Owner; Confirm | SUB-21, VIS-24 |
| J7 Project set-up | Onboard Company; accept; create Project; Trades and Locations; invite Participant by CR number; grant Visibility; add Members; numbering | ADM-02, PAR-02, PAR-04 to PAR-08, PAR-10, PAR-13 |
| J8 Workflow authoring | Duplicate; build; validate; publish with Change Note; bind; Library | WF-03 to WF-09, WF-14 |
| J9 Inspection | Checklist Template; raise WIR; Submit; on-site checklist; Code; Snags from failed items; re-inspection | INS-01 to INS-13 |
| J10 Snag | Consultant raises; Contractor works; resolve; verify; close or return | SNG-02 to SNG-05, SNG-08 |
| J11 Register import | Upload; sheet; map; preview; confirm; result; Imports page | IMP-01 to IMP-12 |
| J12 Package | Open; add items; Submit Package; progress to Done; bulk Code | PKG-01 to PKG-12 |
| J13 People leaving | Deactivate Member with Handover; remove from Project | PAR-09, VIS-41, VIS-63 |
| J14 On site with a phone | Sign in at 375 px; take photo; answer checklist; raise Snag | I18N-06, FRM-06, INS-09, SNG-13 |
| J15 Arabic first | Faisal and Noura in /ar: read, Confirm, notifications and email | I18N-01 to I18N-05, NOT-10 |

## 5. Module blocks

One Part per area, one table per Part. Columns: **ID**; **Title**; **Who** (seed people, section 2.2); **Steps**; **Expected**; **Pri** (P1 V Visibility and security, P1, P2, P3: section 7); **Mode** (Manual, Automate, Both: section 8); **Waits** (Now, or the epic and tickets: section 9); **Covers** (matrix ids of `docs/visibility.md`, rules and ADRs). Part VIS is section 6.

### 5.1 Submittals (Part SUB, label `uat-part-sub`)

Run SUB-01 to SUB-15 in order: later scenarios reuse the items made earlier. Numbers are those of a fresh seed. Cross-company checks of the same items are in Part VIS.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| SUB-01 | A new MAR is saved as a Draft | Hafiz (TMC engineer) | 1) Projects > Riyadh Gate Tower - Phase 2 > Submittals > New Submittal > Material Approval Request. 2) Subject "UAT SUB-01 Lighting Fixtures", Trade Electrical Works, Location Tower 1 Floor 02, Manufacturer Philips, Approved supplier Najd Electrical Supplies, Description empty. 3) Save Draft. | The Draft is listed in the Drafts Stage with "No number yet" and no Step Age dots. It is Hafiz's to edit. What other Companies see: VIS-01. | P1 | Both | Now | Matrix: 1; Rules: V1 |
| SUB-02 | Send for Review is refused while the Form is incomplete | Hafiz (TMC engineer) | 1) Open the Draft from SUB-01. 2) Send for Review with Description and Datasheet (PDF) empty. | Refused: the Form lists what is missing ("2 fields need your attention: Description, Datasheet (PDF)") and marks each field. Nothing moves; the item stays a Draft with no number. | P1 | Automate | Now | Rules: Form engine form_incomplete; README walkthrough step 2 |
| SUB-03 | The MAR Form takes Items, totals and Documents | Hafiz (TMC engineer) | 1) Fill Description, Model "CoreLine Panel", Specification section "26 51 00". 2) Under Items, Add row twice: "Recessed panel" 200 Pieces and "Surface panel" 40 Pieces. 3) Save and close, then open the Draft again from the list. 4) Add a PDF under Datasheet (PDF) and a JPEG with EXIF under Sample photo. | The total reads 240. Save and close returns to the Submittals list. The Datasheet and Sample photo can be added once the Draft is saved; the photo shows the time and place from its EXIF. The Attachments and Links System Fields sit below the Form. | P3 | Manual | Now | Rules: MAR Form Version 6; README walkthrough step 3 |
| SUB-04 | Send for Review numbers the item and Ali holds it at once | Hafiz (TMC engineer); Ali (TMC PM) | 1) Hafiz: Send for Review on the complete Draft. 2) Ali: open it from the bell. | The item gets a Document Number (first in a fresh seed: TWR-MAR-01-0004) shown left to right. Ali is TMC's only PM, so it is his at once: "With Ali Sonour - TMC Constructions", no Pick up button. Ali's bell shows "Step reached" within seconds. Nothing outside TMC. | P1 | Both | Now | Matrix: 2; Rules: pool of one (ADR 0018), Document Numbers |
| SUB-05 | A Return stays in Internal Review | Ali (TMC PM); Hafiz (TMC engineer) | 1) Ali: Return with the reason "Add emergency duration". 2) Hafiz opens the item. | The item stays in the Internal Review Stage, now at the Contractor Engineer Step, keeps its Document Number and goes back to Hafiz ("With Hafiz Hamdan - TMC Constructions"); it is never a Draft again. The reason is in TMC's history marked internal. Step Age counts from the Return. | P1 | Both | Now | Rules: ADR 0020; Matrix: RP-515-1 |
| SUB-06 | Documents change until the Submit | Hafiz (TMC engineer); Ali (TMC PM) | 1) Hafiz: remove the Datasheet and add a corrected PDF. 2) Send for Review again. 3) Ali opens the item and its Documents. | Hafiz can swap Documents while the item is in TMC. Ali sees the corrected PDF. Documents freeze at the Submit, not before. | P3 | Manual | Now | Rules: Documents freeze at the first Submit |
| SUB-07 | Submit with a Cover Note and an Internal Note | Ali (TMC PM); Ahmed (DCL engineer) | 1) Ali: Submit; Cover Note "Panels for Level 2, as drawing E-201"; Internal Note "Quantities checked against the BOQ"; confirm. 2) Ahmed opens the item. | Stage is Pending Approval. TMC sees "With Design Consultants LLC", never a Consultant's name. Ahmed's history shows the Submit with the Cover Note by "TMC Constructions" (no person); the Internal Note is not there. The Submission Date is set. | P1 | Both | Now | Matrix: 3, 34; Rules: Cover Note, V5, V14 |
| SUB-08 | Pick up and Return to pool in the Consultant pool | Ahmed, Sara (DCL engineers); Mohammed (DCL manager) | 1) Ahmed and Sara open the Submitted MAR. 2) Ahmed: Pick up. 3) Sara refreshes Need My Action and her bell. 4) Ahmed: Return to pool, then Pick up again. | Both Engineers see "not picked up yet: ..." with both names; Mohammed is not in this pool and reads it read-only. After Pick up the item leaves Sara's Need My Action and her unread "Step reached" is withdrawn; Return to pool is offered because the pool has two Members and does not bring the notification back. | P1 | Both | Now | Matrix: 70; Rules: Pick up, ADR 0018 |
| SUB-09 | The Consultant reads the Form and cannot edit it | Ahmed (DCL engineer) | 1) After Pick up, read every Form section, open the Datasheet PDF and the Sample photo. 2) Try to change an answer. | Every answer, the Items table and the total are shown read-only; Documents are frozen; the photo shows time and place. No edit control is offered (the Form is the raiser's). | P2 | Both | Now | Rules: ADR 0019, V13; Matrix: 47 |
| SUB-10 | Send to Manager needs the verification | Ahmed (DCL engineer); Mohammed (DCL manager) | 1) Ahmed: Send to Manager with the verification empty. 2) Answer Sample checked Yes, Matches specification No; leave the Verification note empty. 3) Write the note, set Recommended Code C and an Internal Note. 4) Confirm. | Steps 1 and 2 are refused: the Verification note becomes required when Matches specification is No. After step 4 the item sits with Mohammed, the only Consultant Manager, at once. Ahmed's answers, Recommended Code and Internal Note are in DCL's history only, marked internal. | P1 | Both | Now | Matrix: 7; Rules: V5, Screens (ADR 0019), Recommended Code |
| SUB-11 | Code A closes the item with the final verification | Mohammed (DCL manager) | 1) Open the item; Approve A. 2) Check the Final verification pop-up is filled from Ahmed's reply; Remarks left empty. 3) Confirm. | Remarks are optional with Code A. The item closes Approved, Code A, and accepts no more moves. Download PDF appears (SIG-02). | P1 | Both | Now | Rules: Review Code A; Remarks optional with A |
| SUB-12 | Code B turns each comment into a Comment | Mohammed (DCL manager); Ali (TMC PM) | 1) On a new Submitted MAR, Mohammed: Approve with Comments B with three comment rows and Remarks. 2) Ali opens the MAR and the Snag List. | The MAR closes at Code B. Three Comment items are in the Snag List, raised by Design Consultants and Open with TMC. The MAR page reads "Comments: 3 open / 0 closed". Remarks are required with B. | P1 | Both | Now | Matrix: 8; Rules: Code B, Comment (GLOSSARY) |
| SUB-13 | Code C needs Remarks and Return to Engineer works | Mohammed (DCL manager); Ahmed (DCL engineer) | 1) Ahmed sends a MAR to Mohammed with Matches specification No. 2) Mohammed: Return to Engineer, reason "Check the photometric report". 3) Ahmed sends it again unchanged. 4) Mohammed: Revise and Resubmit C with Remarks empty, then with Remarks. | Return to Engineer gives it back to Ahmed. Code C is refused until Remarks are written, then closes at C with its Remarks and final verification. TMC is offered Create Revision (SUB-15). | P1 | Both | Now | Rules: Remarks required with C; README walkthrough step 13 |
| SUB-14 | Code D offers a replacement, not a Revision | Mohammed (DCL manager); Hafiz (TMC engineer) | 1) Mohammed: Reject D with Remarks. 2) Hafiz opens the closed MAR and chooses Create replacement. | The item closes at D. Hafiz is offered Create replacement (no Revision). The replacement is a new Draft with the same Subject, a Replaces Link to the rejected MAR, and gets a new Document Number with no Rev suffix at its first send. | P2 | Both | Now | Matrix: RP-435-1; Rules: workflow-engine 5.5 |
| SUB-15 | Create a Revision of a Code C item | Hafiz (TMC engineer); Ali (TMC PM) | 1) Open the MAR you took to Code C in SUB-13 (the seeded Cable tray risers item already has an open Rev 1, so it offers no new Revision) and Create Revision. 2) The Draft reads Revision 1, No number yet; change the Model, Save and close. 3) Open the Revision drop-down. 4) Send for Review and have Ali Submit it. | The Draft starts with TMC's answers and the copied Datasheet. The drop-down lists the original and Revision 1 (no number yet); after the Submit it lists the number and the number Rev 1, each whole and left to right. Choosing the original shows its own answers, Code C, Remarks and history. A Revision uses no counter. | P1 | Both | Now | Matrix: 49, 51, 52; Rules: Revision (GLOSSARY) |
| SUB-16 | Delete discards a Draft only | Hafiz (TMC engineer) | 1) On a Draft that never left Draft, row menu > Delete, confirm. 2) On a numbered item look at its row menu. | The confirm says nobody will see the Draft again, Hafiz included, and no number is lost; it leaves the list. A numbered item has no Delete (an issued item is never deleted). | P2 | Both | Now | Matrix: RP-409-3 |
| SUB-17 | Duplicate copies only TMC's own work | Hafiz (TMC engineer) | 1) On a closed MAR that Mohammed answered, row menu > Duplicate. 2) Open the new Draft. | A new Draft with the Subject, TMC's own answers and the Documents and photos TMC uploaded, as new files. None of Design Consultants' verification, Remarks or notes. "Duplicated from" shows the original's number to TMC only. | P3 | Both | Now | Matrix: RP-409-1 |
| SUB-18 | Download gives the item as it last arrived | Ali (TMC PM); Mohammed (DCL manager) | 1) On a Submitted MAR choose Download from the row menu as Ali, then as Mohammed. 2) Try Download on a Draft. | Both get the same content: shared answers, shared moves by Company only, no Step, no person, no Internal Note. A Draft offers nothing to download. | P3 | Manual | Now | Matrix: RP-409-2 |
| SUB-19 | Related submittals and free Links open the other item | Hafiz (TMC engineer) | 1) Open "Emergency lighting control panel - Tower 2". 2) Links: open TWR-MAR-01-0001 from Related submittals and from the free Link. 3) On TWR-MAR-01-0001 scroll to Linked from. | Each Link shows the Document Number (left to right) and Subject and opens the item; a Submitted item cannot be changed. Linked from on the exit signs lists the control panel. Linking notifies nobody. | P2 | Manual | Now | Rules: Link, E1; README walkthrough step 10 |
| SUB-20 | A SAR closed at Code A adds the supplier to the list | Hafiz; Ali; Ahmed; Mohammed | 1) Raise a Supplier Approval Request "UAT SUB-20 Delta Cables" (Electrical), send, Submit. 2) Ahmed picks up and sends to Manager; Mohammed: Approve A. 3) Project Settings > Approved Supplier List. | The SAR runs 2 to 2 and closes. "UAT SUB-20 Delta Cables" is listed for Electrical, approved. A second SAR for the same name in other letter case adds no second entry. A MAR now offers it under Approved supplier. | P2 | Both | Now | Matrix: RP-594-1; Rules: V10 |
| SUB-21 | A DAR ends with the Owner's review | Hafiz; Ali; Mohammed; Noura (Al Waha PM) | 1) Raise a Document Approval Request "UAT SUB-21 Cable schedule", send, Ali Submits. 2) Mohammed recommends Code A to the Owner. 3) Noura opens it and chooses Confirm. | Mohammed's Recommendation goes to Noura, who holds the Owner's review; Confirm issues Code A and closes the item. TMC sees it "With Owner review" until then (VIS-27). | P1 | Both | Now | Rules: ADR 0022; Matrix: RP-596-1 |
| SUB-22 | Watch and Unwatch | Ali (TMC PM) | 1) Open a Submitted MAR; note Watching (raiser and Submitter watch from the start). 2) Unwatch, then Watch again. | The button flips between Watch and Watching. Nobody sees who else watches an item or how many. | P3 | Manual | Now | Matrix: 67 |
| SUB-23 | List: search, filters, Need My Action, sort and columns | Ali (TMC PM) | 1) Submittals List: search by Document Number, Subject, Type, Trade, Location. 2) Filter panel: pick several values for Type, Stage, With, Step Age, Submission Date. 3) Toggle Need My Action. 4) Sort by a column; Columns > move one > Save as my default; reload. 5) Group by Stage. | Results match the filters; Stage counts match the rows; Need My Action keeps only items waiting on Ali (his own Drafts stay in view, uncounted); the saved columns come back after reload; the column header for the holder reads With. | P2 | Both | Now | Rules: List (RP-409, RP-410); V14 |
| SUB-24 | List export holds what the viewer sees | Ali (TMC PM) | 1) Export > what you see > CSV, then Excel. 2) Export the whole table. 3) Search first, then export. 4) Put =1+1 in the Subject of a Draft and export. | Rows and columns equal the screen; the whole table adds every List field; under a search only the rows read so far; a cell that looks like a formula is written as text. | P3 | Manual | Now | Matrix: RP-409-2 |
| SUB-25 | Kanban: columns, counts and moving a card | Ali (TMC PM) | 1) Kanban: columns are the Stages with counts. 2) Drag a card, or use Move to, to a Stage Ali's Step allows. 3) Open the filter panel (Owner, Role, Created date). | Dropping or choosing a move opens the same Action Form as the item page; the card moves after confirm; a move that is not allowed is not offered. Internal Review shows TMC's own Steps with counts (Engineer, PM). The other Company is one lane by its name. | P2 | Both | Now | Matrix: RP-519-1, RP-410-1; Rules: Stage |
| SUB-26 | Project Dashboard: Type cards and Activity Feed | Ali (TMC PM) | 1) Open the Project (Dashboard). 2) Click a number on a Type card. | Type cards show counts over what Ali sees; each number opens the List with the same filter and the same count. The Activity Feed sits beside them; it lists Company names for other Companies and no person of theirs. | P2 | Both | Now | Matrix: 63, 64; Rules: Dashboard |
| SUB-27 | Home: counts, Need My Action list, Recent activity | Ali (TMC PM) | 1) Open Home. 2) Compare Active Projects, Need My Action, My Company 4+ weeks at step, My Company waiting with others and each Project card's submittal count with the Project's List. | Every number equals the sum of the Project reads and opens the matching list; Drafts are never counted as Need My Action; Recent activity shows at most four entries. | P2 | Both | Now | Matrix: RP-407-1, RP-408-1 |
| SUB-28 | Activity Feed page | Mohammed (DCL manager) | 1) Project > Activity Feed after some Submits and Codes. | Entries read as events (submitted, returned, approved) with the Project; TMC appears by Company name only; no answers_changed or Document upload entries. | P3 | Manual | Now | Rules: Activity Feed row |
| SUB-29 | No due dates, deadlines or SLAs anywhere | Hafiz; Mohammed | 1) Visit Home, Projects, Dashboard, List, Kanban, item page and the emails in Mailpit, in EN and AR. 2) Search the page text for due, deadline, SLA, late and every other term GLOSSARY.md lists under Avoid for Step Age (and the Arabic equivalents). | Only Step Age dots (1 to 4+ weeks) show age. No due date, deadline or SLA appears. The List and Kanban headers use the GLOSSARY words: Stage not Status, Trade not Discipline, With not Current owner. | P1 | Automate | Now | Rules: CLAUDE.md, Step Age, V14 |

### 5.2 Workflows (Part WF, label `uat-part-wf`)

Settings pages are read by every Member and changed by Project Admins only. WF-09 makes fixture FX-SB. WF-15 needs the AGE fixture.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| WF-01 | Every Member reads the Project Workflows | Ali (TMC PM); Mohammed (DCL manager) | 1) Project > Settings > Workflows. 2) Open the MAR Workflow and a published Version. | The page lists which Workflow each Work Item Type runs, its Version and every published Version whole, with every Company's Steps and Returns. Neither can open the builder or see a draft. | P2 | Both | Now | Matrix: RP-441-1; Rules: V20, ADR 0016 |
| WF-02 | View workflow on an item pins its Version | Ali (TMC PM) | 1) Open a Submitted MAR; click Workflow: name, Version n. 2) Switch map and list. 3) Open the same item as Ahmed and move it between DCL Steps. | The drawer shows the Version the item is pinned to. Ali's own Steps are shown one by one; Design Consultants is one part marked With Design Consultants LLC. Ahmed sending to Mohammed changes nothing Ali reads. | P2 | Both | Now | Matrix: RP-438-1, RP-426-1; Rules: V14 |
| WF-03 | Duplicate a Rabaed Default into the Project | Saeed (TMC Authorized Person, Project Admin) | 1) Settings > Workflows > duplicate the MAR Workflow as "UAT MAR copy". 2) Open it. | A draft Version 1 of a new Project Workflow with no link to the original. Only Project Admins see it. | P2 | Both | Now | Matrix: RP-427-1; Rules: ADR 0016 |
| WF-04 | Builder: add a Step, connect, undo, auto-layout | Saeed (Project Admin) | 1) Open the copy in the builder. 2) Drag a Step from the palette into a Stage band; connect two Steps by dragging from a dot. 3) Undo and redo (Ctrl+Z, Ctrl+Shift+Z). 4) Auto-layout; switch Curved and Orthogonal arrows. 5) Select a Transition: edit labels (EN and AR), kind, Screen. | Edits autosave a moment later. The kind follows the publish checks (Submit across Participants, Return back within one). A connection onto empty canvas adds a New step. Auto-layout arranges Steps by route inside each Stage band; the arrow style is kept per viewer. | P2 | Manual | Now | Rules: workflow-engine 11 (RP-439, RP-555) |
| WF-05 | Validate reports problems and Publish needs a Change Note | Saeed (Project Admin) | 1) In the copy, leave a Step with no way forward. 2) Validate. 3) Fix it, Publish with no Change Note, then with one. | Validate counts the errors and selects the first; Publish lists what changed, the count of items that keep their Version and requires the Change Note. After publishing the builder stays open. | P2 | Both | Now | Matrix: RP-555-1; Rules: Publish checks |
| WF-06 | A new Version applies to new items only | Saeed; Hafiz; Ali | 1) Bind the published copy to MAR (Settings > Workflows > Use for MAR). 2) Hafiz raises a new MAR. 3) Open an older MAR. | The new MAR runs the new Version; the older item keeps its Version and shows a notice that a later Version exists. Binding another Workflow reaches only items created afterwards. | P1 | Both | Now | Matrix: RP-426-2; Rules: Version, workflow-engine 1 |
| WF-07 | Versions history shows Change Notes and running counts | Saeed (Project Admin); Hafiz | 1) Open the Workflow's Versions page. 2) Compare two Versions. | Newest first with date and Change Note; the N running figure counts only items the reader sees; Compare marks added, removed and changed. Hafiz sees Versions but no Change Note. | P3 | Both | Now | Matrix: RP-555-1 |
| WF-08 | Exception for one Participant must not name it | Saeed (Project Admin) | 1) Copy MAR as "Beta Build MARs" and try to bind it as an exception for Beta Build. 2) Rename it "MARs, short route" and bind it for Beta Build. | The first is refused because the name holds a Participant's name. The second binds; Yousef's new MARs run it, TMC's do not. Others learn of no Participant. | P2 | Both | Now | Matrix: RP-427-4, RP-426-2; Rules: V20 |
| WF-09 | Build a Workflow with a Send Back (fixture FX-SB) | Saeed (Project Admin) | 1) Copy the MAR Workflow. 2) Add a Send Back from Consultant Engineer to the Contractor Draft Step; on the Draft Step set After a Send Back to Comment only (and a second copy to Edit the Form). 3) Validate, Publish, bind. | It validates and publishes. If publish refuses the Send Back, record a Bug: VIS-15 and VIS-16 need this Workflow. | P1 | Manual | Now | Rules: ADR 0014, ADR 0021 |
| WF-10 | Drafts visible to: the author only | Saeed (Project Admin); Hafiz; Omar; Ali | 1) In a copy, set the Draft Step to Drafts visible to the author only; publish and bind. 2) Hafiz saves a Draft. 3) Omar and Ali open the List and the item URL. | Omar and Ali see no Draft, no count, and the 404 page; Hafiz sees and edits it. After Send for Review TMC reads it as before. | P1 | Both | Now | Matrix: RP-514-1; Rules: V1 |
| WF-11 | Transition rules: Restrict, Validate and Effects | Saeed (Project Admin) | 1) In a copy open a Transition > Add rule. 2) Add Restrict by Position, a Validate with a message in EN and AR, an Effect Offer Assign to. 3) Test run the Workflow. | Rules show under Condition with AND between Restrict rules; Test run opens each pop-up in test mode and saves nothing; a Transition whose Restrict fails is not offered. | P3 | Manual | Now | Rules: workflow-engine 4 (RP-430, RP-440) |
| WF-12 | Return goes to the author, not the other engineer | Hafiz; Omar; Ali | 1) Omar (Tower 2 only) and Hafiz both cover a Tower 2 item. 2) Hafiz sends a Tower 2 Draft for review. 3) Ali Returns it. | It goes back to Hafiz, who sent it, not to Omar. | P3 | Both | Now | Rules: ADR 0020, workflow-engine 3.3 |
| WF-13 | Stages and Outcomes pages | Saeed (Project Admin); Ali | 1) Settings > Stages: rename a Stage, add one. 2) Settings > Outcomes. 3) As Ali open the same pages. | Project Admin changes show in the Stage set, List and Kanban columns; Ali reads them and cannot change them. Another Project is unchanged. | P2 | Both | Now | Matrix: RP-441-1, RP-450-1 |
| WF-14 | Library: save, mark default, new Project copies it | Saeed (Authorized Person) | 1) Library > Workflows: Save a Project Workflow to the Library. 2) Mark it default for MAR. 3) Create a new Project. | The Library copy has no link to the original; the new Project starts with a copy as its MAR Workflow, bound. A plain Member sees the Library read-only. | P2 | Both | Now | Matrix: RP-517-1, RP-442-1; Rules: V18 |
| WF-15 | Step Age dots count from the current Step | Ali; Mohammed | 1) Precondition: ask the lane engineer to age two items (fixture AGE) by 1 and by 4 weeks. 2) Read the dots in the List, Kanban and item page for Ali and for Mohammed. | Dots show 1 to 4+ weeks (4+ all red). For the holder's Company they count from the current Step; the other Company counts from when the item reached it. A Draft shows none. No due date appears. | P2 | Manual | Now | Matrix: 35, RP-407-4; Rules: Step Age, V14 |
| WF-16 | Cancel from the raiser's Steps, only until the first Submit | Hafiz (TMC engineer); Ali (TMC PM) | 1) Hafiz: new MAR "UAT ??WF-16 Cancel", Save Draft, Cancel; confirm. 2) Make a second MAR, Send for Review; Ali opens it and Cancels. 3) Make a third, Submit it to DCL; look for Cancel as Ali and Hafiz. | Cancel is offered at the Draft, the Contractor Engineer and the Internal Review Steps and asks for confirmation; the item goes to the Cancelled Stage with no outcome. Once Submitted, Cancel is no longer offered. A Revision never offers Cancel. Carried over from RP-463 B-09 (RP-490). | P2 | Both | Now | Rules: workflow-engine 5.1 Cancel, RP-437; RP-463: B-09 |
| WF-17 | Assign to offers only your own Company's Members | Saeed (Project Admin); Hafiz; Ali | 1) Saeed: in the Project's MAR Workflow (fixture FX-SB copy) add Assign to on Send for Review and on Submit; publish. 2) Hafiz: new MAR, Send for Review, open Assign to. 3) Ali: Submit, open Assign to. | Hafiz is offered only TMC Members who may hold the Contractor PM Step; Ali only TMC Members (never a DCL engineer by name; the Consultant is one Participant). A pick it could not have offered is refused like a made-up one. Carried over from RP-463 B-06 (RP-487). | P1 V | Both | Now | Matrix: RP-431-2; Rules: V14, Refusals row; RP-463: B-06 |

### 5.3 Forms and Screens (Part FRM, label `uat-part-frm`)

Forms are the raiser, Screens are the reply (ADR 0019). Run in English; spot-check labels in Arabic.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| FRM-01 | The three submittal Forms carry the documented fields | Hafiz (TMC engineer) | 1) New Submittal > MAR, then SAR, then DAR. 2) Read each Form top to bottom in EN. | MAR: Manufacturer, Approved supplier (required), Model, Specification section, Description, Items table with total, Datasheet (PDF), Test certificate, Sample photo, Related submittals, Trade, Location, Scopes. SAR and DAR have Forms of their own. Subject and Document Number sit above, Attachments and Links below. | P2 | Manual | Now | Rules: form-engine 2.5 to 2.12 |
| FRM-02 | Required fields to leave Draft | Hafiz (TMC engineer) | 1) Save a MAR Draft with each of Manufacturer, Description, Datasheet, Trade, Location empty in turn. 2) Send for Review. | Manufacturer, Description, the Datasheet, Trade and Location are required to leave Draft; a Draft saves with any missing. Each missing field is named and marked. | P1 | Both | Now | Rules: form-engine 8 |
| FRM-03 | Approved supplier offers the Trade's list only | Hafiz (TMC engineer) | 1) In a MAR choose Trade Civil Works: open Approved supplier. 2) Change Trade to Electrical Works. | Civil offers Al-Rimal Building Materials; Electrical offers Najd Electrical Supplies and Tabuk Cable Industries (and any supplier added since by a SAR or the Project Admin). Changing Trade clears the supplier. | P2 | Both | Now | Matrix: RP-592-1; Rules: form-engine 2.12 |
| FRM-04 | Trade, Location and Scopes are Built-in Fields | Hafiz (TMC engineer) | 1) Pick Location Tower 1, then Floor. 2) Pick Scopes Lighting and Emergency lighting. 3) Try to remove Trade from the Form view. | Locations nest Zone > Tower > Floor; Scopes belong to the Trade. Trade, Location and Scopes cannot be removed or made optional. | P3 | Manual | Now | Rules: Built-in Field (GLOSSARY) |
| FRM-05 | Related submittals offers only Submitted items Hafiz sees | Hafiz (TMC engineer) | 1) In a Draft MAR type "control panel" under Related submittals. 2) Also search for a Draft of Hafiz's own and for Beta Build's item. | Only Submitted items Hafiz sees in this Project appear; no Drafts, nothing in internal review, nothing of Beta Build. A saved id that could not be offered is refused like a made-up one. | P2 | Both | Now | Matrix: 79, 80, 11; Rules: Link search |
| FRM-06 | Photos keep time and place; Take a photo on a phone | Hafiz (TMC engineer) | 1) At 375 px open a Draft MAR; under Sample photo choose Take a photo (or Upload a JPEG with EXIF). 2) Save. 3) Open the photo. | On a phone Take a photo is offered beside Upload. The thumbnail shows, and opening the photo shows the time and place from its EXIF. | P2 | Manual | Now | Matrix: 44; Rules: V13 |
| FRM-07 | Documents freeze at the first Submit | Hafiz; Ali; Ahmed | 1) Hafiz adds and removes a Document in a Draft. 2) After Ali Submits, Hafiz opens the item. 3) Ahmed opens the Documents. | Before the Submit Documents can change; after it they are frozen for everyone and cannot be removed. Ahmed opens them with a short-lived link. | P2 | Both | Now | Rules: Documents (GLOSSARY), File downloads |
| FRM-08 | The Form belongs to the raiser; replies are Screens | Ahmed; Mohammed; Hafiz | 1) Ahmed Send to Manager: read the pop-up fields. 2) Mohammed Approve: read the Code pop-up. 3) Open the Form as Mohammed. | Replies are pop-up Screens (verification, Recommended Code, final verification, Remarks); no Form field is editable by the Consultant. Fields a Screen marks internal never reach TMC. | P2 | Both | Now | Matrix: 47, RP-516-1; Rules: ADR 0019 |
| FRM-09 | Screens: read, edit and publish in Project Settings | Saeed (Project Admin); Ali | 1) Settings > Screens: open Code reply. 2) Edit a copy, publish a new Version. 3) Start a MAR and take it to the Code; compare the pop-up. | Every Member reads Screens; only Project Admins change them. An item already running keeps the Screen Version its Workflow Version pinned; new Workflow Versions pick the new one. | P2 | Both | Now | Matrix: RP-441-1; Rules: V20 |
| FRM-10 | Draft autosave shows Saved and survives a failed save | Hafiz (TMC engineer) | 1) Edit a Draft; watch the Saved time. 2) Go offline in the browser, edit, go online. | The Saved time moves with each save. A failed save is shown clearly with a retry; no edit is lost. | P3 | Manual | Now | Rules: form-engine 8 |
| FRM-11 | Member and Participant fields offer only what the filler may see | Hafiz (TMC engineer) | 1) On an item with a member or participant field (if the Form offers one) open the choices. | Only TMC's own Project Members and TMC and the Host Company are offered; other Companies' people never. After the Submit another Company reads the answer as TMC's name, no person. | P1 | Manual | Not scheduled: no Rabaed Default Form has a member or participant field; arrives with the Form builder | Matrix: 43; Rules: V14, V15 |

### 5.4 Participants and Visibility setup (Part PAR, label `uat-part-par`)

PAR-14, PAR-15 and PAR-16 make the fixtures FX-C2, FX-K1M and FX-OW. Run them before Part VIS.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| PAR-01 | Sign in, wrong password and sign out | Hafiz | 1) Open lane 7 /en/sign-in. 2) Wrong password. 3) Right password (in .env.demo). 4) Sign out. 5) Open a Project URL while signed out. | The wrong password gives one generic refusal. Sign-in opens Home. After sign-out a Project URL goes to sign-in. Cookies are per host (lane7.localhost). | P1 | Both | Now | Rules: sign-in |
| PAR-02 | Invite a Member and accept the invitation | Saeed (Authorized Person); a new person | 1) Members > Invite: a made-up .test email, name EN and AR, language. 2) Open the email in Mailpit and follow the link. 3) Set a password. | The Member appears as invited, then active. The email arrives in Mailpit in the chosen language. The new Member belongs to TMC alone. | P1 | Both | Now | Rules: Member (GLOSSARY), ADR 0009 |
| PAR-03 | An email that belongs to another Company is refused without naming it | Hind (Al Waha Authorized Person) | 1) Members > Invite hafiz.hamdan@tmc.demo.rabaed.test. | Refused: the person is already registered on Rabaed with another Company. TMC is never named and nothing else about Hafiz shows. An email of Hind's own Company gives the ordinary already-a-Member answer. | P1 V | Automate | Now | Matrix: 36; Rules: V17 |
| PAR-04 | Create a Project | Saeed (Project Creator) | 1) Projects > New Project: name EN and AR, code UATP, role Contractor. 2) Open it. | The Project appears with Project Number in TMC's own series; Saeed is its first Project Admin; Host Company is TMC. | P3 | Manual | Now | Rules: Project, Host Company |
| PAR-05 | Trades, Locations and Scopes | Saeed (Project Admin); Ali | 1) Settings > Trades and Locations: add a Trade, a Zone, a Building, a Floor, a Scope and Sub-scope. 2) Ali opens the same page. | Saeed adds; Ali reads Trades, Scopes and Locations and cannot add. Names show in EN and AR. | P3 | Both | Now | Matrix: 40; Rules: V16 |
| PAR-06 | Invite a Company by CR number and accept | Saeed (Project Admin); Layla (DCL Authorized Person) | 1) On a UAT Project invite CR 9999000003 as Consultant. 2) Layla: Company Projects shows the invitation (name, Host Company, offered role). 3) Accept. | Until accepted, only Layla and the Project Admin see it; TMC's other Members do not. After accepting, DCL is a Participant in the role Consultant. | P1 | Both | Now | Matrix: 30; Rules: ADR 0009, V15 |
| PAR-07 | Grant Participant Visibility and read the Visibility Gap warning | Saeed (Project Admin) | 1) Settings > Visibility: give the new Consultant Electrical only. 2) Remove all coverage of Mechanical from every Participant. | The grant saves. A Visibility Gap warning names the value no active Participant covers. It is worked out from Participant grants alone. | P2 | Manual | Now | Matrix: 32; Rules: V16 |
| PAR-08 | The Authorized Person adds a Member to the Project with a Position and Visibility | Layla (DCL Authorized Person) | 1) Participants > the Project > add a Member with Position Engineer. 2) Open the Member's Visibility and narrow to Mechanical only. 3) Try to give a Trade the Participant lacks. | The Member joins the Project. Narrowing saves. A Trade DCL does not cover is rejected (a Member never covers more than their Company). | P1 | Both | Now | Matrix: 23; Rules: V4 |
| PAR-09 | Deactivate a Member: Handover first | Saeed (Authorized Person) | 1) Hafiz holds two Tower 2 MARs at Contractor Engineer (Omar also covers Tower 2) and one Tower 1 MAR (Omar does not cover it). 2) Saeed: Members > Deactivate Hafiz. | The Handover dialog lists his open Steps and Drafts (Project, Document Number or No number yet, Subject, Step). The Tower 2 Steps pre-fill Omar as the single candidate. The Tower 1 Step has nobody else who can take it, so the change is refused with Nobody else can take `<Step>` on `<Project>`. Give someone the Position or Visibility first, naming only TMC's own Step and the Project; nothing saves until every Step has a new holder. | P1 | Both | Now | Matrix: RP-108-1; Rules: ADR 0018 |
| PAR-10 | Participant Codes and Numbering settings | Saeed (Project Admin) | 1) Settings > Numbering: read the pattern and examples. 2) Set a Participant Code (2 to 6 letters or digits). 3) Save a pattern that leaves out the Participant Code. | Examples use the Admin's real next numbers. A code in use cannot change. Leaving out the Participant Code is refused until the shared-counter warning is accepted. | P3 | Both | Now | Matrix: 54, RP-412-1 |
| PAR-11 | Show Inspections inside the Submittals tab | Saeed (Project Admin) | 1) Settings > Modules: choose Inside the Submittals tab. 2) Open Submittals and the Project tabs. | The Inspections tab is hidden; WIRs show in the Submittals List and Kanban with WIR as one more Type. Switching back restores the tab. Only a Project Admin changes it. | P2 | Both | Now | Matrix: RP-652-1 |
| PAR-12 | Approved Supplier List: add and withdraw by hand | Saeed (Project Admin); Hafiz | 1) Settings > Approved Supplier List: add a supplier for Mechanical; withdraw one. 2) Hafiz opens the list. | Entries show name, Trade, Scope and status; a withdrawn one stays listed as withdrawn. Hafiz cannot add or withdraw. No source, person or time shows. | P3 | Both | Now | Matrix: RP-592-1 |
| PAR-13 | Company Projects page | Layla; Hafiz | 1) Open Company Projects (sidebar). | Each Project the Company takes part in shows name, code, number, Host Company, the Company's own Project Role and own Project Members, and pending invitations. Never another Participant. | P2 | Both | Now | Matrix: 28; Rules: V15 |
| PAR-14 | Fixture FX-C2: narrow Beta Build to Tower 2 | Saeed (Project Admin); Yousef | 1) Settings > Visibility: set Beta Build Location to Tower 2 only. 2) Yousef signs in. | The change saves (Yousef holds nothing, so no Handover). Yousef sees only Tower 2 items from then on, and TMC is the only Contractor covering Tower 1, which the Snag scenarios need. | P1 | Manual | Now | Matrix: 24; Rules: V4, V12 |
| PAR-15 | Fixture FX-K1M: Sara covers Mechanical only | Layla (DCL Authorized Person); Sara | 1) Open Sara's Visibility (Participants > Members). 2) Set Trade to Mechanical only. | Sara no longer sees Electrical items and leaves their pools (Handover first if she holds one). Ahmed still covers both. Later scenarios use Sara as the K1 Mechanical-only engineer. | P1 | Manual | Now | Matrix: 4, 22 |
| PAR-16 | Fixture FX-OW: invite UAT Owner Co as Owner | Saeed (Project Admin); Reem UAT (Owner Co Authorized Person) | 1) After ADM-02 onboards UAT Owner Co (CR 9999000005), Saeed invites that CR as Owner on Riyadh Gate Tower. 2) Reem accepts, grants Electrical and Mechanical, all Locations, and adds a PM Member (Sami UAT) with Position Project Manager. | UAT Owner Co is a Participant with oversight over Submitted items it covers. Later Owner scenarios use it. | P1 | Manual | Now | Rules: Owner, oversight (V2) |

### 5.5 Packages (Part PKG, label `uat-part-pkg`)

Nothing is testable yet: written from the Package definition in GLOSSARY.md, spec RP-616 and `design/prompts/packages.md`. Re-read against the final spec before Round 1.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| PKG-01 | Packages is a third view beside List and Kanban | Ali (TMC PM) | 1) Submittals > the view toggle. 2) Choose Packages. | A Packages Kanban with three columns Open, In Progress and Done, each with a count; a New Package button for a Company that can build one; search and filters (Trade, owning Company). Matches packages.html except where spec RP-616 differs. | P2 | Both | RP-588: Packages view and board counts (UI RP-659 to RP-662) | Rules: GLOSSARY Package; design/prompts/packages.md |
| PKG-02 | Open a Package and number it | Ali (TMC PM) | 1) New Package: name EN and AR. 2) Open it. | The Package is numbered PKG-001 (left to right, also in Arabic) beside TMC's name, Open, with no submittals. A second Package is PKG-002. Beta Build's first Package is also PKG-001. | P1 | Both | RP-588: Open Package | Rules: Package numbering per owning Participant |
| PKG-03 | Add submittals from Drafts and review | Ali (TMC PM) | 1) Open an Open Package > Add items. 2) Pick two Drafts and one item in internal review. 3) Try to add an item already in another Package. | Only TMC's own submittals Ali can see are offered, with search and a Trade filter. An item in another Package is marked and cannot be picked. A submittal belongs to at most one Package. | P2 | Both | RP-588: Open Package | Rules: Package |
| PKG-04 | While Open: remove, rename, delete | Ali (TMC PM) | 1) Remove one item. 2) Rename the Package. 3) Delete the Package. | Remove and delete work only while Open; Delete says the Drafts stay, without a Package. Rename is allowed in every status. | P2 | Both | RP-588: Open Package | Rules: Package |
| PKG-05 | Submit Package is all or nothing | Ali (TMC PM) | 1) Add a Draft with a required field missing. 2) Open Submit Package. | A not-ready list names each blocking item (for example required field Supplier missing) and links to it; Submit is disabled until the list is empty. Then one confirm submits every not-yet-submitted item; each gets its own Document Number. If any fails, none is submitted. | P1 | Both | RP-588: Submit Package | Rules: Package |
| PKG-06 | Status runs Open, In Progress, Done | Ali; Mohammed | 1) Submit the Package. 2) Close the items at A, B, C and D over time. 3) Create a Revision for the Code C item and a replacement for D. | In Progress as soon as anything is submitted. Done only when every latest submittal has closed at A, B or D; a Code C waits for its Revision, which joins the Package by itself; a later replacement or added submittal puts it back In Progress. The word is Done, never Closed. | P1 | Both | RP-588: Done status | Rules: Package status |
| PKG-07 | After Submit: add yes, remove no | Ali (TMC PM) | 1) In an In Progress Package add a submittal. 2) Try to remove one. | Adding works; removing is not offered. Rename works and is recorded. | P3 | Manual | RP-588: Open Package; Submit Package | Rules: Package |
| PKG-08 | The Package chip and filter on submittals | Ali (TMC PM) | 1) Open List and Kanban. 2) Use the Package filter. 3) Click the chip on a card and on the item page. | Cards and the item page show PKG-001 with the name; the chip opens the Package page; the filter narrows List and Kanban. Package is not a Form field. | P2 | Both | RP-588: Package filter and Comments | Rules: design/prompts/packages.md |
| PKG-09 | Bulk Transition applies one Action Form to many | Mohammed (DCL manager) | 1) In an In Progress Package select two items waiting on Mohammed that offer the same Transition. 2) Choose it; fill the Action Form once. 3) Repeat with an item that cannot take it. | One Action Form applies to each item (with Assign to if offered). It is all or nothing: if one item cannot take it nothing is done and the message names that item and why. Not offered unless every selected item offers the same Transition. Open question OQ-3 (signing Steps). | P1 | Both | RP-588: bulk Transitions | Rules: Package bulk |
| PKG-10 | One grouped notification counts only what the reader sees | Ahmed (DCL engineer); Sara (Mechanical-only) | 1) Ali Submits a Package of five Electrical and three Mechanical items. 2) Read each engineer's bell and email in Mailpit. | One notification per recipient: TMC Constructions Submitted PKG-nnn Name: n submittals, where n counts only what that person sees. | P1 | Both | RP-588: grouped notification | Rules: Package, V14, Notifications row |
| PKG-11 | Comments show on the Package for information | Ali (TMC PM) | 1) After a Code B on an item of the Package open the Package Comments section. | Comments raised from its submittals are listed with their Stage and the note that Comments are not part of the Package; they do not change its status. | P3 | Manual | RP-588: Package filter and Comments | Rules: Package |
| PKG-12 | A Package is seen only through submittals the viewer sees | Yousef; Ahmed; Sara | 1) Ali builds a Package with Drafts only. 2) Look at Packages as Yousef, Ahmed and Sara. 3) After the Submit look again as Sara (Mechanical-only) and Ahmed. | Another Company's Open Package is never shown (not its name, Drafts or count). After the Submit Ahmed sees all submittals of his Trades; Sara sees only the Mechanical ones and their counts; status shows as one word. Yousef sees nothing. | P1 | Both | RP-588: Packages view and board counts | Rules: Package visibility; V1 |

### 5.6 Signing and Documental Record (Part SIG, label `uat-part-sig`)

SIG-01 to SIG-05 and SIG-06 run now on the tracer record. The rest wait for RP-23. Seal: local on lane 7.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| SIG-01 | Every Transition is confirmed in its pop-up | Ali (TMC PM) | 1) Open any Transition (Submit). 2) Look for a Sign button or checkbox. 3) Confirm. | The pop-up keeps the Transition's own label; there is no separate signing step. Taking it without confirming (API without confirmed true) is refused not_confirmed. After confirm the history records who, from which Participant and when. | P1 | Both | Now | Matrix: RP-436-1; Rules: ADR 0017, workflow-engine 7 |
| SIG-02 | Download PDF on a closed item makes the sealed record | Ali (TMC PM) | 1) Open a closed MAR (Code A) and press Download PDF. 2) Repeat right after the Code, before the worker finishes. | A PDF downloads through a short-lived link. If the record is not made yet the page says it is not ready and to try again in a minute; no partial file. | P1 | Both | Now | Matrix: RP-23-1; Rules: ADR 0023, Documental Record |
| SIG-03 | The tracer record prints title, outcome and approval flow | Ali (TMC PM) | 1) Open the downloaded PDF. 2) Check the title block, outcome and date, Verification Code, link, approval flow, footer. | Type names and code, Subject, Project and Document Number (left to right, Rev included); the outcome with the date; the Verification Code and verification link; each Transition on the path with label, Member, Positions, Company, date and time (Riyadh time) and its content hash; Arabic then English; Latin digits; every page footed Issued electronically through Rabaed, Verification Code, page X of Y. (Page 1 and Form body come with SIG-08.) | P1 | Both | Now | Rules: form-engine 6 as built RP-620 |
| SIG-04 | The record names everyone on the path and leaves out the rest | Ali (TMC PM); Mohammed | 1) Take a MAR through Send for Review, a Return, a second send, Submit with Internal Note, Ahmed Send to Manager with Recommended Code C, Mohammed Code A. 2) Read the PDF. | It names every Member who took a Transition on the path, TMC's and DCL's alike, with the first entry dated at the raiser's last send out of Draft (a Returned send is off the path). It holds no Return, Internal Note, Recommended Code, Chat or in-progress answer. | P1 | Both | Now | Matrix: 10; Rules: V7, ADR 0017 |
| SIG-05 | A Code C, a Code D and a Cancelled item also close with a record | Hafiz; Mohammed | 1) Close one MAR at C, one at D. 2) Download both PDFs. | Each closes with its record whatever the outcome; the outcome in the PDF matches the item. | P3 | Manual | Now | Rules: Documental Record (GLOSSARY) |
| SIG-06 | The record is sealed and a changed copy shows | Ali (TMC PM) | 1) Open the PDF in Adobe Reader. 2) Change one byte of a copy and reopen. | The original shows a seal that is present and intact; the signer is shown as unverified (lane 7 seals locally, RECORD_SEALING=local; Rabaed has no trusted certificate yet, ADR 0023). The changed copy shows the seal broken. | P2 | Manual | Now | Rules: ADR 0023 |
| SIG-07 | Add Signature in the profile (draw, type, upload) | Hafiz | 1) Profile > Add Signature: Draw with finger at 375 px, then Type, then Upload. 2) Save. 3) Replace it. | Pen styles and colours, Clear and Undo; a preview as on a record; once saved the profile shows it with Replace and the note that records already made keep the Signature used then. | P1 | Both | RP-23: Add Signature UI (RP-665, RP-666) | Rules: Signature (GLOSSARY) |
| SIG-08 | Record page 1 and Form body | Ali (TMC PM) | 1) Download a record. 2) Read page 1: Companies, title block, parties, classification, final decision with chips and QR, reply, approval flow, then the Form. | The layout matches form-engine section 6 items 1 to 9; tables and photos print as tables and a photo grid; Documents are listed. | P2 | Manual | RP-23: page 1 and Form body (RP-151) | Rules: form-engine 6 |
| SIG-09 | Company logo and Stamp | Saeed (Authorized Person); Hafiz | 1) Company profile: upload a logo and a Stamp. 2) Hafiz opens the profile. | Two cards, Logo (optional) and Stamp (required to act), with Replace and the note that records keep the one in force then; only the Authorized Person has the buttons. Without a logo records show the name. | P1 | Both | RP-23: logo and Stamp (RP-617) | Rules: Stamp (GLOSSARY) |
| SIG-10 | No Stamp: no Member can act | Hafiz; Saeed | 1) With TMC's Stamp missing, Hafiz opens Submit. 2) Saeed opens it. | Before the Action Form: TMC has no Stamp yet, ask its owner or Authorized Person; for Saeed, Add TMC's Stamp with an Add Stamp button. Only the viewer's own Company is named; nothing is written; nobody is notified. | P1 | Both | RP-23: logo and Stamp (RP-617); Signature cards and Stamps (RP-650) | Matrix: RP-23-5 |
| SIG-11 | No Signature: the Add Signature pop-up | Hafiz | 1) With no Signature saved open any Transition. | Add your Signature to act. Every action you confirm is signed with it. Add Signature goes to the profile and returns to the item with nothing typed lost; Cancel closes. | P1 | Both | RP-23: Add Signature UI (RP-665, RP-666) | Rules: Signature |
| SIG-12 | Signature cards, Stamps, Review Comments, endings and Disclaimer | Ali (TMC PM) | 1) Download a record closed at A, then at C and at D. 2) Read the Signatures, Stamps and ending pages. | One card per Transition on the path with Signature as it was then; the Stamp of every acting Company; Review Comments numbered; a Next step card with Code C (Revision n+1) or D (a new submittal replaces this one); an internal reviewer's card says Reviewed with no Code; the Disclaimer in Arabic and English. | P1 | Manual | RP-23: Signature cards and Stamps (RP-650) | Matrix: RP-23-2; Rules: V7, ADR 0023 |
| SIG-13 | Appendix of Documents | Ali (TMC PM) | 1) Close a MAR with PDF and image Documents and one DWG. 2) Download the record. | Shared PDF and image Documents follow as pages; other files are attached inside the PDF; a Company's internal Documents are not included. | P3 | Manual | RP-23: appendix (RP-147) | Rules: Documental Record row |
| SIG-14 | Record checks catch a bad PDF | Engineer (Rabaed) | 1) Ask a lane engineer to feed a broken record. | A failed check alerts in Rabaed Admin instead of publishing; the item is not reopened. | P3 | Manual | RP-23: record checks (RP-155) | Rules: ADR 0023 |
| SIG-15 | Verification page | Anyone (not signed in) | 1) Scan the QR or open the link. 2) Type the Verification Code with and without the Document Number. 3) Drop a copy of the PDF. | Genuine, Document Number, Subject, Project, outcome, sealed date, signers' names, Positions and Companies; no Documents, answers or live item. The code alone is refused like a wrong code; attempts are limited per visitor; a dropped copy is checked in the browser against the fingerprint, uploading nothing. | P1 | Both | RP-23: Verification page (RP-157) | Matrix: RP-23-4 |
| SIG-16 | Working Copy of an unfinished item | Ali (TMC PM); Mohammed (DCL manager) | 1) While a MAR is with DCL, request a Working Copy as Ali and as Mohammed. 2) Compare the two PDFs. | Both Working Copies are the same: watermarked Not Final / غير نهائي (or the Project text), unsealed, no Verification Code, Companies by name only, no person, no Signature or Stamp. A Draft Working Copy is made only for Members who see the Draft. | P1 | Both | RP-23: Working Copy (RP-621) | Matrix: RP-23-3; Rules: Working Copy row |
| SIG-17 | Distribution link and Signatory Access | Ali (TMC PM); a removed signing Member | 1) Use the record distribution link to send a closed record by the ordinary notification. 2) Remove a signing Member from the Project and open the records they signed. 3) Withdraw a Participant and open its Authorized Person records. | The record reaches people only through ordinary notifications inside Rabaed. A removed Member keeps the Project name and the records they signed; the Company keeps those its Members signed through its Authorized Person; open items of a withdrawn Participant are Cancelled. | P1 | Both | RP-23: distribution link (RP-161); Signatory Access (RP-614, RP-31); Participant withdrawal is not scheduled | Matrix: 13, 14; Rules: E2, V8 |

### 5.7 Snag List (Part SNG, label `uat-part-sng`)

Raising a Snag needs FX-C2 so exactly one Contractor covers the Location (SNG-02). SNG-08 and later wait for RP-28.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| SNG-01 | The Snag List tab: List, Kanban and empty state | Ali (TMC PM) | 1) Project > Snag List. 2) Switch List and Kanban. 3) Use the Types chips (All, Snags, Comments), Stage, Trade, Company and search by number or Subject. | Items are grouped by Stage with counts; type chips and Stage counts count only visible items; an empty list reads No snags. Nice work. Filters with no match say nothing you can see matches. | P2 | Both | Now | Matrix: RP-94-1; Rules: SNAG-8 (RP-94) |
| SNG-02 | The Consultant raises a Snag on the Contractor | Mohammed (DCL manager); Ali (TMC PM) | 1) Needs FX-C2 (PAR-14). 2) Mohammed: Snag List > New Snag: Subject "UAT SNG-02 Cable tray not bonded", Description, Trade Electrical Works, Location Tower 1 Floor 02, a before photo. 3) Raise. | The Snag is Open with TMC (the one Contractor covering Tower 1). With two Contractors covering the Location, Raise is refused with the plain This can not be handed over yet answer (RP-658 adds the pick). | P1 | Both | Now | Matrix: RP-90-4; Rules: ADR 0014, workflow-engine 6 |
| SNG-03 | Contractor moves the Snag through its Steps | Ali; Hafiz (TMC) | 1) Open the Snag. 2) Start work, Put on hold, Resume work, back to Open where offered. 3) Read the Stage and Step Age as Mohammed. | Moves are TMC's internal events: Stage shows In Progress or On Hold inside TMC; Design Consultants sees it Open with Step Age counted from when it reached TMC. A send leaves it in TMC's Step Pool. | P1 | Both | Now | Matrix: RP-90-3 |
| SNG-04 | Resolve with a note, Verify, Close or Return to Open | Hafiz (TMC); Mohammed (DCL) | 1) Hafiz: Resolve with a resolution note (required). 2) Mohammed: Return to Open with a reason. 3) Hafiz resolves again; Mohammed: Close. | Mohammed holds Verify (the raiser). Return to Open goes back to TMC, who resolved it. Closed ends the Snag. Each side reads only the other's shared Transitions. | P1 | Both | Now | Matrix: RP-90-2, RP-622-3 |
| SNG-05 | A Contractor raises a Snag on itself | Ali (TMC PM) | 1) New Snag raised by TMC on its own work. 2) Move it through Start work, Resolve, Verify, Close. | The raiser holds Draft and Verify, so TMC works and closes its own Snag; Design Consultants and Beta Build never see it (informing the Consultant is SNG-09). | P1 | Both | Now | Matrix: RP-622-1, RP-622-2 |
| SNG-06 | Comments from Code B live in the Snag List | Ali (TMC PM) | 1) After SUB-12 open the Comments. 2) Resolve one; Mohammed closes it. 3) Open the MAR. | Each Comment shows Raised from (number, Subject, Code B), is held by TMC, and counts on the MAR: Comments 2 open / 1 closed after one closes. The photo thumbnail is the first photo the viewer may see. | P1 | Both | Now | Matrix: RP-434-1, RP-434-3, RP-624-1 |
| SNG-07 | New offers no Comment type | Ali (TMC PM) | 1) Snag List > New. | The menu offers Snag (and later Site Observation and Question) and not Comment; Comments only come from a Code B. | P3 | Manual | Now | Rules: SNAG-13 (RP-668) |
| SNG-08 | Resolve with after photos | Hafiz (TMC) | 1) Open an Open Snag; add after photos before Resolve; Resolve. | After photos sit with TMC until Resolve, then freeze and show beside the before photos in the record; a Send Back discards them. | P1 | Both | RP-28: SNAG-4 reply photos (RP-623) | Rules: ADR 0024 |
| SNG-09 | Informed Participants | Hafiz; Mohammed | 1) Raise a Snag and name Informed Participants. | The named Participants are told and can read; others are not. | P2 | Both | RP-28: SNAG-3 Informed Participants (RP-625) | Rules: SNAG-3 |
| SNG-10 | Question and Site Observation Types | Mohammed; Hafiz | 1) New > Question; New > Site Observation. | The Type chips appear; each has its own Form and Workflow; Questions have no reviewed item behind them; Site Observation is not called Violation. | P2 | Both | RP-28: SNAG-6 Questions (RP-626); SNAG-5 Site Observation (RP-627) | Rules: GLOSSARY Snag List |
| SNG-11 | Snag detail page | Hafiz; Mohammed | 1) Open a Snag. | Header with number, type, Stage and age; Raised from card; description; photos; actions only for the viewer; history. No due date. | P2 | Both | RP-28: SNAG-9 detail (RP-628) | Rules: design/prompts/snag-list.md |
| SNG-12 | Bulk actions and exports | Ali (TMC PM) | 1) Select several Snags; reassign within TMC; Export Excel. | Bulk applies within TMC only; the export holds exactly the visible rows. | P3 | Both | RP-28: SNAG-11 bulk and exports (RP-629) | Rules: Exports row |
| SNG-13 | Snag List on a phone | Hafiz | 1) At 375 px open the Snag List and raise a Snag with the camera. | Photo-first cards, filters in a sheet, large New button, the camera opens from Take photo; saved as you go. | P1 | Manual | RP-28: SNAG-10 phone (RP-630) | Rules: responsive web (ADR 0004) |
| SNG-14 | Pick the Contractor when two cover a Location | Mohammed (DCL manager) | 1) Leave Beta Build covering Tower 1 as in the seed. 2) Raise a Snag on Tower 1. | The Raise pop-up asks which Contractor; the other never sees it. | P1 | Both | RP-28: SNAG-12 (RP-658) | Rules: RP-658, GLOSSARY Snag |
| SNG-15 | Snag PDF report | Ali (TMC PM) | 1) Snag List > Export PDF report. | A PDF of the visible Snags with photos; no Snag the viewer cannot see. | P3 | Manual | RP-28: SNAG-14 PDF report (RP-677) | Rules: Exports row |

### 5.8 Inspections (WIR) (Part INS, label `uat-part-ins`)

INS-01 to INS-08 run now on WIR Workflow v2 up to Submit and Pick up. Closing a WIR is written for Review Codes (ADR 0025) and waits for RP-673.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| INS-01 | Checklist Templates: create, edit into Version 2, retire | Saeed (Project Admin); Ali | 1) Settings > Checklist Templates > New: name EN and AR, Trade, items with answers, comment and photo rules and Raise a Snag. 2) Save; edit and Save as Version 2. 3) Retire one. 4) Open as Ali. | The two seeded templates (Concrete pour, Cable trays and containment) are listed per Trade with items, Version and availability. Saving makes the next Version and WIRs that copied an earlier one keep its items. Ali reads and cannot change. | P1 | Both | Now | Matrix: RP-651-1; Rules: V20 |
| INS-02 | Required links setting | Saeed (Project Admin); Hafiz | 1) Settings > Required links: turn on Approved submittals required. 2) Hafiz tries to send a WIR without one. | Every Member reads the setting; only a Project Admin changes it. With it on a WIR cannot leave Draft without an Approved submittal and the form names the field. | P2 | Both | Now | Matrix: RP-82-2 |
| INS-03 | Raise a WIR with a Checklist Template | Hafiz (TMC engineer) | 1) New Submittal or Inspections > New > Work Inspection Request: Description, Trade Civil Works, Location, Checklist Template. 2) Look at the preview of items. 3) Change the Trade. | Templates offered are the Trade's active ones, labelled As picked if later retired; changing the Trade clears the pick; before a Trade it says Choose a Trade first. The items are copied onto the WIR. | P1 | Both | Now | Matrix: RP-651-2 |
| INS-04 | Approved submittals offers only Code A or B items | Hafiz (TMC engineer) | 1) In the WIR open Approved submittals. 2) Search an item closed at C and one still open. | Only items closed at Code A or B that Hafiz sees and that were Submitted are offered; a saved id outside that is refused like an unknown option. | P2 | Both | Now | Matrix: RP-82-1; Rules: form-engine 2.13 |
| INS-05 | The pick is fixed once the WIR is Submitted | Hafiz; Ali | 1) Change the Checklist Template before the Submit. 2) After Ali Submits try to change it. | Before the first Submit a new pick replaces the copy. After it, the pick and the copy are fixed. | P3 | Both | Now | Matrix: RP-651-2 |
| INS-06 | Annotate a photo; the original is kept | Hafiz (TMC engineer) | 1) Add a photo to a Draft; open it and annotate (arrow, text label); Save. 2) Switch Annotated and Original. 3) Submit; Ahmed opens it. | The annotated copy is saved beside the original, marked annotated; the original's bytes are unchanged; both download. After the Submit Ahmed reads both; a frozen original takes no new copy. | P2 | Both | Now | Matrix: RP-656-1 |
| INS-07 | Inspections tab and the in-Submittals setting | Ali; Ahmed | 1) Open the Inspections tab (List and Kanban). 2) Turn Inside the Submittals tab on (PAR-11) and open Submittals. | The tab uses the Submittals pages and Stages. With the setting on, WIRs appear in the Submittals List, counts, type filter and Kanban for those who may see them. | P2 | Both | Now | Matrix: RP-652-1 |
| INS-08 | The WIR runs to the Consultant and the Manager | Hafiz; Ali; Ahmed; Mohammed | 1) Hafiz raises a Civil WIR, sends it; Ali Submits it. 2) Ahmed picks it up. | The WIR numbers like a submittal and reaches the Consultant Engineer pool. The Consultant fills the checklist on site (INS-09). | P1 | Both | Now | Rules: ADR 0025 |
| INS-09 | The Engineer answers the checklist on site | Ahmed (DCL engineer) | 1) At 375 px open the WIR: per item Pass, Fail or N/A, comment and photos. 2) Fail an item whose Checklist Template requires a comment and photo. | Large segmented controls; on a Fail the comment and photo show required; a sticky summary like 18 Pass / 2 Fail / 1 N/A with progress; a failed item can raise a Snag (ticked by default). | P1 | Both | RP-27: INSP-4 on-site checklist (RP-86) | Rules: form-engine 3.1; design/prompts/inspection-on-phone.md |
| INS-10 | Raise Snags from failed items | Ahmed; Mohammed; Hafiz | 1) Fail two items, one with Raise a Snag unticked. 2) Mohammed issues any Code. | Whatever the Code, each ticked failed item becomes a Snag raised by the Consultant for the Contractor, linked to the WIR. | P1 | Both | RP-27: INSP-5 Snags from failed items (RP-577) | Rules: form-engine 3 |
| INS-11 | The Manager proposes a Code from the checklist | Mohammed (DCL manager) | 1) Open a WIR with one failed item and one with none. | The pop-up pre-selects C when any item failed, else A; the Manager can change it; each pop-up lists the Snags that will be raised. | P1 | Both | RP-27: WIR v3 codes (RP-673); INSP-4 (RP-86) | Rules: ADR 0025 |
| INS-12 | A WIR ends with a Review Code and a re-inspection Revision | Mohammed; Hafiz | 1) Close WIRs at A, B (with comment rows), C and D. 2) Hafiz creates the Revision after C. | A to D close like a submittal; B makes Comments; C offers a Revision as a re-inspection that copies the same checklist; D closes. No Passed or Failed result is shown for new WIRs. | P1 | Both | RP-27: WIR v3 codes (RP-673); INSP-6 (RP-653) | Rules: ADR 0025, GLOSSARY Inspection Result |
| INS-13 | The Contractor reads the checklist only after the Code | Hafiz; Ahmed | 1) While Ahmed answers, Hafiz opens the WIR. 2) After the Code, again. | Before Ahmed sends it to the Manager Hafiz reads none of the answers, comments or photos; after the Code he reads them. Ahmed's Recommended Code and Internal Note never reach Hafiz. | P1 | Both | RP-27: INSP-4 (RP-86); WIR v3 (RP-673) | Matrix: RP-170-1, 45; Rules: V5 |
| INS-14 | WIR shares Stages with submittals | Ali; Ahmed | 1) With the WIR in Pending Approval open the Kanban. | A WIR sits in the same column as a submittal at the same Stage. | P2 | Both | RP-27: INSP-11 (RP-674) | Rules: ADR 0025 |

### 5.9 Submittal Register Import (Part IMP, label `uat-part-imp`)

Make the registers first: a good .xlsx and .csv (10 rows with Subject, Type, Trade columns), one with 2 bad rows, a two-sheet workbook with title rows, a non-UTF-8 .csv, a PDF, and a file over 2,000 rows.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| IMP-01 | Upload accepts .xlsx and .csv only | Hafiz (TMC engineer) | 1) Submittals > Import register. 2) Upload a .pdf, a non-UTF-8 .csv, a .csv over 2,000 rows, then a good .xlsx. | Each bad file gets its own message (only .xlsx and .csv; save as CSV UTF-8; split into smaller registers). The good file moves to the next step. Cells are read as stored, so 0012 stays 0012 when typed as text. | P2 | Both | Now | Rules: Register Import (GLOSSARY), RP-635 |
| IMP-02 | Pick the worksheet and the header row | Hafiz (TMC engineer) | 1) Upload a workbook with two sheets and 3 title rows above the headings. 2) Choose the sheet and the header row. | The preview shows the first rows; rows above the header are skipped; rows below are read as submittals; an empty or missing header row gets its message. | P3 | Both | Now | Rules: RP-637 |
| IMP-03 | Map columns to Rabaed fields | Hafiz (TMC engineer) | 1) Map Description to Subject, Type to Type, Discipline to Trade. 2) Try Validate with Trade unmapped. 3) Use one value for every row instead. | Subject, Type and Trade are required; unmapped columns are ignored; a fixed value for every row is allowed and shown as such on the import's page. | P1 | Both | Now | Rules: RP-637 |
| IMP-04 | Preview lists every reason per bad row | Hafiz (TMC engineer) | 1) Validate a register with: empty Subject, Subject over 200 characters, unknown Type, Trade not in the Project, a Trade outside Hafiz's Visibility. | Counts show rows checked, ready and left out; each bad row lists all its reasons (Subject empty, Type unknown, Trade not in this Project, Trade is outside your Visibility). Nothing is created yet. | P1 | Both | Now | Rules: RP-637 |
| IMP-05 | Confirm creates Drafts, all good rows or none | Hafiz (TMC engineer) | 1) Confirm a preview with 8 good rows and 2 bad. 2) Open the Submittals List. | Eight Drafts are created, raised by Hafiz, each No number yet; the two bad rows are left out and never created. A change in the Project after the preview gives Something in the Project changed, validate again. | P1 | Both | Now | Matrix: RP-589-1 |
| IMP-06 | The result page and the Imports page | Hafiz; Ali | 1) After confirming read the result: Drafts created, Left out, Open the Drafts. 2) Imports page. 3) Open the import. 4) Ali opens the same page. | Imports are listed by file name only, with no time anywhere. The import page lists every row with its result; a created row links to its Draft only where the viewer sees that Draft. Ali, a colleague, reads the import after confirm (a preview before confirm is its importer's alone). | P2 | Both | Now | Matrix: RP-589-1; Rules: Register Imports row |
| IMP-07 | Imported Drafts follow the Draft rules | Hafiz; Omar; Ali | 1) Open an imported Draft. 2) Read its history as Hafiz. | It is an ordinary Draft: Hafiz edits it, sends it, and it gets its number at the first send. Its created event, internal to TMC, names the import. Under author-only Drafts (WF-10) Omar and Ali cannot see it. | P3 | Both | Now | Matrix: RP-514-1 |
| IMP-08 | Download the rows left out and import again | Hafiz (TMC engineer) | 1) On the result press Download rejected rows. 2) Fix and import again. | The file holds the left-out rows with a reason column; the second import is a new import. | P2 | Both | RP-589: downloads (RP-644) | Rules: RP-631 |
| IMP-09 | Unknown values are matched once per distinct value | Hafiz (TMC engineer) | 1) Map a Trade column holding Elec. on 30 rows. 2) Match Elec. to Electrical Works once. | The match applies to all 30 rows; the preview recounts. | P2 | Both | RP-589: value matching (RP-639) | Rules: design/prompts/register-import.md |
| IMP-10 | Assign to for imported Drafts | Hafiz; Ali | 1) Assign Electrical rows to Hafiz and other rows to Ali, or use an email column. 2) Include a person who cannot create the Type. | Drafts are raised by the importer by default; an assignee who cannot create the Type or does not cover the Trade makes that row bad. | P2 | Both | RP-589: Assign to (RP-640) | Rules: design/prompts/register-import.md |
| IMP-11 | Packages from an import and saved mappings | Hafiz (TMC engineer) | 1) Group rows into one new Package, then one per column value, then an existing Open Package; try an In Progress Package. 2) Save the mapping and reuse it. | New Packages take the next PKG number; an In Progress or Done Package makes its rows bad; the mapping is kept for the Company only. | P2 | Both | RP-589: Packages from import and saved mappings (RP-644); Packages (RP-588) | Rules: design/prompts/register-import.md |
| IMP-12 | A Rabaed Engineer imports for a Company | Engineer (Rabaed Admin) | 1) In Rabaed Admin pick the Project, the Participant, a default Member and a reason; run the import. 2) Hafiz opens the import. | The Drafts are raised by the default Member; TMC's Members read Rabaed as who imported, never the Engineer's name; the reason is kept and the action logged. | P2 | Manual | RP-589: Register Import by a Rabaed Engineer (RP-645) | Rules: V9 |

### 5.10 Notifications (Part NOT, label `uat-part-not`)

Mailpit is at the address in section 2.1. The worker must be running. NOT-06 and NOT-07 need the JOBS fixture.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| NOT-01 | The bell, the Notifications page and Mark all as read | Ali (TMC PM) | 1) After SUB-04 look at the bell badge. 2) Open Notifications; open one entry. 3) Mark all as read. | The badge counts unread; each entry reads Reached you at `<Step>` and opens the item; Mark all as read clears the badge. In-app notifications are always sent: there is no in-app switch. | P2 | Both | Now | Rules: Notifications row |
| NOT-02 | Step reached and Submit notify the right people | Ali; Ahmed; Sara; Mohammed | 1) Ali Submits. 2) Check Ahmed's and Sara's bells and Mohammed's. | Ahmed and Sara (the pool) are told; Mohammed is not until it reaches him; the text names TMC as a Company, never a person. | P2 | Both | Now | Matrix: 3, 70 |
| NOT-03 | Immediate email via Mailpit | Ali (TMC PM) | 1) Open Mailpit (lane 7). 2) Find the email for Step reached. | Subject holds only the Document Number, Subject and what happened; body names the other Company by name only; links open the item; sent as the recipient may see it. | P1 | Both | Now | Matrix: 69 |
| NOT-04 | Email settings per group, Pause all, language | Ali (TMC PM) | 1) Profile & notification settings: set Step reached to Off, then Daily digest, then Immediately. 2) Pause all email. 3) Change the email language. | Groups are Step reached me or my pool, Items I watch, Sent Back to my Participant, Weekly Step Age report; choices Off, Immediately, Daily digest. Paused email stops every email but the bell still fills. The weekly group is emailed on Sunday mornings. | P2 | Both | Now | Matrix: 68 |
| NOT-05 | Mute a Project | Ali (TMC PM) | 1) Mute Riyadh Gate Tower in the settings. 2) Hafiz sends a MAR to Ali. 3) Check bell and Mailpit. | A muted Project sends no notifications or emails; the item still shows as Ali's under Need My Action. | P3 | Both | Now | Rules: Notifications row |
| NOT-06 | Daily email digest | Ali (TMC PM); Yousef | 1) Set an email group to Daily digest. 2) Create events; ask the lane engineer to run the digest job (open question OQ-2). 3) Read Mailpit. | One email per Member: subject names nothing; each entry names another Company only by name; an entry the Member can no longer see is left out; Yousef gets nothing of TMC's. Sent 07:00 Riyadh, Sunday to Thursday. | P1 | Manual | Now | Matrix: 72; Rules: digest (RP-358) |
| NOT-07 | Weekly Step Age report | Ali (TMC PM holding Assign); Yousef | 1) Needs aged items (AGE fixture) and the lane engineer to run the job (OQ-2). 2) Read Ali and Yousef mail and open the link. | Grouped 4+, 3, 2 and 1 weeks; lists only items the reader can open, never an un-numbered Draft; another Company by name only; Yousef lists only Beta Build items; an empty report is not sent; the link opens the List with the same filter. | P2 | Manual | Now | Matrix: 21, 76 |
| NOT-08 | A Revision notifies when it gets its number | Hafiz; Ahmed | 1) Hafiz creates a Revision and keeps it Draft. 2) Sends it for review. 3) After the Submit read Ahmed's bell. | No revision_created notice while it is a Draft; it is sent when the Revision is numbered; Ahmed is told only after the Submit. | P3 | Manual | Now | Matrix: 75 |
| NOT-09 | Sent Back notifies only the Participant it went back to | Mohammed; Hafiz; Faisal | 1) Needs FX-SB (WF-09). 2) Mohammed Sends Back a Submitted item. | Hafiz and TMC Members who see it are told, with DCL named as a Company; Faisal is not told of internal moves. | P1 | Both | Now | Matrix: 71; Rules: Sent Back notification |
| NOT-10 | Emails and the bell follow the Member's language | Faisal (Al Waha, Arabic) | 1) Receive a notification and email as Faisal. | The bell and email are in Arabic with Latin digits; Document Numbers read left to right. | P2 | Manual | Now | Rules: I18N rules |
| NOT-11 | A closed Project goes quiet | Ali (TMC PM) | 1) Close the Project. | No bell entry or email of a closed Project; delivered ones stay readable. There is no close control yet. | P1 | Manual | Not scheduled: Project close is not built (no ticket in the five epics) | Matrix: 15; Rules: RP-360 |

### 5.11 Arabic, RTL and phone width (Part I18N, label `uat-part-i18n`)

Run each in English first, then Arabic, then at 375 px.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| I18N-01 | Switch language keeps the page and mirrors the layout | Faisal; Hafiz | 1) On Home, List, Kanban and an item switch EN to AR with the language button, and open /ar URLs directly. 2) Switch back. | The same page reloads in Arabic with RTL: sidebar, tables, filter panel, Kanban column order, arrows and breadcrumbs mirror. Nothing is cut off. | P1 | Both | Now | Rules: Arabic and English from day one |
| I18N-02 | Latin digits everywhere | Faisal (Arabic) | 1) In /ar read counts, dates, times, Step Age, Dashboard figures, emails and the PDF. | Only Latin digits (0 to 9) appear; no Arabic-Indic digits. Dates are Gregorian; times Riyadh. | P1 | Automate | Now | Rules: CLAUDE.md Latin digits |
| I18N-03 | Document Numbers stay left to right | Faisal (Arabic) | 1) In /ar open the List, an item, a Link, the Revision drop-down, a notification and the PDF. | TWR-MAR-01-0003 Rev 1 reads left to right whole in every place, also inside Arabic text. | P1 | Automate | Now | Rules: CLAUDE.md Document Numbers |
| I18N-04 | Form labels and validation messages in Arabic | Hafiz (Arabic) | 1) Open a MAR Form in /ar; leave Description empty and Send for Review. | Field labels, section titles, Action Form words and the missing-fields message are Arabic; values typed in English are not translated. | P3 | Manual | Now | Rules: form-engine 5 |
| I18N-05 | Arabic-first users sign in to Arabic | Faisal; Noura | 1) Sign in as each. | Their language is Arabic from sign-in (locale set at onboarding); names show in Arabic; they can switch. | P3 | Manual | Now | Rules: seed locale ar |
| I18N-06 | Phone width 375: nothing breaks | Hafiz | 1) At 375 px open Home, Projects, Submittals List, Kanban, an item, Settings, the Workflow builder. | No page scrolls sideways; tables and the Kanban scroll inside their own area; the sidebar opens as a drawer. This is what the build guarantees until the phone designs of RP-422 exist. Note, without failing the scenario, touch targets under 44 px, filters that do not open as a sheet and any cut-off text, as UX recommendations. The same web app, no separate app. | P1 | Both | Now | Rules: ADR 0004, design/prompts/responsive.md |
| I18N-07 | Desktop 1366 and 1920 | Ali | 1) Open Home, List, Kanban, an item at 1366 and 1920 px. | Layout follows the reference screens at both widths (see strategy section 3 for the ui-ux-tester pass). | P3 | Both | Now | Rules: design reference |
| I18N-08 | The not-found page says nothing | Nasser (Beta Build); Hafiz | 1) As Nasser open a Riyadh Gate Tower item URL. 2) Open a made-up URL. 3) Repeat in /ar. | Both show the same page: We can not find this page, it may not exist, or you may not have access, with a Projects button; identical in both languages; never a 403 or a hint which case it is. | P1 V | Automate | Now | Matrix: RP-520-1, 18 |

### 5.12 Rabaed Admin (Part ADM, label `uat-part-adm`)

Rabaed Admin is at the address in section 2.1; sign-in is a password plus a code emailed to the Engineer (Mailpit). ADM-02 makes the Owner Company for FX-OW.

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| ADM-01 | Sign in to Rabaed Admin with a password and an emailed code | Engineer (Rabaed Engineer) | 1) Open Rabaed Admin (lane 7, port 4750) on its own address. 2) Enter email and password. 3) Read the 6-digit code from Mailpit. 4) Enter a wrong code, then the right one. | A code is sent to the Engineer's email; a wrong code is refused; too many codes get a limit message; sign-in succeeds with the right code and a session cookie that is not the Company app's. Credentials of a Member of the Company app do not work here. | P1 | Both | Now | Rules: ADR 0010, Rabaed Admin (GLOSSARY) |
| ADM-02 | Onboard a Company (fixture UAT Owner Co) | Engineer (Rabaed Engineer) | 1) Onboard a Company: legal names EN and AR, CR 9999000005, VAT 399990000000053, Authorized Person Reem UAT (a made-up .test email), language, a reason. 2) Open the invitation in Mailpit and accept as Reem. | The Company and its Authorized Person are created and an invitation emailed; the action is logged with the reason; Reem signs in to the Company app. Needed for PAR-16. | P1 | Both | Now | Rules: V9, Company onboarding |
| ADM-03 | Duplicate CR, VAT or email is refused | Engineer (Rabaed Engineer) | 1) Onboard again with CR 9999000001. 2) Then a new CR with an existing email. | Each conflict is refused naming what clashes (CR number, VAT number or email) and creates nothing. | P2 | Automate | Now | Rules: Company (GLOSSARY) |
| ADM-04 | Onboarding leads and closing a lead | Engineer; Saeed | 1) Saeed (Project Admin) invites a CR number not on Rabaed (PAR-06 variant). 2) Engineer: Show leads (reason), then Close lead (reason). | The CR shows as a lead with Project, Host Company, requested and state. Closing it takes it off the Engineer's list only; Saeed still sees his invitation pending. Both kinds of CR give Saeed the same answer. | P2 | Both | Now | Matrix: 31, 38; Rules: ADR 0009, RP-252 |
| ADM-05 | Option Lists need a reason and never delete | Engineer (Rabaed Engineer) | 1) Create an Option List with three levels. 2) Edit, retire an option (reason each time). | Every edit needs a reason; a retired option stops being offered but stays where it was chosen. | P3 | Manual | Now | Rules: Option List (GLOSSARY) |
| ADM-06 | Numbering for a Project from Admin | Engineer (Rabaed Engineer) | 1) Numbering: enter a Project id and reason, show it. 2) Set a pattern, a Participant Code and a starting number. | The same rules as the Project Admin's; every read and edit needs a reason; Participant Code 2 to 6 letters or digits, fixed once used. | P3 | Both | Now | Matrix: RP-412-1 |
| ADM-07 | Rabaed Default Workflows: save, publish, outcomes and Stages | Engineer (Rabaed Engineer) | 1) Workflows: open MAR; Save draft; Publish with a reason. 2) Add an outcome and a Stage, rename and reorder them. | The builder is the same as in Project Settings; every change is refused without a reason and logged. A new Version reaches only new items; an added outcome or Stage reaches only Projects created afterwards. No Member can open a Rabaed Default draft. | P1 | Both | Now | Matrix: RP-443-1 |
| ADM-08 | Publish is refused while Projects lack an outcome | Engineer (Rabaed Engineer) | 1) Add an outcome to a Type's set; publish a Rabaed Default Version that uses it while the seeded Project lacks it. | Refused with how many Projects and which outcomes or Stages, never which Projects or Companies; nothing publishes; the refusal is logged. | P2 | Manual | Now | Matrix: RP-566-1 |
| ADM-09 | Admin is separate from the Company app | Engineer; Hafiz | 1) Open an Admin URL on the web port and a web URL on the Admin port. 2) Sign out of one. | Different addresses and cookies; the Company app never serves Admin pages. | P3 | Manual | Now | Rules: ADR 0010 |
| ADM-10 | An Engineer fixes a stuck Step | Engineer (Rabaed Engineer) | 1) Open a MAR in Admin; reassign or reset the Step with a reason. | The read and the action are logged with the reason; the Engineer never takes a Transition or changes a Workflow version. | P1 | Manual | Not scheduled: no admin item commands are built (Admin has companies, numbering, option lists and Workflows only) | Matrix: 20; Rules: V9 |

## 6. Visibility block

Visibility is the top requirement. This block is driven by `docs/visibility.md`: its **Scenario matrix** (176 rows: 1 to 81, then `RP-nnn-n`) and its **Leak channels** table.

### 6.1 How the matrix becomes UAT

- Every matrix row that a person can observe through the screens or the API becomes a cross-company check written as **Members of Company X must NOT see ...** or, for an allowed case, **what they see and nothing more**. The Who column names the actors, the people who must see, and the people who must not.
- Rows that share a setup and walk the same journey are grouped into one scenario. Every scenario lists the matrix ids it covers in **Covers** (`Matrix: ...`). Section 6.4 is the reverse index: each of the 176 rows and the scenario that covers it.
- Rows that are purely internal (a column not granted to the app role, a hash column, a crafted Workflow that no screen can build) are in section 6.5 with the test that covers them.
- Rows retired by ADR 0019 (46, 57) have no UAT scenario. Rows 47 and 50 keep a screen check (VIS-38).
- Rows whose feature is not built are real scenarios, marked **Not scheduled** (section 9): 9, 13 to 16, 20.
- Matrix rows 1 to 81 use the matrix Companies; their mapping to the demo is in section 2.3. Where the demo differs, the fixtures of section 2.5 are made first (PAR-14, PAR-15, PAR-16, ADM-02).

A Bug found here is **Highest** priority whatever the rest of the Part says.

### 6.2 What every cross-company check looks at

For every item or setup a scenario creates, log in as each Company that must NOT see it and look in all of these places (the Leak channels): the Submittals List and Kanban, their Stage and filter counts, the Dashboard, Home, search (by Subject and by number), the item by id and its Documents (expect the plain 404 page), the Activity Feed, the bell and Mailpit, an export, and the Link search. A count that differs by even one is a failure. The 404 must be the same page for a hidden item and a made-up id.

### 6.3 Scenario table

| ID | Title | Who | Steps | Expected | Pri | Mode | Waits | Covers |
|---|---|---|---|---|---|---|---|---|
| VIS-01 | A new Draft and a MAR in internal review are TMC's alone | Actors: Hafiz, Ali (TMC). Must NOT see: Yousef (Beta Build), Ahmed, Sara, Mohammed (DCL), Faisal, Noura (Al Waha), Owner PM (UAT Owner Co) | 1) Hafiz saves a Draft MAR "UAT VIS-01 Draft". 2) Each observer: Submittals List, Kanban, Dashboard, Home, Activity Feed, bell, and search for the Subject; note every count. 3) Hafiz sends it for review (Ali holds it); repeat 2. | Observers must NOT see the item in any List, Kanban, count, badge, Dashboard figure, search result, feed entry or notification, before or after the send. Their counts are unchanged by it. | P1 V | Automate | Now | Matrix: 1, 2; Rules: V1 |
| VIS-02 | After the Submit only the covering Consultant and oversight see the MAR | Actors: Ali. Must see: Ahmed (DCL Electrical), Faisal and Noura (Al Waha, oversight), Owner PM (UAT Owner Co). Must NOT see: Sara (Mechanical-only, FX-K1M), Yousef (Beta Build) | 1) Ali Submits an Electrical MAR. 2) Check each person's List, pool, item URL. | Ahmed sees it in the Step Pool; Faisal, Noura and the Owner PM see it read-only as oversight; Sara (Mechanical only) and Yousef (same Trade, other Contractor, V3) get the 404 page, no row and no count. | P1 V | Automate | Now | Matrix: 3, 4, 5, 6; Rules: V2, V3 |
| VIS-03 | Access follows the current grant, not the grant date | Layla (DCL Authorized Person); Sara | 1) With Sara Mechanical-only and an Electrical MAR Submitted, Layla gives Sara Electrical again. 2) Sara opens the List. 3) Layla removes Electrical again. | Sara sees the Electrical items from then on, including earlier ones; after removal she stops seeing them (E2 aside). Layla needs no Handover for a Step Sara does not hold. | P1 V | Both | Now | Matrix: 22; Rules: V12 |
| VIS-04 | Recommended Code, Internal Notes and the verification note never reach TMC | Actors: Ahmed, Mohammed (DCL). Must NOT see: Hafiz, Ali (TMC), Faisal, Noura (Al Waha) | 1) Ali Submits with an Internal Note. 2) Ahmed Sends to Manager with a verification note, Recommended Code A and an Internal Note. 3) Before the Code, read the item history, Activity Feed, bell and List as Hafiz, Ali and Faisal. 4) Mohammed issues Code C with Remarks, a verification note and an Internal Note. 5) Read again. | Before the Code TMC and Al Waha see no change at all: no reply, Recommended Code or Return. After it they read the Code, Remarks and final verification and that Mohammed issued it, never Ahmed's reply, a Recommended Code, an internal_answers entry or any Internal Note; the history numbering has no gap. K1 sees the Submit but never TMC's Internal Note. DCL reads all of its own. | P1 V | Both | Now | Matrix: 7, 34, 48, RP-433-1, RP-516-1, RP-437-1; Rules: V5 |
| VIS-05 | Code B Comments reach the reviewed item's raiser only | Actors: Mohammed (DCL). Must NOT see: Yousef (Beta Build); Sara (Mechanical-only). Must see: Ali, Hafiz (TMC), Faisal (oversight) | 1) Mohammed issues Code B with three comment rows on a TMC Electrical MAR. 2) Yousef: Snag List, counts, Kanban, and each Comment id. 3) Ali resolves one and Mohammed closes it. 4) Read the MAR's Comments line as Sara. | Yousef sees none in the Snag List, counts or Kanban and gets 404 by id; Comments are Open with TMC, raised by DCL, seen by Faisal as oversight; Sara sees neither the MAR nor its Comments; TMC and DCL read 2 open / 1 closed. | P1 V | Automate | Now | Matrix: 8, RP-434-1, RP-434-2, RP-434-3; Rules: V3 |
| VIS-06 | Chat is visible to every Participant that has the item | Ali; Ahmed; Faisal | 1) Ali posts in Chat on a Submitted MAR. 2) Ahmed and Faisal read it. | Both read it; messages cannot be edited or deleted. Chat is not on the closed record. | P1 V | Manual | Not scheduled: Chat is not built (no ticket in the five epics) | Matrix: 9; Rules: V6 |
| VIS-07 | Only people who see a closed item can download its record | Must see: Ali, Ahmed, Faisal, Owner PM. Must NOT see: Yousef (Beta Build) | 1) Mohammed closes a MAR. 2) Each person presses Download PDF on the item and from the List row; Yousef also requests the item id and the record URL directly. | Ali, Ahmed, Faisal and the Owner PM download the same record; Yousef gets the plain 404 page everywhere and no row. A made-up id and an item whose record is not made yet give the same 404. | P1 V | Automate | Now | Matrix: RP-23-1, 10; Rules: V7, Documental Record row |
| VIS-08 | The Record Data inside the PDF holds only what the pages print | Ali (TMC) | 1) Open the PDF's attachments and extract the Record Data XML. 2) Compare each value with the PDF text. | Every value in the XML (Transitions on the path with name, Position, Company, times and hashes; Verification Code and link) is printed in the PDF; the XML holds no Internal Note, Recommended Code, Chat or Return. | P1 V | Manual | Now | Matrix: RP-23-1; Rules: ADR 0023 |
| VIS-09 | A Link to an item the viewer cannot see shows number and Subject only | Actors: Omar (TMC, Tower 2 only); Mohammed (DCL); Yousef (Beta Build) | 1) Hafiz's control panel MAR links the exit signs (Tower 1). 2) Omar opens Links, then the Link. 3) Open the exit signs' own URL as Omar. 4) Mohammed, who sees both, opens the Link. 5) Yousef tries to link the exit signs in his own Draft. | Omar sees only the Document Number and Subject; the Link opens on its own page with only You are not allowed to see the details of this item; the response holds no item id and the item URL is 404. Mohammed gets the item. Yousef is never offered the exit signs. | P1 V | Automate | Now | Matrix: 11, 12, 81, RP-521-1; Rules: E1 |
| VIS-10 | Linked from lists Submitted items by number and Subject only | Actors: Mohammed (DCL); Ali, Hafiz (TMC) | 1) Hafiz links his Draft MAR-2 to the Submitted MAR-1. 2) Mohammed reads MAR-1's Linked from. 3) Hafiz Submits MAR-2; read again. 4) Needs FX-C2: Mohammed raises a Snag that links MAR-1; Hafiz reads MAR-1's Linked from. | MAR-2 is not listed while it is a Draft or in internal review, then appears. Hafiz sees Mohammed's item as number and Subject; opening it says he may not see its details; its answers, history and Documents stay hidden and its URL is 404. | P1 V | Automate | Now | Matrix: 78, 77; Rules: E3 |
| VIS-11 | Link search never offers what the linker cannot see | Hafiz; Yousef | 1) As Hafiz search for an item to link. 2) As Yousef search for the same Subjects. 3) Via the API save a Link to a Beta Build item id from TMC. | Hafiz is offered only Submitted items he sees in this Project: no Drafts, nothing in internal review, nothing of Beta Build, nothing from another Project. Yousef is never offered TMC's item. The saved Link is refused like a made-up id. | P1 V | Automate | Now | Matrix: 79, 80, 60; Rules: Link search |
| VIS-12 | A Revision Draft is hidden; the drop-down lists only what the viewer sees | Actors: Hafiz (TMC). Must NOT see: Mohammed, Faisal | 1) Hafiz creates Revision 1 of a Code C MAR and keeps it Draft. 2) Mohammed and Faisal open the original: drop-down, Links, and the Revision URL. 3) Hafiz Submits it. 4) Hafiz discards another Draft Revision and creates it again. | Before the Submit the drop-down lists only the original, there is no Link to the Draft and its URL is 404. After it both Revisions are listed and the original shows its own answers, Documents and history. A discarded Revision never reaches Mohammed; the re-created one is Rev 1 again. | P1 V | Automate | Now | Matrix: 51, 52, 56, 49; Rules: V1 |
| VIS-13 | A Revision moved to another Location: each oversight Member sees only theirs | Actors: Hafiz (TMC); Faisal (Tower 1 only), Noura (Tower 2 only) after Hind narrows them | 1) Hind narrows Faisal to Tower 1 and Noura to Tower 2 (fixture FX-OR). 2) Hafiz makes Rev 1 of a Tower 1 MAR, moves it to Tower 2, names the original in a link question and Submits it. 3) Both read the original, Rev 1, Links, Linked from and the drop-down. | Faisal sees the original but no Link to Rev 1 and a drop-down with the original only; Noura sees Rev 1 with no Link, Linked from or link answer naming the original and a drop-down with Rev 1 only. Neither shows even a number or title of the other. | P1 V | Manual | Now | Matrix: 62 |
| VIS-14 | After a Send Back (Comment only) everyone sees the item as it was | Actors: Hafiz (TMC). Observers: Mohammed (DCL), Faisal, UAT Owner PM | 1) Needs FX-SB (WF-09, Comment only). 2) Ahmed Sends a Submitted MAR Back. 3) Hafiz tries to change an answer, add a Document and a Link. 4) Observers read the item, Documents, Links and Link search. 5) Hafiz Submits again. | Hafiz cannot change anything (Sent back for comment). Observers see the item exactly as at the Send Back; the item is still offered in Link search and in Linked from with the same number and Subject. After the new Submit they see everything. | P1 V | Both | Now | Matrix: 58, 59, RP-580-1; Rules: V19 |
| VIS-15 | After a Send Back (Edit the Form) the raiser changes stay private | Actors: Hafiz (TMC). Observers: Mohammed, Faisal (Tower 1 only), Noura (Tower 2 only), UAT Owner PM | 1) Needs FX-SB with the Edit the Form setting and FX-OR. 2) Sent Back item at Tower 1: Hafiz changes an answer, adds a Document, a datasheet and a checklist photo, swaps a Link from X to Y, moves it to Tower 2. 3) Observers read it through List, Kanban, filters, search, item, Documents, Links, history, feed, bell. 4) Hafiz Submits again. | Until the Submit observers see the item, Documents, Links, Trade, Location and Scopes as they were at the Send Back; new Documents are 404 to them; Faisal (Tower 1) keeps the item and Noura (Tower 2) does not see it; no history entry or notification shows a change. After the Submit the new values apply to everyone: Faisal loses it and Noura gains it. | P1 V | Both | Now | Matrix: 71, RP-582-1, RP-582-2; Rules: V19 |
| VIS-16 | Creation Date, Submission Date and saved times stay inside TMC | Actors: Hafiz, Ali (TMC). Observers: Ahmed, Mohammed (DCL) | 1) Hafiz saves a Draft, sends it, Ali Submits. 2) Compare the item page and List for TMC and for DCL; look at the ids in the address bar and in links. 3) Check the order of un-numbered Drafts. 4) Needs AGE for the date checks. | TMC sees Creation Date (when it got its number) and Submission Date; DCL sees only the Submission Date and no Creation Date in any form. Ids carry no time. Un-numbered Drafts come last, ordered by Subject. Answer times and Saved read the Creation Date or later; a Revision follows its own Creation Date. The stored earlier times are covered by the automated suite. | P1 V | Both | Now | Matrix: 61, 73, 74, 75, RP-392-1, RP-392-2, RP-399-1; Rules: Creation Date row |
| VIS-17 | Step Age and With are counted per Company | Actors: Ali (TMC); Ahmed, Mohammed (DCL) | 1) Ali Submits. 2) Ahmed picks it up, sends to Manager, Mohammed Returns it to Ahmed. 3) Ali reads With, the Stage, Step Age and the workflow drawer. 4) Needs AGE: age the item 5 weeks inside TMC, then Submit. | Ali sees With Design Consultants LLC and Step Age counted from the Submit, no reset, no internal move. DCL Step Age runs from when the item reached DCL (week 1), not the five weeks inside TMC; four weeks later it counts for DCL. No Step or person of the other Company appears. | P1 V | Both | Now | Matrix: 35, RP-407-4; Rules: V14 |
| VIS-18 | Dashboard counts follow what the viewer may see | Hafiz, Ali (TMC); Ahmed (DCL); Yousef (Beta Build) | 1) Fresh seed, MAR card: note Ali, Ahmed and Yousef. 2) Hafiz saves two more Drafts and sends one for review. 3) Mohammed Codes C one Submitted MAR; Hafiz creates Rev 1 and keeps it Draft; compare the Revision line. 4) Compare again. | Fresh seed: Ali Pending 2 (0002 and 0003 Rev 1, one per chain) and In preparation 1 (the seeded Draft); Ahmed Pending 2 and no In preparation figure; Yousef 0 of everything. After step 2 Ali In preparation 3 and Pending unchanged; Ahmed and Yousef unchanged. DCL card shows awaiting revision while TMC card shows Revision in progress; each chain counts once; Yousef Revision line holds nothing of TMC. | P1 V | Automate | Now | Matrix: 63, 64, 65; Rules: Dashboard row |
| VIS-19 | List and Kanban counts, lanes and filters hide the other Company | Actors: Ali (TMC); Ahmed, Mohammed (DCL); Yousef (Beta Build) | 1) With a TMC item picked up by Mohammed and another in TMC internal review, Ali and Ahmed open the filter panel (Owner, Role, Created date) and the Kanban. 2) Yousef opens Kanban and List. | Owner offers each viewer their own Company people and the other Company by name only; filtering by the other Company person finds nothing. Role offers only the viewer own Steps. The TMC Internal Review column names its Steps with counts; DCL sees none of them. Created date is the Creation Date for TMC and the Submission Date for DCL. Yousef counts cover only Beta Build items. | P1 V | Automate | Now | Matrix: 17, RP-519-1, RP-410-1; Rules: Lists row |
| VIS-20 | Search finds nothing inside answers or replies | Ali (TMC); Mohammed (DCL) | 1) Mohammed issues a Code with Remarks containing the word zircon. 2) Ali and Mohammed search zircon in List and Kanban. 3) Search the owner name and a Floor name. | No result for zircon: Search never reads answers or replies. Search by Document Number, Subject, Type, Trade, Location and the raiser Company works; an owner phrase finds the viewer own Company people and the other Company by name only. | P1 V | Automate | Now | Matrix: 66, RP-410-1; Rules: Search row |
| VIS-21 | Watch is private and ends when the viewer loses sight | Ali (TMC); Ahmed (DCL); Faisal (Al Waha) | 1) Ali, Ahmed and Faisal watch a MAR. 2) Read each page for any list or count of watchers. 3) Hind narrows Faisal off the MAR Trade. 4) Mohammed issues Code A. | Each sees only their own Watching; no list or count of watchers. After narrowing Faisal gets no notification, in-app or email, of the Code. | P1 V | Automate | Now | Matrix: 67, 68; Rules: Watch row |
| VIS-22 | Notifications and emails reach only Members who see the item | Actors: Mohammed (DCL). Must see: Hafiz (TMC raiser). Must NOT receive: Yousef (Beta Build), Sara (Mechanical-only) | 1) Mohammed issues Code B on a TMC MAR. 2) Open Mailpit: the mail to Hafiz. 3) Look for any mail or bell entry for Yousef and for Sara. | The subject of Hafiz's mail holds the Document Number, Subject and Code B only; Design Consultants is named as a Company and the final signer as the one person; no DCL internal step or Recommended Code. Yousef and Sara get nothing, in-app or email. | P1 V | Automate | Now | Matrix: 19, 69; Rules: Notifications row |
| VIS-23 | Who holds an item: pool names stay inside the holding Company | Actors: Ali, Hafiz (TMC); Ahmed, Sara, Mohammed (DCL) | 1) Ali Submits a MAR: it waits in DCL pool of two Engineers. 2) Ali reads With on the item, List and Kanban. 3) Ahmed picks it up; Sara and Ali read again. 4) Mohammed issues Code B; the Comments wait in TMC pool. | Ali reads With Design Consultants LLC and never the pool names, the holder or a Pick up event, in the item, List, Kanban, history, feed or notifications. DCL reads the pool names then the holder. Mohammed reads TMC by name only, even while the Comments wait in TMC pool. | P1 V | Automate | Now | Matrix: 70, RP-513-1; Rules: V14, ADR 0018 |
| VIS-24 | The Owner review: With Owner review and the Recommended Code | Actors: Mohammed (DCL); Noura (Al Waha PM, holds the review); Hafiz, Ali (TMC); UAT Owner PM | 1) Raise a DAR; Ali Submits; Mohammed recommends Code B with a table of comments to the Owner. 2) Hafiz and Ali read the item everywhere. 3) Noura Sends Back; Mohammed recommends C; Noura Confirms. 4) The UAT Owner PM reads the item at each step. | While Noura reviews, TMC reads With Owner review (no Company name) in the List, search, Kanban lane, item, workflow map and weekly report, and no Code anywhere (not in History, feed, bell, Dashboard). Mohammed and Noura read the Recommended Code; the UAT Owner PM (Owner, not holder) reads none until it is issued. Confirm issues the Code for everyone; Comments with B come from Mohammed rows and are held by TMC; Code C offers a Revision. | P1 V | Both | Now | Matrix: RP-593-1, RP-593-2, RP-593-3, RP-598-1, RP-596-1; Rules: ADR 0022, V14 |
| VIS-25 | The workflow map folds the other Company into one block | Ali (TMC); Ahmed, Mohammed (DCL); UAT Owner PM | 1) Ali and the Owner PM open View workflow on a Submitted MAR. 2) Ahmed sends it to Mohammed. 3) Read the map again. | Both read the whole Version with every Company Steps, but the item is With Design Consultants LLC over DCL part: no DCL Step is marked and the Ahmed to Mohammed move changes nothing they read. DCL sees Mohammed Step marked. | P1 V | Both | Now | Matrix: RP-438-1, RP-426-1; Rules: V14, V20 |
| VIS-26 | Workflow authoring is 404 for everyone but the authors | Ali (TMC PM, not Project Admin); Layla (DCL Authorized Person); Nasser (Project Admin of JCV only) | 1) Each opens the builder URL of Tower Workflow and tries Duplicate, Save, Publish and Bind on it. 2) Nasser also tries a JCV Workflow URL pasted under the Tower Project. | Every attempt gets the plain 404 naming nothing and changes nothing; a Rabaed Default is 404 in the builder to Project Admins; a made-up id gives the same 404. Binding to another Project Workflow or a Library Workflow is 404 for the Project Admin too. | P1 V | Automate | Now | Matrix: RP-427-1, RP-427-2, RP-439-1; Rules: V20 |
| VIS-27 | Draft Workflows and exception bindings are not public | Saeed (Project Admin); Ali, Yousef, Ahmed | 1) Saeed saves a draft of a Tower Workflow and a draft renaming a running Workflow. 2) Bind Beta Build MARs to an exception Workflow (WF-08). 3) Ali, Yousef and Ahmed open Settings > Workflows and the API. | Nobody but the Project Admin reads a draft; the rename stays hidden until published; everyone reads published Versions whole. TMC and DCL read the exception Workflow as a definition but never its binding; only Yousef and the Project Admin learn which Participant it binds. | P1 V | Both | Now | Matrix: RP-427-3, RP-427-5, RP-426-2, RP-427-4; Rules: V20 |
| VIS-28 | A Company's Library is private until used on a Project | Saeed (TMC Authorized Person); Layla (DCL); Hafiz; a Company on no shared Project | 1) TMC saves a Workflow and a Form to its Library and marks a default. 2) Layla and Hafiz open Library and Settings. 3) Use it on Tower. | DCL sees only its own Library; Hafiz lists TMC published Library Workflows read-only; nobody browses another Company Library; a Form appears to others only once used on Tower, and can then be copied; Library Workflow URLs of TMC are 404 to DCL. | P1 V | Both | Now | Matrix: RP-442-1, RP-517-1, 39; Rules: V18 |
| VIS-29 | Change Notes and running counts never leak | Saeed (Project Admin); Hafiz; Yousef | 1) Publish with a Change Note naming Beta Build on an exception Workflow. 2) Hafiz and Yousef each raise a Draft. 3) Reopen the publish dialog and Versions. | The Change Note naming a Participant on an exception is refused; N items keep their Version counts only the items the reader sees; only authors read Change Notes. | P1 V | Both | Now | Matrix: RP-555-1; Rules: V20 |
| VIS-30 | Another Project or a non-admin cannot read or change Tower setup | Ali (TMC PM, not Project Admin); Layla (DCL Authorized Person); Nasser (Project Admin of JCV) | 1) Each opens Tower Settings: Scopes add, rename, deactivate; numbering counters; Workflow settings; Visibility. 2) Saeed (Project Admin) does the same. | Ali, Layla and Nasser get the plain 404 for every change and for the numbering counters; the Scope is unchanged. Saeed can do them. Every Project Member reads Tower Trades, Scopes, Locations and published Workflows. | P1 V | Automate | Now | Matrix: 40, 55, RP-441-1; Rules: V16, V20 |
| VIS-31 | A Participant never sees the list of other Participants | Hafiz (TMC, not Project Admin); Ahmed (DCL); Saeed (Project Admin) | 1) Hafiz and Ahmed open Company Projects and the Project Participants page. 2) Saeed opens the Participants. 3) Open Settings > Numbering as Hafiz and as Ahmed. | Hafiz sees TMC own Participant, its role, its Project Members and the Host Company name; Ahmed sees DCL own Participant with Host Company TMC; neither lists the others. Saeed sees every Participant. Numbering shows each their own Participant with No code yet and no order number; Project Admin sees all orders. | P1 V | Automate | Now | Matrix: 28, 29, RP-381-1; Rules: V15 |
| VIS-32 | Pending invitations: one answer whatever the CR number | Saeed (Project Admin); Layla (DCL Authorized Person); Hafiz | 1) On a UAT Project invite a CR on Rabaed (DCL, 9999000003) and a made-up CR 9999000099. 2) Hafiz looks for DCL anywhere. 3) Layla opens Company Projects. 4) Saeed withdraws both invitations. | Both invitations show on Saeed list by CR number only and read the same; Hafiz sees DCL nowhere; Layla sees only the invitation (Project name, Host Company, offered role); after the withdrawals both leave Saeed list in exactly the same way and DCL list too; nothing shows which CR number was on Rabaed. | P1 V | Automate | Now | Matrix: 30, 31, 38; Rules: ADR 0009, RP-252 |
| VIS-33 | Member Visibility pages belong to their own Company | Hafiz (TMC); Saeed (Project Admin); Layla (DCL Authorized Person) | 1) Hafiz opens DCL Participant page and Ahmed Visibility page by URL. 2) Saeed does the same. 3) Layla, not yet a Project Member, opens her Participant page. | Hafiz and Saeed get the 404 for DCL Member Visibility; Saeed does see DCL Participant grant. Layla sees only the Trades and Locations DCL covers (with the Locations above, such as Tower 1 > Floor 02) and the Scopes under those Trades, and nothing else of the Project. | P1 V | Automate | Now | Matrix: 25, 26, 27; Rules: V16 |
| VIS-34 | Narrowing has limits and Handover tells only counts across Companies | Layla (DCL Authorized Person); Saeed (Project Admin); Mohammed (DCL manager) | 1) Layla gives Ahmed a Trade DCL does not have. 2) Mohammed holds an Electrical MAR at DCL review; Saeed narrows DCL off Electrical. 3) Saeed narrows DCL Locations from all to Tower 1 only, then widens DCL back to all. | 1) Rejected: a Member never covers more than the Participant. 2) Refused with only 1 Step of DCL needs a new holder first. Ask DCL to hand them over; never the Step, item or Member; nothing changes. 3) After narrowing, DCL engineers cover Tower 1 only; widening the Participant again does not widen them. | P1 V | Both | Now | Matrix: 23, 24, RP-108-3; Rules: V4, V16 |
| VIS-35 | Visibility Gap warnings show only what the viewer is entitled to | Saeed (Project Admin); Layla (DCL Authorized Person) | 1) DCL covers Mechanical but no DCL Member is granted it. 2) Saeed opens Settings > Visibility. 3) Layla opens her warnings. | Saeed sees no gap and nothing of how DCL splits coverage; Layla is warned that no DCL Project Member covers Mechanical. Other Participants Members never count towards it. | P1 V | Automate | Now | Matrix: 32, 33; Rules: V16 |
| VIS-36 | A refused Submit gives one answer for every reason | Ali (TMC PM) | 1) Submit an Electrical MAR when (a) no Consultant covers Electrical, (b) two Consultants cover it, (c) the covering Consultant has nobody with the Position. Set each up in Settings > Visibility and Positions. | Submit is not offered and taking it gives the same answer in all three cases: This cannot be handed over yet: the next step has nobody to take it. Ask a Project Admin. Nothing names a Consultant or says which case it is. | P1 V | Both | Now | Matrix: 37; Rules: V14, V16 |
| VIS-37 | Documents and photos follow the item's visibility | Actors: Hafiz (TMC). Must NOT see: Yousef (Beta Build), Ahmed (DCL, before the Submit), a TMC Member off the Project | 1) Hafiz attaches a datasheet and a geotagged photo to a Draft MAR. 2) Each other person requests the Documents list, a download URL and tries to upload or remove, by the item page and by the API. 3) Ali Submits. 4) Ahmed and Yousef again. | Before the Submit Yousef, Ahmed and the off-Project Member get the 404 (same as a made-up id) naming nothing. After it Ahmed sees and downloads the Documents and photo with time and place, and TMC as the uploader Company, not the engineer; Yousef still gets 404 for the list and the URLs. | P1 V | Automate | Now | Matrix: 41, 44; Rules: File downloads row, V13 |
| VIS-38 | After the Submit only the Step holder changes anything | Ali (TMC PM); Hafiz; Ahmed | 1) With the MAR at Consultant review, Hafiz and Ali try to save an answer, add a Document and edit a Link. 2) Ahmed tries to change an answer. | All refused: after the Submit the Form is the raiser own and read-only to everyone but the raiser at a Step that lets it edit; the Consultant answers only in its reply Screen. | P1 V | Both | Now | Matrix: 50, 47; Rules: ADR 0019 |
| VIS-39 | Document Numbers and numbering counters do not reveal a rival volume | Hafiz (TMC); Yousef (Beta Build); Ahmed (DCL); Saeed (Project Admin) | 1) Hafiz and Yousef each raise and number three MARs. 2) Compare their numbers. 3) Saeed saves a pattern without the Participant Code. 4) Hafiz, Yousef and Ahmed open Settings > Numbering and the counter URLs. | TMC numbers run 0001, 0002, 0003 with no gaps from Beta Build. The shared-counter pattern is refused until Saeed accepts the warning; then both share one count. Hafiz, Yousef and Ahmed see examples built from their own Participant with sequence 1 and a 404 for counters. Version history names the saver Company only to its own Members and the Project Admin; others read A Project Admin. | P1 V | Automate | Now | Matrix: 53, 54, 55, RP-412-1, RP-412-2, RP-412-3; Rules: Document Numbers row |
| VIS-40 | A Code D replacement is invisible while it is a Draft | Actors: Hafiz (TMC). Must NOT see: Mohammed (DCL), Faisal, UAT Owner PM | 1) Mohammed rejects a MAR with Code D. 2) Hafiz creates the replacement and keeps it Draft. 3) The others read the rejected MAR Links, Linked from, History and search. 4) Hafiz sends and Ali Submits it. | While it is a Draft nobody else reads anything of it and the rejected MAR Links and Linked from do not name it; it takes a new Document Number at its first send (no Rev). Once Submitted it appears in the rejected MAR Linked from by number and Subject and lists the rejected MAR under Links. | P1 V | Automate | Now | Matrix: RP-435-1; Rules: E1, E3 |
| VIS-41 | The Handover list shows only the Authorized Person's own Company | Saeed (TMC Authorized Person, not a Project Member in the seed); Omar (TMC); Layla (DCL Authorized Person); Hafiz, Mohammed | 1) Hafiz holds two Tower 2 MARs at Contractor Engineer; Mohammed holds one at DCL review. 2) Saeed deactivates Hafiz and reads the Handover list. 3) Saeed picks Omar. 4) Saeed tries to deactivate Mohammed. 5) Layla deactivates Mohammed. | Saeed lists only TMC Steps and Members. As he sees none of these items, each is listed as An item at `<Step>` on `<Project>`, with no Subject, Document Number or item id. Omar is the candidate; after the pick Omar sees and edits both. Deactivating Mohammed is 404 for Saeed, and no pick names another Company Step. For Layla the refusal (Mohammed is the only Manager) names only DCL own Step and the Project. | P1 V | Both | Now | Matrix: RP-108-1, RP-108-2; Rules: ADR 0018 |
| VIS-42 | Home sums only per-Project reads the Member already has | Yousef (Beta Build); Hafiz, Ali (TMC); Mohammed (DCL); Faisal (Al Waha) | 1) With TMC items in every state (Draft, internal review, Submitted to DCL and OR, Sent Back, Code A, Code C Rev 1) open Home as each. 2) Compare each figure with that Member List and the Projects page. | Yousef: Need My Action 0, 4+ weeks 0, no row or activity of TMC (TMC only as Host Company on the card). Hafiz Draft never counts or lists. Waiting with others counts TMC own items others hold (not Drafts, closed or Sent Back); DCL and OR count 0. Each Project card count equals that Member List count. | P1 V | Automate | Now | Matrix: RP-407-1, RP-407-2, RP-407-5, RP-407-6, RP-407-7, RP-407-8, RP-408-1 |
| VIS-43 | Export, Download and Duplicate respect the viewer | Actors: Hafiz, Ali (TMC); Mohammed (DCL); Yousef (Beta Build); a signed-in stranger | 1) With Drafts, a Submitted item picked up by Mohammed and a closed Code C item, Hafiz and Mohammed Export the List (also with a search). 2) Ali and Mohammed Download. 3) Mohammed tries Duplicate. 4) Yousef and the stranger try Download and Duplicate by id. | Each export holds exactly that viewer rows and fields (Creation Date for TMC only; the owner is Mohammed to DCL and DCL by name to TMC); Download gives the same shared content to both; Duplicate is refused for Mohammed (one word for every reason) and 404 for Yousef and the stranger. | P1 V | Automate | Now | Matrix: RP-409-1, RP-409-2, RP-409-3 |
| VIS-44 | Members page counts only the viewer own Company Projects | Saeed (Authorized Person); Hafiz (plain Member); Layla | 1) Saeed opens Members. 2) Hafiz opens it. 3) Layla opens hers. | The Projects column counts each own Member active Projects (the same for Saeed and Hafiz, who read nothing but the count); never DCL people or Projects; DCL list holds DCL people only. | P1 V | Automate | Now | Matrix: RP-413-1; Rules: V14, V15 |
| VIS-45 | The Approved Supplier List is Project-wide but hides its source | Yousef (Beta Build); Ahmed (DCL); Layla (DCL Authorized Person); Saeed | 1) After a SAR closes at A (SUB-20), Yousef and Ahmed read the list and raise a MAR choosing the supplier. 2) Look for the SAR, its Links, who added it, when. 3) Layla and Nasser try to add, withdraw or read Tower list. | Every Project Member reads name, Trade, Scope and status (a withdrawn one as withdrawn); never the SAR, its person, its time or its source; Yousef MAR answer reads the supplier name; Layla and Nasser (not Project Admins or not on Tower) get 404 and nothing changes. | P1 V | Automate | Now | Matrix: RP-592-1, RP-594-1, RP-598-2; Rules: V10 |
| VIS-46 | Inspections shown inside Submittals reveal nothing extra | Hafiz, Ahmed (see the WIR); Yousef (Beta Build, other Trade or Location) | 1) Saeed turns Inside the Submittals tab on (PAR-11). 2) A Submitted TMC WIR exists. 3) Each reads the Submittals List, counts, type filter, search, Kanban, Need My Action, Projects page count and the WIR URL. | Hafiz and Ahmed see the WIR in all of them; Yousef sees it in none and gets 404 by id. The setting widens where own rows show, never which rows. | P1 V | Automate | Now | Matrix: RP-652-1; Rules: V3 |
| VIS-47 | Required links and Approved submittals reveal only definitions | Saeed (Project Admin); Hafiz; Ahmed; Nasser (JCV) | 1) Saeed turns Approved submittals required on for Tower. 2) Nasser does the same on JCV. 3) Everyone reads Tower setting and tries to change it. 4) As Ahmed (Mechanical inspector) open a Tower WIR with a Link to an Electrical Code A MAR he cannot see. | Every Tower Member reads which links are required, never JCV; nobody reads who set it or when; only Saeed changes it, others get 404. Ahmed (not covering the MAR Location) sees its Document Number and Subject only and cannot open it; the Project Admin gets its id. | P1 V | Both | Now | Matrix: RP-82-1, RP-82-2; Rules: E1, V20 |
| VIS-48 | An annotated photo has exactly the readers of its original | Hafiz (TMC); Ahmed (DCL); Yousef (Beta Build) | 1) Hafiz annotates a photo on a MAR and Saves. 2) Ali Submits. 3) Ahmed lists and downloads both; Yousef requests the list, both URLs and an annotate call. | TMC and DCL list and download both copies, the annotated linked to the original whose bytes are unchanged; Yousef gets 404 for everything, as for a made-up id; the file store refuses either file without a signed URL. | P1 V | Automate | Now | Matrix: RP-656-1; Rules: File downloads row |
| VIS-49 | A WIR Recommended Result or Code stays inside the Consultant | Ahmed, Mohammed (DCL); Hafiz, Ali (TMC); Faisal; Yousef | 1) Ahmed sends a WIR to Mohammed recommending Failed (later: Code C) with an Internal Note; Mohammed Returns it; Ahmed sends it again; Mohammed issues the Code. 2) TMC and OR read history, feed, events. | DCL reads the Recommended Code and Internal Note; TMC and OR read none of it before or after the issued Code, only the Code and the Manager shared reply; Yousef reads nothing of the WIR. | P1 V | Both | RP-27: WIR v3 codes (RP-673); INSP-4 (RP-86) | Matrix: RP-170-1 |
| VIS-50 | A Snag raised on one Contractor is invisible to the other | Mohammed (DCL); Ali (TMC); Yousef (Beta Build, Tower 2 only after FX-C2) | 1) Mohammed raises a Snag (Electrical, Tower 1, photos) and TMC moves it In Progress. 2) Yousef opens the Snag List, its counts, Kanban and filters (Company, Raised from, Comment Type), the Snag by id, history, Links and Documents. | Yousef sees the Snag nowhere and the filters offer only his own Company; Raised from offers nothing; a Comment raised from a source Yousef cannot see is not named by number. By id everything is 404. | P1 V | Automate | Now | Matrix: RP-90-1, RP-94-1; Rules: V3 |
| VIS-51 | Snag Steps are shared only as Transitions | Hafiz (TMC); Mohammed (DCL) | 1) TMC moves the Snag Start work and Resolve with a note. 2) Mohammed reads the history. 3) Mohammed holds Verify. | Mohammed reads TMC Resolve and its note, never Start work, internal moves or who picked it up; TMC reads DCL Raise, never its Draft or who holds Verify. | P1 V | Automate | Now | Matrix: RP-90-2; Rules: V5 |
| VIS-52 | A Snag stays with the Contractor that holds it | Ali (TMC); Yousef (Beta Build); Mohammed (DCL) | 1) Mohammed raises a Snag on Tower 1. 2) Saeed widens Beta Build to cover Tower 1 too. 3) TMC resolves it; Mohammed Returns it to Open. | Every move including the Return stays with TMC; Yousef never sees the Snag by id or in the Snag List; a new Raise on a Location both cover is refused. | P1 V | Automate | Now | Matrix: RP-90-4, RP-622-3; Rules: V3 |
| VIS-53 | A Snag a Contractor raises on itself is invisible to the others | Ali (TMC); Mohammed (DCL); Yousef | 1) Ali raises a Snag on TMC itself and takes it to Closed. 2) Mohammed and Yousef look in the Snag List and by id at every Step. | Neither sees it at any Step from Draft to Closed; not by id, history or Workflow map; no count changes. | P1 V | Automate | Now | Matrix: RP-622-1, RP-622-2; Rules: V1, V3 |
| VIS-54 | Raised-from counts include only items the viewer sees | Ali (TMC PM); an Electrical-only TMC engineer; Yousef | 1) Mohammed raises a Snag on Tower 1 and two Snags are linked raised from it, one Electrical and one Mechanical. 2) Each reads the source Snags line. 3) Mohammed raises a Snag at a Location only Yousef covers. | The PM counts 2 open; the Electrical-only engineer sees the Mechanical Snag nowhere and counts 1; a discarded Draft is never counted; Yousef counts only Snags he sees. | P1 V | Automate | Now | Matrix: RP-624-1, RP-624-2 |
| VIS-55 | Checklist Templates are Project definitions; copies follow the WIR | Saeed (Project Admin); Hafiz; Ahmed; Yousef; Nasser | 1) Saeed creates and edits a Checklist Template; Nasser keeps one on JCV. 2) Everyone reads Tower templates and tries to change them. 3) Hafiz picks a Checklist Template on a WIR; Saeed edits it; Hafiz Submits. | Every Tower Member reads Tower templates, nobody reads who wrote or retired them or when, and never JCV; only Saeed changes them; the WIR copy is read by TMC only until the Submit, then by DCL, still Version 1 items; Yousef reads no row. | P1 V | Automate | Now | Matrix: RP-651-1, RP-651-2; Rules: V20 |
| VIS-56 | A Register Import is its Company's alone | Hafiz, Ali (TMC); Yousef, Nasser (Beta Build); Ahmed, Mohammed (DCL); Faisal | 1) Hafiz uploads and previews a register. 2) Ali tries to read the preview. 3) Hafiz confirms. 4) Everyone opens the Imports page and the import by id. | Before confirm only Hafiz reads the preview. After it every TMC Member reads the import, its file name, mapping and rows; Beta Build, DCL and Al Waha see an empty Imports page and the 404 for the import and its confirm; none of its Drafts; no import time anywhere. | P1 V | Automate | Now | Matrix: RP-589-1; Rules: Register Imports row |
| VIS-57 | The Activity Feed names other Companies only by name | Yousef (Beta Build); Ahmed, Mohammed (DCL); Ali (TMC) | 1) After a Submit, a Pick up, an internal Send to Manager, a Return and a Code, each person opens Project > Activity Feed and Dashboard Recent activity. | Ali sees TMC people and DCL by name only; Ahmed sees DCL people and TMC by name only; nobody sees the other Company internal events, Internal Notes, Recommended Codes, answers_changed or Document uploads; Yousef sees only Beta Build items. No setup changes appear. | P1 V | Automate | Now | Rules: Activity Feed row, V14 |
| VIS-58 | Direct URLs and ids give the same 404 page, never a 403 | Nasser (JCV); Yousef; Hafiz | 1) Nasser opens a Tower Project, Submittals list and item URL; then a made-up id for each. 2) Yousef opens a TMC item id and a TMC Comment id. 3) Compare status, page and wording. 4) Make the web app and API calls for the same. | The pages are identical for existing-hidden and made-up (one heading, We can not find this page, a Projects button); the API answers byte-identical 404s; nothing says whether the item exists. IDs are random and cannot be guessed. | P1 V | Automate | Now | Matrix: 18, RP-520-1; Rules: Direct URL row, ADR 0015 |
| VIS-59 | Errors and refusals never name another item or Company | Yousef (Beta Build); Hafiz | 1) Yousef submits a link to a TMC id, picks a hidden Member id through the API, opens a Link page by a TMC Link id, and saves a Form with a hidden reference. 2) Read every error text and API body. | All refusals are the plain, uniform answer; no title, number or Company of another item appears in an error, toast or log shown to the Member. | P1 V | Automate | Now | Matrix: 80; Rules: Errors row |
| VIS-60 | Rabaed Default Workflows are readable by all and name no Company | Hafiz; Nasser | 1) Both open the list of Rabaed Default Workflows for a submittal Type. | Both read the same eight Workflows with names and Versions and the one the Type runs marked; they name no Project, Company or item; a Project binding reaches that Project only. | P1 V | Automate | Now | Matrix: RP-596-2; Rules: V20 |
| VIS-61 | Derived values hide what the column hides | Yousef; Ahmed; Ali | 1) Filter, sort and page the List by Step Age and by Created date as Ahmed and Yousef while TMC has a long-lived Draft and aged items. 2) Inspect the item detail and exports. | No filter, sort key, cursor or detail field reveals when TMC Draft was started or how long TMC worked on an item; Draft shows no Step Age to anyone. | P1 V | Both | Now | Matrix: RP-515-1; Rules: Derived values row |
| VIS-62 | Files Module and Pins on shared Drawings | Mohammed; Yousef | 1) Open Files; open a shared floor plan with Pins. | Work Item folders only for visible items; Pins only of visible items. Not built yet. | P1 V | Manual | Not scheduled: Files, Drawings and Plan View are not built (no ticket in the five epics) | Matrix: 16; Rules: Files Module and Pins rows, V11 |
| VIS-63 | Removed Members, withdrawn Participants and closed Projects | Removed engineer; Layla; Any Member | 1) Remove a signing engineer from the Project. 2) Withdraw DCL. 3) Close the Project. | E2: the removed Member keeps the Project name and the records they signed; DCL Authorized Person sees only the records DCL Members signed; open items of a withdrawn Participant are Cancelled; a closed Project is read-only with E2 records available. | P1 V | Manual | Not scheduled: Participant withdrawal, Project close and Signatory Access (RP-614) are not built | Matrix: 13, 14, 15, RP-407-3; Rules: V8, E2 |
| VIS-64 | Another Project is invisible both ways | Hafiz (TMC); a Member of another seeded Project | 1) As Hafiz note an item id of Riyadh Gate Tower. 2) Sign in as a Member who is not on that Project (or Hafiz on a Project he is not on): open Projects, Home, search, the item URL and the Project URL. | Neither sees the other Project in Projects, Home counts, search or notifications; both URLs give the one not-found page (404, never 403). Carried over from RP-463 A-11 (RP-474). | P1 V | Automate | Now | Matrix: 18; Rules: layer 2, Direct URL row; RP-463: A-11 |

### 6.4 Matrix coverage: every row and the scenario that covers it

Rows 1 to 81 and the `RP-nnn-n` rows of `docs/visibility.md`, in the order of the matrix.

| Row | Scenario (shortened) | Covered by |
|---|---|---|
| 1 | C1 engineer saves a Draft MAR | SUB-01, VIS-01 |
| 2 | C1 sends the MAR to its PM (internal review) | SUB-04, VIS-01 |
| 3 | C1 PM submits the MAR (Electrical) | SUB-07, NOT-02, VIS-02 |
| 4 | Same (who: K1 Mechanical-only engineer) | PAR-15, VIS-02 |
| 5 | Same (who: C2) | VIS-02 |
| 6 | Same (who: OR (Electrical)) | VIS-02 |
| 7 | K1 engineer recommends Code A to their manager | SUB-10, VIS-04 |
| 8 | K1 manager issues Code B with 3 comments | SUB-12, VIS-05 |
| 9 | C1 PM posts in Chat | Not scheduled (VIS-06) |
| 10 | Documental Record of the MAR | SIG-04, VIS-07 |
| 11 | C2 creates an Inspection linking C1's approved MAR | FRM-05, VIS-09 |
| 12 | K1 creates an Inspection linking an item outside the inspector's Visibility | VIS-09 |
| 13 | C1 engineer who signed is removed from the Project | SIG-17, VIS-63 |
| 14 | C1 is withdrawn | SIG-17, VIS-63 |
| 15 | Project closed | Not scheduled (NOT-11, VIS-63) |
| 16 | K1 places a Snag Pin on the shared Building A plan | Not scheduled (VIS-62) |
| 17 | Submittals Kanban for C2 | VIS-19 |
| 18 | C1 member opens `/work-items/{C2 item id}` | I18N-08, VIS-58, VIS-64 |
| 19 | Email notification for Code B on the C1 MAR | VIS-22 |
| 20 | Rabaed Engineer opens the MAR to fix a stuck Step | Not scheduled (ADM-10) |
| 21 | Weekly Step Age report | NOT-07 |
| 22 | Consultant engineer later granted Mechanical | PAR-15, VIS-03 |
| 23 | K1's Authorized Person gives a K1 engineer a Trade K1 doesn't have | PAR-08, VIS-34 |
| 24 | Project Admin narrows K1 from Tower 1 to Building A | PAR-14, VIS-34 |
| 25 | C1 member opens K1's Visibility, or a K1 engineer's | VIS-33 |
| 26 | Project Admin (C1 Company) opens a K1 engineer's Visibility | VIS-33 |
| 27 | K1's Authorized Person, not a Project Member, narrows a K1 engineer | VIS-33 |
| 28 | C1 member opens the Project's Participants | PAR-13, VIS-31 |
| 29 | Project Admin opens the Project's Participants | VIS-31 |
| 30 | K1 invited to the Project, not yet accepted | PAR-06, VIS-32 |
| 31 | Project Admin enters a CR number that isn't on Rabaed | ADM-04, VIS-32 |
| 32 | K1 covers Mechanical, but none of K1's engineers is granted Mechanical | PAR-07, VIS-35 |
| 33 | Same (who: K1 Authorized Person) | VIS-35 |
| 34 | C1 PM Submits the MAR with an Internal Note | SUB-07, VIS-04 |
| 35 | K1 engineer sends the Submitted MAR to the K1 PM, who returns it to the engineer | WF-15, VIS-17 |
| 36 | C2's Authorized Person invites the email of a C1 Member | PAR-03 |
| 37 | C1 PM Submits an Electrical item when (a) no Consultant covers it, (b) two do, or (c) the | VIS-36 |
| 38 | Project Admin withdraws two pending invitations: one to a CR number not on Rabaed, one to | ADM-04, VIS-32 |
| 39 | K1's Library has two Forms; one is used on Project "Tower" | VIS-28 |
| 40 | A C1 member who isn't a Project Admin, K1's Authorized Person, or the Project Admin of ano | PAR-05, VIS-30 |
| 41 | C1 engineer attaches a datasheet to a Draft MAR; C2, K1 and a C1 member off the Project as | VIS-37 |
| 42 | A Member of Project A reads Documents with the database role directly | Automated suite only (section 6.5) |
| 43 | C1 engineer fills a `member` and a `participant` field on a MAR, then C1 Submits it | Not scheduled (FRM-11) |
| 44 | C1 engineer takes site photos into a MAR's `photos` field; C1 Submits it; C2 asks for its | FRM-06, VIS-37 |
| 45 | C1 engineer fails an item of a MAR's `checklist` field and attaches its evidence photo and | INS-13 |
| 46 | Retired (ADR 0019, RP-437): no Form has a section another Participant fills. A Draft MAR i | Retired. Retired by ADR 0019: no Form has a section another Participant fills. Seam 1 form-sections.test.ts, mar-form-v4.test.ts. |
| 47 | Retired (ADR 0019, RP-437): K1 answers in its reply, never in the Form; its Send to Manage | SUB-09, FRM-08, VIS-38 |
| 48 | K1 issues Code C with Remarks and the final verification of its Code Screen | VIS-04 |
| 49 | C1 creates a Revision of the MAR that got Code C | SUB-15, VIS-12 |
| 50 | A C1 Member saves answers into C1's own sections while the MAR is at `consultant_review` | VIS-38 |
| 51 | C1 creates Rev 1 of a MAR that got Code C and saves it as a Draft | SUB-15, VIS-12 |
| 52 | C1 Submits Rev 1 | SUB-15, VIS-12 |
| 53 | Project "Tower" counts MARs by Participant Code (the Rabaed Default) | VIS-39 |
| 54 | The Project Admin saves a pattern whose sequence leaves out the Participant Code | PAR-10, VIS-39 |
| 55 | A C1 member, or K1, asks for the Project's numbering counters | VIS-30, VIS-39 |
| 56 | C1 discards a Draft Rev 1, then creates the Revision again | VIS-12 |
| 57 | Retired (ADR 0019, RP-437): K1 has no section to save into before it Sends the item Back; | Retired. Retired by ADR 0019: nothing of the Consultant is put back. Rows 58 to 60 and 71 cover what remains. |
| 58 | K1 Sends a Submitted item Back to C1, and C1 works on it for three days | VIS-14 |
| 59 | While the item is Sent Back, C1 removes its Link to X and adds one to Y | VIS-14 |
| 60 | C2 searches for an item to link, before and after C1's item is Sent Back | VIS-11 |
| 61 | C1 engineer starts a Draft on 10 Feb, sends it for review on 12 Feb, and the C1 PM Submits | VIS-16 |
| 62 | C1 moves Rev 1 to Building B, names the original in its link question and Submits it | VIS-13 |
| 63 | Dashboard of "Tower": C1 has 2 Drafts and 1 MAR in internal review, and 4 Submitted open M | SUB-26, VIS-18 |
| 64 | MAR-0001 got Code C; C1 raises Rev 1 and keeps it in Draft | SUB-26, VIS-18 |
| 65 | C2 opens the Submittals Dashboard | VIS-18 |
| 66 | K1 issues a Code with Remarks, then C1 searches for a word in them | VIS-20 |
| 67 | A K1 engineer and the C1 PM both watch the MAR | SUB-22, VIS-21 |
| 68 | A watching OR Member's Visibility is narrowed off the MAR's Trade; K1 then issues Code A | NOT-04, VIS-21 |
| 69 | K1 issues Code B on C1's MAR; the email to the C1 raiser | NOT-03, VIS-22 |
| 70 | K1 engineer picks up a pooled MAR | SUB-08, NOT-02, VIS-23 |
| 71 | K1 Sends a Submitted item Back to C1's Draft; C1 adds a datasheet, a sample photo, a check | NOT-09, VIS-15 |
| 72 | Daily digest the morning after K1 issues Code B on C1's MAR; an OR engineer watching two i | NOT-06 |
| 73 | As in 61; K1 decodes the MAR's id, and the ids of its Links, from the api, a URL or a noti (who: K1; C1) | VIS-16 |
| 74 | As in 61; the C1 engineer saved answers on 10 and 11 Feb. The C1 PM opens it on 13 Feb; K1 (who: C1 PM; K1; C1) | VIS-16 |
| 75 | C1 raises Rev 1 of a MAR that got Code C on 3 Mar, works on it, and sends it for review on | NOT-08, VIS-16 |
| 76 | Weekly Step Age report while C1 has an un-numbered Draft and a MAR in internal review | NOT-07 |
| 77 | K1 submits a Work Item linking C1's MAR | VIS-10 |
| 78 | C1 links its Draft MAR-2 to its submitted MAR-1 | VIS-10 |
| 79 | C1 searches for an item to link | FRM-05, VIS-11 |
| 80 | A C1 caller saves a link to a C2 item id, or to an item in another Project | FRM-05, VIS-11, VIS-59 |
| 81 | K1 reads the answers of an item whose link question points at an item K1 can't see | VIS-09 |
| RP-392-1 | C1 engineer saves a Draft on day 1; it is numbered on day 3, and later sent back (to its D | VIS-16 |
| RP-392-2 | C1 creates a Revision on day 5 and sends it for review on day 7 | VIS-16 |
| RP-399-1 | As in 61; C1 adds a Document and a Link on 10 Feb. Later a Revision gets a new Document du (who: C1 PM; K1 (api and app database role)) | VIS-16 |
| RP-381-1 | The Tower has three Participants, none with a Participant Code; K1's manager and a C1 engi | VIS-31 |
| RP-412-1 | Tower's Project Admin (C1, the Host Company) saves the Project pattern twice, gives the MA | PAR-10, ADM-06, VIS-39 |
| RP-412-2 | C1 has issued two MAR numbers; a C1 engineer, a C2 engineer and a K1 manager open Project | VIS-39 |
| RP-412-3 | A C2 member who is also a Project Admin saves Tower's pattern; a Rabaed Engineer saves ano | VIS-39 |
| RP-430-1 | K1's manager sends a MAR to the Manager step, then picks it up; its Approve says "not the | Automated suite only (section 6.5) |
| RP-430-2 | A K1 Transition's rule asks whether the item has been through C1's Contractor review (whic | Automated suite only (section 6.5) |
| RP-430-3 | K1's Reject says "all Comments closed"; a Comment raised from the MAR is a C1 Draft, later | Automated suite only (section 6.5) |
| RP-431-1 | K1's Send to Manager sets K1's own Verdict and Reviewed on in its reply; Approve copies it | Automated suite only (section 6.5) |
| RP-431-2 | C1's engineer sends a Draft for review with "Assign to"; C1's PM Submits with "Assign to" | WF-17 |
| RP-433-1 | K1's engineer sends a Submitted MAR to the Manager step recommending Code A, with an Inter | VIS-04 |
| RP-516-1 | Tower's Code A shows the Screen "Code reply": Remarks shared, a verification note (and a c | FRM-08, VIS-04 |
| RP-435-1 | K1 closes C1's MAR with Code D; C1's engineer creates a replacement (a new Draft linked "r | SUB-14, VIS-40 |
| RP-436-1 | The C1 engineer sends a MAR for review, the C1 PM Returns it and later Submits it, and a K | SIG-01 |
| RP-426-1 | "Tower" runs its own copy of the MAR Workflow; K1 keeps another Workflow in its Library; a | WF-02, VIS-25 |
| RP-426-2 | The Project Admin binds C2's MARs to an exception Workflow | WF-06, WF-08, VIS-27 |
| RP-427-1 | A C1 member who isn't a Project Admin, K1's Authorized Person, and the Project Admin of an | WF-03, VIS-26 |
| RP-427-2 | Tower's Project Admin binds the MAR to another Project's Workflow, to a Workflow in a Comp | VIS-26 |
| RP-427-3 | Tower's Project Admin saves a draft of Tower's own Workflow | VIS-27 |
| RP-427-4 | The Project Admin binds C2's MARs to an exception Workflow named after C2's Company, then | WF-08, VIS-27 |
| RP-427-5 | Tower's Project Admin copies a Workflow into Tower and saves its draft; later, on a publis | VIS-27 |
| RP-438-1 | C1 Submits a MAR and the K1 engineer sends it to the K1 manager; C1 opens "View workflow" | WF-02, VIS-25 |
| RP-434-1 | K1's manager closes C1's Submitted item with Code B and three comment rows: three Comments | SNG-06, VIS-05 |
| RP-434-2 | Same (who: K1; C1; OR (Electrical)) | VIS-05 |
| RP-434-3 | Same; C1 resolves one and K1 closes it (who: K1 Mechanical-only engineer; C1 PM; K1) | SNG-06, VIS-05 |
| RP-513-1 | C1 (TMC) has one engineer and two PMs, K1 one manager. A MAR Submitted to K1 is held at on | VIS-23 |
| RP-108-1 | C1's Ali Sonour holds a MAR at C1's internal review; K1's Hafiz holds another C1 MAR at K1 | PAR-09, VIS-41 |
| RP-108-2 | C1's Ali Sonour holds two items at C1's internal review, one Electrical, one Mechanical; C | VIS-41 |
| RP-108-3 | C1's only PM holds a MAR at C1's internal review; K1's only manager holds another at K1's | VIS-34 |
| RP-514-1 | C1 (TMC) runs a Workflow whose Draft Step is "Drafts visible to: the author only". Hafiz, | WF-10, IMP-07 |
| RP-525-1 | K1 replies on Screens that keep fields internal: Code B's table of Comments internal to K1 | Automated suite only (section 6.5) |
| RP-515-1 | C1 (TMC) runs a Workflow whose Return stays in Internal Review. Hafiz starts a Draft and l | SUB-05, VIS-61 |
| RP-437-1 | A MAR on the Rabaed Default MAR Workflow Version 3: C1's PM Submits it with a Cover Note a | VIS-04 |
| RP-520-1 | Nasser opens a Riyadh Gate Tower URL (a Project or item he may not see) and a made-up URL | I18N-08, VIS-58 |
| RP-521-1 | As in 12: K1's Mechanical manager opens the Link from a Mechanical MAR to C1's Electrical (who: K1 Mechanical manager; K1 manager; C2) | VIS-09 |
| RP-439-1 | Tower's Project Admin copies the MAR Workflow into Tower; another Project's Project Admin | VIS-26 |
| RP-519-1 | C1 (TMC) runs a Workflow whose Internal Review Stage has two Steps, Contractor Engineer an | SUB-25, VIS-19 |
| RP-517-1 | TMC's Authorized Person marks a Workflow, a Screen and a Form in TMC's Library as its defa | WF-14, VIS-28 |
| RP-450-1 | Tower's Project Admin duplicates and publishes a Workflow, adds a Stage and an outcome, an | WF-13 |
| RP-407-1 | C1 has items Submitted to K1 and in its own internal review; C2 (a second Contractor on th | SUB-27, VIS-42 |
| RP-407-2 | C1 engineer's Draft has been a Draft for six weeks | VIS-42 |
| RP-407-3 | The Project closes while a C1 item waits, five weeks old, at C1's internal review | Not scheduled (VIS-63) |
| RP-407-4 | A C1 item sits five weeks at C1's internal review, then is Submitted to K1 | WF-15, VIS-17 |
| RP-407-5 | K1 manager A is on two Projects, with C1 items Submitted on each | VIS-42 |
| RP-407-6 | As in RP-407-5 (who: K1 manager A; K1 manager B) | VIS-42 |
| RP-410-1 | A C1 item is Submitted and picked up by K1's manager; C1's PM picks up another in internal | SUB-25, VIS-19, VIS-20 |
| RP-413-1 | C1's Authorized Person opens Members; C1 has Members on one, two and no Projects; K1, a Pa | VIS-44 |
| RP-407-7 | On one Project C1 has a Draft, an item in its internal review and items Submitted to K1. K | VIS-42 |
| RP-407-8 | As in RP-407-7 (who: C1 engineer and PM; K1 manager; OR engineer; C2 engineer) | VIS-42 |
| RP-408-1 | As in RP-407-7, and in RP-407-3 (a Project that has closed) (who: C1 engineer and PM; K1 manager; OR engineer; C2 engineer) | SUB-27, VIS-42 |
| RP-409-1 | C1 raises a MAR with a datasheet; C1's PM Submits it with an Internal Note; K1's manager f | SUB-17, VIS-43 |
| RP-409-2 | C1 has Drafts and items Submitted to K1, one picked up by K1's manager, who has saved a ve | SUB-18, SUB-24, VIS-43 |
| RP-409-3 | C1's engineer has a Draft that never left Draft, and another that was sent for review (num | SUB-16, VIS-43 |
| RP-441-1 | Tower's Project Admin duplicates, publishes and binds a MAR Workflow as the Project copy, | WF-01, WF-13, FRM-09, VIS-30 |
| RP-443-1 | A Rabaed Engineer duplicates MAR's Workflow into another Rabaed Default's draft, saves and | ADM-07 |
| RP-442-1 | TMC's Authorized Person saves Tower's own Workflow to TMC's Library, edits the Library cop | WF-14, VIS-28 |
| RP-555-1 | Tower's Project Admin publishes Tower's own MAR Workflow from the builder with a Change No | WF-05, WF-07, VIS-29 |
| RP-580-1 | K1 Sends a Submitted item Back to C1's Draft Step, which says "After a Send Back: Comment | VIS-14 |
| RP-582-1 | C1's Daily Report at Tower 1 is Sent Back to C1's Draft Step, which says "After a Send Bac | VIS-15 |
| RP-582-2 | C1 Submits that report again | VIS-15 |
| RP-566-1 | A Rabaed Engineer adds an outcome to a Rabaed Default Type's set (MAR's shape; the test's | ADM-08 |
| RP-593-1 | On a Workflow ending with the Owner's review (1→1→1, ADR 0022), K1's PM recommends Code B | VIS-24 |
| RP-593-2 | OW Sends B Back to K1; K1's PM recommends C; OW confirms it | VIS-24 |
| RP-593-3 | The same on an Electrical item, which OR covers | VIS-24 |
| RP-598-1 | K1's PM recommends Code A to OW, whose PM holds the Owner's review | VIS-24 |
| RP-598-2 | C1's SAR for Shared Cables is closed at Code A, which adds it to the list; C2, another Con | VIS-45 |
| RP-594-1 | C1 raises a Supplier Approval Request for Najd Cables (Electrical); K1 closes it at Code A | SUB-20, VIS-45 |
| RP-592-1 | Tower's Project Admin (C1) adds Najd Electrical Supplies to Electrical (Scope Lighting) an | FRM-03, PAR-12, VIS-45 |
| RP-596-1 | A new Project's DAR runs the Rabaed Default 1→1 → Owner review: C1's engineer raises and s | SUB-21, VIS-24 |
| RP-596-2 | Any Member of any Project reads the eight Rabaed Default Workflows of a submittal Type, an | VIS-60 |
| RP-23-1 | K1's PM issues Code A on C1's MAR; the record is made | SIG-02, VIS-07, VIS-08 |
| RP-23-2 | K1's engineer recommends Code C, K1's PM issues Code A | SIG-12 |
| RP-23-3 | C1's PM downloads a Working Copy while K1 reviews the MAR | SIG-16 |
| RP-23-4 | A visitor not signed in scans the record's QR, then types its Verification Code without th | SIG-15 |
| RP-23-5 | C1's Company has no Stamp; C1's PM, with a Signature, opens Submit | SIG-10 |
| RP-652-1 | The Project turns on "Show Inspections in the Submittals tab" (RP-652); C1's Submitted WIR | PAR-11, INS-07, VIS-46 |
| RP-82-1 | C1's WIR in Building A names under Approved submittals (a link question that accepts only | INS-04, VIS-47 |
| RP-82-2 | Tower's Project Admin (C1) turns on "Approved submittals required" (Project Settings → Req | INS-02, VIS-47 |
| RP-656-1 | C1's engineer takes a photo into a MAR, annotates it (an arrow and a text label) and saves | INS-06, VIS-48 |
| RP-170-1 | K1's Engineer, on a WIR on Workflow Version 2 Submitted by C1, Sends it to K1's Manager re | INS-13, VIS-49 |
| RP-90-1 | K1 raises a Snag (Electrical, Building A, with photos) on C1, the one Contractor covering | VIS-50 |
| RP-90-2 | Same; C1 resolves it from In Progress with a note, and K1's one Member who can verify it h (who: C1; K1) | SNG-04, VIS-51 |
| RP-90-3 | Same; C1 moves it In Progress, then On Hold (who: C1; K1) | SNG-03 |
| RP-90-4 | K1 raises a Snag on C1, the one Contractor covering it; then C3, another Contractor of the | SNG-02, VIS-52 |
| RP-651-1 | Tower's Project Admin (C1) creates the Checklist Template "Concrete pour" (Civil), edits i | INS-01, VIS-55 |
| RP-651-2 | C1's engineer raises a Civil WIR picking "Concrete pour": its Version 1 items are copied o | INS-03, INS-05, VIS-55 |
| RP-589-1 | C1's engineer imports a register (an .xlsx; Packages come with RP-644): previews it, then | IMP-05, IMP-06, VIS-56 |
| RP-94-1 | C1 covers Building A, C2 Building B; K1 raises Snags on both, and closes C1's review at Co | SNG-01, VIS-50 |
| RP-622-1 | C1's PM raises a Snag on C1 itself (the Snag's Version 2: Draft and Verify held by the rai | SNG-05, VIS-53 |
| RP-622-2 | C1 raises a Snag on itself; K1 raises one on C1 | SNG-05, VIS-53 |
| RP-622-3 | K1 raises a Snag on C1; C1 resolves it; K1, its raiser holding Verify, Returns it to Open | SNG-04, VIS-52 |
| RP-624-1 | K1 raises a Snag on Building B (covered by C2 alone) and two Snags are `raised_from`-linke | SNG-06, VIS-54 |
| RP-624-2 | K1 raises a Snag on Building A with two Snags `raised_from`-linked to it, one Electrical a | VIS-54 |

### 6.5 Covered by the automated suite, not by UAT

**Rows no screen can show**

| Row | Why not in UAT | Test that covers it |
|---|---|---|
| 42 | A Member of Project A reads Documents with the database role: no screen shows it. | `packages/db/test/document-rls.test.ts`, `item-visibility-tables.test.ts` |
| RP-430-1 | Needs a Workflow whose Transition rules (not the same person) are published by hand. | `packages/db/test/transition-rules-rls.test.ts`, `apps/api/test/transition-rules.test.ts` |
| RP-430-2 | Needs a rule that publishing refuses; only a crafted Version holds it. | `packages/db/test/transition-rules-rls.test.ts` |
| RP-430-3 | Needs a rule on all Comments closed in a crafted Workflow. | `packages/db/test/transition-rules-rls.test.ts` |
| RP-431-1 | Needs Transitions published by mistake, with actions that write another Participant fields. | `apps/api/test/transition-actions.test.ts`, `packages/db/test/transition-actions-rls.test.ts` |
| RP-431-2 | Assign to offers only own Participant Members; no Rabaed Default MAR Transition offers Assign to yet, so a crafted Workflow is needed (the Assign to of the Register Import, RP-640, will show it on screen). | `packages/db/test/transition-actions-rls.test.ts` |
| RP-525-1 | Needs a Workflow Version published before the internal-answer checks. | `apps/api/test/screens.test.ts`, `packages/db/test/screens-rls.test.ts` |
| 46, 57 | Retired by ADR 0019 | `apps/api/test/form-sections.test.ts`, `mar-form-v4.test.ts`, `mar-v3.test.ts` |

**Database half of rows UAT covers through the screen.** UAT checks the same rule through the screen and the API; the table-level half (what the app role can read or write) is proved by the seam 2 test below, found by the matrix id in each test file.

| Row | Seam 2 test (packages/db/test) |
|---|---|
| 7 | `work-item-rls.test.ts` |
| 8 | `work-item-rls.test.ts` |
| 12 | `work-item-link-rls.test.ts` |
| 28 | `participant-rls.test.ts`, `work-item-rls.test.ts` |
| 29 | `participant-rls.test.ts`, `work-item-rls.test.ts` |
| 30 | `participant-rls.test.ts` |
| 31 | `participant-rls.test.ts` |
| 34 | `work-item-rls.test.ts` |
| 38 | `participant-rls.test.ts` |
| 51 | `revision-rls.test.ts` |
| 55 | `numbering-counter-rls.test.ts` |
| 56 | `revision-rls.test.ts` |
| 58 | `sent-back-rows-rls.test.ts`, `work-item-ref-rls.test.ts` |
| 61 | `sent-back-rows-rls.test.ts`, `work-item-rls.test.ts` |
| 62 | `revision-rls.test.ts` |
| 67 | `watch-rls.test.ts` |
| 73 | `id-defaults.test.ts`, `work-item-link-rls.test.ts` |
| 77 | `work-item-linked-from-rls.test.ts` |
| 78 | `work-item-linked-from-rls.test.ts` |
| 81 | `work-item-ref-rls.test.ts` |
| RP-399-1 | `sent-back-rows-rls.test.ts` |
| RP-412-3 | `numbering-pattern-rls.test.ts` |
| RP-431-2 | `transition-actions-rls.test.ts` |
| RP-433-1 | `cancel-recommended-code-rls.test.ts` |
| RP-516-1 | `screens-rls.test.ts` |
| RP-435-1 | `revision-rls.test.ts` |
| RP-426-1 | `workflow-ownership-rls.test.ts` |
| RP-426-2 | `workflow-ownership-rls.test.ts` |
| RP-427-3 | `workflow-authoring-rls.test.ts` |
| RP-427-5 | `screens-rls.test.ts`, `workflow-authoring-rls.test.ts` |
| RP-434-1 | `code-b-comments-rls.test.ts` |
| RP-434-2 | `code-b-comments-rls.test.ts` |
| RP-434-3 | `code-b-comments-rls.test.ts` |
| RP-513-1 | `code-b-comments-rls.test.ts` |
| RP-108-1 | `handover-rls.test.ts` |
| RP-108-2 | `handover-rls.test.ts` |
| RP-108-3 | `handover-rls.test.ts` |
| RP-515-1 | `work-item-rls.test.ts` |
| RP-517-1 | `company-defaults-rls.test.ts` |
| RP-450-1 | `project-stages.test.ts`, `workflow-authoring-rls.test.ts` |
| RP-413-1 | `member-project-counts-rls.test.ts` |
| RP-409-1 | `revision-rls.test.ts` |
| RP-409-2 | `revision-rls.test.ts` |
| RP-409-3 | `revision-rls.test.ts` |
| RP-582-1 | `sent-back-built-ins-rls.test.ts` |
| RP-582-2 | `sent-back-built-ins-rls.test.ts` |
| RP-593-1 | `owner-review-rls.test.ts` |
| RP-593-2 | `owner-review-rls.test.ts` |
| RP-593-3 | `owner-review-rls.test.ts` |
| RP-598-2 | `sar-adds-supplier-rls.test.ts` |
| RP-594-1 | `sar-adds-supplier-rls.test.ts` |
| RP-592-1 | `approved-supplier-rls.test.ts` |
| RP-82-1 | `wir-approved-submittals-rls.test.ts` |
| RP-82-2 | `wir-approved-submittals-rls.test.ts` |
| RP-90-1 | `snag-rls.test.ts` |
| RP-90-2 | `snag-rls.test.ts` |
| RP-90-3 | `snag-rls.test.ts` |
| RP-651-1 | `checklist-template-rls.test.ts` |
| RP-651-2 | `checklist-template-rls.test.ts` |
| RP-589-1 | `register-import-rls.test.ts` |
| RP-622-1 | `snag-rls.test.ts` |
| RP-622-2 | `snag-rls.test.ts` |
| RP-622-3 | `snag-rls.test.ts` |

Also out of UAT: `scripts/check-leak-channels.test.ts` (every notification and outbox kind is checked against the channels), `scripts/hidden-columns.ts` (hidden columns and sort keys), and the grants, `security definer` and function-grant checks in `packages/db/test` (`grants.test.ts`, `definer-access.test.ts`, `function-grants.test.ts`).

### 6.6 Leak channels and their scenarios

Each row of the Leak channels table in `docs/visibility.md` has at least one scenario. Channels the matrix does not name are covered here.

| Leak channel | Scenarios |
|---|---|
| Lists, Kanban, Floor and Plan Views | VIS-01, VIS-02, VIS-18, VIS-19 (Floor and Plan: VIS-62, not built) |
| Comments (Code B action items) | VIS-05, SNG-06 |
| Dashboard and Location Status | VIS-18 (Location Status is not built) |
| Search and filters | VIS-19, VIS-20, VIS-61 |
| Direct URL or ID | VIS-58, I18N-08 |
| Files Module | VIS-62 (not built) |
| File downloads | VIS-37, VIS-48, FRM-07 |
| Form member and participant fields | FRM-11 (waits for the Form builder) |
| Pins on shared Drawings | VIS-62 (not built) |
| Links; Linked from; Link search | VIS-09, VIS-10, VIS-11 |
| Form Sections filled by another Participant | retired (ADR 0019); VIS-38 |
| An item Sent Back to its raiser | VIS-14, VIS-15, NOT-09 |
| Creation Date | VIS-16 |
| Notifications and emails; Daily email digest | VIS-22, NOT-02, NOT-03, NOT-06 |
| Need My Action; Watch | VIS-23, VIS-21 |
| Working Copy; Documental Record; Verification page | SIG-16, VIS-07, VIS-08, SIG-04, SIG-15 |
| Activity Feed | VIS-57, SUB-28 |
| Workflow definitions and bindings; Screens and replies | VIS-25, VIS-26, VIS-27, VIS-28, VIS-29, VIS-30, FRM-09, VIS-04 |
| Home across Projects | VIS-42 |
| Work Item history; a reply answers in the history | VIS-04, VIS-17 |
| Step Age reports | NOT-07 |
| Exports and handover | VIS-43, VIS-41 |
| Document Numbers; Revisions | VIS-39, VIS-12, VIS-13 |
| Form answers; Derived values | VIS-09, VIS-61 |
| Errors and logs shown to users; Refusals of a Transition | VIS-59, VIS-36 |
| Visibility Gap warnings; Participant Invitation by CR number | VIS-35, VIS-32 |
| Rabaed Admin | ADM-07, ADM-10 |
| Approved Supplier List; Submittal Register Imports | VIS-45, VIS-56 |
| Packages (new channel, GLOSSARY and the Packages prompt) | PKG-12 |

## 7. Priorities

| Priority | Label | Jira priority | Meaning |
|---|---|---|---|
| P1 V | Visibility and security | Highest | A Company could see another Company work, or a Member could do what they must not. Any failure is a Highest Bug and stops the round. |
| P1 | Money path and core journeys | High | The journeys a Project cannot run without: Draft to Code, Revision, Submit, Pick up, numbering, sign-in, the sealed record, onboarding, the Rabaed rules (no due dates, Latin digits, Document Numbers left to right). |
| P2 | Important | Medium | Common features and settings where a failure has a work-around. |
| P3 | Nice to have | Low | Rare paths, polish and exploratory extras. |

Scenario priority is fixed by this plan; a tester may raise it, never lower it. A Bug has its own priority by the defect process (section 10.4): visibility and security are always Highest.

## 8. Manual and automated

Each scenario has a **Mode** (meaning in section 3.3): `Manual`, `Automate` or `Both`. Summary by Part is in section 11. The scenarios marked `Automate` are the deterministic cross-company and rule checks: the plain 404, counts, absent rows, absent emails, the Avoid-term and digit scans. The ones that stay `Manual` need a person: layout against the reference, wording in Arabic, a phone, a PDF or an email read, fixtures that need a lane engineer, and anything that depends on judgement.

- **Automate** (48): SUB-02, SUB-29, PAR-03, I18N-02, I18N-03, I18N-08, ADM-03, VIS-01, VIS-02, VIS-05, VIS-07, VIS-09, VIS-10, VIS-11, VIS-12, VIS-18, VIS-19, VIS-20, VIS-21, VIS-22, VIS-23, VIS-26, VIS-30, VIS-31, VIS-32, VIS-33, VIS-35, VIS-37, VIS-39, VIS-40, VIS-42, VIS-43, VIS-44, VIS-45, VIS-46, VIS-48, VIS-50, VIS-51, VIS-52, VIS-53, VIS-54, VIS-55, VIS-56, VIS-57, VIS-58, VIS-59, VIS-60, VIS-64
- **Both** (139): SUB-01, SUB-04, SUB-05, SUB-07, SUB-08, SUB-09, SUB-10, SUB-11, SUB-12, SUB-13, SUB-14, SUB-15, SUB-16, SUB-17, SUB-20, SUB-21, SUB-23, SUB-25, SUB-26, SUB-27, WF-01, WF-02, WF-03, WF-05, WF-06, WF-07, WF-08, WF-10, WF-12, WF-13, WF-14, WF-16, WF-17, FRM-02, FRM-03, FRM-05, FRM-07, FRM-08, FRM-09, PAR-01, PAR-02, PAR-05, PAR-06, PAR-08, PAR-09, PAR-10, PAR-11, PAR-12, PAR-13, PKG-01, PKG-02, PKG-03, PKG-04, PKG-05, PKG-06, PKG-08, PKG-09, PKG-10, PKG-12, SIG-01, SIG-02, SIG-03, SIG-04, SIG-07, SIG-09, SIG-10, SIG-11, SIG-15, SIG-16, SIG-17, SNG-01, SNG-02, SNG-03, SNG-04, SNG-05, SNG-06, SNG-08, SNG-09, SNG-10, SNG-11, SNG-12, SNG-14, INS-01, INS-02, INS-03, INS-04, INS-05, INS-06, INS-07, INS-08, INS-09, INS-10, INS-11, INS-12, INS-13, INS-14, IMP-01, IMP-02, IMP-03, IMP-04, IMP-05, IMP-06, IMP-07, IMP-08, IMP-09, IMP-10, IMP-11, NOT-01, NOT-02, NOT-03, NOT-04, NOT-05, NOT-09, I18N-01, I18N-06, I18N-07, ADM-01, ADM-02, ADM-04, ADM-06, ADM-07, VIS-03, VIS-04, VIS-14, VIS-15, VIS-16, VIS-17, VIS-24, VIS-25, VIS-27, VIS-28, VIS-29, VIS-34, VIS-36, VIS-38, VIS-41, VIS-47, VIS-49, VIS-61
- **Manual** (49): SUB-03, SUB-06, SUB-18, SUB-19, SUB-22, SUB-24, SUB-28, WF-04, WF-09, WF-11, WF-15, FRM-01, FRM-04, FRM-06, FRM-10, FRM-11, PAR-04, PAR-07, PAR-14, PAR-15, PAR-16, PKG-07, PKG-11, SIG-05, SIG-06, SIG-08, SIG-12, SIG-13, SIG-14, SNG-07, SNG-13, SNG-15, IMP-12, NOT-06, NOT-07, NOT-08, NOT-10, NOT-11, I18N-04, I18N-05, ADM-05, ADM-08, ADM-09, ADM-10, VIS-06, VIS-08, VIS-13, VIS-62, VIS-63

## 9. Waits for epic

Each scenario has **Waits**: `Now` (runnable on lane 7 today) or `Waits: RP-xxx` with the ticket or tickets that must be merged on `main` first. A scenario that waits is written now from the docs, so the epic starts with its tests ready, and is run in the epic round (section 10). **Not scheduled** means the feature has no ticket in the five epics: the scenario is kept so the matrix row is not lost.

| Waits for | Tickets | Count | Scenarios |
|---|---|---|---|
| Now | none: runnable on lane 7 today (some need a fixture, section 2.5) | 187 | SUB-01, SUB-02, SUB-03, SUB-04, SUB-05, SUB-06, SUB-07, SUB-08, SUB-09, SUB-10, SUB-11, SUB-12, SUB-13, SUB-14, SUB-15, SUB-16, SUB-17, SUB-18, SUB-19, SUB-20, SUB-21, SUB-22, SUB-23, SUB-24, SUB-25, SUB-26, SUB-27, SUB-28, SUB-29, WF-01, WF-02, WF-03, WF-04, WF-05, WF-06, WF-07, WF-08, WF-09, WF-10, WF-11, WF-12, WF-13, WF-14, WF-15, WF-16, WF-17, FRM-01, FRM-02, FRM-03, FRM-04, FRM-05, FRM-06, FRM-07, FRM-08, FRM-09, FRM-10, PAR-01, PAR-02, PAR-03, PAR-04, PAR-05, PAR-06, PAR-07, PAR-08, PAR-09, PAR-10, PAR-11, PAR-12, PAR-13, PAR-14, PAR-15, PAR-16, SIG-01, SIG-02, SIG-03, SIG-04, SIG-05, SIG-06, SNG-01, SNG-02, SNG-03, SNG-04, SNG-05, SNG-06, SNG-07, INS-01, INS-02, INS-03, INS-04, INS-05, INS-06, INS-07, INS-08, IMP-01, IMP-02, IMP-03, IMP-04, IMP-05, IMP-06, IMP-07, NOT-01, NOT-02, NOT-03, NOT-04, NOT-05, NOT-06, NOT-07, NOT-08, NOT-09, NOT-10, I18N-01, I18N-02, I18N-03, I18N-04, I18N-05, I18N-06, I18N-07, I18N-08, ADM-01, ADM-02, ADM-03, ADM-04, ADM-05, ADM-06, ADM-07, ADM-08, ADM-09, VIS-01, VIS-02, VIS-03, VIS-04, VIS-05, VIS-07, VIS-08, VIS-09, VIS-10, VIS-11, VIS-12, VIS-13, VIS-14, VIS-15, VIS-16, VIS-17, VIS-18, VIS-19, VIS-20, VIS-21, VIS-22, VIS-23, VIS-24, VIS-25, VIS-26, VIS-27, VIS-28, VIS-29, VIS-30, VIS-31, VIS-32, VIS-33, VIS-34, VIS-35, VIS-36, VIS-37, VIS-38, VIS-39, VIS-40, VIS-41, VIS-42, VIS-43, VIS-44, VIS-45, VIS-46, VIS-47, VIS-48, VIS-50, VIS-51, VIS-52, VIS-53, VIS-54, VIS-55, VIS-56, VIS-57, VIS-58, VIS-59, VIS-60, VIS-61, VIS-64 |
| Packages (RP-588) | RP-588, RP-659 to RP-662 (UI) | 12 | PKG-01, PKG-02, PKG-03, PKG-04, PKG-05, PKG-06, PKG-07, PKG-08, PKG-09, PKG-10, PKG-11, PKG-12 |
| Signing (RP-23) | RP-23, RP-31, RP-147, RP-151, RP-155, RP-157, RP-161, RP-614, RP-617, RP-621, RP-650, RP-665, RP-666 | 11 | SIG-07, SIG-08, SIG-09, SIG-10, SIG-11, SIG-12, SIG-13, SIG-14, SIG-15, SIG-16, SIG-17 |
| Snag List (RP-28) | RP-28, RP-623, RP-625, RP-626, RP-627, RP-628, RP-629, RP-630, RP-658, RP-677 | 8 | SNG-08, SNG-09, SNG-10, SNG-11, SNG-12, SNG-13, SNG-14, SNG-15 |
| Inspections (RP-27) | RP-27, RP-86, RP-577, RP-653, RP-673, RP-674 | 7 | INS-09, INS-10, INS-11, INS-12, INS-13, INS-14, VIS-49 |
| Register Import (RP-589) | RP-588, RP-589, RP-639, RP-640, RP-644, RP-645 | 5 | IMP-08, IMP-09, IMP-10, IMP-11, IMP-12 |
| Not scheduled | Chat is not built (no ticket in the five epics); Files, Drawings and Plan View are not built (no ticket in the five epics); Participant withdrawal, Project close and Signatory Access (RP-614) are not built; Project close is not built (no ticket in the five epics); no Rabaed Default Form has a member or participant field; arrives with the Form builder; no admin item commands are built (Admin has companies, numbering, option lists and Workflows only) | 6 | FRM-11, NOT-11, ADM-10, VIS-06, VIS-62, VIS-63 |

## 10. Rounds

### 10.1 The rounds

| Round | When | Runs | Regression included |
|---|---|---|---|
| **0 Baseline** | now, on lane 7 | every scenario that is `Now` (187), starting with the fixtures | none: it sets the baseline |
| **1 Packages** | when RP-588 is Done and merged | Part PKG, IMP-11 | List, Kanban and Dashboard (Package chip, filter, counts): SUB-23, SUB-25, SUB-26; VIS-18, VIS-19 |
| **2 Signing** | when RP-23 is Done | Part SIG waits | Journey J1 in full (once Signature and Stamp are required to act, every Transition changes); the demo seed must then carry a Signature and Stamp for each person, or the seed breaks: raise it before the round; VIS-07, VIS-08, SUB-11 |
| **3 Snag List** | when RP-28 is Done | Part SNG waits, SNG-08 to SNG-15 | SUB-12, SNG-06, VIS-05, VIS-50 to VIS-54, NOT-02 |
| **4 Inspections** | when RP-27 is Done | Part INS waits, VIS-49 | INS-01 to INS-08 (rewritten for Review Codes, ADR 0025), SUB-23 to SUB-25, PAR-11, SNG snags from failed items |
| **5 Register Import** | when RP-589 is Done (IMP-11 also needs Round 1) | Part IMP waits | IMP-01 to IMP-07, VIS-56, SUB-16 |
| **6 Full regression** | before a release, after the five epics | every scenario that is runnable: all Manual and Both in two languages, the whole Automate suite, the ui-ux-tester pass on every screen, phone and Arabic | everything |

Rounds 1 to 5 run in the order the epics finish, not the order above. Scenarios marked **Not scheduled** are re-read at the start of Round 6; any whose feature has been built since is moved to a round of its own.

### 10.2 Entry criteria (every round)

1. Every Jira ticket of the epic is Done and merged on `main` (Round 0: the current `main`).
2. The lane 7 worktree has merged `main` and runs the new code: `pnpm lane:env 7` and `pnpm demo` from PowerShell; web, api, worker and Rabaed Admin healthy; Mailpit and the file store reachable.
3. The seed is fresh; the fixtures of section 2.5 are made (FX-C2, FX-K1M, FX-OW, FX-OR, FX-SB; AGE and JOBS when the round has scenarios that need them).
4. The Test Cases of the round have been **re-read against the final spec**: a scenario written ahead of the build (a Waits scenario) is corrected where the spec, the ADRs or the screens changed. Changes are made in `planning/uat/` in a docs PR.
5. The Test Cases exist in Jira under a dated epic (section 10.3) and the testers are named.

### 10.3 Jira structure

- **One Epic** for this system UAT, named like the earlier round (RP-463, "Workflow Engine UAT - 9 Oct 2026"): "System UAT - 19 Oct 2026". Every scenario has its Test Case there from the start, so the plan is whole in Jira. A label says the round it first runs in: `uat-round-0` (Now), `uat-round-1` (Packages, RP-588), `uat-round-2` (Signing, RP-23), `uat-round-3` (Snag List, RP-28), `uat-round-4` (Inspections, RP-27), `uat-round-5` (Register Import, RP-589), `uat-round-6` (Not scheduled: re-read at the full regression). A waiting Test Case also carries `blocked` until its epic is Done. A later round re-runs a Test Case as a new result comment on the same item (the regression rows of 10.1), never a copy.
- **One Test Case per scenario**, summary "<id> <title>" (example: "VIS-01 A new Draft is TMC's alone"). Labels: `uat`, the Part label (`uat-part-sub`, `uat-part-wf`, `uat-part-frm`, `uat-part-par`, `uat-part-pkg`, `uat-part-sig`, `uat-part-sng`, `uat-part-ins`, `uat-part-imp`, `uat-part-not`, `uat-part-i18n`, `uat-part-adm`, `uat-part-vis`), and `blocked` only while blocked. Jira priority from the scenario (Highest, High, Medium, Low).
- **Description**, as in the earlier round:

```
**Part X: <Part name>** · Scenario `<id>` · Covers: Visibility | Journey | Regression | Design | Arabic
**Who:** <people>
## Steps
## Expected result
## Environment
<lane 7 URLs, language, width, fixtures needed>
**Status:** Done = pass · Failed = fail · To Do + label `blocked` = blocked.
```

`Covers:` takes Visibility for Part VIS, Journey for the money-path scenarios, Regression for a scenario re-run in a later round, Design for a screen checked by the ui-ux-tester, Arabic for an RTL check; more than one is allowed.

### 10.4 Defect process

1. **Failed check:** the tester sets the Test Case to **Failed**, and writes the result comment (10.5).
2. **Bug:** one Bug per root cause, filed **under the epic that owns the feature** (a Packages Bug under RP-588, a record Bug under RP-23, a Snag Bug under RP-28, a WIR Bug under RP-27, an import Bug under RP-589; a Bug in something built earlier goes under the epic the Main names, and the Orchestrator settles a doubt). Label `uat`. Linked to its Test Case. A Bug found while exploring, with no Test Case, is filed the same way and a new scenario is added to this plan.
3. **Bug content:** scenario id, Who, language and width, the lane 7 commit, exact steps, expected (with the document and rule that says so), actual, screenshots or the video, and for a visibility Bug **which Company saw what**. Never a password; for a visibility Bug the screenshot may show the leaked Subject, so keep it inside Jira.
4. **Priority:** a visibility or security failure (any P1 V scenario, a hole in the 404, a leaked count, name, email or file) is **Highest** and is raised to the Main and the Orchestrator the same day. A broken money-path journey is High. A wrong behaviour with a work-around is Medium. Wording, layout and polish are Low. A page that differs from its reference screen without a rule forcing it is a Bug with the label `ui-design`; UX recommendations are not Bugs: they go in one Task per round for the Main to triage.
5. **Fix and re-test:** when the Bug is fixed and merged, the Test Case moves to **In Review**; the tester re-runs it on a freshly seeded lane. Pass moves it to Done; fail back to Failed with a new comment. A fix to a visibility Bug also adds or updates the matching row of `docs/visibility.md` and its automated test, as `CODING_STANDARDS.md` requires.
6. **Blocked:** a Test Case that cannot run because of another Bug or a missing fixture stays To Do with the label `blocked` and a comment naming the blocker.

### 10.5 Result reporting

- **One comment per Test Case**, listing every check of its Expected result with a pass mark or a fail mark (the earlier round used a tick and a cross), the language and width used, and the screenshots (attached, with the person and window named). Keep the order of the Expected result.
- **Status:** Done = pass; Failed = fail; In Review = a fix awaits re-test; To Do + `blocked` = blocked.
- **Automated runs:** the comment links the run and its video; a red test is a Failed Test Case.
- **Round summary** on the epic when the round ends: totals by Part, priority, status; the open Bugs by priority; the scenarios not run and why; the UI issues and UX recommendations of the ui-ux-tester; the verdict against the exit criteria.

### 10.6 Exit criteria (every round)

1. Every scenario of the round is Done, or Failed with a Bug, or blocked with a named blocker. None is left To Do without a reason.
2. **No open Highest Bug and no open High Bug.** A Medium or Low Bug may be accepted by the Main, in writing, on the Bug.
3. All P1 V and P1 scenarios of the round are Done.
4. The Automate suite of the round is green on a fresh seed.
5. The result comments and the round summary are posted. A scenario whose Expected result was found wrong or ambiguous is corrected in this plan.

### 10.7 Retro

At the end of every round the owner types `/mattpocock-skills:retro` in the session that ran it, over the whole round: scenarios that were wrong, fixtures that failed, defects that came late, what the automated suite missed, and what the next round should change. Tickets that come out of it carry the Jira label `retro` and the parent RP-567 (Agent tooling and retro). Changes to this plan go in a docs PR for `planning/uat/`.

## 11. Counts

**Total: 236 scenarios** in 13 Parts.

### 11.1 By Part

| Part | Total | P1 V | P1 | P2 | P3 | Manual | Automate | Both | Now | Waits | Not scheduled |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SUB Submittals | 29 | 0 | 13 | 9 | 7 | 7 | 2 | 20 | 29 | 0 | 0 |
| WF Workflows | 17 | 1 | 3 | 10 | 3 | 4 | 0 | 13 | 17 | 0 | 0 |
| FRM Forms and Screens | 11 | 0 | 2 | 7 | 2 | 5 | 0 | 6 | 10 | 0 | 1 |
| PAR Participants and Visibility setup | 16 | 1 | 8 | 3 | 4 | 5 | 1 | 10 | 16 | 0 | 0 |
| PKG Packages | 12 | 0 | 6 | 4 | 2 | 2 | 0 | 10 | 0 | 12 | 0 |
| SIG Signing and Documental Record | 17 | 0 | 12 | 2 | 3 | 6 | 0 | 11 | 6 | 11 | 0 |
| SNG Snag List | 15 | 0 | 8 | 4 | 3 | 3 | 0 | 12 | 7 | 8 | 0 |
| INS Inspections (WIR) | 14 | 0 | 8 | 5 | 1 | 0 | 0 | 14 | 8 | 6 | 0 |
| IMP Submittal Register Import | 12 | 0 | 3 | 7 | 2 | 1 | 0 | 11 | 7 | 5 | 0 |
| NOT Notifications | 11 | 0 | 4 | 5 | 2 | 5 | 0 | 6 | 10 | 0 | 1 |
| I18N Arabic, RTL and phone width | 8 | 1 | 4 | 0 | 3 | 2 | 3 | 3 | 8 | 0 | 0 |
| ADM Rabaed Admin | 10 | 0 | 4 | 3 | 3 | 4 | 1 | 5 | 9 | 0 | 1 |
| VIS Visibility | 64 | 64 | 0 | 0 | 0 | 5 | 41 | 18 | 60 | 1 | 3 |
| **Total** | **236** | **67** | **75** | **59** | **35** | **49** | **48** | **139** | **187** | **43** | **6** |

### 11.2 Priority, Mode and Waits

| Priority | Jira | Count |
|---|---|---|
| P1 V | Highest | 67 |
| P1 | High | 75 |
| P2 | Medium | 59 |
| P3 | Low | 35 |

| Mode | Count |
|---|---|
| Manual | 49 |
| Automate | 48 |
| Both | 139 |

| Waits | Count |
|---|---|
| Now | 187 |
| Packages (RP-588) | 12 |
| Signing (RP-23) | 11 |
| Snag List (RP-28) | 8 |
| Inspections (RP-27) | 7 |
| Register Import (RP-589) | 5 |
| Not scheduled | 6 |

### 11.3 Waits by epic and Part

| Epic | SUB | WF | FRM | PAR | PKG | SIG | SNG | INS | IMP | NOT | I18N | ADM | VIS | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Now | 29 | 17 | 10 | 16 | 0 | 6 | 7 | 8 | 7 | 10 | 8 | 9 | 60 | 187 |
| Packages (RP-588) | 0 | 0 | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 12 |
| Signing (RP-23) | 0 | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| Snag List (RP-28) | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| Inspections (RP-27) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 1 | 7 |
| Register Import (RP-589) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 | 5 |
| Not scheduled | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 3 | 6 |

## 12. Open questions and document notes

**Open questions (to settle before or in Round 0):**

- **OQ-1 Aged items.** Step Age is counted in weeks and no screen can age an item. WF-15, VIS-16, VIS-17 and NOT-07 need the AGE fixture (a lane engineer changes the step-entered time in lane 7 database). Who does it, and is a script wanted?
- **OQ-2 Scheduled jobs.** The daily digest (07:00 Riyadh, Sunday to Thursday) and the weekly Step Age report (Sunday 07:00) are worker schedules. The plan needs a way to run each on demand on lane 7 (NOT-06, NOT-07).
- **OQ-3 Bulk Transitions and signing.** `design/prompts/packages.md` says a bulk Transition is never offered for one that needs a signature. ADR 0017 and GLOSSARY say every Transition is signed ("There is no per-Transition signing choice"). Read together, a bulk Transition would never be offered. PKG-09 is written to the Packages prompt and spec RP-616 and needs the answer.
- **OQ-4 Lane 7.** README and `scripts/lanes.ts` allow lane numbers 1 to 9 only as legacy lanes with ports plus 100n; the ports in section 2.1 are derived from that rule, not read from a running stack. Confirm them after `pnpm lane:env 7`.
- **OQ-5 Signature and Stamp in the seed.** ADR 0023 says no Member can act without a Signature and no Member of a Company without a Stamp can act. Today the demo works without either (the UI to add them is RP-665, RP-666, RP-617). When RP-617 lands the seed must give each person a Signature and each Company a Stamp, or Round 2 starts with a broken demo.
- **OQ-6 RP-674.** INSP-11 (RP-674) is named in the epic list without a description. INS-14 is assumed to be the shared Stages change of ADR 0025; correct it if not.
- **OQ-7 Not built, no ticket.** Chat (matrix 9), Project close and Participant withdrawal (13 to 15), Plan, Floor and Map Views with Pins (16), Files, Drawings, Site Reports, Subtasks, admin commands on an item (20), and a Form field of type member or participant in any Rabaed Default Form (matrix 43). Their scenarios are Not scheduled. Is any of them wanted in this release?
- **OQ-8 Send Back for UAT.** The Rabaed Default submittal Workflows have no Send Back (they use Code C). Rows 58, 59, 71 and the V19 scenarios (VIS-14, VIS-15, NOT-09) need a Project Workflow built in WF-09. If the builder refuses it, those rows cannot be tested in the UI.

**Notes on the documents (for the Main or the Orchestrator):**

- `apps/web/messages/en.json` carries List column labels "Discipline", "Status" and "Current owner", and "Submittal No."; GLOSSARY lists Discipline, Status and Current owner under Avoid, and V14 says the List column is "With", never "Current owner". Check on screen (SUB-29).
- `design/prompts/register-import.md` shows "who, when, file name" on the Imports page; `docs/visibility.md` (Register Imports) says no time of an import is read anywhere. IMP-06 checks for no time.
- `docs/visibility.md` leaves two rows of the Documental Record to later tickets (the List row menu, the Files folder, E1, E2: RP-31, RP-614) while V7 lists them as allowed; the plan marks them as waiting.
- `docs/visibility.md` row RP-170-1 and RP-652-1 describe WIR Results and separate Inspections Stages; ADR 0025 retires them. VIS-49 and INS-14 wait for the rewrite.

## 13. The earlier round: RP-463 results and what carries over

The earlier round, epic RP-463 "Workflow Engine UAT – 9 Oct 2026", has 35 Test Cases (the only Test Cases in Jira today): Part A 18 (test as seeded), Part B 11 (rules a test Workflow needed), Part C 6 (gaps for the owner to decide). It ran twice, by Playwright: on 9 Oct (all of Part A passed) and on 10 Oct (a second script, which stopped part way when the demo stopped answering). No Bug was filed against a product failure; the round's follow-ups were RP-521 (a Link the viewer can't see, Done), RP-522 ("Code A", not a bare "A", Done) and RP-523 (the design gap list from A-18, To Do).

### 13.1 Results

| Status | Test Cases | What it means |
|---|---|---|
| Done, passed twice | A-01 to A-04, A-11 to A-13, A-16, A-17 (9) | Passed on 9 and 10 Oct. |
| Done, passed once | A-05 to A-10, A-14, A-15 (8) | Passed on 9 Oct; the 10 Oct run stopped on a script fault (a dialog still open, a strict-mode match, a Kanban link taken for a radio) or a demo that stopped answering. No check failed, so they stay Done, but their last run is not clean. |
| To Do, not run | A-18 (1) | The design match is for a person; it became RP-523 (To Do). |
| To Do, blocked | B-01 to B-11 (11) | Blocked on RP-437 (the complete Rabaed Default Workflows). RP-437 is now Done: the MAR has Code D, Recommended Code, Cancel, Restrict and Validate rules and Screens, so the block is gone. |
| To Do, decision | C-01 to C-06 (6) | Gaps the owner was asked to accept or ticket; none answered. |

Two remarks from the runs are still open and are checked again here: the Transition button reads "Revise & Resubmit · C" while the Outcome set names "Revise and Resubmit (C)" (A-14, checked by SUB-13 and I18N-04), and an empty "Cancelled" Kanban column is shown (A-15, checked by SUB-25: it is a Stage of the Project, so showing it is correct).

### 13.2 Where each Test Case goes in this plan

Every RP-463 Test Case is covered by a scenario of this plan, so the old round is not run again as it was. Round 0 runs the new scenarios; the old ones are closed as superseded (13.3).

| RP-463 | Key | Title | Result | New scenario(s) |
|---|---|---|---|---|
| A-01 | RP-464 | A new Draft is TMC's alone | Pass ×2 | SUB-01, VIS-01 |
| A-02 | RP-465 | Send for Review is refused while the Form is incomplete | Pass ×2 | SUB-02 |
| A-03 | RP-466 | Every Transition asks for confirmation | Pass ×2 | SIG-01 |
| A-04 | RP-467 | A confirmed Transition is recorded with who and when | Pass ×2 | SIG-01, SUB-07 |
| A-05 | RP-468 | Return stays inside TMC | Pass, then script stop | SUB-05, VIS-04 |
| A-06 | RP-469 | Submit hands it to the Consultant without leaking TMC's internal steps | Pass, then not reached | SUB-07, VIS-02, VIS-04 |
| A-07 | RP-470 | Code A needs the Consultant verification first | Pass, then not reached | SUB-10, SUB-11 |
| A-08 | RP-471 | Code C: the verification stays hidden until the Code | Pass, then script fault | SUB-13, VIS-04 |
| A-09 | RP-472 | Code C offers a Revision, and the Draft Revision is TMC's alone | Pass, then not reached | SUB-15, VIS-13 |
| A-10 | RP-473 | Location limits: Tower 2 only | Pass, then script fault | WF-12, VIS-09, VIS-34, VIS-58 |
| A-11 | RP-474 | Another Project is invisible both ways | Pass ×2 | VIS-64 (new) |
| A-12 | RP-475 | Notification settings have no In-app switches | Pass ×2 | NOT-01, NOT-04 |
| A-13 | RP-476 | Email off, bell still on | Pass ×2 | NOT-03, NOT-04 |
| A-14 | RP-477 | Outcome names come from the Outcome set | Pass, then script fault | WF-13, SUB-13, SUB-26, I18N-04 |
| A-15 | RP-478 | Kanban columns are the Project's Stages | Pass, then not reached | SUB-25, WF-13 |
| A-16 | RP-479 | The same flow in Arabic | Pass ×2 | I18N-01 to I18N-04 |
| A-17 | RP-480 | Step Age dots, and no due dates | Pass ×2 | SUB-29, WF-15 |
| A-18 | RP-481 | Looks like the Claude Design reference | Not run | Section 3.2 (ui-ux-tester pass); RP-523 |
| B-01 | RP-482 | Publishing an invalid definition is refused | Blocked | WF-05 |
| B-02 | RP-483 | Publishing a valid Version changes new MARs only | Blocked | WF-06 |
| B-03 | RP-484 | Restrict: separation of duties | Blocked | WF-11 |
| B-04 | RP-485 | Validate: the rule's own message, in both languages | Blocked | WF-11, I18N-04 |
| B-05 | RP-486 | The Consultant never learns why TMC's buttons differ | Blocked | VIS-36, VIS-59 |
| B-06 | RP-487 | Assign to offers only your own Company | Blocked | WF-17 (new) |
| B-07 | RP-488 | Set field and copy field | Blocked | WF-11 |
| B-08 | RP-489 | Per-Transition notification to the raiser | Blocked | NOT-02 |
| B-09 | RP-490 | Cancel from the raiser's Steps | Blocked | WF-16 (new), SIG-05 |
| B-10 | RP-491 | Recommended Code stays inside the Consultant | Blocked | VIS-04, VIS-24 |
| B-11 | RP-492 | Code D offers a replacement, not a Revision | Blocked | SUB-14 |
| C-01 | RP-493 | Workflow bindings have no screen | Decision | WF-01 (Settings > Workflows now shows each Type's Workflow) |
| C-02 | RP-494 | No Workflow authoring in Rabaed Admin | Decision | ADM-07, ADM-08 (Rabaed Defaults are published from Admin now) |
| C-03 | RP-495 | Stages and Outcome sets have no settings screen | Decision | WF-13 (the pages exist now) |
| C-04 | RP-496 | The content hash is not visible | Decision | SIG-03, SIG-04 (the Documental Record prints each Transition's hash; nobody reads it in the app, by rule) |
| C-05 | RP-497 | No "Rejected" Stage for Code D | Decision | SUB-14 (RP-437 added the Rejected Stage) |
| C-06 | RP-498 | README walkthrough URL | Decision | Section 2.1 (lane 7 URLs); the README's own walkthrough is checked in SUB-01 to SUB-11 |

### 13.3 What happens to RP-463 (owner's OK needed)

- **Part A and B:** each RP-463 Test Case gets a comment "Superseded by <new Test Case keys> in <System UAT epic>" and a "relates to" link to them. Done ones stay Done; the B ones go Done when their new scenarios pass in Round 0, or Failed with the Bug linked.
- **Part C:** each C Test Case is answered by its new scenario: Done when it passes (the gap is closed), else the owner decides as before.
- **A-18:** stays with RP-523; the ui-ux-tester pass (section 3.2) adds its findings to RP-523 or new UI Bugs.
- Then RP-463 is closed.

### 13.4 Lessons from that round, applied here

- **Script faults were the main noise.** Five of eight unclean results were the script, not the product (a dialog still open, a strict-mode match on a sentence shown three times, a Kanban link taken for a radio). The Playwright pieces (section 3.3) use role-and-name locators scoped to a region, wait for a dialog to close, and are reviewed by the lane's `/code-review` before they run in a round.
- **One broken step stopped the chain.** A-06 to A-09 depended on A-05's item and were never reached. Here each chained scenario has its own setup step (or a seed fixture), and a run records "not reached" separately from a failure.
- **The demo stopped answering.** Each round starts the lane 7 stack fresh (`pnpm demo`), checks the api and worker are up, and runs at most one Part at a time; the run's log tail is kept with the results.
- **Blocked items need a re-check.** Part B stayed blocked a week after RP-437 was Done. At the start of every round, each `blocked` Test Case is re-checked against its blocker's status.
- **Result format kept.** One comment per Test Case, ✅/❌ per check, screenshots attached and named `<scenario>-<n>-<what>.png`, "not run / not reached" never recorded as a failure.
