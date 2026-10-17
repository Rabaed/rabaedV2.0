Design **Inspections (WIR)** for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support, Latin digits). Use the Rabaed Claude Design kit (app shell, page templates, tokens) already in the project. RP-118 (INSP-8), spec RP-649; the photo tool is RP-656.

## It is a web page, not an app
There is **no Rabaed mobile app**. On site, the Consultant Engineer opens the **same Rabaed web app in the phone's browser** (Chrome or Safari), and the page lays itself out for the small screen (ADR 0004: responsive web first). So:
- Design **responsive web pages**: the same screens at phone width (about 390 px) and at desktop width, not a separate app.
- Keep the normal Rabaed web header, condensed for the phone (project name, back, menu). No app-store install, no splash screen, no bottom tab bar of a native app, no offline sync.
- Everything works with a thumb: large touch targets, one column, actions within reach at the bottom of the screen.
- Pages save as you go ("Saved 10:42"). There is no offline mode: if the signal drops and a save fails, show it clearly on the item and offer "Retry".

## Photos: take or upload, then annotate
One **photo tool**, the same everywhere in Rabaed (inspection items, the WIR request, Snags, Site Reports, attachments). Design it once as a reusable component:
1. **Add a photo:** two buttons, **"Take photo"** (the browser opens the phone's camera) and **"Upload"** (the phone's gallery or files). On desktop, only "Upload" (and drag and drop).
2. **Thumbnails** under the field, with remove (×).
3. **Annotate:** tap a thumbnail to open it full screen, with simple markup tools: **arrow**, **circle / rectangle**, **freehand pen**, **text label**; a few colours (red by default); **undo**; **Save** and **Cancel**. Works in portrait, fingers only.
4. **The original is always kept.** Saving an annotation never changes the photo that was taken: the annotated copy is saved **beside** it. The thumbnail then shows the annotated copy with a small "annotated" mark, and opening it offers an **Annotated / Original** switch. The original is the evidence.

## Context
A **Work Inspection Request (WIR)** is how the Contractor asks the Consultant to inspect finished work at a Location and Trade before covering it up, e.g. "Inspect conduits before plastering, Tower 1 Floor 3".

The flow:
1. A **Contractor engineer** raises the WIR: what to inspect, where, which Trade, when the work will be ready, which **Checklist Template** applies, and which approved submittals the work relies on. The **Contractor PM** reviews it, then Returns it to the engineer or Submits it to the Consultant with a Cover Note. The Checklist Template can be changed until Submit, then it is locked.
2. The **Consultant Engineer** goes on site and fills the **checklist** on the phone: each check item is Pass / Fail / N/A, with comments and photos.
3. The Engineer sends it to the **Consultant Manager** with a **Recommended Result**.
4. The Manager gives the **Inspection Result**: **Passed**, **Passed with Comments**, or **Failed**. These are Inspection Results, not Review Codes: never show A/B/C/D on a WIR.
5. On a **Failed** WIR, the Contractor creates a **Revision** for re-inspection (`WIR-007 Rev 1`).
6. When the Manager issues the Result (any of the three), each failed check item still ticked **"Raise a Snag"** becomes a **Snag** in the Snag List, raised by the Consultant and assigned to the Contractor that raised the WIR.

**Visibility rule (critical):** the Engineer's answers, comments and photos stay with the Consultant until the Engineer sends the WIR to the Manager; the Contractor (and the Owner) read the checklist only after the Result. The Engineer's Recommended Result and Internal Note are internal to the Consultant: the Contractor never sees them, only the Manager's Result and the shared reply. Another Contractor never sees the WIR, its Snags or its Comments. An annotated photo is seen by exactly the same people as its original. Counts count only items the viewer may see.

**Age:** up to 4 dots for weeks at the current step. **"Requested for" is a plain date and time: never "due", "late", "overdue", deadlines or SLAs.**

## What to design

### 1. WIR request (desktop and phone)
- Description, Trade, Location (Zone → Building → Floor), **Requested for** (date and time).
- **Checklist Template** picker, filtered by the chosen Trade, with a preview of its items.
- **Approved submittals**: pick from the submittals the raiser can see that closed at Code A or B only, shown with their Code badge. Optional, unless the Project makes it required.
- Attachments and photos, with the photo tool.

### 2. Consultant Engineer on site (phone browser first)
- One card per check item: the item text, a large **Pass / Fail / N/A** segmented control, a comment, and photos with the photo tool. On a Fail, comment and photo show "(required)" when the template asks for them.
- On a failed item, a **"Raise a Snag"** tick, **on by default**; the Engineer can untick it (e.g. a minor failure fixed on the spot).
- The WIR's linked approved submittals, by Document Number and Subject (an Engineer who can't open one still sees those two).
- A sticky summary at the bottom: **"18 Pass / 2 Fail / 1 N/A"**, and progress "21 of 24 answered".
- **Send to Manager** with a **Recommended Result** (Passed / Passed with Comments / Failed) and an optional Internal Note, both internal to the Consultant.

### 3. Consultant Manager (desktop or phone)
- The checklist read-only, photos included (with the Annotated / Original switch), and the Engineer's Recommended Result shown with an "internal" badge.
- The **Result** pop-ups, with the summary and a proposed Result pre-selected (**Failed** if any item failed, else **Passed**) that the Manager confirms or changes. Each pop-up lists the Snags that will be raised from the ticked failed items, whatever the Result:
  - **Passed**.
  - **Passed with Comments**: comment rows, each becoming a **Comment** in the Snag List, assigned to the Contractor.
  - **Failed**: the Contractor is then offered a Revision.
- **Return to Engineer** with a reason (the Engineer's answers since the WIR arrived are discarded).

### 4. After the Result
- The WIR page with its Result badge and the counts **"Snags: n open / m closed"** and **"Comments: n open / m closed"**, linking to the Snag List filtered to this WIR.
- A **Revision** (`WIR-007 Rev 1`) showing **"Snags from Rev 0: 3 closed / 1 open"** and a link to the earlier WIR. Open Snags never block its Result.
- A Snag raised from a WIR: its Subject is the check item's text, its description the Engineer's comment, the item's photos become its "before" photos (annotated copies with their originals), and a **Raised from** card shows the failed check item and its photo.

## Screens to produce
- **Photo tool:** the "Take photo / Upload" choice on a phone; the annotate screen with an arrow and a text label drawn on a photo; a thumbnail with the "annotated" mark; the Annotated / Original switch.
- **WIR request:** at desktop width and at phone width.
- **Engineer on site, phone browser:** an item answered Pass; an item answered Fail with comment, an annotated photo and the Snag tick; the sticky summary; Send to Manager; a failed save with "Retry".
- **Manager:** the three Result pop-ups and Return to Engineer.
- **After the Result:** the WIR page, and a Revision.
- Every screen in **English and Arabic (RTL)**. Document Numbers (`TWR-DCL-CV-WIR-007`) stay LTR inside Arabic text.
