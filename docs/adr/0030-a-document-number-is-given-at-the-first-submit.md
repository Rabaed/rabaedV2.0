# A Document Number is given at the first Submit

A Work Item got its Document Number when it first left Draft. For a submittal or a WIR, that is the Send for Review to the raiser's own PM. An item cancelled in Internal Review kept its number, so the Consultant and the Owner saw the raiser's numbers jump (UAT01-MAR-01-0002, then 0004). The gap tells another Company about the raiser's internal work, against V1 and scenario 53 (UAT WF-16, RP-1302).

We decided (2026-11-16, the product owner, grill on RP-1302):

- **A Work Item gets its Document Number at its first Submit** out of the raiser's Participant, in the same transaction, at the same moment as its Submission Date. Send for Review and every other Transition inside the raiser's Participant no longer number it. Nobody outside the raiser sees an item before that Submit, so the number appears in the same moment as the item, and an item cancelled before then never had one.
- **Before its first Submit, an item shows "No number yet" and its Subject.** There is no temporary number. Inside the raiser's Company, people find it by its Subject, and the app links to it by its id, as URLs already do.
- **A Revision gets its " Rev n" at its own first Submit.** From the time it is a Draft, it shows clearly that it is a Revision: its base number shows, marked as not yet issued (RP-1300 and RP-1314).
- **Two exceptions, numbered at the start:**
  - **A follow-up item** (a Code B Comment, or a Snag raised from a failed check item) is numbered when it is created, as today. It is shared the moment it exists.
  - **An item whose Workflow has no Submit** is numbered when it first leaves Draft. For such an item, leaving Draft counts as its Submit.
- **Numbers already issued stay.** An item numbered at Send for Review but not yet Submitted when this ships keeps its number. Past gaps stay as history. A number is still never reused, taken back or reissued (ADR 0020, ADR 0021).
- **The Creation Date stays at the first exit from Draft.** It is no longer the date of the number.

This replaces the numbering parts of ADR 0020 ("Draft (no number) → Send for Review", and an item numbered on leaving Draft). ADR 0020's other rules stand: Returns stay in Internal Review, and Documents freeze at Submit. In ADR 0021, "the number is issued on leaving Draft" becomes "at the first Submit". ADR 0008's gap-free numbering holds, now also as other Companies see it. Those ADRs stay as they were written.

## Considered Options

- **Keep numbering at Send for Review, and hide the gap from other Companies.** Rejected: every Company would see a different sequence for the same register, and the gap would still show in any export or Documental Record.
- **A temporary number before Submit, seen only inside the raiser.** Rejected: two numbers for one item invite one being quoted for the other, on paper and in email.
- **Take the number back when an item is cancelled before Submit.** Rejected: numbers are never reused, and the raiser's PM has already seen it.
- **Number at the first Transition that crosses Companies, whatever its kind.** Not chosen: in every Workflow today that Transition is a Submit, and tying the number to Submit keeps it beside the Submission Date.

## Consequences

- `app.transition_effects` gives the number on the first `submit` out of the raiser's Participant, not on the first exit from Draft. `numbered_at` is no longer the Creation Date, which keeps the first exit from Draft.
- The Revision suffix moves the same way. A Revision is never offered Cancel, so this keeps one rule, not a gap fix.
- The first Submit is checked so that two items Submitted at once still get consecutive numbers (ADR 0008's single transaction).
- Until the first Submit, a field the Numbering Pattern uses (Trade, Location, Participant Code) is not fixed by a number, so the raiser can change it in Internal Review. ADR 0021's lock starts at the number, that is, at the first Submit.
- Everything that showed a number in Internal Review shows "No number yet" there: the Activity Feed, the History, notifications and email subjects, Packages, bulk Transitions, the Working Copy's file name and Rabaed Admin's lookup by number.
- The Workflow builder can publish a Workflow with no Submit. Its items take the exception above.
- `docs/data-model.md`, `docs/workflow-engine.md` §8 and `docs/visibility.md` (a scenario next to 53) are updated by the PR that builds this, as CODING_STANDARDS.md (Docs) asks, not by this decision.
