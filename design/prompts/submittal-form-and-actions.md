Design the **Submittal create / detail page and its action pop-ups** for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support). This is the core loop of the product: an engineer prepares a submittal, it moves through review with buttons, and every hand-over is signed. It works on desktop and on a phone.

## Context
- A **submittal** is a **Work Item** of a **Work Item Type**. Examples:
  - MAR – Material Approval Request
  - SAR – Shop Drawing Approval Request
  - DAR – Document Approval Request
  - Method Statement
- Each Type has its own **Form**, a set of sections with fields, and its own **Workflow**.
- The page reuses the existing submittal detail from `workflow-view.html`:
  - tabs **Submittal Details · Chat · Internal Communication**;
  - a Status card and Approvals Log on the right;
  - the "View workflow" drawer.

  Complete that page and add the create/edit form and the pop-ups.

### Every submittal has system fields (always shown, placed by the engine, not by the Form)
- Title
- **Trade** (exactly one), **Scopes / Sub-scopes** within that Trade (one or more), and **Location** (Zone → Building → Floor, one or more)
- **Package** (optional), e.g. "Bathrooms – Tower 1"
- **Links** to other Work Items: related, "depends on", and "replaces"
- **Subtasks** (one level only)
- **Document Number**, assigned **only when the item first leaves Draft**, e.g. `TWR-TMC-EL-MAR-041`. Before that it shows "Number assigned on send". Document Numbers are always shown left to right, even in Arabic.
- For a revision: **Rev n** and a "Previous revision" panel

### Form field types to show
- text / long text;
- number with unit;
- currency in SAR;
- date;
- yes/no, select, multi-select;
- **Manufacturer / Supplier picked from the Approved Supplier List**;
- member;
- **Link to another Work Item**, e.g. "Approved shop drawing";
- **attachments** and **photos**;
- **table** rows, e.g. a list of items with quantity and unit;
- headings and instructions.

Signatures are **never** fields in the form. They come only from signed buttons.

### Section editability
Each Form section says at which Workflow Steps it can be edited:
- The Contractor's sections are editable in Draft and Internal Review, then **locked once Submitted**.
- Locked sections show a small lock icon with "Locked after Submit".
- Attachments are **frozen** at the first Send. They show a 🔒 "Frozen · hash recorded" chip, and new files can't replace them. A new Revision is needed instead.

### Workflow
**Steps** (who holds the item) and **Transitions** (buttons):
- The buttons the viewer may press appear in a sticky **action bar**, e.g.:
  - **Send for Review** (to the Contractor PM, same company)
  - **Return** (back within the same company)
  - **Submit ✍** (to the Consultant; signed)
  - at the Consultant: **Send to Manager**, **Return to Engineer**, and the final code buttons **Approve – Code A ✍**, **Approve with Comments – Code B ✍**, **Revise & Resubmit – Code C ✍**, **Reject – Code D ✍**
  - **Cancel**
- Only the buttons the viewer is allowed to use appear.
- Nothing moves an item except these buttons. There is no Stage dropdown and no Edit or Delete after Submit.

**Holding the item:**
- A Step can be held by a **pool**, e.g. "Design Consultants LLC · Consultant Engineers (2)". A pool member presses **Claim** to take it, and **Release** returns it to the pool.
- The Status card shows **"With"**:
  - a person, for the viewer's own company;
  - the company name, for another company, e.g. "With Design Consultants LLC".

  Never show another company's people or internal steps. The exception is the signer of a final issued code.

**Age and codes:**
- **Age** is shown only as **Step Age**: weeks at the current step, 1–4 dots going from grey to red, e.g. "2 weeks at this step". There are **no due dates, deadlines or SLAs**, and never the word "overdue".
- **Review Codes:** A Approved (green), B Approved with Comments (green + comment icon), C Revise & Resubmit (orange), D Rejected (red). Always use shape or icon with colour.
- The Consultant Engineer may **recommend** a code, which only their own company sees. The Consultant Manager **issues** the final code.

## What to design

### 1. Create / edit submittal (desktop)
- **Header:** Type picker (MAR, SAR, DAR, Method Statement) when creating, the Title, and "Draft · Number assigned on send".
- **Left:** the Form as collapsible sections, with a section navigator and a "3 of 5 sections complete" indicator.
- **Autosave:** "Saved 10:42". Errors are shown inline, plus a summary at the top when Send is blocked.
- **System fields panel:** Trade, Scopes (chips), Location (tree picker), Package, Links (search Work Items by number or title, and show linked items with their Stage and Code), and Subtasks (add, then list with Stage).
- **Attachments:**
  - drag-drop, with file tiles showing type, size and version;
  - a PDF preview on click;
  - photos with time stamps.
- **Required links:** when a Type needs one (e.g. a MAR needs its approved Method Statement), show a checklist "Required before Submit: approved Method Statement ✓".
- **Sticky action bar:** Save draft · **Send for Review**.

### 2. Submittal detail (desktop), all Stages
- **Header:**
  - Document Number + Rev, Title, Type chip, Trade chip, and the Stage pill;
  - the Review Code badge when closed;
  - Step Age dots;
  - **View workflow**.
- **Tabs:**
  - **Submittal Details:** read view of the Form, with lock icons on locked sections.
  - **Chat:** a thread seen by every company that can see the item. Messages can't be edited or deleted.
  - **Internal Communication:** only the viewer's company sees it. It holds internal notes, internal returns and the recommended code.
  - **Linked items:** links, subtasks and the Package.
  - **History.**
- **Right column:**
  - Status card: Stage, "With …", age, and Claim / Release if in a pool.
  - **Approvals Log:** each hand-over with person, Position, company, time, the button pressed and a ✍ marker.
  - Documents: frozen files with a lock icon.
- **Linked item the viewer can't open:** a linked item the viewer's company can't see shows as "TWR-DCL-… · not visible to your company" and can't be opened. Where the rules allow it, the item can instead be viewed as its **issued PDF** inline.

### 3. Action Form pop-ups (the most important part)
Each button opens its own pop-up. Design these:
- **Send for Review:** an optional note and "Assign to" (a pool or a person in my company).
- **Return:** a required reason. The reason stays inside my company.
- **Submit ✍:**
  - a summary of what will be sent (number preview, attachments count, required links ✓);
  - an optional cover note;
  - then the **signature confirmation** (section 4).
- **Send to Manager** (Consultant Engineer):
  - **Recommend code** A / B / C / D;
  - a note;
  - a visible label "Only Design Consultants LLC sees the recommended code".
- **Approve with Comments – Code B ✍:**
  - a **comments table**, at least 1 row, each with a comment, a reference (sheet/page) and optional Location;
  - the note "Each comment becomes a Comment item in the Snag List, assigned to TMC Constructions";
  - then signing.
- **Revise & Resubmit – Code C ✍:** comments (required) and optional marked-up attachments, then signing.
- **Reject – Code D ✍:** a reason (required), then signing.
- **Cancel:** a reason (required). Show a warning if it has open Subtasks: "3 Subtasks will be cancelled".
- **Validation example:** Code B pressed with no comment rows gives "Add at least one comment".

### 4. Signature confirmation (DocuSign-style, no OTP)
- A focused dialog:
  - "You are signing **Submit** on `TWR-TMC-EL-MAR-041 · Lighting Fixtures`";
  - the member's saved **signature image**, name, Position and company;
  - date and time;
  - the line "A fingerprint (hash) of the submittal's exact content is recorded with your signature".
- A checkbox "I confirm I have reviewed this submittal", then **Sign & Submit**. There is no password or OTP.
- **Error state:** "You have no saved signature", with a link to **Profile → Signature** (draw or upload). The button stays disabled.
- **Success:** a toast "Submitted ✍ · With Design Consultants LLC". The Approvals Log gets a new row, and the number is shown if this was the first send.

### 5. Closed item and revisions
- **Code B:**
  - a green badge and an issued-PDF card ("Documental Record · sealed · QR verified");
  - a **"Comments 3 of 5 closed"** panel linking to the Snag List.
- **Code C:**
  - an orange badge;
  - a **Create Revision** button (the raising company only), which opens a new Draft `…-MAR-041 Rev 1` with the form and files copied;
  - a "Previous revision" panel showing Rev 0 with its Code C and comments;
  - a revision chain Rev 0 → Rev 1 in the header.
- **Code D:** a red badge and a **Create replacement** button, which makes a new number linked "replaces".
- **Workflow updated:** if the Workflow was updated since the item started, show the banner "This item follows v2. The workflow was updated to v3".

### 6. Phone
- A detail page with the header, the Status card and the tabs as a segmented control.
- The action bar is a bottom sheet with the allowed buttons (large, at least 44 px).
- The pop-ups are full-screen sheets.
- The signature confirmation is full-screen, with the signature image large.
- Creating a submittal on a phone: title, Trade, Location, photos from the camera, and attachments from Files, with autosave.

## States to design
1. Create MAR: a Draft with errors blocking Send.
2. Draft, Send for Review pop-up.
3. Internal Review, held by the Contractor PM: Return and Submit ✍ available.
4. The Submit ✍ signature confirmation, plus the "no saved signature" error.
5. Pending Approval as the Contractor sees it: "With Design Consultants LLC · 2 weeks", no Consultant names, Chat active, Internal Communication showing only TMC's notes.
6. Pending Approval as the Consultant Engineer sees it: Claim from the pool, then Send to Manager with a recommended code.
7. The Consultant Manager's Code B pop-up with comment rows, then signing.
8. Closed Code B with the Comments panel and the sealed PDF card.
9. Closed Code C, Create Revision, and a Rev 1 Draft with the Previous revision panel.
10. A linked item not visible to the viewer.
11. Phone: detail, action sheet, signature confirmation.
12. **Arabic RTL** version of states 3, 5 and 7. Document Numbers, codes and digits stay Latin (0123), left to right.

## Visual direction
- Use the existing **Rabaed Design System** tokens and components: cool light canvas (`#f6f7f9`), white cards, Tomato `#F95738` primary, Delft `#3D405B`, IBM Plex Sans / Thmanyah Arabic, and the Tabler icons already in the kit.
- Stage pills, Review Code badges and Step Age dots must match the Submittals list, the Kanban and View workflow exactly.
- The ✍ marker is the same everywhere a signed action appears.
- Desktop first at 1440 px; phone at 390 px.

## Sample data
- Project "Riyadh Gate Tower – Phase 2" (code TWR, Riyadh). The companies are:
  - TMC Constructions (Contractor, code TMC, Electrical);
  - Design Consultants LLC (Consultant);
  - Al Waha PMC (Owner Representative).
- Submittal `TWR-TMC-EL-MAR-041` "Lighting Fixtures":
  - Trade Electrical Works (EL); Scopes: Lighting, Emergency lighting;
  - Location: Tower 1 / Floors 01–07;
  - Package "Common areas lighting";
  - manufacturer from the Approved Supplier List: "Zumtobel";
  - a table of 4 fixture types with quantities;
  - attachments: datasheets (PDF), test certificate, sample photo;
  - required link: the approved Method Statement `TWR-TMC-EL-MS-012`.
- **People:**
  - Hafiz Hamdan (Contractor Engineer)
  - Ali Sonour (Contractor PM)
  - Ahmed bin Said and Sara (Consultant Engineers, pool)
  - Mohammed Al Shamsi (Consultant Manager)
- **History:**
  1. Hafiz created it.
  2. Ali Returned it once ("Add emergency duration").
  3. Hafiz re-sent it.
  4. Ali Submitted it ✍ on 19/06/2025 16:19.
  5. Ahmed claimed it, recommended B, and sent it to the Manager.
  6. Mohammed issued **Code B** ✍ with 3 comments.
- Code C example: `TWR-TMC-EL-SAR-007 Rev 0` "Cable tray layout – Level 2", Code C, with Rev 1 in Draft.

Produce an interactive prototype:
- create a submittal and fill its sections;
- press each button and complete its pop-up;
- sign;
- switch the viewer between Contractor Engineer, Contractor PM, Consultant Engineer, Consultant Manager and Owner Representative to see the allowed buttons and the "With" grouping;
- open the closed B and C states;
- create a Revision;
- show the phone frame.
