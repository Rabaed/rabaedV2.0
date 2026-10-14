# The Owner confirms the Consultant's Code

Some submittals end with the Owner's review: the Document Approval Request's Rabaed Default Workflow is Contractor PM → Consultant PM → Owner. Until now a Review Code was issued by the Transition that closes the item, and the only Code passed on without closing was the Recommended Code, kept inside the Consultant.

We decided (2026-10-15, with the product owner, grilling of RP-26):

- **In a Workflow with the Owner's review, the Consultant PM's Code is a Recommended Code to the Owner.** The item goes to the Owner's Step; nothing closes yet.
- **The Owner confirms it or Sends the item Back.** Confirming issues that Code: the item closes and the Code's result runs (Comments with B, a Revision offered with C, a replacement with D). A Send Back returns the item to the Consultant PM with a comment, who may recommend another Code. The Owner doesn't pick a different Code itself.
- **The Owner's PM acts, or an Owner Representative's PM** on a Project that has one.
- **Nobody but the Consultant and the Owner sees the Recommended Code.** The Contractor sees the item as "With Owner review" (V14) and learns the Code only when it is issued; a Code the Owner sent back is never shown to it.

## Considered Options

- **The Owner issues the Code itself, overriding the Consultant.** Rejected: the Consultant stays the reviewer of record, as consultancy contracts have it; the Owner can still block a Code it disagrees with.
- **The Owner only acknowledges an already issued Code.** Rejected: an Owner who disagrees would have nothing to stop.
- **Show the Contractor the Code while the Owner reviews.** Rejected: a Code isn't final until confirmed, and an overturned one would reveal the exchange between the Consultant and the Owner.

## Consequences

- The engine needs a Step that confirms a Recommended Code from another Participant, and a Transition that issues it; today's Recommended Code is internal to one Participant.
- Eight Rabaed Default Workflows (1→1, 1→2, 2→1, 2→2, each with and without the Owner's review) carry it; the Material and Supplier Approval Requests use 2→2 without it.
- The building PRs update workflow-engine.md, visibility.md (a new scenario for the Recommended Code to the Owner) and data-model.md, not the planning session.
