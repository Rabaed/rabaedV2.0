# Answers changed at another Participant's Step stay with that Participant until the item leaves it

From Form engine part 3, a Form Section can be filled in by a Participant other than the raiser, at its own Steps: the Consultant fills in "Consultant verification" on a MAR while the item sits at `consultant_review`. The answers are one JSONB document per Work Item (ADR 0006), and everyone who can see the item reads it (V13). So, without a rule, the Contractor and the Owner would watch the Consultant's half-filled verification change save by save, before any Code was issued.

We decided that **answers changed at a Step stay inside the Participant holding it until the item leaves that Participant**, the same rule Transition events already follow (`internal` until the item moves to another Participant or closes). Everyone else reads the answers as they were when the item arrived at that Participant. That includes the raiser and the Owner and Owner Representative with oversight access. Each `answers_changed` event written at that Step is `internal` to the holding Participant. When the item leaves (a Submit, a Code, a close), the answers it carries become everyone's, and the content hash on that event covers them. A Send Back out of that Participant's Step is different (amended 2026-10-05; called a Return until ADR 0014 named it): it discards the in-progress answers, putting the sections that Participant fills back as they arrived, so a half-filled verdict never reaches anyone else; its `answers_changed` events stay internal to it. Answers are read only through the stripping function (ADR 0012), so the rule lives in that one gate.

## Considered Options

- **Live: answers are answers, everyone sees each save.** Rejected. A reviewer's working notes, such as "Matches specification: No" typed before a call with the supplier, would reach the Contractor before the review was decided. That is Internal Communication in all but name (V5).
- **Keep the Consultant's answers out of the Form, in the Action Form only.** Rejected. Answers that describe the item itself (was the sample checked, does it match the specification) belong in its Form, where they print in the Documental Record, are kept for every Revision's history, and can drive conditions.

## Consequences

- V13 ("Forms are all-or-nothing") gains an exception, recorded as V19 in visibility.md, with its own scenarios in the automated suite.
- The stripping function has to know, for each reader, the answers as they were when the item arrived at the Participant holding it. The read for the holding Participant and the read for everyone else differ only while the item is at another Participant's Step.
- A Revision clears the Form Sections filled by other Participants, so a verdict on the previous Revision never arrives pre-filled.
