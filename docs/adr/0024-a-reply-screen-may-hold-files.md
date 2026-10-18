# A reply Screen may hold files, which stay with the holder until its Transition

ADR 0019 made the Form the raiser's: every other Participant answers in its reply Screen, and an Action Form holds no files (`not_in_action_form`), because the Transition event's payload is read unstripped by everyone who sees a shared event. The Snag's Contractor still needs "after" photos when it resolves (spec RP-619), and Inspections will need the inspector's checklist photos. We decided (2026-10-19, RP-623) that **a reply Screen may hold `photos` and `attachments` fields**. Their files are Documents on the item, tied to the Screen's field, and never part of the event payload. That keeps ADR 0019 as it is: no other Participant ever edits the raiser's Form.

- **When.** Members of the Participant holding the item add the files over time, at the from-Steps of any Transition whose Screen holds the field (for the Snag: Open, In Progress and On Hold, the from-Steps of the three Resolve Transitions). No per-Step setting is needed. The Action Form opens with them in its field, where they can still be added or removed.
- **Who sees them.** Until that Transition, only the holding Participant's Members see them (V19). A move within that Participant keeps them, and so does a Handover to another of its Members. The Transition freezes them, as Documents freeze at a Submit, and they join its content hash (ADR 0017). If the item leaves that Participant any other way (a Send Back, a cancel), they are discarded.
- **Shared only.** A file field in a Screen is shared, and publishing refuses an internal one. Internal remarks go in the Internal Note.
- **One set per Transition.** Each Transition taken keeps its own files: after a Return to Open, the next Resolve starts with an empty field, and the earlier round's photos stay with the earlier Resolve in the history. The field's file limit counts only the current round.
- **Record.** The Documental Record (ADR 0023) lists them like the item's other Documents, by name, the uploader's Participant and the Transition they froze at, and covers them by its hash.
- **Scope.** RP-623 lifts the refusal only for `photos` and `attachments` fields. Photos on checklist items in a Screen come with Inspections (RP-27), on the same mechanism. The Screens editor offers file fields in a follow-up; until then they are published as data.

## Considered Options

- **Bring back another Participant's Form section, for files only.** Rejected: it reopens what ADR 0019 rejected (the raiser's document holding a part it can never fill, a second editor of the raiser's Form, the Send Back put-back of another Participant's sections), and a self-raised Snag would need a special case.
- **Files only inside the Action Form pop-up.** Rejected: on site the photo is taken when the fix is done, often long before someone resolves, so the files must survive between visits.
