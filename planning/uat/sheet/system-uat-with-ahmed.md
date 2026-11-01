# Rabaed UAT test sheet: System UAT with Ahmed

Built 2026-11-01. 262 Test Cases. The UAT: https://rabaed-uat-web.vercel.app/en (English) and https://rabaed-uat-web.vercel.app/ar (Arabic).

## How to use this file

1. Open the UAT and sign in as the person each case names under **Sign in as** (see Who's who). The owner gives you each sign-in; this file holds no passwords. Use one private browser window per person, so each sees only their own Company's work.
2. Work section by section, case by case. Do the **Steps**, compare with the **Expected result**, and decide: `pass`, `fail`, `blocked` (could not test it) or `notrun`.
3. On `fail` or `blocked`, write what you saw in the comment, in English or Arabic, and keep a screenshot.
4. Skip the last section, the cases the UAT owner runs, unless the owner asks you to run them.
5. Hand back your results as **one JSON file** in the format at the end of this file. Open the HTML sheet, press **Load work (.json)**, then **Export to Excel**, and send the .xlsx to the owner. Or send the .json itself.
6. Demo data only: never type real names, phone numbers or documents.

If you are an AI helping the tester: keep the case keys (`RP-nnn`) exactly as written, use only the four status values, and never invent a result for a case the tester did not run. Leave it out, or use `notrun`.

## Who's who

Riyadh Gate Tower – Phase 2. Trades: Electrical (EL), Mechanical (ME), Civil (CV). Locations: Main Zone: Tower 1 (Floors 01–03), Tower 2 (Floor 01). Thick border = covers less than their Company. Civil (CV) is covered by no Company.

| Name | Sign-in email | Company | On the Project | Position | Covers | Used for |
|---|---|---|---|---|---|---|
| Saeed Al Qahtani | `saeed.alqahtani@tmc.demo.rabaed.test` | TMC Constructions | Contractor and Project Admin | Authorized Person | Company profile | Company Profile (logo, Stamp), Members, invitations, Project Settings |
| Hafiz Hamdan | `hafiz.hamdan@tmc.demo.rabaed.test` | TMC Constructions | Contractor, Electrical, everywhere | Engineer | EL · all towers | Raises Drafts and sends them for review; Snags; the phone cases |
| Ali Sonour | `ali.sonour@tmc.demo.rabaed.test` | TMC Constructions | Contractor, Electrical, everywhere | Project Manager | EL · all towers | Reviews Hafiz's Drafts and Submits to the Consultant; Packages; the List and Dashboard |
| Omar Al Harbi | `omar.alharbi@tmc.demo.rabaed.test` | TMC Constructions | Contractor, Electrical, Tower 2 only | Engineer | EL · Tower 2 only | Visibility narrowed to one Location: sees Tower 2 only |
| Yousef Karim | `yousef.karim@betabuild.demo.rabaed.test` | Beta Build | Contractor, Electrical, everywhere | Engineer | EL · all towers | A second Contractor on the same Project: must never see TMC's work |
| Nasser Al Dosari | `nasser.aldosari@betabuild.demo.rabaed.test` | Beta Build | Beta Build's own Project, Jeddah Corniche Villas | Authorized Person | Beta Build, own Project, not here | Not on Riyadh Gate Tower: must get the not-found page there |
| Ahmed bin Said | `ahmed.binsaid@designconsultants.demo.rabaed.test` | Design Consultants LLC | Consultant, Electrical and Mechanical | Engineer | EL, ME · all towers | Reviews submittals for the Consultant (a demo person, not you) |
| Sara | `sara@designconsultants.demo.rabaed.test` | Design Consultants LLC | Consultant, Mechanical only | Engineer | ME only · all towers | A Consultant engineer narrowed to one Trade: sees Mechanical items only, never the Electrical ones (RP-1207) |
| Mohammed Al Shamsi | `mohammed.alshamsi@designconsultants.demo.rabaed.test` | Design Consultants LLC | Consultant, Electrical and Mechanical | Manager | EL, ME · all towers | Gives the Review Code (A, B, C, D) and signs the Documental Record |
| Layla Mansour | `layla.mansour@designconsultants.demo.rabaed.test` | Design Consultants LLC | Consultant | Authorized Person | Company profile | Design Consultants' Company Profile and Members |
| Faisal Al Otaibi | `faisal.alotaibi@alwaha.demo.rabaed.test` | Al Waha PMC | Owner Representative, Electrical, everywhere | Engineer (uses Arabic) | EL · all towers | The Arabic cases |
| Noura Al Harbi | `noura.alharbi@alwaha.demo.rabaed.test` | Al Waha PMC | Owner Representative | Project Manager (uses Arabic) | EL · all towers | Holds the Owner's review; Arabic cases |
| Hind Al Mutairi | `hind.almutairi@alwaha.demo.rabaed.test` | Al Waha PMC | Owner Representative | Authorized Person | Company profile | Al Waha's Company Profile and Members |
| Rabaed Engineer | `engineer@rabaed.demo.rabaed.test` | Rabaed | Rabaed Admin | Rabaed Engineer | Rabaed Admin, UAT owner only | Rabaed Admin cases (ADM): the UAT owner runs these |

## 1. Submittals (28 cases)

### SUB-01 A new MAR is saved as a Draft

- **Key:** `RP-685` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > Riyadh Gate Tower - Phase 2 > Submittals > New Submittal > Material Approval Request.
  2. Subject "UAT SUB-01 Lighting Fixtures", Trade Electrical Works, Location Tower 1 Floor 02, Manufacturer Philips, Approved supplier Najd Electrical Supplies, Description empty.
  3. Save Draft.
- **Expected result:** The Draft is listed in the Drafts Stage with "No number yet" and no Step Age dots. It is Hafiz's to edit. What other Companies see: VIS-01.

### SUB-02 Send for Review is refused while the Form is incomplete

- **Key:** `RP-688` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the Draft from SUB-01.
  2. Send for Review with Description and Datasheet (PDF) empty.
- **Expected result:** Refused: the Form lists what is missing ("2 fields need your attention: Description, Datasheet (PDF)") and marks each field. Nothing moves; the item stays a Draft with no number.

### SUB-03 The MAR Form takes Items, totals and Documents

- **Key:** `RP-691` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Fill Description, Model "CoreLine Panel", Specification section "26 51 00".
  2. Under Items, Add row twice: "Recessed panel" 200 Pieces and "Surface panel" 40 Pieces.
  3. Save and close, then open the Draft again from the list.
  4. Add a PDF under Datasheet (PDF) and a JPEG with EXIF under Sample photo.
- **Expected result:** The total reads 240. Save and close returns to the Submittals list. The Datasheet and Sample photo can be added once the Draft is saved; the photo shows the time and place from its EXIF. The Attachments and Links System Fields sit below the Form.

### SUB-04 Send for Review numbers the item and Ali holds it at once

- **Key:** `RP-694` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer); Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz: Send for Review on the complete Draft.
  2. Ali: open it from the bell.
- **Expected result:** The item gets the next Document Number in its sequence (for example TWR-MAR-01-0004), shown left to right. Ali is TMC's only PM, so it is his at once: "With Ali Sonour - TMC Constructions", no Pick up button. Ali's bell shows "Step reached" within seconds. Nothing outside TMC.

### SUB-05 A Return stays in Internal Review

- **Key:** `RP-697` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM); Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali: Return with the reason "Add emergency duration".
  2. Hafiz opens the item.
- **Expected result:** The item stays in the Internal Review Stage, now at the Contractor Engineer Step, keeps its Document Number and goes back to Hafiz ("With Hafiz Hamdan - TMC Constructions"); it is never a Draft again. The reason is in TMC's history marked internal. Step Age counts from the Return.

### SUB-06 Documents change until the Submit

- **Key:** `RP-700` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer); Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz: remove the Datasheet and add a corrected PDF.
  2. Send for Review again.
  3. Ali opens the item and its Documents.
- **Expected result:** Hafiz can swap Documents while the item is in TMC. Ali sees the corrected PDF. Documents freeze at the Submit, not before.

### SUB-07 Submit with a Cover Note and an Internal Note

- **Key:** `RP-704` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM); Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali: Submit; Cover Note "Panels for Level 2, as drawing E-201"; Internal Note "Quantities checked against the BOQ"; confirm.
  2. Ahmed opens the item.
- **Expected result:** Stage is Pending Approval. TMC sees "With Design Consultants LLC", never a Consultant's name. Ahmed's history shows the Submit with the Cover Note by "TMC Constructions" (no person); the Internal Note is not there. The Submission Date is set.

### SUB-08 Pick up and Return to pool in the Consultant pool

- **Key:** `RP-707` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ahmed, Sara (DCL engineers); Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ahmed and Sara open the Submitted MAR.
  2. Ahmed: Pick up.
  3. Sara refreshes Need My Action and her bell.
  4. Ahmed: Return to pool, then Pick up again.
- **Expected result:** Both Engineers see "not picked up yet: ..." with both names; Mohammed is not in this pool and reads it read-only. After Pick up the item leaves Sara's Need My Action and her unread "Step reached" is withdrawn; Return to pool is offered because the pool has two Members and does not bring the notification back.

### SUB-09 The Consultant reads the Form and cannot edit it

- **Key:** `RP-709` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After Pick up, read every Form section, open the Datasheet PDF and the Sample photo.
  2. Try to change an answer.
- **Expected result:** Every answer, the Items table and the total are shown read-only; Documents are frozen; the photo shows time and place. No edit control is offered (the Form is the raiser's).

### SUB-10 Send to Manager needs the verification

- **Key:** `RP-712` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer); Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ahmed: Send to Manager with the verification empty.
  2. Answer Sample checked Yes, Matches specification No; leave the Verification note empty.
  3. Write the note, set Recommended Code C and an Internal Note.
  4. Confirm.
- **Expected result:** Steps 1 and 2 are refused: the Verification note becomes required when Matches specification is No. After step 4 the item sits with Mohammed, the only Consultant Manager, at once. Ahmed's answers, Recommended Code and Internal Note are in DCL's history only, marked internal.

### SUB-11 Code A closes the item with the final verification

- **Key:** `RP-716` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the item; Approve A.
  2. Check the Final verification pop-up is filled from Ahmed's reply; Remarks left empty.
  3. Confirm.
- **Expected result:** Remarks are optional with Code A. The item closes Approved, Code A, and accepts no more moves. Download PDF appears (SIG-02).

### SUB-12 Code B turns each comment into a Comment

- **Key:** `RP-718` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager); Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On a new Submitted MAR, Mohammed: Approve with Comments B with three comment rows and Remarks.
  2. Ali opens the MAR and the Snag List.
- **Expected result:** The MAR closes at Code B. Three Comment items are in the Snag List, raised by Design Consultants and Open with TMC. The MAR page reads "Comments: 3 open / 0 closed". Remarks are required with B.

### SUB-13 Code C needs Remarks and Return to Engineer works

- **Key:** `RP-720` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager); Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ahmed sends a MAR to Mohammed with Matches specification No.
  2. Mohammed: Return to Engineer, reason "Check the photometric report".
  3. Ahmed sends it again unchanged.
  4. Mohammed: Revise and Resubmit C with Remarks empty, then with Remarks.
- **Expected result:** Return to Engineer gives it back to Ahmed. Code C is refused until Remarks are written, then closes at C with its Remarks and final verification. TMC is offered Create Revision (SUB-15).

### SUB-14 Code D offers a replacement, not a Revision

- **Key:** `RP-723` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager); Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed: Reject D with Remarks.
  2. Hafiz opens the closed MAR and chooses Create replacement.
- **Expected result:** The item closes at D. Hafiz is offered Create replacement (no Revision). The replacement is a new Draft with the same Subject, a Replaces Link to the rejected MAR, and gets a new Document Number with no Rev suffix at its first send.

### SUB-15 Create a Revision of a Code C item

- **Key:** `RP-727` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer); Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the MAR you took to Code C in SUB-13 (the seeded Cable tray risers item already has an open Rev 1, so it offers no new Revision) and Create Revision.
  2. The Draft reads Revision 1, No number yet; change the Model, Save and close.
  3. Open the Revision drop-down.
  4. Send for Review and have Ali Submit it.
- **Expected result:** The Draft starts with TMC's answers and the copied Datasheet. The drop-down lists the original and Revision 1 (no number yet); after the Submit it lists the number and the number Rev 1, each whole and left to right. Choosing the original shows its own answers, Code C, Remarks and history. A Revision uses no counter.

### SUB-16 Delete discards a Draft only

- **Key:** `RP-730` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On a Draft that never left Draft, row menu > Delete, confirm.
  2. On a numbered item look at its row menu.
- **Expected result:** The confirm says nobody will see the Draft again, Hafiz included, and no number is lost; it leaves the list. A numbered item has no Delete (an issued item is never deleted).

### SUB-17 Duplicate copies only TMC's own work

- **Key:** `RP-732` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On a closed MAR that Mohammed answered, row menu > Duplicate.
  2. Open the new Draft.
- **Expected result:** A new Draft with the Subject, TMC's own answers and the Documents and photos TMC uploaded, as new files. None of Design Consultants' verification, Remarks or notes. "Duplicated from" shows the original's number to TMC only.

### SUB-18 Download gives the item as it last arrived

- **Key:** `RP-735` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM); Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On a Submitted MAR choose Download from the row menu as Ali, then as Mohammed.
  2. Try Download on a Draft.
- **Expected result:** Both get the same content: shared answers, shared moves by Company only, no Step, no person, no Internal Note. A Draft offers Download of its Working Copy.

### SUB-19 Related submittals and free Links open the other item

- **Key:** `RP-737` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open "Emergency lighting control panel - Tower 2".
  2. Links: open TWR-MAR-01-0001 from Related submittals and from the free Link.
  3. On TWR-MAR-01-0001 scroll to Linked from.
- **Expected result:** Each Link shows the Document Number (left to right) and Subject and opens the item; a Submitted item cannot be changed. Linked from on the exit signs lists the control panel. Linking notifies nobody.

### SUB-20 A SAR closed at Code A adds the supplier to the list

- **Key:** `RP-739` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz; Ali; Ahmed; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Raise a Supplier Approval Request "UAT SUB-20 Delta Cables" (Electrical), send, Submit.
  2. Ahmed picks up and sends to Manager; Mohammed: Approve A.
  3. Project Settings > Approved Supplier List.
- **Expected result:** The SAR runs 2 to 2 and closes. "UAT SUB-20 Delta Cables" is listed for Electrical, approved. A second SAR for the same name in other letter case adds no second entry. A MAR now offers it under Approved supplier.

### SUB-21 A DAR ends with the Owner's review

- **Key:** `RP-741` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz; Ali; Mohammed; Noura (Al Waha PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Raise a Document Approval Request "UAT SUB-21 Cable schedule", send, Ali Submits.
  2. Mohammed recommends Code A to the Owner.
  3. Noura opens it and chooses Confirm.
- **Expected result:** Mohammed's Recommendation goes to Noura, who holds the Owner's review; Confirm issues Code A and closes the item. TMC sees it "With Owner review" until then (VIS-27).

### SUB-22 Watch and Unwatch

- **Key:** `RP-743` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open a Submitted MAR; note Watching (raiser and Submitter watch from the start).
  2. Unwatch, then Watch again.
- **Expected result:** The button flips between Watch and Watching. Nobody sees who else watches an item or how many.

### SUB-23 List: search, filters, Need My Action, sort and columns

- **Key:** `RP-746` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Submittals List: search by Document Number, Subject, Type, Trade, Location.
  2. Filter panel: pick several values for Type, Stage, With, Step Age, Submission Date.
  3. Toggle Need My Action.
  4. Sort by a column; Columns > move one > Save as my default; reload.
  5. Group by Stage.
- **Expected result:** Results match the filters; Stage counts match the rows; Need My Action keeps only items waiting on Ali (his own Drafts stay in view, uncounted); the saved columns come back after reload; the column header for the holder reads With.

### SUB-24 List export holds what the viewer sees

- **Key:** `RP-748` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Export > what you see > CSV, then Excel.
  2. Export the whole table.
  3. Search first, then export.
  4. Put =1+1 in the Subject of a Draft and export.
- **Expected result:** Rows and columns equal the screen; the whole table adds every List field; under a search only the rows read so far; a cell that looks like a formula is written as text.

### SUB-25 Kanban: columns, counts and moving a card

- **Key:** `RP-753` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Kanban: columns are the Stages with counts.
  2. Drag a card, or use Move to, to a Stage Ali's Step allows.
  3. Open the filter panel (Owner, Role, Created date).
- **Expected result:** Dropping or choosing a move opens the same Action Form as the item page; the card moves after confirm; a move that is not allowed is not offered. Internal Review shows TMC's own Steps with counts (Engineer, PM). The other Company is one lane by its name.

### SUB-26 Project Dashboard: Type cards and Activity Feed

- **Key:** `RP-755` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the Project (Dashboard).
  2. Click a number on a Type card.
- **Expected result:** Type cards show counts over what Ali sees; each number opens the List with the same filter and the same count. The Activity Feed sits beside them; it lists Company names for other Companies and no person of theirs.

### SUB-27 Home: counts, Need My Action list, Recent activity

- **Key:** `RP-757` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Home.
  2. Compare Active Projects, Need My Action, My Company 4+ weeks at step, My Company waiting with others and each Project card's submittal count with the Project's List.
- **Expected result:** Every number equals the sum of the Project reads and opens the matching list; Drafts are never counted as Need My Action; Recent activity shows at most four entries.

### SUB-28 Activity Feed page

- **Key:** `RP-759` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Project > Activity Feed after some Submits and Codes.
- **Expected result:** Entries read as events (submitted, returned, approved) with the Project; TMC appears by Company name only; no answers_changed or Document upload entries.

## 2. Workflows (16 cases)

### WF-01 Every Member reads the Project Workflows

- **Key:** `RP-763` · **Part:** WF · **Round:** 0
- **Sign in as:** Ali (TMC PM); Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Project > Settings > Workflows.
  2. Open the MAR Workflow and a published Version.
- **Expected result:** The page lists which Workflow each Work Item Type runs, its Version and every published Version whole, with every Company's Steps and Returns. Neither can open the builder or see a draft.

### WF-02 View workflow on an item pins its Version

- **Key:** `RP-767` · **Part:** WF · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open a Submitted MAR; click Workflow: name, Version n.
  2. Switch map and list.
  3. Open the same item as Ahmed and move it between DCL Steps.
- **Expected result:** The drawer shows the Version the item is pinned to. Ali's own Steps are shown one by one; Design Consultants is one part marked With Design Consultants LLC. Ahmed sending to Mohammed changes nothing Ali reads.

### WF-03 Duplicate a Rabaed Default into the Project

- **Key:** `RP-770` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (TMC Authorized Person, Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Workflows > duplicate the MAR Workflow as "UAT MAR copy".
  2. Open it.
- **Expected result:** A draft Version 1 of a new Project Workflow with no link to the original. Only Project Admins see it.

### WF-04 Builder: add a Step, connect, undo, auto-layout

- **Key:** `RP-773` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the copy in the builder.
  2. Drag a Step from the palette into a Stage band; connect two Steps by dragging from a dot.
  3. Undo and redo (Ctrl+Z, Ctrl+Shift+Z).
  4. Auto-layout; switch Curved and Orthogonal arrows.
  5. Select a Transition: edit labels (EN and AR), kind, Screen.
- **Expected result:** Edits autosave a moment later. The kind follows the publish checks (Submit across Participants, Return back within one). A connection onto empty canvas adds a New step. Auto-layout arranges Steps by route inside each Stage band; the arrow style is kept per viewer.

### WF-05 Validate reports problems and Publish needs a Change Note

- **Key:** `RP-777` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In the copy, leave a Step with no way forward.
  2. Validate.
  3. Fix it, Publish with no Change Note, then with one.
- **Expected result:** Validate counts the errors and selects the first; Publish lists what changed, the count of items that keep their Version and requires the Change Note. After publishing the builder stays open.

### WF-06 A new Version applies to new items only

- **Key:** `RP-779` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed; Hafiz; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Bind the published copy to MAR (Settings > Workflows > Use for MAR).
  2. Hafiz raises a new MAR.
  3. Open an older MAR.
- **Expected result:** The new MAR runs the new Version; the older item keeps its Version and shows a notice that a later Version exists. Binding another Workflow reaches only items created afterwards.

### WF-07 Versions history shows Change Notes and running counts

- **Key:** `RP-781` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the Workflow's Versions page.
  2. Compare two Versions.
- **Expected result:** Newest first with date and Change Note; the N running figure counts only items the reader sees; Compare marks added, removed and changed. Hafiz sees Versions but no Change Note.

### WF-08 Exception for one Participant must not name it

- **Key:** `RP-783` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Copy MAR as "Beta Build MARs" and try to bind it as an exception for Beta Build.
  2. Rename it "MARs, short route" and bind it for Beta Build.
- **Expected result:** The first is refused because the name holds a Participant's name. The second binds; Yousef's new MARs run it, TMC's do not. Others learn of no Participant.

### WF-09 Build a Workflow with a Send Back (fixture FX-SB)

- **Key:** `RP-786` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Copy the MAR Workflow.
  2. Add a Send Back from Consultant Engineer to the Contractor Draft Step; on the Draft Step set After a Send Back to Comment only (and a second copy to Edit the Form).
  3. Validate, Publish, bind.
- **Expected result:** It validates and publishes. If publish refuses the Send Back, record a Bug: VIS-15 and VIS-16 need this Workflow.

### WF-10 Drafts visible to: the author only

- **Key:** `RP-790` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Hafiz; Omar; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In a copy, set the Draft Step to Drafts visible to the author only; publish and bind.
  2. Hafiz saves a Draft.
  3. Omar and Ali open the List and the item URL.
- **Expected result:** Omar and Ali see no Draft, no count, and the 404 page; Hafiz sees and edits it. After Send for Review TMC reads it as before.

### WF-11 Transition rules: Restrict, Validate and Effects

- **Key:** `RP-793` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In a copy open a Transition > Add rule.
  2. Add Restrict by Position, a Validate with a message in EN and AR, an Effect Offer Assign to.
  3. Test run the Workflow.
- **Expected result:** Rules show under Condition with AND between Restrict rules; Test run opens each pop-up in test mode and saves nothing; a Transition whose Restrict fails is not offered.

### WF-12 Return goes to the author, not the other engineer

- **Key:** `RP-794` · **Part:** WF · **Round:** 0
- **Sign in as:** Hafiz; Omar; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Omar (Tower 2 only) and Hafiz both cover a Tower 2 item.
  2. Hafiz sends a Tower 2 Draft for review.
  3. Ali Returns it.
- **Expected result:** It goes back to Hafiz, who sent it, not to Omar.

### WF-13 Stages and Outcomes pages

- **Key:** `RP-796` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Stages: rename a Stage, add one.
  2. Settings > Outcomes.
  3. As Ali open the same pages.
- **Expected result:** Project Admin changes show in the Stage set, List and Kanban columns; Ali reads them and cannot change them. Another Project is unchanged.

### WF-14 Library: save, mark default, new Project copies it

- **Key:** `RP-805` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Library > Workflows: Save a Project Workflow to the Library.
  2. Mark it default for MAR.
  3. Create a new Project.
- **Expected result:** The Library copy has no link to the original; the new Project starts with a copy as its MAR Workflow, bound. A plain Member sees the Library read-only.

### WF-16 Cancel from the raiser's Steps, only until the first Submit

- **Key:** `RP-810` · **Part:** WF · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer); Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz: new MAR "UAT Cancel", Save Draft, Cancel; confirm.
  2. Make a second MAR, Send for Review; Ali opens it and Cancels.
  3. Make a third, Submit it to DCL; look for Cancel as Ali and Hafiz.
- **Expected result:** Cancel is offered at the Draft, the Contractor Engineer and the Internal Review Steps and asks for confirmation; the item goes to the Cancelled Stage with no outcome. Once Submitted, Cancel is no longer offered. A Revision never offers Cancel. Carried over from RP-463 B-09 (RP-490).

### WF-17 Assign to offers only your own Company's Members

- **Key:** `RP-812` · **Part:** WF · **Round:** 0 · **Needs:** setup
- **Sign in as:** Saeed (Project Admin); Hafiz; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Saeed: in the Project's MAR Workflow (fixture FX-SB copy) add Assign to on Send for Review and on Submit; publish.
  2. Hafiz: new MAR, Send for Review, open Assign to.
  3. Ali: Submit, open Assign to.
- **Expected result:** Hafiz is offered only TMC Members who may hold the Contractor PM Step; Ali only TMC Members (never a DCL engineer by name; the Consultant is one Participant). A pick it could not have offered is refused like a made-up one. Carried over from RP-463 B-06 (RP-487).

## 3. Forms and Screens (11 cases)

### FRM-01 The three submittal Forms carry the documented fields

- **Key:** `RP-814` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. New Submittal > MAR, then SAR, then DAR.
  2. Read each Form top to bottom in EN.
- **Expected result:** MAR: Manufacturer, Approved supplier (required), Model, Specification section, Description, Items table with total, Datasheet (PDF), Test certificate, Sample photo, Related submittals, Trade, Location, Scopes. SAR and DAR have Forms of their own. Subject and Document Number sit above, Attachments and Links below.

### FRM-02 Required fields to leave Draft

- **Key:** `RP-817` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Save a MAR Draft with each of Manufacturer, Description, Datasheet, Trade, Location empty in turn.
  2. Send for Review.
- **Expected result:** Manufacturer, Description, the Datasheet, Trade and Location are required to leave Draft; a Draft saves with any missing. Each missing field is named and marked.

### FRM-03 Approved supplier offers the Trade's list only

- **Key:** `RP-820` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In a MAR choose Trade Civil Works: open Approved supplier.
  2. Change Trade to Electrical Works.
- **Expected result:** Civil offers Al-Rimal Building Materials; Electrical offers Najd Electrical Supplies and Tabuk Cable Industries (and any supplier added since by a SAR or the Project Admin). Changing Trade clears the supplier.

### FRM-04 Trade, Location and Scopes are Built-in Fields

- **Key:** `RP-823` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Pick Location Tower 1, then Floor.
  2. Pick Scopes Lighting and Emergency lighting.
  3. Try to remove Trade from the Form view.
- **Expected result:** Locations nest Zone > Tower > Floor; Scopes belong to the Trade. Trade, Location and Scopes cannot be removed or made optional.

### FRM-05 Related submittals offers only Submitted items Hafiz sees

- **Key:** `RP-826` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In a Draft MAR type "control panel" under Related submittals.
  2. Also search for a Draft of Hafiz's own and for Beta Build's item.
- **Expected result:** Only Submitted items Hafiz sees in this Project appear; no Drafts, nothing in internal review, nothing of Beta Build. A saved id that could not be offered is refused like a made-up one.

### FRM-06 Photos keep time and place; Take a photo on a phone

- **Key:** `RP-829` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 px open a Draft MAR; under Sample photo choose Take a photo (or Upload a JPEG with EXIF).
  2. Save.
  3. Open the photo.
- **Expected result:** On a phone Take a photo is offered beside Upload. The thumbnail shows, and opening the photo shows the time and place from its EXIF.

### FRM-07 Documents freeze at the first Submit

- **Key:** `RP-831` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz; Ali; Ahmed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz adds and removes a Document in a Draft.
  2. After Ali Submits, Hafiz opens the item.
  3. Ahmed opens the Documents.
- **Expected result:** Before the Submit Documents can change; after it they are frozen for everyone and cannot be removed. Ahmed opens them with a short-lived link.

### FRM-08 The Form belongs to the raiser; replies are Screens

- **Key:** `RP-833` · **Part:** FRM · **Round:** 0
- **Sign in as:** Ahmed; Mohammed; Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ahmed Send to Manager: read the pop-up fields.
  2. Mohammed Approve: read the Code pop-up.
  3. Open the Form as Mohammed.
- **Expected result:** Replies are pop-up Screens (verification, Recommended Code, final verification, Remarks); no Form field is editable by the Consultant. Fields a Screen marks internal never reach TMC.

### FRM-09 Screens: read, edit and publish in Project Settings

- **Key:** `RP-836` · **Part:** FRM · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Screens: open Code reply.
  2. Edit a copy, publish a new Version.
  3. Start a MAR and take it to the Code; compare the pop-up.
- **Expected result:** Every Member reads Screens; only Project Admins change them. An item already running keeps the Screen Version its Workflow Version pinned; new Workflow Versions pick the new one.

### FRM-10 Draft autosave shows Saved and survives a failed save

- **Key:** `RP-839` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Edit a Draft; watch the Saved time.
  2. Go offline in the browser, edit, go online.
- **Expected result:** The Saved time moves with each save. A failed save is shown clearly with a retry; no edit is lost.

### FRM-11 Member and Participant fields offer only what the filler may see

- **Key:** `RP-842` · **Part:** FRM
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On an item with a member or participant field (if the Form offers one) open the choices.
- **Expected result:** Only TMC's own Project Members and TMC and the Host Company are offered; other Companies' people never. After the Submit another Company reads the answer as TMC's name, no person.

## 4. Participants and Visibility setup (14 cases)

### PAR-03 An email that belongs to another Company is refused without naming it

- **Key:** `RP-851` · **Part:** PAR · **Round:** 0
- **Sign in as:** Hind (Al Waha Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Members > Invite hafiz.hamdan@tmc.demo.rabaed.test.
- **Expected result:** Refused: the person is already registered on Rabaed with another Company. TMC is never named and nothing else about Hafiz shows. An email of Hind's own Company gives the ordinary already-a-Member answer.

### PAR-04 Create a Project

- **Key:** `RP-853` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Creator)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > New Project: name EN and AR, code UATP, role Contractor.
  2. Open it.
- **Expected result:** The Project appears with Project Number in TMC's own series; Saeed is its first Project Admin; Host Company is TMC.

### PAR-05 Trades, Locations and Scopes

- **Key:** `RP-856` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Trades and Locations: add a Trade, a Zone, a Building, a Floor, a Scope and Sub-scope.
  2. Ali opens the same page.
- **Expected result:** Saeed adds; Ali reads Trades, Scopes and Locations and cannot add. Names show in EN and AR.

### PAR-06 Invite a Company by CR number and accept

- **Key:** `RP-859` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On a UAT Project invite CR 9999000003 as Consultant.
  2. Layla: Company Projects shows the invitation (name, Host Company, offered role).
  3. Accept.
- **Expected result:** Until accepted, only Layla and the Project Admin see it; TMC's other Members do not. After accepting, DCL is a Participant in the role Consultant.

### PAR-07 Grant Participant Visibility and read the Visibility Gap warning

- **Key:** `RP-862` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Visibility: give the new Consultant Electrical only.
  2. Remove all coverage of Mechanical from every Participant.
- **Expected result:** The grant saves. A Visibility Gap warning names the value no active Participant covers. It is worked out from Participant grants alone.

### PAR-08 The Authorized Person adds a Member to the Project with a Position and Visibility

- **Key:** `RP-864` · **Part:** PAR · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Participants > the Project > add a Member with Position Engineer.
  2. Open the Member's Visibility and narrow to Mechanical only.
  3. Try to give a Trade the Participant lacks.
- **Expected result:** The Member joins the Project. Narrowing saves. A Trade DCL does not cover is rejected (a Member never covers more than their Company).

### PAR-09 Deactivate a Member: Handover first

- **Key:** `RP-867` · **Part:** PAR · **Round:** 0 · **Needs:** setup
- **Sign in as:** Saeed (Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz holds two Tower 2 MARs at Contractor Engineer (Omar covers Tower 2 as well) and one Tower 1 MAR (Omar does not cover it).
  2. Saeed: Members > Deactivate Hafiz.
- **Expected result:** The Handover dialog lists his open Steps and Drafts (Project, Document Number or No number yet, Subject, Step). The Tower 2 Steps pre-fill Omar as the single candidate. The Tower 1 Step has nobody else who can take it, so the change is refused with Nobody else can take <Step> on <Project>. Give someone the Position or Visibility first, naming only TMC's own Step and the Project; nothing saves until every Step has a new holder.

### PAR-10 Participant Codes and Numbering settings

- **Key:** `RP-870` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Numbering: read the pattern and examples.
  2. Set a Participant Code (2 to 6 letters or digits).
  3. Save a pattern that leaves out the Participant Code.
- **Expected result:** Examples use the Admin's real next numbers. A code in use cannot change. Leaving out the Participant Code is refused until the shared-counter warning is accepted.

### PAR-11 Show Inspections inside the Submittals tab

- **Key:** `RP-874` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Modules: choose Inside the Submittals tab.
  2. Open Submittals and the Project tabs.
- **Expected result:** The Inspections tab is hidden; WIRs show in the Submittals List and Kanban with WIR as one more Type. Switching back restores the tab. Only a Project Admin changes it.

### PAR-12 Approved Supplier List: add and withdraw by hand

- **Key:** `RP-877` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Approved Supplier List: add a supplier for Mechanical; withdraw one.
  2. Hafiz opens the list.
- **Expected result:** Entries show name, Trade, Scope and status; a withdrawn one stays listed as withdrawn. Hafiz cannot add or withdraw. No source, person or time shows.

### PAR-13 Company Projects page

- **Key:** `RP-880` · **Part:** PAR · **Round:** 0
- **Sign in as:** Layla; Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Company Projects (sidebar).
- **Expected result:** Each Project the Company takes part in shows name, code, number, Host Company, the Company's own Project Role and own Project Members, and pending invitations. Never another Participant.

### PAR-14 Fixture FX-C2: narrow Beta Build to Tower 2

- **Key:** `RP-883` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Yousef
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Visibility: set Beta Build Location to Tower 2 only.
  2. Yousef signs in.
- **Expected result:** The change saves (Yousef holds nothing, so no Handover). Yousef sees only Tower 2 items from then on, and TMC is the only Contractor covering Tower 1, which the Snag scenarios need.

### PAR-15 Fixture FX-K1M: Sara covers Mechanical only

- **Key:** `RP-885` · **Part:** PAR · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person); Sara
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Sara's Visibility (Participants > Members).
  2. Set Trade to Mechanical only.
- **Expected result:** Sara no longer sees Electrical items and leaves their pools (Handover first if she holds one). Ahmed still covers both. Later scenarios use Sara as the K1 Mechanical-only engineer.

### PAR-16 Fixture FX-OW: invite UAT Owner Co as Owner

- **Key:** `RP-889` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Reem UAT (Owner Co Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After ADM-02 onboards UAT Owner Co (CR 9999000005), Saeed invites that CR as Owner on Riyadh Gate Tower.
  2. Reem accepts, grants Electrical and Mechanical, all Locations, and adds a PM Member (Sami UAT) with Position Project Manager.
- **Expected result:** UAT Owner Co is a Participant with oversight over Submitted items it covers. Later Owner scenarios use it.

## 5. Packages (11 cases)

### PKG-01 Packages is a third view beside List and Kanban

- **Key:** `RP-892` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Submittals > the view toggle.
  2. Choose Packages.
- **Expected result:** A Packages Kanban with three columns Open, In Progress and Done, each with a count; a New Package button for a Company that can build one; search and filters (Trade, owning Company). Matches packages.html except where spec RP-616 differs.

### PKG-02 Open a Package and number it

- **Key:** `RP-895` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. New Package: name EN and AR.
  2. Open it.
- **Expected result:** The Package is numbered PKG-001 (left to right, also in Arabic) beside TMC's name, Open, with no submittals. A second Package is PKG-002. Beta Build's first Package is also PKG-001.

### PKG-03 Add submittals from Drafts and review

- **Key:** `RP-897` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open an Open Package > Add items.
  2. Pick two Drafts and one item in internal review.
  3. Try to add an item already in another Package.
- **Expected result:** Only TMC's own submittals Ali can see are offered, with search and a Trade filter. An item in another Package is marked and cannot be picked. A submittal belongs to at most one Package.

### PKG-04 While Open: remove, rename, delete

- **Key:** `RP-898` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Remove one item.
  2. Rename the Package.
  3. Delete the Package.
- **Expected result:** Remove and delete work only while Open; Delete says the Drafts stay, without a Package. Rename is allowed in every status.

### PKG-05 Submit Package is all or nothing

- **Key:** `RP-899` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Add a Draft with a required field missing.
  2. Open Submit Package.
- **Expected result:** A not-ready list names each blocking item (for example required field Supplier missing) and links to it; Submit is disabled until the list is empty. Then one confirm submits every not-yet-submitted item; each gets its own Document Number. If any fails, none is submitted.

### PKG-06 Status runs Open, In Progress, Done

- **Key:** `RP-901` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Submit the Package.
  2. Close the items at A, B, C and D over time.
  3. Create a Revision for the Code C item and a replacement for D.
- **Expected result:** In Progress as soon as anything is submitted. Done only when every latest submittal has closed at A, B or D; a Code C waits for its Revision, which joins the Package by itself; a later replacement or added submittal puts it back In Progress. The word is Done, never Closed.

### PKG-07 After Submit: add yes, remove no

- **Key:** `RP-684` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In an In Progress Package add a submittal.
  2. Try to remove one.
- **Expected result:** Adding works; removing is not offered. Rename works and is recorded.

### PKG-08 The Package chip and filter on submittals

- **Key:** `RP-687` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open List and Kanban.
  2. Use the Package filter.
  3. Click the chip on a card and on the item page.
- **Expected result:** Cards and the item page show PKG-001 with the name; the chip opens the Package page; the filter narrows List and Kanban. Package is not a Form field.

### PKG-09 Bulk Transition applies one Action Form to many

- **Key:** `RP-690` · **Part:** PKG · **Round:** 1 · **Needs:** setup
- **Sign in as:** Mohammed (DCL manager, with a Signature); a DCL Member without a Signature (fixture: remove one in the profile)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In an In Progress Package select two items waiting on Mohammed that offer the same Code Transition (e.g. Code A).
  2. Choose it; fill the Action Form once; confirm.
  3. Repeat with an item that cannot take it.
  4. As a DCL Member without a Signature, select two items waiting on them and take the same Code in bulk.
- **Expected result:** With a Signature: one Action Form applies to each item (with Assign to if offered); each item is signed exactly as a single Transition is and gets its own event, Issued Code and Documental Record. All or nothing: if one item cannot take it nothing is done and the message names that item and why. Not offered unless every selected item offers the same Transition and Action Form. Without a Signature: the bulk Code is refused for all items, nothing is taken, and the reason (no Signature) is shown; there is no separate signing Step state. Owner decision 2026-10-19 (story 44 reworded on RP-616).

### PKG-11 Comments show on the Package for information

- **Key:** `RP-696` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After a Code B on an item of the Package open the Package Comments section.
- **Expected result:** Comments raised from its submittals are listed with their Stage and the note that Comments are not part of the Package; they do not change its status.

### PKG-12 A Package is seen only through submittals the viewer sees

- **Key:** `RP-699` · **Part:** PKG · **Round:** 1
- **Sign in as:** Yousef; Ahmed; Sara
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali builds a Package with Drafts only.
  2. Look at Packages as Yousef, Ahmed and Sara.
  3. After the Submit look again as Sara (Mechanical-only) and Ahmed.
- **Expected result:** Another Company's Open Package is never shown (not its name, Drafts or count). After the Submit Ahmed sees all submittals of his Trades; Sara sees only the Mechanical ones and their counts; status shows as one word. Yousef sees nothing.

## 6. Signing and Documental Record (15 cases)

### SIG-01 Every Transition is confirmed in its pop-up

- **Key:** `RP-702` · **Part:** SIG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open any Transition (Submit).
  2. Look for a Sign button or checkbox.
  3. Confirm.
- **Expected result:** The pop-up keeps the Transition's own label; there is no separate signing step. Taking it without confirming (API without confirmed true) is refused not_confirmed. After confirm the history records who, from which Participant and when.

### SIG-02 Download PDF on a closed item makes the sealed record

- **Key:** `RP-705` · **Part:** SIG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open a closed MAR (Code A) and press Download PDF.
  2. Repeat right after the Code, before the worker finishes.
- **Expected result:** A PDF downloads through a short-lived link. If the record is not made yet the page says it is not ready and to try again in a minute; no partial file.

### SIG-03 The tracer record prints title, outcome and approval flow

- **Key:** `RP-711` · **Part:** SIG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the downloaded PDF.
  2. Check the title block, outcome and date, Verification Code, link, approval flow, footer.
- **Expected result:** Type names and code, Subject, Project and Document Number (left to right, Rev included); the outcome with the date; the Verification Code and verification link; each Transition on the path with label, Member, Positions, Company, date and time (Riyadh time) and its content hash; Arabic then English; Latin digits; every page footed Issued electronically through Rabaed, Verification Code, page X of Y. (Page 1 and Form body come with SIG-08.)

### SIG-04 The record names everyone on the path and leaves out the rest

- **Key:** `RP-713` · **Part:** SIG · **Round:** 0
- **Sign in as:** Ali (TMC PM); Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Take a MAR through Send for Review, a Return, a second send, Submit with Internal Note, Ahmed Send to Manager with Recommended Code C, Mohammed Code A.
  2. Read the PDF.
- **Expected result:** It names every Member who took a Transition on the path, TMC's and DCL's alike, with the first entry dated at the raiser's last send out of Draft (a Returned send is off the path). It holds no Return, Internal Note, Recommended Code, Chat or in-progress answer.

### SIG-05 A Code C, a Code D and a Cancelled item also close with a record

- **Key:** `RP-714` · **Part:** SIG · **Round:** 0
- **Sign in as:** Hafiz; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Close one MAR at C, one at D.
  2. Download both PDFs.
- **Expected result:** Each closes with its record whatever the outcome; the outcome in the PDF matches the item.

### SIG-07 Add Signature in the profile (draw, type, upload)

- **Key:** `RP-717` · **Part:** SIG · **Round:** 2
- **Sign in as:** Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Profile > Add Signature: Draw with finger at 375 px, then Type, then Upload.
  2. Save.
  3. Replace it.
- **Expected result:** Pen styles and colours, Clear and Undo; a preview as on a record; once saved the profile shows it with Replace and the note that records already made keep the Signature used then.

### SIG-08 Record page 1 and Form body

- **Key:** `RP-719` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Download a record.
  2. Read page 1: Companies, title block, parties, classification, final decision with chips and QR, reply, approval flow, then the Form.
- **Expected result:** The layout matches form-engine section 6 items 1 to 9; tables and photos print as tables and a photo grid; Documents are listed.

### SIG-09 Company logo and Stamp

- **Key:** `RP-721` · **Part:** SIG · **Round:** 2
- **Sign in as:** Saeed (Authorized Person); Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Company profile: upload a logo and a Stamp.
  2. Hafiz opens the profile.
- **Expected result:** Two cards, Logo (optional) and Stamp (required to act), with Replace and the note that records keep the one in force then; only the Authorized Person has the buttons. Without a logo records show the name.

### SIG-10 No Stamp: no Member can act

- **Key:** `RP-724` · **Part:** SIG · **Round:** 2
- **Sign in as:** Hafiz; Saeed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With TMC's Stamp missing, Hafiz opens Submit.
  2. Saeed opens it.
- **Expected result:** Before the Action Form: TMC has no Stamp yet, ask its owner or Authorized Person; for Saeed, Add TMC's Stamp with an Add Stamp button. Only the viewer's own Company is named; nothing is written; nobody is notified.

### SIG-11 No Signature: the Add Signature pop-up

- **Key:** `RP-728` · **Part:** SIG · **Round:** 2
- **Sign in as:** Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With no Signature saved open any Transition.
- **Expected result:** Add your Signature to act. Every action you confirm is signed with it. Add Signature goes to the profile and returns to the item with nothing typed lost; Cancel closes.

### SIG-12 Signature cards, Stamps, Review Comments, endings and Disclaimer

- **Key:** `RP-731` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Download a record closed at A, then at C and at D.
  2. Read the Signatures, Stamps and ending pages.
- **Expected result:** One card per Transition on the path with Signature as it was then; the Stamp of every acting Company; Review Comments numbered; a Next step card with Code C (Revision n+1) or D (a new submittal replaces this one); an internal reviewer's card says Reviewed with no Code; the Disclaimer in Arabic and English.

### SIG-13 Appendix of Documents

- **Key:** `RP-733` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Close a MAR with PDF and image Documents and one DWG.
  2. Download the record.
- **Expected result:** Shared PDF and image Documents follow as pages; other files are attached inside the PDF; a Company's internal Documents are not included.

### SIG-15 Verification page

- **Key:** `RP-747` · **Part:** SIG · **Round:** 2
- **Sign in as:** Anyone (not signed in)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Scan the QR or open the link.
  2. Type the Verification Code with and without the Document Number.
  3. Drop a copy of the PDF.
- **Expected result:** Genuine, Document Number, Subject, Project, outcome, sealed date, signers' names, Positions and Companies; no Documents, answers or live item. The code alone is refused like a wrong code; attempts are limited per visitor; a dropped copy is checked in the browser against the fingerprint, uploading nothing.

### SIG-16 Working Copy of an unfinished item

- **Key:** `RP-749` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM); Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. While a MAR is with DCL, request a Working Copy as Ali and as Mohammed.
  2. Compare the two PDFs.
- **Expected result:** Both Working Copies are the same: watermarked Not Final / غير نهائي (or the Project text), unsealed, no Verification Code, Companies by name only, no person, no Signature or Stamp. A Draft Working Copy is made only for Members who see the Draft.

### SIG-17 Distribution link and Signatory Access

- **Key:** `RP-750` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM); a removed signing Member
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Use the record distribution link to send a closed record by the ordinary notification.
  2. Remove a signing Member from the Project and open the records they signed.
  3. Withdraw a Participant and open its Authorized Person records.
- **Expected result:** The record reaches people only through ordinary notifications inside Rabaed. A removed Member keeps the Project name and the records they signed; the Company keeps those its Members signed through its Authorized Person; open items of a withdrawn Participant are Cancelled.

## 7. Snag List (15 cases)

### SNG-01 The Snag List tab: List, Kanban and empty state

- **Key:** `RP-751` · **Part:** SNG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Project > Snag List.
  2. Switch List and Kanban.
  3. Use the Types chips (All, Snags, Comments), Stage, Trade, Company and search by number or Subject.
- **Expected result:** Items are grouped by Stage with counts; type chips and Stage counts count only visible items; an empty list reads No snags. Nice work. Filters with no match say nothing you can see matches.

### SNG-02 The Consultant raises a Snag on the Contractor

- **Key:** `RP-752` · **Part:** SNG · **Round:** 0 · **Needs:** setup
- **Sign in as:** Mohammed (DCL manager); Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Needs FX-C2 (PAR-14).
  2. Mohammed: Snag List > New Snag: Subject "UAT SNG-02 Cable tray not bonded", Description, Trade Electrical Works, Location Tower 1 Floor 02, a before photo.
  3. Raise.
- **Expected result:** The Snag is Open with TMC (the one Contractor covering Tower 1). With two Contractors covering the Location, Raise is refused with the plain This can not be handed over yet answer (RP-658 adds the pick).

### SNG-03 Contractor moves the Snag through its Steps

- **Key:** `RP-754` · **Part:** SNG · **Round:** 0
- **Sign in as:** Ali; Hafiz (TMC)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the Snag.
  2. Start work, Put on hold, Resume work, back to Open where offered.
  3. Read the Stage and Step Age as Mohammed.
- **Expected result:** Moves are TMC's internal events: Stage shows In Progress or On Hold inside TMC; Design Consultants sees it Open with Step Age counted from when it reached TMC. A send leaves it in TMC's Step Pool.

### SNG-04 Resolve with a note, Verify, Close or Return to Open

- **Key:** `RP-756` · **Part:** SNG · **Round:** 0
- **Sign in as:** Hafiz (TMC); Mohammed (DCL)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz: Resolve with a resolution note (required).
  2. Mohammed: Return to Open with a reason.
  3. Hafiz resolves again; Mohammed: Close.
- **Expected result:** Mohammed holds Verify (the raiser). Return to Open goes back to TMC, who resolved it. Closed ends the Snag. Each side reads only the other's shared Transitions.

### SNG-05 A Contractor raises a Snag on itself

- **Key:** `RP-758` · **Part:** SNG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. New Snag raised by TMC on its own work.
  2. Move it through Start work, Resolve, Verify, Close.
- **Expected result:** The raiser holds Draft and Verify, so TMC works and closes its own Snag; Design Consultants and Beta Build never see it (informing the Consultant is SNG-09).

### SNG-06 Comments from Code B live in the Snag List

- **Key:** `RP-760` · **Part:** SNG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After SUB-12 open the Comments.
  2. Resolve one; Mohammed closes it.
  3. Open the MAR.
- **Expected result:** Each Comment shows Raised from (number, Subject, Code B), is held by TMC, and counts on the MAR: Comments 2 open / 1 closed after one closes. The photo thumbnail is the first photo the viewer may see.

### SNG-07 New offers no Comment type

- **Key:** `RP-762` · **Part:** SNG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Snag List > New.
- **Expected result:** The menu offers Snag (and later Site Observation and Question) and not Comment; Comments only come from a Code B.

### SNG-08 Resolve with after photos

- **Key:** `RP-765` · **Part:** SNG · **Round:** 3
- **Sign in as:** Hafiz (TMC)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open an Open Snag; add after photos before Resolve; Resolve.
- **Expected result:** After photos sit with TMC until Resolve, then freeze and show beside the before photos in the record; a Send Back discards them.

### SNG-09 Informed Participants

- **Key:** `RP-774` · **Part:** SNG · **Round:** 3
- **Sign in as:** Hafiz; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Raise a Snag and name Informed Participants.
- **Expected result:** The named Participants are told and can read; others are not.

### SNG-10 Question and Site Observation Types

- **Key:** `RP-778` · **Part:** SNG · **Round:** 3
- **Sign in as:** Mohammed; Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. New > Question; New > Site Observation.
- **Expected result:** The Type chips appear; each has its own Form and Workflow; Questions have no reviewed item behind them; Site Observation is not called Violation.

### SNG-11 Snag detail page

- **Key:** `RP-780` · **Part:** SNG · **Round:** 3
- **Sign in as:** Hafiz; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open a Snag.
- **Expected result:** Header with number, type, Stage and age; Raised from card; description; photos; actions only for the viewer; history. No due date.

### SNG-12 Bulk actions and exports

- **Key:** `RP-782` · **Part:** SNG · **Round:** 3
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Select several Snags; reassign within TMC; Export Excel.
- **Expected result:** Bulk applies within TMC only; the export holds exactly the visible rows.

### SNG-13 Snag List on a phone

- **Key:** `RP-784` · **Part:** SNG · **Round:** 3
- **Sign in as:** Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 px open the Snag List and raise a Snag with the camera.
- **Expected result:** Photo-first cards, filters in a sheet, large New button, the camera opens from Take photo; saved as you go.

### SNG-14 Pick the Contractor when two cover a Location

- **Key:** `RP-787` · **Part:** SNG · **Round:** 3 · **Needs:** setup
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Leave Beta Build covering Tower 1 as in the seed.
  2. Raise a Snag on Tower 1.
- **Expected result:** The Raise pop-up asks which Contractor; the other never sees it.

### SNG-15 Snag PDF report

- **Key:** `RP-789` · **Part:** SNG · **Round:** 3
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Snag List > Export PDF report.
- **Expected result:** A PDF of the visible Snags with photos; no Snag the viewer cannot see.

## 8. Inspections (WIR) (14 cases)

### INS-01 Checklist Templates: create, edit into Version 2, retire

- **Key:** `RP-791` · **Part:** INS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Checklist Templates > New: name EN and AR, Trade, items with answers, comment and photo rules and Raise a Snag.
  2. Save; edit and Save as Version 2.
  3. Retire one.
  4. Open as Ali.
- **Expected result:** The two seeded templates (Concrete pour, Cable trays and containment) are listed per Trade with items, Version and availability. Saving makes the next Version and WIRs that copied an earlier one keep its items. Ali reads and cannot change.

### INS-02 Required links setting

- **Key:** `RP-800` · **Part:** INS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Required links: turn on Approved submittals required.
  2. Hafiz tries to send a WIR without one.
- **Expected result:** Every Member reads the setting; only a Project Admin changes it. With it on a WIR cannot leave Draft without an Approved submittal and the form names the field.

### INS-03 Raise a WIR with a Checklist Template

- **Key:** `RP-802` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. New Submittal or Inspections > New > Work Inspection Request: Description, Trade Civil Works, Location, Checklist Template.
  2. Look at the preview of items.
  3. Change the Trade.
- **Expected result:** Templates offered are the Trade's active ones, labelled As picked if later retired; changing the Trade clears the pick; before a Trade it says Choose a Trade first. The items are copied onto the WIR.

### INS-04 Approved submittals offers only Code A or B items

- **Key:** `RP-803` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In the WIR open Approved submittals.
  2. Search an item closed at C and one still open.
- **Expected result:** Only items closed at Code A or B that Hafiz sees and that were Submitted are offered; a saved id outside that is refused like an unknown option.

### INS-05 The pick is fixed once the WIR is Submitted

- **Key:** `RP-806` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Change the Checklist Template before the Submit.
  2. After Ali Submits try to change it.
- **Expected result:** Before the first Submit a new pick replaces the copy. After it, the pick and the copy are fixed.

### INS-06 Annotate a photo; the original is kept

- **Key:** `RP-809` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Add a photo to a Draft; open it and annotate (arrow, text label); Save.
  2. Switch Annotated and Original.
  3. Submit; Ahmed opens it.
- **Expected result:** The annotated copy is saved beside the original, marked annotated; the original's bytes are unchanged; both download. After the Submit Ahmed reads both; a frozen original takes no new copy.

### INS-07 Inspections tab and the in-Submittals setting

- **Key:** `RP-811` · **Part:** INS · **Round:** 0
- **Sign in as:** Ali; Ahmed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the Inspections tab (List and Kanban).
  2. Turn Inside the Submittals tab on (PAR-11) and open Submittals.
- **Expected result:** The tab uses the Submittals pages and Stages. With the setting on, WIRs appear in the Submittals List, counts, type filter and Kanban for those who may see them.

### INS-08 The WIR runs to the Consultant and the Manager

- **Key:** `RP-813` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz; Ali; Ahmed; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz raises a Civil WIR, sends it; Ali Submits it.
  2. Ahmed picks it up.
- **Expected result:** The WIR numbers like a submittal and reaches the Consultant Engineer pool. The Consultant fills the checklist on site (INS-09).

### INS-09 The Engineer answers the checklist on site

- **Key:** `RP-815` · **Part:** INS · **Round:** 4
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 px open the WIR: per item Pass, Fail or N/A, comment and photos.
  2. Fail an item whose Checklist Template requires a comment and photo.
- **Expected result:** Large segmented controls; on a Fail the comment and photo show required; a sticky summary like 18 Pass / 2 Fail / 1 N/A with progress; a failed item can raise a Snag (ticked by default).

### INS-10 Raise Snags from failed items

- **Key:** `RP-818` · **Part:** INS · **Round:** 4
- **Sign in as:** Ahmed; Mohammed; Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Fail two items, one with Raise a Snag unticked.
  2. Mohammed issues any Code.
- **Expected result:** Whatever the Code, each ticked failed item becomes a Snag raised by the Consultant for the Contractor, linked to the WIR.

### INS-11 The Manager proposes a Code from the checklist

- **Key:** `RP-821` · **Part:** INS · **Round:** 4
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open a WIR with one failed item and one with none.
- **Expected result:** The pop-up pre-selects C when any item failed, else A; the Manager can change it; each pop-up lists the Snags that will be raised.

### INS-12 A WIR ends with a Review Code and a re-inspection Revision

- **Key:** `RP-824` · **Part:** INS · **Round:** 4
- **Sign in as:** Mohammed; Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Close WIRs at A, B (with comment rows), C and D.
  2. Hafiz creates the Revision after C.
- **Expected result:** A to D close like a submittal; B makes Comments; C offers a Revision as a re-inspection that copies the same checklist; D closes. No Passed or Failed result is shown for new WIRs.

### INS-13 The Contractor reads the checklist only after the Code

- **Key:** `RP-827` · **Part:** INS · **Round:** 4
- **Sign in as:** Hafiz; Ahmed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. While Ahmed answers, Hafiz opens the WIR.
  2. After the Code, again.
- **Expected result:** Before Ahmed sends it to the Manager Hafiz reads none of the answers, comments or photos; after the Code he reads them. Ahmed's Recommended Code and Internal Note never reach Hafiz.

### INS-14 WIR shares Stages with submittals

- **Key:** `RP-830` · **Part:** INS · **Round:** 4
- **Sign in as:** Ali; Ahmed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With the WIR in Pending Approval open the Kanban.
- **Expected result:** A WIR sits in the same column as a submittal at the same Stage.

## 9. Submittal Register Import (11 cases)

### IMP-01 Upload accepts .xlsx and .csv only

- **Key:** `RP-835` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Submittals > Import register.
  2. Upload a .pdf, a non-UTF-8 .csv, a .csv over 2,000 rows, then a good .xlsx.
- **Expected result:** Each bad file gets its own message (only .xlsx and .csv; save as CSV UTF-8; split into smaller registers). The good file moves to the next step. Cells are read as stored, so 0012 stays 0012 when typed as text.

### IMP-02 Pick the worksheet and the header row

- **Key:** `RP-838` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Upload a workbook with two sheets and 3 title rows above the headings.
  2. Choose the sheet and the header row.
- **Expected result:** The preview shows the first rows; rows above the header are skipped; rows below are read as submittals; an empty or missing header row gets its message.

### IMP-03 Map columns to Rabaed fields

- **Key:** `RP-841` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Map Description to Subject, Type to Type, Discipline to Trade.
  2. Try Validate with Trade unmapped.
  3. Use one value for every row instead.
- **Expected result:** Subject, Type and Trade are required; unmapped columns are ignored; a fixed value for every row is allowed and shown as such on the import's page.

### IMP-04 Preview lists every reason per bad row

- **Key:** `RP-844` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Validate a register with: empty Subject, Subject over 200 characters, unknown Type, Trade not in the Project, a Trade outside Hafiz's Visibility.
- **Expected result:** Counts show rows checked, ready and left out; each bad row lists all its reasons (Subject empty, Type unknown, Trade not in this Project, Trade is outside your Visibility). Nothing is created yet.

### IMP-05 Confirm creates Drafts, all good rows or none

- **Key:** `RP-847` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Confirm a preview with 8 good rows and 2 bad.
  2. Open the Submittals List.
- **Expected result:** Eight Drafts are created, raised by Hafiz, each No number yet; the two bad rows are left out and never created. A change in the Project after the preview gives Something in the Project changed, validate again.

### IMP-06 The result page and the Imports page

- **Key:** `RP-850` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After confirming read the result: Drafts created, Left out, Open the Drafts.
  2. Imports page.
  3. Open the import.
  4. Ali opens the same page.
- **Expected result:** Imports are listed by file name only, with no time anywhere. The import page lists every row with its result; a created row links to its Draft only where the viewer sees that Draft. Ali, a colleague, reads the import after confirm (a preview before confirm is its importer's alone).

### IMP-07 Imported Drafts follow the Draft rules

- **Key:** `RP-852` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz; Omar; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open an imported Draft.
  2. Read its history as Hafiz.
- **Expected result:** It is an ordinary Draft: Hafiz edits it, sends it, and it gets its number at the first send. Its created event, internal to TMC, names the import. Under author-only Drafts (WF-10) Omar and Ali cannot see it.

### IMP-08 Download the rows left out and import again

- **Key:** `RP-857` · **Part:** IMP · **Round:** 5
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On the result press Download rejected rows.
  2. Fix and import again.
- **Expected result:** The file holds the left-out rows with a reason column; the second import is a new import.

### IMP-09 Unknown values are matched once per distinct value

- **Key:** `RP-860` · **Part:** IMP · **Round:** 5
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Map a Trade column holding Elec. on 30 rows.
  2. Match Elec. to Electrical Works once.
- **Expected result:** The match applies to all 30 rows; the preview recounts.

### IMP-10 Assign to for imported Drafts

- **Key:** `RP-863` · **Part:** IMP · **Round:** 5
- **Sign in as:** Hafiz; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Assign Electrical rows to Hafiz and other rows to Ali, or use an email column.
  2. Include a person who cannot create the Type.
- **Expected result:** Drafts are raised by the importer by default; an assignee who cannot create the Type or does not cover the Trade makes that row bad.

### IMP-11 Packages from an import and saved mappings

- **Key:** `RP-866` · **Part:** IMP · **Round:** 5
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Group rows into one new Package, then one per column value, then an existing Open Package; try an In Progress Package.
  2. Save the mapping and reuse it.
- **Expected result:** New Packages take the next PKG number; an In Progress or Done Package makes its rows bad; the mapping is kept for the Company only.

## 10. Notifications (4 cases)

### NOT-01 The bell, the Notifications page and Mark all as read

- **Key:** `RP-871` · **Part:** NOT · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After SUB-04 look at the bell badge.
  2. Open Notifications; open one entry.
  3. Mark all as read.
- **Expected result:** The badge counts unread; each entry reads Reached you at <Step> and opens the item; Mark all as read clears the badge. In-app notifications are always sent: there is no in-app switch.

### NOT-02 Step reached and Submit notify the right people

- **Key:** `RP-873` · **Part:** NOT · **Round:** 0
- **Sign in as:** Ali; Ahmed; Sara; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali Submits.
  2. Check Ahmed's and Sara's bells and Mohammed's.
- **Expected result:** Ahmed and Sara (the pool) are told; Mohammed is not until it reaches him; the text names TMC as a Company, never a person.

### NOT-08 A Revision notifies when it gets its number

- **Key:** `RP-891` · **Part:** NOT · **Round:** 0
- **Sign in as:** Hafiz; Ahmed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz creates a Revision and keeps it Draft.
  2. Sends it for review.
  3. After the Submit read Ahmed's bell.
- **Expected result:** No revision_created notice while it is a Draft; it is sent when the Revision is numbered; Ahmed is told only after the Submit.

### NOT-09 Sent Back notifies only the Participant it went back to

- **Key:** `RP-894` · **Part:** NOT · **Round:** 0 · **Needs:** setup
- **Sign in as:** Mohammed; Hafiz; Faisal
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Needs FX-SB (WF-09).
  2. Mohammed Sends Back a Submitted item.
- **Expected result:** Hafiz and TMC Members who see it are told, with DCL named as a Company; Faisal is not told of internal moves.

## 11. Arabic, RTL and phone width (7 cases)

### I18N-01 Switch language keeps the page and mirrors the layout

- **Key:** `RP-902` · **Part:** I18N · **Round:** 0
- **Sign in as:** Faisal; Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On Home, List, Kanban and an item switch EN to AR with the language button, and open /ar URLs directly.
  2. Switch back.
- **Expected result:** The same page reloads in Arabic with RTL: sidebar, tables, filter panel, Kanban column order, arrows and breadcrumbs mirror. Nothing is cut off.

### I18N-03 Document Numbers stay left to right

- **Key:** `RP-904` · **Part:** I18N · **Round:** 0
- **Sign in as:** Faisal (Arabic)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In /ar open the List, an item, a Link, the Revision drop-down, a notification and the PDF.
- **Expected result:** TWR-MAR-01-0003 Rev 1 reads left to right whole in every place, also inside Arabic text.

### I18N-04 Form labels and validation messages in Arabic

- **Key:** `RP-906` · **Part:** I18N · **Round:** 0
- **Sign in as:** Hafiz (Arabic)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open a MAR Form in /ar; leave Description empty and Send for Review.
- **Expected result:** Field labels, section titles, Action Form words and the missing-fields message are Arabic; values typed in English are not translated.

### I18N-05 Rabaed opens in Arabic; a switch to English is remembered

- **Key:** `RP-686` · **Part:** I18N · **Round:** 0
- **Sign in as:** Faisal; Noura
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In a browser set to English, sign in as each.
  2. Switch to English.
  3. Sign out and sign in again.
- **Expected result:** Opens in Arabic; after switching to English, opens in English next time; the browser's language doesn't matter.

### I18N-06 Phone width 375: nothing breaks

- **Key:** `RP-689` · **Part:** I18N · **Round:** 0
- **Sign in as:** Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 px open Home, Projects, Submittals List, Kanban, an item, Settings, the Workflow builder.
- **Expected result:** No page scrolls sideways; tables and the Kanban scroll inside their own area; the sidebar opens as a drawer. This is what the build guarantees until the phone designs of RP-422 exist. Note, without failing the scenario, touch targets under 44 px, filters that do not open as a sheet and any cut-off text, as UX recommendations. The same web app, no separate app.

### I18N-07 Desktop 1366 and 1920

- **Key:** `RP-692` · **Part:** I18N · **Round:** 0
- **Sign in as:** Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Home, List, Kanban, an item at 1366 and 1920 px.
- **Expected result:** Layout follows the reference screens at both widths (see strategy section 3 for the ui-ux-tester pass).

### I18N-08 The not-found page says nothing

- **Key:** `RP-695` · **Part:** I18N · **Round:** 0
- **Sign in as:** Nasser (Beta Build); Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. As Nasser open a Riyadh Gate Tower item URL.
  2. Open a made-up URL.
  3. Repeat in /ar.
- **Expected result:** Both show the same page: We can not find this page, it may not exist, or you may not have access, with a Projects button; identical in both languages; never a 403 or a hint which case it is.

## 12. UI and UX against the design (25 cases)

### UX-01 App shell, sidebar and top bar match the design

- **Key:** `RP-923` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer); Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Home at 1366 and 1920, EN and AR.
  2. Open each sidebar entry and the member menu.
  3. At 820 and 375 open the drawer.
- **Expected result:** Matches saas-shell.html (and D:\Artifacts\Rabaed Responsive Anatomy.html for the drawer): sidebar entries of RP-405 decision 5 only (no Overdue, Payments, Subscriptions, Roles, theme toggle), Company name not a switcher, Arabic mirrored. UI issues and UX recommendations reported apart.

### UX-02 Home matches the design and reads at a glance

- **Key:** `RP-924` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Home at 1366 and 1920, EN and AR, with items in every state.
  2. Follow each number and row.
- **Expected result:** Matches the kit Home with RP-405 changes: Active Projects, Need My Action, 4+ weeks at their step (Step Age dots, never Overdue), Waiting with others, Recent activity. Every number opens the List with its filter. Empty state reads well for a new Member.

### UX-03 Projects page and Project Dashboard

- **Key:** `RP-925` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Projects, then a Project Dashboard, EN and AR, 1366 and 1920.
  2. Click each card figure.
- **Expected result:** Cards match the kit; the Dashboard Type cards, Revision line and Activity Feed are laid out as designed; no squashed card (the RP-405 audit fault); each figure opens the List with the same filter.

### UX-04 Submittals List matches the owner anatomy

- **Key:** `RP-926` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Submittals > List at 1366 and 1920, EN and AR.
  2. Open the filter panel, choose several values, save columns, sort, page.
  3. Scroll a long table.
- **Expected result:** Matches D:\Artifacts\Rabaed Submittals List.html first, then submittals-list.html with list/filter-panel.js: columns, chips, Step Age dots, Code labels ("Code A"), row menu; the table scrolls inside its own region, the page never scrolls sideways.

### UX-05 Submittals Kanban matches the board and card anatomy

- **Key:** `RP-927` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Submittals > Kanban, EN and AR, 1366 and 1920.
  2. Read a card in every Stage; change the Card view layout.
  3. Scroll across and within columns.
- **Expected result:** Matches D:\Artifacts\Rabaed Kanban Board Anatomy.html and Rabaed Kanban Card Anatomy.html, then submittals-kanban.html: column headers and counts, card fields and order, With line, Step Age dots, closed-by line; columns scroll left and right, cards up and down.

### UX-06 Work Item page, Transition pop-ups and View workflow drawer

- **Key:** `RP-928` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz; Ali; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open a MAR in Draft, in internal review, Submitted and closed, EN and AR.
  2. Open every Transition pop-up (Send for Review, Submit with Cover Note, Return, Code A to D).
  3. Open View workflow (map and list).
- **Expected result:** Laid out as design/prompts/work-item-page.md and workflow-view.html: header (Document Number left to right, Stage, With, Step Age), Form, Attachments and Links, history; each pop-up asks for confirmation and shows its Action Form; required fields and errors are clear.

### UX-07 New work item and the Form while filling it

- **Key:** `RP-929` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. New Submittal for each Type, EN and AR, 1366 and 375.
  2. Fill, leave required fields empty, add Items rows, upload files and a photo, Save Draft.
- **Expected result:** Laid out as new-work-item.md and form-template-brief.md: sections, field help, the Items table on a phone, upload progress, "Saved" indicator, the list of fields needing attention; nothing overlaps at 375.

### UX-08 Activity page

- **Key:** `RP-930` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the Project Activity page, EN and AR.
  2. Page back; open entries.
- **Expected result:** Laid out as design/prompts/activity.md: entries worded from what happened, another Company by name only, newest first, paging that keeps its place.

### UX-09 Notifications page and the bell

- **Key:** `RP-931` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the bell, then the Notifications page, EN and AR.
  2. Open an entry; Mark all as read.
- **Expected result:** Laid out as design/prompts/notifications.md: unread state, grouping, the item it opens, empty state; the bell badge matches the unread count.

### UX-10 Profile and notification settings

- **Key:** `RP-932` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Profile, EN and AR.
  2. Change language, email per group, Pause all, a Project mute.
- **Expected result:** Laid out as profile-notification-settings.md: no In-app switch; each change confirms it saved; the language change keeps the page.

### UX-12 Members, Participants and a Member Visibility page

- **Key:** `RP-934` · **Part:** UX · **Round:** 0
- **Sign in as:** Saeed (Authorized Person, Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open My Company > Members and Participants.
  2. Open a Participant and a Member Visibility page; narrow and save.
- **Expected result:** Laid out as design/prompts/participants.md: Trades and Locations pickers usable with many values, the Visibility Gap warning readable, counts only of the viewer own Company.

### UX-13 Project Settings pages

- **Key:** `RP-935` · **Part:** UX · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open each Settings page: Trades and Locations, Visibility, Modules, Stages, Outcomes, Required links, Approved suppliers, Checklist Templates, Screens.
  2. Do one change on each as Saeed; open them as Ali.
- **Expected result:** Every page uses the Settings template of the kit and project-settings.md: one layout, save and cancel in the same place, read-only state clear for Ali, Arabic mirrored.

### UX-14 Settings > Numbering

- **Key:** `RP-936` · **Part:** UX · **Round:** 0
- **Sign in as:** Saeed; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Numbering EN and AR.
  2. Edit a pattern; read the preview and the shared-counter warning.
- **Expected result:** Matches settings-numbering.html and D:\Artifacts\Rabaed Document Numbering.html: pattern builder, preview left to right, warning wording; Ali sees examples only.

### UX-15 Settings > Workflows, the builder and the Library

- **Key:** `RP-937` · **Part:** UX · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Settings > Workflows, a Workflow, its Versions.
  2. Open the builder: add a Step, connect, undo, auto-layout, Validate, Publish.
  3. Open the Library.
- **Expected result:** Matches settings-workflows.html with wf/, D:\Artifacts\Rabaed Settings Workflows.html and Rabaed Workflow Builder V2.html: canvas, Step panel, problems list, Change Note; usable at 1366.

### UX-16 Register Import wizard and Imports page

- **Key:** `RP-938` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Run an import: upload, worksheet and header row, mapping, preview with bad rows, confirm.
  2. Open the result page and the Imports page. EN and AR.
- **Expected result:** Laid out as design/prompts/register-import.md, except that no import time is shown (visibility.md wins): each step says where you are, bad rows show every reason, confirm says how many Drafts.

### UX-17 Snag List on the desktop

- **Key:** `RP-939` · **Part:** UX · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer); Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the Snag List: List grouped by Stage, Kanban, type chips, filters, EN and AR.
- **Expected result:** Matches snag-list.html: groups, chips, Step Age dots, filters; Comments from Code B shown as designed.

### UX-18 WIR request and on-site inspection on a phone

- **Key:** `RP-940` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz; Ahmed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 (phone), raise a WIR and open it on site as Ahmed: checklist, photos, annotate, EN and AR.
- **Expected result:** Laid out as inspection-on-phone.md: phone-first, large touch targets, camera first, annotate tools reachable with a thumb, nothing cut off.

### UX-19 Phone width for every built page

- **Key:** `RP-941` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 and 820 open Home, Projects, List, Kanban, item page, New item, Notifications, Profile, Settings. EN and AR.
- **Expected result:** Follows D:\Artifacts\Rabaed Responsive Anatomy.html and responsive.md: no page-level sideways scroll; tables and the Kanban scroll inside their region; the sidebar is a drawer; every action reachable.

### UX-20 Empty, loading and error states

- **Key:** `RP-942` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz; a new Member with no Projects
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Visit each built page with no data, while loading (slow network), and with the api stopped for a moment.
- **Expected result:** Every page has a designed empty state with a next step, a loading state with no layout jump, and an error that says what to do; the not-found page says nothing about the request.

### UX-21 Feedback after every action

- **Key:** `RP-943` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz; Ali; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Save a Draft, take each Transition, upload, change a setting.
  2. Watch for the confirmation, the disabled reason and the page update.
- **Expected result:** Each action gives visible feedback (toast or inline), disabled buttons say why, the page updates without a reload, nothing is done twice on a double click.

### UX-22 Keyboard and screen reader basics

- **Key:** `RP-944` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Use the List, Kanban, item page, a Transition pop-up and the Form with the keyboard only.
  2. Run an accessibility scan (the accessibility-tester agent, report only) on the same pages, EN and AR.
- **Expected result:** Visible focus, logical focus order (mirrored in Arabic), pop-ups trap and return focus, every control has a label, text contrast at least WCAG AA. Findings reported as UI issues.

### UX-23 Packages view and Package page

- **Key:** `RP-945` · **Part:** UX · **Round:** 1
- **Sign in as:** Ali (TMC PM); Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the Packages view and a Package page, EN and AR, 1366 and 1920: cards, counts, item table, bulk bar, Comments section.
- **Expected result:** Matches packages.html where spec RP-616 does not differ (the table of known differences in design/prompts/packages.md).

### UX-24 Snag List on a phone

- **Key:** `RP-946` · **Part:** UX · **Round:** 3
- **Sign in as:** Hafiz; Ahmed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 open the Snag List, filters and a Snag; create one camera first.
- **Expected result:** Matches snag-list-mobile.html: photo-first cards, bottom-sheet filters, camera-first create.

### UX-25 Add Signature, the no-Signature and no-Stamp pop-ups, Company logo and Stamp

- **Key:** `RP-947` · **Part:** UX · **Round:** 2
- **Sign in as:** Hafiz; Saeed (Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Profile > Add Signature (draw, type, upload).
  2. Take a Transition with no Signature; with a Company with no Stamp.
  3. Company profile: logo and Stamp.
- **Expected result:** Laid out as signature-and-stamp.md and its Claude Design screens (RP-665): clear what is missing and how to add it, EN and AR.

### UX-26 Documental Record and Working Copy read like the owner samples

- **Key:** `RP-948` · **Part:** UX · **Round:** 2
- **Sign in as:** Ali; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Download the Documental Record of a closed MAR and a Working Copy, EN and AR record language.
  2. Compare with the owner samples of RP-151.
- **Expected result:** Page 1, the Form body, Signature cards and appendix follow the samples where they agree with visibility.md and GLOSSARY.md; Latin digits; Document Numbers left to right; readable when printed.

## 13. Visibility (59 cases)

### VIS-01 A new Draft and a MAR in internal review are TMC's alone

- **Key:** `RP-734` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Hafiz, Ali (TMC). Must NOT see: Yousef (Beta Build), Ahmed, Sara, Mohammed (DCL), Faisal, Noura (Al Waha), Owner PM (UAT Owner Co)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz saves a Draft MAR "UAT VIS-01 Draft".
  2. Each observer: Submittals List, Kanban, Dashboard, Home, Activity Feed, bell, and search for the Subject; note every count.
  3. Hafiz sends it for review (Ali holds it); repeat 2.
- **Expected result:** Observers must NOT see the item in any List, Kanban, count, badge, Dashboard figure, search result, feed entry or notification, before or after the send. Their counts are unchanged by it.

### VIS-02 After the Submit only the covering Consultant and oversight see the MAR

- **Key:** `RP-736` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Actors: Ali. Must see: Ahmed (DCL Electrical), Faisal and Noura (Al Waha, oversight), Owner PM (UAT Owner Co). Must NOT see: Sara (Mechanical-only, FX-K1M), Yousef (Beta Build)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali Submits an Electrical MAR.
  2. Check each person's List, pool, item URL.
- **Expected result:** Ahmed sees it in the Step Pool; Faisal, Noura and the Owner PM see it read-only as oversight; Sara (Mechanical only) and Yousef (same Trade, other Contractor, V3) get the 404 page, no row and no count.

### VIS-03 Access follows the current grant, not the grant date

- **Key:** `RP-738` · **Part:** VIS · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person); Sara
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With Sara Mechanical-only and an Electrical MAR Submitted, Layla gives Sara Electrical again.
  2. Sara opens the List.
  3. Layla removes Electrical again.
- **Expected result:** Sara sees the Electrical items from then on, including earlier ones; after removal she stops seeing them (E2 aside). Layla needs no Handover for a Step Sara does not hold.

### VIS-04 Recommended Code, Internal Notes and the verification note never reach TMC

- **Key:** `RP-740` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Ahmed, Mohammed (DCL). Must NOT see: Hafiz, Ali (TMC), Faisal, Noura (Al Waha)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali Submits with an Internal Note.
  2. Ahmed Sends to Manager with a verification note, Recommended Code A and an Internal Note.
  3. Before the Code, read the item history, Activity Feed, bell and List as Hafiz, Ali and Faisal.
  4. Mohammed issues Code C with Remarks, a verification note and an Internal Note.
  5. Read again.
- **Expected result:** Before the Code TMC and Al Waha see no change at all: no reply, Recommended Code or Return. After it they read the Code, Remarks and final verification and that Mohammed issued it, never Ahmed's reply, a Recommended Code, an internal_answers entry or any Internal Note; the history numbering has no gap. K1 sees the Submit but never TMC's Internal Note. DCL reads all of its own.

### VIS-05 Code B Comments reach the reviewed item's raiser only

- **Key:** `RP-742` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Mohammed (DCL). Must NOT see: Yousef (Beta Build); Sara (Mechanical-only). Must see: Ali, Hafiz (TMC), Faisal (oversight)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed issues Code B with three comment rows on a TMC Electrical MAR.
  2. Yousef: Snag List, counts, Kanban, and each Comment id.
  3. Ali resolves one and Mohammed closes it.
  4. Read the MAR's Comments line as Sara.
- **Expected result:** Yousef sees none in the Snag List, counts or Kanban and gets 404 by id; Comments are Open with TMC, raised by DCL, seen by Faisal as oversight; Sara sees neither the MAR nor its Comments; TMC and DCL read 2 open / 1 closed.

### VIS-06 Chat is visible to every Participant that has the item

- **Key:** `RP-745` · **Part:** VIS
- **Sign in as:** Ali; Ahmed; Faisal
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali posts in Chat on a Submitted MAR.
  2. Ahmed and Faisal read it.
- **Expected result:** Both read it; messages cannot be edited or deleted. Chat is not on the closed record.

### VIS-07 Only people who see a closed item can download its record

- **Key:** `RP-764` · **Part:** VIS · **Round:** 0
- **Sign in as:** Must see: Ali, Ahmed, Faisal, Owner PM. Must NOT see: Yousef (Beta Build)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed closes a MAR.
  2. Each person presses Download PDF on the item and from the List row; Yousef also requests the item id and the record URL directly.
- **Expected result:** Ali, Ahmed, Faisal and the Owner PM download the same record; Yousef gets the plain 404 page everywhere and no row. A made-up id and an item whose record is not made yet give the same 404.

### VIS-08 The Record Data inside the PDF holds only what the pages print

- **Key:** `RP-766` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the PDF's attachments and extract the Record Data XML.
  2. Compare each value with the PDF text.
- **Expected result:** Every value in the XML (Transitions on the path with name, Position, Company, times and hashes; Verification Code and link) is printed in the PDF; the XML holds no Internal Note, Recommended Code, Chat or Return.

### VIS-09 A Link to an item the viewer cannot see shows number and Subject only

- **Key:** `RP-768` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Omar (TMC, Tower 2 only); Mohammed (DCL); Yousef (Beta Build)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz's control panel MAR links the exit signs (Tower 1).
  2. Omar opens Links, then the Link.
  3. Open the exit signs' own URL as Omar.
  4. Mohammed, who sees both, opens the Link.
  5. Yousef tries to link the exit signs in his own Draft.
- **Expected result:** Omar sees only the Document Number and Subject; the Link opens on its own page with only You are not allowed to see the details of this item; the response holds no item id and the item URL is 404. Mohammed gets the item. Yousef is never offered the exit signs.

### VIS-10 Linked from lists Submitted items by number and Subject only

- **Key:** `RP-769` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Actors: Mohammed (DCL); Ali, Hafiz (TMC)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz links his Draft MAR-2 to the Submitted MAR-1.
  2. Mohammed reads MAR-1's Linked from.
  3. Hafiz Submits MAR-2; read again.
  4. Needs FX-C2: Mohammed raises a Snag that links MAR-1; Hafiz reads MAR-1's Linked from.
- **Expected result:** MAR-2 is not listed while it is a Draft or in internal review, then appears. Hafiz sees Mohammed's item as number and Subject; opening it says he may not see its details; its answers, history and Documents stay hidden and its URL is 404.

### VIS-11 Link search never offers what the linker cannot see

- **Key:** `RP-771` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz; Yousef
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. As Hafiz search for an item to link.
  2. As Yousef search for the same Subjects.
  3. Via the API save a Link to a Beta Build item id from TMC.
- **Expected result:** Hafiz is offered only Submitted items he sees in this Project: no Drafts, nothing in internal review, nothing of Beta Build, nothing from another Project. Yousef is never offered TMC's item. The saved Link is refused like a made-up id.

### VIS-12 A Revision Draft is hidden; the drop-down lists only what the viewer sees

- **Key:** `RP-772` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Hafiz (TMC). Must NOT see: Mohammed, Faisal
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz creates Revision 1 of a Code C MAR and keeps it Draft.
  2. Mohammed and Faisal open the original: drop-down, Links, and the Revision URL.
  3. Hafiz Submits it.
  4. Hafiz discards another Draft Revision and creates it again.
- **Expected result:** Before the Submit the drop-down lists only the original, there is no Link to the Draft and its URL is 404. After it both Revisions are listed and the original shows its own answers, Documents and history. A discarded Revision never reaches Mohammed; the re-created one is Rev 1 again.

### VIS-13 A Revision moved to another Location: each oversight Member sees only theirs

- **Key:** `RP-775` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Actors: Hafiz (TMC); Faisal (Tower 1 only), Noura (Tower 2 only) after Hind narrows them
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hind narrows Faisal to Tower 1 and Noura to Tower 2 (fixture FX-OR).
  2. Hafiz makes Rev 1 of a Tower 1 MAR, moves it to Tower 2, names the original in a link question and Submits it.
  3. Both read the original, Rev 1, Links, Linked from and the drop-down.
- **Expected result:** Faisal sees the original but no Link to Rev 1 and a drop-down with the original only; Noura sees Rev 1 with no Link, Linked from or link answer naming the original and a drop-down with Rev 1 only. Neither shows even a number or title of the other.

### VIS-14 After a Send Back (Comment only) everyone sees the item as it was

- **Key:** `RP-776` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Actors: Hafiz (TMC). Observers: Mohammed (DCL), Faisal, UAT Owner PM
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Needs FX-SB (WF-09, Comment only).
  2. Ahmed Sends a Submitted MAR Back.
  3. Hafiz tries to change an answer, add a Document and a Link.
  4. Observers read the item, Documents, Links and Link search.
  5. Hafiz Submits again.
- **Expected result:** Hafiz cannot change anything (Sent back for comment). Observers see the item exactly as at the Send Back; the item is still offered in Link search and in Linked from with the same number and Subject. After the new Submit they see everything.

### VIS-15 After a Send Back (Edit the Form) the raiser changes stay private

- **Key:** `RP-785` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Actors: Hafiz (TMC). Observers: Mohammed, Faisal (Tower 1 only), Noura (Tower 2 only), UAT Owner PM
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Needs FX-SB with the Edit the Form setting and FX-OR.
  2. Sent Back item at Tower 1: Hafiz changes an answer, adds a Document, a datasheet and a checklist photo, swaps a Link from X to Y, moves it to Tower 2.
  3. Observers read it through List, Kanban, filters, search, item, Documents, Links, history, feed, bell.
  4. Hafiz Submits again.
- **Expected result:** Until the Submit observers see the item, Documents, Links, Trade, Location and Scopes as they were at the Send Back; new Documents are 404 to them; Faisal (Tower 1) keeps the item and Noura (Tower 2) does not see it; no history entry or notification shows a change. After the Submit the new values apply to everyone: Faisal loses it and Noura gains it.

### VIS-18 Dashboard counts follow what the viewer may see

- **Key:** `RP-795` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Hafiz, Ali (TMC); Ahmed (DCL); Yousef (Beta Build)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Fresh seed, MAR card: note Ali, Ahmed and Yousef.
  2. Hafiz saves two more Drafts and sends one for review.
  3. Mohammed Codes C one Submitted MAR; Hafiz creates Rev 1 and keeps it Draft; compare the Revision line.
  4. Compare again.
- **Expected result:** Fresh seed: Ali Pending 2 (0002 and 0003 Rev 1, one per chain) and In preparation 1 (the seeded Draft); Ahmed Pending 2 and no In preparation figure; Yousef 0 of everything. After step 2 Ali In preparation 3 and Pending unchanged; Ahmed and Yousef unchanged. DCL card shows awaiting revision while TMC card shows Revision in progress; each chain counts once; Yousef Revision line holds nothing of TMC.

### VIS-19 List and Kanban counts, lanes and filters hide the other Company

- **Key:** `RP-797` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Ali (TMC); Ahmed, Mohammed (DCL); Yousef (Beta Build)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With a TMC item picked up by Mohammed and another in TMC internal review, Ali and Ahmed open the filter panel (Owner, Role, Created date) and the Kanban.
  2. Yousef opens Kanban and List.
- **Expected result:** Owner offers each viewer their own Company people and the other Company by name only; filtering by the other Company person finds nothing. Role offers only the viewer own Steps. The TMC Internal Review column names its Steps with counts; DCL sees none of them. Created date is the Creation Date for TMC and the Submission Date for DCL. Yousef counts cover only Beta Build items.

### VIS-20 Search finds nothing inside answers or replies

- **Key:** `RP-798` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC); Mohammed (DCL)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed issues a Code with Remarks containing the word zircon.
  2. Ali and Mohammed search zircon in List and Kanban.
  3. Search the owner name and a Floor name.
- **Expected result:** No result for zircon: Search never reads answers or replies. Search by Document Number, Subject, Type, Trade, Location and the raiser Company works; an owner phrase finds the viewer own Company people and the other Company by name only.

### VIS-23 Who holds an item: pool names stay inside the holding Company

- **Key:** `RP-804` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Ali, Hafiz (TMC); Ahmed, Sara, Mohammed (DCL)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali Submits a MAR: it waits in DCL pool of two Engineers.
  2. Ali reads With on the item, List and Kanban.
  3. Ahmed picks it up; Sara and Ali read again.
  4. Mohammed issues Code B; the Comments wait in TMC pool.
- **Expected result:** Ali reads With Design Consultants LLC and never the pool names, the holder or a Pick up event, in the item, List, Kanban, history, feed or notifications. DCL reads the pool names then the holder. Mohammed reads TMC by name only, even while the Comments wait in TMC pool.

### VIS-24 The Owner review: With Owner review and the Recommended Code

- **Key:** `RP-807` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Mohammed (DCL); Noura (Al Waha PM, holds the review); Hafiz, Ali (TMC); UAT Owner PM
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Raise a DAR; Ali Submits; Mohammed recommends Code B with a table of comments to the Owner.
  2. Hafiz and Ali read the item everywhere.
  3. Noura Sends Back; Mohammed recommends C; Noura Confirms.
  4. The UAT Owner PM reads the item at each step.
- **Expected result:** While Noura reviews, TMC reads With Owner review (no Company name) in the List, search, Kanban lane, item, workflow map and weekly report, and no Code anywhere (not in History, feed, bell, Dashboard). Mohammed and Noura read the Recommended Code; the UAT Owner PM (Owner, not holder) reads none until it is issued. Confirm issues the Code for everyone; Comments with B come from Mohammed rows and are held by TMC; Code C offers a Revision.

### VIS-25 The workflow map folds the other Company into one block

- **Key:** `RP-816` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC); Ahmed, Mohammed (DCL); UAT Owner PM
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali and the Owner PM open View workflow on a Submitted MAR.
  2. Ahmed sends it to Mohammed.
  3. Read the map again.
- **Expected result:** Both read the whole Version with every Company Steps, but the item is With Design Consultants LLC over DCL part: no DCL Step is marked and the Ahmed to Mohammed move changes nothing they read. DCL sees Mohammed Step marked.

### VIS-26 Workflow authoring is 404 for everyone but the authors

- **Key:** `RP-819` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM, not Project Admin); Layla (DCL Authorized Person); Nasser (Project Admin of JCV only)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Each opens the builder URL of Tower Workflow and tries Duplicate, Save, Publish and Bind on it.
  2. Nasser also tries a JCV Workflow URL pasted under the Tower Project.
- **Expected result:** Every attempt gets the plain 404 naming nothing and changes nothing; a Rabaed Default is 404 in the builder to Project Admins; a made-up id gives the same 404. Binding to another Project Workflow or a Library Workflow is 404 for the Project Admin too.

### VIS-27 Draft Workflows and exception bindings are not public

- **Key:** `RP-822` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Ali, Yousef, Ahmed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Saeed saves a draft of a Tower Workflow and a draft renaming a running Workflow.
  2. Bind Beta Build MARs to an exception Workflow (WF-08).
  3. Ali, Yousef and Ahmed open Settings > Workflows and the API.
- **Expected result:** Nobody but the Project Admin reads a draft; the rename stays hidden until published; everyone reads published Versions whole. TMC and DCL read the exception Workflow as a definition but never its binding; only Yousef and the Project Admin learn which Participant it binds.

### VIS-28 A Company's Library is private until used on a Project

- **Key:** `RP-825` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (TMC Authorized Person); Layla (DCL); Hafiz; a Company on no shared Project
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. TMC saves a Workflow and a Form to its Library and marks a default.
  2. Layla and Hafiz open Library and Settings.
  3. Use it on Tower.
- **Expected result:** DCL sees only its own Library; Hafiz lists TMC published Library Workflows read-only; nobody browses another Company Library; a Form appears to others only once used on Tower, and can then be copied; Library Workflow URLs of TMC are 404 to DCL.

### VIS-29 Change Notes and running counts never leak

- **Key:** `RP-828` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Hafiz; Yousef
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Publish with a Change Note naming Beta Build on an exception Workflow.
  2. Hafiz and Yousef each raise a Draft.
  3. Reopen the publish dialog and Versions.
- **Expected result:** The Change Note naming a Participant on an exception is refused; N items keep their Version counts only the items the reader sees; only authors read Change Notes.

### VIS-30 Another Project or a non-admin cannot read or change Tower setup

- **Key:** `RP-832` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM, not Project Admin); Layla (DCL Authorized Person); Nasser (Project Admin of JCV)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Each opens Tower Settings: Scopes add, rename, deactivate; numbering counters; Workflow settings; Visibility.
  2. Saeed (Project Admin) does the same.
- **Expected result:** Ali, Layla and Nasser get the plain 404 for every change and for the numbering counters; the Scope is unchanged. Saeed can do them. Every Project Member reads Tower Trades, Scopes, Locations and published Workflows.

### VIS-31 A Participant never sees the list of other Participants

- **Key:** `RP-834` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC, not Project Admin); Ahmed (DCL); Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz and Ahmed open Company Projects and the Project Participants page.
  2. Saeed opens the Participants.
  3. Open Settings > Numbering as Hafiz and as Ahmed.
- **Expected result:** Hafiz sees TMC own Participant, its role, its Project Members and the Host Company name; Ahmed sees DCL own Participant with Host Company TMC; neither lists the others. Saeed sees every Participant. Numbering shows each their own Participant with No code yet and no order number; Project Admin sees all orders.

### VIS-32 Pending invitations: one answer whatever the CR number

- **Key:** `RP-837` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Layla (DCL Authorized Person); Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On a UAT Project invite a CR on Rabaed (DCL, 9999000003) and a made-up CR 9999000099.
  2. Hafiz looks for DCL anywhere.
  3. Layla opens Company Projects.
  4. Saeed withdraws both invitations.
- **Expected result:** Both invitations show on Saeed list by CR number only and read the same; Hafiz sees DCL nowhere; Layla sees only the invitation (Project name, Host Company, offered role); after the withdrawals both leave Saeed list in exactly the same way and DCL list too; nothing shows which CR number was on Rabaed.

### VIS-33 Member Visibility pages belong to their own Company

- **Key:** `RP-840` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC); Saeed (Project Admin); Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz opens DCL Participant page and Ahmed Visibility page by URL.
  2. Saeed does the same.
  3. Layla, not yet a Project Member, opens her Participant page.
- **Expected result:** Hafiz and Saeed get the 404 for DCL Member Visibility; Saeed does see DCL Participant grant. Layla sees only the Trades and Locations DCL covers (with the Locations above, such as Tower 1 > Floor 02) and the Scopes under those Trades, and nothing else of the Project.

### VIS-34 Narrowing has limits and Handover tells only counts across Companies

- **Key:** `RP-843` · **Part:** VIS · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person); Saeed (Project Admin); Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Layla gives Ahmed a Trade DCL does not have.
  2. Mohammed holds an Electrical MAR at DCL review; Saeed narrows DCL off Electrical.
  3. Saeed narrows DCL Locations from all to Tower 1 only, then widens DCL back to all.
- **Expected result:** 1) Rejected: a Member never covers more than the Participant. 2) Refused with only 1 Step of DCL needs a new holder first. Ask DCL to hand them over; never the Step, item or Member; nothing changes. 3) After narrowing, DCL engineers cover Tower 1 only; widening the Participant again does not widen them.

### VIS-35 Visibility Gap warnings show only what the viewer is entitled to

- **Key:** `RP-846` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. DCL covers Mechanical but no DCL Member is granted it.
  2. Saeed opens Settings > Visibility.
  3. Layla opens her warnings.
- **Expected result:** Saeed sees no gap and nothing of how DCL splits coverage; Layla is warned that no DCL Project Member covers Mechanical. Other Participants Members never count towards it.

### VIS-36 A refused Submit gives one answer for every reason

- **Key:** `RP-849` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Submit an Electrical MAR when (a) no Consultant covers Electrical, (b) two Consultants cover it, (c) the covering Consultant has nobody with the Position. Set each up in Settings > Visibility and Positions.
- **Expected result:** Submit is not offered and taking it gives the same answer in all three cases: This cannot be handed over yet: the next step has nobody to take it. Ask a Project Admin. Nothing names a Consultant or says which case it is.

### VIS-37 Documents and photos follow the item's visibility

- **Key:** `RP-854` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Hafiz (TMC). Must NOT see: Yousef (Beta Build), Ahmed (DCL, before the Submit), a TMC Member off the Project
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz attaches a datasheet and a geotagged photo to a Draft MAR.
  2. Each other person requests the Documents list, a download URL and tries to upload or remove, by the item page and by the API.
  3. Ali Submits.
  4. Ahmed and Yousef again.
- **Expected result:** Before the Submit Yousef, Ahmed and the off-Project Member get the 404 (same as a made-up id) naming nothing. After it Ahmed sees and downloads the Documents and photo with time and place, and TMC as the uploader Company, not the engineer; Yousef still gets 404 for the list and the URLs.

### VIS-38 After the Submit only the Step holder changes anything

- **Key:** `RP-855` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM); Hafiz; Ahmed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With the MAR at Consultant review, Hafiz and Ali try to save an answer, add a Document and edit a Link.
  2. Ahmed tries to change an answer.
- **Expected result:** All refused: after the Submit the Form is the raiser own and read-only to everyone but the raiser at a Step that lets it edit; the Consultant answers only in its reply Screen.

### VIS-39 Document Numbers and numbering counters do not reveal a rival volume

- **Key:** `RP-858` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC); Yousef (Beta Build); Ahmed (DCL); Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz and Yousef each raise and number three MARs.
  2. Compare their numbers.
  3. Saeed saves a pattern without the Participant Code.
  4. Hafiz, Yousef and Ahmed open Settings > Numbering and the counter URLs.
- **Expected result:** TMC numbers run 0001, 0002, 0003 with no gaps from Beta Build. The shared-counter pattern is refused until Saeed accepts the warning; then both share one count. Hafiz, Yousef and Ahmed see examples built from their own Participant with sequence 1 and a 404 for counters. Version history names the saver Company only to its own Members and the Project Admin; others read A Project Admin.

### VIS-40 A Code D replacement is invisible while it is a Draft

- **Key:** `RP-861` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Hafiz (TMC). Must NOT see: Mohammed (DCL), Faisal, UAT Owner PM
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed rejects a MAR with Code D.
  2. Hafiz creates the replacement and keeps it Draft.
  3. The others read the rejected MAR Links, Linked from, History and search.
  4. Hafiz sends and Ali Submits it.
- **Expected result:** While it is a Draft nobody else reads anything of it and the rejected MAR Links and Linked from do not name it; it takes a new Document Number at its first send (no Rev). Once Submitted it appears in the rejected MAR Linked from by number and Subject and lists the rejected MAR under Links.

### VIS-41 The Handover list shows only the Authorized Person's own Company

- **Key:** `RP-865` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Saeed (TMC Authorized Person, not a Project Member in the seed); Omar (TMC); Layla (DCL Authorized Person); Hafiz, Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz holds two Tower 2 MARs at Contractor Engineer; Mohammed holds one at DCL review.
  2. Saeed deactivates Hafiz and reads the Handover list.
  3. Saeed picks Omar.
  4. Saeed tries to deactivate Mohammed.
  5. Layla deactivates Mohammed.
- **Expected result:** Saeed lists only TMC Steps and Members. As he sees none of these items, each is listed as An item at <Step> on <Project>, with no Subject, Document Number or item id. Omar is the candidate; after the pick Omar sees and edits both. Deactivating Mohammed is 404 for Saeed, and no pick names another Company Step. For Layla the refusal (Mohammed is the only Manager) names only DCL own Step and the Project.

### VIS-42 Home sums only per-Project reads the Member already has

- **Key:** `RP-868` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build); Hafiz, Ali (TMC); Mohammed (DCL); Faisal (Al Waha)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With TMC items in every state (Draft, internal review, Submitted to DCL and OR, Sent Back, Code A, Code C Rev 1) open Home as each.
  2. Compare each figure with that Member List and the Projects page.
- **Expected result:** Yousef: Need My Action 0, 4+ weeks 0, no row or activity of TMC (TMC only as Host Company on the card). Hafiz Draft never counts or lists. Waiting with others counts TMC own items others hold (not Drafts, closed or Sent Back); DCL and OR count 0. Each Project card count equals that Member List count.

### VIS-43 Export, Download and Duplicate respect the viewer

- **Key:** `RP-872` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Hafiz, Ali (TMC); Mohammed (DCL); Yousef (Beta Build); a signed-in stranger
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With Drafts, a Submitted item picked up by Mohammed and a closed Code C item, Hafiz and Mohammed Export the List (also with a search).
  2. Ali and Mohammed Download.
  3. Mohammed tries Duplicate.
  4. Yousef and the stranger try Download and Duplicate by id.
- **Expected result:** Each export holds exactly that viewer rows and fields (Creation Date for TMC only; the owner is Mohammed to DCL and DCL by name to TMC); Download gives the same shared content to both; Duplicate is refused for Mohammed (one word for every reason) and 404 for Yousef and the stranger.

### VIS-44 Members page counts only the viewer own Company Projects

- **Key:** `RP-875` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Authorized Person); Hafiz (plain Member); Layla
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Saeed opens Members.
  2. Hafiz opens it.
  3. Layla opens hers.
- **Expected result:** The Projects column counts each own Member active Projects (the same for Saeed and Hafiz, who read nothing but the count); never DCL people or Projects; DCL list holds DCL people only.

### VIS-45 The Approved Supplier List is Project-wide but hides its source

- **Key:** `RP-878` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build); Ahmed (DCL); Layla (DCL Authorized Person); Saeed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After a SAR closes at A (SUB-20), Yousef and Ahmed read the list and raise a MAR choosing the supplier.
  2. Look for the SAR, its Links, who added it, when.
  3. Layla and Nasser try to add, withdraw or read Tower list.
- **Expected result:** Every Project Member reads name, Trade, Scope and status (a withdrawn one as withdrawn); never the SAR, its person, its time or its source; Yousef MAR answer reads the supplier name; Layla and Nasser (not Project Admins or not on Tower) get 404 and nothing changes.

### VIS-46 Inspections shown inside Submittals reveal nothing extra

- **Key:** `RP-881` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz, Ahmed (see the WIR); Yousef (Beta Build, other Trade or Location)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Saeed turns Inside the Submittals tab on (PAR-11).
  2. A Submitted TMC WIR exists.
  3. Each reads the Submittals List, counts, type filter, search, Kanban, Need My Action, Projects page count and the WIR URL.
- **Expected result:** Hafiz and Ahmed see the WIR in all of them; Yousef sees it in none and gets 404 by id. The setting widens where own rows show, never which rows.

### VIS-47 Required links and Approved submittals reveal only definitions

- **Key:** `RP-884` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Hafiz; Ahmed; Nasser (JCV)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Saeed turns Approved submittals required on for Tower.
  2. Nasser does the same on JCV.
  3. Everyone reads Tower setting and tries to change it.
  4. As Ahmed (Mechanical inspector) open a Tower WIR with a Link to an Electrical Code A MAR he cannot see.
- **Expected result:** Every Tower Member reads which links are required, never JCV; nobody reads who set it or when; only Saeed changes it, others get 404. Ahmed (not covering the MAR Location) sees its Document Number and Subject only and cannot open it; the Project Admin gets its id.

### VIS-48 An annotated photo has exactly the readers of its original

- **Key:** `RP-887` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC); Ahmed (DCL); Yousef (Beta Build)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz annotates a photo on a MAR and Saves.
  2. Ali Submits.
  3. Ahmed lists and downloads both; Yousef requests the list, both URLs and an annotate call.
- **Expected result:** TMC and DCL list and download both copies, the annotated linked to the original whose bytes are unchanged; Yousef gets 404 for everything, as for a made-up id; the file store refuses either file without a signed URL.

### VIS-49 A WIR Recommended Result or Code stays inside the Consultant

- **Key:** `RP-890` · **Part:** VIS · **Round:** 4
- **Sign in as:** Ahmed, Mohammed (DCL); Hafiz, Ali (TMC); Faisal; Yousef
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ahmed sends a WIR to Mohammed recommending Failed (later: Code C) with an Internal Note; Mohammed Returns it; Ahmed sends it again; Mohammed issues the Code.
  2. TMC and OR read history, feed, events.
- **Expected result:** DCL reads the Recommended Code and Internal Note; TMC and OR read none of it before or after the issued Code, only the Code and the Manager shared reply; Yousef reads nothing of the WIR.

### VIS-50 A Snag raised on one Contractor is invisible to the other

- **Key:** `RP-893` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Mohammed (DCL); Ali (TMC); Yousef (Beta Build, Tower 2 only after FX-C2)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed raises a Snag (Electrical, Tower 1, photos) and TMC moves it In Progress.
  2. Yousef opens the Snag List, its counts, Kanban and filters (Company, Raised from, Comment Type), the Snag by id, history, Links and Documents.
- **Expected result:** Yousef sees the Snag nowhere and the filters offer only his own Company; Raised from offers nothing; a Comment raised from a source Yousef cannot see is not named by number. By id everything is 404.

### VIS-51 Snag Steps are shared only as Transitions

- **Key:** `RP-905` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC); Mohammed (DCL)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. TMC moves the Snag Start work and Resolve with a note.
  2. Mohammed reads the history.
  3. Mohammed holds Verify.
- **Expected result:** Mohammed reads TMC Resolve and its note, never Start work, internal moves or who picked it up; TMC reads DCL Raise, never its Draft or who holds Verify.

### VIS-52 A Snag stays with the Contractor that holds it

- **Key:** `RP-907` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC); Yousef (Beta Build); Mohammed (DCL)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed raises a Snag on Tower 1.
  2. Saeed widens Beta Build to cover Tower 1 too.
  3. TMC resolves it; Mohammed Returns it to Open.
- **Expected result:** Every move including the Return stays with TMC; Yousef never sees the Snag by id or in the Snag List; a new Raise on a Location both cover is refused.

### VIS-53 A Snag a Contractor raises on itself is invisible to the others

- **Key:** `RP-908` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC); Mohammed (DCL); Yousef
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali raises a Snag on TMC itself and takes it to Closed.
  2. Mohammed and Yousef look in the Snag List and by id at every Step.
- **Expected result:** Neither sees it at any Step from Draft to Closed; not by id, history or Workflow map; no count changes.

### VIS-54 Raised-from counts include only items the viewer sees

- **Key:** `RP-909` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM); an Electrical-only TMC engineer; Yousef
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed raises a Snag on Tower 1 and two Snags are linked raised from it, one Electrical and one Mechanical.
  2. Each reads the source Snags line.
  3. Mohammed raises a Snag at a Location only Yousef covers.
- **Expected result:** The PM counts 2 open; the Electrical-only engineer sees the Mechanical Snag nowhere and counts 1; a discarded Draft is never counted; Yousef counts only Snags he sees.

### VIS-55 Checklist Templates are Project definitions; copies follow the WIR

- **Key:** `RP-910` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Hafiz; Ahmed; Yousef; Nasser
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Saeed creates and edits a Checklist Template; Nasser keeps one on JCV.
  2. Everyone reads Tower templates and tries to change them.
  3. Hafiz picks a Checklist Template on a WIR; Saeed edits it; Hafiz Submits.
- **Expected result:** Every Tower Member reads Tower templates, nobody reads who wrote or retired them or when, and never JCV; only Saeed changes them; the WIR copy is read by TMC only until the Submit, then by DCL, still Version 1 items; Yousef reads no row.

### VIS-56 A Register Import is its Company's alone

- **Key:** `RP-911` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz, Ali (TMC); Yousef, Nasser (Beta Build); Ahmed, Mohammed (DCL); Faisal
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz uploads and previews a register.
  2. Ali tries to read the preview.
  3. Hafiz confirms.
  4. Everyone opens the Imports page and the import by id.
- **Expected result:** Before confirm only Hafiz reads the preview. After it every TMC Member reads the import, its file name, mapping and rows; Beta Build, DCL and Al Waha see an empty Imports page and the 404 for the import and its confirm; none of its Drafts; no import time anywhere.

### VIS-57 The Activity Feed names other Companies only by name

- **Key:** `RP-912` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build); Ahmed, Mohammed (DCL); Ali (TMC)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After a Submit, a Pick up, an internal Send to Manager, a Return and a Code, each person opens Project > Activity Feed and Dashboard Recent activity.
- **Expected result:** Ali sees TMC people and DCL by name only; Ahmed sees DCL people and TMC by name only; nobody sees the other Company internal events, Internal Notes, Recommended Codes, answers_changed or Document uploads; Yousef sees only Beta Build items. No setup changes appear.

### VIS-58 Direct URLs and ids give the same 404 page, never a 403

- **Key:** `RP-913` · **Part:** VIS · **Round:** 0
- **Sign in as:** Nasser (JCV); Yousef; Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Nasser opens a Tower Project, Submittals list and item URL; then a made-up id for each.
  2. Yousef opens a TMC item id and a TMC Comment id.
  3. Compare status, page and wording.
  4. Make the web app and API calls for the same.
- **Expected result:** The pages are identical for existing-hidden and made-up (one heading, We can not find this page, a Projects button); the API answers byte-identical 404s; nothing says whether the item exists. IDs are random and cannot be guessed.

### VIS-59 Errors and refusals never name another item or Company

- **Key:** `RP-914` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build); Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Yousef submits a link to a TMC id, picks a hidden Member id through the API, opens a Link page by a TMC Link id, and saves a Form with a hidden reference.
  2. Read every error text and API body.
- **Expected result:** All refusals are the plain, uniform answer; no title, number or Company of another item appears in an error, toast or log shown to the Member.

### VIS-60 Rabaed Default Workflows are readable by all and name no Company

- **Key:** `RP-915` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz; Nasser
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Both open the list of Rabaed Default Workflows for a submittal Type.
- **Expected result:** Both read the same eight Workflows with names and Versions and the one the Type runs marked; they name no Project, Company or item; a Project binding reaches that Project only.

### VIS-62 Files Module and Pins on shared Drawings

- **Key:** `RP-917` · **Part:** VIS
- **Sign in as:** Mohammed; Yousef
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Files; open a shared floor plan with Pins.
- **Expected result:** Work Item folders only for visible items; Pins only of visible items. Not built yet.

### VIS-63 Removed Members, withdrawn Participants and closed Projects

- **Key:** `RP-918` · **Part:** VIS
- **Sign in as:** Removed engineer; Layla; Any Member
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Remove a signing engineer from the Project.
  2. Withdraw DCL.
  3. Close the Project.
- **Expected result:** E2: the removed Member keeps the Project name and the records they signed; DCL Authorized Person sees only the records DCL Members signed; open items of a withdrawn Participant are Cancelled; a closed Project is read-only with E2 records available.

### VIS-64 Another Project is invisible both ways

- **Key:** `RP-919` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC); a Member of another seeded Project
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. As Hafiz note an item id of Riyadh Gate Tower.
  2. Sign in as a Member who is not on that Project (or Hafiz on a Project he is not on): open Projects, Home, search, the item URL and the Project URL.
- **Expected result:** Neither sees the other Project in Projects, Home counts, search or notifications; both URLs give the one not-found page (404, never 403). Carried over from RP-463 A-11 (RP-474).

## Cases the UAT owner runs (32 cases)

The UAT owner runs these: they need the owner's machine, Rabaed Admin or a mailbox you can't read.

### SUB-29 No due dates, deadlines or SLAs anywhere

- **Key:** `RP-761` · **Part:** SUB · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Hafiz; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Visit Home, Projects, Dashboard, List, Kanban, item page and the emails in the mailbox, in EN and AR.
  2. Search the page text for due, deadline, SLA, late and every other term GLOSSARY.md lists under Avoid for Step Age (and the Arabic equivalents).
- **Expected result:** Only Step Age dots (1 to 4+ weeks) show age. No due date, deadline or SLA appears. The List and Kanban headers use the GLOSSARY words: Stage not Status, Trade not Discipline, With not Current owner.

### WF-15 Step Age dots count from the current Step

- **Key:** `RP-808` · **Part:** WF · **Round:** 0 · **Needs:** setup, owner
- **Sign in as:** Ali; Mohammed
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Precondition: ask the lane engineer to age two items (fixture AGE) by 1 and by 4 weeks.
  2. Read the dots in the List, Kanban and item page for Ali and for Mohammed.
- **Expected result:** Dots show 1 to 4+ weeks (4+ all red). For the holder's Company they count from the current Step; the other Company counts from when the item reached it. A Draft shows none. No due date appears.

### PAR-01 Sign in, wrong password and sign out

- **Key:** `RP-845` · **Part:** PAR · **Round:** 0 · **Needs:** owner
- **Sign in as:** Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open lane 7 /en/sign-in.
  2. Wrong password.
  3. Right password (in .env.demo).
  4. Sign out.
  5. Open a Project URL while signed out.
- **Expected result:** The wrong password gives one generic refusal. Sign-in opens Home. After sign-out a Project URL goes to sign-in. Cookies are per host (lane7.localhost).

### PAR-02 Invite a Member and accept the invitation

- **Key:** `RP-848` · **Part:** PAR · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Saeed (Authorized Person); a new person
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Members > Invite: a made-up .test email, name EN and AR, language.
  2. Open the email in the mailbox and follow the link.
  3. Set a password.
- **Expected result:** The Member appears as invited, then active. The email arrives in the mailbox in the chosen language. The new Member belongs to TMC alone.

### PKG-10 One grouped notification counts only what the reader sees

- **Key:** `RP-693` · **Part:** PKG · **Round:** 1 · **Needs:** mail, owner
- **Sign in as:** Ahmed (DCL engineer); Sara (Mechanical-only)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali Submits a Package of five Electrical and three Mechanical items.
  2. Read each engineer's bell and email in the mailbox.
- **Expected result:** One notification per recipient: TMC Constructions Submitted PKG-nnn Name: n submittals, where n counts only what that person sees.

### SIG-06 The record is sealed and a changed copy shows

- **Key:** `RP-715` · **Part:** SIG · **Round:** 0 · **Needs:** owner
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the PDF in Adobe Reader.
  2. Change one byte of a copy and reopen.
- **Expected result:** The original shows a seal that is present and intact; the signer is shown as unverified (lane 7 seals locally, RECORD_SEALING=local; Rabaed has no trusted certificate yet, ADR 0023). The changed copy shows the seal broken.

### SIG-14 Record checks catch a bad PDF

- **Key:** `RP-744` · **Part:** SIG · **Round:** 2 · **Needs:** owner
- **Sign in as:** Engineer (Rabaed)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ask a lane engineer to feed a broken record.
- **Expected result:** A failed check alerts in Rabaed Admin instead of publishing; the item is not reopened.

### IMP-12 A Rabaed Engineer imports for a Company

- **Key:** `RP-869` · **Part:** IMP · **Round:** 5 · **Needs:** owner
- **Sign in as:** Engineer (Rabaed Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Rabaed Admin pick the Project, the Participant, a default Member and a reason; run the import.
  2. Hafiz opens the import.
- **Expected result:** The Drafts are raised by the default Member; TMC's Members read Rabaed as who imported, never the Engineer's name; the reason is kept and the action logged.

### NOT-03 Immediate email via the mailbox

- **Key:** `RP-876` · **Part:** NOT · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the mailbox.
  2. Find the email for Step reached.
- **Expected result:** Subject holds only the Document Number, Subject and what happened; body names the other Company by name only; links open the item; sent as the recipient may see it.

### NOT-04 Email settings per group, Pause all, language

- **Key:** `RP-879` · **Part:** NOT · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Profile & notification settings: set Step reached to Off, then Daily digest, then Immediately.
  2. Pause all email.
  3. Change the email language.
- **Expected result:** Groups are Step reached me or my pool, Items I watch, Sent Back to my Participant, Weekly Step Age report; choices Off, Immediately, Daily digest. Paused email stops every email but the bell still fills. The weekly group is emailed on Sunday mornings.

### NOT-05 Mute a Project

- **Key:** `RP-882` · **Part:** NOT · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mute Riyadh Gate Tower in the settings.
  2. Hafiz sends a MAR to Ali.
  3. Check bell and the mailbox.
- **Expected result:** A muted Project sends no notifications or emails; the item still shows as Ali's under Need My Action.

### NOT-06 Daily email digest

- **Key:** `RP-886` · **Part:** NOT · **Round:** 0 · **Needs:** mail, job, owner
- **Sign in as:** Ali (TMC PM); Yousef
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Set an email group to Daily digest.
  2. Create events; ask the lane engineer to run the digest job (open question OQ-2).
  3. Read the mailbox.
- **Expected result:** One email per Member: subject names nothing; each entry names another Company only by name; an entry the Member can no longer see is left out; Yousef gets nothing of TMC's. Sent 07:00 Riyadh, Sunday to Thursday.

### NOT-07 Weekly Step Age report

- **Key:** `RP-888` · **Part:** NOT · **Round:** 0 · **Needs:** mail, job, setup, owner
- **Sign in as:** Ali (TMC PM holding Assign); Yousef
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Setup first: give the tester's Position (Ahmed's on the Vercel UAT, Ali's on lane 7) Assign on Submittals. No demo Position holds Assign, so the report has no recipients until one does (RP-922). The report covers Submittals only, not WIRs.
  2. Needs aged items (AGE fixture; the demo has only TWR-MAR-01-0002 and TWR-MAR-01-0003 Rev 1 open and numbered) and the lane engineer to run the job (OQ-2).
  3. Read Ali and Yousef mail and open the link.
- **Expected result:** Grouped 4+, 3, 2 and 1 weeks; lists only items the reader can open, never an un-numbered Draft; another Company by name only; Yousef lists only Beta Build items; an empty report is not sent; the link opens the List with the same filter.

### NOT-10 Emails and the bell follow the Member's language

- **Key:** `RP-896` · **Part:** NOT · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Faisal (Al Waha, Arabic)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Receive a notification and email as Faisal.
- **Expected result:** The bell and email are in Arabic with Latin digits; Document Numbers read left to right.

### NOT-11 A closed Project goes quiet

- **Key:** `RP-900` · **Part:** NOT · **Needs:** mail, owner
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Close the Project.
- **Expected result:** No bell entry or email of a closed Project; delivered ones stay readable. There is no close control yet.

### I18N-02 Latin digits everywhere

- **Key:** `RP-903` · **Part:** I18N · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Faisal (Arabic)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In /ar read counts, dates, times, Step Age, Dashboard figures, emails and the PDF.
- **Expected result:** Only Latin digits (0 to 9) appear; no Arabic-Indic digits. Dates are Gregorian; times Riyadh.

### ADM-01 Sign in to Rabaed Admin with a password and an emailed code

- **Key:** `RP-698` · **Part:** ADM · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Engineer (Rabaed Engineer)
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Open Rabaed Admin (lane 7, port 4750) on its own address.
  2. Enter email and password.
  3. Read the 6-digit code from the mailbox.
  4. Enter a wrong code, then the right one.
- **Expected result:** A code is sent to the Engineer's email; a wrong code is refused; too many codes get a limit message; sign-in succeeds with the right code and a session cookie that is not the Company app's. Credentials of a Member of the Company app do not work here.

### ADM-02 Onboard a Company (fixture UAT Owner Co)

- **Key:** `RP-701` · **Part:** ADM · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Engineer (Rabaed Engineer)
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Onboard a Company: legal names EN and AR, CR 9999000005, VAT 399990000000053, Authorized Person Reem UAT (a made-up .test email), language, a reason.
  2. Open the invitation in the mailbox and accept as Reem.
- **Expected result:** The Company and its Authorized Person are created and an invitation emailed; the action is logged with the reason; Reem signs in to the Company app. Needed for PAR-16.

### ADM-03 Duplicate CR, VAT or email is refused

- **Key:** `RP-703` · **Part:** ADM · **Round:** 0 · **Needs:** owner
- **Sign in as:** Engineer (Rabaed Engineer)
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Onboard again with CR 9999000001.
  2. Then a new CR with an existing email.
- **Expected result:** Each conflict is refused naming what clashes (CR number, VAT number or email) and creates nothing.

### ADM-04 Onboarding leads and closing a lead

- **Key:** `RP-706` · **Part:** ADM · **Round:** 0 · **Needs:** owner
- **Sign in as:** Engineer; Saeed
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Saeed (Project Admin) invites a CR number not on Rabaed (PAR-06 variant).
  2. Engineer: Show leads (reason), then Close lead (reason).
- **Expected result:** The CR shows as a lead with Project, Host Company, requested and state. Closing it takes it off the Engineer's list only; Saeed still sees his invitation pending. Both kinds of CR give Saeed the same answer.

### ADM-05 Option Lists need a reason and never delete

- **Key:** `RP-708` · **Part:** ADM · **Round:** 0 · **Needs:** owner
- **Sign in as:** Engineer (Rabaed Engineer)
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Create an Option List with three levels.
  2. Edit, retire an option (reason each time).
- **Expected result:** Every edit needs a reason; a retired option stops being offered but stays where it was chosen.

### ADM-06 Numbering for a Project from Admin

- **Key:** `RP-710` · **Part:** ADM · **Round:** 0 · **Needs:** owner
- **Sign in as:** Engineer (Rabaed Engineer)
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Numbering: enter a Project id and reason, show it.
  2. Set a pattern, a Participant Code and a starting number.
- **Expected result:** The same rules as the Project Admin's; every read and edit needs a reason; Participant Code 2 to 6 letters or digits, fixed once used.

### ADM-07 Rabaed Default Workflows: save, publish, outcomes and Stages

- **Key:** `RP-722` · **Part:** ADM · **Round:** 0 · **Needs:** owner
- **Sign in as:** Engineer (Rabaed Engineer)
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Workflows: open MAR; Save draft; Publish with a reason.
  2. Add an outcome and a Stage, rename and reorder them.
- **Expected result:** The builder is the same as in Project Settings; every change is refused without a reason and logged. A new Version reaches only new items; an added outcome or Stage reaches only Projects created afterwards. No Member can open a Rabaed Default draft.

### ADM-08 Publish is refused while Projects lack an outcome

- **Key:** `RP-725` · **Part:** ADM · **Round:** 0 · **Needs:** owner
- **Sign in as:** Engineer (Rabaed Engineer)
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Add an outcome to a Type's set; publish a Rabaed Default Version that uses it while the seeded Project lacks it.
- **Expected result:** Refused with how many Projects and which outcomes or Stages, never which Projects or Companies; nothing publishes; the refusal is logged.

### ADM-09 Admin is separate from the Company app

- **Key:** `RP-726` · **Part:** ADM · **Round:** 0 · **Needs:** owner
- **Sign in as:** Engineer; Hafiz
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Open an Admin URL on the web port and a web URL on the Admin port.
  2. Sign out of one.
- **Expected result:** Different addresses and cookies; the Company app never serves Admin pages.

### ADM-10 An Engineer fixes a stuck Step

- **Key:** `RP-729` · **Part:** ADM · **Needs:** owner
- **Sign in as:** Engineer (Rabaed Engineer)
- **Start at:** https://rabaed-uat-admin.vercel.app
- **Steps:**
  1. Open a MAR in Admin; reassign or reset the Step with a reason.
- **Expected result:** The read and the action are logged with the reason; the Engineer never takes a Transition or changes a Workflow version.

### UX-11 Sign-in, wrong password and accepting an invitation

- **Key:** `RP-933` · **Part:** UX · **Round:** 0 · **Needs:** mail, setup, owner
- **Sign in as:** A new invitee (fixture from PAR-02); Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open sign-in EN and AR at 1366 and 375.
  2. Wrong password, then right.
  3. Open an invitation link and accept.
- **Expected result:** Laid out as design/prompts/sign-in.md: one error for a wrong email or password, clear invitation steps, Arabic-first users land in Arabic.

### VIS-16 Creation Date, Submission Date and saved times stay inside TMC

- **Key:** `RP-788` · **Part:** VIS · **Round:** 0 · **Needs:** setup, owner
- **Sign in as:** Actors: Hafiz, Ali (TMC). Observers: Ahmed, Mohammed (DCL)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz saves a Draft, sends it, Ali Submits.
  2. Compare the item page and List for TMC and for DCL; look at the ids in the address bar and in links.
  3. Check the order of un-numbered Drafts.
  4. Needs AGE for the date checks.
- **Expected result:** TMC sees Creation Date (when it got its number) and Submission Date; DCL sees only the Submission Date and no Creation Date in any form. Ids carry no time. Un-numbered Drafts come last, ordered by Subject. Answer times and Saved read the Creation Date or later; a Revision follows its own Creation Date. The stored earlier times are covered by the automated suite.

### VIS-17 Step Age and With are counted per Company

- **Key:** `RP-792` · **Part:** VIS · **Round:** 0 · **Needs:** setup, owner
- **Sign in as:** Actors: Ali (TMC); Ahmed, Mohammed (DCL)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali Submits.
  2. Ahmed picks it up, sends to Manager, Mohammed Returns it to Ahmed.
  3. Ali reads With, the Stage, Step Age and the workflow drawer.
  4. Needs AGE: age the item 5 weeks inside TMC, then Submit.
- **Expected result:** Ali sees With Design Consultants LLC and Step Age counted from the Submit, no reset, no internal move. DCL Step Age runs from when the item reached DCL (week 1), not the five weeks inside TMC; four weeks later it counts for DCL. No Step or person of the other Company appears.

### VIS-21 Watch is private and ends when the viewer loses sight

- **Key:** `RP-799` · **Part:** VIS · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Ali (TMC); Ahmed (DCL); Faisal (Al Waha)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ali, Ahmed and Faisal watch a MAR.
  2. Read each page for any list or count of watchers.
  3. Hind narrows Faisal off the MAR Trade.
  4. Mohammed issues Code A.
- **Expected result:** Each sees only their own Watching; no list or count of watchers. After narrowing Faisal gets no notification, in-app or email, of the Code.

### VIS-22 Notifications and emails reach only Members who see the item

- **Key:** `RP-801` · **Part:** VIS · **Round:** 0 · **Needs:** mail, owner
- **Sign in as:** Actors: Mohammed (DCL). Must see: Hafiz (TMC raiser). Must NOT receive: Yousef (Beta Build), Sara (Mechanical-only)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed issues Code B on a TMC MAR.
  2. Open the mailbox: the mail to Hafiz.
  3. Look for any mail or bell entry for Yousef and for Sara.
- **Expected result:** The subject of Hafiz's mail holds the Document Number, Subject and Code B only; Design Consultants is named as a Company and the final signer as the one person; no DCL internal step or Recommended Code. Yousef and Sara get nothing, in-app or email.

### VIS-61 Derived values hide what the column hides

- **Key:** `RP-916` · **Part:** VIS · **Round:** 0 · **Needs:** setup, owner
- **Sign in as:** Yousef; Ahmed; Ali
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Filter, sort and page the List by Step Age and by Created date as Ahmed and Yousef while TMC has a long-lived Draft and aged items.
  2. Inspect the item detail and exports.
- **Expected result:** No filter, sort key, cursor or detail field reveals when TMC Draft was started or how long TMC worked on an item; Draft shows no Step Age to anyone.

## Results to hand back (JSON)

One file. `entries` has one entry per case you ran, keyed by the case's key (`RP-nnn`):

- `status`: `pass`, `fail`, `blocked` or `notrun`.
- `comment`: what you saw.
- `shots`: the ids of its screenshots in the `shots` list, or `[]`.

Each screenshot in `shots` gives its `data` as base64 PNG or JPEG bytes. Leave `shots` empty if you send the pictures separately, named `<case ID>-<n>.png`.

```json
{
  "sheet": "rabaed-uat-sheet",
  "round": "System UAT with Ahmed",
  "tester": "<your name>",
  "at": "<ISO date and time, e.g. 2026-11-02T10:30:00Z>",
  "entries": {
    "RP-685": {
      "status": "pass",
      "comment": "Saved as a Draft, listed with No number yet.",
      "shots": []
    },
    "RP-686": {
      "status": "fail",
      "comment": "What you saw, against the expected result.",
      "shots": [
        "RP-686:1"
      ]
    }
  },
  "shots": [
    {
      "id": "RP-686:1",
      "key": "RP-686",
      "name": "SUB-02-1.png",
      "type": "image/png",
      "w": 1366,
      "h": 768,
      "data": "<the PNG's bytes in base64, or leave shots empty>"
    }
  ]
}
```

