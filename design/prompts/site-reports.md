Design the **Site Reports** module for Rabaed, a B2B construction management web app used in Saudi Arabia (Arabic and English, full RTL support). Reports are mostly filled in **on a phone on site** and reviewed on desktop.

## Context
Site Reports is a tab inside every Rabaed project. It holds recurring reports that record what happened on site. Each report is a **Work Item** of a **Report Type**, built from a form, going through a short review workflow, and issued as a sealed PDF. Report Types (the project can add more):

- **Daily Site Report** (daily site log): a big form filled in every working day by the Contractor.
- **Weekly Progress Report:** starts pre-filled with totals from that week's issued Daily reports, then edited.
- **Weekly Safety (HSE) Report:** a checklist-based inspection of site safety, with photos. Failed items can raise **Snags** automatically.
- **Quality Check Report:** checklist + photos.
- **Monthly Report:** optional, a summary of the month.

**Lifecycle of a report:**
1. **Draft:** the site engineer fills it in, with autosave.
2. **Internal Review:** the Contractor PM checks it and can Return it with a note.
3. **Submit ✍:** signed, handed to the Consultant (and visible to the Owner Representative).
4. **Acknowledged ✍:** the Consultant reviews and acknowledges it, or Returns it with comments.
5. **Issued:** a sealed, certified PDF (the "Documental Record") is produced, stored in Files, and emailed as a secure link to the report's **Distribution List** (people inside or outside Rabaed).

**Expected Frequency:**
- Each Report Type can say how often it is due (Daily Report every working day, Safety Report weekly).
- Missing reports show as **gaps** on a calendar, and reminders are sent.
- When preparing the Weekly report, Rabaed warns: "Daily report for Tue 6 Aug is missing". The user chooses **Add it late** or **Ignore**, and that choice is recorded.
- **No deadlines, SLAs or "overdue" wording.** Say "missing" for gaps, and show age only (weeks at the current step, as up to 4 dots).

**Visibility rule (critical):**
- A report is private to the Contractor until it is **Submitted**. After that, the Consultant and Owner Representative covering that Trade and Location can see it.
- Another Contractor on the same project never sees it.
- The Contractor's internal comments and returns are never visible to others.
- All counts and calendars cover only what the viewer can see.

## What to design

### 1. Site Reports home (desktop)
- A header with sub-tabs per Report Type: Daily · Weekly Progress · Weekly Safety · Quality · Monthly, plus "+ New report".
- **Calendar view (default for Daily):** a month grid. Each day shows a status chip: Issued ✓, Submitted, Draft, Returned, **Missing** (red dashed outline), or Not a working day (Friday / holiday, greyed). Click a day to open its report, or create it if it's missing.
- **List view:** grouped by Stage (Drafts, Internal Review, Submitted, Issued), with columns: number (e.g. `TWR-TMC-DSR-0217`), report date, type, company, prepared by, stage, age dots, and a PDF icon when issued.
- Filters: company (only the visible ones), Trade, Location, date range, Stage.
- Summary strip: "This month: 22 issued · 1 missing · 1 in review". Counts are for visible reports only.

### 2. Fill a Daily Site Report (phone first)
A long form broken into collapsible sections, with a progress indicator ("5 of 9 sections done"), autosave ("Saved 10:42"), and a sticky "Send for Review" button:
1. **General:** date (defaults to today), shift, Location(s).
2. **Weather:** conditions (icons: sunny, cloudy, dust storm, rain), temperature, wind, humidity, and "Work affected by weather?" yes/no with hours lost.
3. **Manpower:** a table of rows: Trade / category (Mason, Electrician, Steel fixer, Helper…), Company (own or subcontractor), Count, Hours. The total is calculated.
4. **Equipment:** a table: Type (Crane, Excavator, Concrete pump…), Count, Working / Idle hours.
5. **Materials received:** a table: Material, Quantity, Unit, Supplier (pick from the Approved Supplier List), delivery note photo.
6. **Work done today:** activities by Location, with free text and photos.
7. **Issues & delays:** description, cause, impact. Optionally "Create Snag" from an issue.
8. **Safety:** incidents (yes/no, details), toolbox talk held, visitors.
9. **Photos:** a camera-first gallery. Each photo keeps its time and GPS stamp and gets a caption.

Tables must be easy on a phone: rows as cards with steppers, "+ Add row", swipe to delete.
Also show a **"Copy from yesterday"** action for manpower and equipment, since they change little day to day.

### 3. Weekly Progress Report with the missing-day warning
- On create: "Pre-filled from 5 issued Daily reports (Sun 4 – Thu 8 Aug)".
- The totals tables (manpower by trade per day, equipment hours, materials) are editable.
- **Missing-day banner:** "Daily report for Tue 6 Aug is missing", with the buttons **Add it late** (opens the daily form for that date) and **Ignore** (the reason is optional and recorded).
- Sections: progress summary per Location, key issues, look-ahead for next week, photos.

### 4. Weekly Safety (HSE) Report: checklist
- A checklist grouped by category: PPE, Scaffolding, Excavations, Electrical safety, Housekeeping, Fire safety, Welfare.
- Each item answers **Pass / Fail / N/A**. On Fail, a comment and photo are required, and a toggle "Raise Snag".
- A summary at the top: "42 Pass · 3 Fail · 5 N/A", with a list of the Snags that will be raised.
- On phone: one category per screen, big answer buttons, and the camera opens on Fail.

### 5. Report detail (desktop)
- Header: number, type, report date, stage, age dots, and the action buttons the viewer is allowed to use (Send for Review / Return / Submit ✍ / Acknowledge ✍ / Return with comments).
- Tabs: **Report** (read view of all sections) · **PDF preview** · **Chat** · **Internal Communication** (own company only) · **History**.
- A right panel with the Approvals log: who prepared, reviewed, submitted and acknowledged it, with times and ✍ signed markers, plus the Distribution List and delivery status (sent / opened).

### 6. PDF preview (issued report)
- A clean, printable A4 layout:
  - a header with the project and company logos, report number, date and weather;
  - sections as tables;
  - a photo grid with captions and time stamps;
  - a signatures block (prepared / reviewed / acknowledged);
  - a QR verification code and page X of Y in the footer.
- Language set by the project: English, Arabic or bilingual (labels as "English / العربية").

### 7. Report Type settings (admin)
- **Settings → Report Types** list: name, form, workflow, Expected Frequency (none / daily working days / weekly on a given day / monthly), reminder time, Distribution List (members and external emails), and PDF template.
- Show where to set the project's **working days** (e.g. Sun–Thu) and holidays, used for gaps.

## States to design
- Desktop calendar for August with issued days, one **missing** day, one returned day and weekends.
- Phone: Daily report form with sections, the manpower table, the photo capture, and the "Copy from yesterday" action.
- Weekly Progress with the missing-day banner and both choices.
- Safety checklist on phone, with a Fail → photo + Raise Snag.
- Report detail on desktop, seen by the Consultant, with the Acknowledge ✍ button.
- The issued PDF preview.
- The Report Type settings page.
- Empty state: "No reports yet: start today's Daily Site Report".
- **Arabic RTL version** of the calendar and of the phone daily form. Numbers and dates stay readable, and Hijri is optional next to the Gregorian date.

## Visual direction
- Clean, modern SaaS in the style of the existing Rabaed screens: white cards, light grey background, orange primary accent (~#E8552B), stage pills with counts.
- Phone screens designed for site use: large touch targets (≥ 44px), high contrast for sunlight, one-handed reach for primary actions, works with gloves (no tiny icons).
- Status colours consistent across the product: Issued green, Submitted blue, Draft grey, Returned orange, **Missing** red dashed outline.
- Desktop first for the review screens at 1440px; phone at 390px for filling.

## Sample data
- Project "Dubai Marina Tower – Phase 2". Contractor TMC Constructions, Consultant Design Consultants LLC, Owner Representative Al Futtaim PMC.
- Working days: Sunday–Thursday.
- Daily Site Report `TWR-TMC-DSR-0217`, Wed 7 Aug 2025:
  - weather: Sunny, 44°C, dust later, 1.5 h lost;
  - manpower: 12 Masons, 18 Electricians (incl. 6 from subcontractor Al Noor Electric), 25 Helpers, 4 Steel fixers (total 59);
  - equipment: 1 Tower crane (9 h), 1 Concrete pump (4 h);
  - materials: 40 m³ concrete (Readymix Co.);
  - work done: Floor 07 slab pour, Floor 05 first-fix electrical;
  - issue: "Concrete truck delayed 2 h".
- Missing: Tue 6 Aug.
- Weekly Safety: 42 Pass · 3 Fail ("Missing guardrail at Floor 07 slab edge", "Extension cable damaged – Floor 05", "Fire extinguisher expired – Level B1") → 3 Snags.
- Distribution List for Daily: consultant resident engineer, Owner Rep PM, and 1 external email (owner's site office).

Produce an interactive prototype: switch report types, the calendar and list views, open the phone form and fill sections, add table rows, the missing-day banner choices, the checklist Fail flow with Raise Snag, report detail actions, and the PDF preview.
