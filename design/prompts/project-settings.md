# Design request: Project Settings pages (RP-419)

Paste the shared brief from `design-requests-2026-10-07.md` first. Rules: `docs/visibility.md` V16 and the Visibility Gap warnings.

**What it is:** two Project Settings pages, inside the settings layout of `settings-numbering.html` (left settings nav: Document Numbering · Trades & Locations · Visibility; Workflows later).

**Who uses it:** the Project Admin (edits); other Members see the pages read-only or not at all, as today.

## Pages

1. **Trades & Locations:**
   - Trades: code and name, e.g. "Electrical Works (EL)"; Scopes and Sub-scopes under each Trade.
   - Locations: a tree, e.g. Tower 1 › Floor 02, each with its code (`T1F02`).
   - Add, rename and archive; codes left-to-right.
   - Show how a long tree reads: collapse and expand, search.
2. **Visibility** (Participant Visibility):
   - For each Participant: its name and Project Role, the Trades and Locations it covers, and Edit.
   - **Visibility Gap warnings**: values no active Participant covers, worked out from Participant grants only. They never show how a Company splits its coverage among its Members.
   - Adding a Participant (by Company CR number and Project Role, sending a Participant Invitation) belongs here too: show the "Add Participant" dialog and a pending invitation.

## Frames

The Project Admin on each page (desktop); the read-only view of Trades & Locations for a Contractor engineer; phone (402) of the Visibility page.

Desktop 1366 and 1920, tablet 820, phone 402; English and Arabic.
