# Send Back: the one way a Work Item goes back across Participants

The Workflow engine allowed a `return` only inside one Participant and had no loops through Submit (workflow-engine.md, publish rules 4 and 8). The Consultant's way to send a submittal back to the Contractor is Code C (Revise and Resubmit): the item closes and the Contractor resubmits it as a Revision, a new Work Item with the same number and ` Rev n`. That is how KSA submittals are tracked, and the Rabaed Default submittal Workflows keep it.

Some Work Items need a lighter way back. A Site Report carries no Review Code, so a Consultant who finds a wrong manpower count has no Code C to issue; it needs "Return for Comment", and the same report Submitted again. A Project may also want a Consultant to send back a submittal that is merely incomplete, without spending a Revision on it.

We decided that the engine has a fifth Transition kind, **`send_back`** (settled 2026-10-06, RP-295). It goes from a Step of the Participant the item was Submitted to, back to a Step of the Participant that Submitted it, chosen by the Workflow; it sets no outcome and keeps the same Work Item and Document Number. A loop across Participants is possible only through a Send Back. **Return** keeps its meaning: back to an earlier Step inside one Participant.

## Considered Options

- **Code C only.** Rejected for the engine: Site Reports have no Code, and a Revision for a missing datasheet adds a closed item and a Rev to the register for nothing. Kept for the Rabaed Default submittal Workflows, where a Code is the contractual answer.
- **Let `return` cross Participants.** Rejected. A Return is Internal Communication (V5, V14) and never seen by other Companies, while a move back across Participants is a shared event both sides must see. One word for both would blur that line in the visibility rules.

## Consequences

- An item can be back with its raiser after it was Submitted. It keeps everything it had become for others: it stays in Link search and Linked from (visibility.md, scenario 58), and others see its answers, Documents and Links as they were at the Send Back until it is Submitted again (V19, RP-309).
- "Submitted" in those rules means "Submitted at least once": the item records its **Submission Date**, its first Submit out of the raiser's Participant, which a Send Back doesn't change.
- A Send Back out of another Participant's Step discards that Participant's in-progress answers (ADR 0013).
