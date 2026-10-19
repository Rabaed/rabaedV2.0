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
| 20270504 | RP-625 | 3A | Unused: the migration moved to 20270706, after main's later days |
| 20270505 | RP-626 | 3B | Question Types (QSN, QSC) |
| 20270506 | RP-627 | 3A | Site Observation Type and the "General" Trade |
| 20270507 | RP-628 | 3C | Snag item detail |
| 20270508 | RP-629 | 3D | Snag List bulk actions and exports |
| 20270509 | RP-630 | 3D | Snag List on a phone |
| 20270510 | RP-658 | 3A | Pick one of several covering Participants at a Submit |
| 20270511 | spec RP-619 | 3A | Review fixes |
| 20270812 | RP-636 | 1A | Build an Open Package (final block, reserved at queue time: RP-675) |
| 20270813 | RP-638 | 1A | Submit Package |
| 20270814 | RP-641 | 1A | Packages board and each viewer's counts |
| 20270815 | RP-642 | 1A | When a Package is Done |
| 20270816 | RP-643 | 1A | Grouped notification for a Package Submit |
| 20270817 | RP-646 | 1A | Bulk Transitions from the Package page |
| 20270818 | RP-647 | 1A | Package filter and Comments on the Package page |
| 20270819 | spec RP-616 | 1A | Review fixes |
| 20270820 | spec RP-616 | 1A | Reconciliation after `main`: `notification_kind_check` lists `package_submitted` and RP-155's `record_ready` (rule 11.1); stays last |
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
| 20270603 | RP-651 | 4B | Unused: the migration moved to 20270630 (via 20270612), after main's later days |
| 20270604 | RP-86 | 4A | The Consultant Engineer's checklist on site; the proposed Result |
| 20270605 | RP-577 | 4A | Unused: the migration moved to 20270922, after main's later days |
| 20270606 | RP-653 | 4A | "Snags from Rev 0" on a WIR Revision |
| 20270607 | spec RP-649 | 4A | Review fixes |
| 20270608 | spec RP-649 | 4A | Reconciliation after `main` redefines an `app.*` function a ticket also redefines (rule 11.1) |
| 20270610 | RP-624 | 33 | raised_item_counts_by_type |
| 20270612 | RP-651 | 42 | Unused: the migration moved to 20270630, after 20270613 and 20270628 on main |
| 20270611 | RP-622 | 3A | The raiser as a Step holder (moved after RP-624's 20270610 on main) |
| 20270613 | RP-618 | 2D | Fingerprint each Document's bytes; the content hash covers it (moved from 20270512, then 20270610) |
| 20270628 | RP-637 | 5A | Register Import tracer: import tables, row-level security, confirm function (20270524, 20270609 and 20270613 overtaken on main) |
| 20270707 | RP-639 | 5B | Unused: the migration moved to 20270723, after main's 20270708–20270720 |
| 20270705 | RP-668 | 33 | comment_not_raised_directly |
| 20270630 | RP-651 | 42 | Project Checklist Templates and the Checklist Template choice (moved from 20270612) |
| 20270705 | RP-668 | 33 | comment_not_raised_directly |
| 20270630 | RP-651 | 42 | Project Checklist Templates and the Checklist Template choice (moved from 20270612) |
| 20270713 | RP-640 | 5B | Unused: the migration moved to 20270721, after main's 20270714 and 20270716 |
| 20270714 | RP-673 | 41 | Unused: the migration moved to 20270726 (main took 20270714, 20270716 and 20270720 first) |
| 20270706 | RP-625 | 3A | Unused: the migration moved to 20270714, after main's 20270708 and 20270709 |
| 20270708 | RP-85 | 21 | stored_file |
| 20270709 | RP-620 | 22 | documental_record |
| 20270715 | RP-623 | 3B | Unused: the migration moved to 20270721, after main's 20270716 |
| 20270716 | RP-626 | 33 | The Question Types (QSN, QSC) and the Consultant's `submit` (moved from 20270706, then 20270705) |
| 20270714 | RP-625 | 3A | Informed Participants: `informed` access and a shared move inside one Participant reaching the others (moved from 20270504, then 20270706: main's later days) |
| 20270716 | RP-673 | 41 | Unused: the migration moved to 20270726 (main took 20270716 and 20270720 first) |
| 20270716 | RP-651 | 42 | checklist_templates_review_fixes |
| 20270722 | RP-640 | 5B | Unused: the migration moved to 20270725 |
| 20270723 | RP-639 | 5B | Unused: the migration moved to 20270801 (main gained 20270726) |
| 20270724 | RP-640 | 5B | Unused: the migration moved to 20270802 (main gained 20270726) |
| 20270725 | RP-640 | 5B | Unused: RP-640's notification dropped (owner, 2026-10-19) |
| 20270721 | RP-623 | 3B | Unused: the migration moved to 20270731, after main's 20270726 |
| 20270720 | RP-673 | 41 | Unused: the migration moved to 20270726, after RP-151's 20270720 on main |
| 20270720 | RP-151 | 22 | record_page_one |
| 20270727 | RP-85 | 21 | member_signature |
| 20270728 | RP-85 | 21 | drop_is_signing |
| 20270729 | RP-617 | 21 | company_stamp |
| 20270730 | RP-632 | 21 | review_fixes |
| 20270726 | RP-673 | 41 | wir_review_codes: WIR Review Codes, the Inspections Stages moved to the Submittals set, app.move_stage_key, app.recommendable_outcomes (moved from 20270714, 20270716, 20270720) |
| 20270801 | RP-639 | 5B | Unused: the migration moved to 20270822 before queueing |
| 20270802 | RP-640 | 5B | Unused: the migration moved to 20270823 before queueing |
| 20270804 | RP-645 | 5B | Unused: the migration moved to 20270806, after 20270805 |
| 20270731 | RP-623 | 3B | Unused: the migration moved to 20270803, after main's 20270731 (RP-629) |
| 20270731 | RP-629 | 34 | snag_bulk_reassign |
| 20270803 | RP-623 | 32 | reply_screen_files |
| 20270806 | RP-645 | 5B | Unused: the migration moved to 20270809 |
| 20270805 | RP-155 | 23 | record_checks |
| 20270808 | RP-645 | 5B | Unused: the migration moved to 20270824 before queueing |
| 20270809 | RP-645 | 5B | Unused: the migration moved to 20270825 before queueing |
| 20270821 | RP-644 | 5B | Unused: the migration moved to 20270826 before queueing |
| 20270822 | RP-639 | 5B | Unused: the migration moved to 20270829 (main gained 20270827) |
| 20270823 | RP-640 | 5B | Unused: the migration moved to 20270830 (main gained 20270827) |
| 20270824 | RP-645 | 5B | Unused: the migration moved to 20270831 (main gained 20270827) |
| 20270825 | RP-645 | 5B | Unused: the migration moved to 20270901 (main gained 20270827) |
| 20270826 | RP-644 | 5B | Unused: the migration moved to 20270902 (main gained 20270827) |
| 20270827 | RP-86 | 44 | reply_checklist |
| 20270830 | RP-640 | 5B | Unused: the migration moved to 20270905 (main gained 20270829, RP-958) |
| 20270831 | RP-645 | 5B | Unused: the migration moved to 20270906 (main gained 20270829, RP-958) |
| 20270901 | RP-645 | 5B | Unused: the migration moved to 20270907 (main gained 20270829, RP-958) |
| 20270902 | RP-644 | 5B | Unused: the migration moved to 20270908 (main gained 20270829, RP-958) |
| 20270829 | RP-958 | 22 | outbox_attempt_on_take |
| 20270904 | RP-639 | 5B | Unused: the migration moved to 20270916 (main gained 20270914) |
| 20270905 | RP-640 | 5B | Unused: the migration moved to 20270917 (main gained 20270914) |
| 20270906 | RP-645 | 5B | Unused: the migration moved to 20270918 (main gained 20270914) |
| 20270907 | RP-645 | 5B | Unused: the migration moved to 20270919 (main gained 20270914) |
| 20270908 | RP-644 | 5B | Unused: the migration moved to 20270920 (main gained 20270914) |
| 20270911 | RP-960 | 5B | Unused: the migration moved to 20270921 (main gained 20270914) |
| 20270910 | RP-157 | 23 | documental_record_verification |
| 20270911 | RP-577 | 42 | Unused: the migration moved to 20270922, after 20270914 on main |
| 20270914 | RP-627 | 33 | site_observation_type_and_general_trade |
| 20270922 | RP-577 | 41 | snags_from_failed_check_items |
| 20270915 | RP-981 | 42 | annotate_reply_photos |
| 20270914 | RP-627 | 33 | site_observation_type_and_general_trade |
| 20270916 | RP-639 | 5B | Register Import: value matching, optional fields and Paper ref (work_item.paper_ref; moved from 20270707, 20270720, 20270723) (final day, moved from 20270904 before queueing) |
| 20270917 | RP-640 | 5B | Register Import: Assign to (rows raised by their assignee; moved from 20270713, 20270721, 20270724) (final day, moved from 20270905 before queueing) |
| 20270918 | RP-645 | 5B | Register Import by a Rabaed Engineer in Rabaed Admin (moved from 20270803, then 20270805: RP-623 and RP-155 took them on main) (final day, moved from 20270906 before queueing) |
| 20270919 | RP-645 | 5B | Rabaed Admin may call app.current_project_ids() (final day, moved from 20270907 before queueing) |
| 20270920 | RP-644 | 5B | Register Import: Packages from an import, downloads and saved mappings (final day, moved from 20270908 before queueing) |
| 20270921 | RP-960 | 5B | Register Import: a Type counts as raisable only on a Rabaed or the Project's own Workflow (Rabaed Admin's import runs as the app role: bootstrap) (final day, moved from 20270911 before queueing) |
| 20270925 | RP-658 | 3A | Unused: the migration moved to 20270928 (main's RP-650 took 20270925) |
| 20270925 | RP-650 | 22 | record_signatures |
| 20270926 | RP-147 | 22 | record_appendix |
| 20270930 | RP-653 | 43 | previous_item_raised_counts (moved from 20270929 after main's RP-658 took it) |
| 20270928 | RP-658 | 3A | Unused: the migration moved to 20270929 (main's RP-621 took 20270928) |
| 20270928 | RP-621 | 24 | working_copy |
| 20270929 | RP-658 | 3A | Snag List: pick one of several covering Participants at a Submit (`app.next_step_holder`, `app.take_transition`, `app.work_item_actions`) |
