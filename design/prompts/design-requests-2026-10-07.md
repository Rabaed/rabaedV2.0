# Design requests: pages with no design yet (Epic RP-405)

Decided in the grilling session of 2026-10-07 ("Frontend to the design", Epic RP-405). Each screen below has its own prompt file and a "Design:" task in Jira assigned to the product owner. Paste the **shared brief** first, then one screen's prompt, check the result, and re-export the zip into `design/reference/claude-design/`. Mark the Jira task Done; its build ticket is then created.

| Prompt | Jira |
|---|---|
| [work-item-page.md](work-item-page.md) | RP-414 |
| [new-work-item.md](new-work-item.md) | RP-415 |
| [notifications.md](notifications.md) | RP-416 |
| [profile-notification-settings.md](profile-notification-settings.md) | RP-417 |
| [participants.md](participants.md) | RP-418 |
| [project-settings.md](project-settings.md) | RP-419 |
| [sign-in.md](sign-in.md) | RP-420 |
| [activity.md](activity.md) | RP-421 |
| [responsive.md](responsive.md) | RP-422 |

---

## Shared brief (paste before each screen)

- **Same app as the existing kit.** Use the shell, type scale, spacing, cards, chips, tables and buttons of `saas-shell.html`, `submittals-list.html` and `settings-numbering.html`. One theme: the cool light palette (canvas `#f6f7f9`). No dark mode, no theme switch.
- **Shell:** sidebar with Home, Projects, My Company (Members, Participants); the signed-in Member at the bottom (Profile & notification settings, Language, Sign out); the Company's name with no switcher. No Payment Requests, Roles, Request To Join, Subscription, search box or theme toggle. Inside a Project: project header and tabs Dashboard · Submittals · Activity · Settings.
- **Words:** follow `GLOSSARY.md` (Work Item, Subject, Document Number, Participant, Member, Step, Step Pool, Stage, Transition, Review Code, Internal Note, Visibility, Trade, Location, Scope). Never "task", "ticket", "title", "owner" for a person, "user" for a Member.
- **Time:** no due dates, deadlines, SLAs or "overdue" anywhere. Age is shown only as **Step Age** dots (1–4+ weeks at the current Step).
- **Languages:** every screen in **English and Arabic**. Arabic mirrors the whole layout (sidebar on the right, back arrows pointing right). **Latin digits** in both languages. **Document Numbers always read left-to-right** (e.g. `TWR-MAR-01-0003 Rev 1`), also inside Arabic text.
- **Sizes:** desktop 1366 and 1920; tablet **iPad Air 11" portrait, 820 × 1180**; phone **iPhone Pro, about 402 × 874**.
- **States:** for each screen also show empty, loading, an error, and read-only (a Member who may look but not change).
- **Mock data must obey visibility** (`docs/visibility.md`). Pick one viewer for each frame and show only what that viewer may see. The demo cast: TMC Constructions (Contractor: Hafiz, engineer; Ali, Project Manager), Beta Build (another Contractor: Yousef), Design Consultants LLC (Consultant: Ahmed, engineer; Mohammed, manager), Al Waha PMC (Owner Representative: Faisal); Project "Riyadh Gate Tower – Phase 2", code TWR.
  - Another Company appears **by name only**, never its people, except the person who signed the final Review Code.
  - A Contractor never sees another Contractor's items, counts or numbers.
  - Drafts and internal review are seen only by the raising Company.
  - Internal Notes, internal Step moves, Returns and Recommended Codes are seen only by the Company where they happened.
