Design **Packages** for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support, Latin digits). Desktop first; the Package page must also work on a tablet. Use the Rabaed Claude Design kit (app shell, page templates, tokens) already in the project. RP-633, spec RP-616.

## Context
Inside every Rabaed project, the **Submittals** module lists submittals (Material, Supplier and Document Approval Requests: MAR, SAR, DAR). Each submittal follows its own Workflow and ends with a **Review Code**: A (Approved), B (Approved with Comments), C (Revise and Resubmit) or D (Rejected).

A **Package** is a named group of submittals that one company (usually the Contractor) puts together to follow one piece of work, e.g. "Bathrooms – Tower 1".
- Numbered per project and owning company, `PKG-001`, `PKG-002`: each company counts its own, so two companies' Packages can share a number and the card always shows the owning company next to it. Numbers are always shown left to right, even in Arabic.
- It has **no Workflow of its own**. The Contractor builds it from its Drafts, then **Submits the Package once**, which submits every submittal in it. From then on, each submittal follows its own Workflow to its own Review Code; the Package only shows their progress.
- Status: **Open** (nothing in it submitted yet) → **In Progress** (as soon as any submittal in it is submitted) → **Done**, once every latest submittal in it has closed at Code A, B or D. A Code C waits for its Revision, which joins the Package by itself, as does the replacement of a Code D. A replacement raised after Done puts it back In Progress. Say **Done**, never "Closed".
- While **Open**, the owner can add and **remove** submittals, rename it, or delete it (its Drafts stay, just without a Package). Once **In Progress**, submittals can still be **added**, but **never removed**; it can still be renamed (the rename is recorded).
- A submittal belongs to at most one Package.
- Comments raised from its submittals (from Code B) show on the Package **for information**; they are not part of it.

**Visibility rule (critical):** a viewer sees a Package **only if they see at least one of its submittals**, and inside it **only the submittals they see**. Every count on a card, the page or a notification counts only those. So an Open Package is seen only by its own company; a Consultant engineer narrowed to Electrical sees a mixed Package only through its Electrical submittals (and its status as one word). Never show another company's Open Package, its name or its Drafts. The owning company shows as its Company name.

**Age:** items show how many weeks they have sat at their current step, as up to 4 dots (4+ all red). **Never show due dates, deadlines, SLAs or "overdue".**

## What to design

### 1. Packages view (in the Submittals module)
- A third toggle next to **List** and **Kanban**: **Packages**.
- A Kanban with three columns: **Open · In Progress · Done**, with counts.
- Each card: `PKG-004` (LTR), the name, the owning company, the status, and the counts as the viewer sees them: submittals by Review Code (A / B / C / D chips with numbers) and "still open: n". A small progress bar: closed of total.
- "+ New Package" (only for a company that can build one), search, and filters (Trade, owning company).

### 2. Package page
- **Header:** `PKG-004`, name (Arabic and English), owning company, status chip, and the counts row from the card. The owner can **rename** it; while Open, also **remove** items and **delete** it (with a confirmation saying the Drafts stay).
- **Submittal table:** Document Number (LTR; "Number on submit" for a Draft), Subject, Type chip (MAR / SAR / DAR), Trade, **With** (the company and person holding it now), Review Code badge (or the current Stage), age dots. Revisions show as "MAR-041 Rev 1" with a link to the earlier one.
- **Selection and bulk actions:** checkboxes on the submittals waiting on the viewer. The bulk action (e.g. "Code A") is offered only when every selected item offers the **same** Transition; one **Action Form** (e.g. Remarks) opens once and applies to each; when the Transition offers "Assign to", one Member for all. It is **all or nothing**: if one item can't take it, nothing is done, and the message names that item and why. Each item is signed exactly as in a single Transition (ADR 0017: every Transition is signed), so a Member without a Signature is refused for all of them, and the message says so (RP-616 story 44, reworded 2026-10-19).
- **Add items** (owner): pick from the company's submittals the viewer can see (Drafts, items at internal review, or already submitted), with a search and a Trade filter; items already in another Package are marked and can't be picked.
- **Submit Package** (owner): submits every not-yet-submitted item in one go, **all or nothing**. A confirmation lists them; a **not-ready list** (e.g. "Draft 'Floor tiles': required field Supplier missing") names each item that blocks it, linking to it. The page lists them before any attempt, and Submit Package is offered only once the list is empty (RP-974); it disappears once nothing is left to submit. Each item gets its own Document Number when submitted.
- **Notification** (small): the Consultant gets one notification, "C1 Submitted PKG-007 Bathrooms – Tower 1: 8 submittals", where the number counts only what that person sees.
- **Comments (for information):** a collapsible section listing Comments raised from these submittals, with their Stages, and a note "Comments are not part of the Package".
- Empty states: a new Open Package with no items; a Done Package.

### 3. On the submittal
- A **Package chip** (`PKG-004 · Bathrooms – Tower 1`) on submittal cards in List and Kanban, and on the submittal's own page next to its Trade and Location. The chip opens the Package page. Package is **not** a Form field.
- A **Package filter** in the List and Kanban toolbars.

## Screens to produce
- **Contractor PM**: the Packages view; an **Open** Package being built (Add items, the not-ready list in the Submit dialog); an **In Progress** Package.
- **Consultant PM**: an **In Progress** Package with several submittals selected and the bulk Transition's Action Form open; and the all-or-nothing message when one item can't take it.
- **Consultant engineer narrowed to Electrical**: the same Package showing only its Electrical submittals and counts.
- Every screen in **English and Arabic (RTL)**. Document and Package numbers stay LTR inside Arabic text.

## Reference (RP-633)

The product owner's prototype is `design/reference/claude-design/ui_kits/app/packages.html` (2026-10-17). Its embedded Thmanyah fonts were removed, as the licence requires, so it renders in fallback fonts. Take its **look** from it: the Package card, the page header layout, the counts panel, the bulk bar and the item slide-over. Where it differs from this prompt, the spec RP-616, `GLOSSARY.md` or `docs/visibility.md`, those win (product owner, 2026-10-17; the general rule is `design/README.md` › "Which design a page follows"). The known differences:

| Area | The prototype shows | Build this instead |
| --- | --- | --- |
| Where | A separate "Packages" project tab with its own Kanban and List | A **Packages** toggle next to List and Kanban inside the Submittals module |
| Status | Not started / In progress / Needs attention / Complete; D counted as bad | **Open / In Progress / Done**; Done when every latest item is closed at A, B or D; a C waits for its Revision |
| Number | `PKG-TWR-TMC-001` | `PKG-001` per Project and owning Participant, LTR, beside the owning Company |
| Companies | From → To Companies | The owning Company only |
| Counts | A/B, C/D, In review, Missing, by Type | One count per Review Code (A–D) plus "still open", only from the submittals the viewer sees |
| Item table | Number, Title, Type, Trade, Rev, Status, Code, Current owner (a person), Due | Document Number, Subject, Type, Trade, **With** (a Company name for another Company, V14), Review Code or Stage, Step Age dots |
| Dates | "Target Week 40", "Needed by", a Due column and field | None: no due dates, deadlines or SLAs anywhere; Step Age dots only |
| Expected ("Missing") items | Placeholder slots that hold the Package open | Not built |
| Remove | Removing a submittal at any time | Remove only while the Package is **Open** |
| Bulk | A Code and comment per item; signing Steps not excluded; no "Assign to" | One Transition for all, one **Action Form** (Remarks), optional "Assign to", all or nothing; each item signed as in a single Transition (no separate signing rule) |
| Not in the prototype | — | Submit Package with its not-ready list; rename; delete while Open; Comments (for information); the Package chip on submittal cards and the item page; the Package filter in List and Kanban. Build them from this prompt in the prototype's style |
| Name | One name | Arabic and English names |
| Words | Title, Discipline, comment, Shop drawing, Complete, Current owner; Types DAS and MS | Subject, Trade, Remarks, SAR, Done, With; Types MAR, SAR and DAR only |
| Visibility | Every Company's Packages on one board, including another Company's empty one; "Created by" and an activity log naming other Companies' people | Another Company's Open Package is never shown; a Package is seen only through the submittals the viewer sees; other Companies by Company name only |
| Digits | Arabic-Indic digits in Arabic names | Latin digits everywhere |
| Shell | The shared projects page shows "Overdue" (متأخر) | Never "overdue" (not part of Packages; don't copy it) |
