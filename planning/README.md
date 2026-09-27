# Rabaed delivery plan (Project Module)

UX comes first. No screen is built until its flow has been prototyped and tested with real users.

| Phase | What | Runs in parallel with |
|---|---|---|
| 0: UX & design | Research, IA, design system (RTL-first), clickable prototypes, 2 usability rounds | Phase 1 back-end work |
| 1: Foundations | Repo, AWS, identity, **tenancy & visibility (RLS + test suite)**, audit trail, i18n | Phase 0 |
| 2: Engines | Projects & settings, Form engine + builder, Workflow engine + builder, numbering, signing & PDFs, Rabaed Defaults | UI built only for flows that passed Phase 0 testing |
| 3: Modules | Views, Submittals & Packages, Inspections, Snag List, Site Reports, Drawings, Files, Floor/Plan, Dashboard, Chat | |
| 4: Rabaed Admin | Onboarding, support actions, templates, monitoring | Phase 3 |
| 5: Launch | Pen test, SOC 2 readiness, pilot project | |

Why Phase 0 and Phase 1 run together: Phase 1 is almost all invisible work (database security, audit chain, pipelines) that no design decision changes. UI build starts only when a flow's design is signed off.

## Jira

- The backlog is defined in `backlog.py`. Run `python planning/backlog.py` to regenerate `rabaed-jira-import.csv` (30 epics, 140 stories).
- **To import:** Jira → Settings → System → External system import → CSV. Map these columns:
  - `Issue Id` → Issue Id, `Parent Id` → Parent Id (this links stories to epics);
  - `Epic Name` → Epic Name (company-managed projects only);
  - both `Labels` columns → Labels;
  - `Priority` → Priority.
- Labels `phase-0-ux` … `phase-5-launch` give one board filter or swimlane per phase.
