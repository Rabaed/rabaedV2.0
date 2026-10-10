# A Step is never left without a holder

The Workflow engine gave a Step a holder by four rules (workflow-engine.md §3.3): the Member it came back to, an "Assign to" pick, a default holder set in Project Settings, otherwise the Step Pool, from which one Member claims it. When a holder left the Project, their assignments became **Vacancies**: the item waited and the Company's Authorized Person was told to name a replacement (§9, RP-108).

The UAT of the workflow engine (RP-463, 2026-10-09) showed both ends of this go wrong in practice. Every Claim in the demo had exactly one Member to choose from, so it was a click with no decision in it, and while nobody had claimed it the raiser saw only "With: TMC Constructions" and couldn't tell who it waited on. And when a Member leaves, a Company deactivates their account: nobody there wants items to sit empty until someone notices a Vacancy notification.

We decided (2026-10-10) that a Step always has a holder or a pool that knows it is waiting:

- **A pool of one holds the Step at once.** When the Step Pool (after "not the same person") has exactly one Member as the item arrives, they hold it, with no Pick up; a Member joining later doesn't take it away.
- **Handover before a Member leaves a pool.** Deactivating a Member, removing them from a Project, or a Position or Visibility change that takes them out of a pool lists their open Steps and Drafts, and each must get a new holder from its pool before the change is saved. With no candidate, the change is refused until someone is given the Position or Visibility.
- **No member-level Vacancy.** Only a withdrawn Participant leaves Vacancies, which pass to its replacement's pool.

Taking a pooled Step is called **Pick up**, not Claim, which is the Financial module's payment request.

## Considered Options

- **Keep Claim for every pool.** Rejected: with one Member it adds a click and hides from the raiser who will act.
- **Default holders as the answer.** Kept in the design but parked: it needs a settings screen per Step and Participant, and the pool of one covers the common case.
- **Vacancies with a notification.** Rejected for Members: the person deactivating someone is the one who knows who takes over, at that moment.

## Consequences

- Deactivation, removal from a Project, and Position or Visibility changes gain a Handover step and can be refused; their screens and commands change (RP-108 rewritten).
- `assign_vacancy` and the "Vacancy in my Company" notification setting are removed; the Participant-level Vacancy stays.
- `claim`/`release` are renamed `pick_up`/`return_to_pool` in the database, API and events, and the buttons read "Pick up" and "Return to pool".
- The holder's own Participant sees who holds the Step, or the pool's names while it waits; other Participants still see the Company only (V14).
