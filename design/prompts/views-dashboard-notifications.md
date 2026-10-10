# Change requests: views, Dashboard and notifications

Decided in the grilling session of 2026-10-06 (Work item views, Need My Action, Dashboard and Activity; RP-25, RP-33).
Paste one section at a time into the Claude Design project, check the result, then re-export the zip into `design/reference/claude-design/`.

These prototypes show UI intent only. Terms follow `GLOSSARY.md`. Every screen only needs to be responsive; a dedicated phone and app design comes later.

---

## 1. Project tabs

- A Module tab (Inspections, Snag List, Site Reports, Drawings, Files, Views) appears only once the Project has a Work Item Type in it. Dashboard, Submittals and Settings are always shown.
- Remove Schedule's greyed-out "Coming soon" tab. Rabaed shows no "Coming soon" tabs or cards.

## 2. Need My Action

- One name everywhere: **Need My Action** (بحاجة لإجرائي). Rename every "Assigned to me" (مسند إليّ) toggle in the Plan, Snag List and their phone variants.
- It is a toggle in the view toolbar of List and Kanban. It keeps the Steps I hold and the unclaimed Steps in my Step Pool. My own Drafts stay in view but are not counted.
- Each Project card on the Projects page shows "N need my action". Remove the home page's cross-Project "Needs my action" panel and its "Submittals need my action" KPI: home is the Projects list.
  - **Reversed 2026-10-07 (Epic RP-405, RP-407):** Home is built after all, with the cross-Project "Needs my action" panel and counts (visible items only), "4+ weeks at their step" instead of "Overdue", and no Payment Requests.

## 3. List

- One row per Revision chain, showing its latest Revision, with a "Show all Revisions" switch.
- Columns: Document Number (always left-to-right), Subject, Type, Stage, **With**, Step Age dots, Trade, Location, Review Code or Inspection Result, Submission Date. Only my own Company's items show a Creation Date column.
- "With" in my own Company: "<Step> · unclaimed" or the claimer's name. Another Company: its name only.
- Filters: Need My Action, Type, Stage, With, Trade, Location, Review Code / Result, Step Age (1+, 2+, 3+, 4+ weeks), Submission Date range. A search box (Document Number, Subject, Type, Trade, Location, Company). Sort by Step Age, Submission Date or Document Number. 50 rows per page.

## 4. Kanban

- Stages are columns. My own Company's Steps are swimlanes; another Company is one grouped lane with its name.
- Dragging a card highlights only the columns it can be dropped on; dropping opens that Transition's Action Form.
- Closed columns (Approved, Rejected, Cancelled) show the last 30 days, with "Show all" opening the List.

## 5. Dashboard (replaces the "Document categories" screen)

- Group cards by **Module** (Inspections, Submittals), one card per **Work Item Type**. Count "items", never "docs". Remove the word "categories".
- Bars follow the Type's outcome:
  - Review Codes: Pending, Revise (C), Approved (A), Approved (B), Rejected (D).
  - Inspection Results: Pending, Passed, Passed with Comments, Failed.
  - Neither: Pending, Approved, Rejected.
- Counts are per Revision chain, by its latest Revision. Pending means Submitted and still open. The raiser's own Company also sees a small "In preparation" figure for its Drafts and internal review.
- Footer: "Approved (A+B) 10 · 71%". **Remove "Time passed" and its bar**: Rabaed shows nothing measured against time or contract dates.
- Review Code cards add a Code C line: "Code C: 5 · approved on revision 3 (60%) · awaiting revision 2", plus "rejected after C" when there is any.
- Every number is a link to the List with the same filter.
- Top row: open / closed cards for the Snag List's Types (Snags, Comments). Remove the NCR, RFI and "Coming soon" cards.
- The Activity Feed panel sits on the Dashboard. Each entry reads "**C1** Submitted **MAR-0003** · Subject". It has filters for Module, Type and "only items I'm on", and a "View all" that opens it full height.

## 6. Watch

- A **Watch / Watching** button on the Work Item page. There is no list or count of watchers anywhere.

## 7. Notification settings (Member profile)

- One row per group: Step reached me or my pool · Items I watch · Sent Back to my Participant · Weekly Step Age report. The last row is shown only to Members who receive the report.
- Each row has an **In-app** switch and an **Email** choice: Off, Immediately, or Daily digest. The Weekly Step Age report row has only an **Email** on/off switch: the report is an email sent on its own schedule (Sunday morning), never in the bell.
- "Items I watch" expands to tick the outcomes that notify: A, B, C, D · Passed, Passed with Comments, Failed · Approved, Rejected, Cancelled.
- At the top: **Pause all email**, the **preferred language** (Arabic or English) for emails, and a list of Projects with a mute switch each.
