# Rabaed

Rabaed is a B2B construction management platform where companies collaborate on construction projects. Each company takes a different role on each project.

## Language

### Platform and tenancy

**Company**:
A legal business registered on Rabaed, identified by its official name, CR (Commercial Registration) number, and VAT number. Companies are onboarded by Rabaed Engineers; there is no self sign-up yet.
_Avoid_: Tenant, organization, account, customer

**Authorized Person**:
The one Member who legally represents a Company on Rabaed. Only the Authorized Person edits the Company profile and adds Members.
_Avoid_: Representative, company admin, owner (clashes with Owner Representative)

**Project Creator**:
A Member whom the Authorized Person allows to create Projects on the Company's behalf.

**Member**:
A person who signs in to Rabaed. A Member belongs to exactly one Company and keeps a Signature in their profile. Their email address is theirs alone on the Instance: a person already a Member of one Company can't also become a Member of another. A deactivated Member whom their Company invites again is reactivated, keeping their Signature and records.
_Avoid_: User, employee, staff

### Projects

**Project**:
A construction project on which several Companies collaborate, each in a Project Role. It is created directly or from a Tendering award, and is Active until it is Closed, after which everything in it is archived and read-only.

**Active Project**:
A Project that is not Closed. Subscriptions will be sold as bundles of Active Projects.
_Avoid_: Live project, open project

**Host Company**:
The Company whose subscription a Project counts against and whose Project Number series it uses; normally the Company that created it.
_Avoid_: Account, tenant, customer, subscriber

**Project Number**:
A Project's number within its Host Company's own series (1, 2, 3…); two Host Companies can each have a Project 1.
_Avoid_: Project ID

**Project Admin**:
A Member who configures a Project's Settings. The Project's creator is the first one and can appoint others; Rabaed Engineers can too.
_Avoid_: Project owner, project manager

**Project Participant**:
One Company taking part in one Project, in one Project Role. A Project can have any number of Participants in each role. A Company becomes a Participant only when its Authorized Person accepts a Participant Invitation. When a Participant is withdrawn, all its in-progress Work Items are Cancelled, and its replacement starts them afresh.
_Avoid_: Project company, party

**Participant Invitation**:
A Project Admin's offer to a Company, found by its CR number, to join a Project in a given Project Role. It is Invited until the Company's Authorized Person accepts (the Company becomes a Participant) or declines it, or the Project Admin withdraws it.
_Avoid_: Join request, add company

**Company Projects**:
What a Company's Members see of the Projects their Company takes part in, before and besides the Project itself: each Project's name, code, number and Host Company, their own Project Role and Project Members, and pending Participant Invitations.
_Avoid_: My projects list, project directory

**Position**:
A named bundle of Function Permissions (View, Create, Submit, Review, Approve, Assign, Close, Attach) that a Member holds on a Project, such as Engineer or Project Manager. Rabaed supplies defaults; Project Admins can add their own, and a Member can hold several.
_Avoid_: Role, job title, permission set

**Project Role**:
The part a Company plays on one Project: Contractor, Consultant, Owner or Owner Representative, or a custom role (e.g. Subcontractor, PMC) that is based on one of these and can do no more than it. A Company can hold different Project Roles on different Projects.
_Avoid_: Company role, company type

**Contractor**:
The Project Role of a Company that builds the works for its Trades.

**Consultant**:
The Project Role of a Company that designs and/or supervises the works for its Trades on the owner's behalf.

**Owner**:
The Project Role of the Company that owns and pays for the project.
_Avoid_: Client, employer, developer

**Owner Representative**:
The Project Role of a Company that acts for the Owner on the project, such as a PMC.
_Avoid_: Client representative

### Visibility and scope of works

**Visibility Dimension**:
A way a Project is divided that controls who sees which Work Items, such as Trade or Location; more can be added.
_Avoid_: Filter, category, scope

**Trade**:
A discipline of the works, such as Civil, Architectural, Electrical or Mechanical. Rabaed supplies a default list that each Project can extend.
_Avoid_: Discipline, package

**Location**:
A place in the Project's physical breakdown, such as a Zone, Building, Villa or Floor, or a Sector on infrastructure projects. A Location can be drawn on the Project's site map or floor plans so Work Items and Drawings can be shown on it.
_Avoid_: Area, WBS

**Visibility**:
The values of each Visibility Dimension a Participant or a Member covers on a Project, each either "all" or a chosen list; a Work Item is visible only if all its values are covered. A Member never covers more than their Company does. A value that no active Participant covers is a Visibility Gap, which Project Settings warns Project Admins about. Each Authorized Person is also warned about values their Participant covers that none of its Project Members do.
_Avoid_: Scope, access, coverage

**Scope**:
A defined piece of work within a Trade (e.g. under Electrical: lighting), broken down further into Sub-scopes. Rabaed supplies defaults; Project Admins can add more.
_Avoid_: Work package, visibility

**Sub-scope**:
A finer piece of work within a Scope.
_Avoid_: Sub-package

### Work Items

**View**:
A way of displaying Work Items: List, Kanban, Floor (by building and floor), Plan (pinned on a floor plan Drawing) or Map (zones on the site map). Floor, Plan and Map show Work Items from several Modules together and live in the Project's Views tab.
_Avoid_: Layout, screen, Multiple View

**Pin**:
The optional point where a Work Item sits on a plan Drawing of its Location, used by the Plan View.
_Avoid_: Marker, tag

**Location Status**:
A Location's progress picture (Complete, In Progress, Issues, Pending) worked out from the Work Items at that Location.
_Avoid_: Progress percentage

**Module**:
One tab of a Project: Dashboard, Submittals, Inspections, Snag List, Site Reports, Drawings, Files, Views, Schedule, Settings. Submittals, Inspections, Snag List and Site Reports hold Work Items. Packages live inside Submittals, the Activity Feed inside the Dashboard, and the Approved Supplier List inside Settings.
_Avoid_: Section, app

**Work Item**:
One trackable item in a Project, such as a submittal, an inspection or a snag, made from a Form and routed through a Workflow. Each Work Item has exactly one Trade and may cover several Scopes within it.
_Avoid_: Ticket, request, form (for the instance)

**Work Item Type**:
A kind of Work Item within a Module, such as Material Submittal, Inspection Request, Snag or Comment, with a short code (e.g. MAR, SAR, DAR) used in filters and Document Numbers. It fixes which Form and which Workflow its Work Items use.
_Avoid_: Form type, category

**Subtask**:
A Work Item created under another Work Item, of any Type in the same Module and with its own Workflow. There is only one level, and the parent cannot close while a Subtask is open.
_Avoid_: Child item

**Link**:
A reference from one Work Item to another in the same Project, in any Module, which opens the other item; for example an Inspection linking the approved material, drawing and method submittals it relies on, instead of attaching their PDFs. A Link is added freely in the Links System Field or by answering a link question in the Form, and an item can have any number of them. Only an item the linker can see, and that has been Submitted at least once (it has a Submission Date), can be linked, even while it is Sent Back to its raiser. Every Link shows the other item's Document Number and Subject; a viewer who cannot see the linked item sees only those, and can open its Documental Record but not the item itself. The linked item lists the items that have been Submitted and link to it as **Linked from**, with their Document Number and Subject, whoever is viewing. A Link is not a parent–child relationship and does not block anything.
_Avoid_: Relationship, dependency

**Inspection**:
A Work Item in the Inspections Module, such as a Work Inspection Request (WIR), in which the Contractor requests an inspection of work at a Location and Trade, and the Consultant carries it out against its Checklist and gives an Inspection Result. A Failed inspection is re-inspected as a Revision.
_Avoid_: Site visit, check, IR (as a term on its own)

**Inspection Result**:
The outcome of an Inspection: Passed, Passed with Comments, or Failed. Each Work Item Type uses Review Codes, Inspection Results, or neither.
_Avoid_: Review Code, grade

**Expected Frequency**:
How often a Work Item Type, such as the Daily Site Report, must be issued. A missing one shows as a gap, triggers reminders, and is flagged when the next Weekly report is prepared, where it can be added afterwards or ignored.
_Avoid_: Recurrence, schedule

**Site Report**:
A Work Item in the Site Reports Module that records site conditions or findings, such as a Daily Site Report (weather, manpower, equipment, materials, work done, problems), a Weekly report, a Quality report or a Safety report. It is Submitted by the Contractor. The Consultant Approves it, Sends it Back with comments ("Return for Comment") to be fixed and Submitted again, or Rejects it. It ends Approved or Rejected; it carries no Review Code and is not a submittal.
_Avoid_: Site log, diary, Affirm

**Checklist**:
A Form field made of predefined check items, each answered and optionally evidenced with photos.
_Avoid_: Tick list

**Snag List**:
The Module holding follow-up Work Item Types: Snags, Comments, and others such as Questions or plain tasks.
_Avoid_: Comment list, punch list

**Snag**:
A Work Item in the Snag List recording a defect or an action to be done.
_Avoid_: Punch item, defect

**Comment**:
A Work Item in the Snag List created from a reviewer's comment on a Code B approval, linked to the reviewed Work Item.
_Avoid_: Remark (the text written with a Code is Remarks), note

**Cancelled**:
The outcome of a Work Item stopped before it finished, such as when its Participant is withdrawn from the Project. It cannot be reopened.
_Avoid_: Deleted, voided


**Form**:
The customisable middle of a Work Item, built in the form builder: the fields a Work Item Type captures between the System Fields above and below it. Field labels are in Arabic and English. A Form is a Rabaed Default, kept in a Company's Library, or copied into a Project.
_Avoid_: Template (on its own), general template

**Form Section**:
A titled group of fields in a Form, filled in by one Participant at the Steps the Form names. A Form Section filled in by a Participant other than the raiser, such as the Consultant's verification on a submittal, is read-only to the raiser.
_Avoid_: Section (on its own), panel, tab

**System Field**:
A part of every Work Item that no Form can remove or move out: Subject and Document Number above the Form, Attachments and Links below it.
_Avoid_: Default field, header

**Built-in Field**:
A field that sits inside every Form but can't be deleted or made optional, because visibility depends on it: Trade, Location, Scopes, and any Visibility Dimension a Project requires on Work Items. A Form chooses only where they appear and how they are labelled.
_Avoid_: Locked field, mandatory field

**Subject**:
The short line that names a Work Item, such as "Lighting Fixtures". A System Field.
_Avoid_: Title, name

**Option List**:
A managed list of choices with up to three levels (list, sub-list, sub-sub-list), kept in one place and used by Form fields. Changing it changes the choices in every Form that uses it; an option removed later stays on Work Items that already chose it.
_Avoid_: List (on its own), dropdown, lookup

**Saved Field**:
A field set up once (labels, type, rules, Option List) and kept in the Field Library, so it can be inserted into many Forms. Inserting copies its settings into the Form.
_Avoid_: Field template, reusable field

**Field Library**:
The part of a Library that holds Saved Fields and Option Lists.
_Avoid_: Field management (the screen, not the thing)

**Library**:
A Company's own collection of Forms, its Field Library, its Trade and Scope lists, and its Workflows and Work Item Types, built or copied. A Project copies a Company's Trade and Scope lists when it is set up, and takes later changes only when its Project Admin pulls them in. A Project takes its Forms from the Rabaed Defaults or from any of its Participants' Libraries, as the Project Admin chooses. Taking or copying one always makes an independent copy that notes where it came from: later changes to the original never reach it.
_Avoid_: Template library, catalogue

**Workflow**:
The versioned graph of Steps and Transitions, drawn in the visual workflow builder, that a Work Item passes through. A Work Item stays on the Workflow version it started with.

**Version**:
A published, unchangeable edition of a Form or a Workflow. A Work Item stays on the Versions it started with; later Versions apply only to new Work Items.
_Avoid_: Revision (reserved for Work Items), edition

**Stage**:
A named phase that shows where a Work Item is overall, such as Drafts, Internal Review, Revised & Resubmitted, Pending Approval, Approved, Rejected or Cancelled. Each Module has one shared set of Stages (Rabaed Defaults the Project can rename or extend), and every Workflow places its Steps into them. Stages are the Kanban columns.
_Avoid_: Status, state, phase

**Step**:
One point in a Workflow where a Work Item waits for a person or Step Pool to act, such as "Contractor Project Manager review". A Step belongs to one Stage.
_Avoid_: Node, task, state

**Transition**:
A move of a Work Item from one Step to another, shown as a button whose label the Workflow sets, such as "Send for Review", "Request More Information" or "Submit". Each Transition has its own Action Form and notifications.
_Avoid_: Action, button

**Action Form**:
The pop-up form a Member fills in when taking a Transition, such as choosing a Review Code, writing a reason or an Internal Note, attaching files, or, with Code B, writing the reviewer's Comments, each of which becomes its own Comment in the Snag List; each Transition defines its own.
_Avoid_: Dialog, modal

**Submit**:
The Transition that hands a Work Item from one Participant to another, such as from the Contractor to the Consultant.

**Return**:
A Transition that sends a Work Item back to an earlier step within the same Participant, such as a Contractor manager asking their engineer for more information.
_Avoid_: Reject, RFI

**Send Back**:
A Transition that hands a Work Item back to the Participant that Submitted it, with a comment saying what to change and no Review Code. It stays the same item with the same Document Number, and carries on when that Participant Submits it again. Unlike Code C, it neither closes the item nor starts a Revision. A Workflow may offer it; the Rabaed Default submittal Workflows don't, and use Code C instead.
_Avoid_: Return (which stays inside one Participant), RFI, Reject

**Creation Date**:
The date a Work Item got its Document Number, when it first left Draft (for a MAR, when the engineer sends it to their PM). Only the raiser's Participant sees it; other Companies see the Submission Date. When a Draft was first started is kept for audit, even if the Draft is cancelled or discarded, and shown to nobody.

**Submission Date**:
The date a Work Item was first Submitted out of its raiser's Participant, such as from the Contractor to the Consultant. It is empty until then, a later Submit doesn't change it, and each Revision has its own. Other Companies see a Work Item from its Submission Date: before it, the item is the raiser's own work.

**Step Age**:
How many weeks a Work Item has sat at its current step (1, 2, 3, 4+), shown as dots and sent in a periodic ageing report. Inside the Company holding the item it counts from the current Step; every other Company sees it counted from when the item reached that Company. Rabaed shows age only; it sets no due dates or SLAs.
_Avoid_: Overdue, SLA, deadline

**Vacancy**:
A Workflow step whose assignee (a Member) has left the Project. The step waits, and the assignee's Company is notified to name a replacement.
_Avoid_: Orphaned task, unassigned

**Submittal Register Import**:
Uploading the list of submittals a contract requires (as a spreadsheet now, later as a PDF read by an AI agent) and mapping each row to a Work Item Type and fields, which creates Draft Work Items.
_Avoid_: Bulk upload, migration

**Step Pool**:
The group of Members who can pick up a Workflow step, such as all Consultant engineers on the Work Item's Trade. One of them claims it, unless the step already has a default assignee.
_Avoid_: Queue, group inbox

**Need My Action**:
A toggle on a Project's views that keeps only the Work Items waiting on the viewer: Steps they hold, and Steps in their Step Pool that nobody has claimed yet. Their own Drafts stay in view but are never counted, since nobody is waiting on them. Each Project card shows the count.
_Avoid_: Assigned to me, My tasks, Inbox

**Watch**:
A Member's choice to be told what happens on one Work Item they can see, and on its later Revisions. Its raiser and the Member who Submitted it watch it from the start; anyone can stop. Nobody sees who else watches an item.
_Avoid_: Follow, Subscribe

**Rabaed Default**:
The Forms, Workflows and Work Item Types that Rabaed supplies ready-made, which Companies can use or copy into their own.
_Avoid_: System template, built-in

**Review Code**:
The formal outcome of reviewing a Work Item such as a submittal: A (Approved), B (Approved with Comments), C (Revise and Resubmit) or D (Rejected). Every code closes the Work Item; with B, its Comments continue in the Snag List.
_Avoid_: Status, result

**Recommended Code**:
A Review Code a reviewer proposes to the next reviewer, for information only; the next reviewer can accept it, override it, or send it back.
_Avoid_: Draft code, proposed status

**Issued Code**:
The Review Code given at the Workflow's final review step, which is the one that counts and appears on the Documental Record. Which step is final depends on the Workflow (e.g. the Consultant manager, or an Owner Representative after them).
_Avoid_: Final status

**Remarks**:
The shared text the Consultant writes with a Review Code, a field of the Code Transitions' Action Form: optional with A, required with C. Unlike an Internal Note, everyone who can see the Work Item reads it, in the item's history.
_Avoid_: Comments (reserved for the Snag List), note

**Revision**:
A resubmission of a Work Item that ended with Code C: a new Work Item, started as a Draft from the latest one, that keeps the same number with a revision suffix (MS-003 → MS-003 Rev 1) and is linked to the one before it. The first submission has no suffix. The earlier one stays closed at Code C, and anyone who sees a Revision can switch to the earlier ones they may see.
_Avoid_: Version (reserved for Forms and Workflows), resubmittal

**Document Number**:
The identifier a Work Item gets when it first leaves Draft (e.g. TWR-MAR-CCM-0001); numbers are never reused, built from the Project's Numbering Pattern. A Revision keeps the number of the one before it, with its revision suffix.
_Avoid_: ID, reference number

**Numbering Pattern**:
How a Project builds its Document Numbers: up to six segments (Project, Work Item Type, Trade, Participant Code, Location level, fixed text), a separator and a sequence, with the segments the sequence counts separately for. One per Project, optionally overridden per Work Item Type. Set by the Project Admin or a Rabaed Engineer; a change applies only to Work Items numbered after it.
_Avoid_: Numbering scheme, format

**Participant Code**:
The short code (2–6 letters or digits) that stands for a Participant in that Project's Document Numbers, such as CCM; until it is set, the Participant's position on the Project (01, 02…). Set by the Project Admin, and fixed once a number uses it.
_Avoid_: Company code, contractor code

**Package**:
A named group of submittals covering one piece of work (e.g. bathrooms), submitted together, with each submittal still getting its own Review Code. It is Open, In Progress or Closed, and closes by itself once every submittal in it ends at Code A or B, after any Revisions or replacements.
_Avoid_: Bundle, batch, transmittal

**Approved Supplier List**:
A Project's register of suppliers and manufacturers that may be used, either loaded as a pre-approved list or built up as supplier submittals are approved through their Workflow.
_Avoid_: Vendor list, AVL

**Chat**:
The discussion thread on a Work Item, visible to every Participant who can see the Work Item, for talking without moving it between Steps. Messages cannot be edited or deleted.
_Avoid_: Comments (reserved for the Snag List), messages

**Internal Communication**:
The part of a Work Item's history (Internal Notes, Step changes, Returns, approvals) that happens inside one Participant and is visible only to that Participant. Other Participants see only the Transitions between Participants, such as Submit and the Issued Code.
_Avoid_: Private log

**Internal Note**:
Free text a Member writes in the Action Form when taking a Transition, recorded with it in Internal Communication. It is never posted on its own, and it stays inside the writer's Participant even when the Transition goes to another Participant.
_Avoid_: Note, remark (shared text written with a Code is Remarks), comment

**Activity Feed**:
The Project-level log of what happened across the Project, filtered by each viewer's Visibility and Internal Communication rules.
_Avoid_: Activity (reserved for the Schedule), audit log

### Files and signing

**Document**:
A file attached to a Work Item.
_Avoid_: Attachment, file

**File Version**:
An earlier copy of a free file in the Files Module, kept when a new copy is uploaded. Documents attached to a submitted Work Item are frozen and have no File Versions.
_Avoid_: Revision, Drawing Revision

**Signature**:
A Member's signature, kept in their profile and applied, together with who acted and when, every time they take a signing Transition on a Work Item. A Member without one cannot take signing Transitions.
_Avoid_: Stamp, initials

**Documental Record**:
The certified PDF produced when a Work Item closes, whatever its outcome (approved, issued, Code C or D, Failed, Cancelled): its Form content, all Documents, the Signature of everyone who acted on it and the events between Participants, in one file. Internal Communication and Chat are left out. It is printed in Arabic, English or both, as the Project's settings choose.
_Avoid_: Output, report, printout

**PDF Template**:
A layout a Documental Record is printed with, such as a portal-style or a paper-matching layout. A Form can have several, and each Project chooses one per Work Item Type.
_Avoid_: Print template, report format

**Distribution List**:
The people, including email addresses outside Rabaed, who receive a Work Item's Documental Record when it is issued, as an expiring, tracked link. Each Work Item Type has a default list per Project that can be edited on each item.
_Avoid_: CC list, mailing list

**Signatory Access**:
The permanent right of every Member who signed a Work Item to see the Project's name and open the Documental Records they signed, even after removal from the Project or its closure. The Company keeps the same right, through its Authorized Person, for everything its Members signed.
_Avoid_: Legacy access, archive access

### Drawings

**Drawing**:
A controlled design file (of any file type) in the Drawings Module that keeps every Drawing Revision uploaded for it. Drawings are reviewed through drawing-submittal Work Items; approved Drawing Revisions become current in the register.
_Avoid_: Plan, sheet, document

**Drawing Revision**:
One uploaded issue of a Drawing; the newest is current and earlier ones are kept. Two Drawing Revisions can be overlaid to see exactly what changed.
_Avoid_: Version, Revision (reserved for Work Items)

**Markup**:
An annotation a reviewer places on a spot of a Drawing Revision. Every open Markup must be answered (fixed, or replied to) before the next revision can be resubmitted; Markups carry over to the next Drawing Revision, and open ones become Comments on Code B.
_Avoid_: Redline, annotation, comment (reserved for the Snag List)

### Modules

**Project Module**:
The part of Rabaed for running Projects.

**Schedule Module**:
The Project tab for planning and tracking the programme of works. To be designed in its own session.

**Tendering Module**:
The part of Rabaed where a project's specs and BOQ are put out to tender. The award creates the Project, onboards the winner, and carries over the specs, BOQ and required submittals. Not designed yet.

**Financial Module**:
The part of Rabaed that holds a Project's BOQ, Claims, invoices and payments, synced with the Company's invoicing system (e.g. Oracle, SAP). Not designed yet.

**BOQ**:
The Bill of Quantities: the priced list of every item of work in a Project.
_Avoid_: POQ, price list

**Claim**:
A Contractor's request for payment for quantities done, built from the BOQ quantities recorded on passed WIRs.
_Avoid_: Invoice (that belongs to the invoicing system), payment application

**Executive Report**:
A high-level periodic report for management meetings: schedule milestones against target, claimed against plan, and spend against budget.
_Avoid_: Management summary

### Operations

**Rabaed Admin**:
The portal where Rabaed Engineers onboard and support Companies and Members. It is separate from the app Companies use: its own address, its own sign-in with a one-time code, and never served by the same system as the customer app.
_Avoid_: Back office, super admin

**Instance**:
One independent deployment of Rabaed: the standard one hosted outside Saudi Arabia, or the premium one hosted inside it. Each Project lives on the Instance its Owner requires; its Companies and Members are onboarded on that Instance, separately from any account on the other. Data is never migrated between Instances.
_Avoid_: Region, tenant, environment

**Rabaed Engineer**:
A Rabaed staff member who uses Rabaed Admin. Not a Member of any Company. May reassign or reset a stuck step but never makes a decision in a Workflow, and never moves a Work Item to another Workflow version.
