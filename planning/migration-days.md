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
| 20270410 | RP-636 | 1A | Build an Open Package |
| 20270411 | RP-638 | 1A | Submit Package |
| 20270412 | RP-641 | 1A | Packages board and each viewer's counts |
| 20270413 | RP-642 | 1B | When a Package is Done |
| 20270414 | RP-643 | 1C | Grouped notification for a Package Submit |
| 20270415 | RP-646 | 1A | Bulk Transitions from the Package page |
| 20270416 | RP-647 | 1B | Package filter and Comments on the Package page |
| 20270417 | spec RP-616 | 1A | Review fixes |
