# Rabaed UAT test sheet: System UAT with Ahmed

Built 2026-11-07. 262 Test Cases. The UAT: https://rabaed-uat-web.vercel.app/en (English) and https://rabaed-uat-web.vercel.app/ar (Arabic).

## How to use this file

1. Open the UAT and sign in as the person each case names under **Sign in as** (see Who's who). The owner gives you each sign-in; this file holds no passwords. Use one private browser window per person, so each sees only their own Company's work.
   A section named Sign in as … · open UAT nn is one person's: sign in as that person and open that Project. Every UAT Project has the same people, so Home and Notifications mix them all: open it from Projects, not from Home, and stay in it for the whole section.
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
| Ali Sonour | `ali.sonour@tmc.demo.rabaed.test` | TMC Constructions | Contractor, Electrical, everywhere | Project Manager | EL · all towers | Reviews Hafiz's Drafts and Submits to the Consultant; Packages; the List and Dashboard; gets the weekly Step Age report (RP-1186) |
| Omar Al Harbi | `omar.alharbi@tmc.demo.rabaed.test` | TMC Constructions | Contractor, Electrical, Tower 2 only | Engineer | EL · Tower 2 only | Visibility narrowed to one Location: sees Tower 2 only |
| Yousef Karim | `yousef.karim@betabuild.demo.rabaed.test` | Beta Build | Contractor, Electrical, everywhere | Engineer | EL · all towers | A second Contractor on the same Project: must never see TMC's work; gets the weekly Step Age report, Beta Build's items only (RP-1186) |
| Nasser Al Dosari | `nasser.aldosari@betabuild.demo.rabaed.test` | Beta Build | Beta Build's own Project, Jeddah Corniche Villas | Authorized Person | Beta Build, own Project, not here | Not on Riyadh Gate Tower: must get the not-found page there |
| Ahmed bin Said | `ahmed.binsaid@designconsultants.demo.rabaed.test` | Design Consultants LLC | Consultant, Electrical and Mechanical | Engineer | EL, ME · all towers | Reviews submittals for the Consultant (a demo person, not you) |
| Sara | `sara@designconsultants.demo.rabaed.test` | Design Consultants LLC | Consultant, Mechanical only | Engineer | ME only · all towers | A Consultant engineer narrowed to one Trade: sees Mechanical items only, never the Electrical ones (RP-1207) |
| Mohammed Al Shamsi | `mohammed.alshamsi@designconsultants.demo.rabaed.test` | Design Consultants LLC | Consultant, Electrical and Mechanical | Manager | EL, ME · all towers | Gives the Review Code (A, B, C, D) and signs the Documental Record |
| Layla Mansour | `layla.mansour@designconsultants.demo.rabaed.test` | Design Consultants LLC | Consultant | Authorized Person | Company profile | Design Consultants' Company Profile and Members |
| Faisal Al Otaibi | `faisal.alotaibi@alwaha.demo.rabaed.test` | Al Waha PMC | Owner Representative, Electrical, everywhere | Engineer (uses Arabic) | EL · all towers | The Arabic cases |
| Noura Al Harbi | `noura.alharbi@alwaha.demo.rabaed.test` | Al Waha PMC | Owner Representative | Project Manager (uses Arabic) | EL · all towers | Holds the Owner's review; Arabic cases |
| Hind Al Mutairi | `hind.almutairi@alwaha.demo.rabaed.test` | Al Waha PMC | Owner Representative | Authorized Person | Company profile | Al Waha's Company Profile and Members |
| Rabaed Engineer | `engineer@rabaed.demo.rabaed.test` | Rabaed | Rabaed Admin | Rabaed Engineer | Rabaed Admin, UAT owner only | Rabaed Admin cases (ADM): the UAT owner runs these |

## 1. Sign in as Hafiz · open UAT 01 · Contractor Engineer (Hafiz) (58 cases)

Every case here is run in **UAT 01 · Contractor Engineer (Hafiz)**, as the one person named above: open it from Projects, not from Home.

### SUB-01 A new MAR is saved as a Draft

- **Key:** `RP-685` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals > New Submittal > Material Approval Request.
  2. Subject "UAT SUB-01 Lighting Fixtures", Trade Electrical Works, Location Tower A Level 02, Manufacturer Philips, Approved supplier Qassim Electrical Trading, Description empty.
  3. Save Draft.
- **Expected result:** The Draft is listed in the Drafts Stage with "No number yet" and no Step Age dots. It is Hafiz's to edit.

### SUB-02 Send for Review is refused while the Form is incomplete

- **Key:** `RP-688` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open the Draft "SUB-02 Lighting fixtures – incomplete".
  2. Send for Review with Description and Datasheet (PDF) empty.
- **Expected result:** Refused: the Form lists what is missing ("2 fields need your attention: Description, Datasheet (PDF)") and marks each field. Nothing moves; the item stays a Draft with no number.

### SUB-03 The MAR Form takes Items, totals and Documents

- **Key:** `RP-691` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open the Draft "SUB-03 Panel lights – to fill in". Fill Description, Model "CoreLine Panel", Specification section "26 51 00".
  2. Under Items, Add row twice: "Recessed panel" 200 Pieces and "Surface panel" 40 Pieces.
  3. Save and close, then open the Draft again from the list.
  4. Add a PDF under Datasheet (PDF) and a JPEG with EXIF under Sample photo.
- **Expected result:** The total reads 240. Save and close returns to the Submittals list. The Datasheet and Sample photo can be added once the Draft is saved; the photo shows the time and place from its EXIF. The Attachments and Links System Fields sit below the Form.

### SUB-04 Send for Review numbers the item and Ali holds it at once

- **Key:** `RP-694` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open the Draft "SUB-04 Lighting control panel – ready to send" (complete, with its Datasheet).
  2. Send for Review.
- **Expected result:** The item gets the next number in TMC's MAR sequence (UAT01-MAR-01-0013 if no other case has sent one yet), shown left to right. Ali is TMC's only PM, so it is his at once: "With Ali Sonour - TMC Constructions", no Pick up button. Nothing outside TMC.

### SUB-05 A Return stays in Internal Review

- **Key:** `RP-697` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open UAT01-MAR-01-0001 "SUB-05 Emergency luminaires – returned by Ali". Ali Returned it with the reason "Add the model's test certificate and resend."
- **Expected result:** The item is in the Internal Review Stage at the Contractor Engineer Step, keeps its Document Number UAT01-MAR-01-0001 and is with Hafiz ("With Hafiz Hamdan - TMC Constructions"); it is never a Draft again. Ali's reason is in TMC's history, marked internal. Step Age counts from the Return.

### SUB-06 Documents change until the Submit

- **Key:** `RP-700` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open UAT01-MAR-01-0002, returned to Hafiz.
  2. Remove the Datasheet and add a corrected PDF.
  3. Send for Review again.
- **Expected result:** Hafiz can swap Documents while the item is in TMC: the corrected PDF replaces the old one. After the send the item keeps UAT01-MAR-01-0002 and is with Ali ("With Ali Sonour - TMC Constructions"). Documents freeze at the Submit, not before.

### SUB-14 Code D offers a replacement, not a Revision

- **Key:** `RP-723` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open UAT01-MAR-01-0004, which Mohammed closed at Code D (Rejected) with Remarks.
  2. Choose Create replacement.
- **Expected result:** The item is closed at D. Hafiz is offered Create replacement (no Revision). The replacement is a new Draft with the same Subject, a Replaces Link to UAT01-MAR-01-0004, and gets a new Document Number with no Rev suffix at its first send.

### SUB-15 Create a Revision of a Code C item

- **Key:** `RP-727` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open UAT01-MAR-01-0005, closed at Code C, and Create Revision.
  2. The Draft reads Revision 1, No number yet; change the Model, Save and close.
  3. Open the Revision drop-down.
  4. Send for Review.
- **Expected result:** The Draft starts with TMC's answers and the copied Datasheet. The drop-down lists the original and Revision 1 (no number yet); after the send Revision 1 reads UAT01-MAR-01-0005 Rev 1, whole and left to right, and is with Ali. Choosing the original shows its own answers, Code C, Remarks and history. A Revision uses no counter: the next new MAR still takes the next number.

### SUB-16 Delete discards a Draft only

- **Key:** `RP-730` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: on the Draft "SUB-16 Draft to delete", which never left Draft, row menu > Delete, confirm.
  2. On UAT01-MAR-01-0001, a numbered item, look at its row menu.
- **Expected result:** The confirm says nobody will see the Draft again, Hafiz included, and no number is lost; it leaves the list. A numbered item has no Delete (an issued item is never deleted).

### SUB-17 Duplicate copies only TMC's own work

- **Key:** `RP-732` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: on UAT01-MAR-01-0009, closed at Code A after Mohammed answered it, row menu > Duplicate.
  2. Open the new Draft.
- **Expected result:** A new Draft with the Subject, TMC's own answers and the Documents and photos TMC uploaded, as new files. None of Design Consultants' verification, Remarks or notes. "Duplicated from" shows UAT01-MAR-01-0009 to TMC only.

### SUB-19 Related submittals and free Links open the other item

- **Key:** `RP-737` · **Part:** SUB · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open UAT01-MAR-01-0012 "Emergency lighting control panel – Tower A Level 02".
  2. Links: open UAT01-MAR-01-0009 from Related submittals and from the free Link.
  3. On UAT01-MAR-01-0009 scroll to Linked from.
- **Expected result:** Each Link shows the Document Number (left to right) and Subject and opens the item; a Submitted item cannot be changed. Linked from on UAT01-MAR-01-0009 lists the control panel. Linking notifies nobody.

### WF-16 Cancel from the raiser's Steps, only until the first Submit

- **Key:** `RP-810` · **Part:** WF · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open the Draft "WF-16 Draft to cancel" and Cancel; confirm.
  2. Open UAT01-MAR-01-0003, back with Hafiz at the Contractor Engineer Step, and Cancel; confirm.
  3. Open UAT01-MAR-01-0011, Submitted to Design Consultants, and look for Cancel.
- **Expected result:** Cancel is offered at the Draft and at the Contractor Engineer Step and asks for confirmation; each item goes to the Cancelled Stage with no outcome. Once Submitted (UAT01-MAR-01-0011), Cancel is no longer offered. A Revision never offers Cancel. Carried over from RP-463 B-09 (RP-490).

### FRM-01 The three submittal Forms carry the documented fields

- **Key:** `RP-814` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals > New Submittal > MAR, then SAR, then DAR.
  2. Read each Form top to bottom in EN.
- **Expected result:** MAR: Manufacturer, Approved supplier (required), Model, Specification section, Description, Items table with total, Datasheet (PDF), Test certificate, Sample photo, Related submittals, Trade, Location, Scopes. SAR and DAR have Forms of their own. Subject and Document Number sit above, Attachments and Links below.

### FRM-02 Required fields to leave Draft

- **Key:** `RP-817` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: save a new MAR Draft with each of Manufacturer, Description, Datasheet, Trade, Location empty in turn.
  2. Send for Review.
- **Expected result:** Manufacturer, Description, the Datasheet, Trade and Location are required to leave Draft; a Draft saves with any missing. Each missing field is named and marked.

### FRM-03 Approved supplier offers the Trade's list only

- **Key:** `RP-820` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals > New Submittal > MAR: choose Trade Civil Works and open Approved supplier.
  2. Change Trade to Electrical Works.
- **Expected result:** Civil offers Eastern Province Building Materials; Electrical offers Qassim Electrical Trading (and any supplier added since by a SAR or the Project Admin). Changing Trade clears the supplier.

### FRM-04 Trade, Location and Scopes are Built-in Fields

- **Key:** `RP-823` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals > New Submittal > MAR: pick Location Block A, then Tower A, then Tower A Level 02.
  2. Open Scopes.
  3. Try to remove Trade from the Form view.
- **Expected result:** Locations nest Zone > Building > Floor (Block A > Tower A > Tower A Level 02); Scopes belong to the Trade, and UAT 01 has none, so Scopes offers nothing. Trade, Location and Scopes cannot be removed or made optional.

### FRM-05 Related submittals offers only Submitted items Hafiz sees

- **Key:** `RP-826` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: in the Draft "Lighting control panel – Hafiz's own Draft" type "control panel" under Related submittals.
  2. Also search for "Lighting control panel", Hafiz's own Drafts, and for "Beta Build".
- **Expected result:** Only Submitted items Hafiz sees in this Project appear, such as UAT01-MAR-01-0012 Emergency lighting control panel. No Drafts (not "Lighting control panel – Hafiz's own Draft"), nothing in internal review, nothing of Beta Build (Beta Build's UAT01-MAR-02-0002 is Submitted, but it is Beta Build's). A saved id that could not be offered is refused like a made-up one.

### FRM-06 Photos keep time and place; Take photo on a phone

- **Key:** `RP-829` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 px open Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals and the Draft "FRM-06 Draft for a photo from the phone"; under Sample photo choose Take photo / التقاط صورة (or Upload a JPEG with EXIF).
  2. Save.
  3. Open the photo.
- **Expected result:** On a phone Take photo / التقاط صورة is offered beside Upload. The thumbnail shows, and opening the photo shows the time and place from its EXIF.

### FRM-07 Documents freeze at the first Submit

- **Key:** `RP-831` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: in the Draft "FRM-07 Draft whose Documents change" add a Document, then remove it.
  2. Open UAT01-MAR-01-0011, Submitted to Design Consultants, and its Documents.
- **Expected result:** Before the Submit Documents can change. After it they are frozen for everyone: on UAT01-MAR-01-0011 Hafiz opens its Documents but cannot add or remove one.

### FRM-10 Draft autosave shows Saved and survives a failed save

- **Key:** `RP-839` · **Part:** FRM · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: edit the Draft "FRM-10 Draft for autosave"; watch the Saved time.
  2. Go offline in the browser, edit, go online.
- **Expected result:** The Saved time moves with each save. A failed save is shown clearly with a retry; no edit is lost.

### SIG-05 A Code C, a Code D and a Cancelled item also close with a record

- **Key:** `RP-714` · **Part:** SIG · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open UAT01-MAR-01-0006 (closed at Code C), UAT01-MAR-01-0007 (closed at Code D) and UAT01-MAR-01-0008 (Cancelled).
  2. Download each one's Documental Record (PDF).
- **Expected result:** Each closed with its record whatever the outcome; the outcome in each PDF matches the item: Code C, Code D, Cancelled.

### SIG-07 Add Signature in the profile (draw, type, upload)

- **Key:** `RP-717` · **Part:** SIG · **Round:** 2
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Profile > Signature: Hafiz has one, so choose Replace: Draw with finger at 375 px, then Type, then Upload.
  2. Save.
  3. Replace it again.
- **Expected result:** Pen styles and colours, Clear and Undo; a preview as on a record; once saved the profile shows it with Replace and the note that records already made keep the Signature used then.

### SNG-03 Contractor moves the Snag through its Steps

- **Key:** `RP-754` · **Part:** SNG · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Snag List: open UAT01-SNG-03-0001 "SNG-03 Loose cable tray cover", Open with TMC (Design Consultants raised it).
  2. Start work, Put on hold, Resume work, back to Open where offered.
- **Expected result:** Moves are TMC's internal events: inside TMC the Stage shows In Progress or On Hold. A send leaves it in TMC's Step Pool.

### SNG-04 Resolve with a note, Verify, Close or Return to Open

- **Key:** `RP-756` · **Part:** SNG · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Snag List: open UAT01-SNG-03-0002 "SNG-04 Missing socket cover", Open with TMC, and Resolve with a resolution note (required).
  2. Open UAT01-SNG-03-0003 "SNG-04 Unlabelled circuit breakers – back to Open": Hafiz resolved it and Ahmed, who raised it, Returned it to Open with the reason "Two breakers are still unlabelled." Read the reason, then Resolve again.
- **Expected result:** Resolve asks for the resolution note; after it the Snag is Design Consultants', who raised it, to Verify, and Hafiz can no longer move it. Return to Open came back to TMC, who resolved it, with Ahmed's reason, and Resolve is offered again. Each side reads only the other's shared Transitions.

### SNG-08 Resolve with after photos

- **Key:** `RP-765` · **Part:** SNG · **Round:** 3
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Snag List: open UAT01-SNG-03-0004 "SNG-08 Cracked light diffuser", Open with TMC; add after photos before Resolve; Resolve.
- **Expected result:** After photos sit with TMC until Resolve, then freeze and show beside the before photos in the record; a Send Back discards them.

### SNG-11 Snag detail page

- **Key:** `RP-780` · **Part:** SNG · **Round:** 3
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Snag List: open UAT01-SNG-03-0001 "SNG-03 Loose cable tray cover" and read its page; change nothing.
- **Expected result:** Header with number, type, Stage and age; Raised from card; description; photos; actions only for Hafiz; history. No due date.

### SNG-13 Snag List on a phone

- **Key:** `RP-784` · **Part:** SNG · **Round:** 3
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 px open Projects > UAT 01 · Contractor Engineer (Hafiz) > Snag List and raise a Snag with the camera.
- **Expected result:** Photo-first cards, filters in a sheet, large New button, the camera opens from Take a photo / التقاط صورة; saved as you go.

### INS-03 Raise a WIR with a Checklist Template

- **Key:** `RP-802` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Inspections > New > Work Inspection Request: Description, Trade Civil Works, Location, Checklist Template.
  2. Look at the preview of items.
  3. Change the Trade.
- **Expected result:** Templates offered are the Trade's active ones; changing the Trade clears the pick; before a Trade it says Choose a Trade first. The items are copied onto the WIR. (A retired Template, labelled As picked, needs the Project Admin to retire one: not part of UAT 01.)

### INS-04 Approved submittals offers only Code A or B items

- **Key:** `RP-803` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Inspections > New > Work Inspection Request: open Approved submittals.
  2. Search UAT01-MAR-01-0010, closed at Code C, and UAT01-MAR-01-0011, still open.
- **Expected result:** Only items closed at Code A or B that Hafiz sees and that were Submitted are offered, such as UAT01-MAR-01-0009; UAT01-MAR-01-0010 and UAT01-MAR-01-0011 are not. A saved id outside that is refused like an unknown option.

### INS-05 The pick is fixed once the WIR is Submitted

- **Key:** `RP-806` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Inspections: open the WIR Draft "INS-05 Cable containment Level 04 – Draft", change its Trade to Civil Works and pick Concrete pour.
  2. Open UAT01-WIR-01-0001, which Ali Submitted, and try to change its Checklist Template.
- **Expected result:** Before the first Submit a new pick replaces the copy: the Draft now holds Concrete pour's items. After it, on UAT01-WIR-01-0001, the pick and the copy are fixed.

### INS-06 Annotate a photo; the original is kept

- **Key:** `RP-809` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open the Draft "INS-06 Draft with a photo to annotate"; open its Sample photo and annotate it (arrow, text label); Save.
  2. Switch Annotated and Original.
- **Expected result:** The annotated copy is saved beside the original, marked annotated; the original's bytes are unchanged; both download.

### IMP-01 Upload accepts .xlsx and .csv only

- **Key:** `RP-835` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals > Import register.
  2. Upload a .pdf, a non-UTF-8 .csv, a .csv over 2,000 rows, then a good .xlsx.
- **Expected result:** Each bad file gets its own message (only .xlsx and .csv; save as CSV UTF-8; split into smaller registers). The good file moves to the next step. Cells are read as stored, so 0012 stays 0012 when typed as text.

### IMP-02 Pick the worksheet and the header row

- **Key:** `RP-838` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals > Import register upload a workbook with two sheets and 3 title rows above the headings.
  2. Choose the sheet and the header row.
- **Expected result:** The preview shows the first rows; rows above the header are skipped; rows below are read as submittals; an empty or missing header row gets its message.

### IMP-03 Map columns to Rabaed fields

- **Key:** `RP-841` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz)'s Import register map Description to Subject, Type to Type, Discipline to Trade.
  2. Try Validate with Trade unmapped.
  3. Use one value for every row instead.
- **Expected result:** Subject, Type and Trade are required; unmapped columns are ignored; a fixed value for every row is allowed and shown as such on the import's page.

### IMP-04 Preview lists every reason per bad row

- **Key:** `RP-844` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz)'s Import register validate a register with: empty Subject, Subject over 200 characters, unknown Type, Trade not in the Project.
- **Expected result:** Counts show rows checked, ready and left out; each bad row lists all its reasons (Subject empty, Type unknown, Trade not in this Project). Nothing is created yet. (Hafiz covers every Trade of UAT 01, so no row is outside his Visibility here.)

### IMP-05 Confirm creates Drafts, all good rows or none

- **Key:** `RP-847` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz)'s Import register confirm a preview with 8 good rows and 2 bad.
  2. Open the Submittals List.
- **Expected result:** Eight Drafts are created, raised by Hafiz, each No number yet; the two bad rows are left out and never created. A change in the Project after the preview gives Something in the Project changed, validate again.

### IMP-06 The result page and the Imports page

- **Key:** `RP-850` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After confirming an import in Projects > UAT 01 · Contractor Engineer (Hafiz) read the result: Drafts created, Left out, Open the Drafts.
  2. Imports page.
  3. Open the import.
- **Expected result:** Imports are listed by file name only, with no time anywhere. The import page lists every row with its result; a created row links to its Draft.

### IMP-07 Imported Drafts follow the Draft rules

- **Key:** `RP-852` · **Part:** IMP · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz) open a Draft an import made.
  2. Read its history.
- **Expected result:** It is an ordinary Draft: Hafiz edits it, sends it, and it gets its number at the first send. Its created event, internal to TMC, names the import.

### IMP-08 Download the rows left out and import again

- **Key:** `RP-857` · **Part:** IMP · **Round:** 5
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On the result of an import in Projects > UAT 01 · Contractor Engineer (Hafiz) press Download rejected rows.
  2. Fix and import again.
- **Expected result:** The file holds the left-out rows with a reason column; the second import is a new import.

### IMP-09 Unknown values are matched once per distinct value

- **Key:** `RP-860` · **Part:** IMP · **Round:** 5
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz)'s Import register map a Trade column holding Elec. on 30 rows.
  2. Match Elec. to Electrical Works once.
- **Expected result:** The match applies to all 30 rows; the preview recounts.

### I18N-01 Switch language keeps the page and mirrors the layout

- **Key:** `RP-902` · **Part:** I18N · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On Home, and in Projects > UAT 01 · Contractor Engineer (Hafiz) on the List, Kanban and an item, switch EN to AR with the language button, and open /ar URLs directly.
  2. Switch back.
- **Expected result:** The same page reloads in Arabic with RTL: sidebar, tables, filter panel, Kanban column order, arrows and breadcrumbs mirror. Nothing is cut off.

### I18N-04 Form labels and validation messages in Arabic

- **Key:** `RP-906` · **Part:** I18N · **Round:** 0
- **Sign in as:** Hafiz (Arabic)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz) open a MAR Form in /ar; leave Description empty and Send for Review.
- **Expected result:** Field labels, section titles, Action Form words and the missing-fields message are Arabic; values typed in English are not translated.

### I18N-06 Phone width 375: nothing breaks

- **Key:** `RP-689` · **Part:** I18N · **Round:** 0
- **Sign in as:** Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 px open Home, Projects, and in Projects > UAT 01 · Contractor Engineer (Hafiz) the Submittals List, Kanban, an item, Settings, the Workflow builder.
- **Expected result:** No page scrolls sideways; tables and the Kanban scroll inside their own area; the sidebar opens as a drawer. This is what the build guarantees until the phone designs of RP-422 exist. Note, without failing the scenario, touch targets under 44 px, filters that do not open as a sheet and any cut-off text, as UX recommendations. The same web app, no separate app.

### UX-04 Submittals List matches the owner anatomy

- **Key:** `RP-926` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals > List at 1366 and 1920, EN and AR.
  2. Open the filter panel, choose several values, save columns, sort, page.
  3. Scroll a long table.
- **Expected result:** Matches D:\Artifacts\Rabaed Submittals List.html first, then submittals-list.html with list/filter-panel.js: columns, chips, Step Age dots, Code labels ("Code A"), row menu; the table scrolls inside its own region, the page never scrolls sideways.

### UX-05 Submittals Kanban matches the board and card anatomy

- **Key:** `RP-927` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals > Kanban, EN and AR, 1366 and 1920.
  2. Read a card in every Stage; change the Card view layout.
  3. Scroll across and within columns.
- **Expected result:** Matches D:\Artifacts\Rabaed Kanban Board Anatomy.html and Rabaed Kanban Card Anatomy.html, then submittals-kanban.html: column headers and counts, card fields and order, With line, Step Age dots, closed-by line; columns scroll left and right, cards up and down.

### UX-06 Work Item page, Transition pop-ups and View workflow drawer

- **Key:** `RP-928` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz) open a MAR in Draft ("Lighting control panel – Hafiz's own Draft"), in internal review (UAT01-MAR-01-0001), Submitted (UAT01-MAR-01-0011) and closed (UAT01-MAR-01-0009), EN and AR.
  2. Open every Transition pop-up Hafiz is offered (Send for Review, Cancel) and close it without confirming.
  3. Open View workflow (map and list).
- **Expected result:** Laid out as design/prompts/work-item-page.md and workflow-view.html: header (Document Number left to right, Stage, With, Step Age), Form, Attachments and Links, history; each pop-up asks for confirmation and shows its Action Form; required fields and errors are clear.

### UX-07 New work item and the Form while filling it

- **Key:** `RP-929` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz): New Submittal for each Type, EN and AR, 1366 and 375.
  2. Fill, leave required fields empty, add Items rows, upload files and a photo, Save Draft.
- **Expected result:** Laid out as new-work-item.md and form-template-brief.md: sections, field help, the Items table on a phone, upload progress, "Saved" indicator, the list of fields needing attention; nothing overlaps at 375.

### UX-19 Phone width for every built page

- **Key:** `RP-941` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 and 820 open Home, Projects, and in Projects > UAT 01 · Contractor Engineer (Hafiz) the List, Kanban, item page, New item; then Notifications, Profile, Settings. EN and AR.
- **Expected result:** Follows D:\Artifacts\Rabaed Responsive Anatomy.html and responsive.md: no page-level sideways scroll; tables and the Kanban scroll inside their region; the sidebar is a drawer; every action reachable.

### UX-21 Feedback after every action

- **Key:** `RP-943` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz) save a new Draft, take each Transition Hafiz is offered on it, upload a file, change a setting.
  2. Watch for the confirmation, the disabled reason and the page update.
- **Expected result:** Each action gives visible feedback (toast or inline), disabled buttons say why, the page updates without a reload, nothing is done twice on a double click.

### UX-22 Keyboard and screen reader basics

- **Key:** `RP-944` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz) use the List, Kanban, item page, a Transition pop-up and the Form with the keyboard only.
  2. Run an accessibility scan (the accessibility-tester agent, report only) on the same pages, EN and AR.
- **Expected result:** Visible focus, logical focus order (mirrored in Arabic), pop-ups trap and return focus, every control has a label, text contrast at least WCAG AA. Findings reported as UI issues.

### UX-24 Snag List on a phone

- **Key:** `RP-946` · **Part:** UX · **Round:** 3
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 open Projects > UAT 01 · Contractor Engineer (Hafiz) > Snag List, its filters and UAT01-SNG-03-0004; create a Snag camera first.
- **Expected result:** Matches snag-list-mobile.html: photo-first cards, bottom-sheet filters, camera-first create.

### VIS-04 Recommended Code, Internal Notes and the verification note never reach TMC

- **Key:** `RP-740` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: open UAT01-MAR-01-0010 "VIS-04 Sub-distribution boards – Code C". Design Consultants' Engineer reviewed it and sent it to the Manager with a Recommended Code and an Internal Note; Mohammed closed it at Code C with Remarks and his final verification.
  2. Read its header, Form, replies, history and Activity, and Export the List with it.
- **Expected result:** Hafiz sees Code C with what the Code shares: Mohammed's Remarks ("Revise and resubmit with the specified finish.") and his final verification. He must NOT see the Recommended Code, the Internal Note ("Recommend resubmission: see the verification.") or the Engineer's own review answers (his Send to Manager reply) anywhere: not in the history, the replies, the Activity Feed, the export or a notification (V5).

### VIS-11 Link search never offers what the linker cannot see

- **Key:** `RP-771` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: in the Draft "Lighting control panel – Hafiz's own Draft", Links > add a Link and search "control panel", then "Beta Build", then "SUB-02"; close it without adding one.
- **Expected result:** Hafiz is offered only Submitted items he sees in this Project, such as UAT01-MAR-01-0012: no Drafts ("SUB-02 Lighting fixtures – incomplete" and "Lighting control panel – Hafiz's own Draft" are his own Drafts), nothing in internal review, nothing of Beta Build (UAT01-MAR-02-0002 is Submitted, but it is Beta Build's), nothing from another Project.

### VIS-19 List and Kanban counts, lanes and filters hide the other Company

- **Key:** `RP-797` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals: List and Kanban; note every Stage count, lane and filter value.
  2. Search for "Beta Build", UAT01-MAR-02-0001, UAT01-MAR-02-0002 and UAT01-MAR-02-0003; in the Snag List search for "Design Consultants – Draft snag".
  3. Open the Dashboard.
- **Expected result:** Nothing of Beta Build's appears anywhere: not its Draft "Beta Build – standby generator, Draft", nor UAT01-MAR-02-0001 (with Beta Build's PM), UAT01-MAR-02-0002 (Submitted) or UAT01-MAR-02-0003 (closed at Code A), in no List, lane, count, filter value, search result or Dashboard figure (V1, V3). Design Consultants' own "Design Consultants – Draft snag, not raised" is in no Snag List or count (V1). Every count is of TMC's items and the items others Submitted to TMC only.

### VIS-31 A Participant never sees the list of other Participants

- **Key:** `RP-834` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz) open Company Projects and the Project's Participants page.
  2. Open Settings > Numbering.
- **Expected result:** Hafiz sees TMC's own Participant, its role, its Project Members and the Host Company's name, and never the list of the other Participants (V15). Numbering shows TMC's own Participant with No code yet and no order number; only the Project Admin sees all orders.

### VIS-39 Document Numbers and numbering counters do not reveal a rival volume

- **Key:** `RP-858` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 01 · Contractor Engineer (Hafiz) > Submittals List: read the Document Numbers of TMC's MARs, UAT01-MAR-01-0001 to UAT01-MAR-01-0012; Beta Build numbered three of its own while the seed raised them.
  2. Open Settings > Numbering, and a counter's page if one is offered.
- **Expected result:** TMC's numbers run 0001 to 0012 with no gaps: nothing shows that Beta Build numbered items in between. Hafiz sees examples built from TMC's own Participant with sequence 1, and no counters: a counter's address gives the not-found page. Version history names the saver Company only to its own Members and the Project Admin; others read A Project Admin.

### VIS-60 Rabaed Default Workflows are readable by all and name no Company

- **Key:** `RP-915` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In Projects > UAT 01 · Contractor Engineer (Hafiz) open the list of Rabaed Default Workflows for a submittal Type.
- **Expected result:** Hafiz reads the eight Workflows with names and Versions, and the one the Type runs marked; they name no Project, Company or item; a Project binding reaches that Project only.

### VIS-64 Another Project is invisible both ways

- **Key:** `RP-919` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Projects and Home, and search for "Jeddah" and for "Pump room ventilation": Jeddah Corniche Villas is Beta Build's own Project and that is its Draft.
  2. Open a made-up Project address, /en/projects/00000000-0000-4000-8000-000000000000.
- **Expected result:** Jeddah Corniche Villas is not in Hafiz's Projects, Home counts, search or notifications; the made-up address gives the one not-found page (404, never 403). Carried over from RP-463 A-11 (RP-474).

## 2. Sign in as Ali · open UAT 02 · Contractor Project Manager (Ali) (45 cases)

Every case here is run in **UAT 02 · Contractor Project Manager (Ali)**, as the one person named above: open it from Projects, not from Home.

### SUB-07 Submit with a Cover Note and an Internal Note

- **Key:** `RP-704` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: open UAT02-MAR-01-0001 "SUB-07 Wiring devices – ready to Submit", which Hafiz sent for review and is with you.
  2. Submit; Cover Note "Sockets for Level 2, as drawing E-201"; Internal Note "Quantities checked against the BOQ"; confirm.
- **Expected result:** UAT02-MAR-01-0001 is in Pending Approval. Ali reads "With Design Consultants LLC", never a Consultant's name (V14). In the history the Submit shows the Cover Note, and the Internal Note is marked internal, TMC's only (V5). The Submission Date is set.

### SUB-18 Download gives the item as it last arrived

- **Key:** `RP-735` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: on UAT02-MAR-01-0004 "Exit signs – Submitted to Design Consultants" choose Download from the row menu.
  2. Choose Download on the Draft "SUB-18 LED downlights – TMC Draft".
- **Expected result:** The download holds the item as it last arrived at Design Consultants: shared answers, shared moves by Company only, no Step, no person, no Internal Note (V5, V14). The Draft offers Download of its Working Copy.

### SUB-22 Watch and Unwatch

- **Key:** `RP-743` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: open UAT02-MAR-01-0004 "Exit signs – Submitted to Design Consultants"; note Watching (you Submitted it, so you watch it from the start).
  2. Unwatch, then Watch again.
- **Expected result:** The button flips between Watch and Watching. Nobody sees who else watches an item or how many.

### SUB-23 List: search, filters, Need My Action, sort and columns

- **Key:** `RP-746` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals List: search by Document Number (UAT02-MAR-01-0007), Subject, Type, Trade, Location.
  2. Filter panel: pick several values for Type, Stage, With, Step Age, Submission Date.
  3. Toggle Need My Action.
  4. Sort by a column; Columns > move one > Save as my default; reload.
  5. Group by Stage.
- **Expected result:** Results match the filters; Stage counts match the rows; Need My Action keeps only the items waiting on Ali, each reading With Ali Sonour; TMC's Drafts stay in view, uncounted; the saved columns come back after reload; the column header for the holder reads With.

### SUB-24 List export holds what the viewer sees

- **Key:** `RP-748` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals List: Export > what you see > CSV, then Excel.
  2. Export the whole table.
  3. Search "Code" first, then export.
  4. Find the Draft "=1+1 SUB-24 Subject that looks like a formula" in the export.
- **Expected result:** Rows and columns equal the screen; the whole table adds every List field; under a search only the rows read so far; the Draft's Subject "=1+1 SUB-24 Subject that looks like a formula" is written as text, never worked out as a formula. Nothing of Beta Build's is in any export.

### SUB-25 Kanban: columns, counts and moving a card

- **Key:** `RP-753` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals > Kanban: columns are the Stages with counts.
  2. Drag UAT02-MAR-01-0003 "SUB-25 Emergency luminaires – move on the Kanban" from Internal Review to Pending Approval, or use Move to.
  3. Open the filter panel (Owner, Role, Created date).
- **Expected result:** Dropping or choosing a move opens the same Action Form as the item page (the Submit pop-up); the card moves after confirm; a move that is not allowed is not offered. Internal Review shows TMC's own Steps with counts (Engineer, PM). Design Consultants is one lane by its name (V14).

### SUB-26 Project Dashboard: Type cards and Activity Feed

- **Key:** `RP-755` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali): the Dashboard.
  2. Click a number on a Type card.
- **Expected result:** Type cards show counts over what Ali sees; each number opens the List with the same filter and the same count. The Activity Feed sits beside them; it lists Design Consultants by Company name and no person of theirs (V14), and nothing of Beta Build's (V3).

### SUB-27 Home: counts, Need My Action list, Recent activity

- **Key:** `RP-757` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Home.
  2. Compare Active Projects, Need My Action, My Company 4+ weeks at step, My Company waiting with others and the UAT 02 card's submittal count with Projects > UAT 02 · Contractor Project Manager (Ali)'s List.
- **Expected result:** Every number equals the sum of the Project reads and opens the matching list; Drafts are never counted as Need My Action; Recent activity shows at most four entries. Home sums every Project Ali is on, every UAT Project among them.

### WF-02 View workflow on an item pins its Version

- **Key:** `RP-767` · **Part:** WF · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: open UAT02-MAR-01-0004 "Exit signs – Submitted to Design Consultants"; click Workflow: name, Version n.
  2. Switch map and list.
- **Expected result:** The drawer shows the Version the item is pinned to. Ali's own Steps are shown one by one; Design Consultants is one part marked With Design Consultants LLC, with none of its Steps marked and no name of theirs (V14).

### PKG-01 Packages is a third view beside List and Kanban

- **Key:** `RP-892` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals > the view toggle.
  2. Choose Packages.
- **Expected result:** A Packages Kanban with three columns Open, In Progress and Done, each with a count: UAT 02's seeded TMC Packages are under Open (PKG-03, PKG-04, PKG-05) and In Progress ("PKG-07 Package to add to", "PKG-08 Package in progress"). A New Package button for TMC; search and filters (Trade, owning Company). Matches packages.html except where spec RP-616 differs. No Package of Beta Build's appears.

### PKG-02 Open a Package and number it

- **Key:** `RP-895` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals > Packages > New Package: name EN and AR.
  2. Open it.
  3. Make a second one.
- **Expected result:** The Package gets TMC's next Package number, after the six seeded ones (PKG-001 to PKG-006), shown left to right also in Arabic, beside TMC's name, Open, with no submittals. The second gets the next number.

### PKG-03 Add submittals from Drafts and review

- **Key:** `RP-897` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals > Packages: open "PKG-03 Package to fill" > Add items.
  2. Pick the Drafts "PKG-03 Earthing – Draft 1" and "PKG-03 Busbar trunking – Draft 2" and UAT02-MAR-01-0010 "PKG-03 Smoke detectors – in Internal Review".
  3. Try to add "PKG-03 Wiring devices – in another Package", which is in "PKG-03 Package holding a Draft".
- **Expected result:** Only TMC's own submittals Ali can see are offered, with search and a Trade filter. The Draft already in PKG-03 Package holding a Draft is marked and cannot be picked: a submittal belongs to at most one Package.

### PKG-04 While Open: remove, rename, delete

- **Key:** `RP-898` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals > Packages: open "PKG-04 Package to change".
  2. Remove "PKG-04 LED downlights – in the Package".
  3. Rename the Package.
  4. Delete it.
- **Expected result:** Remove and delete work only while Open; Delete says the Drafts stay, without a Package. Rename is allowed in every status.

### PKG-05 Submit Package is all or nothing

- **Key:** `RP-899` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals > Packages: open "PKG-05 Package to submit" > Add items: the Draft "PKG-05 Lighting fixtures – Datasheet missing".
  2. Open Submit Package.
  3. Remove that Draft again, then Submit Package and confirm.
- **Expected result:** A not-ready list names "PKG-05 Lighting fixtures – Datasheet missing" with each required answer it lacks (its Description, Items and Datasheet) and links to it; Submit is disabled until the list is empty. After the removal one confirm submits "PKG-05 Exit signs – ready Draft", which gets the next Document Number in TMC's MAR series; the Package is In Progress. If any item fails, none is submitted.

### PKG-07 After Submit: add yes, remove no

- **Key:** `RP-684` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals > Packages: open "PKG-07 Package to add to" (UAT02-MAR-01-0011 "PKG-07 Cable trays – Submitted, in a Package", with Design Consultants).
  2. Add the Draft "PKG-07 Wiring devices – Draft to add".
  3. Try to remove an item.
  4. Rename the Package.
- **Expected result:** Adding works; removing is not offered. Rename works and is recorded.

### PKG-08 The Package chip and filter on submittals

- **Key:** `RP-687` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: List and Kanban.
  2. Use the Package filter: "PKG-08 Package in progress".
  3. Click the Package chip on the card of UAT02-MAR-01-0005 "PKG-08 Fire alarm control unit – Submitted, in a Package" and on its item page.
- **Expected result:** Cards and the item page show the Package's number with its name; the chip opens the Package page; the filter narrows List and Kanban to its items. Package is not a Form field.

### PKG-11 Comments show on the Package for information

- **Key:** `RP-696` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals > Packages: open "PKG-08 Package in progress" > its Comments section. UAT02-MAR-01-0006 "PKG-11 Lighting control panel – Code B" closed at Code B with two Comments.
- **Expected result:** The Comments raised from its submittals are listed with their Stage and the note that Comments are not part of the Package; they do not change its status.

### SIG-01 Every Transition is confirmed in its pop-up

- **Key:** `RP-702` · **Part:** SIG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: open UAT02-MAR-01-0002 "SIG-01 Cable trays – Submit in its pop-up" and choose Submit.
  2. Look for a Sign button or checkbox.
  3. Confirm.
- **Expected result:** The pop-up keeps the Transition's own label; there is no separate signing step. Taking it without confirming (API without confirmed true) is refused not_confirmed. After confirm the history records who, from which Participant and when.

### SIG-02 Download PDF on a closed item makes the sealed record

- **Key:** `RP-705` · **Part:** SIG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: open UAT02-MAR-01-0007 "Main distribution board – Code A" and press Download PDF.
- **Expected result:** A PDF downloads through a short-lived link. If the record is not made yet the page says it is not ready and to try again in a minute; no partial file.

### SIG-03 The tracer record prints title, outcome and approval flow

- **Key:** `RP-711` · **Part:** SIG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the record of UAT02-MAR-01-0007 "Main distribution board – Code A" (SIG-02).
  2. Check the title block, outcome and date, Verification Code, link, approval flow, footer.
- **Expected result:** Type names and code, Subject, Project and Document Number UAT02-MAR-01-0007 (left to right, Rev included); the outcome with the date; the Verification Code and verification link; each Transition on the path with label, Member, Positions, Company, date and time (Riyadh time) and its content hash; Arabic then English; Latin digits; every page footed Issued electronically through Rabaed, Verification Code, page X of Y. (Page 1 and Form body come with SIG-08.)

### SIG-08 Record page 1 and Form body

- **Key:** `RP-719` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Download the record of UAT02-MAR-01-0007 "Main distribution board – Code A".
  2. Read page 1: Companies, title block, parties, classification, final decision with chips and QR, reply, approval flow, then the Form.
- **Expected result:** The layout matches form-engine section 6 items 1 to 9; tables and photos print as tables and a photo grid; Documents are listed.

### SIG-12 Signature cards, Stamps, Review Comments, endings and Disclaimer

- **Key:** `RP-731` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Download the records of UAT02-MAR-01-0007 "Main distribution board – Code A", UAT02-MAR-01-0008 "Sub-distribution boards – Code C" and UAT02-MAR-01-0009 "LV power cables – Code D".
  2. Read the Signatures, Stamps and ending pages.
- **Expected result:** One card per Transition on the path with Signature as it was then; the Stamp of every acting Company; Review Comments numbered; a Next step card with Code C (Revision n+1) or D (a new submittal replaces this one); an internal reviewer's card says Reviewed with no Code; the Disclaimer in Arabic and English (V7).

### SIG-13 Appendix of Documents

- **Key:** `RP-733` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Download the record of UAT02-MAR-01-0007 "Main distribution board – Code A", closed with its Datasheet PDF and a Sample photo.
- **Expected result:** The shared Datasheet PDF and the Sample photo follow as pages of the appendix; a Company's internal Documents are not included. (No DWG is seeded on UAT 02: a file other than PDF or image, attached inside the PDF, is not checked here.)

### SIG-16 Working Copy of an unfinished item

- **Key:** `RP-749` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: open UAT02-MAR-01-0004 "Exit signs – Submitted to Design Consultants" and request its Working Copy.
- **Expected result:** The Working Copy is watermarked Not Final / غير نهائي (or the Project text), unsealed, with no Verification Code; Companies by name only, no person, no Signature or Stamp, and nothing of Design Consultants' own Steps (V7, V14).

### SNG-01 The Snag List tab: List, Kanban and empty state

- **Key:** `RP-751` · **Part:** SNG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Snag List.
  2. Switch List and Kanban.
  3. Use the Types chips (All, Snags, Comments), Stage, Trade, Company and search by number (UAT02-SNG-03-0001) or Subject.
- **Expected result:** Items are grouped by Stage with counts; type chips and Stage counts count only visible items; the Comments raised from UAT02-MAR-01-0006 are under Comments. Filters with no match say nothing you can see matches. (The empty list, No snags. Nice work., shows on a Project with none.)

### SNG-05 A Contractor raises a Snag on itself

- **Key:** `RP-758` · **Part:** SNG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Snag List > New Snag raised by TMC on its own work: Subject "UAT SNG-05 Socket not level", Trade Electrical Works, Location Tower A Level 03.
  2. Move it through Start work, Resolve, Verify, Close.
- **Expected result:** The raiser holds Draft and Verify, so TMC works and closes its own Snag; Design Consultants and Beta Build never see it (informing the Consultant is SNG-09).

### SNG-06 Comments from Code B live in the Snag List

- **Key:** `RP-760` · **Part:** SNG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Snag List > Comments: the two raised from UAT02-MAR-01-0006 "PKG-11 Lighting control panel – Code B".
  2. Resolve one.
  3. Open the MAR.
- **Expected result:** Each Comment shows Raised from (UAT02-MAR-01-0006, its Subject, Code B), is raised by Design Consultants and held by TMC, and counts on the MAR's Comments line (2 open / 0 closed). After the Resolve the Comment waits at Design Consultants, who raised it, to be closed. The photo thumbnail is the first photo the viewer may see.

### SNG-07 New offers no Comment type

- **Key:** `RP-762` · **Part:** SNG · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Snag List > New.
- **Expected result:** The menu offers Snag (and later Site Observation and Question) and not Comment; Comments only come from a Code B.

### SNG-12 Bulk actions and exports

- **Key:** `RP-782` · **Part:** SNG · **Round:** 3
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Snag List: select UAT02-SNG-03-0001 "SNG-12 Loose cable tray cover" and UAT02-SNG-03-0002 "SNG-12 Missing socket cover"; reassign within TMC; Export Excel.
- **Expected result:** Bulk applies within TMC only; the export holds exactly the visible rows.

### SNG-15 Snag PDF report

- **Key:** `RP-789` · **Part:** SNG · **Round:** 3
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Snag List > Export PDF report.
- **Expected result:** A PDF of the visible Snags with photos, UAT02-SNG-03-0001 and UAT02-SNG-03-0002 among them; no Snag the viewer cannot see.

### NOT-01 The bell, the Notifications page and Mark all as read

- **Key:** `RP-871` · **Part:** NOT · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Look at the bell badge: Hafiz's items in Projects > UAT 02 · Contractor Project Manager (Ali) (UAT02-MAR-01-0001 to 0003) reached you when he sent them for review.
  2. Open Notifications; open one entry.
  3. Mark all as read.
- **Expected result:** The badge counts unread; each entry reads Reached you at <Step> and opens the item; Mark all as read clears the badge. In-app notifications are always sent: there is no in-app switch.

### I18N-07 Desktop 1366 and 1920

- **Key:** `RP-692` · **Part:** I18N · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Home, then Projects > UAT 02 · Contractor Project Manager (Ali): List, Kanban and UAT02-MAR-01-0004, at 1366 and 1920 px.
- **Expected result:** Layout follows the reference screens at both widths (see strategy section 3 for the ui-ux-tester pass).

### UX-02 Home matches the design and reads at a glance

- **Key:** `RP-924` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Home at 1366 and 1920, EN and AR.
  2. Follow each number and row.
- **Expected result:** Matches the kit Home with RP-405 changes: Active Projects, Need My Action, 4+ weeks at their step (Step Age dots, never Overdue), Waiting with others, Recent activity. Every number opens the List with its filter.

### UX-03 Projects page and Project Dashboard

- **Key:** `RP-925` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Projects, then Projects > UAT 02 · Contractor Project Manager (Ali)'s Dashboard, EN and AR, 1366 and 1920.
  2. Click each card figure.
- **Expected result:** Cards match the kit; the Dashboard Type cards, Revision line and Activity Feed are laid out as designed; no squashed card (the RP-405 audit fault); each figure opens the List with the same filter.

### UX-08 Activity page

- **Key:** `RP-930` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Activity, EN and AR.
  2. Page back; open entries.
- **Expected result:** Laid out as design/prompts/activity.md: entries worded from what happened, another Company by name only, newest first, paging that keeps its place.

### UX-09 Notifications page and the bell

- **Key:** `RP-931` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the bell, then the Notifications page, EN and AR.
  2. Open an entry; Mark all as read.
- **Expected result:** Laid out as design/prompts/notifications.md: unread state, grouping, the item it opens, empty state; the bell badge matches the unread count.

### UX-10 Profile and notification settings

- **Key:** `RP-932` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Profile, EN and AR.
  2. Change language, email per group, Pause all, a Project mute (UAT 02).
- **Expected result:** Laid out as profile-notification-settings.md: no In-app switch; each change confirms it saved; the language change keeps the page.

### UX-23 Packages view and Package page

- **Key:** `RP-945` · **Part:** UX · **Round:** 1
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals > Packages, then "PKG-08 Package in progress", EN and AR, 1366 and 1920: cards, counts, item table, bulk bar, Comments section.
- **Expected result:** Matches packages.html where spec RP-616 does not differ (the table of known differences in design/prompts/packages.md).

### UX-26 Documental Record and Working Copy read like the owner samples

- **Key:** `RP-948` · **Part:** UX · **Round:** 2
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Download the Documental Record of UAT02-MAR-01-0007 "Main distribution board – Code A" and the Working Copy of UAT02-MAR-01-0004, EN and AR record language.
  2. Compare with the owner samples of RP-151.
- **Expected result:** Page 1, the Form body, Signature cards and appendix follow the samples where they agree with visibility.md and GLOSSARY.md; Latin digits; Document Numbers left to right; readable when printed.

### VIS-08 The Record Data inside the PDF holds only what the pages print

- **Key:** `RP-766` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the record of UAT02-MAR-01-0007 "Main distribution board – Code A" (SIG-02): open the PDF's attachments and extract the Record Data XML.
  2. Compare each value with the PDF text.
- **Expected result:** Every value in the XML (Transitions on the path with name, Position, Company, times and hashes; Verification Code and link) is printed in the PDF; the XML holds no Internal Note, Recommended Code, Chat or Return (V7).

### VIS-20 Search finds nothing inside answers or replies

- **Key:** `RP-798` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: UAT02-MAR-01-0008 "Sub-distribution boards – Code C" was closed with Mohammed's Remarks "Revise and resubmit with the specified finish." and, inside Design Consultants, Ahmed's Internal Note "Recommend resubmission: see the verification."
  2. Search "resubmit" and "resubmission" in the List and Kanban.
  3. Search by Document Number, Subject, Type, Trade, Location and "Design Consultants".
- **Expected result:** No result for either word: Search never reads answers, replies or notes. Search by Document Number, Subject, Type, Trade, Location and the raiser Company works; a holder phrase finds TMC's own people and Design Consultants by name only. Opening UAT02-MAR-01-0008 shows the Code and its Remarks, never the Internal Note or Ahmed's Recommended Code (V5).

### VIS-25 The workflow map folds the other Company into one block

- **Key:** `RP-816` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: open UAT02-MAR-01-0004 "Exit signs – Submitted to Design Consultants" > View workflow.
  2. Read the map and the list.
- **Expected result:** Ali reads the whole Version with every Company's Steps, but the item is With Design Consultants LLC over Design Consultants' part: none of its Steps is marked, and no name of theirs shows (V14). Design Consultants' own moves on it (Ahmed to Mohammed) change nothing Ali reads.

### VIS-30 Another Project or a non-admin cannot read or change Tower setup

- **Key:** `RP-832` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Settings: Trades and Locations (look for add, rename and deactivate on a Scope), Numbering (the counters), Workflows, Visibility.
- **Expected result:** Ali reads UAT 02's Trades, Scopes, Locations and published Workflows (V16); he is offered no change, and none of the numbering counters. A change asked for anyway (an old link, the API) gets the plain 404 and changes nothing. Saeed, the Project Admin, makes these changes (UAT 03).

### VIS-38 After the Submit only the Step holder changes anything

- **Key:** `RP-855` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Submittals: open UAT02-MAR-01-0004 "Exit signs – Submitted to Design Consultants", which you Submitted.
  2. Look for an edit control on the Form, a Document upload, and any Transition.
- **Expected result:** After the Submit only the Step holder changes anything: Design Consultants hold it, so Ali is offered no Transition, no Form edit and no Document upload; the Form and Documents read as they were Submitted (V13). A change asked for anyway (an old link, the API) is refused and changes nothing.

### VIS-57 The Activity Feed names other Companies only by name

- **Key:** `RP-912` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 02 · Contractor Project Manager (Ali) > Activity Feed and the Dashboard's Recent activity: the seed Submitted UAT02-MAR-01-0004, and Design Consultants reviewed and closed UAT02-MAR-01-0006 to 0009.
  2. Search Submittals for "Beta Build", UAT02-MAR-02-0001 and UAT02-MAR-02-0002.
- **Expected result:** Ali sees TMC's people by name and Design Consultants by Company name only: no person of theirs, Pick up, Send to Manager, Internal Note, Recommended Code, answers_changed or Document upload (V5, V14). Nothing of Beta Build's appears in the feed, a List, a count or a search: not its Draft "Beta Build – standby generator, Draft", nor UAT02-MAR-02-0001 (with Beta Build's PM) or UAT02-MAR-02-0002 (Submitted) (V1, V3). No setup changes appear.

## 3. Sign in as Saeed · open UAT 03 · Project Admin (Saeed) (24 cases)

Every case here is run in **UAT 03 · Project Admin (Saeed)**, as the one person named above: open it from Projects, not from Home.

### WF-03 Duplicate a Rabaed Default into the Project

- **Key:** `RP-770` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Workflows: duplicate the MAR Workflow as "UAT MAR copy".
  2. Open it.
- **Expected result:** A draft Version 1 of a new Project Workflow with no link to the original. Only Project Admins see it.

### WF-04 Builder: add a Step, connect, undo, auto-layout

- **Key:** `RP-773` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Workflows: open "UAT MAR copy" (WF-03) in the builder.
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
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Workflows: in "UAT MAR copy", leave a Step with no way forward.
  2. Validate.
  3. Fix it, Publish with no Change Note, then with one.
- **Expected result:** Validate counts the errors and selects the first; Publish lists what changed, the count of items that keep their Version and requires the Change Note. After publishing the builder stays open.

### WF-07 Versions history shows Change Notes and running counts

- **Key:** `RP-781` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Workflows: open the Versions page of "UAT MAR copy" once it has two (WF-05).
  2. Compare two Versions.
- **Expected result:** Newest first with date and Change Note; the N running figure counts only items the reader sees; Compare marks added, removed and changed. Change Notes are the Workflow's authors' only: a plain Member reads the Versions without them.

### WF-08 Exception for one Participant must not name it

- **Key:** `RP-783` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Workflows: copy MAR as "Beta Build MARs" and try to bind it as an exception for Beta Build.
  2. Rename it "MARs, short route" and bind it for Beta Build.
- **Expected result:** The first is refused because the name holds a Participant's name. The second binds: the MAR row lists the exception for Beta Build to the Project Admin, and nothing in the Workflow's name or Versions names a Participant, so others learn of none.

### WF-09 Build a Workflow with a Send Back (fixture FX-SB)

- **Key:** `RP-786` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Workflows: copy the MAR Workflow.
  2. Add a Send Back from Consultant Engineer to the Contractor Draft Step; on the Draft Step set After a Send Back to Comment only (and, in a second copy, to Edit the Form).
  3. Validate, Publish, bind.
- **Expected result:** It validates and publishes. If publish refuses the Send Back, record a Bug: the Send Back visibility cases (VIS-14, VIS-15) need this Workflow.

### WF-11 Transition rules: Restrict, Validate and Effects

- **Key:** `RP-793` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Workflows: in a copy open a Transition > Add rule.
  2. Add Restrict by Position, a Validate with a message in EN and AR, an Effect Offer Assign to.
  3. Test run the Workflow.
- **Expected result:** Rules show under Condition with AND between Restrict rules; Test run opens each pop-up in test mode and saves nothing; a Transition whose Restrict fails is not offered.

### WF-13 Stages and Outcomes pages

- **Key:** `RP-796` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Stages: rename a Stage, add one.
  2. Settings > Outcomes.
- **Expected result:** The changes show in UAT 03's Stage set and its List and Kanban columns; another Project (UAT 01, Al Nakheel) is unchanged. Every Member reads the pages; only a Project Admin changes them.

### WF-14 Library: save, mark default, new Project copies it

- **Key:** `RP-805` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Library > Workflows: save "UAT MAR copy" from Projects > UAT 03 · Project Admin (Saeed) (WF-03) to the Library.
  2. Mark it default for MAR.
  3. Projects > New Project "UAT WF-14 Library check", code UATL, role Contractor.
- **Expected result:** The Library copy has no link to the original; the new Project starts with a copy as its MAR Workflow, bound. A plain Member sees the Library read-only.

### FRM-09 Screens: read, edit and publish in Project Settings

- **Key:** `RP-836` · **Part:** FRM · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Screens: open Code reply.
  2. Edit a copy, publish a new Version.
- **Expected result:** Every Member reads Screens; only Project Admins change them. An item already running keeps the Screen Version its Workflow Version pinned; new Workflow Versions pick the new one.

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
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Trades and Locations: add a Trade, a Zone, a Building, a Floor, a Scope and Sub-scope.
- **Expected result:** Each is added with its names in EN and AR, the Locations under their parents. Only a Project Admin adds them; every Project Member reads the Trades, Scopes and Locations (V16, VIS-30).

### PAR-07 Grant Participant Visibility and read the Visibility Gap warning

- **Key:** `RP-862` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Visibility: give Design Consultants LLC Electrical only.
  2. Take Mechanical Works out of every Participant's Visibility.
- **Expected result:** The grant saves. A Visibility Gap warning names the value no active Participant covers. It is worked out from Participant grants alone (V16).

### PAR-10 Participant Codes and Numbering settings

- **Key:** `RP-870` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Numbering: read the pattern and examples.
  2. Set Al Waha PMC's Participant Code (2 to 6 letters or digits); try to change TMC's, which TMC's UAT03-MAR-01-0001 "PAR-10 Cable trays – numbered with TMC's code" already carries.
  3. Save a pattern that leaves out the Participant Code.
- **Expected result:** Examples use the Admin's real next numbers. TMC's code is in use and cannot change; Al Waha's can be set. Leaving out the Participant Code is refused until the shared-counter warning is accepted.

### PAR-11 Show Inspections inside the Submittals tab

- **Key:** `RP-874` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Modules: choose Inside the Submittals tab.
  2. Open the Project's tabs.
- **Expected result:** The Inspections tab is hidden; WIRs show in the Submittals List and Kanban with WIR as one more Type. Switching back restores the tab. Only a Project Admin changes it.

### PAR-12 Approved Supplier List: add and withdraw by hand

- **Key:** `RP-877` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Approved Supplier List: add a supplier for Mechanical Works; withdraw "Eastern Province Building Materials" (Civil Works).
- **Expected result:** Entries show name, Trade, Scope and status; the withdrawn one stays listed as withdrawn. No source, person or time shows (V10). Only a Project Admin adds or withdraws.

### INS-01 Checklist Templates: create, edit into Version 2, retire

- **Key:** `RP-791` · **Part:** INS · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Checklist Templates > New: name EN and AR, Trade, items with answers, comment and photo rules and Raise a Snag.
  2. Save; edit and Save as Version 2.
  3. Retire one.
- **Expected result:** The three seeded templates (Cable containment and wiring, Pipework installation, Concrete pour) are listed per Trade with items, Version and availability. Saving makes the next Version, and WIRs that copied an earlier one keep its items. Only a Project Admin changes them.

### INS-02 Required links setting

- **Key:** `RP-800` · **Part:** INS · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Required links: turn on Approved submittals required.
- **Expected result:** The setting saves and says what it requires: with it on, a WIR cannot leave Draft without an Approved submittal, and its form names the field. Every Member reads the setting; only a Project Admin changes it.

### UX-12 Members, Participants and a Member Visibility page

- **Key:** `RP-934` · **Part:** UX · **Round:** 0
- **Sign in as:** Saeed (Authorized Person, Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. My Company > Members and Participants.
  2. Projects > UAT 03 · Project Admin (Saeed) > Participants: open a Participant and a TMC Member's Visibility page; narrow and save.
- **Expected result:** Laid out as design/prompts/participants.md: Trades and Locations pickers usable with many values, the Visibility Gap warning readable, counts only of the viewer own Company.

### UX-13 Project Settings pages

- **Key:** `RP-935` · **Part:** UX · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings: open each page: Trades and Locations, Visibility, Modules, Stages, Outcomes, Required links, Approved suppliers, Checklist Templates, Screens.
  2. Do one change on each.
- **Expected result:** Every page uses the Settings template of the kit and project-settings.md: one layout, save and cancel in the same place, Arabic mirrored. (The read-only state for a plain Member is Ali's, VIS-30.)

### UX-14 Settings > Numbering

- **Key:** `RP-936` · **Part:** UX · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Numbering, EN and AR.
  2. Edit a pattern; read the preview and the shared-counter warning.
- **Expected result:** Matches settings-numbering.html and D:\Artifacts\Rabaed Document Numbering.html: pattern builder, preview left to right, warning wording.

### UX-15 Settings > Workflows, the builder and the Library

- **Key:** `RP-937` · **Part:** UX · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Settings > Workflows: a Workflow, its Versions.
  2. Open the builder: add a Step, connect, undo, auto-layout, Validate, Publish.
  3. Open the Library.
- **Expected result:** Matches settings-workflows.html with wf/, D:\Artifacts\Rabaed Settings Workflows.html and Rabaed Workflow Builder V2.html: canvas, Step panel, problems list, Change Note; usable at 1366.

### VIS-33 Member Visibility pages belong to their own Company

- **Key:** `RP-840` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 03 · Project Admin (Saeed) > Participants: open TMC's Participant, its Members and Hafiz's Visibility page.
  2. Open Design Consultants LLC's Participant, then look for its Members and Sara's Visibility page.
- **Expected result:** Saeed reads and sets TMC's own Members' Visibility. For Design Consultants he reads the Participant's grant (every Trade and Location of UAT 03, which he set), never its Members or how it splits its Visibility among them: nothing shows that Sara covers Mechanical Works only, and a Design Consultants Member's Visibility page is the plain 404, even by its address (V16).

### VIS-44 Members page counts only the viewer own Company Projects

- **Key:** `RP-875` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. My Company > Members.
- **Expected result:** The list holds TMC's people only, never a Design Consultants, Beta Build or Al Waha person (V15). Its Projects column counts each TMC Member's active Projects of TMC's own (every UAT Project among them for Hafiz and Ali); nothing of another Company's Projects.

## 4. Sign in as Ahmed · open UAT 04 · Consultant Engineer (Ahmed) (13 cases)

Every case here is run in **UAT 04 · Consultant Engineer (Ahmed)**, as the one person named above: open it from Projects, not from Home.

### SUB-08 Pick up and Return to pool in the Consultant pool

- **Key:** `RP-707` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed) > Submittals: open UAT04-MAR-01-0004 "SUB-08 Fan coil units – in the Engineers' pool" (Mechanical Works, which Sara covers as well).
  2. Pick up.
  3. Return to pool, then Pick up again.
- **Expected result:** Before the Pick up the item reads "not picked up yet" with both names, Ahmed bin Said and Sara; Mohammed is not in this pool. After the Pick up it is Ahmed's; Return to pool is offered because the pool has two Members, and puts it back with both names. These pool names are Design Consultants' own: TMC reads "With Design Consultants LLC" only (V14).

### SUB-09 The Consultant reads the Form and cannot edit it

- **Key:** `RP-709` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed) > Submittals: open UAT04-MAR-01-0001 "SUB-09 Emergency lighting control panel – with you" (Electrical: Ahmed's at once, as Sara covers Mechanical only).
  2. Read every Form section, open the Datasheet PDF and the Sample photo.
  3. Try to change an answer.
- **Expected result:** Every answer, the Items table and the total are shown read-only; Documents are frozen; the photo shows time and place. No edit control is offered: the Form is the raiser's (V13).

### SUB-10 Send to Manager needs the verification

- **Key:** `RP-712` · **Part:** SUB · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed) > Submittals: open UAT04-MAR-01-0002 "SUB-10 Smoke detectors – send to the Manager".
  2. Send to Manager with the verification empty.
  3. Answer Sample checked Yes, Matches specification No; leave the Verification note empty.
  4. Write the note, set Recommended Code C and an Internal Note; confirm.
- **Expected result:** Steps 2 and 3 are refused: the Verification note becomes required when Matches specification is No. After step 4 the item is at the Consultant Manager Step, with Mohammed, the only Consultant Manager, at once. Ahmed's answers, Recommended Code and Internal Note are in Design Consultants' history only, marked internal (V5).

### FRM-08 The Form belongs to the raiser; replies are Screens

- **Key:** `RP-833` · **Part:** FRM · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed) > Submittals: open UAT04-MAR-01-0003 "FRM-08 Sub-distribution boards – the reply Screens".
  2. Open Send to Manager and read the pop-up's fields; cancel.
  3. Read the Form.
- **Expected result:** The reply is a pop-up Screen (verification, Recommended Code, Internal Note); no Form field is editable by the Consultant. Fields the Screen marks internal never reach TMC (V5, V13). (The Manager's Code pop-up is Mohammed's, UAT 05.)

### INS-07 Inspections tab and the in-Submittals setting

- **Key:** `RP-811` · **Part:** INS · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed) > Inspections: List and Kanban. UAT04-WIR-01-0001 "INS-09 Cable containment Level 03 – inspect on site" and UAT04-WIR-01-0002 are TMC's WIRs, Submitted to Design Consultants.
- **Expected result:** The tab uses the Submittals pages and Stages: List columns, filters and Kanban as for submittals. (With Inside the Submittals tab on, WIRs show in the Submittals List instead: that setting is Saeed's, PAR-11 in UAT 03.)

### INS-09 The Engineer answers the checklist on site

- **Key:** `RP-815` · **Part:** INS · **Round:** 4
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 px: Projects > UAT 04 · Consultant Engineer (Ahmed) > Inspections: open UAT04-WIR-01-0001 "INS-09 Cable containment Level 03 – inspect on site": per item Pass, Fail or N/A, comment and photos.
  2. Fail an item and give it a comment and a photo.
- **Expected result:** Large segmented controls; on a Fail the comment and photo show; a sticky summary counts Pass, Fail and N/A with progress; a failed item can raise a Snag (ticked by default).

### INS-14 WIR shares Stages with submittals

- **Key:** `RP-830` · **Part:** INS · **Round:** 4
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed) > Inspections > Kanban, then Submittals > Kanban.
- **Expected result:** UAT04-WIR-01-0001 "INS-09 Cable containment Level 03 – inspect on site" sits in the Pending Approval column, the same Stage and column name as the Submitted MARs such as UAT04-MAR-01-0001 on the Submittals Kanban.

### NOT-02 Step reached and Submit notify the right people

- **Key:** `RP-873` · **Part:** NOT · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open the bell and Notifications: UAT04-MAR-01-0001 "SUB-09 Emergency lighting control panel – with you" and the other items TMC Submitted in Projects > UAT 04 · Consultant Engineer (Ahmed) reached Ahmed.
- **Expected result:** Each entry reads Reached you at Consultant Engineer and opens the item; the text names TMC as a Company, never a person (V14). Ahmed is told of the Electrical items, which are his alone (Sara covers Mechanical only), and of UAT04-MAR-01-0004, in the pool he shares with Sara. Nothing reaches him of TMC's items still in Internal Review (V1).

### UX-17 Snag List on the desktop

- **Key:** `RP-939` · **Part:** UX · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed) > Snag List: List grouped by Stage, Kanban, type chips, filters, EN and AR. UAT04-SNG-03-0001 "VIS-51 Unlabelled circuit breakers – resolved by TMC" and UAT04-SNG-03-0002 "UX-17 Cracked light diffuser" are Design Consultants' Snags on TMC.
- **Expected result:** Matches snag-list.html: groups, chips, Step Age dots, filters; Comments from Code B shown as designed.

### UX-18 WIR request and on-site inspection on a phone

- **Key:** `RP-940` · **Part:** UX · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. At 375 px (phone): Projects > UAT 04 · Consultant Engineer (Ahmed) > Inspections: open UAT04-WIR-01-0002 "UX-18 Cable containment Level 04 – on a phone" on site: checklist, photos, annotate, EN and AR.
- **Expected result:** Laid out as inspection-on-phone.md: phone-first, large touch targets, camera first, annotate tools reachable with a thumb, nothing cut off.

### VIS-01 A new Draft and a MAR in internal review are TMC's alone

- **Key:** `RP-734` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed): Submittals List, Kanban, Dashboard, Home, Activity Feed and the bell; note every count.
  2. Search for "TMC – cable trays", UAT04-MAR-01-0007, "TMC – wiring devices", "Beta Build" and UAT04-MAR-02-0001.
- **Expected result:** Nothing of TMC's before its Submit appears anywhere: not its Draft "TMC – wiring devices, Draft not sent" nor UAT04-MAR-01-0007 "TMC – cable trays, in Internal Review", and nothing of Beta Build's Draft "Beta Build – standby generator, Draft" or UAT04-MAR-02-0001 (with Beta Build's PM): in no List, Kanban, count, badge, Dashboard figure, search result, feed entry or notification (V1). The counts are of Submitted items only. (TMC's own reading of its Draft and Internal Review is Hafiz's and Ali's.)

### VIS-23 Who holds an item: pool names stay inside the holding Company

- **Key:** `RP-804` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed) > Submittals: open UAT04-MAR-01-0005 "VIS-23 Fan coil units – stays in the Engineers' pool" (leave it in the pool) and read With on the item, List and Kanban.
  2. Open UAT04-MAR-01-0006 "VIS-23 Wiring devices – Code B, Comments with TMC" and its Comment in the Snag List, which waits in TMC's pool.
- **Expected result:** Design Consultants' own item reads its pool's names ("not picked up yet: Ahmed bin Said, Sara"), then the holder. The Comment reads "With TMC Constructions" only: never a TMC person, its pool's names or who picks it up, in the item, List, Kanban, history, feed or notifications (V14). (TMC's half, reading Design Consultants by name only, is Hafiz's and Ali's.)

### VIS-51 Snag Steps are shared only as Transitions

- **Key:** `RP-905` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ahmed (DCL engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 04 · Consultant Engineer (Ahmed) > Snag List: open UAT04-SNG-03-0001 "VIS-51 Unlabelled circuit breakers – resolved by TMC", which Ahmed raised on TMC and TMC resolved.
  2. Read its history.
  3. Verify: Pick up if it is offered, then Close it, or Return to Open with a reason.
- **Expected result:** Ahmed reads TMC's Resolve and its note ("Done and checked on site."), never who in TMC picked it up or TMC's own moves; TMC is named as a Company only (V5, V14). The Verify Step is Design Consultants': once he holds it, Close and Return to Open are offered to him.

## 5. Sign in as Mohammed · open UAT 05 · Consultant Manager (Mohammed) (12 cases)

Every case here is run in **UAT 05 · Consultant Manager (Mohammed)**, as the one person named above: open it from Projects, not from Home.

### SUB-11 Code A closes the item with the final verification

- **Key:** `RP-716` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Submittals: open UAT05-MAR-01-0001 "SUB-11 Main distribution board – recommended Code A" (Ahmed sent it with Recommended Code A); Approve A.
  2. Check the Final verification pop-up is filled from Ahmed's reply; leave Remarks empty.
  3. Confirm.
- **Expected result:** Remarks are optional with Code A. The item closes Approved, Code A, and accepts no more moves. Download PDF appears (SIG-02).

### SUB-12 Code B turns each comment into a Comment

- **Key:** `RP-718` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Submittals: open UAT05-MAR-01-0002 "SUB-12 Lighting control panel – recommended Code B".
  2. Approve with Comments B with the Remarks empty, then with Remarks and three comment rows; confirm.
- **Expected result:** Remarks are required with B. The MAR closes at Code B. Three Comment items are in the Snag List, raised by Design Consultants and Open with TMC Constructions (by Company name only, V14). The MAR page reads "Comments: 3 open / 0 closed".

### SUB-13 Code C needs Remarks and Return to Engineer works

- **Key:** `RP-720` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Submittals: open UAT05-MAR-01-0003 "SUB-13 LED downlights – Return to Engineer"; Return to Engineer, reason "Check the photometric report".
  2. Open UAT05-MAR-01-0004 "SUB-13 Smoke detectors – Code C needs Remarks" (Ahmed sent it with Matches specification No); Revise and Resubmit C with Remarks empty, then with Remarks.
- **Expected result:** Return to Engineer gives UAT05-MAR-01-0003 back to Ahmed, inside Design Consultants (TMC reads With Design Consultants LLC throughout, V14). Code C on UAT05-MAR-01-0004 is refused until Remarks are written, then it closes at C with its Remarks and final verification; TMC is offered Create Revision.

### SUB-20 A SAR closed at Code A adds the supplier to the list

- **Key:** `RP-739` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Submittals: open UAT05-SAR-01-0001 "SUB-20 Delta Cables – Supplier Approval Request" (Electrical; Ahmed sent it with Recommended Code A); Approve A and confirm.
  2. Projects > UAT 05 · Consultant Manager (Mohammed) > Settings > Approved Supplier List.
- **Expected result:** The SAR closes at Code A. "UAT SUB-20 Delta Cables" is listed for Electrical Works, approved, with no source, person or time (V10). A MAR of UAT 05 now offers it under Approved supplier.

### SUB-28 Activity Feed page

- **Key:** `RP-759` · **Part:** SUB · **Round:** 0
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Activity Feed.
- **Expected result:** Entries read as events (submitted, returned, approved) with the Project; TMC appears by Company name only (V14); no answers_changed or Document upload entries; nothing of TMC's or Beta Build's Drafts (V1).

### WF-01 Every Member reads the Project Workflows

- **Key:** `RP-763` · **Part:** WF · **Round:** 0
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Settings > Workflows.
  2. Open the MAR Workflow and a published Version.
- **Expected result:** The page lists which Workflow each Work Item Type runs, its Version and every published Version whole, with every Company's Steps and Returns (V14). Mohammed cannot open the builder or see a draft.

### PKG-09 Bulk Transition applies one Action Form to many

- **Key:** `RP-690` · **Part:** PKG · **Round:** 1
- **Sign in as:** Mohammed (DCL manager, with a Signature)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Submittals > Packages: open "PKG-09 Package waiting at the Manager" (TMC's, In Progress): UAT05-MAR-01-0005 "PKG-09 Exit signs – bulk Code A" and UAT05-MAR-01-0006 "PKG-09 Wiring devices – bulk Code A" both wait at Mohammed with Recommended Code A.
  2. Select both, choose Approve A, fill the Action Form once, confirm.
- **Expected result:** With a Signature: one Action Form applies to each item; each is signed exactly as a single Transition is and gets its own event, Issued Code and Documental Record. Bulk is offered only while every selected item offers the same Transition and Action Form; had one not, nothing would be done and the message would name it. (The bulk Code by a Design Consultants Member without a Signature is not in this section.) Owner decision 2026-10-19 (story 44 reworded on RP-616).

### SNG-10 Question and Site Observation Types

- **Key:** `RP-778` · **Part:** SNG · **Round:** 3
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Snag List > New > Question; then New > Site Observation.
- **Expected result:** The Type chips appear; each has its own Form and Workflow; Questions have no reviewed item behind them; Site Observation is not called Violation.

### SNG-14 Pick the Contractor when two cover a Location

- **Key:** `RP-787` · **Part:** SNG · **Round:** 3
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Snag List > New Snag: Subject "UAT SNG-14 Exposed cable", Trade Electrical Works, Location Tower A Level 03 (TMC and Beta Build both cover every Location of UAT 05).
  2. Raise.
- **Expected result:** The Raise pop-up asks which Contractor (TMC Constructions or Beta Build); pick TMC. The Snag is Open with TMC, and Beta Build never sees it (V3).

### INS-11 The Manager proposes a Code from the checklist

- **Key:** `RP-821` · **Part:** INS · **Round:** 4
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Inspections: open UAT05-WIR-01-0001 "INS-11 Cable containment Level 02 – all passed" and UAT05-WIR-01-0002 "INS-11 Cable containment Level 03 – one failed" (Ahmed failed "Cables labelled at both ends").
  2. Open the Code pop-up on each; cancel.
- **Expected result:** The pop-up pre-selects A on the one with no failed item and C on the one with a failed item; the Manager can change it; each pop-up lists the Snags that will be raised, if any.

### INS-12 A WIR ends with a Review Code and a re-inspection Revision

- **Key:** `RP-824` · **Part:** INS · **Round:** 4
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Inspections: close UAT05-WIR-01-0003 "INS-12 Cable containment Level 04 – for Code A" at A, UAT05-WIR-01-0004 "INS-12 Cable containment Level 05 – for Code B" at B (with comment rows), UAT05-WIR-01-0005 "INS-12 Cable containment Level 06 – for Code C" at C and UAT05-WIR-01-0006 "INS-12 Cable containment Podium Level 01 – for Code D" at D.
- **Expected result:** A to D close like a submittal; B makes Comments; C offers TMC a Revision as a re-inspection that copies the same checklist; D closes. No Passed or Failed result is shown.

### VIS-12 A Revision Draft is hidden; the drop-down lists only what the viewer sees

- **Key:** `RP-772` · **Part:** VIS · **Round:** 0
- **Sign in as:** Mohammed (DCL manager)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 05 · Consultant Manager (Mohammed) > Submittals: open UAT05-MAR-01-0007 "VIS-12 Cable trays – Code C, Rev 1 inside TMC", closed at Code C; TMC raised its Rev 1 and sent it for review, so it is in TMC's Internal Review.
  2. Open its Revisions drop-down, the List and Kanban, and search for "VIS-12 Cable trays", "TMC – earthing" and "Beta Build".
- **Expected result:** Mohammed reads UAT05-MAR-01-0007 at Code C, and the drop-down lists only what he sees: Rev 1 is nowhere (no row, card, count, search result or notification) until TMC Submits it. TMC's Draft "TMC – earthing, Draft not sent" and Beta Build's Draft "Beta Build – standby generator, Draft" appear nowhere either (V1).

## 6. Sign in as Layla · open UAT 06 · Consultant Authorized Person (Layla) (7 cases)

Every case here is run in **UAT 06 · Consultant Authorized Person (Layla)**, as the one person named above: open it from Projects, not from Home.

### PAR-03 An email that belongs to another Company is refused without naming it

- **Key:** `RP-851` · **Part:** PAR · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Members > Invite hafiz.hamdan@tmc.demo.rabaed.test.
  2. Invite ahmed.binsaid@designconsultants.demo.rabaed.test, one of your own Company's.
- **Expected result:** Refused: the person is already registered on Rabaed with another Company. TMC is never named and nothing else about Hafiz shows. Ahmed's email gives the ordinary already-a-Member answer. Nobody is invited or added.

### PAR-08 The Authorized Person adds a Member to the Project with a Position and Visibility

- **Key:** `RP-864` · **Part:** PAR · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Participants > UAT 06 · Consultant Authorized Person (Layla): add Mohammed, who is on every other UAT Project but not this one, with Position Manager.
  2. Open his Visibility and narrow his Trade to Electrical Works only.
  3. Try to give him Civil Works too.
- **Expected result:** Mohammed joins UAT 06 as Manager. Narrowing saves. Civil Works is refused: on UAT 06 Design Consultants covers Electrical and Mechanical Works only, and a Member never covers more than their Company (V4).

### PAR-13 Company Projects page

- **Key:** `RP-880` · **Part:** PAR · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Company Projects (sidebar).
- **Expected result:** Each Project Design Consultants takes part in shows its name, code, Host Company, Design Consultants' own Project Role and its own Project Members, the ten UAT Projects (UAT 01 to UAT 10) among them: an Authorized Person sees every Project of her Company (V15). On UAT 06 the only Member is Ahmed; on the others Ahmed, Sara and Mohammed. Never another Participant or its people.

### VIS-03 Access follows the current grant, not the grant date

- **Key:** `RP-738` · **Part:** VIS · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Participants > UAT 06 · Consultant Authorized Person (Layla) > Ahmed's Visibility: he covers Electrical Works at every Location.
  2. Narrow his Location to Tower A only and save.
  3. Give him every Location again and save.
- **Expected result:** Both changes save at once, with no Handover: Ahmed holds no Step on UAT 06. His Visibility reads Tower A only after step 2 and every Location after step 3: what he may see follows the grant as it is now, not as it was given. Only Design Consultants' own Members show.

### VIS-34 Narrowing has limits and Handover tells only counts across Companies

- **Key:** `RP-843` · **Part:** VIS · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Participants > UAT 06 · Consultant Authorized Person (Layla) > Ahmed's Visibility: try to give him Civil Works.
- **Expected result:** Refused: a Member never covers more than the Participant (V4), and on UAT 06 Design Consultants covers Electrical and Mechanical Works only. Nothing changes, and the refusal names no other Company.

### VIS-35 Visibility Gap warnings show only what the viewer is entitled to

- **Key:** `RP-846` · **Part:** VIS · **Round:** 0
- **Sign in as:** Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Participants > UAT 06 · Consultant Authorized Person (Layla): read the warnings.
- **Expected result:** Layla is warned that no Design Consultants Project Member covers Mechanical Works on UAT 06: Design Consultants covers it, but Ahmed, its only Member there, covers Electrical Works only (Mohammed too, if PAR-08 ran first). Only Design Consultants' own Members count towards it; no other Participant or Company is named.

### VIS-63 Removed Members, withdrawn Participants and closed Projects

- **Key:** `RP-918` · **Part:** VIS
- **Sign in as:** Layla (DCL Authorized Person)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Participants > UAT 06 · Consultant Authorized Person (Layla): look for a way to remove a Member from the Project, to withdraw a Participant or to close the Project.
- **Expected result:** Not built yet: none of these is offered. When built (E2): a removed Member keeps the Project name and the records they signed; Layla sees only the records Design Consultants' Members signed; open items of a withdrawn Participant are Cancelled; a closed Project is read-only with its records still there.

## 7. Sign in as Noura · open UAT 07 · Owner Representative (Noura) (7 cases)

Every case here is run in **UAT 07 · Owner Representative (Noura)**, as the one person named above: open it from Projects, not from Home.

### SUB-21 A DAR ends with the Owner's review

- **Key:** `RP-741` · **Part:** SUB · **Round:** 0
- **Sign in as:** Noura (Al Waha PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 07 · Owner Representative (Noura) > Submittals: open UAT07-DAR-01-0001 "SUB-21 Cable schedule – recommended Code A", which Hafiz raised, Ali Submitted and Mohammed recommended at Code A; it waits at your Owner's review.
  2. Pick it up if it is in the pool, read Mohammed's Recommendation and choose Confirm.
- **Expected result:** Noura reads the Recommended Code A, which only Design Consultants and the Participant holding the review read (V5). Confirm issues Code A and closes UAT07-DAR-01-0001 as Approved, and its Documental Record can be downloaded.

### I18N-03 Document Numbers stay left to right

- **Key:** `RP-904` · **Part:** I18N · **Round:** 0
- **Sign in as:** Noura (Al Waha PM, uses Arabic)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In /ar open Projects > UAT 07 · Owner Representative (Noura) > Submittals: the List.
  2. Open UAT07-MAR-01-0002 and its Links, which name UAT07-MAR-01-0001.
  3. Open the bell.
  4. Download UAT07-MAR-01-0001's PDF.
- **Expected result:** UAT07-MAR-01-0002 and UAT07-MAR-01-0001 read left to right, whole, in every place, also inside Arabic text, with Latin digits.

### I18N-05 Rabaed opens in Arabic; a switch to English is remembered

- **Key:** `RP-686` · **Part:** I18N · **Round:** 0
- **Sign in as:** Noura (Al Waha PM, uses Arabic)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In a browser set to English, sign in.
  2. Switch to English.
  3. Sign out and sign in again.
  4. Switch back to Arabic, so the rest of the section opens in Arabic.
- **Expected result:** Rabaed opens in Arabic; after switching to English it opens in English next time; the browser's language doesn't matter.

### VIS-02 After the Submit only the covering Consultant and oversight see the MAR

- **Key:** `RP-736` · **Part:** VIS · **Round:** 0
- **Sign in as:** Noura (Al Waha PM, oversight)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 07 · Owner Representative (Noura) > Submittals: open UAT07-MAR-01-0002 "VIS-02 Exit signs – Submitted to Design Consultants".
  2. Look for UAT07-MAR-01-0003 and "TMC – wiring devices, Draft not sent" in the List, search and Kanban.
- **Expected result:** Noura reads UAT07-MAR-01-0002 read-only, as oversight: no Transition, no pick-up, not in her Need My Action. TMC's UAT07-MAR-01-0003, in its Internal Review, and its Draft "TMC – wiring devices, Draft not sent" appear nowhere, not even as a count: before the Submit they are TMC's alone (V1).

### VIS-06 Chat is visible to every Participant that has the item

- **Key:** `RP-745` · **Part:** VIS
- **Sign in as:** Noura (Al Waha PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 07 · Owner Representative (Noura) > Submittals: open UAT07-MAR-01-0002 and look for its Chat.
- **Expected result:** Not built yet: the item has no Chat. When built (V6): Noura reads what TMC and Design Consultants post on it, messages can't be edited or deleted, and Chat is not on the closed record.

### VIS-07 Only people who see a closed item can download its record

- **Key:** `RP-764` · **Part:** VIS · **Round:** 0
- **Sign in as:** Noura (Al Waha PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 07 · Owner Representative (Noura) > Submittals: open UAT07-MAR-01-0001 "Main distribution board – Code A", closed by Mohammed.
  2. Download PDF on the item, then from its List row.
  3. Change the item's address to a made-up id and open it.
- **Expected result:** Both downloads give the same Documental Record, the one TMC and Design Consultants read. The made-up id gives the plain not-found page, the same as for an item Noura can't see.

### VIS-24 The Owner review: With Owner review and the Recommended Code

- **Key:** `RP-807` · **Part:** VIS · **Round:** 0
- **Sign in as:** Noura (Al Waha PM)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 07 · Owner Representative (Noura) > Submittals: open UAT07-DAR-01-0002 "VIS-24 Lighting calculation – recommended Code B", waiting at your Owner's review.
  2. Read the Recommended Code and Mohammed's Comments table.
  3. Send it back to Design Consultants.
- **Expected result:** While Noura holds the review she reads the Recommended Code B and its Comment row; no Code is issued yet, so the List, Kanban and workflow map show UAT07-DAR-01-0002 at the Owner's review, not Approved. Send Back returns it to Design Consultants' Manager and it leaves her Need My Action; the Recommended Code stays between Design Consultants and Al Waha (V5).

## 8. Sign in as Yousef · open UAT 08 · Rival Contractor (Yousef) (10 cases)

Every case here is run in **UAT 08 · Rival Contractor (Yousef)**, as the one person named above: open it from Projects, not from Home.

### I18N-08 The not-found page says nothing

- **Key:** `RP-695` · **Part:** I18N · **Round:** 0
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open a made-up item address: /en/work-items/00000000-0000-4000-8000-000000000000.
  2. Open a made-up Project address: /en/projects/00000000-0000-4000-8000-000000000000.
  3. Repeat both in /ar.
- **Expected result:** Every one shows the same page: We can not find this page, it may not exist, or you may not have access, with a Projects button; identical in both languages; never a 403 or a hint which case it is.

### VIS-05 Code B Comments reach the reviewed item's raiser only

- **Key:** `RP-742` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 08 · Rival Contractor (Yousef) > Snag List: look for the Comment "Submit the factory test certificates before delivery: lighting control panel, UAT 08." in the List, its counts, filters and Kanban.
  2. Submittals: look for UAT08-MAR-01-0002, TMC's lighting control panel closed at Code B.
- **Expected result:** Yousef sees neither the Comment nor UAT08-MAR-01-0002 anywhere, not even as a count: a Comment is seen exactly where its reviewed item is, and Beta Build never sees TMC's work (V3).

### VIS-18 Dashboard counts follow what the viewer may see

- **Key:** `RP-795` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 08 · Rival Contractor (Yousef) > Dashboard: read the MAR card.
  2. Open Submittals and compare each figure with the List.
- **Expected result:** Every figure counts only Beta Build's own items: your Draft "VIS-18 Beta Build – earthing, your Draft", UAT08-MAR-02-0001 with you as PM and UAT08-MAR-02-0002 Submitted. Nothing of TMC's counts or lists: not UAT08-MAR-01-0001 Submitted, UAT08-MAR-01-0003 in its Internal Review, nor "TMC – wiring devices, Draft not sent" (V3). Each card count equals the List's.

### VIS-26 Workflow authoring is 404 for everyone but the authors

- **Key:** `RP-819` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 08 · Rival Contractor (Yousef) > Settings > Workflows: open the MAR Workflow and its published Version.
  2. Try Duplicate, Save, Publish and Bind wherever they show.
  3. Open the Workflow's own page (Settings > Workflows > its name), where its authors edit it.
- **Expected result:** Yousef reads the published Version whole. No authoring action is offered, the Workflow's own page is the plain not-found page naming nothing, as for a made-up id, and nothing changes: only the Project Admin authors Workflows.

### VIS-45 The Approved Supplier List is Project-wide but hides its source

- **Key:** `RP-878` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 08 · Rival Contractor (Yousef) > Settings > Approved Suppliers (Electrical Works): find "UAT 08 Delta Cables".
  2. Look for the Supplier Approval Request that added it, UAT08-SAR-01-0001: its Links, who added it and when.
  3. Submittals > New Submittal > Material Approval Request "UAT VIS-45 Cables from the approved supplier": choose UAT 08 Delta Cables as the supplier and save the Draft.
- **Expected result:** Yousef reads the supplier's name, Trade, Scope and status, never UAT08-SAR-01-0001, its person, its time or that TMC raised it; the SAR is in no List or search of his (V3). His Draft's supplier reads UAT 08 Delta Cables.

### VIS-50 A Snag raised on one Contractor is invisible to the other

- **Key:** `RP-893` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 08 · Rival Contractor (Yousef) > Snag List: look for UAT08-SNG-03-0001 "TMC – unlabelled breakers, In Progress with TMC" in the List, its counts, Kanban and the Company, Raised from and Comment Type filters.
- **Expected result:** Yousef sees UAT08-SNG-03-0001 nowhere, not even as a count; the Company filter offers only Beta Build and Raised from offers nothing of TMC's (V3).

### VIS-52 A Snag stays with the Contractor that holds it

- **Key:** `RP-907` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 08 · Rival Contractor (Yousef) > Snag List: look for UAT08-SNG-03-0002 "TMC – loose cable tray cover, Returned to Open", which Design Consultants raised on TMC, TMC resolved and Ahmed Returned to Open.
- **Expected result:** Every move, the Return included, stayed with TMC: Yousef never sees UAT08-SNG-03-0002 in the Snag List, a count or search, though Beta Build covers the same Trade and Location (V3).

### VIS-53 A Snag a Contractor raises on itself is invisible to the others

- **Key:** `RP-908` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 08 · Rival Contractor (Yousef) > Snag List: look for UAT08-SNG-01-0001 "TMC – missing socket cover, raised by TMC, Closed" in the List, the Closed column, counts and search.
- **Expected result:** Yousef never sees UAT08-SNG-01-0001, at any Stage: not in the List, Kanban, a count or search (V3).

### VIS-55 Checklist Templates are Project definitions; copies follow the WIR

- **Key:** `RP-910` · **Part:** VIS · **Round:** 0
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 08 · Rival Contractor (Yousef) > Settings > Checklist Templates: read the Project's templates.
  2. Try to change one.
  3. Open Inspections.
- **Expected result:** Yousef reads the Electrical, Mechanical and Civil templates, never who wrote or retired them or when; changing one is refused, as only the Project Admin may. No WIR of TMC's, nor its copy of a template, shows (V3).

### VIS-62 Files Module and Pins on shared Drawings

- **Key:** `RP-917` · **Part:** VIS
- **Sign in as:** Yousef (Beta Build engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 08 · Rival Contractor (Yousef): look for Files and the Drawings.
- **Expected result:** Not built yet. When built: Work Item folders only for items Yousef sees, and Pins only of items he sees, never TMC's.

## 9. Sign in as Omar · open UAT 09 · Contractor Engineer, Podium only (Omar) (4 cases)

Every case here is run in **UAT 09 · Contractor Engineer, Podium only (Omar)**, as the one person named above: open it from Projects, not from Home.

### WF-12 Return goes to the author, not the other engineer

- **Key:** `RP-794` · **Part:** WF · **Round:** 0
- **Sign in as:** Omar (TMC engineer, Podium only)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 09 · Contractor Engineer, Podium only (Omar) > Submittals: open UAT09-MAR-01-0001 "WF-12 Lighting control panel – returned by Ali to Hafiz", at Podium Level 01, which you cover too. Hafiz sent it for review and Ali Returned it.
- **Expected result:** It went back to Hafiz, who sent it, not to Omar: Omar reads it but is offered no Send for Review and no pick-up, and it is not in his Need My Action.

### FRM-11 Member and Participant fields offer only what the filler may see

- **Key:** `RP-842` · **Part:** FRM
- **Sign in as:** Omar (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 09 · Contractor Engineer, Podium only (Omar): on an item with a member or participant field (if the Form offers one) open the choices.
- **Expected result:** Only TMC's own Project Members and TMC and the Host Company are offered; other Companies' people never. After the Submit another Company reads the answer as TMC's name, no person.

### UX-01 App shell, sidebar and top bar match the design

- **Key:** `RP-923` · **Part:** UX · **Round:** 0
- **Sign in as:** Omar (TMC engineer)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Open Projects > UAT 09 · Contractor Engineer, Podium only (Omar) at 1366 and 1920, EN and AR.
  2. Open each sidebar entry and the member menu.
  3. At 820 and 375 open the drawer.
- **Expected result:** Matches saas-shell.html (and D:\Artifacts\Rabaed Responsive Anatomy.html for the drawer): sidebar entries of RP-405 decision 5 only (no Overdue, Payments, Subscriptions, Roles, theme toggle), Company name not a switcher, Arabic mirrored. UI issues and UX recommendations reported apart.

### VIS-09 A Link to an item the viewer cannot see shows number and Subject only

- **Key:** `RP-768` · **Part:** VIS · **Round:** 0
- **Sign in as:** Omar (TMC engineer, Podium only)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 09 · Contractor Engineer, Podium only (Omar) > Submittals: open UAT09-MAR-01-0003 "VIS-09 Emergency lighting control panel – Podium, links the exit signs".
  2. Open its Links, then the Link to UAT09-MAR-01-0002, exit signs at Tower A Level 02, which you don't cover.
  3. Look for UAT09-MAR-01-0002 and Beta Build's UAT09-MAR-02-0001 in the List and search.
- **Expected result:** Omar sees only UAT09-MAR-01-0002's Document Number and Subject; the Link opens on its own page with only You are not allowed to see the details of this item, and that item is in no List or search of his. Beta Build's UAT09-MAR-02-0001, at the same Podium Location, appears nowhere (V3).

## 10. Sign in as Sara · open UAT 10 · Consultant Engineer, Mechanical only (Sara) (3 cases)

Every case here is run in **UAT 10 · Consultant Engineer, Mechanical only (Sara)**, as the one person named above: open it from Projects, not from Home.

### PAR-15 Fixture FX-K1M: Sara covers Mechanical only

- **Key:** `RP-885` · **Part:** PAR · **Round:** 0
- **Sign in as:** Sara (DCL engineer, Mechanical only)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 10 · Consultant Engineer, Mechanical only (Sara) > Submittals: read the List, its counts and your Step Pool.
  2. Search for UAT10-MAR-01-0001.
- **Expected result:** Sara sees UAT10-MAR-01-0002 "PAR-15 Fan coil units – Mechanical, in the Engineers' pool" in her Step Pool, offered Pick up. UAT10-MAR-01-0001, Electrical Works, is in no List, pool, count or search of hers: she covers Mechanical Works only (RP-1207).

### PKG-12 A Package is seen only through submittals the viewer sees

- **Key:** `RP-699` · **Part:** PKG · **Round:** 1
- **Sign in as:** Sara (DCL engineer, Mechanical only)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 10 · Consultant Engineer, Mechanical only (Sara) > Packages: open "PKG-12 Package of both Trades", which Ali Submitted.
  2. Read its submittals and counts.
  3. Look for "PKG-12 Package of Drafts".
- **Expected result:** Sara sees only UAT10-MAR-01-0006, the Mechanical submittal, and the Package counts 1 for her; UAT10-MAR-01-0005, the Electrical one, appears nowhere. The status shows as one word, In Progress. TMC's Open "PKG-12 Package of Drafts" is never shown: not its name, its Draft or a count.

### VIS-47 Required links and Approved submittals reveal only definitions

- **Key:** `RP-884` · **Part:** VIS · **Round:** 0
- **Sign in as:** Sara (DCL engineer, Mechanical only)
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Projects > UAT 10 · Consultant Engineer, Mechanical only (Sara) > Submittals: open UAT10-MAR-01-0004 "VIS-47 Fan coil units – links the distribution board", a Mechanical item in your pool.
  2. Open its Links: UAT10-MAR-01-0003, an Electrical item closed at Code A.
  3. Settings > Required links: read the Project's setting and try to change it.
- **Expected result:** Sara sees UAT10-MAR-01-0003's Document Number and Subject only and can't open it (You are not allowed to see the details of this item); it is in no List or search of hers. She reads which links are required, never who set it or when, and can't change it: only the Project Admin may.

## 11. Workflows (3 cases)

### WF-06 A new Version applies to new items only

- **Key:** `RP-779` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed; Hafiz; Ali
- **Left for the owner:** Saeed binds a new Workflow Version, then Hafiz raises and Ali reads: three people in turn.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Bind the published copy to MAR (Settings > Workflows > Use for MAR).
  2. Hafiz raises a new MAR.
  3. Open an older MAR.
- **Expected result:** The new MAR runs the new Version; the older item keeps its Version and shows a notice that a later Version exists. Binding another Workflow reaches only items created afterwards.

### WF-10 Drafts visible to: the author only

- **Key:** `RP-790` · **Part:** WF · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Hafiz; Omar; Ali
- **Left for the owner:** Saeed changes the Draft Step, then Hafiz saves and Omar and Ali look: four people in turn.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. In a copy, set the Draft Step to Drafts visible to the author only; publish and bind.
  2. Hafiz saves a Draft.
  3. Omar and Ali open the List and the item URL.
- **Expected result:** Omar and Ali see no Draft, no count, and the 404 page; Hafiz sees and edits it. After Send for Review TMC reads it as before.

### WF-17 Assign to offers only your own Company's Members

- **Key:** `RP-812` · **Part:** WF · **Round:** 0 · **Needs:** setup
- **Sign in as:** Saeed (Project Admin); Hafiz; Ali
- **Left for the owner:** Saeed adds Assign to to the FX-SB copy, then Hafiz and Ali use it: three people and a Workflow change.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Saeed: in the Project's MAR Workflow (fixture FX-SB copy) add Assign to on Send for Review and on Submit; publish.
  2. Hafiz: new MAR, Send for Review, open Assign to.
  3. Ali: Submit, open Assign to.
- **Expected result:** Hafiz is offered only TMC Members who may hold the Contractor PM Step; Ali only TMC Members (never a DCL engineer by name; the Consultant is one Participant). A pick it could not have offered is refused like a made-up one. Carried over from RP-463 B-06 (RP-487).

## 12. Participants and Visibility setup (4 cases)

### PAR-06 Invite a Company by CR number and accept

- **Key:** `RP-859` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Layla (DCL Authorized Person)
- **Left for the owner:** Saeed's invitation isn't staged: a UAT Project would need Design Consultants invited and not yet accepted, and accepting can't be undone.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On a UAT Project invite CR 9999000003 as Consultant.
  2. Layla: Company Projects shows the invitation (name, Host Company, offered role).
  3. Accept.
- **Expected result:** Until accepted, only Layla and the Project Admin see it; TMC's other Members do not. After accepting, DCL is a Participant in the role Consultant.

### PAR-09 Deactivate a Member: Handover first

- **Key:** `RP-867` · **Part:** PAR · **Round:** 0 · **Needs:** setup
- **Sign in as:** Saeed (Authorized Person)
- **Left for the owner:** Saeed deactivates Hafiz: his Steps on every UAT Project move to others, and it can't be run twice.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz holds two Tower 2 MARs at Contractor Engineer (Omar covers Tower 2 as well) and one Tower 1 MAR (Omar does not cover it).
  2. Saeed: Members > Deactivate Hafiz.
- **Expected result:** The Handover dialog lists his open Steps and Drafts (Project, Document Number or No number yet, Subject, Step). The Tower 2 Steps pre-fill Omar as the single candidate. The Tower 1 Step has nobody else who can take it, so the change is refused with Nobody else can take <Step> on <Project>. Give someone the Position or Visibility first, naming only TMC's own Step and the Project; nothing saves until every Step has a new holder.

### PAR-14 Fixture FX-C2: narrow Beta Build to Tower 2

- **Key:** `RP-883` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Yousef
- **Left for the owner:** Saeed narrows Beta Build (FX-C2) and Yousef checks: two people; the UAT Projects keep Beta Build on every Location for the V3 checks.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Settings > Visibility: set Beta Build Location to Tower 2 only.
  2. Yousef signs in.
- **Expected result:** The change saves (Yousef holds nothing, so no Handover). Yousef sees only Tower 2 items from then on, and TMC is the only Contractor covering Tower 1, which the Snag scenarios need.

### PAR-16 Fixture FX-OW: invite UAT Owner Co as Owner

- **Key:** `RP-889` · **Part:** PAR · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Reem UAT (Owner Co Authorized Person)
- **Left for the owner:** Needs UAT Owner Co, which ADM-02 onboards, and its people: no UAT Project has them.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. After ADM-02 onboards UAT Owner Co (CR 9999000005), Saeed invites that CR as Owner on Riyadh Gate Tower.
  2. Reem accepts, grants Electrical and Mechanical, all Locations, and adds a PM Member (Sami UAT) with Position Project Manager.
- **Expected result:** UAT Owner Co is a Participant with oversight over Submitted items it covers. Later Owner scenarios use it.

## 13. Packages (1 cases)

### PKG-06 Status runs Open, In Progress, Done

- **Key:** `RP-901` · **Part:** PKG · **Round:** 1
- **Sign in as:** Ali; Mohammed
- **Left for the owner:** Ali and Mohammed take one Package from Open to Done, with a Revision and a replacement: two people in turn.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Submit the Package.
  2. Close the items at A, B, C and D over time.
  3. Create a Revision for the Code C item and a replacement for D.
- **Expected result:** In Progress as soon as anything is submitted. Done only when every latest submittal has closed at A, B or D; a Code C waits for its Revision, which joins the Package by itself; a later replacement or added submittal puts it back In Progress. The word is Done, never Closed.

## 14. Signing and Documental Record (6 cases)

### SIG-04 The record names everyone on the path and leaves out the rest

- **Key:** `RP-713` · **Part:** SIG · **Round:** 0
- **Sign in as:** Ali (TMC PM); Mohammed
- **Left for the owner:** One MAR through Hafiz, Ali, Ahmed and Mohammed in turn, then its PDF: four people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Take a MAR through Send for Review, a Return, a second send, Submit with Internal Note, Ahmed Send to Manager with Recommended Code C, Mohammed Code A.
  2. Read the PDF.
- **Expected result:** It names every Member who took a Transition on the path, TMC's and DCL's alike, with the first entry dated at the raiser's last send out of Draft (a Returned send is off the path). It holds no Return, Internal Note, Recommended Code, Chat or in-progress answer.

### SIG-09 Company logo and Stamp

- **Key:** `RP-721` · **Part:** SIG · **Round:** 2
- **Sign in as:** Saeed (Authorized Person); Hafiz
- **Left for the owner:** Saeed uploads TMC's logo and Stamp, then Hafiz reads them: two people, and it changes TMC on every Project.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Company profile: upload a logo and a Stamp.
  2. Hafiz opens the profile.
- **Expected result:** Two cards, Logo (optional) and Stamp (required to act), with Replace and the note that records keep the one in force then; only the Authorized Person has the buttons. Without a logo records show the name.

### SIG-10 No Stamp: no Member can act

- **Key:** `RP-724` · **Part:** SIG · **Round:** 2
- **Sign in as:** Hafiz; Saeed
- **Left for the owner:** Needs TMC with no Stamp, which would stop every TMC case on every UAT Project.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With TMC's Stamp missing, Hafiz opens Submit.
  2. Saeed opens it.
- **Expected result:** Before the Action Form: TMC has no Stamp yet, ask its owner or Authorized Person; for Saeed, Add TMC's Stamp with an Add Stamp button. Only the viewer's own Company is named; nothing is written; nobody is notified.

### SIG-11 No Signature: the Add Signature pop-up

- **Key:** `RP-728` · **Part:** SIG · **Round:** 2
- **Sign in as:** Hafiz
- **Left for the owner:** Needs Hafiz with no Signature, which would stop every case of UAT 01.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With no Signature saved open any Transition.
- **Expected result:** Add your Signature to act. Every action you confirm is signed with it. Add Signature goes to the profile and returns to the item with nothing typed lost; Cancel closes.

### SIG-15 Verification page

- **Key:** `RP-747` · **Part:** SIG · **Round:** 2
- **Sign in as:** Anyone (not signed in)
- **Left for the owner:** Run by someone not signed in, with a record's Verification Code: in no person's section.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Scan the QR or open the link.
  2. Type the Verification Code with and without the Document Number.
  3. Drop a copy of the PDF.
- **Expected result:** Genuine, Document Number, Subject, Project, outcome, sealed date, signers' names, Positions and Companies; no Documents, answers or live item. The code alone is refused like a wrong code; attempts are limited per visitor; a dropped copy is checked in the browser against the fingerprint, uploading nothing.

### SIG-17 Distribution link and Signatory Access

- **Key:** `RP-750` · **Part:** SIG · **Round:** 2
- **Sign in as:** Ali (TMC PM); a removed signing Member
- **Left for the owner:** Removes a signing Member and withdraws a Participant (not built): Ali and the removed Member.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Use the record distribution link to send a closed record by the ordinary notification.
  2. Remove a signing Member from the Project and open the records they signed.
  3. Withdraw a Participant and open its Authorized Person records.
- **Expected result:** The record reaches people only through ordinary notifications inside Rabaed. A removed Member keeps the Project name and the records they signed; the Company keeps those its Members signed through its Authorized Person; open items of a withdrawn Participant are Cancelled.

## 15. Snag List (2 cases)

### SNG-02 The Consultant raises a Snag on the Contractor

- **Key:** `RP-752` · **Part:** SNG · **Round:** 0 · **Needs:** setup
- **Sign in as:** Mohammed (DCL manager); Ali (TMC PM)
- **Left for the owner:** Needs FX-C2 (Beta Build off Tower 1) so Mohammed's Raise has one Contractor; the UAT Projects keep both Contractors everywhere.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Needs FX-C2 (PAR-14).
  2. Mohammed: Snag List > New Snag: Subject "UAT SNG-02 Cable tray not bonded", Description, Trade Electrical Works, Location Tower 1 Floor 02, a before photo.
  3. Raise.
- **Expected result:** The Snag is Open with TMC (the one Contractor covering Tower 1). With two Contractors covering the Location, Raise is refused with the plain This can not be handed over yet answer (RP-658 adds the pick).

### SNG-09 Informed Participants

- **Key:** `RP-774` · **Part:** SNG · **Round:** 3
- **Sign in as:** Hafiz; Mohammed
- **Left for the owner:** Hafiz raises and the Informed Participants read: two people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Raise a Snag and name Informed Participants.
- **Expected result:** The named Participants are told and can read; others are not.

## 16. Inspections (WIR) (3 cases)

### INS-08 The WIR runs to the Consultant and the Manager

- **Key:** `RP-813` · **Part:** INS · **Round:** 0
- **Sign in as:** Hafiz; Ali; Ahmed; Mohammed
- **Left for the owner:** One WIR through Hafiz, Ali, Ahmed and Mohammed in turn: four people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz raises a Civil WIR, sends it; Ali Submits it.
  2. Ahmed picks it up.
- **Expected result:** The WIR numbers like a submittal and reaches the Consultant Engineer pool. The Consultant fills the checklist on site (INS-09).

### INS-10 Raise Snags from failed items

- **Key:** `RP-818` · **Part:** INS · **Round:** 4
- **Sign in as:** Ahmed; Mohammed; Hafiz
- **Left for the owner:** Ahmed fails items, Mohammed issues the Code, Hafiz reads the Snags: three people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Fail two items, one with Raise a Snag unticked.
  2. Mohammed issues any Code.
- **Expected result:** Whatever the Code, each ticked failed item becomes a Snag raised by the Consultant for the Contractor, linked to the WIR.

### INS-13 The Contractor reads the checklist only after the Code

- **Key:** `RP-827` · **Part:** INS · **Round:** 4
- **Sign in as:** Hafiz; Ahmed
- **Left for the owner:** Hafiz reads while Ahmed answers, then after the Code: two people in turn.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. While Ahmed answers, Hafiz opens the WIR.
  2. After the Code, again.
- **Expected result:** Before Ahmed sends it to the Manager Hafiz reads none of the answers, comments or photos; after the Code he reads them. Ahmed's Recommended Code and Internal Note never reach Hafiz.

## 17. Submittal Register Import (2 cases)

### IMP-10 Assign to for imported Drafts

- **Key:** `RP-863` · **Part:** IMP · **Round:** 5
- **Sign in as:** Hafiz; Ali
- **Left for the owner:** Hafiz and Ali each take imported Drafts: two people, and a register file the sheet doesn't hand over.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Assign Electrical rows to Hafiz and other rows to Ali, or use an email column.
  2. Include a person who cannot create the Type.
- **Expected result:** Drafts are raised by the importer by default; an assignee who cannot create the Type or does not cover the Trade makes that row bad.

### IMP-11 Packages from an import and saved mappings

- **Key:** `RP-866` · **Part:** IMP · **Round:** 5
- **Sign in as:** Hafiz (TMC engineer)
- **Left for the owner:** Hafiz's, but it needs a register file the sheet doesn't hand over; RP-1248 left it out of UAT 01.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Group rows into one new Package, then one per column value, then an existing Open Package; try an In Progress Package.
  2. Save the mapping and reuse it.
- **Expected result:** New Packages take the next PKG number; an In Progress or Done Package makes its rows bad; the mapping is kept for the Company only.

## 18. Notifications (2 cases)

### NOT-08 A Revision notifies when it gets its number

- **Key:** `RP-891` · **Part:** NOT · **Round:** 0
- **Sign in as:** Hafiz; Ahmed
- **Left for the owner:** Hafiz numbers a Revision, then Ahmed reads his bell: two people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz creates a Revision and keeps it Draft.
  2. Sends it for review.
  3. After the Submit read Ahmed's bell.
- **Expected result:** No revision_created notice while it is a Draft; it is sent when the Revision is numbered; Ahmed is told only after the Submit.

### NOT-09 Sent Back notifies only the Participant it went back to

- **Key:** `RP-894` · **Part:** NOT · **Round:** 0 · **Needs:** setup
- **Sign in as:** Mohammed; Hafiz; Faisal
- **Left for the owner:** Faisal's case: needs FX-SB (WF-09) and Mohammed, Hafiz and Faisal; Faisal has no UAT Project.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Needs FX-SB (WF-09).
  2. Mohammed Sends Back a Submitted item.
- **Expected result:** Hafiz and TMC Members who see it are told, with DCL named as a Company; Faisal is not told of internal moves.

## 19. UI and UX against the design (3 cases)

### UX-16 Register Import wizard and Imports page

- **Key:** `RP-938` · **Part:** UX · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Left for the owner:** Ali's, but it needs a register file the sheet doesn't hand over; RP-1249 left it out of UAT 02.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Run an import: upload, worksheet and header row, mapping, preview with bad rows, confirm.
  2. Open the result page and the Imports page. EN and AR.
- **Expected result:** Laid out as design/prompts/register-import.md, except that no import time is shown (visibility.md wins): each step says where you are, bad rows show every reason, confirm says how many Drafts.

### UX-20 Empty, loading and error states

- **Key:** `RP-942` · **Part:** UX · **Round:** 0
- **Sign in as:** Hafiz; a new Member with no Projects
- **Left for the owner:** Needs a new Member with no Projects, whom the seed doesn't have.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Visit each built page with no data, while loading (slow network), and with the api stopped for a moment.
- **Expected result:** Every page has a designed empty state with a next step, a loading state with no layout jump, and an error that says what to do; the not-found page says nothing about the request.

### UX-25 Add Signature, the no-Signature and no-Stamp pop-ups, Company logo and Stamp

- **Key:** `RP-947` · **Part:** UX · **Round:** 2
- **Sign in as:** Hafiz; Saeed (Authorized Person)
- **Left for the owner:** Hafiz adds a Signature and Saeed TMC's logo and Stamp: two people, and it changes TMC on every Project.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Profile > Add Signature (draw, type, upload).
  2. Take a Transition with no Signature; with a Company with no Stamp.
  3. Company profile: logo and Stamp.
- **Expected result:** Laid out as signature-and-stamp.md and its Claude Design screens (RP-665): clear what is missing and how to add it, EN and AR.

## 20. Visibility (21 cases)

### VIS-10 Linked from lists Submitted items by number and Subject only

- **Key:** `RP-769` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Actors: Mohammed (DCL); Ali, Hafiz (TMC)
- **Left for the owner:** Needs FX-C2, then Hafiz, Ali and Mohammed in turn.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz links his Draft MAR-2 to the Submitted MAR-1.
  2. Mohammed reads MAR-1's Linked from.
  3. Hafiz Submits MAR-2; read again.
  4. Needs FX-C2: Mohammed raises a Snag that links MAR-1; Hafiz reads MAR-1's Linked from.
- **Expected result:** MAR-2 is not listed while it is a Draft or in internal review, then appears. Hafiz sees Mohammed's item as number and Subject; opening it says he may not see its details; its answers, history and Documents stay hidden and its URL is 404.

### VIS-13 A Revision moved to another Location: each oversight Member sees only theirs

- **Key:** `RP-775` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Actors: Hafiz (TMC); Faisal (Tower 1 only), Noura (Tower 2 only) after Hind narrows them
- **Left for the owner:** Hind's case: Hind narrows Faisal and Noura (FX-OR), then Hafiz's Revision, then both read; Hind and Faisal have no UAT Project.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hind narrows Faisal to Tower 1 and Noura to Tower 2 (fixture FX-OR).
  2. Hafiz makes Rev 1 of a Tower 1 MAR, moves it to Tower 2, names the original in a link question and Submits it.
  3. Both read the original, Rev 1, Links, Linked from and the drop-down.
- **Expected result:** Faisal sees the original but no Link to Rev 1 and a drop-down with the original only; Noura sees Rev 1 with no Link, Linked from or link answer naming the original and a drop-down with Rev 1 only. Neither shows even a number or title of the other.

### VIS-14 After a Send Back (Comment only) everyone sees the item as it was

- **Key:** `RP-776` · **Part:** VIS · **Round:** 0 · **Needs:** setup
- **Sign in as:** Actors: Hafiz (TMC). Observers: Mohammed (DCL), Faisal, UAT Owner PM
- **Left for the owner:** Needs FX-SB (WF-09), Ahmed's Send Back, Hafiz and three observers: several people in turn.
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
- **Left for the owner:** Needs FX-SB and FX-OR, Hafiz's changes and four observers: several people in turn.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Needs FX-SB with the Edit the Form setting and FX-OR.
  2. Sent Back item at Tower 1: Hafiz changes an answer, adds a Document, a datasheet and a checklist photo, swaps a Link from X to Y, moves it to Tower 2.
  3. Observers read it through List, Kanban, filters, search, item, Documents, Links, history, feed, bell.
  4. Hafiz Submits again.
- **Expected result:** Until the Submit observers see the item, Documents, Links, Trade, Location and Scopes as they were at the Send Back; new Documents are 404 to them; Faisal (Tower 1) keeps the item and Noura (Tower 2) does not see it; no history entry or notification shows a change. After the Submit the new values apply to everyone: Faisal loses it and Noura gains it.

### VIS-27 Draft Workflows and exception bindings are not public

- **Key:** `RP-822` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Ali, Yousef, Ahmed
- **Left for the owner:** Saeed's draft Workflow and exception binding aren't staged; Ali, Yousef and Ahmed then read them: four people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Saeed saves a draft of a Tower Workflow and a draft renaming a running Workflow.
  2. Bind Beta Build MARs to an exception Workflow (WF-08).
  3. Ali, Yousef and Ahmed open Settings > Workflows and the API.
- **Expected result:** Nobody but the Project Admin reads a draft; the rename stays hidden until published; everyone reads published Versions whole. TMC and DCL read the exception Workflow as a definition but never its binding; only Yousef and the Project Admin learn which Participant it binds.

### VIS-28 A Company's Library is private until used on a Project

- **Key:** `RP-825` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (TMC Authorized Person); Layla (DCL); Hafiz; a Company on no shared Project
- **Left for the owner:** TMC's Library Workflow and Form aren't staged; Saeed saves them, then Layla and Hafiz look: three people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. TMC saves a Workflow and a Form to its Library and marks a default.
  2. Layla and Hafiz open Library and Settings.
  3. Use it on Tower.
- **Expected result:** DCL sees only its own Library; Hafiz lists TMC published Library Workflows read-only; nobody browses another Company Library; a Form appears to others only once used on Tower, and can then be copied; Library Workflow URLs of TMC are 404 to DCL.

### VIS-29 Change Notes and running counts never leak

- **Key:** `RP-828` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Hafiz; Yousef
- **Left for the owner:** Saeed publishes a Change Note on an exception Workflow, then Hafiz and Yousef raise: three people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Publish with a Change Note naming Beta Build on an exception Workflow.
  2. Hafiz and Yousef each raise a Draft.
  3. Reopen the publish dialog and Versions.
- **Expected result:** The Change Note naming a Participant on an exception is refused; N items keep their Version counts only the items the reader sees; only authors read Change Notes.

### VIS-32 Pending invitations: one answer whatever the CR number

- **Key:** `RP-837` · **Part:** VIS · **Round:** 0
- **Sign in as:** Saeed (Project Admin); Layla (DCL Authorized Person); Hafiz
- **Left for the owner:** Saeed's invitations aren't staged (as PAR-06), then Hafiz and Layla look: three people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. On a UAT Project invite a CR on Rabaed (DCL, 9999000003) and a made-up CR 9999000099.
  2. Hafiz looks for DCL anywhere.
  3. Layla opens Company Projects.
  4. Saeed withdraws both invitations.
- **Expected result:** Both invitations show on Saeed list by CR number only and read the same; Hafiz sees DCL nowhere; Layla sees only the invitation (Project name, Host Company, offered role); after the withdrawals both leave Saeed list in exactly the same way and DCL list too; nothing shows which CR number was on Rabaed.

### VIS-36 A refused Submit gives one answer for every reason

- **Key:** `RP-849` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM)
- **Left for the owner:** Needs three Visibility and Position set-ups by the Project Admin before Ali's Submit, each stopping other cases: two people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Submit an Electrical MAR when (a) no Consultant covers Electrical, (b) two Consultants cover it, (c) the covering Consultant has nobody with the Position. Set each up in Settings > Visibility and Positions.
- **Expected result:** Submit is not offered and taking it gives the same answer in all three cases: This cannot be handed over yet: the next step has nobody to take it. Ask a Project Admin. Nothing names a Consultant or says which case it is.

### VIS-37 Documents and photos follow the item's visibility

- **Key:** `RP-854` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Hafiz (TMC). Must NOT see: Yousef (Beta Build), Ahmed (DCL, before the Submit), a TMC Member off the Project
- **Left for the owner:** Hafiz attaches, Ali Submits, and Yousef, Ahmed and an off-Project TMC Member try by id: needs another Company's ids.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz attaches a datasheet and a geotagged photo to a Draft MAR.
  2. Each other person requests the Documents list, a download URL and tries to upload or remove, by the item page and by the API.
  3. Ali Submits.
  4. Ahmed and Yousef again.
- **Expected result:** Before the Submit Yousef, Ahmed and the off-Project Member get the 404 (same as a made-up id) naming nothing. After it Ahmed sees and downloads the Documents and photo with time and place, and TMC as the uploader Company, not the engineer; Yousef still gets 404 for the list and the URLs.

### VIS-40 A Code D replacement is invisible while it is a Draft

- **Key:** `RP-861` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Hafiz (TMC). Must NOT see: Mohammed (DCL), Faisal, UAT Owner PM
- **Left for the owner:** Mohammed rejects, Hafiz replaces, then Mohammed, Faisal and the Owner PM look: several people in turn.
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
- **Left for the owner:** Saeed deactivates Hafiz and Layla deactivates Mohammed: it changes every UAT Project and can't be run twice.
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
- **Left for the owner:** Faisal's case among others: reads Home, which mixes the ten UAT Projects, as five people; Faisal has no UAT Project.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With TMC items in every state (Draft, internal review, Submitted to DCL and OR, Sent Back, Code A, Code C Rev 1) open Home as each.
  2. Compare each figure with that Member List and the Projects page.
- **Expected result:** Yousef: Need My Action 0, 4+ weeks 0, no row or activity of TMC (TMC only as Host Company on the card). Hafiz Draft never counts or lists. Waiting with others counts TMC own items others hold (not Drafts, closed or Sent Back); DCL and OR count 0. Each Project card count equals that Member List count.

### VIS-43 Export, Download and Duplicate respect the viewer

- **Key:** `RP-872` · **Part:** VIS · **Round:** 0
- **Sign in as:** Actors: Hafiz, Ali (TMC); Mohammed (DCL); Yousef (Beta Build); a signed-in stranger
- **Left for the owner:** Hafiz, Ali, Mohammed, Yousef and a stranger each export or try ids: needs another Company's ids.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. With Drafts, a Submitted item picked up by Mohammed and a closed Code C item, Hafiz and Mohammed Export the List (also with a search).
  2. Ali and Mohammed Download.
  3. Mohammed tries Duplicate.
  4. Yousef and the stranger try Download and Duplicate by id.
- **Expected result:** Each export holds exactly that viewer rows and fields (Creation Date for TMC only; the owner is Mohammed to DCL and DCL by name to TMC); Download gives the same shared content to both; Duplicate is refused for Mohammed (one word for every reason) and 404 for Yousef and the stranger.

### VIS-46 Inspections shown inside Submittals reveal nothing extra

- **Key:** `RP-881` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz, Ahmed (see the WIR); Yousef (Beta Build, other Trade or Location)
- **Left for the owner:** Saeed turns Inside the Submittals tab on (PAR-11), then Hafiz, Ahmed and Yousef compare: four people.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Saeed turns Inside the Submittals tab on (PAR-11).
  2. A Submitted TMC WIR exists.
  3. Each reads the Submittals List, counts, type filter, search, Kanban, Need My Action, Projects page count and the WIR URL.
- **Expected result:** Hafiz and Ahmed see the WIR in all of them; Yousef sees it in none and gets 404 by id. The setting widens where own rows show, never which rows.

### VIS-48 An annotated photo has exactly the readers of its original

- **Key:** `RP-887` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz (TMC); Ahmed (DCL); Yousef (Beta Build)
- **Left for the owner:** Hafiz annotates, Ali Submits, Ahmed and Yousef try both copies by id: needs another Company's ids.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz annotates a photo on a MAR and Saves.
  2. Ali Submits.
  3. Ahmed lists and downloads both; Yousef requests the list, both URLs and an annotate call.
- **Expected result:** TMC and DCL list and download both copies, the annotated linked to the original whose bytes are unchanged; Yousef gets 404 for everything, as for a made-up id; the file store refuses either file without a signed URL.

### VIS-49 A WIR Recommended Result or Code stays inside the Consultant

- **Key:** `RP-890` · **Part:** VIS · **Round:** 4
- **Sign in as:** Ahmed, Mohammed (DCL); Hafiz, Ali (TMC); Faisal; Yousef
- **Left for the owner:** Faisal's case among others: Ahmed, Mohammed, Hafiz, Ali, Faisal and Yousef read one WIR in turn; Faisal has no UAT Project.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Ahmed sends a WIR to Mohammed recommending Failed (later: Code C) with an Internal Note; Mohammed Returns it; Ahmed sends it again; Mohammed issues the Code.
  2. TMC and OR read history, feed, events.
- **Expected result:** DCL reads the Recommended Code and Internal Note; TMC and OR read none of it before or after the issued Code, only the Code and the Manager shared reply; Yousef reads nothing of the WIR.

### VIS-54 Raised-from counts include only items the viewer sees

- **Key:** `RP-909` · **Part:** VIS · **Round:** 0
- **Sign in as:** Ali (TMC PM); an Electrical-only TMC engineer; Yousef
- **Left for the owner:** Needs an Electrical-only TMC engineer, whom the seed doesn't have, and Mohammed's Snags.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Mohammed raises a Snag on Tower 1 and two Snags are linked raised from it, one Electrical and one Mechanical.
  2. Each reads the source Snags line.
  3. Mohammed raises a Snag at a Location only Yousef covers.
- **Expected result:** The PM counts 2 open; the Electrical-only engineer sees the Mechanical Snag nowhere and counts 1; a discarded Draft is never counted; Yousef counts only Snags he sees.

### VIS-56 A Register Import is its Company's alone

- **Key:** `RP-911` · **Part:** VIS · **Round:** 0
- **Sign in as:** Hafiz, Ali (TMC); Yousef, Nasser (Beta Build); Ahmed, Mohammed (DCL); Faisal
- **Left for the owner:** Nasser's and Faisal's case among others: Hafiz uploads a register, then TMC, Beta Build, DCL and Al Waha people look; Nasser and Faisal have no UAT Project.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Hafiz uploads and previews a register.
  2. Ali tries to read the preview.
  3. Hafiz confirms.
  4. Everyone opens the Imports page and the import by id.
- **Expected result:** Before confirm only Hafiz reads the preview. After it every TMC Member reads the import, its file name, mapping and rows; Beta Build, DCL and Al Waha see an empty Imports page and the 404 for the import and its confirm; none of its Drafts; no import time anywhere.

### VIS-58 Direct URLs and ids give the same 404 page, never a 403

- **Key:** `RP-913` · **Part:** VIS · **Round:** 0
- **Sign in as:** Nasser (JCV); Yousef; Hafiz
- **Left for the owner:** Nasser's case: needs Nasser's own Project and another Company's item and Comment ids, which no tester can read; Nasser has no UAT Project.
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
- **Left for the owner:** Needs TMC's item, Member and Link ids, which Yousef can't read.
- **Start at:** https://rabaed-uat-web.vercel.app/en
- **Steps:**
  1. Yousef submits a link to a TMC id, picks a hidden Member id through the API, opens a Link page by a TMC Link id, and saves a Form with a hidden reference.
  2. Read every error text and API body.
- **Expected result:** All refusals are the plain, uniform answer; no title, number or Company of another item appears in an error, toast or log shown to the Member.

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
  1. Needs aged items (AGE fixture; the demo has only TWR-MAR-01-0002 and TWR-MAR-01-0003 Rev 1 open and numbered) and the lane engineer to run the job (OQ-2). The demo seed already gives Ali and Yousef the Step Age Report Position, which holds Assign on Submittals (RP-1186). The report covers Submittals only, not WIRs.
  2. Read Ali and Yousef mail and open the link.
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
  2. Ahmed (it is his at once: Sara covers Mechanical only, RP-1207) sends to Manager, Mohammed Returns it to Ahmed.
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
- `tester`: the name of who ran it (the file's `tester` when left out).

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
      "shots": [],
      "tester": "<your name>"
    },
    "RP-686": {
      "status": "fail",
      "comment": "What you saw, against the expected result.",
      "shots": [
        "RP-686:1"
      ],
      "tester": "<your name>"
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

