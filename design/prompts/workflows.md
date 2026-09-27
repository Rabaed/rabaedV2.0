Design the **Workflow** experience for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support). There are two parts:

- **Part A: Settings → Workflows:** where admins see, build, version and publish workflows.
- **Part B: "View workflow" inside a submittal:** where anyone working on an item sees its workflow and where the item is in it.

---

## Context (applies to both parts)

In Rabaed every submittal, inspection, snag and report is a **Work Item** of a **Work Item Type** (e.g. MAR – Material Approval Request, SAR – Shop Drawing, DAR – Document, IR – Inspection Request). Each Type uses one **Workflow**.

A Workflow is a diagram:
- **Steps** are the boxes: a point where the item waits for someone, e.g. "Contractor Engineer", "Contractor PM review", "Consultant Engineer review", "Consultant Manager decision".
- **Stages** group Steps and are the Kanban columns: Drafts, Internal Review, Revised & Resubmitted, Pending Approval, Approved, Rejected, Cancelled.
- **Transitions** are the arrows. Each one is a button the user presses, with a label such as "Send for Review", "Return", "Submit", "Approve – Code A", "Approve with Comments – Code B", "Revise & Resubmit – Code C", "Reject – Code D".

Each Transition has:
- a **type**: Send (within the same company), Submit (hand-over to another company), Return (back within the same company), Close or Cancel;
- an optional **condition**, e.g. "if Cost impact > 500,000 SAR go to PM approval";
- an **outcome**, where it sets a Review Code;
- **signing**: Submit and final-code buttons require the user's signature and a confirmation pop-up;
- its own **Action Form**: the pop-up shown when the button is pressed, e.g. pick the code, write comments, attach files;
- **notifications**: who is told, on which channel.

Each Step has:
- a **name**;
- its **Stage**;
- **who can hold it**: a project role (Contractor / Consultant / Owner Representative / Owner) plus a required permission (e.g. Review, Approve); the right company is chosen automatically by Trade and Location;
- an **outcome mode**: none / recommend a code (informational, for the manager) / issue the final code / inspection result;
- an optional **default person** per company.

**Versioning:**
- Workflows have versions: Draft, then Published, and a published version **never changes**.
- Publishing v3 does not affect items already running on v1 or v2. They stay on their version until they finish.
- New items use the latest published version.
- Items on an older version show a notice: "Workflow updated to v3", with "View new version".

**Library levels:**
- **Rabaed Default:** ready-made, read-only.
- **Company library:** the company's own.
- **Project:** in use in this project.

Using one always **copies** it; it never links.

**Visibility rule (critical):** each company's internal back-and-forth is private. A Contractor must not see the Consultant's internal steps in detail (who reviewed, internal returns, recommended codes), and vice versa. The Contractor only sees what crosses between companies: Submit and the final code.

**Rabaed shows no deadlines or SLAs.** It shows only **age**: weeks at a step, as up to 4 dots.

---

## Part A: Settings → Workflows

### A1. Workflows list
- Inside **Project → Settings → Workflows**, with the project settings navigation on the left: General, Participants, Visibility, Positions, Trades & Locations, Stages, Document Numbering, **Workflows**, Forms.
- Tabs: **In this project** · **Company library** · **Rabaed Defaults**.
- Each row shows:
  - the workflow name, e.g. "Material Submittal – 2-tier review";
  - the latest version and its status (Published v3 / Draft v4 in progress);
  - the Work Item Types using it (chips: MAR, SAR);
  - **items running per version** (e.g. v1: 2 · v2: 14 · v3: 31);
  - the last published date and by whom;
  - actions: Open, Duplicate, Copy to company library, Archive.
- A "+ New workflow" button, with a choice: start blank / copy from Rabaed Default / copy from Company library.
- Empty state for a project with no custom workflows yet.

### A2. Workflow detail page
- Header: name, status, the version selector (v1, v2, v3 published; v4 draft), and actions: "Edit draft", "Publish", "Duplicate".
- Tabs:
  1. **Diagram:** a read-only view of the selected version.
  2. **Versions & history:** a timeline of versions, each with the publisher, date, change note, and the number of items still running on it. "Compare" opens A5.
  3. **Used by:** the Work Item Types attached, and the items per version with a link to the list filtered by version.
  4. **Activity:** an audit of edits and publishes.

### A3. Workflow builder (the main design)
A visual editor in the style of React Flow:
- **Canvas:**
  - Stages are horizontal **bands**, e.g. Drafts | Internal Review | Pending Approval | Approved / Revise & Resubmit / Rejected.
  - Steps are **cards** placed inside a band.
  - Transitions are **arrows** with their button label on the arrow.
  - End Steps are round or pill "terminal" shapes coloured by outcome: Approved green, Revise orange, Rejected red, Cancelled grey.
  - Pan, zoom, minimap, snap-to-grid, auto-layout.
- **Left palette:** add Step, add End (Approved / Revise / Rejected / Cancelled), and templates for common patterns ("2-tier internal review", "Consultant engineer → manager").
- **Right side panel** edits whatever is selected.
  - **When a Step is selected:**
    - name (EN/AR), Stage;
    - "Who holds it": role + permission, with a live example: "In this project: Design Consultants LLC → pool: Ahmed, Sara";
    - outcome mode, signing on/off;
    - which Form sections are editable here.
  - **When a Transition is selected:**
    - button label (EN/AR), type (Send / Submit / Return / Close / Cancel), outcome (A/B/C/D/…);
    - condition builder: no code, rows like *[Field] [operator] [value]* with AND/OR;
    - signing requirement;
    - **Action Form** editor: a mini form builder for the pop-up, with a live preview of the pop-up;
    - **notifications**: recipients (next holder, raiser, company admins, Distribution List), channels (in-app, email), and message template.
- **Validation panel** (bottom or a side drawer) that updates live, with clickable errors that zoom to the problem. Examples:
  - "Step 'Consultant Manager' has no way forward"
  - "Submit must require signature"
  - "Return can only go back within the same company"
  - "Condition uses field 'cost_impact' that doesn't exist in the form"
  - "Two conditions on 'Approve' can both match"
- A **test run / simulate** button: pick a sample item and click through the buttons to see the path, with no real data.
- Top bar: "Draft v4 · unsaved changes", Undo/Redo, Validate, **Publish**.

### A4. Publish flow
- A modal:
  - summary of changes since v3;
  - validation passed ✓;
  - a required change note;
  - impact: "31 items on v3 and 16 on older versions **keep their version**. New items will use v4."
  - Confirm.
- After publishing: a toast, and the version timeline updates.

### A5. Compare versions
- Side-by-side or overlay diagrams of v3 vs v4. Added steps and transitions are highlighted green, removed ones red, changed ones orange, plus a list of the changes in plain words.

### A6. Attach a workflow to a Work Item Type
- From **Settings → Work Item Types**, each Type row has a "Workflow" dropdown.
- Changing it shows the same impact note: only new items are affected.

---

## Part B: "View workflow" inside a submittal

On the submittal detail page (tabs: Submittal Details · Chat · Internal Communication; right side: Status card and Approvals Log), add a **"View workflow"** button next to the Status card. It opens a large drawer or modal.

### B1. What it shows
- The workflow diagram of **the version this item is pinned to**, e.g. "Material Submittal – 2-tier review · v2".
- If a newer version exists, a banner: "This item follows v2. The workflow was updated to v3", with "View v3" (read-only, for information).
- **Where the item is now:** the current Step is highlighted, with a pulsing outline, and shows:
  - the holder: a person, or "Pool: Design Consultants LLC (2 people)";
  - the age dots, e.g. "2 weeks at this step".
- **The path so far:** traversed steps and arrows are drawn solid; steps not yet reached are faded.
- Each passed step shows who acted, when, which button they pressed, and a ✍ icon if signed. Example: "Ali Sonour · Contractor PM · Submitted · 19/06/2025 16:19 ✍".
- **What's next:** the buttons available from the current step, shown as outgoing arrows with their labels. If the viewer holds the step, the arrows are clickable shortcuts to the actions; otherwise they're informational.
- **Revisions:** if this is Rev 1, a small chain at the top links to Rev 0 (Code C). Click to open Rev 0's workflow path.

### B2. Visibility inside the view (important)
- **Viewer from the Contractor:**
  - the Contractor's own steps appear in full, with names, returns and times;
  - the Consultant's internal steps are **collapsed into one grouped block**: "Design Consultants LLC review · Pending Approval", with no person names, no internal returns and no recommended code;
  - they see only the entry point (Submit) and the final outcome (e.g. "Code C issued · 21/06/2025 ✍ Mohammed Al Shamsi, Consultant Manager"). The signer's name on the final code is shown because it is on the certified PDF.
- **Viewer from the Consultant:** mirrored. Their own steps are in full, and the Contractor's internal review is collapsed into "TMC Constructions internal review".
- **Owner Representative:** sees every company's internal part collapsed. Only the hand-overs and final codes are shown.
- A small "Some steps are grouped because they are internal to another company" note, with an info icon.

### B3. Layout and states
- Drawer at ~70% width on desktop; full screen on phone, with a vertical timeline version of the diagram (steps listed top to bottom, current step highlighted). Diagrams are hard to read on a phone.
- States to design:
  1. Item in Internal Review, viewed by the Contractor PM who holds it (next-step arrows clickable).
  2. Item at Pending Approval, viewed by the Contractor (Consultant part collapsed, age 2 weeks).
  3. The same item viewed by the Consultant Manager (full Consultant detail, Contractor part collapsed, Recommended Code "B" visible to them).
  4. A closed item with Code C, and the Rev 1 chain.
  5. An item on v2 with the "updated to v3" banner.
  6. Phone timeline version.
  7. **Arabic RTL version** of state 2. The diagram flows right to left; numbers stay left to right.

---

## Visual direction
- Clean, modern SaaS in the style of the existing Rabaed screens: white surfaces, light grey background, orange primary accent (~#E8552B).
- Stage bands in soft tints, each Stage with a consistent colour used everywhere in the product.
- Step cards: role icon + name + holder, rounded corners. Arrow labels are small pills.
- Review Code colours: A green, B green with a comment icon, C orange, D red. Pair shape or icon with colour, never colour alone.
- Age dots: grey, turning red week by week.
- Desktop first, at 1440px. The builder is desktop only; the item workflow view must also work on a phone.

## Sample data
- Project "Dubai Marina Tower – Phase 2". Contractor TMC Constructions, Consultant Design Consultants LLC, Owner Representative Al Futtaim PMC.
- Workflow "Material Submittal – 2-tier review":
  - **v1:** Engineer → PM → Consultant Manager.
  - **v2:** adds a Consultant Engineer step before the manager.
  - **v3:** adds the condition "if Cost impact > 500,000 SAR → Owner Representative approval before the final code".
  - Items running: v1: 2 · v2: 14 · v3: 31.
- Steps (v3):
  1. Contractor Engineer (Drafts)
  2. Contractor PM review (Internal Review)
  3. Consultant Engineer review, recommends a code (Pending Approval)
  4. Consultant Manager decision, issues the code (Pending Approval)
  5. Owner Representative approval, conditional (Pending Approval)
  6. Ends: Approved (A/B), Revise & Resubmit (C), Rejected (D), Cancelled
- Transitions: Send for Review (1→2), Return (2→1), Submit ✍ (2→3), Send to Manager (3→4), Return to Engineer (4→3), Approve A ✍, Approve with Comments B ✍, Revise & Resubmit C ✍, Reject D ✍ (4→ends), "Send to Owner Rep" (4→5, condition), Owner Approve ✍ / Owner Return (5→…).
- Example item: `TWR-TMC-EL-MAR-041` "Lighting Fixtures", on v2. Path: Hafiz Hamdan created → Ali Sonour sent back once (Return) → Hafiz re-sent → Ali Submitted ✍ 19/06/2025 → at Consultant Engineer review (pool: Ahmed bin Said, Sara) · 2 weeks.

Produce an interactive prototype:
- Part A: the list, the detail tabs, the builder (select Steps and Transitions and edit them in the side panel, the validation panel showing errors, simulate mode), the publish modal and version compare.
- Part B: the drawer opening from the submittal page, and switching the viewer (Contractor / Consultant / Owner Rep) to show how the collapsed groups change.
