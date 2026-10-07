# Every Transition is signed, and the Documental Record names everyone who acted

Settled in the workflow-authoring grilling of 2026-10-08. Amends [ADR 0003](0003-docusign-grade-signing-not-legally-qualified.md); its technical strength (confirmation, content hash, PAdES seal, timestamp, QR, signing-trail page) stands.

ADR 0003 made some Transitions "signing" ones, chosen per Transition in the Workflow, and the builder contract offered an `is_signing` flag with a publish check that every Submit and every Code Transition is signing. Visibility rule V7 said the Documental Record holds "Signatures and events between Participants only", which could be read as leaving out the people who acted inside each Company. On KSA projects the paper submittal transmittal it replaces shows everyone on the path: prepared by the Contractor's engineer, checked by its Project Manager, reviewed by the Consultant's engineer, approved by its manager, and the Owner Representative where it signs.

We decided:

- **Every Transition a Member takes is confirmed and recorded**: the confirmation dialog of ADR 0003, then who, when, and a hash of the Work Item's exact content in the append-only audit log. There is no per-Transition "signing" choice in the Workflow; publish check 5 is dropped.
- **The Documental Record names everyone who acted on the item's path.** When the item closes (Code A, B, C or D, an Inspection Result, Cancelled…), its sealed PDF carries, for each Transition taken on the way to the outcome, the Member's name, Position, Company, the date and their saved Signature, whichever Company they belong to.
- **Still left out:** Returns and the work around them, Internal Notes, Recommended Codes, Chat and in-progress answers. The record shows who signed what, not the internal discussion.

## Considered Options

- **Only the hand-overs between Companies** (the Submitter and the Code issuer). Rejected: it doesn't match the transmittal forms the record replaces.
- **A shared PDF with hand-overs only, plus each Company's own copy with its internal signatures.** Rejected: two versions of one record invite disputes about which is authoritative.

## Consequences

- A visibility change for the record only: once an item is closed, its Documental Record names people of other Companies who acted on it. In the live item, history, With, Kanban and notifications keep V14 (another Company by name only, except the final Code's signer). `docs/visibility.md` V7 and the Documental Record leak-channel row are rewritten to say so.
- A Member needs a saved Signature before taking any Transition; onboarding asks for it.
- The Signing epic (RP-23) builds the PDF from this rule; the Workflow builder offers no signing option.
