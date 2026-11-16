# A Checklist Template may name a Scope

A Checklist Template belonged to one Trade only (RP-651), so in a broad Trade such as Architectural, the Templates for blockwork, paint and tiles all sat in one long pick (UAT round 0, INS-03, RP-802). We decided (2026-11-16, the product owner, grilling of RP-1308) that **a Checklist Template is a Trade plus an optional Scope or Sub-scope of that Trade**, the same shape as the Approved Supplier List. A Template with no Scope is a whole-Trade Template; every existing Template stays one.

- **Still one Checklist per Inspection.** Two kinds of work means two WIRs, not two Checklists on one.
- **What the pick offers:** when the WIR has Scopes ticked, the whole-Trade Templates plus the Templates tagged with a ticked Scope. A Scope's Template is offered when that Scope or any of its Sub-scopes is ticked; a Sub-scope's Template only when that exact Sub-scope is ticked. When no Scope is ticked, every Template of the Trade, as before.
- **Unticking a Scope clears the pick**, and the raiser picks again, as when the Trade changes.
- **Settings:** one card per Trade, its Templates grouped "Whole Trade" first, then by Scope; the create and edit form gains a Scope picker.

## Considered Options

- **A Template belongs to a Scope only.** Rejected: a Trade-wide Template ("Concrete pour" for all of Structural) would have to be copied under every Scope, and Scopes are optional on a WIR, so a WIR with none would be offered nothing.
- **A Template names several Scopes.** Rejected for now: the Approved Supplier List names one, and a Template that fits two Scopes can be whole-Trade or made twice. It can be added later without changing what a single Scope means.
- **Offer only the tagged Templates once a Scope is ticked.** Rejected: whole-Trade Templates would disappear from WIRs that name a Scope, though they still fit the work.
- **Several Checklists on one WIR, one per ticked Scope.** Rejected: one Inspection, one Review Code, one Checklist; the copy, the reply Screen and the Record are all built on one.

## Consequences

- `checklist_template_version` gains an optional scope beside its Trade, so each Version names the Scope it was made for, and an edit may move the Template to another Scope or back to the whole Trade. Picks already made keep their Version, and the pick stays fixed after the first Submit (form-engine.md §3.2).
- The Scope is not a Visibility Dimension: every Project Member already reads the Project's Scopes and its Templates (V20), so nothing new is shown to another Company.
- The building PR updates data-model.md and form-engine.md from "decided" to "as built".
