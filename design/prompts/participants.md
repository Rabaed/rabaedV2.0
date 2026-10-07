# Design request: Participants (RP-418)

Paste the shared brief from `design-requests-2026-10-07.md` first. Rules: `docs/visibility.md` V15 and V16, ADR 0009.

**What it is:** under My Company → Participants, the **Company Projects** view: every Project my Company takes part in, the Participant Invitations it received, my Company's Project Members on each Project, and one Member's Visibility. (A Project Admin adds Participants in the Project's own settings, not here.)

**Who uses it:** the Authorized Person of a Company (e.g. Saeed at TMC), who manages the Company's Project Members even before being a Project Member; other Members of the Company see it read-only.

## Screens

1. **Company Projects** (`/participants`):
   - **Invitations** first, if any: Project name, Host Company, offered Project Role, **Accept / Decline** (Decline asks to confirm).
   - Then one card or row per Project: name, code and Project Number, Host Company, my Company's Project Role, number of my Project Members, "Project Members" link.
   - Never another Participant's name or list.
2. **Project Members of one Project** (`/participants/<id>`): my Company's Members on it, with their Positions; **Add a Member of your Company** and **Remove** (confirm: "They lose access at once"); a **Visibility** link per Member.
3. **A Member's Visibility** (`…/members/<member>/visibility`): Trades and Locations as checkable lists ("All of your Company's Trades", Locations shown in place, e.g. "Tower 1 › Building A"), Scopes under their Trades, Save. A Member can never cover more than the Company ("A Member can't cover more than their Company does"). A **Visibility Gap warning** for the Authorized Person: values the Company covers that none of its Project Members do.

## Frames

Saeed on screen 1 with one invitation; screen 2 for Riyadh Gate Tower; screen 3 for Omar (Tower 2 only) with a Gap warning. Phone (402) of screens 1 and 3.

Desktop 1366 and 1920, tablet 820, phone 402; English and Arabic.
