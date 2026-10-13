# After a Send Back, the Step decides what the raiser may change

ADR 0014 let an item Sent Back to its raiser be edited at every raiser Step that edits the Form, Trade, Location and Scopes included. Those three decide who sees the item and can be part of its Document Number, and they applied live: a Member of another Company could gain or lose an item, and see its new Location, before the raiser Submitted it again (RP-365). Nor did anything stop a change to a Trade or Location the issued number already names.

We decided (2026-10-14, with the product owner, settling RP-365):

- **After the first Submit the raiser's Form is closed by default.** Its fields, Documents, attachments, checklist, Trade, Location and Scopes stay as Submitted; after a Send Back the raiser only replies with a comment and Submits again. A real change needs Code C and a Revision. This is how submittals work, and their Rabaed Default Workflows keep no Send Back.
- **A Workflow may open the Form after a Send Back, per Step:** "After a Send Back: comment only (the default) / edit the Form", on the raiser's Step the Send Back leads to. "Edit the Form" reopens everything until the next Submit, Trade, Location and Scopes included. A Site Report's "Return for Comment" uses it: the report is linear, and its author fixes it under the same number.
- **A field the Numbering Pattern uses never changes once the item is numbered**, whatever the Step allows and before the Submit too (the number is issued on leaving Draft). The raiser cancels the item and raises a new one; the Form says so.
- **Others see a Sent Back item as it was at the Send Back until it is Submitted again**, now its Trade, Location and Scopes too: who can see it, its rows in the List and Kanban, and search. At the next Submit the new values apply to everyone (V12).

## Considered Options

- **Keep editing open after every Send Back.** Rejected: a submitted submittal is a record; changing it without a Revision bypasses the register.
- **Lock Trade, Location and Scopes even at an "edit the Form" Step.** Rejected by the owner: a Site Report filed against the wrong Location must be correctable under its own number.
- **Let the three apply live, and accept the leak.** Rejected: visibility is the top requirement, and V19 already holds answers, Documents and Links back until the next Submit.
- **Reissue the Document Number when a field it uses changes.** Rejected: numbers are never reused or reissued, and a Send Back keeps the same number.

## Consequences

- Workflow Versions published before this keep editing after a Send Back: they can't change (RP-424). New and edited Workflows get "comment only" by default.
- Built by RP-580 (the Step setting and the builder toggle), RP-581 (number fields locked) and RP-582 (the three as at the Send Back for others, blocked by RP-580). Those PRs update workflow-engine.md, form-engine.md, visibility.md (V19, the Sent Back row, new scenarios) and data-model.md, not the planning session.
