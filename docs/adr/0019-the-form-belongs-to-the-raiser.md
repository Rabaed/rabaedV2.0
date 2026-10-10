# The Form belongs to the raiser; other Participants answer in their reply Screen

Form engine part 3 let a Form Section be filled in by a Participant other than the raiser, at its own Steps (`editable_at`, RP-301, RP-304): the MAR Form Version 4's "Consultant verification" is filled by the Consultant at `consultant_review`. ADR 0013 then had to keep those in-progress answers with the Consultant until the item left it (V19), and the raiser saw the section empty, marked "Filled in by the Consultant". ADR 0013 considered putting the Consultant's answers in its Action Form and rejected it.

The UAT of the workflow engine (RP-463, 2026-10-09/10) found this the wrong way round. The Contractor's submittal held a section the Contractor could never fill, and the Consultant changed the document it was reviewing. Inside the raiser, any Member of its Company could change a Draft another Member was working on.

We decided (2026-10-10) that **the Form belongs to the raiser, and every other Participant answers in its reply Screen**:

- **Who edits the Form.** Only the Member holding the current Step, and only at the raiser's Steps the Workflow allows, before the item's first Submit. By default those are the raiser's Engineer Steps: the Draft Step, and the Contractor Engineer Step in Internal Review after a Return (ADR 0020). A Company's own Workflow may also allow its internal reviewer's (PM) Step. While a Step is pooled, nobody edits it until someone picks it up (ADR 0018). Other Members of the same Company read a Draft but don't edit it; only a Handover passes it to another Member.
- **Nobody edits the Form after the first Submit.** It is an engine rule: publishing refuses a Workflow that lets the raiser's Form be edited at or after a Submit. A change needs a Revision (Code C), as today.
- **Every other Participant answers in its reply.** The reply is the Action Form of the Transition it takes. For the MAR: the Consultant Engineer's reply ("Send to Manager") holds the verification (Sample checked, Matches specification, Verification note), the Recommended Code and the Internal Note, all internal to the Consultant. The Consultant Manager's reply (the Code Transition) holds the Code, the Remarks, the Comments (Code B) and the final verification, pre-filled from the Engineer's and corrected by the Manager if needed; it is shared, read by the Contractor and oversight once the Code is issued. Recommended Code and Internal Notes stay internal (V5).
- **Screens.** A reply is built from a **Screen**: a named, reusable, versioned Action Form (fields, checklists, which are required), kept per Project in Project → Settings → Screens and edited by Project Admins, copied from the Rabaed Default Screens, and kept in a Company's Library like Workflows (ADR 0016). A Transition names the Screen it shows, and a published Workflow Version pins the Screen Versions it uses, so editing a Screen never changes a running item. "Action Form" stays the word for the pop-up as it is filled in on a Transition.
- **Cover Note.** The Contractor's Submit Screen has a shared, optional **Cover Note** next to the Internal Note: read by everyone who sees the item from the Submit on, in its history. It is not Remarks (the Consultant's shared text with a Code) and not an Internal Note.
- **Drafts visible to.** The Draft Step gets a setting: the author's whole Company (the default, as today) or the author only. Other Companies never see a Draft (V1). Under "author only", the Authorized Person still sees a Draft when handing it over.
- **Company defaults.** A Company marks Library Forms, Workflows and Screens as its defaults per Work Item Type. A Project it creates starts from its defaults, Type by Type, else from the Rabaed Defaults. Companies joining the Project use the Project's copies (ADR 0016); an exception for a joining Company's items (V15) is only set up on purpose, never automatically. There is no separate "templates" term: these are the Library's items.
- **Buttons.** "Save Draft" only while the item is a Draft (no number); "Save" ("حفظ") everywhere else. Drafts keep autosave (RP-302), and their button becomes "Save and close": always enabled, it saves anything pending and returns to the Submittals list.

This supersedes ADR 0013 for Form Sections filled by another Participant: there are none any more. ADR 0013's rule stays for the raiser's own changes while an item it Submitted is Sent Back to it (ADR 0014, V19).

## Considered Options

- **Keep Form Sections filled by other Participants (ADR 0013).** Rejected: the raiser reads a part of its own document it can never fill, a reviewer edits what it reviews, and the visibility rule needed to hide in-progress answers (V19) reaches every read of the answers.
- **One fixed Action Form per Transition, in the Workflow definition.** Rejected: the same reply (the Consultant's verification) is used by many Transitions and Workflows, and a Project wants to change it without republishing every Workflow. A versioned Screen, pinned by the Workflow Version, gives both.
- **Let any Member of the raiser's Company edit a Draft.** Rejected: two Members changing one Draft at once overwrite each other field by field (the later save wins, form-engine.md §8); a Handover makes passing it on deliberate.

## Consequences

- `editable_at` at another Participant's Step, `sectionsFilledBy`, `not_for_other_participant`, `data_as_arrived` for another Participant's sections and the "Filled in by the Consultant" mark are retired (form-engine.md §4). V19 narrows to the raiser's changes after a Send Back.
- The MAR Form gets Version 5, without Consultant verification. No data migration: there is no customer data yet; the demo seed and tests change.
- New tables for Screens and their Versions, the Workflow Version's pins, Company defaults and the "Drafts visible to" setting (data-model.md, to build).
- Publishing gains a check: no Step at or after a Submit may edit the raiser's Form.
- Open, not settled here: a Send Back (ADR 0014) gives an item back to the raiser's Steps after its first Submit, and as built (RP-309) the raiser changes its answers, Documents and Links there. "Before the first Submit" read strictly would leave it nothing to change; whether a Send Back reopens the raiser's Form is to be settled with the product owner.
