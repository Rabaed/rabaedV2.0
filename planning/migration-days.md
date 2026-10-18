# Migration days

Each row reserves one day of migration timestamps (`yyyymmdd`, the first eight digits of a migration's name) for one issue or spec: `| yyyymmdd | RP-nnn (or spec RP-nnn) | lane | purpose |`. The planning session writes the rows with the spec, beside its ticket table's Migration days column (`planning/parallel-sessions.md` step 4.5), and lands them on `main` before the spec starts. A single ticket's migration gets its row from `pnpm migration:new <name> --issue RP-nnn` (RP-583), in the ticket's branch. Only table rows count.

`pnpm check:migrations` refuses a migration a branch adds on a day reserved for another issue, and names the reservation. A migration is its branch's issue's (a branch named `RP-nnn-…`) and the first issue key on its header comment's first line, so an integration branch's migrations pass on their issues' days, and a spec's review fixes pass on a day reserved for the spec when their header starts with it (`-- Review fixes for spec RP-525 …`). Keys named after that one, or further down, are mentions: `-- Card layout (RP-410), rebuilt from RP-437's …` does not pass on RP-437's day. A migration on a day nobody reserved passes with a warning. The check reads this file from `origin/main` and from the branch; `origin/main`'s row for a day wins, and the branch's rows count only for days `origin/main` doesn't reserve.

Why (RP-560): `20270117` was reserved for RP-525's review fixes only in a comment on RP-525; another lane used `20270117000000`–`000600` on `main`, and PR #180 had to rename its migration.

| Day | Issue or spec | Lane | Purpose |
| --- | --- | --- | --- |
| 20270401 | RP-593 | B | The Owner's review |
| 20270402 | RP-592 | B | Approved Supplier List |
| 20270403 | RP-590 | B | Submittal Type names |
| 20270404 | RP-591 | B | SAR and DAR Forms |
| 20270405 | RP-594 | B | A SAR at A or B adds its supplier |
| 20270406 | RP-595 | B | MAR supplier field |
| 20270407 | RP-596 | B | Eight default Workflows |
| 20270408 | RP-597 | B | Demo |
| 20270409 | spec RP-598 | B | Review fixes; RP-593's and RP-594's migrations, moved here to sort after RP-591's on `main` |
| 20270429 | RP-90 | 3A | Snag Type, Snag List Stages and permissions, Snag Workflow Version 1 |
| 20270430 | RP-622 | 3A | The raiser as a Step holder; Snag Workflow Version 2 |
| 20270501 | RP-623 | 3B | Photos and attachments in another Participant's section; After photos |
| 20270502 | RP-624 | 3C | Raised-from counts by Type |
| 20270503 | RP-94 | 3D | Snag List desktop views |
| 20270504 | RP-625 | 3A | Informed Participants; Snag Workflow Version 3 |
| 20270505 | RP-626 | 3B | Question Types (QSN, QSC) |
| 20270506 | RP-627 | 3A | Site Observation Type and the "General" Trade |
| 20270507 | RP-628 | 3C | Snag item detail |
| 20270508 | RP-629 | 3D | Snag List bulk actions and exports |
| 20270509 | RP-630 | 3D | Snag List on a phone |
| 20270510 | RP-658 | 3A | Pick one of several covering Participants at a Submit |
| 20270511 | spec RP-619 | 3A | Review fixes |
| 20270620 | RP-636 | 1A | Build an Open Package (moved from 20270410: main's migrations had passed that block) |
| 20270621 | RP-638 | 1A | Submit Package |
| 20270622 | RP-641 | 1A | Packages board and each viewer's counts |
| 20270623 | RP-642 | 1A | When a Package is Done |
| 20270624 | RP-643 | 1A | Grouped notification for a Package Submit |
| 20270625 | RP-646 | 1A | Bulk Transitions from the Package page |
| 20270626 | RP-647 | 1A | Package filter and Comments on the Package page |
| 20270627 | spec RP-616 | 1A | Review fixes |
| 20270512 | RP-618 | 24 | File fingerprints in the content hash |
| 20270513 | RP-85 | 21 | The Signature; no Signature, no Transition |
| 20270514 | RP-620 | 22 | Tracer: sealed Documental Record |
| 20270515 | RP-617 | 21 | Company logo and Stamp; no Stamp, no Transition |
| 20270516 | RP-151 | 22 | Record page 1 and Form body; record language, Hijri dates |
| 20270517 | RP-155 | 23 | Record checks, record ready, Re-produce |
| 20270518 | RP-650 | 22 | Signature cards, Stamps, Review Comments, Disclaimer |
| 20270519 | RP-621 | 24 | Working Copy |
| 20270520 | RP-157 | 23 | Verification page |
| 20270521 | RP-147 | 22 | The record's appendix |
| 20270522 | spec RP-632 | 22 | Review fixes |
| 20270523 | spec RP-632 | 21 | Merge-with-`main` reconciliation of `app.take_transition` (rule 11.1) |
| 20270418 | RP-170 | 4A | WIR Workflow Version 2 (Engineer → Manager, Recommended Result) |
| 20270524 | RP-637 | 5A | Register Import tracer: import tables, row-level security, confirm function |
| 20270525 | RP-639 | 5B | Register Import: value matching, optional fields and Paper ref |
| 20270526 | RP-640 | 5C | Register Import: Assign to |
| 20270527 | RP-645 | 5C | Register Import by a Rabaed Engineer in Rabaed Admin |
| 20270528 | RP-644 | 5D | Register Import: Packages from an import, downloads and saved mappings |
| 20270529 | spec RP-631 | 5A | Review fixes |
| 20270530 | spec RP-631 | 5A | Merge-with-`main` reconciliation of the import's confirm function (rule 11.1) |
| 20270531 | RP-656 | 4D | Annotated photo beside the original (moved from 20270425: RP-90's 20270429 is on `main`) |
| 20270601 | RP-82 | 4B | Link questions that accept chosen outcomes; WIR Form Version 2 (moved from 20270419) |
| 20270602 | RP-652 | 4C | Show Inspections in the Submittals tab (moved from 20270424) |
| 20270603 | RP-651 | 4B | Project Checklist Templates and the Checklist Template choice |
| 20270604 | RP-86 | 4A | The Consultant Engineer's checklist on site; the proposed Result |
| 20270605 | RP-577 | 4A | Snags from failed check items |
| 20270606 | RP-653 | 4A | "Snags from Rev 0" on a WIR Revision |
| 20270607 | spec RP-649 | 4A | Review fixes |
| 20270608 | spec RP-649 | 4A | Reconciliation after `main` redefines an `app.*` function a ticket also redefines (rule 11.1) |
| 20270610 | RP-624 | 33 | raised_item_counts_by_type |
| 20270611 | RP-622 | 3A | The raiser as a Step holder (moved after RP-624's 20270610 on main) |
| 20270613 | RP-618 | 2D | Fingerprint each Document's bytes; the content hash covers it (moved from 20270512, then 20270610) |
| 20270628 | RP-637 | 5A | Register Import tracer: import tables, row-level security, confirm function (20270524, 20270609 and 20270613 overtaken on main) |
