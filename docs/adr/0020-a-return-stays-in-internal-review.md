# A Return stays in Internal Review

In the Rabaed Default MAR Workflow, the Contractor PM's Return went back to the Draft Step (workflow-engine.md §1). The item was numbered when it first left Draft, so a Returned item sat in the Drafts Stage with a Document Number, beside Drafts that had never been sent. Its Documents were frozen at Send for Review, so the engineer asked to fix it could change the answers but not swap a wrong datasheet. And a Draft's Step Age raised a question left open (RP-364): counted from when the Draft was started, it would show a time the Creation Date rules keep from everyone.

We decided (2026-10-10, from the UAT of the workflow engine, RP-463):

- **Internal Review is a Stage holding Steps.** In the Rabaed Default MAR, "Contractor Engineer" and "Contractor PM". The route: Draft (no number) → Send for Review → Internal Review / Contractor PM; Contractor PM → Return → Internal Review / Contractor Engineer; Contractor Engineer → Send for Review → Contractor PM; Contractor PM → Submit → Consultant. **A Return never goes back to the Draft Step** or the Drafts Stage.
- **A Draft is an item never sent.** The Drafts Stage holds only items that never left Draft, so a Draft never has a Document Number.
- **No Step Age in a Draft.** This settles RP-364: the time a Draft was started reaches nobody. A Returned item's Step Age counts from the Return, as at any Step.
- **Documents freeze at Submit.** At the Contractor Engineer Step the holder may change the answers and add, replace or remove Documents. Documents freeze for good at the first Submit, not at Send for Review as today. Nobody outside the raiser's Participant has seen them before the Submit, so unfreezing them inside it leaks nothing (V1).
- **The Kanban shows a Stage's Steps to their own Participant.** The viewer's own Participant sees, in each Stage, its Steps with their counts (e.g. Internal Review 7: Contractor Engineer 3, Contractor PM 4); other Participants see the Stage only (V14).
- **Cancel stays as built:** from the raiser's own Steps, until the first Submit.

## Considered Options

- **Keep the Return to Draft.** Rejected: a numbered Draft is two things under one name, and it would need its own Step Age rule.
- **Unnumber a Returned item.** Rejected: Document Numbers are never reused or taken back (§8), and the PM has already seen the number.
- **Keep Documents frozen at Send for Review.** Rejected: freezing protects what another Company has seen, and nobody outside the raiser sees the item before the Submit.

## Consequences

- The Rabaed Default MAR Workflow gets a new Version with the Contractor Engineer Step in Internal Review; items on earlier Versions keep their route (§1).
- So that the Drafts Stage holds only items never sent, publishing should refuse a `return` into a Step in a `draft` Stage (to confirm when the ticket is written).
- The Document freeze moves from the first exit from Draft to the first Submit (`frozen_at`, the freeze trigger, workflow-engine.md §5.1 effect 1). The content hash at Send for Review still covers the Documents as they are then (ADR 0017).
- The Kanban gains Step counts inside a Stage for the viewer's own Participant.
- "A Revision Returned to Draft can't be discarded" (§5.4) no longer arises with the Rabaed Defaults.
