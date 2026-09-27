# Visibility specification

**The #1 rule of Rabaed: no one sees another company's work unless a rule below explicitly allows it.** When a case isn't covered, the answer is *hidden* until a rule is added here.

Terms follow [CONTEXT.md](../CONTEXT.md). Enforcement follows [ADR 0007](adr/0007-project-is-the-tenancy-boundary.md) (Project is the tenancy boundary, row-level security) and [data-model.md](data-model.md).

## The layers

A Member sees a thing only if it passes **every** layer, in order.

| # | Layer | Question | Enforced by |
|---|---|---|---|
| 1 | Instance | Is it on my Instance? | Separate deployments |
| 2 | Project | Is my Company a Participant, and am I an active Project Member? | RLS on `project_id` |
| 3 | Participant access | Has my Participant been given access to this Work Item? (it raised it, it handles a Step, or oversight) | `work_item_access` + RLS |
| 4 | Member Visibility | Does my own Visibility cover the item's Trade, Location and other dimension values? | RLS join on `visibility_grant` |
| 5 | Audience | Is this history entry shared, or internal to my Participant? | `work_item_event.audience` |

**Exceptions** open only the sealed Documental Record PDF, never the live item:
- **E1 Link:** you can open the Documental Record of an item linked from one you can see.
- **E2 Signatory Access:** you keep, forever, the Documental Records of items you signed, and your Company keeps those its Members signed.

## Rules

- **V1.** Draft and internal-Stage Work Items are visible only inside the raising Participant.
- **V2.** A Participant gains access to a Work Item only when:
  - it raised the item, or
  - a Workflow Step is assigned to it, or
  - it is an Owner or Owner Representative, the item has been Submitted, and its Visibility covers the item (*oversight*).
- **V3.** Two Participants in the same Project Role never see each other's Work Items, even when they share a Trade.
- **V4.** A Member never sees more than their Participant. A Member's Visibility is a subset of their Participant's.
- **V5.** Internal Communication (notes, internal Step moves, Returns, internal approvals, Recommended Codes) is visible only to Members of the Participant where it happened.
- **V6.** Chat is visible to every Participant that currently has access to the Work Item.
- **V7.** The Documental Record contains Signatures and events between Participants only, never Internal Communication or Chat.
- **V8.** Removal from a Project, a Participant's withdrawal, or Project closure never takes away E2.
- **V9.** A Rabaed Engineer sees data only through Rabaed Admin, and every access is logged with a reason.

## Leak channels

Every one of these must apply the same layers. A new feature that adds a channel must add it here.

| Channel | Rule |
|---|---|
| Lists, Kanban, Floor/Plan Views | Show only visible items. **Column counts and badges are computed from visible items only.** |
| Dashboard and Location Status | Aggregates are computed over the viewer's visible items only. No project-wide totals for a Contractor. |
| Search and filters | Search results are filtered by the same RLS. No "12 results, 3 shown". |
| Direct URL or ID | An inaccessible item returns **404, never 403**, so its existence isn't revealed. IDs are UUIDs and can't be guessed. |
| Files Module | Work Item folders appear only for visible items. Free folders follow folder permissions. |
| File downloads | Short-lived signed URLs, issued only after an access check. |
| Pins on shared Drawings | Show only Pins of visible items. A shared floor plan must not show a competitor's Snags. |
| Links | Show a target's number, title and Documental Record (E1). Never its live data or history. |
| Notifications and emails | Sent only to Members with access. The subject line holds only what the recipient may see. |
| Distribution List | Receives the Documental Record link only (E2-style sealed PDF), and the link expires. |
| Activity Feed | Built from `work_item_event` and `project_event`, filtered through layers 3 to 5. |
| Step Age reports | Each Participant's report covers items it has access to. The Owner-level report covers oversight items. |
| Exports and handover | An export contains only what the exporter could see, plus their E2 records. |
| Document Numbers | Numbering patterns that include a Company segment give each Company its own counter, so sequence gaps don't reveal a competitor's volume. |
| Errors and logs shown to users | Never include another item's title, number or Company. |
| Rabaed Admin | A separate role, with `admin_action` logged on every read of customer data. |

## Scenario matrix (becomes the automated visibility test suite)

Setup, Project "Tower": Contractors **C1** (Electrical) and **C2** (Electrical, Building B only). Consultant **K1** (Electrical + Mechanical, members split by Trade). **OR** Owner Representative (Electrical only). **OW** Owner (all).

| # | Scenario | Who | Expected |
|---|---|---|---|
| 1 | C1 engineer saves a Draft MAR | C2, K1, OR | Hidden, including from counts and search |
| 2 | C1 sends the MAR to its PM (internal review) | K1 | Hidden |
| 3 | C1 PM submits the MAR (Electrical) | K1 Electrical engineers | Visible, in the Step Pool |
| 4 | Same | K1 Mechanical-only engineer | Hidden |
| 5 | Same | C2 | Hidden (V3) |
| 6 | Same | OR (Electrical) | Visible as oversight |
| 7 | K1 engineer recommends Code A to their manager | C1 | Doesn't see the Recommended Code or the note (V5) |
| 8 | K1 manager issues Code B with 3 comments | C1 | Sees Code B and 3 Comment items. Doesn't see K1's internal notes |
| 9 | C1 PM posts in Chat | K1, OR | Visible to both (V6) |
| 10 | Documental Record of the MAR | C1, K1 | Contains all Signatures and cross-Participant events. No internal notes, no Chat (V7) |
| 11 | C2 creates an Inspection linking C1's approved MAR | C2 | Can't create the link: C2 can't see the MAR (only visible items can be linked) |
| 12 | K1 creates an Inspection linking an item outside the inspector's Visibility | Inspector | Sees the number, title and Documental Record only (E1) |
| 13 | C1 engineer who signed is removed from the Project | That engineer | Sees the Project name and their signed Documental Records only (E2) |
| 14 | C1 is withdrawn | C1 Authorized Person | Sees only the Documental Records C1's Members signed. Open items are Cancelled |
| 15 | Project closed | Any Member | Read-only. E2 records still available |
| 16 | K1 places a Snag Pin on the shared Building A plan | C2 viewing the same plan | Pin hidden |
| 17 | Submittals Kanban for C2 | C2 | Counts include only C2's items |
| 18 | C1 member opens `/work-items/{C2 item id}` | C1 member | 404 |
| 19 | Email notification for Code B on the C1 MAR | C2 | Not sent |
| 20 | Rabaed Engineer opens the MAR to fix a stuck Step | Engineer | Allowed through Rabaed Admin. The read and the action are logged with a reason |
| 21 | Weekly Step Age report | C1 PM | Lists only C1-accessible items |
| 22 | Consultant engineer later granted Mechanical | Same engineer | Sees Mechanical items from then on, including earlier ones (access follows current Visibility, not grant date) |

Every change to rules or channels must add or update rows here and in the test suite. A failing visibility test blocks release.

## Settled rules (2026-09-26)

- **V10. Approved Supplier List.** Entries are Project-wide: every Participant sees the supplier name and its approval, never the submittal that approved it.
- **V11. Drawing register.** Approved, current Drawing Revisions are visible to every Participant whose Visibility covers the Drawing's Trade. While under review, only the Participants with access to the review Work Item can see them.
- **V13. Forms are all-or-nothing.** Anyone who can see a Work Item sees its entire Form and Documents. There are no private fields; only Internal Communication is hidden (V5).
- **V14. Workflow view.** In an item's "View workflow" diagram, another company's internal Steps are collapsed into one block ("<Company> review"). The block shows no names, no internal Returns and no Recommended Code. Only the hand-overs (Submit) and the final outcome with its signer are shown, as on the Documental Record.
  The same grouping applies to **every screen that shows Steps or holders**: Kanban swimlanes, the list's **"With"** column (never "Current owner"), report and item steppers, notifications. The viewer's own company appears in full; another company appears as one grouped lane or cell with the company name and never a person's name. The build uses one shared component for this.
- **V12. Access follows current Visibility.** A Member who gains a Trade or Location sees that dimension's items, including earlier ones. A Member who loses it stops seeing them, except under E2.
