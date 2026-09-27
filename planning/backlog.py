"""Rabaed Project Module backlog -> Jira CSV import.

Edit the BACKLOG structure below, then run:  python planning/backlog.py
Output: planning/rabaed-jira-import.csv (Issue Id / Parent Id linking, works with Jira Cloud CSV import).
Specs referenced in descriptions live in CONTEXT.md and docs/.
"""
import csv
from pathlib import Path

# (phase label, epic summary, epic description, [ (story summary, acceptance criteria, priority) ])
BACKLOG = [
# ---------------- Phase 0: UX & design ----------------
("phase-0-ux", "UX research & information architecture",
 "Understand the people who will use Rabaed on real projects and design the structure of the product before any UI is built.",
 [
  ("Define personas", "Personas written for: Contractor Engineer (site, phone), Contractor PM, Document Controller, Consultant Engineer, Consultant Manager, Owner Representative, Owner executive, Authorized Person, Rabaed Engineer. Each has goals, devices, frequency and pains.", "High"),
  ("Interview 6–10 real users across Contractor, Consultant and Owner", "Claude prepares the interview guide and note template; product owner runs interviews (no designer on the team); at least 2 per side; Claude synthesises findings with quotes and top 10 pains.", "High"),
  ("Map core journeys", "Journey maps for: submittal lifecycle incl. Code C revision, package, inspection request (WIR) on site, daily site report, snag closure, drawing review with markups.", "High"),
  ("Information architecture & navigation", "Sitemap for platform level (home, projects, company) and project tabs; navigation model agreed for desktop and phone; Rabaed Admin IA separate.", "High"),
  ("Screen inventory & MVP screen list", "Every screen listed with persona, device, priority; MVP cut agreed with product owner.", "Medium"),
 ]),
("phase-0-ux", "Design system (bilingual, RTL-first)",
 "One visual language and component library for web and future app, designed Arabic/RTL and English from day one.",
 [
  ("Collect existing design sources", "Existing Claude-made designs and the old Figma file (colours, components) gathered into design/reference/ in the repo; inventory of what to keep, refine or drop.", "Highest"),
  ("Brand foundations", "Starting from the existing Figma colours and components: logo usage, colour palette (incl. Stage, Review Code and Step Age colours), typography pairing for Arabic and Latin, iconography, tone of voice.", "High"),
  ("Design tokens", "Colour, spacing, radius, type scale and elevation tokens defined and exported for code (Tailwind theme).", "High"),
  ("RTL & bilingual rules", "Mirroring rules, bidirectional text handling, number/date display (incl. optional Hijri), bilingual label patterns documented with examples.", "High"),
  ("Core component specs", "Specs for buttons, inputs, selects, tables, Kanban card, Stage badge, Review Code badge, Step Age dots, avatar/company chip, file tile, empty/error/loading states.", "High"),
  ("Accessibility baseline", "WCAG 2.2 AA targets: contrast, focus, keyboard, touch sizes (≥44px on phone) documented and checked in components.", "Medium"),
  ("Component library in code with Storybook", "Components implemented (shadcn/ui + Tailwind), each with EN and AR stories, light theme; visual regression snapshot per component.", "High"),
 ]),
("phase-0-ux", "Key flow prototypes & usability testing",
 "High-fidelity, clickable prototypes of the flows that make or break the product, tested with real users before build.",
 [
  ("Logic prototype: workflow and visibility simulator", "Single HTML file (mattpocock prototype skill, LOGIC branch): play Contractor/Consultant/Owner members, move a submittal through Send, Submit, codes, Revision and Package, and see live who can see what. Used to validate docs/visibility.md with users before build.", "Highest"),
  ("Coded app shell with mock data for UI variants", "Minimal app shell + design system + mock data so screen prototypes are judged inside the real layout (prototype skill, UI branch, ?variant= switcher, hidden in production).", "Highest"),
  ("Prototype: project workspace shell and tabs", "Project header, tab bar (Dashboard, Submittals, Inspections, Snag List, Site Reports, Drawings, Files, Views, Schedule (coming), Settings; Packages inside Submittals, Activity Feed inside Dashboard, Approved Supplier List inside Settings), Need My Action entry, phone variant.", "Highest"),
  ("Prototype: submittal list, Kanban and detail", "List and Kanban (Stages as columns, Steps as swimlanes), detail with Details / Chat / Internal Communication tabs, approvals log, Linked items.", "Highest"),
  ("Prototype: Transition pop-ups and signing", "Send for Review, Return, Submit, Recommend Code, Issue Code A–D with comments, signing confirmation, missing-signature error.", "Highest"),
  ("Prototype: Revision flow", "Create Rev 1 from Code C, previous-revision panel, carried Markups needing replies.", "High"),
  ("Prototype: inspection on phone", "Request inspection, link approved submittals, on-site checklist with photos, Failed → Snag creation, result.", "Highest"),
  ("Prototype: daily site report on phone", "Fill a large report quickly (manpower/equipment tables, weather, photos), autosave, submit.", "High"),
  ("Prototype: Form builder", "Palette, sections, field properties, conditions, EN/AR/phone/PDF previews, publish errors.", "High"),
  ("Prototype: Workflow builder (React Flow)", "Stage bands, Steps, Transitions, side panel (actor rule, outcome, action form, notifications), validation errors, publish.", "High"),
  ("Prototype: drawings viewer, Markups and overlay", "Viewer, Markup placing/answering, overlay two revisions, Pins.", "Medium"),
  ("Prototype: Floor and Plan views", "Tower → floors with Location Status, plan with Pins filtered by visibility.", "Medium"),
  ("Prototype: Document Numbering settings page", "Clickable design of Settings → Document Numbering: segment chips (add, drag to reorder, remove, max 6), per-segment options, separator, sequence digits, sequence-scope ticks, live preview with example values, per-type override list, 'applies to new items only' confirmation, read-only view for non-admins, EN and AR (RTL) versions. Based on the existing 'Document Numbering' design.", "High"),
  ("Prototype: Project Settings", "Participants and roles, Visibility grants with Visibility Gap warnings, Positions, numbering pattern builder with live preview, Stages.", "High"),
  ("Prototype: Rabaed Admin", "Company onboarding, member support, reassign/reset with reason, monitoring screens.", "Medium"),
  ("Usability test round 1", "5+ participants across roles run tasks on the prototypes; success rate and issues logged; top issues fixed in designs.", "Highest"),
  ("Usability test round 2", "Re-test fixed flows; sign-off that MVP flows are ready for build.", "High"),
 ]),
# ---------------- Phase 1: foundations ----------------
("phase-1-foundations", "Platform foundations & DevOps",
 "Repository, environments and delivery pipeline on AWS, ready for two Instances (ADR 0005).",
 [
  ("Repository and project structure", "Monorepo with web app, API, workers and shared packages; lint, format, type-check; CONTRIBUTING and CLAUDE.md.", "Highest"),
  ("CI pipeline", "Every PR runs lint, type-check, unit, integration and visibility test suites; failing visibility test blocks merge.", "Highest"),
  ("Infrastructure as code for AWS", "Dev, staging and production environments defined as code in a Gulf region; the same code can deploy a second Instance.", "High"),
  ("PostgreSQL, object storage and KMS", "Managed Postgres with backups and PITR; S3 buckets with Project-prefixed keys; KMS keys for encryption and PDF sealing.", "High"),
  ("Background workers and outbox processor", "Worker service processes the outbox with retries and dead-letter; jobs visible for the Job Monitor.", "High"),
  ("Observability", "Structured logs, metrics, traces and alerting; no customer content in logs.", "Medium"),
  ("Transactional email", "Email provider set up with domain authentication; templates are i18n; delivery events captured into the Delivery Log.", "Medium"),
 ]),
("phase-1-foundations", "Identity, Companies & Members",
 "Companies onboarded by Rabaed, Members invited by the Authorized Person, signatures on file.",
 [
  ("Authentication", "Email + password sign-in with MFA option, password reset, session management, lockout after failed attempts.", "Highest"),
  ("Company model and onboarding API", "Company with CR, VAT (unique), official name (EN/AR), Authorized Person; created only via Rabaed Admin.", "Highest"),
  ("Member invitation and management", "Authorized Person invites, deactivates Members; Member belongs to one Company; can_create_projects flag.", "Highest"),
  ("Member profile and signature", "Member uploads/draws a Signature; versioned (member_signature); signing blocked without one with a clear message.", "High"),
  ("Authorized Person transfer", "Only via Rabaed Admin with reason; history kept.", "Medium"),
 ]),
("phase-1-foundations", "Tenancy & Visibility",
 "Project-level isolation with RLS and the visibility rules in docs/visibility.md. The #1 requirement.",
 [
  ("RLS framework", "Every tenant table has project_id or company_id and an RLS policy; request sets member context transaction-locally; a query without context returns nothing.", "Highest"),
  ("work_item_access and visibility grants", "Access rows maintained by the engine; Member grants ⊆ Participant grants enforced on write; Location grants include subtree.", "Highest"),
  ("Visibility test suite", "All 22 scenarios in docs/visibility.md automated against the API; runs in CI; blocks release on failure.", "Highest"),
  ("404-not-403 and ID policy", "Inaccessible resources return 404; all public IDs are UUIDv7.", "High"),
  ("Signed file URLs", "Files served only through short-lived signed URLs after an access check; expired links fail.", "High"),
  ("Leak-channel checklist in PR template", "PR template asks which leak channels a change touches (counts, search, emails, pins…) and requires scenario updates.", "Medium"),
 ]),
("phase-1-foundations", "Audit trail & compliance baseline",
 "Append-only, hash-chained history and SOC 2 / ISO 27001-ready controls (ADR 0001).",
 [
  ("Hash-chained work_item_event", "Insert-only for the app role; seq gap-free per item; prev_hash/hash chain; verification job detects tampering.", "Highest"),
  ("project_event and Activity Feed source", "Project-level events recorded append-only.", "High"),
  ("admin_action log", "Every Rabaed Admin read of customer data and every action logged with engineer and reason.", "High"),
  ("Security controls baseline", "Encryption at rest/in transit, least-privilege IAM, secrets management, dependency scanning, access review procedure documented.", "High"),
 ]),
("phase-1-foundations", "Internationalisation & RTL",
 "Arabic and English from day one, ready for more languages via Lokalise keys.",
 [
  ("Translation key framework with Lokalise", "All UI strings are keys; Lokalise sync in CI; missing keys fail the build for EN/AR.", "High"),
  ("Locale and direction switching", "Per-Member language; full RTL layout mirroring; bidi-safe components.", "High"),
  ("Dates, numbers and optional Hijri", "Locale formatting; Project setting to show Hijri beside Gregorian.", "Medium"),
 ]),
# ---------------- Phase 2: engines ----------------
("phase-2-engines", "Projects, Participants & Settings",
 "Creating Projects and configuring who takes part and who sees what.",
 [
  ("Create Project", "Project Creator creates a Project; Host Company and per-company Project Number assigned; creator becomes Project Admin; defaults copied in.", "Highest"),
  ("Participants and Project Roles", "Invite Companies in a role (incl. Owner, custom roles based on a built-in role); withdraw Participant.", "Highest"),
  ("Project Members and Positions", "Company adds its Members to the Project; Positions with Function Permissions per Work Item Type; defaults copied.", "Highest"),
  ("Trades, Locations and Scopes", "Default Trades extended per Project; Location tree with configurable levels; Scopes/Sub-scopes under Trades.", "High"),
  ("Visibility settings and Visibility Gap warnings", "Grant 'all' or chosen values per dimension for Participants and Members; warnings for gaps and overlaps.", "Highest"),
  ("Stages per Module", "Default Stages per Module; rename/extend by Project Admin.", "High"),
  ("Project Admins and closing a Project", "Appoint Admins; close Project makes everything read-only; Signatory Access still works.", "Medium"),
 ]),
("phase-2-engines", "Form engine",
 "Schema-driven forms per docs/form-engine.md.",
 [
  ("Schema format and shared validator", "Schema types defined; one validator used in browser and server; hidden fields ignored; draft save skips required checks.", "Highest"),
  ("Core field types", "text, textarea, number, currency, date/time, yes_no, select, multi_select, member, participant, headings.", "Highest"),
  ("Attachments and photos", "Files become Documents; camera capture on phone; EXIF time/GPS kept; frozen at first Send/Submit.", "Highest"),
  ("Tables and calculated fields", "Repeating rows with totals; formulas over numeric fields, no circular refs.", "High"),
  ("Checklists", "Answer sets, comment/photo on negative, create Snag on negative; checklist templates copied from library.", "Highest"),
  ("Pick lists and work item references", "Sources: Approved Supplier List, Scopes, Locations, custom; work_item_ref creates a Link with type/outcome filters.", "High"),
  ("Conditions", "visible_if / required_if using the shared rule language.", "High"),
  ("Section editability by Step", "editable_at enforced server-side; field diffs recorded as events.", "High"),
  ("Aggregate field", "Weekly pulls totals from issued Dailies; flags missing days with add-late/ignore.", "Medium"),
  ("Form versioning", "Draft/publish; immutable versions; keys stable forever; Revision copies by key.", "Highest"),
  ("Autosave and reporting projection", "Autosave with per-field updated_at; reportable fields into work_item_field_value.", "Medium"),
 ]),
("phase-2-engines", "Form builder UI",
 "Visual builder for Forms and Action Forms.",
 [
  ("Builder canvas and palette", "Drag sections and fields; reorder; properties panel.", "High"),
  ("Bilingual editing and previews", "Edit EN/AR labels side by side; preview EN, AR (RTL), phone and PDF.", "High"),
  ("Publish with validation", "Live validation; server re-validates; clear error list linking to fields.", "High"),
 ]),
("phase-2-engines", "Workflow engine",
 "Run-time engine per docs/workflow-engine.md (ADR 0008).",
 [
  ("Definition model and publish validation", "Steps, Transitions, Stages mapping; all §1 checks enforced; immutable published versions.", "Highest"),
  ("take_transition command", "Single transaction with row lock and idempotency key; all checks and effects in §5.1; outbox for side effects.", "Highest"),
  ("Actor resolution and Step Pool", "Participant by role + Visibility; pool by permission + Visibility; default holder rules; overlap/gap handling.", "Highest"),
  ("Claim and release", "Only one claimer wins; Need My Action query.", "High"),
  ("Recommended and Issued Codes", "Recommend is internal; Issued Code on final step; outcomes A–D, inspection results.", "Highest"),
  ("Outcome hooks", "B creates Comments; C allows Revision; D allows replacement; supplier and drawing effects; package recompute.", "High"),
  ("Revisions and replacements", "create_revision and replace_rejected per §5.4–5.5.", "High"),
  ("Vacancies and withdrawal", "Member removal → vacant; Participant withdrawal cancels raised items and leaves Participant-level vacancies.", "High"),
  ("Conditions routing", "Rule evaluation over form, action form and attributes; blocked with clear message if none match.", "Medium"),
  ("Workflow version notice", "Items on older versions show 'Workflow updated to vN' with a view of the new version.", "Low"),
 ]),
("phase-2-engines", "Workflow builder UI (React Flow)",
 "Visual editor for Workflows.",
 [
  ("Canvas with Stage bands", "Steps as nodes inside Stage bands; Transitions as edges; zoom/pan; layout saved.", "High"),
  ("Step and Transition side panels", "Actor rule, outcome mode, signing; label, kind, condition builder, outcome, Action Form (form builder), notifications.", "High"),
  ("Validate, publish, version history", "Live validation, publish, compare versions.", "Medium"),
 ]),
("phase-2-engines", "Document numbering",
 "Configurable Document Numbers per Project.",
 [
  ("Numbering pattern settings with live preview", "Settings → Document Numbering. Project Admin builds the pattern from up to 6 segments + the sequence (segments: Project code, Work Item Type code e.g. MAR, Trade code, Company code, a Location level e.g. Zone/Building/Floor, a fixed text). Reorder/remove segments; choose separator (- or /); sequence digits 3–7 (zero-padded); tick which segments the counter counts separately for (sequence scope). Live preview with a real example (e.g. TWR-TMC-EL-MAR-001). One Project default pattern, optional override per Work Item Type. Saving warns that the change applies only to new items; existing numbers never change. Revisions keep the base number with the fixed 'Rev n' suffix (not configurable). Codes are 2–6 characters and come from each Trade/Location/Company/Type. Warn if the pattern has no Company segment and several Contractors share it (their counters would reveal each other's volume, visibility rule). Only Project Admins can edit; everyone else sees it read-only.", "High"),
  ("Gap-free assignment", "Assigned at first exit from Draft in the same transaction; never reused; Rev suffix for revisions.", "Highest"),
 ]),
("phase-2-engines", "Signing & Documental Records",
 "Sealed, verifiable PDFs per ADR 0003.",
 [
  ("Signing on Transitions", "Confirmation pop-up; event records signature version and content hash.", "Highest"),
  ("PDF rendering pipeline", "HTML template → PDF in record language (AR/EN/bilingual); appended PDFs/images; other files listed with hashes.", "Highest"),
  ("PDF Templates", "Several templates per Form; Rabaed Default portal and paper styles; versioned; engine always adds signing trail and QR.", "High"),
  ("PAdES sealing and timestamp", "KMS-held key signs PDF; RFC 3161 timestamp; tamper shows as broken in Adobe Reader.", "High"),
  ("Verification page", "QR opens a public page confirming the record's hash, outcome and date; no other data exposed.", "Medium"),
  ("Distribution by secure link", "Distribution List defaults per type; expiring tracked links; Delivery Log.", "Medium"),
 ]),
("phase-2-engines", "Library & Rabaed Defaults",
 "Three-level library (Rabaed, Company, Project) with copy semantics, and the default content.",
 [
  ("Library copy mechanics", "Copy Forms, Workflows, Types, Positions, checklists, templates down a level with provenance.", "High"),
  ("Default submittal types", "MAR, SAR, DAR with Forms and Workflows as agreed (engineer → PM → consultant engineer → consultant manager).", "Highest"),
  ("Default inspection (WIR), Snag, Comment types", "Forms, checklists, Workflows and results.", "High"),
  ("Default site reports", "Daily Site Report, Weekly, Quality, Safety forms and Workflows; Expected Frequency set.", "High"),
  ("Default Trades, Scopes, Stages, Positions", "Seeded bilingual defaults.", "High"),
 ]),
# ---------------- Phase 3: modules ----------------
("phase-3-modules", "Work item views & navigation",
 "How people find and act on work.",
 [
  ("Project workspace shell", "Header, tabs, breadcrumbs, per design.", "Highest"),
  ("List view", "Grouped by Stage, filters (Type, Trade, Location, date), sorting, counts from visible items only.", "Highest"),
  ("Kanban view", "Stages as columns, Steps as swimlanes, Step Age dots, Review Code badges.", "High"),
  ("Need My Action", "Everything assigned to me or in my pools, across Projects.", "Highest"),
  ("Work item detail", "Details, Chat, Internal Communication, approvals log, Links, Subtasks, revisions panel, inline file preview.", "Highest"),
  ("Search", "Postgres FTS over visible items only.", "Medium"),
 ]),
("phase-3-modules", "Submittals & Packages",
 "The first module to ship end to end.",
 [
  ("Submittals module end to end", "Create, send, submit, review, issue code, revise, reject/replace using default types.", "Highest"),
  ("Packages", "Group submittals; Open/In Progress/Closed computed; progress counts.", "High"),
  ("Submittal Register Import", "Excel upload, column mapping, Drafts created; available to Rabaed Admin during onboarding.", "Medium"),
 ]),
("phase-3-modules", "Inspections (WIR)",
 "Inspection requests from site to result.",
 [
  ("Inspection request and required links", "Request with Location/Trade/date; required links to approved submittals enforced.", "Highest"),
  ("On-site inspection on phone", "Checklist, photos, Snags from failures, result, re-inspection as Revision.", "Highest"),
 ]),
("phase-3-modules", "Snag List",
 "Snags, Comments and other follow-up types.",
 [
  ("Snag and Comment types", "Configurable Stages; raised_from links; source shows 'x of y comments closed'.", "High"),
  ("Snag views with Pins", "List, Kanban and plan Pins.", "Medium"),
 ]),
("phase-3-modules", "Site Reports",
 "Daily, weekly and checklist reports.",
 [
  ("Daily Site Report", "Large form on phone, review workflow, sealed PDF, distribution.", "Highest"),
  ("Weekly and other reports", "Weekly with aggregates, Quality, Safety.", "High"),
  ("Expected Frequency gaps and reminders", "Missing reports shown and reminded; add-late/ignore decisions.", "Medium"),
 ]),
("phase-3-modules", "Drawings",
 "Drawing register, revisions, markups and overlay.",
 [
  ("Drawing register and revisions", "Any file type; current/superseded; approved via drawing submittals.", "High"),
  ("Viewer and Markups", "In-browser viewer for PDF/images (DWG via conversion); Markups with replies; carry over; open Markups → Comments on B.", "High"),
  ("Overlay compare", "Overlay two revisions with difference highlighting.", "Medium"),
 ]),
("phase-3-modules", "Files",
 "OneDrive-style file management.",
 [
  ("Work item folders", "Virtual folders per visible Work Item with Documents and Documental Records.", "High"),
  ("Free folders and File Versions", "Folder permissions per Participant; file history.", "Medium"),
  ("Inline preview", "View PDFs, images and Office files without downloading.", "High"),
 ]),
("phase-3-modules", "Locations, Floor and Plan views",
 "The spatial experience.",
 [
  ("Site map upload and zone drawing", "Upload plan image; draw zone/villa polygons linked to Locations.", "Medium"),
  ("Floor view with Location Status", "Buildings → floors with Complete/In Progress/Issues/Pending from visible items.", "Medium"),
  ("Plan view with Pins", "Pins on plan Drawings, filtered by visibility.", "Medium"),
 ]),
("phase-3-modules", "Dashboard, Activity & notifications",
 "Overview for each role.",
 [
  ("Project dashboard (fixed widgets)", "Role-appropriate widgets computed over visible items only.", "High"),
  ("Activity Feed", "Project-level feed filtered by visibility and audience.", "Medium"),
  ("In-app and email notifications", "Per-Member preferences; recipients re-checked at send time.", "High"),
  ("Weekly Step Age report", "Per-Participant and Owner-level reports.", "Medium"),
 ]),
("phase-3-modules", "Approved Supplier List",
 "Project register of approved suppliers.",
 [
  ("Supplier register", "Preloaded list or built from approved supplier submittals; usable as pick list; visible Project-wide (name + approval only).", "Medium"),
 ]),
("phase-3-modules", "Chat & Internal Communication",
 "Conversation around a Work Item.",
 [
  ("Chat", "Immutable messages visible to Participants with access; attachments; notifications.", "High"),
  ("Internal Communication tab", "Internal notes and history visible only inside the Participant.", "High"),
 ]),
# ---------------- Phase 4: Rabaed Admin ----------------
("phase-4-admin", "Rabaed Admin portal",
 "Separate internal portal for Rabaed Engineers.",
 [
  ("Admin authentication and roles", "Separate identity; MFA required; separate DB role; every action logged.", "Highest"),
  ("Company onboarding", "Create Company with CR/VAT, Authorized Person invite, initial Project setup assistance.", "Highest"),
  ("Support actions", "Reassign, reset stuck step, transfer Authorized Person, unlock account, fix visibility; reason required.", "High"),
  ("Template authoring", "Publish library Forms, Workflows, checklists and paper-matching PDF Templates.", "High"),
  ("Monitoring", "Activity Log, Delivery Log, Job Monitor, audit-chain verification results.", "Medium"),
 ]),
# ---------------- Phase 5: launch ----------------
("phase-5-launch", "Security & compliance readiness",
 "Evidence for SOC 2 and ISO 27001.",
 [
  ("Penetration test", "External pen test incl. cross-tenant and visibility attempts; findings fixed.", "High"),
  ("SOC 2 readiness", "Policies, controls mapping and evidence collection set up.", "Medium"),
  ("Backup and restore drill", "Restore rehearsed and timed.", "Medium"),
 ]),
("phase-5-launch", "Pilot & launch",
 "First real project on Rabaed.",
 [
  ("Pilot project onboarding", "One real project with Contractor, Consultant and Owner onboarded via Rabaed Admin.", "High"),
  ("Pilot feedback loop", "Weekly feedback sessions; issues triaged into backlog.", "High"),
  ("Launch checklist", "Support process, status page, runbooks, go/no-go.", "Medium"),
 ]),
# ---------------- Phase 6: later ----------------
("phase-6-later", "Personalisation",
 "Features that let each Member tailor Rabaed to how they work. Not in the first release.",
 [
  ("User-selectable themes (4 themes)", "Four themes (e.g. warm light, cool light, dark, high-contrast for site/sunlight) built only from design tokens; each Member picks theme in their profile; choice saved per Member and applied on web and app; every component passes WCAG AA contrast in all four; Stage, Review Code and Step Age colours stay recognisable in every theme. Until then the product ships one theme and no hard-coded colours.", "Medium"),
 ]),
]


def main():
    out = Path(__file__).with_name("rabaed-jira-import.csv")
    rows, n = [], 0
    for phase, epic, epic_desc, stories in BACKLOG:
        n += 1
        epic_id = f"E{n}"
        rows.append({"Issue Id": epic_id, "Parent Id": "", "Issue Type": "Epic", "Summary": epic,
                     "Epic Name": epic, "Description": epic_desc, "Labels": f"rabaed {phase}", "Priority": "High"})
        for i, (summary, ac, prio) in enumerate(stories, 1):
            rows.append({"Issue Id": f"{epic_id}-S{i}", "Parent Id": epic_id, "Issue Type": "Story",
                         "Summary": summary, "Epic Name": "",
                         "Description": f"*Acceptance criteria*\n{ac}\n\nSee CONTEXT.md and docs/ in the repo.",
                         "Labels": f"rabaed {phase}", "Priority": prio})
    # Jira reads repeated "Labels" columns as multiple labels.
    header = ["Issue Id", "Parent Id", "Issue Type", "Summary", "Epic Name", "Description", "Labels", "Labels", "Priority"]
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            first, second = r["Labels"].split(" ")
            w.writerow([r["Issue Id"], r["Parent Id"], r["Issue Type"], r["Summary"], r["Epic Name"],
                        r["Description"], first, second, r["Priority"]])
    epics = sum(r["Issue Type"] == "Epic" for r in rows)
    print(f"{epics} epics, {len(rows) - epics} stories -> {out}")


if __name__ == "__main__":
    main()
