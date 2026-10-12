## What and why

<!-- What changed, why, and anything a reviewer should know. -->

Closes RP-

## Visibility

No Company may see another Company's work beyond `docs/visibility.md`. Tick every leak channel this change touches: a new read, count, list, search, message, export or error that could show another Company's work, or show that it exists.

- [ ] None: this change reaches no channel below (say why in one line)

## Leak channels

<!-- One per row of the leak-channel table in docs/visibility.md, in its order; scripts/check-leak-channels.test.ts keeps them the same. -->

- [ ] Lists, Kanban, Floor/Plan Views
- [ ] Comments (Code B's action items)
- [ ] Dashboard and Location Status
- [ ] Search and filters
- [ ] Direct URL or ID
- [ ] Files Module
- [ ] File downloads
- [ ] Form `member` and `participant` fields
- [ ] Pins on shared Drawings
- [ ] Links
- [ ] Linked from
- [ ] Form Sections filled by another Participant
- [ ] An item Sent Back to its raiser
- [ ] Creation Date
- [ ] Link search
- [ ] Notifications and emails
- [ ] Daily email digest
- [ ] Need My Action
- [ ] Watch
- [ ] Distribution List
- [ ] Documental Record
- [ ] Activity Feed
- [ ] Workflow definitions and bindings
- [ ] Home across Projects
- [ ] Work Item history
- [ ] Step Age reports
- [ ] Exports and handover
- [ ] Document Numbers
- [ ] Revisions
- [ ] Form answers
- [ ] Derived values
- [ ] Errors and logs shown to users
- [ ] Refusals of a Transition
- [ ] Screens and replies
- [ ] Visibility Gap warnings
- [ ] Rabaed Admin
- [ ] Participant Invitation by CR number

## Scenarios

For every channel ticked above:

- [ ] Its row in `docs/visibility.md` says how this change keeps it closed (a new channel adds a row, and the checklist above gets it too).
- [ ] A scenario covers it: new rows `RP-nnn-n` in the scenario matrix, or the existing rows updated. Scenarios:
- [ ] Each scenario has its automated test (seam 1 api, seam 2 database, or both). Tests:

## Checks

- [ ] `pnpm verify` passed
- [ ] UI: screenshots at 1366 and 1920, English and Arabic, beside the reference screen
