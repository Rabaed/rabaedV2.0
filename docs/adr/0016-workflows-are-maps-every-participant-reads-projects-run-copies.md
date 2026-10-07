# A Workflow is a map every Participant reads; Projects run their own copies

Settled in the workflow-authoring grilling of 2026-10-08 (Epics RP-20, RP-21).

Until now every Workflow Version was a Rabaed Default published by a migration, and every Project used the latest one. Customers need their own: a Project may route DARs through an Owner Representative, or Contractor X's DARs differently from Contractor Y's. We had to decide who authors Workflows, how a Project gets one, and who may read a definition, given that one graph holds every Company's Steps, internal ones included (an Engineer review, a Return to the Engineer).

We decided:

- **Rabaed authors the Rabaed Defaults** in Rabaed Admin. A published Rabaed Default never changes; a new edition is a new Version.
- **A Project runs its own copies.** Its Project Admin duplicates a Rabaed Default, or a Workflow from a Participant's Library, into the Project, edits it in the builder and publishes it as the Workflow of a Work Item Type, optionally only for one raising Participant ("Contractor X's DARs"). A copy is fully independent: it has its own Versions and keeps no link to the original, so later changes to the original never reach it.
- **A Company keeps copies in its Library** (as with Forms) and copies them into any Project it is on.
- **The map is visible to every Participant on the Project**, with every Company's Steps, internal Steps and Returns included. A Workflow is a description of a process, not anyone's work. What happens on an item at another Company's internal Steps stays invisible as before: who holds it, Returns that were taken, Internal Notes, Recommended Codes and in-progress answers (V5, V14, V19).
- **New items only.** Publishing a new Version, or pointing a Type at another Workflow, applies to items created afterwards; an item finishes on the Workflow Version it started on, and its page shows the Workflow's name and Version.

## Considered Options

- **Only Rabaed authors Workflows; Projects pick among Defaults.** Rejected: every contract routes reviews a little differently, and a migration per variant doesn't scale.
- **Projects reference a shared Workflow instead of copying it.** Rejected: a change made for one Project would silently change running Projects, and a Company's Library edit would reach other Companies' Projects.
- **Hide other Companies' internal Steps in the definition** (the same collapsing V14 applies to items). Rejected for now: a reader of a collapsed map can't copy it, and a review structure (Engineer then Manager) reveals no work. Revisit if Companies later author their own internal part of a shared Workflow ("receiver-specific internal Steps", parked).

## Consequences

- `workflow_definition` gains Project and Company owners; Work Item Types gain a per-Project binding with optional per-raising-Participant exceptions, and item creation stops hard-coding the Rabaed Default Types.
- `docs/visibility.md` gains a rule: Workflow definitions on a Project are readable by every Participant on it; V14 keeps governing items. A Library Workflow is private to its Company until copied into a Project (V18).
- A published Workflow Version needs the same database guard Form Versions have: it never changes.
