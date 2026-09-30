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

  Walking skeleton (RP-194): oversight is granted when the item is Submitted, from the Owner's or Owner Representative's Visibility at that moment. Narrowing it later hides the item at once (layer 4); widening it doesn't yet reach items already Submitted.
- **V3.** Two Participants in the same Project Role never see each other's Work Items, even when they share a Trade.
- **V4.** A Member never sees more than their Participant. A Member's Visibility is a subset of their Participant's.
- **V5.** Internal Communication (Internal Notes, internal Step moves, Returns, internal approvals, Recommended Codes) is visible only to Members of the Participant where it happened. An Internal Note stays internal even when it is written with a Transition that crosses to another Participant, such as Submit; anything meant for the other side goes in Chat or the Form.
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
| Work Item history | The item's `work_item_event`s through layers 3 to 5. Another Company appears by name only; the one person of another Company named is the signer of the final Code (V14). |
| Step Age reports | Each Participant's report covers items it has access to. The Owner-level report covers oversight items. |
| Exports and handover | An export contains only what the exporter could see, plus their E2 records. |
| Document Numbers | Numbering patterns that include a Company segment give each Company its own counter, so sequence gaps don't reveal a competitor's volume. |
| Errors and logs shown to users | Never include another item's title, number or Company. |
| Refusals of a Transition | Never say why another Participant can't take the next Step (no Participant covers the item, several do, or nobody there holds the Position): one answer for all, so its Visibility and Positions stay its own (V14, V16). |
| Visibility Gap warnings | A Project Admin's warnings come from Participant grants only; an Authorized Person's cover only their own Participant's Members (V16). |
| Rabaed Admin | A separate role, with `admin_action` logged on every read of customer data. |
| Participant Invitation by CR number | One answer, status and body alike, whether or not the CR number is on Rabaed. The Project Admin's pending invitations list both kinds by CR number, never by Company name, and a declined invitation stays listed like a CR number that isn't on Rabaed (ADR 0009). |

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
| 23 | K1's Authorized Person gives a K1 engineer a Trade K1 doesn't have | K1 Authorized Person | Rejected (V4) |
| 24 | Project Admin narrows K1 from Tower 1 to Building A | K1 engineer who had Tower 1 | Now covers Building A only; widening K1 again doesn't widen them (V4) |
| 25 | C1 member opens K1's Visibility, or a K1 engineer's | C1 member | 404 (V16) |
| 26 | Project Admin (C1 Company) opens a K1 engineer's Visibility | Project Admin | 404; K1's own Participant grant is visible to them (V16) |
| 27 | K1's Authorized Person, not a Project Member, narrows a K1 engineer | K1 Authorized Person | Sees only the Trades and Locations K1 covers, with the names of the Locations above them; nothing else of the Project (V15, V16) |
| 28 | C1 member opens the Project's Participants | C1 member (not a Project Admin) | Sees C1's own Participant, its Project Role and Project Members, and the Host Company's name. C2, K1 and OR are not listed (V15) |
| 29 | Project Admin opens the Project's Participants | Project Admin | Every Participant is listed (V15) |
| 30 | K1 invited to the Project, not yet accepted | C1 member; K1 Authorized Person | C1 doesn't see K1 anywhere. K1's Authorized Person sees only the invitation: Project name, Host Company, offered Project Role (V15, ADR 0009) |
| 31 | Project Admin enters a CR number that isn't on Rabaed | Project Admin | Same answer as for a Company that is on Rabaed; nothing reveals whether it exists (ADR 0009) |
| 32 | K1 covers Mechanical, but none of K1's engineers is granted Mechanical | Project Admin (C1 Company) | No Visibility Gap warning, since K1 covers Mechanical. Nothing shows how K1 split its coverage among its engineers (V16) |
| 33 | Same | K1 Authorized Person | Warned that no K1 Project Member covers Mechanical. Other Participants' Members never count towards it (V16) |
| 34 | C1 PM Submits the MAR with an Internal Note | K1, OR | See the Submit; never the Internal Note (V5) |
| 35 | K1 engineer sends the Submitted MAR to the K1 PM, who returns it to the engineer | C1 PM | Sees "With K1" and Step Age counted from the Submit; no reset, no internal move (V14) |
| 36 | C2's Authorized Person invites the email of a C1 Member | C2 Authorized Person | Refused: already registered on Rabaed with another Company. C1 is never named, and nothing else about the Member is shown (V17) |

Every change to rules or channels must add or update rows here and in the test suite. A failing visibility test blocks release.

## Settled rules (2026-09-26)

- **V10. Approved Supplier List.** Entries are Project-wide: every Participant sees the supplier name and its approval, never the submittal that approved it.
- **V11. Drawing register.** Approved, current Drawing Revisions are visible to every Participant whose Visibility covers the Drawing's Trade. While under review, only the Participants with access to the review Work Item can see them.
- **V13. Forms are all-or-nothing.** Anyone who can see a Work Item sees its entire Form and Documents. There are no private fields; only Internal Communication is hidden (V5).
- **V14. Workflow view.** In an item's "View workflow" diagram, another company's internal Steps are collapsed into one block ("<Company> review"). The block shows no names, no internal Returns and no Recommended Code. Only the hand-overs (Submit) and the final outcome with its signer are shown, as on the Documental Record.
  The same grouping applies to **every screen that shows Steps or holders**: Kanban swimlanes, the list's **"With"** column (never "Current owner"), report and item steppers, notifications. The viewer's own company appears in full; another company appears as one grouped lane or cell with the company name and never a person's name. The build uses one shared component for this.
  **Step Age follows the grouping (settled 2026-09-30, RP-239).** Inside the Company holding the item, Step Age counts from the current internal Step. Every other Company sees it counted from when the item reached the holding Company, so internal moves there never reset or reveal anything. The periodic ageing report works the same way.
- **V12. Access follows current Visibility.** A Member who gains a Trade or Location sees that dimension's items, including earlier ones. A Member who loses it stops seeing them, except under E2.
- **V15. Company Projects and Participants (settled 2026-09-29, RP-214).**
  - Every Member of a Participant, including its Authorized Person before they are a Project Member, sees for each Project their Company takes part in: its name, code and Project Number, the **Host Company**'s name, their own Participant's Project Role, and their own Company's Project Members with their Positions. This is the **Company Projects** view.
  - The Authorized Person manages their Company's Project Members there, even before being a Project Member.
  - A Participant never sees the list of other Participants: not other Contractors, nor the Consultants, Owners or Owner Representatives. Another Company's name appears only as the Host Company, and on Work Items the viewer can access, where that Company raised the item, the item is or was "With" it, or it acted in the part of the item's history the viewer sees (V14). Never its Project Members.
  - Project Admins see every Participant, because they add and manage them.
  - A Company invited to a Project sees only the invitation (Project name, Host Company, offered Project Role) until its Authorized Person accepts it; declined or pending invitations are never shown to other Participants ([ADR 0009](adr/0009-participant-invitation-with-consent.md)).
- **V16. Visibility grants (settled 2026-09-29, RP-220; introduced in RP-191).** A Participant's Visibility grant is seen by its own Company and by the Project's Project Admins, who set it. A Project Member's grant is seen only by their own Company, and set only by its Authorized Person, within the Participant's (V4). The Authorized Person also sees the Trades and Locations their Participant covers, with the names of the Locations above them so each one reads in place (Tower 1 › Building A), so they can narrow it for their Members before they are a Project Member themselves (an addition to V15). Nothing else of the Project's Trades and Locations reaches them until they are a Project Member. Every Project Member sees the Project's Trades and Locations.
  - **Visibility Gap warnings follow the same line.** Project Admins are warned only about values no active Participant covers, worked out from Participant grants alone, so a warning never shows how another Company splits its coverage among its Members. Each Authorized Person is warned, for their own Participant only, about values it covers that none of its Project Members do.
- **V17. Inviting a Member whose email is taken (settled 2026-09-30, RP-234).** An email belongs to one Member on the Instance. When an Authorized Person invites an email that belongs to a Member of another Company, the invitation is refused with a clear answer: the person is already registered on Rabaed with another Company. It never says which Company, and nothing else about that Member. This is a deliberate, narrow exception: the inviter learns only that the person is on Rabaed. An email of their own Company's Member gets the ordinary "already a Member" answer. A deactivated Member of their own Company is reactivated rather than invited again, keeping their Signature and records.
