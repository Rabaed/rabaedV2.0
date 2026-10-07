# Design request: Work Item page (RP-414)

Paste the shared brief from `design-requests-2026-10-07.md` first.

**What it is:** the page of one Work Item, here a Material Submittal (MAR). It is where people do most of their work: read the Form, fill their part, take the next Transition, see what happened. Today it is one long column; it needs a working layout. Start from `workflow-view.html` (header, main area, a side panel, a "View workflow" drawer).

**Who uses it:** Hafiz (raises and edits the Draft), Ali (reviews inside TMC and Submits), Ahmed and Mohammed (the Consultant: verify and issue the Review Code), Faisal (Owner Representative: reads, oversight).

## Content

- **Header:** back to the list; **Document Number** (left-to-right, "No number yet" for a Draft) and its Revision ("Rev 1"); the Stage pill; the Subject; Step Age dots; a **Watch / Watching** button (no watcher list or count anywhere).
- **Revision drop-down** next to the Document Number: the chain's Revisions the viewer may see (`TWR-MAR-01-0003`, `TWR-MAR-01-0003 Rev 1`), the open one marked. When the item ended with Code C, a card offers **Create Revision**; a Draft Revision shows "No number yet: Revision 1" and **Discard Revision**.
- **The Form**, in its Sections:
  - Material details: Manufacturer, Model, Specification section, Description.
  - Items: a table (Fixture type, Description, Quantity, Unit) with a total.
  - Documents: Datasheet (PDF), Test certificate, Sample photo, with the photo's time and place.
  - References: Related submittals, earlier items picked by Document Number or Subject.
  - Consultant verification: Sample checked, Matches specification, Verification note. While the item is with the Consultant, the Contractor sees this Section **empty and read-only, marked "Filled in by the Consultant"**.
  - Classification: Trade, Location, Scopes.
  - Edit mode: required fields, the "2 fields need your attention" summary, Save Draft and the "Saved" time.
- **Actions** (side panel on desktop): who holds it ("With": your own Step and "unclaimed" or the claimer's name; another Company by name only), **Claim / Release to pool**, and the Transition buttons for the viewer (Send for Review, Return, Submit, Approve · A, Revise & Resubmit · C…).
- **Action Form pop-up** of a Transition: Remarks (required with Code C), an optional **Internal Note** marked "Only your Company sees it", the confirm button named after the Transition.
- **Attachments** (Attach a Document, file chips) and **Links** (free Links, "Find an item to link", and **Linked from**: an item the viewer can't open shows only its Document Number and Subject).
- **History**, newest first, numbered as the viewer sees it. Your own Company's internal events are marked "Internal: only your Company sees this". Another Company's internal moves never appear, except the Code with its signer's name and the Remarks.
- **View workflow** drawer: the Steps as a simple diagram; another Company's internal Steps collapsed into one "Design Consultants LLC review" block.

## Frames to show

1. Hafiz, editing his Draft (no number yet), one required field missing.
2. Mohammed, with the item at Consultant review: claimed, verification being filled, the Revise & Resubmit · C pop-up open.
3. Hafiz, the same item after Code C: read-only, Code C and Remarks, Mohammed named as signer, Create Revision card.
4. Omar (TMC, covers Tower 2 only): a Link to a Tower 1 item shows only its number and Subject.
5. A phone frame (402) of frame 2, with the Transition buttons in a bar fixed at the bottom.

Desktop 1366 and 1920, tablet 820, phone 402; English and Arabic.
