# An Inspection ends with a Review Code

The Inspections spec RP-649 (grilled 2026-10-15/16) gave an Inspection its own outcome, the Inspection Result (Passed, Passed with Comments, Failed), and the Inspections Module its own Stages (Draft, Internal Review, Pending Inspection, Passed, Failed, Cancelled). RP-437 and RP-170 built them. The product owner sees a Work Inspection Request as a submittal of an inspection kind: the same pages, the same Stages, the same codes, only another Form and other actions.

We decided (2026-10-17/19, with the product owner, grilling of RP-27):

- **An Inspection ends with a Review Code, with a submittal's meanings and follow-ups:** A, B (its Comments continue in the Snag List), C (a Revision for re-inspection), D (closed, no Revision). The Inspection Result is retired: no Work Item Type ends with Passed, Passed with Comments or Failed.
- **The Inspections Module's Rabaed Default Stages are the Submittals Stages:** Draft, Internal Review, Pending Approval, Approved, Revise & Resubmit, Rejected, Cancelled. Each Module keeps its own copy, which a Project may rename. When a Project shows Inspections inside the Submittals tab, a WIR sits in the same column as a submittal at the same Stage.
- **The Consultant Engineer sends a Recommended Code** to the Consultant Manager, internal to the Consultant as on a submittal. The Manager's pop-up proposes C when any check item failed, else A; the Manager issues any of A–D. Failed check items ticked "Raise a Snag" still become Snags whatever the code.
- **The Inspections pages are the Submittals pages** (List, Kanban, filters, item page with the Workflow map). A Project shows Inspections in their own tab (the default) or inside the Submittals tab, one place at a time. Whether an Inspection has a Checklist depends on its Form.

## Considered Options

- **Keep Inspection Results beside Review Codes, per Work Item Type.** Rejected: two vocabularies for the same decision, and a shared board would show Passed beside Approved.
- **Keep the Inspections Stages and show them as their own columns in the Submittals tab** (as RP-652 built). Rejected: the same Stage under two names on one board.
- **Show Inspections in both tabs at once.** Rejected: one WIR listed twice, and counts and Need My Action would have to de-duplicate it.

## Consequences

- A WIR Workflow Version 3 issues codes (`issue_code`) instead of `inspection_result`; Version 1 and 2 items finish on their Versions. The WIR Type's outcome kind becomes the Review Code, and the Inspections Stages move to the Submittals set, mapping Pending Inspection → Pending Approval, Passed → Approved, Failed → Revise & Resubmit.
- RP-652's separate "Inspections · …" columns become the shared columns, matched by Stage key.
- RP-86, RP-577 and RP-653 are rewritten for codes; RP-86 also takes ADR 0024 (the Engineer fills the checklist in a reply Screen).
- Once the code no longer uses it, the building ticket adds "Inspection Result" to the Review Code's _Avoid_ in `GLOSSARY.md`.
- The building PRs update workflow-engine.md, form-engine.md, data-model.md and visibility.md, not the planning session.
