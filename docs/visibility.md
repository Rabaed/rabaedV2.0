# Visibility specification

**The #1 rule of Rabaed: no one sees another company's work unless a rule below explicitly allows it.** When a case isn't covered, the answer is *hidden* until a rule is added here.

Terms follow [GLOSSARY.md](../GLOSSARY.md). Enforcement follows [ADR 0007](adr/0007-project-is-the-tenancy-boundary.md) (Project is the tenancy boundary, row-level security) and [data-model.md](data-model.md).

## The layers

A Member sees a thing only if it passes **every** layer, in order.

| # | Layer | Question | Enforced by |
|---|---|---|---|
| 1 | Instance | Is it on my Instance? | Separate deployments |
| 2 | Project | Is my Company a Participant, and am I an active Project Member? | RLS on `project_id` |
| 3 | Participant access | Has my Participant been given access to this Work Item? (it raised it, it handles a Step, or oversight) | `work_item_access` + RLS |
| 4 | Member Visibility | Does my own Visibility cover the item's Trade, Location and other dimension values? | RLS join on `visibility_grant` |
| 5 | Audience | Is this history entry shared, or internal to my Participant? | `work_item_event.audience` |

**Exceptions** show a sealed Documental Record PDF or an item's Document Number and Subject, never the live item:
- **E1 Link:** you see the Document Number and Subject of an item linked from one you can see, and can open its Documental Record (from Form engine part 4).
- **E2 Signatory Access:** you keep, forever, the Documental Records of items you signed, and your Company keeps those its Members signed.
- **E3 Linked from:** you see the Document Number and Subject of an item that has been Submitted (it has a Submission Date) and links to one you can see. Nothing more, ever: not its Documental Record (settled 2026-10-05).

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
| File downloads | Short-lived signed URLs, issued only after an access check. A Document follows its Work Item: who can't see the item gets 404 for its Documents and their URLs. Files are stored under their Project's prefix, and only the api signs (ADR 0007). |
| Form `member` and `participant` fields | Offer only the Project Members and Participants the filler can see (V15): their own Participant's Members; their own Participant, the Host Company's and the Companies on the item. A saved id they couldn't have been offered is refused like a made-up one. Another Company reads a `member` answer as the Company's name only, without the Member's id (V14). |
| Pins on shared Drawings | Show only Pins of visible items. A shared floor plan must not show a competitor's Snags. |
| Links | Show a target's number, title and Documental Record (E1). Never its live data or history. A target the viewer can't see reaches the browser as its number and title only, without its id, and opening it says only that the viewer may not see its details; the item's own URL still returns 404. |
| Linked from | Lists the items that link to one the viewer can see, with number and title only for those the viewer can't see (E3). Only items that have been Submitted at least once are listed, never one that hasn't left its raiser yet (Draft or internal review). An item Sent Back to its raiser stays listed, with its Links as they were at the Send Back, until it is Submitted again (settled 2026-10-06, RP-295). |
| Form Sections filled by another Participant | While the item is at that Participant's Step, its changed answers and their `answers_changed` events reach only its Members; everyone else reads the answers as they arrived (V19). Applied in the one answers read (ADR 0012), so the api, the Activity Feed and the history all see the same thing. |
| Creation Date | Seen only by the raiser's Participant; other Companies see the Submission Date, so they never learn how long the raiser worked on it. When a Draft was first started is kept for audit, even for a cancelled or discarded Draft, and shown to nobody (settled 2026-10-06). |
| Link search | Offers only items in the same Project that the linker can see and that have been Submitted at least once, including one Sent Back to its raiser (settled 2026-10-06, RP-295). A saved id they couldn't have been offered is refused like a made-up one. |
| Notifications and emails | Sent only to Members with access. The subject line holds only what the recipient may see. |
| Distribution List | Receives the Documental Record link only (E2-style sealed PDF), and the link expires. |
| Activity Feed | Built from `work_item_event` and `project_event`, filtered through layers 3 to 5. |
| Work Item history | The item's `work_item_event`s through layers 3 to 5. Another Company appears by name only; the one person of another Company named is the signer of the final Code (V14). Events are numbered 1, 2, 3… as the viewer sees them, never by the stored `seq`, whose gaps would count another Participant's internal events and Internal Notes (V5). |
| Step Age reports | Each Participant's report covers items it has access to. The Owner-level report covers oversight items. |
| Exports and handover | An export contains only what the exporter could see, plus their E2 records. |
| Document Numbers | A Numbering Pattern whose sequence counts by the Participant Code gives each Company its own counter, so sequence gaps don't reveal a competitor's volume. A Project may choose a shared counter (settled 2026-10-05): saving that pattern needs the Project Admin or Rabaed Engineer to accept a warning that each Company can tell other Companies' volume from the gaps. The Rabaed Default counts by the Participant Code. Counter values are seen only by Project Admins and Rabaed Engineers. |
| Revisions | Each Revision is its own Work Item under V1: a Revision in Draft or internal review stays inside the raiser's Participant. The Revision drop-down lists only the Revisions of the chain the viewer may see. Links agree with it (settled 2026-10-05, RP-311 review): the Links System Field, link answers and Linked from leave out an item of the viewer's item's own chain that the viewer can't see, not showing even its number and title (e.g. the original's `related` Link to a Rev 1 moved to a Location the viewer doesn't cover). A discarded Revision reaches nobody, through any Link read. |
| Form answers | Read only through one database function, never from `work_item.data` directly. It strips every reference the reader may not see: another Company's Member (V14), a Participant they may not see, and a Work Item they may not see, which is replaced by its Document Number and Subject without its id (E1, ADR 0012). |
| Errors and logs shown to users | Never include another item's title, number or Company. |
| Refusals of a Transition | Never say why another Participant can't take the next Step (no Participant covers the item, several do, or nobody there holds the Position): one answer for all, so its Visibility and Positions stay its own (V14, V16). |
| Visibility Gap warnings | A Project Admin's warnings come from Participant grants only; an Authorized Person's cover only their own Participant's Members (V16). |
| Rabaed Admin | A separate role, with `admin_action` logged on every read of customer data. |
| Participant Invitation by CR number | One answer, status and body alike, whether or not the CR number is on Rabaed. The Project Admin's pending invitations list both kinds by CR number, never by Company name, and a declined invitation stays listed like a CR number that isn't on Rabaed (ADR 0009). When Rabaed onboards that CR number, its row becomes the Company's invitation unchanged, and a CR number is never listed twice on a Project (RP-252). |

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
| 12 | K1 creates an Inspection linking an item outside the inspector's Visibility | Inspector | Sees the number and title only; opening it says they may not see its details. The Documental Record from Form engine part 4 (E1) |
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
| 27 | K1 submits a Work Item linking C1's MAR | C1 | The MAR's Linked from shows K1's item number and title only; opening it says C1 may not see its details. Its answers, history and Documents stay hidden, and its URL returns 404 (E3) |
| 28 | C1 links its Draft MAR-2 to its submitted MAR-1 | K1, who sees MAR-1 | MAR-1's Linked from doesn't list MAR-2 while it is in Draft or internal review; it appears once MAR-2 is Submitted |
| 29 | C1 searches for an item to link | C1 | Only items in this Project that C1 can see and that have been Submitted: no Drafts, no items in internal review, nothing from another Project, nothing of C2's |
| 30 | A C1 caller saves a link to a C2 item id, or to an item in another Project | C1 | Refused like a made-up id |
| 31 | K1 reads the answers of an item whose link question points at an item K1 can't see | K1 (app database role) | The answer holds that item's number and title, never its id (ADR 0012) |
| 27 | K1's Authorized Person, not a Project Member, narrows a K1 engineer | K1 Authorized Person | Sees only the Trades and Locations K1 covers, with the names of the Locations above them, and the Scopes and Sub-scopes under those Trades; nothing else of the Project (V15, V16) |
| 28 | C1 member opens the Project's Participants | C1 member (not a Project Admin) | Sees C1's own Participant, its Project Role and Project Members, and the Host Company's name. C2, K1 and OR are not listed (V15) |
| 29 | Project Admin opens the Project's Participants | Project Admin | Every Participant is listed (V15) |
| 30 | K1 invited to the Project, not yet accepted | C1 member; K1 Authorized Person | C1 doesn't see K1 anywhere. K1's Authorized Person sees only the invitation: Project name, Host Company, offered Project Role (V15, ADR 0009) |
| 31 | Project Admin enters a CR number that isn't on Rabaed | Project Admin | Same answer as for a Company that is on Rabaed; nothing reveals whether it exists (ADR 0009) |
| 32 | K1 covers Mechanical, but none of K1's engineers is granted Mechanical | Project Admin (C1 Company) | No Visibility Gap warning, since K1 covers Mechanical. Nothing shows how K1 split its coverage among its engineers (V16) |
| 33 | Same | K1 Authorized Person | Warned that no K1 Project Member covers Mechanical. Other Participants' Members never count towards it (V16) |
| 34 | C1 PM Submits the MAR with an Internal Note | K1, OR | See the Submit; never the Internal Note (V5) |
| 35 | K1 engineer sends the Submitted MAR to the K1 PM, who returns it to the engineer | C1 PM | Sees "With K1" and Step Age counted from the Submit; no reset, no internal move (V14) |
| 36 | C2's Authorized Person invites the email of a C1 Member | C2 Authorized Person | Refused: already registered on Rabaed with another Company. C1 is never named, and nothing else about the Member is shown (V17) |
| 37 | C1 PM Submits an Electrical item when (a) no Consultant covers it, (b) two do, or (c) the covering Consultant has nobody who can hold the Step | C1 PM | Submit isn't offered, and taking it gets the same refusal in all three cases. Nothing in it names a Consultant or says which case it is (V14, V16) |
| 38 | Project Admin withdraws two pending invitations: one to a CR number not on Rabaed, one to K1 (declined or still pending) | Project Admin; K1 Authorized Person | Both leave the Project Admin's list in exactly the same way. K1's invitation also leaves K1's list. Nothing shows which one was a customer (ADR 0009) |
| 39 | K1's Library has two Forms; one is used on Project "Tower" | C1 member on "Tower"; a Company sharing no Project with K1 | The C1 member sees only the Form used on "Tower" and can copy it into C1's Library. Neither sees K1's other Form, and the other Company sees nothing of K1's Library (V18) |
| 40 | A C1 member who isn't a Project Admin, K1's Authorized Person, or the Project Admin of another Project adds, renames or deactivates a Scope of "Tower" | Each of them | 404, the same as for a made-up id; the Scope is unchanged. Nobody outside "Tower" ever reads its Scopes (V16) |
| 41 | C1 engineer attaches a datasheet to a Draft MAR; C2, K1 and a C1 member off the Project ask for its Documents, a download URL, or try to upload or remove one | Each of them | 404, the same as for a made-up id, naming nothing. After the Submit, K1 sees and downloads it, with C1's Company name but not the engineer's (V13, V14) |
| 42 | A Member of Project A reads Documents with the database role directly | That Member | Never a Document of Project B, not even by its id |
| 43 | C1 engineer fills a `member` and a `participant` field on a MAR, then C1 Submits it | C1 engineer; K1 | C1 is offered only C1's Project Members, and C1 and the Host Company; saving C2's, K1's or OR's id (or one of their Members') is refused exactly like a random id. After the Submit, K1 reads the `member` answer as C1's name, with no id or name of the person (V14, V15) |
| 44 | C1 engineer takes site photos into a MAR's `photos` field; C1 Submits it; C2 asks for its Documents or a photo's download URL | K1; C2 | K1 sees each photo with the time and place its EXIF records, as C1 does (V13). C2 gets 404 for the Documents and the URLs, the same as for a made-up id |
| 45 | C1 engineer fails an item of a MAR's `checklist` field and attaches its evidence photo and comment; C1 Submits it; C2 asks for the item's Documents or the photo's download URL | K1; C2 | K1 reads the answers, the comment and the evidence photo (with its time and place) as C1 does (V13). C2 gets 404 for the Documents and the URLs, the same as for a made-up id |
| 46 | C1 engineer opens a Draft MAR on Form Version 4 | C1 engineer | Sees "Consultant verification" empty and read-only, marked "Filled in by the Consultant"; saving an answer into it is refused (V19) |
| 47 | K1 engineer fills "Consultant verification" at `consultant_review` and saves twice, without issuing a Code | C1 PM, OR, OW; K1 PM | C1, OR and OW read the section empty, as it arrived, and see no `answers_changed` events, through the api and with the database role. The K1 PM sees the saved answers and both changes (V19, ADR 0013) |
| 48 | K1 issues Code C with Remarks after filling "Consultant verification" | C1 PM, OR | Both see the verification answers as issued and the Remarks; never an Internal Note written with the Code (V5, V19) |
| 49 | C1 creates a Revision of the MAR that got Code C | C1 engineer; K1 | The Revision's "Consultant verification" is empty; the closed MAR still shows K1's answers (V19) |
| 50 | A C1 Member saves answers into C1's own sections while the MAR is at `consultant_review` | C1 Member | Refused; after Submit, only the Participant holding the Step edits, and only the Form Sections that name its Steps |
| 51 | C1 creates Rev 1 of a MAR that got Code C and saves it as a Draft | K1, OR | The MAR's Revision drop-down still lists only the original; Rev 1's URL returns 404 (V1) |
| 52 | C1 Submits Rev 1 | K1 | Sees `… Rev 1`, and the drop-down lists the original and Rev 1; choosing the original shows its own answers, Documents and history |
| 53 | Project "Tower" counts MARs by Participant Code (the Rabaed Default) | C1 | C1's MAR numbers run 0001, 0002, 0003 with no gaps from C2's MARs |
| 54 | The Project Admin saves a pattern whose sequence leaves out the Participant Code | Project Admin | Refused until the shared-counter warning is accepted; once accepted, C1 and C2 share one count |
| 55 | A C1 member, or K1, asks for the Project's numbering counters | C1 member; K1 | 404, naming nothing; the Project Admin and a Rabaed Engineer can read them |
| 56 | C1 discards a Draft Rev 1, then creates the Revision again | C1; K1 | The new one is Rev 1 again; K1 never sees the discarded one |
| 57 | K1 engineer saves a "No" and a note in its section, then Sends the item Back to C1 | C1 PM, OR, OW; K1 | C1 reads the section as it arrived (empty) after the Send Back; OR and OW too once C1 Submits again; none see K1's `answers_changed` events. K1 starts again from the section as it arrived, its earlier changes still in its own history (V19, ADR 0013) |
| 58 | K1 Sends a Submitted item Back to C1, and C1 works on it for three days | K1; OR | The item still appears in their Link search, and in the Linked from of the items it linked at the Send Back, with the same Document Number and Subject (RP-295) |
| 59 | While the item is Sent Back, C1 removes its Link to X and adds one to Y | K1, who sees X and Y | X's Linked from still lists the item and Y's doesn't, until C1 Submits it again (V19) |
| 60 | C2 searches for an item to link, before and after C1's item is Sent Back | C2 | Never offered C1's item (V1) |
| 61 | C1 engineer starts a Draft on 10 Feb, sends it for review on 12 Feb, and the C1 PM Submits it on 1 Mar | C1; K1 | C1 sees Creation Date 12 Feb and Submission Date 1 Mar; K1 sees only the Submission Date. Nobody sees 10 Feb, which stays in the audit trail even if the Draft is cancelled |
| 62 | C1 moves Rev 1 to Building B, names the original in its link question and Submits it | OR covering Building A only; OR covering Building B only | The first sees the original but no Link to Rev 1; the second sees Rev 1 with no Linked from, Link or link answer naming the original; both drop-downs list only the item they see |

Every change to rules or channels must add or update rows here and in the test suite. A failing visibility test blocks release.

## Settled rules (2026-09-26)

- **V10. Approved Supplier List.** Entries are Project-wide: every Participant sees the supplier name and its approval, never the submittal that approved it.
- **V11. Drawing register.** Approved, current Drawing Revisions are visible to every Participant whose Visibility covers the Drawing's Trade. While under review, only the Participants with access to the review Work Item can see them.
- **V13. Forms are all-or-nothing.** Anyone who can see a Work Item sees its entire Form and Documents. There are no private fields; only Internal Communication is hidden (V5), and answers still being filled in at another Participant's Step (V19).
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
- **V16. Visibility grants (settled 2026-09-29, RP-220; introduced in RP-191).** A Participant's Visibility grant is seen by its own Company and by the Project's Project Admins, who set it. A Project Member's grant is seen only by their own Company, and set only by its Authorized Person, within the Participant's (V4). The Authorized Person also sees the Trades and Locations their Participant covers, with the names of the Locations above them so each one reads in place (Tower 1 › Building A), so they can narrow it for their Members before they are a Project Member themselves (an addition to V15). Likewise they see the Scopes and Sub-scopes under the Trades their Participant covers (RP-263). Nothing else of the Project's Trades, Scopes and Locations reaches them until they are a Project Member. Every Project Member sees the Project's Trades, Scopes and Locations. Only its Project Admins change Scopes; anyone else who tries gets a 404 that names nothing.
  - **Visibility Gap warnings follow the same line.** Project Admins are warned only about values no active Participant covers, worked out from Participant grants alone, so a warning never shows how another Company splits its coverage among its Members. Each Authorized Person is warned, for their own Participant only, about values it covers that none of its Project Members do.
- **V17. Inviting a Member whose email is taken (settled 2026-09-30, RP-234).** An email belongs to one Member on the Instance. When an Authorized Person invites an email that belongs to a Member of another Company, the invitation is refused with a clear answer: the person is already registered on Rabaed with another Company. It never says which Company, and nothing else about that Member. This is a deliberate, narrow exception: the inviter learns only that the person is on Rabaed. An email of their own Company's Member gets the ordinary "already a Member" answer. A deactivated Member of their own Company is reactivated rather than invited again, keeping their Signature and records.
- **V18. Library contents (settled 2026-10-03, RP-18).** A Company's Library (Forms, Saved Fields, Option Lists, Trade and Scope lists) is private to that Company. Something in it becomes visible beyond the Company only when it is used on a Project: every Member of that Project's Participants can then see it (a Form, and the Saved Fields and Option Lists that Form uses) and copy it into their own Company's Library. Nobody can browse another Company's Library. A Project Admin may take a Form from any Participant's Library, but only once that Participant's Authorized Person has agreed to offer it to the Project. Rabaed Defaults are visible to every Company.
- **V19. Answers filled in at another Participant's Step (settled 2026-10-05, Form engine part 3, ADR 0013).** A Form Section can be filled in by a Participant other than the raiser, at its own Steps. While the item is with that Participant, the answers it changes, and their change history, are visible only to its Members. Everyone else, the raiser and the Owner and Owner Representative included, sees the answers as they were when the item arrived. When the item leaves that Participant (a Submit, a Code, a close), its answers are everyone's who can see the item. A Send Back out of that Participant's Step (ADR 0014) discards the in-progress answers: the sections it fills go back to how they arrived, so nobody else ever reads them, and its change history stays its own. Before it is filled, the raiser sees such a Form Section empty and read-only, marked with who fills it.
