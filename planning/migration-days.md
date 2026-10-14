# Migration days

Each row reserves one day of migration timestamps (`yyyymmdd`, the first eight digits of a migration's name) for one issue or spec: `| yyyymmdd | RP-nnn (or spec RP-nnn) | lane | purpose |`. The planning session writes the rows with the spec, beside its ticket table's Migration days column (`planning/parallel-sessions.md` step 4.5), and lands them on `main` before the spec starts. A single ticket's migration gets its row from `pnpm migration:new <name> --issue RP-nnn` (RP-583), in the ticket's branch. Only table rows count.

`pnpm check:migrations` refuses a migration a branch adds on a day reserved for another issue, and names the reservation. A migration is its branch's issue's (a branch named `RP-nnn-…`) and the first issue key on its header comment's first line, so an integration branch's migrations pass on their issues' days, and a spec's review fixes pass on a day reserved for the spec when their header starts with it (`-- Review fixes for spec RP-525 …`). Keys named after that one, or further down, are mentions: `-- Card layout (RP-410), rebuilt from RP-437's …` does not pass on RP-437's day. A migration on a day nobody reserved passes with a warning. The check reads this file from `origin/main` and from the branch; `origin/main`'s row for a day wins, and the branch's rows count only for days `origin/main` doesn't reserve.

Why (RP-560): `20270117` was reserved for RP-525's review fixes only in a comment on RP-525; another lane used `20270117000000`–`000600` on `main`, and PR #180 had to rename its migration.

| Day | Issue or spec | Lane | Purpose |
| --- | --- | --- | --- |
