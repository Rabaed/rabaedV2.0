Design **Inspections (WIR)** for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support, Latin digits). The inspection itself happens **on a phone on site**; the request and the review also work on desktop. Use the Rabaed Claude Design kit (app shell, page templates, tokens) already in the project. RP-118 (INSP-8), spec RP-649.

## Context
A **Work Inspection Request (WIR)** is how the Contractor asks the Consultant to inspect finished work at a Location and Trade before covering it up, e.g. "Inspect conduits before plastering, Tower 1 Floor 3".

The flow:
1. A **Contractor engineer** raises the WIR: what to inspect, where, which Trade, when the work will be ready, which **Checklist Template** applies, and which approved submittals the work relies on. The **Contractor PM** reviews it, Returns it to the engineer or Submits it to the Consultant with a Cover Note. The Checklist Template can be changed until Submit, then it is locked.
2. The **Consultant Engineer** goes on site and fills the **checklist** on a phone: each check item is Pass / Fail / N/A, with comments and photos.
3. The Engineer sends it to the **Consultant Manager** with a **Recommended Result**.
4. The Manager gives the **Inspection Result**: **Passed**, **Passed with Comments**, or **Failed**. (These are Inspection Results, not Review Codes; never show A/B/C/D on a WIR.)
5. On a **Failed** WIR the Contractor creates a **Revision** for re-inspection (`WIR-007 Rev 1`).
6. When the Manager issues the Result (any of the three), each failed check item still ticked **"Raise a Snag"** becomes a **Snag** in the Snag List, raised by the Consultant and assigned to the Contractor that raised the WIR.

**Visibility rule (critical):** the Engineer's answers, comments and photos stay with the Consultant until the Engineer sends the WIR to the Manager; the Contractor (and the Owner) read the checklist only after the Result. The Engineer's Recommended Result and Internal Note are internal to the Consultant: the Contractor never sees them, only the Manager's Result and the shared reply. Another Contractor never sees the WIR, its Snags or its Comments. Counts count only items the viewer may see.

**Age:** up to 4 dots for weeks at the current step. **"Requested for" is a plain date and time: never "due", "late", "overdue", deadlines or SLAs.**

## What to design

### 1. WIR request (desktop and phone)
- Description, Trade, Location (Zone → Building → Floor), **Requested for** (date and time).
- **Checklist Template** picker, filtered by the chosen Trade, with a preview of its items.
- **Approved submittals**: pick from the submittals the raiser can see that closed at Code A or B only, shown with their Code badge. Optional, unless the Project makes it required.
- Attachments and photos (camera on phone).

### 2. Consultant Engineer on site (phone first)
- One card per check item: the item text, a large **Pass / Fail / N/A** segmented control, comment, and photos (camera first). On a Fail, comment and photo show "(required)" when the template asks for them.
- On a failed item, a **"Raise a Snag"** tick, **on by default**; the Engineer can untick it (e.g. a minor failure fixed on the spot).
- The WIR's linked approved submittals, by Document Number and Subject (an Engineer who can't open one still sees those two).
- A sticky summary: **"18 Pass / 2 Fail / 1 N/A"**, and progress "21 of 24 answered".
- **Send to Manager** with a **Recommended Result** (Passed / Passed with Comments / Failed) and an optional Internal Note, both internal to the Consultant.
- Works one-handed; saved as it goes ("Saved 10:42"); a clear state when a save fails on weak signal (there is no offline capture).

### 3. Consultant Manager
- The checklist read-only, with the Engineer's Recommended Result shown (internal badge).
- The **Result** pop-ups, with the summary and a proposed Result pre-selected (**Failed** if any item failed, else **Passed**) that the Manager confirms or changes. Each pop-up lists the Snags that will be raised from the ticked failed items, whatever the Result:
  - **Passed**.
  - **Passed with Comments**: comment rows (each becomes a **Comment** in the Snag List, assigned to the Contractor).
  - **Failed**: the Contractor is then offered a Revision.
- **Return to Engineer** with a reason (the Engineer's answers since the WIR arrived are discarded).

### 4. After the Result
- The WIR page with its Result badge and the counts **"Snags: n open / m closed"** and **"Comments: n open / m closed"**, linking to the Snag List filtered to this WIR.
- A **Revision** (`WIR-007 Rev 1`) showing **"Snags from Rev 0: 3 closed / 1 open"** and a link to the earlier WIR. Open Snags never block its Result.
- A Snag raised from a WIR: Subject is the check item's text, description the Engineer's comment, the item's photos as "before" photos, and a **Raised from** card showing the failed check item and its photo.

## Screens to produce
- The WIR request on desktop and on a phone.
- The Engineer's checklist on a phone: an item answered Pass, an item answered Fail with comment, photo and the Snag tick, the summary bar, and Send to Manager.
- The Manager's three Result pop-ups and Return to Engineer.
- The WIR page after the Result, and a Revision.
- Every screen in **English and Arabic (RTL)**. Document Numbers (`TWR-DCL-CV-WIR-007`) stay LTR inside Arabic text.
