# A Checklist Template may name a Scope or Sub-scope

A Checklist Template belongs to one Trade (RP-651), so in a broad Trade such as Architectural the Templates for blockwork, paint and tiles all sit in one long pick (found in UAT round 0, test case INS-03, RP-802). We decided (2026-11-16, the product owner, grilling of RP-1308) that **a Checklist Template is a Trade plus an optional Scope or Sub-scope of that Trade**, the same shape as an Approved Supplier List entry (`approved_supplier.scope_id`). A Template with no Scope is a whole-Trade Template; every existing Template stays one.

- **Still one Checklist per Inspection.** Two kinds of work means two WIRs, not two Checklists on one.
- **What the pick offers:** when the WIR has Scopes ticked, the whole-Trade Templates plus the Templates on a ticked Scope. A Scope's Template is offered when that Scope or any of its Sub-scopes is ticked; a Sub-scope's Template only when that exact Sub-scope is ticked. When no Scope is ticked, every Template of the Trade, as before.
- **Unticking a Scope clears the pick**, and the raiser picks again, as when the Trade changes.
- **Settings:** one card per Trade, its Templates grouped "Whole Trade" first, then by Scope; the create and edit form gains a Scope picker.

## Considered Options

- **A Template belongs to a Scope only.** Rejected: a Trade-wide Template ("Concrete pour" for all of Structural) would have to be copied under every Scope, and Scopes are optional on a WIR.
- **Offer only the Scope's Templates once a Scope is ticked.** Rejected: whole-Trade Templates still fit work that names a Scope.
- **Several Checklists on one WIR, one per ticked Scope.** Rejected: one Inspection, one Review Code, one Checklist.

## Consequences

- `checklist_template_version` gains an optional scope beside its Trade. Since the edit form has the Scope picker, an edit (the Template's next Version) may move it to another Scope or back to the whole Trade; a pick already made keeps its Version.
- The pick stays fixed after the item's first Submit (form-engine.md §3.2), so an untick after a Send Back can't clear it. The build ticket confirms with the owner that the pick wins there.
- Scopes are not a Visibility Dimension, and every Project Member already reads the Project's Scopes and Templates (V20), so nothing new reaches another Company.
- The building PR turns the "decided, not built yet" notes in data-model.md and form-engine.md into "as built".
