# Only the Host Company withdraws a Participant

A Company joins a Project only with both sides' consent (ADR 0009), but nothing in Rabaed let one leave. We decided (2026-10-31, the product owner, RP-1074) that **only the Host Company's Project Admin withdraws a Participant**. The Company itself can't leave on its own, and the withdrawal needs no agreement from it. Leaving a Project is a contractual event the Project's side controls; a Company that wants out asks the Host Company outside Rabaed.

- **Refused only for the Host Company itself.** Before confirming, the Project Admin sees counts only: how many items will be Cancelled and how many Steps will become Vacancies.
- **Its items:** every open item it raised that has left Draft is Cancelled by Rabaed with a Documental Record ("Cancelled by Rabaed: ‹Company› left the Project"). Its Drafts and Draft Revisions are Cancelled with no Record, since no other Company ever saw them. The Steps it holds on other Companies' items become Participant-level Vacancies (workflow-engine.md §9).
- **No undo.** A withdrawn Company comes back only through a new Invitation, and its Cancelled items stay Cancelled: their Records are sealed.
- **Nothing it did is removed.** Its moves, replies, files and signatures on other Companies' items stay as they were; its Members lose access, except to the Records they signed (V8, E2).

## Considered Options

- **The Company's own Authorized Person may leave.** Rejected: a Contractor or Consultant walking off a Project mid-contract would cancel its items and empty other Companies' Steps without the Project's side deciding it.
- **Either side asks, the other agrees** (mirroring ADR 0009). Rejected for now: it adds a pending state and a second actor for a rare, contractual event. It can be added later without changing what a withdrawal does.
