Design the **Signature and Stamp** screens for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support, Latin digits). Desktop first; Add Signature must also work on a phone, drawn with a finger. Use the Rabaed Claude Design kit (app shell, page templates, tokens) already in the project. RP-665, spec RP-632.

## Context
Companies on a Project move each Work Item (a submittal or an inspection) through its Workflow by taking **Transitions**: Submit, Approve, Code B and so on. When the item closes, Rabaed makes its **Documental Record**, a sealed PDF that looks like the paper transmittals the Companies use today.

- **Signature:** every Member has one, drawn, typed or uploaded in their profile. Every Transition they confirm applies it, together with who acted and when. **There is no separate signing step:** the confirm button keeps the Transition's own label (Submit, Approve, Code B…), with no "Sign" button and no checkbox. A Member without a Signature cannot take Transitions. A new Signature never changes records already made.
- **Stamp:** every Company has one, uploaded to its Company profile by its owner or Authorized Person, beside its **logo**. The record prints the Stamp of every Company whose Members acted. While a Company has no Stamp, **none of its Members can take Transitions**, just as a paper submittal without its stamp isn't processed. The logo is optional: without one, records show the Company's name.

**Visibility rule (critical):** a message or pop-up names only the viewer's own Company and its people, never another Company. Nobody is notified when a Member is blocked.

**Never show due dates, deadlines, SLAs or "overdue".**

## What to design

### 1. Profile → Add Signature
- Three ways, as tabs or a segmented control: **Draw**, **Type**, **Upload**.
  - **Draw:** a signing pad for mouse or finger, with a few **pen styles** (thin, medium, marker) and **colours** (black, blue). Clear and Undo.
  - **Type:** the Member's name, prefilled, shown in a handwriting style; a choice of a few styles.
  - **Upload:** drop or pick an image (PNG or JPG), with a crop to the signature and a note that a white background is removed.
- A preview of how the Signature will look on a record (a small Signature card: name, Position, Company, Signature, date).
- **Save**. Once saved, the profile shows the current Signature with "Replace", and the note "Records already made keep the Signature you used then."
- Coming from the pop-up (§2), Save returns the Member to the item they were on, with a short confirmation.

### 2. The no-Signature pop-up
- Shown when a Member **opens** a Transition (before its Action Form) and has no Signature.
- Plain words: "Add your Signature to act. Every action you confirm is signed with it." The primary button is **Add Signature**, which goes to §1 and comes back. The secondary button is Cancel.
- Nothing the Member typed is lost.

### 3. The no-Stamp message
- Shown when a Member opens a Transition and **their own Company** has no Stamp.
- Example: "‹Company› has no Stamp yet, so its Members can't act. Ask ‹Company›'s owner or Authorized Person to add it in the Company profile." For the owner or Authorized Person themself: "Add ‹Company›'s Stamp to act", with a button **Add Stamp**.
- Names only the viewer's own Company.

### 4. Company profile: logo and Stamp
- Two upload cards beside each other: **Logo** (optional) and **Stamp** (required to act). Each shows the current image, Replace, and a note that records already made keep the one in force then.
- While there is no Stamp, a clear notice at the top of the Company profile: "Your Members can't take any action until the Stamp is added."
- Only the owner or Authorized Person can upload; other Members see the images without the buttons.

## Screens to produce
- Add Signature: Draw (desktop and phone), Type, Upload; the profile after saving.
- The no-Signature pop-up over an item with its Transition just opened.
- The no-Stamp message, for a Member and for the Authorized Person.
- The Company profile with no Stamp, and with both logo and Stamp.
- Every screen in **English and Arabic (RTL)**.

## Reference
The interim screens RP-85 and RP-617 ship use the Company Profile card style (`RP.profile` in the kit). Keep that family. Where a design differs from this prompt, the spec RP-632, `GLOSSARY.md` or `docs/visibility.md`, those win.
