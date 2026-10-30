# Rabaed v2.0

B2B construction management platform for KSA. Start with `CLAUDE.md`, `GLOSSARY.md` and `docs/visibility.md`.

## Run it locally

You need Node 24, Docker, and pnpm (`corepack enable`).

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm install` also turns on the git hooks in `.githooks` for the clone and every worktree (`core.hooksPath`, RP-989; not in CI). `pre-commit` refuses a staged conflict marker (`git diff --cached --check`; a Markdown line of exactly `=======` counts as one), a font file or embedded font data. Rebase and cherry-pick commit without it, so resolve conflicts with a merge. `pre-push` runs `pnpm lint` and `pnpm typecheck` side by side, about a minute, and refuses a push to a branch when either exits non-zero; a push that changes only docs, a tag or a branch deletion runs neither. They check the working tree, so push the branch you have checked out with nothing uncommitted.

`pnpm dev` starts Postgres 16, Mailpit (the mail catcher) and the file store in Docker, creates the database roles, applies migrations, then runs:

| App | URL |
|---|---|
| web | http://localhost:3000 (`/en`, `/ar`; health page at `/en/health`) |
| api | http://127.0.0.1:4000 (`GET /health`) |
| worker | background process, logs only |
| Mailpit | http://127.0.0.1:8025: every email the apps send locally lands here, never in a real mailbox |
| File store | http://127.0.0.1:9000: RustFS, S3-compatible. Documents' files go here locally and in CI, never to AWS; the api creates its bucket on start |

## Demo: the MAR journey

One command resets the local database, seeds the demo Project and starts the stack:

```bash
pnpm demo
```

It starts Postgres, drops and rebuilds the local database (`pnpm db:reset`, which refuses any database that isn't on this machine), seeds the demo (`pnpm demo:seed`) and runs web, api, worker and Rabaed Admin. The seed is built through the API itself, and the Rabaed Engineer onboards each Company through Rabaed Admin's onboarding service, so `admin_action` records each onboarding with its reason (V9). The names, emails (on the reserved `.test` domain), CR and VAT numbers are made up.

`pnpm db:reset` under a running `pnpm dev` or `pnpm demo` no longer needs a restart: the api and worker log that an idle connection failed (class and code `57P01`, no message) and open a fresh one on the next query (`packages/db/src/client.ts`, RP-402).

Everyone signs in with one password, generated the first time `pnpm demo` (or `pnpm demo:seed`) runs **in that folder** and kept in that folder's own `.env.demo` (git-ignored; it stays the same across resets, but each worktree has its own, and a worktree that never ran `pnpm demo` has none). The seed prints the list below.

**Scripting the demo.** Agents and scripts never need to read `.env.demo`: with the demo running,

```bash
pnpm demo:session hafiz            # or a full email; --out <file> picks the path
```

signs in as that person (`hafiz`, `ali`, `saeed`, `omar`, `yousef`, `ahmed`, `sara`, `mohammed`, `faisal`, `noura`, `nasser`) and prints only the path of a Playwright storage-state file (default `.demo-sessions/<name>.json`, git-ignored), for example `browser.newContext({ storageState })`. It signs in at `WEB_URL` from `.env` (`http://127.0.0.1:3000` without one), and the cookies are for that host only. In a lane, that is `http://laneN.localhost:<port>`, so open the pages there, not on `127.0.0.1`. Node on Windows cannot resolve `*.localhost`, so the script connects to `127.0.0.1` itself and still sends the lane host. The password is read inside the script and never printed. Behind it, sign-in is `POST /api/v1/session` on the web origin with `{email, password}` (204 and the `rabaed_session` cookie). A Transition is `POST /api/v1/work-items/<id>/transitions` with `{transition, idempotencyKey, confirmed: true}` (`idempotencyKey` a UUID; without `confirmed: true` it is refused with `not_confirmed`). Column names for direct SQL are in `docs/data-model.md`.

**PR screenshots.** `pnpm screens /work-items/<id> --as hafiz` shoots each route full-page at 1366 and 1920 in English and Arabic, signed in the same way, into `.screens/<issue key>/` (git-ignored). `--setup <file>` runs API calls from inside the signed-in page first (its `{name}` results fill the routes; `api.as("<person>")` acts as someone else, `api.upload` fills a file field). The same file may `export const screens`, each a route with ordered actions run before its shot (click a role and name, check a row's checkbox, wait for a role; names given in English and Arabic), so dialogs and selections get shot too: see `scripts/screens-examples/`. For a flow those actions cannot reach (a wizard, an upload), `--steps <file>` drives the page itself and names each shot (`await shot("map-columns")`), once per language and width. `--publish` commits the shots to `screens-<branch>` on origin, never merged, and prints a markdown table of their raw URLs for the PR body; `--publish-dir <dir>` does the same for PNGs already on disk (`<page>-<width>-<locale>.png`), shooting nothing. `scripts/screens.ts` has the details.

**Project:** Riyadh Gate Tower – Phase 2 (`TWR`). Trades Electrical Works (`EL`), Mechanical Works (`ME`) and Civil Works (`CV`, covered by no Participant: it only carries a supplier); Locations Main Zone › Tower 1 (Floors 01–03) and Tower 2 (Floor 01).

| Company | Role on the Project | Covers | Person | Email |
|---|---|---|---|---|
| TMC Constructions | Contractor, Project Admin | Electrical, everywhere | Saeed Al Qahtani (Authorized Person) | `saeed.alqahtani@tmc.demo.rabaed.test` |
| | | | Hafiz Hamdan (Engineer) | `hafiz.hamdan@tmc.demo.rabaed.test` |
| | | | Ali Sonour (Project Manager) | `ali.sonour@tmc.demo.rabaed.test` |
| | | Tower 2 only | Omar Al Harbi (Engineer) | `omar.alharbi@tmc.demo.rabaed.test` |
| Beta Build | Contractor | Electrical, everywhere (like TMC: only the Company boundary hides TMC's work) | Yousef Karim (Engineer) | `yousef.karim@betabuild.demo.rabaed.test` |
| Design Consultants LLC | Consultant | Electrical and Mechanical | Ahmed bin Said, Sara (Engineers) | `ahmed.binsaid@…`, `sara@designconsultants.demo.rabaed.test` |
| | | | Mohammed Al Shamsi (Manager) | `mohammed.alshamsi@designconsultants.demo.rabaed.test` |
| Al Waha PMC | Owner Representative | Electrical, everywhere | Faisal Al Otaibi (Engineer, Arabic) | `faisal.alotaibi@alwaha.demo.rabaed.test` |
| | | | Noura Al Harbi (Project Manager, Arabic): holds the Owner's review | `noura.alharbi@alwaha.demo.rabaed.test` |

Each Company's Authorized Person (`<first>.<last>@<company>.demo.rabaed.test`) can sign in too, and the Rabaed Engineer is `engineer@rabaed.demo.rabaed.test`. The seed also leaves one Draft of Hafiz's, "Emergency lighting – Tower 2", which only TMC sees, filled through the MAR Form: two Items (36 + 12 pcs, a total of 48), its Datasheet (a PDF) and a Sample photo taken in Riyadh, whose time and place show under it.

**Two linked MARs** (Links, the MAR Form Version 3): "Exit signage – Tower 1" (`TWR-MAR-01-0001`), approved with Code A, and "Emergency lighting control panel – Tower 2" (`TWR-MAR-01-0002`), Submitted and waiting with Design Consultants LLC, which links the exit signs twice: under **Related submittals** in its Form and as a free Link in its Links section. Omar covers only Tower 2, so to him the exit signs are just their Document Number and Subject. A third, "Cable tray risers – Tower 1" (`TWR-MAR-01-0003`), ends Revise & Resubmit with Code C: Ahmed (Consultant Engineer) answered in his reply, **Send to Manager** (sample checked, not matching the specification, with a note in English and Arabic, and a Recommended Code C), which only Design Consultants reads, and Mohammed issued the Code with **Remarks** and the **final verification**, filled in from Ahmed's reply; both Companies now read the Code, its Remarks and its final verification, never Ahmed's reply (the Code A item has its final verification too, matching). Each seeded Submit carries a **Cover Note**, which the Consultant reads. Hafiz then created its **Rev 1** (the trays changed to hot dip galvanised, the Datasheet copied) and Ali Submitted it: `TWR-MAR-01-0003 Rev 1`, waiting with Design Consultants LLC. A Revision takes the original's number and uses no counter. The walkthrough's MARs come on top of these (its first one is `TWR-MAR-01-0004`), and the seed's MARs have already put a few notifications in Ali's and Mohammed's bells.

**The MAR Form (Version 6)**, the same in English and Arabic: Manufacturer, **Approved supplier** (required: chosen from the Project's Approved Supplier List for the MAR's Trade), Model, Specification section and Description; **Items**, a table of Fixture type, Description, Quantity and Unit, with the total quantity under it; **Datasheet (PDF)**, **Test certificate** and **Sample photo**; **Related submittals** (optional: pick earlier Submitted items by Document Number or Subject); then Trade, Location and Scopes. The Form is the Contractor's (ADR 0019): the Consultant answers in its replies, never in the Form. The Consultant Engineer's reply, **Send to Manager**, asks Sample checked, Matches specification and Verification note (required when it does not match), read only by the Consultant; the Manager's Code asks them again as the **final verification**, filled in from the Engineer's answers and shared with the Code. **The MAR Workflow (Version 3)**: Draft → Send for Review → Internal Review (Contractor PM); a Return goes to Internal Review (Contractor Engineer), never back to the Draft; Submit (with an optional **Cover Note**) → Pending Approval (Consultant Engineer, then Consultant Manager) → Approve · A, Approve with Comments · B, Revise & Resubmit · C or Reject · D. The Rabaed Defaults are documents in `apps/admin` (`workflows`, `forms`, `screens`) that the seed publishes with `pnpm defaults:publish`; Supplier Approval Requests (SAR) and Document Approval Requests (DAR) have Forms and Workflows of their own (MAR and SAR run 2→2, DAR runs 1→1 → Owner review), and the Inspections Module has the Work Inspection Request (WIR). The Consultant Engineer Step's pool is the Consultant's Engineers only, never its Manager: with one Engineer it is his at once; Design Consultants has two, Ahmed and Sara, so one of them picks it up. Remarks are optional with Code A only, required with B, C and D. Manufacturer, Description, the Datasheet, Trade and Location are required to Send for Review. The Datasheet, Test certificate and Sample photo can be added once the Draft is saved; the Attachments and Links System Fields sit below the Form. A MAR started on Version 1 (a single Quantity, no Datasheet) Version 2 (no Related submittals), Version 3 (no Consultant verification) or Version 4 (the Consultant verification in the Form) keeps its Version, and one on MAR Workflow Version 2 keeps its route (a Return goes back to the Draft). The seed uploads the Datasheets and the photo through the local file store, so Docker must be up; the dev demo, whose seed has no reach to the files bucket, has no seeded files, and so no linked MARs either (each needs its Datasheet to leave Draft), and its walkthrough MAR is `TWR-MAR-01-0001`.

**Submittals: the three Types and the Approved Supplier List** (spec RP-598; the seed's files need the file store, so the dev demo has none of the items below). Project Settings → Approved Supplier List holds three fictional suppliers: two preloaded by TMC's Project Admin, **Al-Rimal Building Materials** (Civil Works) and **Najd Electrical Supplies** (Electrical Works), and **Tabuk Cable Industries** (Electrical), which joined the list by itself when its **SAR** (Supplier Approval Request, "Tabuk Cable Industries") was closed at Code A on the 2→2 Workflow: Hafiz raised it, Ali submitted it, Ahmed and Mohammed replied and approved. Every Participant reads the list, never the SAR behind a supplier. The MARs choose their **Approved supplier** from the list for their Trade: the Emergency lighting and Exit signage MARs choose Najd, and "Cable tray risers – Tower 1" chose Tabuk, the supplier the SAR added. A **DAR** (Document Approval Request, "Cable sizing calculation – Tower 1") ran 1→1 → Owner review: Hafiz raised it, Ali submitted it, Mohammed recommended Code A and Noura (Al Waha, the Owner Representative's Project Manager) Confirmed it, so it closed at A; sign in as `noura` to see the Owner's review step in its history, or raise another DAR and Confirm it yourself. New items start with a Type picker: MAR, SAR or DAR.

**A second Project:** Jeddah Corniche Villas (`JCV`), Beta Build's own, with one Trade (Plumbing Works) and one Draft MAR ("Pump room ventilation"). Its only Member is Beta Build's Authorized Person, Nasser Al Dosari (`nasser.aldosari@betabuild.demo.rabaed.test`), who is on no other Project. Nobody on Riyadh Gate Tower can see it, and Nasser cannot see Riyadh Gate Tower: each gets 404. Dev's deploy checks exactly that after every deploy (see "Demo in dev").

### Walkthrough

Open http://localhost:3000/en (or `http://laneN.localhost:<port>/en` in a lane). Use a private window per person, or sign out between steps. Every step works the same in Arabic: switch with the language button, or use `/ar/…`. The buttons there are:

| English | العربية |
|---|---|
| Submittals · New Submittal · Material Approval Request · Save Draft | الاعتمادات · اعتماد جديد · طلب اعتماد مواد · حفظ المسودة |
| Save and close (a saved Draft) · Save (after Draft) | حفظ وإغلاق · حفظ |
| Items · Add row | البنود · إضافة صف |
| Datasheet (PDF) · Sample photo · Take a photo | نشرة البيانات (PDF) · صورة العينة · التقط صورة |
| Attachments · Attach a Document | المرفقات · إرفاق مستند |
| Related submittals · Links · Find an item to link · Linked from | الاعتمادات ذات الصلة · الروابط · ابحث عن بند لربطه · مرتبط من |
| Send for Review | إرسال للمراجعة |
| Pick up · Return to pool | استلام · إعادة إلى المجموعة |
| Return (Reason) · Return to Engineer | إعادة (السبب) · إعادة للمهندس |
| Submit · Cover Note · Internal Note | تقديم · ملاحظة الإحالة · ملاحظة داخلية |
| Send to Manager · Sample checked · Matches specification · Verification note · Recommended Code | إرسال للمدير · تم فحص العينة · مطابق للمواصفات · ملاحظة التحقق · الرمز الموصى به |
| Approve · A · Approve with Comments · B · Revise & Resubmit · C · Reject · D · Final verification | اعتماد · A · اعتماد مع ملاحظات · B · مراجعة وإعادة تقديم · C · رفض · D · التحقق النهائي |
| Revision (the drop-down) · Create Revision · Discard Revision | المراجعة · إنشاء مراجعة · حذف مسودة المراجعة |
| Notifications · Mark all as read | الإشعارات · تعليم الكل كمقروء |
| With | لدى |

| # | Who | Do | What each Company sees |
|---|---|---|---|
| 1 | Hafiz | Riyadh Gate Tower – Phase 2 → Submittals → New Submittal → Material Approval Request: "Lighting Fixtures", Electrical Works, Tower 1 Floor 02, Manufacturer "Philips", Approved supplier "Najd Electrical Supplies", leaving Description empty → Save Draft | TMC sees the Draft (no number yet). Beta Build, Design Consultants and Al Waha see nothing, not even in the counts. |
| 2 | Hafiz | Send for Review | Refused: the Form lists what is missing ("2 fields need your attention: Description, Datasheet (PDF)") and marks each. Nothing moves; still nothing outside TMC. |
| 3 | Hafiz | Fill in Description, Model "CoreLine Panel", Specification section "26 51 00"; under Items, Add row twice: "Recessed panel", 200, Pieces and "Surface panel", 40, Pieces (the total shows 240) → Save and close (it saves and goes to the Submittals list) → open the Draft again; add a PDF to Datasheet (PDF), and if you like a photo to Sample photo (on a phone, Take a photo) → Send for Review | It gets its Document Number (`TWR-MAR-01-0004`) and waits in Ali's pool. Ali's bell shows it (the worker delivers within seconds). Still nothing outside TMC. Its Documents freeze at the Submit, not now. |
| 4 | Ali | Open it from the bell: Ali is TMC's only Project Manager, so it is his at once ("With Ali Sonour · TMC Constructions", no Pick up) → Return, with the reason "Add emergency duration" | It stays in Internal Review, now at the Contractor Engineer Step, with its Document Number, and goes back to Hafiz, who wrote it ("With Hafiz Hamdan · TMC Constructions"); never back to the Drafts. The reason is in TMC's history, marked internal. |
| 5 | Hafiz | Under Datasheet (PDF), remove the PDF and add the corrected one → Send for Review | Documents can change until the Submit. Ali has it again. |
| 6 | Ali | Submit, writing the **Cover Note** "Panels for Level 2, as drawing E-201" and an Internal Note "Quantities checked against the BOQ" | Pending Approval. TMC sees "With Design Consultants LLC", never a Consultant's name. Ahmed and Sara, its Engineers, see it waiting to be picked up ("not picked up yet: …"); Mohammed, the Manager, isn't in that pool and sees it read-only until Ahmed sends it to him. Faisal (Al Waha) sees it as oversight, read-only. Yousef (Beta Build) still sees nothing. The Consultant's and Al Waha's history shows the Submit with its Cover Note, by TMC Constructions (no person named), never the Internal Note or the Return. |
| 7 | Ahmed | Pick up → read the Form (Manufacturer, Model, Specification section, Description, the Items and their total, Trade, Location) and open the PDF under Datasheet (PDF) | The Consultant reads every answer and the corrected Datasheet, none of them editable, each Document frozen; a Sample photo shows its time and place. Yousef (Beta Build) still gets nothing. |
| 8 | Ahmed, Mohammed | Ahmed: **Send to Manager**, answering in its pop-up Sample checked Yes, Matches specification Yes, Recommended Code A and an Internal Note (a Send to Manager is refused until the verification is answered). Mohammed (the Consultant's only Manager, so it is his at once): Approve · A: its **Final verification** is already filled in from Ahmed's answers → confirm | Ahmed's answers, his Recommended Code and his Internal Note are in Design Consultants' history only, marked internal; TMC and Al Waha see no change. Then Approved, Code A: TMC and Al Waha see the Code, its final verification and that Mohammed Al Shamsi issued it; nobody else of the Consultant is named to them, and Ahmed's reply never reaches them. The item accepts no more moves. |
| 9 | Hafiz, Ali, Ahmed, Mohammed | Repeat with "Cable tray layout – Level 2" (its Form complete and a PDF under Datasheet (PDF) before Send for Review); Ahmed answers Matches specification No with the note "Wrong datasheet revision" and recommends C; Mohammed ends with Revise & Resubmit · C, writing Remarks (required for Code C) | Revise & Resubmit, Code C. |
| 10 | Hafiz | Open "Emergency lighting control panel – Tower 2" → Links: the exit signs (`TWR-MAR-01-0001`) under Related submittals and again as a free Link → open it; scroll to Linked from | Each Link shows the Document Number (left to right, in Arabic too) and Subject, and opens the item; nothing can be changed, as it is Submitted. The exit signs' Linked from lists the control panel. Ahmed sees the same. Yousef (Beta Build) sees neither MAR. |
| 11 | Omar | Open "Emergency lighting control panel – Tower 2" → Links → open `TWR-MAR-01-0001` | Omar covers Tower 2 only: both Links show only the number and Subject "Exit signage – Tower 1". Opening one goes to that Link's own page ("Linked item", at `/work-items/<control panel>/links/<Link>`): the number, the Subject and only "You are not allowed to see the details of this item.", with "Back to the item it is linked from". The exit signs aren't in his list, and their own address is "not found" to him. |
| 12 | Hafiz, Ali | New Submittal → Material Approval Request "Lighting control wiring – Tower 1", Tower 1 Floor 02, Form complete as in step 3; in Related submittals, type "control panel" → pick `TWR-MAR-01-0002` → Save Draft; on the saved Draft, under Links, Find an item to link: "Lighting Fixtures" → pick it; add the Datasheet → Send for Review; Ali Submits | Link search offers only Submitted items Hafiz can see in this Project: no Drafts, nothing still in a Company's internal review, nothing of Beta Build. While it is in TMC's review, nobody sees it under the control panel's Linked from; once Submitted, Hafiz sees it there as a link, and Omar (who can't see Tower 1) sees only its number and Subject. |
| 13 | Hafiz, Ali, Ahmed, Mohammed | The Consultant's replies on a new MAR "Lighting control – Tower 2" (Form complete, a PDF under Datasheet (PDF)): Hafiz sends it and Ali Submits it. Ahmed picks it up (Design Consultants has two Engineers; with one, it would be his at once, and Mohammed is never in that pool) → Send to Manager: Sample checked Yes, Matches specification No (so the Verification note becomes required: "Lamp efficacy is below the specified 110 lm/W"), Recommended Code C. Mohammed → **Return to Engineer**, reason "Check the photometric report"; Ahmed has it again and Sends it to the Manager unchanged. Mohammed tries Revise & Resubmit · C: refused until the Remarks are written. He writes them and issues Code C, the final verification as filled in from Ahmed's reply | Until the Code, TMC and Al Waha see no change at all: no reply, no Return to Engineer, no Recommended Code. After it, both read the Code, its Remarks and its final verification, and never Ahmed's answers, his Recommended Code or an Internal Note. |
| 14 | Hafiz | Open "Lighting control – Tower 2" (Code C from step 13) → Create Revision; it opens as a Draft, "No number yet: Revision 1". Change the Model → Save and close → open the Revision Draft again from the Submittals list. Next to the Document Number, open the **Revision** drop-down | The drop-down lists `TWR-MAR-01-…` and "Revision 1: no number yet"; choosing the original opens it, closed with its Code C. Mohammed and Faisal open the original: no drop-down (they see no other Revision), no Link to the Draft, and its address is "not found" to them. |
| 15 | Mohammed | Open "Cable tray risers – Tower 1" from the list: the seeded `TWR-MAR-01-0003 Rev 1` (Pending Approval) → open the **Revision** drop-down → choose `TWR-MAR-01-0003` | The drop-down lists `TWR-MAR-01-0003` and `TWR-MAR-01-0003 Rev 1`, the one open marked, each number left to right whole (in Arabic too). The original opens with its own answers (Model "Cablofil CF 54"), Code C with its Remarks and final verification, and its history; choosing Rev 1 goes back, which waits for Ahmed's reply and Mohammed's Code. Yousef (Beta Build) sees neither. |

Step Age dots (1–4+ weeks at the current Step) show on the list and the item; there are no due dates. Linking notifies nobody.

Both seam suites run against this seeded setup: their global setup (`apps/api/test/support/seed-demo.ts`) seeds the same demo into the test database, where the demo people sign in with the test harness's password, and `apps/api/test/demo-seed.test.ts` follows the walkthrough above through the API.

## Several worktrees at once

Parallel Claude Code sessions each work in their own git worktree. Give each worktree its own lane number so they never share a database or a port:

```bash
pnpm lane:env 32       # Main 3's lane B; see below
pnpm install
pnpm dev
```

A lane number is two digits `mL` (RP-602): `m` is the Main (planning) session, 1–5, and `L` is 0 for the Main itself (it only runs the app) or 1–4 for its lanes A–D. So `32` is Main 3's lane B, and the valid lanes are 10–14, 20–24, … 50–54, plus lane 0 for the main folder. `lane:env` refuses any other number (15, 55, 60, …). Lane `n` gets its own Docker Compose project (`rabaed-laneN`, with its own container and volume), the host `laneN.localhost`, and these ports:

| | lane 0 (default) | lane n | lane 32 |
|---|---|---|---|
| Postgres | 5432 | 5432 + 10n | 5752 |
| api | 4000 | 4000 + 10n | 4320 |
| Rabaed Admin | 4050 | 4050 + 10n | 4370 |
| web | 3000 | 3000 + 10n | 3320 (`lane32.localhost:3320`) |
| Mailpit | 8025 | 8025 + 10n | 8345 |
| File store | 9000 | 9000 + 10n | 9320 |

No two lanes share a port: within each hundred the api ports end in 00–40 and Rabaed Admin's in 50–90, and the other services have ranges of their own. The single-digit lanes 1–9 of the old scheme (ports base + 100n) still work until no worktree uses them; lane `m0` has exactly legacy lane `m`'s ports, so `lane:env` treats the two as one lane and refuses either while the other's compose project belongs to another worktree.

Machine load: 5 Mains × (the Main + 4 lanes) is 25 stacks, about 75 containers. Start a lane's containers only while you work in it, and stop idle ones (`docker compose stop` in that worktree; `pnpm servers:stop` once RP-568 merges).

`pnpm lane:env N` first checks that lane N's ports are free and that no other worktree uses its compose project. If one is taken it stops and names the container (or other process) holding it, and suggests a free lane; `pnpm lane:env N --free` takes the next free lane itself, trying the same Main's lanes `m1`–`m4` first (from 31: 32, 33, 34, then the other Mains' lanes); a bare `pnpm lane:env --free` starts at lane 11, and from a legacy lane it goes on to the lanes A–D once 1–9 are taken. `lane:env N --force` also takes over the twin lane's project (legacy `m` for `m0`, or `m0` for `m`) from a worktree that is gone, or merged and clean; that project's volumes stay until `lanes:prune`, and lane N starts with a database of its own. Old worktrees leave their compose projects running or stopped: `pnpm lanes:prune` lists the `rabaed-*` projects whose worktree is gone, that are not running, or that only have volumes left, and removes them with their volumes after you confirm (`--yes` skips the prompt). It never removes the current worktree's project. When the worktree holding a lane is on a branch already merged into `origin/main`, `lane:env` says so; `pnpm lanes:prune --merged` then removes such projects too, unless a worktree that is not merged names the project in its `.env`.

Machine load (RP-1096): at most 8 `rabaed` stacks run at once on the machine. `lane:env` warns when your lane's stack would leave one slot or none, and refuses when 8 other stacks already run (your own lane's stack does not count). The owner sets the cap with the environment variable `RABAED_MAX_STACKS` (default 8, in `scripts/machine-load.ts`). `pnpm lanes:prune --stale` is a report for session start: the running stacks against the cap, stopped stacks, stacks with a dead container, projects with only volumes left and stray containers; it removes nothing. `pnpm verify` checks Docker, the lane's db and its file store (rustfs) first and stops with what is down, then waits for its Main's one verify slot, so a second verify among one Main's lanes waits for the first (the owner chose one per Main; Mains verify side by side). Lane 7 is Main 7's: it counts as a running stack, and nothing stops or prunes it.

After the queue merges a PR, run `pnpm worktrees:prune`, then the retro, then archive the session. It removes every worktree merged into `origin/main` (or whose upstream is gone) with its compose project, folder and branch, deletes the other merged local branches, and prunes orphaned compose projects. It never touches the main checkout or the current worktree, skips worktrees with uncommitted or unpushed work, and asks first (`--yes` skips the prompt). See "Pruning old lanes" in `planning/parallel-sessions.md`.

Open each lane's web app at `http://laneN.localhost:<web port>/en`. Browsers keep cookies per host name, not per port, so a separate `laneN.localhost` host stops one lane's sign-in from replacing another's. Tests read the same `.env`, so each lane's test runs use its own database.

Several worktrees in one lane (a spec's implementer subagents) share its Postgres with `pnpm lane:env N --force --db <suffix>` (e.g. `--db rp322`): `--force` overwrites an existing `.env`, and `--db` names the databases `rabaed_<suffix>` and `rabaed_<suffix>_test`, so their seam suites never migrate the same database. `pnpm lanes:drop-dbs` drops those of worktrees that are gone. See `planning/parallel-sessions.md`, step 4 of `/implement-spec`.

## Layout

| Package | What it holds |
|---|---|
| `apps/web` | Next.js, React, Tailwind + shadcn/ui, next-intl (English and Arabic, RTL, Latin digits). UI strings live in `apps/web/messages/*.json` as translation keys. |
| `apps/api` | Fastify with zod validation. |
| `apps/worker` | Outbox processor (in-app notifications, from RP-195; immediate notification emails, RP-357, linking to `WEB_URL`). |
| `packages/domain` | Shared rules and types, no I/O. |
| `packages/mailer` | Email: `send({ to, template, locale, values })`, with the templates in English and Arabic (RTL, Latin digits). Amazon SES in AWS; SendGrid on Vercel (`SENDGRID_API_KEY`, tracking off, ADR 0026); locally and in CI, Mailpit (`MAIL_CATCHER_URL`). |
| `packages/db` | Kysely, the migration runner, role bootstrap and `withMember`. Migrations are plain SQL in `packages/db/migrations`, named `YYYYMMDDHHMMSS_what.sql`. |
| `packages/infra` | AWS CDK (TypeScript). One entry per environment in `src/config.ts` (name, region, GitHub repository, budget); dev is `eu-central-1`. `pnpm --filter @rabaed/infra cdk synth` prints the templates. |

## AWS account setup

Each environment has its own AWS account. The steps only a person can do are one re-runnable wizard; run it from Git Bash (Windows), macOS or Linux:

```bash
bash packages/infra/scripts/setup-aws-account.sh dev
```

| Stage | What happens |
|---|---|
| 1. Tools | Checks for the AWS CLI v2 (with `aws login`), the GitHub CLI, OpenSSL and Node, and signs `gh` in. |
| 2. AWS account | Optionally walks you through creating the account and putting MFA on the root user, then signs the CLI in with `aws login` (short-lived console credentials; no access keys) and confirms the account ID. A new account has only its root user, which is fine up to stage 4. |
| 3. Billing contact | Sets the account's billing alternate contact with `aws account put-alternate-contact`. |
| 4. Alert emails | Asks where budget alerts go (the amount is `monthlyBudgetUsd` in `src/config.ts`) and where CloudWatch alarms go. Without a budget in config, it asks you to create one in the Billing console instead. |
| 5. Admin sign-in | Root is for account tasks only (billing), so from here on the wizard refuses it. If stage 2 signed in as root, it has you turn on IAM access to billing (a root-only task), then guides you through creating an admin that is not root: a user in IAM Identity Center with the AdministratorAccess permission set (preferred; enabling it makes the account an AWS Organizations management account), set up with `aws configure sso`; or an IAM user with a console password, MFA, AdministratorAccess and no access keys, signed in with `aws login`. It signs that profile (`AWS_ADMIN_PROFILE` in `.env.aws`) in, checks it is the same account and not root, and uses it for the rest of the run. |
| 6. Account stack | Bootstraps the CDK once more, for the account stack alone (`CDKToolkit-Account`, qualifier `rabaedacct`; GitHub's roles cannot assume its roles), then deploys `Rabaed-<env>-Account` (`src/account-stack.ts`) through it: GitHub's OIDC provider; `rabaed-<env>-github-deploy`, assumable only by a job in the GitHub environment `<env>` (stage 9; it admits only `main`), which can assume the CDK bootstrap roles, push to the `rabaed-<env>/*` image repositories, run the `rabaed-<env>-migrate` task and pass it only its own roles; `rabaed-<env>-github-diff`, assumable only from this repository's pull requests and read-only (it can only read the environment's CloudFormation stacks and the CDK bootstrap version, not logs, buckets or images); the monthly budget where config sets one, alerting at 80% of actual and 100% of forecast spend; the alarm topic `rabaed-<env>-alarms`, which emails the alarm address (confirm the subscription in the email AWS sends); and what a deploy may reach (see "What a deploy can reach"). The CDK shows the IAM changes for approval. |
| 7. CDK bootstrap for deploys | `cdk bootstrap --cloudformation-execution-policies` with `rabaed-<env>-cfn-execution`: the CDK's own deploy, publishing and lookup roles and asset bucket, which every deploy from GitHub goes through, with CloudFormation limited to that policy instead of AdministratorAccess. Re-running it switches an account bootstrapped before over. |
| 8. Interim HTTPS certificate | Creates a self-signed certificate for `*.<region>.elb.amazonaws.com` with OpenSSL, imports it into ACM and deletes the private key locally (see "Dev environment on AWS"). Offers to replace it on later runs; it is valid for 397 days. Once `AWS_CERTIFICATE_ARN` is the domain's certificate ("A real domain" below), it keeps that and asks nothing. |
| 9. GitHub variables | Records `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `AWS_DIFF_ROLE_ARN`, `AWS_CERTIFICATE_ARN` and `AWS_CERTIFICATE_PEM` (the certificate, which is public) as repository variables, and creates the GitHub environment `<env>` (Settings → Environments), open to deployments from `main` only. For the domain's certificate it deletes `AWS_CERTIFICATE_PEM` instead. |
| 10. Email sender | Asks for the address every email comes from and has SES verify it (AWS emails it a link), records it as the `MAIL_FROM_ADDRESS` repository variable, requests SES production access (leaving the sandbox; AWS reviews it, usually within a day) and offers a test email from the sender to itself. See "Email" below. |
| 11. Thmanyah fonts | Uploads the licensed `thmanyahsans-*.woff2` files from a folder on your computer to the private build assets bucket, under `fonts/thmanyah/`. Needs the storage stack, so on a new account it is skipped until the first deploy; re-run the wizard then. See "Thmanyah fonts" below. |
| 12. Test alarm | Sets `rabaed-<env>-load-balancer-5xx` to ALARM with `aws cloudwatch set-alarm-state` and asks whether the email arrived. CloudWatch sets it back within minutes (an OK email follows). Needs the monitoring stack, so it is skipped until the first deploy. |

Your answers are remembered in `.env.aws` (git-ignored), so a re-run offers them as defaults; every stage is safe to repeat. Answers are saved clean: escape codes from arrow or function keys, other control characters and surrounding spaces are dropped, and a saved answer that holds any is asked again. Before every AWS step the wizard takes fresh short-lived credentials from the CLI; if the sign-in has expired it stops there, before the CDK or any AWS call, and offers to sign in again (`aws login`, or `aws sso login` for an Identity Center profile). Credentials stay in the CLI's own folder in your home directory, never in the repo or `.env.aws`. Nothing secret goes into the repo or GitHub: the budget and alarm emails are `NoEcho` deploy-time parameters, never in a template or a diff, and GitHub holds only role ARNs, the region, the interim certificate (which is public) and its ARN, and the email sender's address (a variable, so it stays out of the repo).

Both roles check GitHub's immutable OIDC subject, which carries the owner and repository IDs (`repo:Rabaed@328426410/rabaedV2.0@1391344568:…`, set in `src/config.ts`), so a renamed or re-created repository cannot match. The wizard warns if GitHub's subject (`gh api repos/Rabaed/rabaedV2.0/actions/oidc/customization/sub`) ever differs from the config.

### What a deploy can reach

A merge to `main` deploys with GitHub's deploy role, so whoever can merge can change what a deploy does. This is how far that goes (RP-242, asserted in `test/deploy-reach.test.ts` and `test/ci-access.test.ts`):

- **Who can deploy.** The deploy role trusts only the OIDC subject `…:environment:dev`, which GitHub gives only to a job that names the `dev` environment, and the environment admits only `main`. Only `deploy-dev.yml`'s `deploy` job names it: another workflow on `main` gets no deploy credentials just for asking for an OIDC token.
- **What CloudFormation may do.** The deploys' CDK bootstrap runs CloudFormation with `rabaed-<env>-cfn-execution` (`src/deploy-policies.ts`), not AdministratorAccess: the services the stacks use (VPC, ECS, ECR, RDS, S3, KMS, Secrets Manager, Lambda, CloudWatch and its logs, CloudTrail, the load balancer, Cloud Map and its private DNS zone, SES configuration sets), this environment's nested stacks, the password-rotation app, and IAM only for roles named `rabaed-<env>-*` or `Rabaed-<env>-*`, which it may create or give permissions only while they carry the permissions boundary; besides those, it may pass only its own role, and only to CloudFormation, for the nested rotation stacks. It can never remove a boundary, and of GitHub's roles it may only add and remove inline grants (the stacks grant the deploy role the fonts, the demo password and the last good version next to each); their trust, boundary and managed policies are the account stack's.
- **What any of those roles can do.** The boundary `rabaed-<env>-boundary` caps every role a deploy creates or changes, and the deploy role itself: the workloads' own actions (images, logs, the migration task, objects, keys, secrets, parameters, sending email, Lambda network interfaces), assuming only the CDK's bootstrap roles, passing only this environment's roles, and simulating the policies of the api's and Rabaed Admin's task roles (the deploy's admin secret access check, ADR 0010). Nothing else in IAM.
- **The account stack is out of reach.** It holds the trust, the boundary and the execution policy, so it goes through a CDK bootstrap of its own (`CDKToolkit-Account`, qualifier `rabaedacct`, AdministratorAccess) that only a person uses, through the wizard.

A stack that needs a new kind of resource, or a role that needs a new kind of action, widens the execution policy or the boundary in the same change; the infra tests fail until it does, and the change takes effect when someone re-runs the wizard's stage 6 (the account stack is never deployed from GitHub).

Password rotation uses AWS's own rotation function (the Serverless Application Repository app `SecretsManagerRDSPostgreSQLRotationSingleUser`) with our role `rabaed-<env>-rotation`, not hosted rotation, whose role CloudFormation would create without the boundary.

**Switching an account set up before RP-242** (dev was): merge, then re-run the wizard's stages 6, 7 and 9 (account stack, bootstrap for deploys, GitHub environment). Until then the deploy fails at "Configure AWS credentials", since the deploy role still trusts `main` rather than the environment. Then run Actions → Deploy dev. That first deploy replaces the four rotation functions (named `rabaed-dev-rotation-<secret>` now, `-rotate-` before) and puts the boundary on every existing role.

Once the variables exist, every pull request from this repository gets a `cdk diff` comment (account ID removed). Pull requests from forks get no AWS access and skip it. Because a pull request runs its own copy of the workflow, anyone who can push a branch here can use the diff role, so it reads only the deployed CloudFormation templates and the CDK bootstrap version: no logs, buckets, images or other roles. The CDK warns that it cannot assume its lookup role and carries on with the diff role.

CloudFormation has no `AWS::Budgets::Budget` in `me-central-1`, so an environment there leaves `monthlyBudgetUsd` out (synthesis refuses it otherwise) and the wizard has you create the budget in the Billing console.

Every stack, role, repository and parameter name comes from `src/config.ts` (`stackNames`, `resourceNames`; ADR 0005). The workflows and the wizard pick the environment with one input, `RABAED_ENV`, and read the names from `node packages/infra/bin/names.ts <env>`; `test/names.test.ts` fails if they spell one themselves.

## Dev environment on AWS

**Not deployed** (ADR 0026, RP-1043): dev, demo and UAT run on Vercel, deployed by `.github/workflows/deploy-uat.yml`; `deploy-dev.yml` and the `cdk diff (dev)` check (`infra-diff.yml`) are retired. The AWS code below stays in the repo, undeployed, for the production decision; this section describes how it ran.

| Stack | What it holds |
|---|---|
| `Rabaed-dev-Network` | VPC over two zones: public subnets for the load balancer and the NAT gateway only; private subnets for the Fargate tasks; isolated subnets (no route out) for the database. The ECS cluster, the private DNS name `api.rabaed-dev.internal`, and every security group. |
| `Rabaed-dev-Data` | RDS PostgreSQL 16, single-AZ, not publicly accessible, TLS required, encrypted with a customer-managed KMS key, daily backups kept 1 day (the dev account is on AWS's Free plan, which refuses more; upgrading the plan allows 7), fixed 20 GB storage, deletion protection on. One JSON secret per database user (`database/master`, and `database/roles/<role>` for the three roles), each rotated every 30 days by a Secrets Manager Lambda inside the VPC. |
| `Rabaed-dev-Registry` | ECR repositories `rabaed-dev/web`, `api`, `admin`, `worker`: scanned on push, tags immutable. |
| `Rabaed-dev-Storage` | The storage KMS key (rotating) and a signing key reserved for sealing PDFs. Buckets, all private, versioned, owner-enforced and TLS-only: **Project files** (storage key; objects under `projects/<Project>/…`, ADR 0007), **build assets** (storage key; the Thmanyah fonts under `fonts/`, which the deploy role may read and nothing else of the bucket) and **logs** (S3 access logs of the other two, the load balancer's access logs under `load-balancer/` and CloudTrail under `cloudtrail/`; kept a year). |
| `Rabaed-dev-Migrations` | The one-off migration task (`packages/db/src/setup.ts` in the api image). |
| `Rabaed-dev-App` | The load balancer (HTTPS, HTTP redirected; access logs to the logs bucket), the `web`, `api` and `worker` Fargate services at the fixed sizes in `src/config.ts`, each logging to `/rabaed/dev/<service>`; Rabaed Admin's `admin` service behind its own load balancer (HTTPS only, output `AdminUrl`; ADR 0010); and the SES configuration set `rabaed-dev` (see "Email"). |
| `Rabaed-dev-Monitoring` | CloudTrail, the alarms and a saved Logs Insights query over all four services (see "Monitoring and audit trail"). |

Traffic paths (security groups, asserted in `test/network.test.ts`): internet → load balancer on 443 (and 80, only to redirect) → web → api → database; internet → admin load balancer on 443 only → admin → database; worker, the migration task and the password rotation Lambda → database. The load balancer forwards to web only; the browser reaches the api through web's `/api/v1` proxy. Rabaed Admin has its own address, and nothing connects it to web or the api. Tasks may also call out over HTTPS (image pulls, logs, secrets) through the NAT gateway.

**The deploy, in order.** The workflow runs only after CI (lint, typecheck, unit, seam 1 and 2, infra assertions) passes on `main`, one deploy at a time; a run whose commit is no longer `main`'s head skips itself.

1. Deploy the network, data, registry and storage stacks, then download the Thmanyah fonts from the build assets bucket, if any were uploaded.
2. Build the four images (web, api, admin, worker) from the root `Dockerfile` and push them tagged with the commit SHA (a re-run reuses them). Only web gets the fonts.
3. Deploy the migrations stack with that image, run the task, print its log and stop if it does not exit 0. The app is not touched. Dev is a demo environment, so the same task then seeds the demo if it is missing (or resets it, see "Demo in dev").
4. Deploy the app stack with that image, then the monitoring stack. ECS rolls each service over; if new tasks fail their health checks (web: the load balancer's `GET /api/health`; api and admin: `GET /health`, which answers 503 without the database), the circuit breaker rolls the service back to the previous version and the deploy fails.
5. Smoke test (`packages/infra/src/smoke.ts`): HTTP redirects to HTTPS; `/api/health` shows web and the api both run this commit and the database is ok; `/en/health` loads, every font in its stylesheets comes from our own origin, and Arabic is in the font web was built with (Thmanyah Sans when the fonts were available), whose file loads. Rabaed Admin's `/health` answers on its own address with this commit, and the customer address answers none of Rabaed Admin's routes (nor the old `/admin/v1` ones). In dev it also signs in as Hafiz and Nasser, through web's `/api/v1` proxy, and checks that each gets 404 on the other's Project, its Work Item list and its Work Items and never sees it listed (the seeded Drafts, plus up to four more of Riyadh Gate Tower's Work Items from walkthroughs; a Project with none fails the check). Retries for five minutes, then fails the workflow (and rolls back, step 9).
6. Admin secret access check: the workflow asks IAM (`simulate-principal-policy`, which reads policies and changes nothing) whether the api's task role could read the `rabaed_admin` secret, which must be denied, and whether Rabaed Admin's could, which must be allowed. The app stack lets the deploy role simulate those two roles and nothing else (`test/rollback.test.ts`).
7. App role check: the migration task again, with `packages/db/src/check-app-role.ts`, connected as `rabaed_app` inside the VPC. It fails the deploy if the role is a superuser or bypasses row-level security, sees any row of `company`, `member`, `project`, `participant`, `work_item` or `work_item_event` with no Member set, can switch row security off, or may update, delete or truncate the append-only audit tables, `work_item_event` and `admin_action`. It reads and changes nothing.
8. Record the commit as the last good version in the SSM parameter `/rabaed/dev/deploy/last-good-version`. Only the workflow writes it, so no stack update can reset it; the registry stack lets the deploy role read and write that parameter and no other (`test/rollback.test.ts`).
9. Roll back (RP-246): if anything after the app stack deployed fails (monitoring, smoke test, admin secret access or app role check), the workflow redeploys the app stack with the last good version's images and stays red. It restores code, not schema: migrations are forward-only, so the previous code runs on the new schema, and every migration must stay backward-compatible with the version before it. The app stack's own template is this commit's, so only the images go back. With no good version recorded yet, when its images have left the registry (it keeps 50), or when the failing commit is itself the last good one, dev stays on the failing version until `main` is fixed.

No AWS keys exist anywhere: the workflow gets short-lived credentials through GitHub OIDC. Configuration reaches the containers as environment variables; nothing secret is in an image or a variable.

**Secrets and rotation.** Each task role reads only its own secrets (`test/services.test.ts`): api and worker the `rabaed_app` secret, Rabaed Admin the `rabaed_admin` secret, web none. No role but Rabaed Admin's (and the one-off migration task's, which creates the roles) can read `rabaed_admin`'s. api, worker and admin are given their secret's ARN (`DATABASE_APP_SECRET_ARN`, `DATABASE_ADMIN_SECRET_ARN`) and read the current password when the pool opens a connection, cached for five minutes (`packages/db/src/rotating-password.ts`). A rotation changes the password in the database and then in the secret, seconds apart. Connections already open are unaffected. A new connection refused in between rereads the secret and tries once more. So rotation needs no restart and causes no downtime. The one-off migration task gets its passwords injected at start, but in AWS it sets a role's password only when it creates the role (`DATABASE_ROLE_PASSWORDS=on-create`); after that rotation owns it, so a deploy never sets a rotated password back. There are no application secrets yet (only database credentials); when one is needed it follows the same pattern: its own secret, readable only by the task role that needs it.

**Test a rotation** (acceptance check, once per environment, as an account administrator):

```bash
aws secretsmanager rotate-secret --region eu-central-1 --secret-id rabaed/dev/database/roles/rabaed_app
aws secretsmanager describe-secret --region eu-central-1 --secret-id rabaed/dev/database/roles/rabaed_app --query '{last:LastRotatedDate,versions:VersionIdsToStages}'
```

Rotation takes a few seconds. `describe-secret` shows a new `LastRotatedDate` and a single `AWSCURRENT` version. Secrets Manager leaves the `AWSPENDING` label on that same version after a successful rotation; an `AWSPENDING` on any other version means the rotation is stuck. Then wait two minutes: the pool closes idle connections after 10 seconds and ECS checks the api's health every 15, so by then the api has opened new connections with the old (cached) password, been refused, reread the secret and connected. `/en/health` must still show "database: ok", the api service must have had no task replaced (ECS console → rabaed-dev → api → Tasks), and its log must show no errors. Repeat for `roles/rabaed_admin`, `roles/rabaed_migrator` and `master`, then run Actions → Deploy dev once to confirm migrations still sign in. If a rotation fails, the Lambda's log group (`/aws/lambda/rabaed-dev-rotation-<secret>`) says why.

**Project files.** Only the api's task role (`rabaed-dev-api-task`) can read or write objects, only under `projects/`, and the bucket policy refuses object access to every other principal, administrators included. Browsers will get files through signed URLs the api creates, which carry the api role's permissions; the bucket refuses any signature older than 15 minutes. The api is told the bucket as `PROJECT_FILES_BUCKET`. The bucket cannot tell one Project from another: before signing a URL the api must check the Member may see that Project's file (visibility.md), which arrives with the first file feature.

**Thmanyah fonts.** Thmanyah Sans is licensed: its files are never in the repo, the build context or GitHub. The wizard (stage 11) uploads them to the build assets bucket. The deploy role, which builds the images, may list and read only the bucket's `fonts/` prefix and decrypt only through S3 for that bucket (`test/storage.test.ts`; together with `test/ci-access.test.ts`, that is everything the role itself may do). Through the CDK deploy role it hands over to, a deploy can still change any stack, and so the bucket. The workflow hands the files to the web build alone as a separate build context (`--build-context fonts=…`, see the `Dockerfile`). Next.js bundles them, so dev serves them from its own address, never a font CDN. Without the files (a fork, a pull request, a local build, or before stage 11), everything builds with IBM Plex Sans Arabic. CI's web build checks exactly that. Uploaded fonts reach dev with the next merge to `main`. A re-run of the same commit reuses its web image, fonts or not. Two checks keep fonts out of the public repo, both in CI's secret scan (`secret-scan.yml`): its `gitleaks` job runs them over a pull request's own commits, a queue entry's or `main`'s history, and a nightly job over every branch. `scripts/check-no-fonts.ts` refuses any font file in those commits, by path, since font files are binary and gitleaks skips binary files. It also refuses font data embedded in a text file: a Claude Design export's manifest entry with a font mime type, or a base64 font data URL (RP-962). A gitleaks rule in `.gitleaks.toml` catches fonts inlined as base64 data URLs into CSS, HTML or JS too. A Claude Design export embeds every font it uses, Thmanyah included: run `pnpm design:strip-fonts <in.html> <out.html>` and commit the output. The check also runs before each commit: `.githooks/pre-commit` runs `node scripts/check-no-fonts.ts --staged`, on once `pnpm install` has run ("Run it locally").

**Email** (`src/email.ts`, asserted in `test/email.test.ts`). Rabaed sends email through Amazon SES in the environment's region, through `packages/mailer`. The sender is verified by the wizard (stage 10), outside CloudFormation: one address until Rabaed has a domain. Its address is never in the repo: the wizard records it as the `MAIL_FROM_ADDRESS` repository variable and the deploy passes it to the App stack as the `MailFromAddress` parameter (until it is set, the parameter is empty and nothing can send). Only the api's, Rabaed Admin's and the worker's task roles (the worker sends notification emails) may call `ses:SendEmail`, only with that From address and only through the configuration set. All three are told `MAIL_FROM` and `MAIL_SES_CONFIGURATION_SET`, which makes the mailer use SES. The configuration set `rabaed-dev` requires TLS, suppresses addresses that bounced or complained, and publishes bounces and complaints to CloudWatch (namespace `AWS/SES`), split by the `template` dimension, so CloudWatch → Metrics → SES shows them per template. A new account's SES is in the sandbox (sends only to verified addresses, 200 a day) until AWS grants production access, which the wizard requests.

When Rabaed's domain is chosen, verify the domain instead of the single address, and publish:

- *DKIM:* in SES, create an identity for the domain with Easy DKIM (RSA 2048). SES gives three CNAME records, `<token>._domainkey.<domain>` → `<token>.dkim.amazonses.com`; publish all three.
- *Custom MAIL FROM and SPF:* set the identity's MAIL FROM domain to `mail.<domain>` and publish `mail.<domain>` MX `10 feedback-smtp.<region>.amazonses.com` and TXT `"v=spf1 include:amazonses.com ~all"`, so SPF aligns with the From domain.
- *DMARC:* TXT on `_dmarc.<domain>`: start with `"v=DMARC1; p=none; rua=mailto:<reports mailbox>"`, then move to `p=quarantine` once the reports show only SES sending.

Then set `MAIL_FROM_ADDRESS` to an address on the domain (for example `no-reply@<domain>`). The grant already allows a domain identity (`identity/*`, limited by the From address), so no infrastructure change is needed.

**Logs bucket** (amends spec RP-207, which asked for every bucket to be KMS-encrypted). It is encrypted with S3-managed keys (SSE-S3, `AES256`), not KMS, because S3 server access logs and the load balancer's access logs can only be delivered to such a bucket. CloudTrail shares the bucket, so its files are SSE-S3 too. `test/storage.test.ts` asserts it. Every other bucket uses the storage key.

**Plain HTTP inside the VPC** (ADR 0011). The load balancer forwards to web, and web calls the api (`API_URL`, `http://api.rabaed-dev.internal:4000`), over plain HTTP inside the private subnets. Accepted for dev only, which holds demo data; an environment with real customer data must carry TLS on both hops.

**Demo in dev** (RP-213). Dev holds the demo and nothing else: the two demo Projects above, made up from end to end. There is no way to import data, and nobody should type real Companies, people or documents into it. Other environments are not demo ones (`demo` in `src/config.ts`): they have no demo password, and the demo command refuses to run there.

- *Seeded by the deploy.* After the migrations, every deploy runs `apps/api/src/cli/demo-environment.ts ensure` in the migration task. It seeds the demo, through the API as `pnpm demo:seed` does, only if the database does not have it yet, so the first deploy seeds it and later deploys leave it as it is. A seed that stopped part way fails every later deploy until the demo is reset.
- *Password.* Every demo person signs in with one password, generated in Secrets Manager (`rabaed/dev/demo/password`) and never in the repo. Read it with `aws secretsmanager get-secret-value --region eu-central-1 --secret-id rabaed/dev/demo/password --query SecretString --output text`. The migration task gets it at start, and the deploy role may read it (only it) for the smoke test.
- *Walkthrough.* Follow "Demo: the MAR journey" above at the dev address (the deploy's summary shows it) instead of localhost.
- *Reset.* Actions → Deploy dev → Run workflow, with "Reset the demo" ticked. The deploy then drops dev's database (closing the api's and worker's connections, which reconnect), migrates it again and seeds the demo afresh. For the few seconds in between, the running api answers 503 and dev may show errors. Everything anyone did in dev is gone, including its audit trail; that is only acceptable because dev holds demo data only.

**Monitoring and audit trail** (`src/monitoring-stack.ts`, asserted in `test/monitoring.test.ts`).

- *Logs.* Every log group is kept 30 days (`logRetentionDays` in `src/config.ts`), including the Lambdas': CDK's custom-resource Lambdas log to `/rabaed/dev/lambda/<stack>`, and each password-rotation Lambda is named so its `/aws/lambda/rabaed-dev-rotation-<secret>` group is created first. To search web, api and worker together: CloudWatch → Logs Insights → Queries → Saved → `rabaed-dev/all-services`, or pick the three `/rabaed/dev/…` groups yourself. api and worker log JSON lines with no customer content: requests by method and path (no query string), database errors by code and constraint only (their messages can quote a row), and the outbox as counts (`apps/api/src/logging.ts`, `apps/worker/src/log.ts`).
- *Alarms*, emailed through `rabaed-dev-alarms` when they fire and when they clear; thresholds in `src/config.ts`:

  | Alarm | Fires when |
  |---|---|
  | `rabaed-dev-api-5xx-rate` | more than 5% of api responses in 5 minutes are 5xx (with at least 10 requests), from the api's request log, which leaves out `/health` |
  | `rabaed-dev-load-balancer-5xx` | the load balancer itself answers 5 or more 5xx in 5 minutes (web down or not answering) |
  | `rabaed-dev-unhealthy-targets` | a web task fails the load balancer's health check for 5 minutes |
  | `rabaed-dev-outbox-age` / `-outbox-backlog` | the oldest unprocessed outbox row is over 5 minutes old / more than 100 rows wait for 15 minutes. The api reads both from the database and logs them every minute (`apps/api/src/outbox-report.ts`), so a stopped worker shows as a growing age. No report (the api down, or the database unreadable) fires them too. |
  | `rabaed-dev-<service>-tasks` (web, api, admin, worker) | fewer of the service's tasks run than `desiredCount` for 5 minutes, or ECS reports no count. From Container Insights, which is on for the cluster (RP-245). |
  | `rabaed-dev-database-cpu` / `-storage` / `-connections` | CPU over 80% for 15 minutes / under 2 GB free / over 60 connections for 10 minutes |

- *Audit trail.* CloudTrail (`rabaed-dev`) records every management call in every region of the account, with log file validation, to the logs bucket under `cloudtrail/`. The load balancer's access logs go there too, under `load-balancer/`. Both are kept a year.

To test an alarm by hand (acceptance check): `aws cloudwatch set-alarm-state --region eu-central-1 --alarm-name rabaed-dev-load-balancer-5xx --state-value ALARM --state-reason test`, or run the wizard's stage 12.

To check the worker alarms for real (RP-245, once per environment, as an account administrator): stop the worker, `aws ecs update-service --region eu-central-1 --cluster rabaed-dev --service <worker service> --desired-count 0` (ECS console → rabaed-dev → Services shows its name). Within about 5 minutes `rabaed-dev-worker-tasks` fires; leave a Work Item submitted and `rabaed-dev-outbox-age` follows once its notification has waited 5 minutes. Set the desired count back to 1 and both clear. The next deploy sets it back too.

**To see a rollback** (acceptance check): on a branch, make the api's `/health` return 503 only on ECS (for example when `ECS_CONTAINER_METADATA_URI_V4`, which ECS sets, is present; failing it everywhere fails seam 1, and CI never deploys), merge, and watch the workflow of the first commit that includes it (a newer merge cancels the older deploy): the App step fails with "circuit breaker", the service returns to the previous task definition, and `/en/health` keeps showing the previous commit. Revert afterwards.

**Interim HTTPS (until Rabaed has a domain).** No public certificate authority issues certificates for the load balancer's own AWS address, so the wizard (stage 8) imports a self-signed certificate for `*.eu-central-1.elb.amazonaws.com` and the listener uses it. Traffic is encrypted, but browsers warn the first time ("Your connection is not private"): choose Advanced → Proceed. The smoke test trusts exactly that certificate (`AWS_CERTIFICATE_PEM`).

**A real domain** (configuration only; `test/domain.test.ts`). When the domain is decided:

1. In ACM (eu-central-1), request a public certificate for `dev.<domain>` with DNS validation, and publish the CNAME record ACM gives.
2. Point `dev.<domain>` at the load balancer: a CNAME (or a Route 53 alias) to the App stack's `LoadBalancerDnsName` output.
3. Once ACM shows the certificate as issued, and right before merging step 4, put its ARN in `.env.aws` as `AWS_CERTIFICATE_ARN` and re-run the wizard. Stage 8 then keeps it (ACM renews it), and stage 9 sets the `AWS_CERTIFICATE_ARN` variable and deletes `AWS_CERTIFICATE_PEM`.
4. Set `domain: "dev.<domain>"` for dev in `src/config.ts` and merge. Steps 3 and 4 switch over together: a deploy between them serves the domain's certificate at the load balancer's address, so its smoke test fails.

That deploy serves the domain's certificate, and the App stack's `Url` output, which the smoke test and the deploy's summary use, becomes `https://dev.<domain>`. If the certificate and `domain` disagree (or the DNS record is missing), the smoke test fails on the TLS host name check and the deploy turns red. The browser builds every other link (invitations) from the address it is on, so nothing else changes. Then verify the domain for email too (see "Email" above).

**Before the first deploy** (from `main`, after this is merged): re-run the wizard so stage 6 redeploys the account stack with the deploy role's new permissions and the alarm topic, and stages 8–9 create the certificate and record the variables. Then run the workflow by hand (Actions → Deploy dev → Run workflow) or merge anything.

## Database roles

| Role | Used by | Can |
|---|---|---|
| superuser (`DATABASE_SUPERUSER_URL`) | `pnpm db:setup` only | create roles and the database |
| `rabaed_migrator` | migrations, `pnpm engineer:create` | own the schema; as table owner it is not subject to RLS |
| `rabaed_app` | api, worker | read and write tables only through row-level security; cannot bypass it, create tables or own anything. It reaches sessions, passwords and invitations, writes Members and creates Projects only through narrow `SECURITY DEFINER` functions (`app.sign_in_candidate`, `app.session_principal`, `app.invite_member`, `app.create_project`, …). |
| `rabaed_admin` | Rabaed Admin (`apps/admin`), and nothing else (ADR 0010) | bypasses RLS (ADR 0007); every use for a Company's data (reads included, per visibility.md V9) goes through `asEngineer`, which records `admin_action` with a reason in the same transaction. The database does not enforce that pairing; Rabaed Admin is this role's only client. Its own sign-in records (`engineer_session`, `engineer_sign_in_code`, `engineer_device`, `engineer_sign_in_event`) it uses directly; an Engineer's password hash only through `app.engineer_sign_in_candidate`. Cannot read Members' passwords or sessions, and `admin_action` and the sign-in log are insert-only. |

Every request runs in a transaction that sets the acting Member with `withMember` (`set_config('app.member_id', …, true)`); RLS policies read it through `app.current_member_id()`. With no Member set, policies match nothing.

Every table the app role can read must enable row-level security in its migration; the seam-2 suite fails otherwise.

## Sign-in and onboarding (local)

Rabaed Admin (`apps/admin`, ADR 0010) is its own service at its own address: `http://127.0.0.1:<ADMIN_PORT>` (4050 in lane 0; `pnpm lane:env` gives each lane its own). `pnpm dev` runs it with the other apps.

1. Create an Engineer; the password is printed once:
   ```bash
   pnpm engineer:create --email you@example.com --name "Your Name"
   ```
2. Open Rabaed Admin and sign in with the email and password. A 6-digit code is emailed (locally to Mailpit, `http://127.0.0.1:<MAILPIT_PORT>`); enter it in the same browser. It works once, for 10 minutes. Five failed passwords or codes in a row lock sign-in for 15 minutes; a session ends after 30 minutes without a request; a sign-in from a browser not seen before emails an alert. Every sign-in, failure and sign-out is logged in `engineer_sign_in_event`.
3. Onboard a Company (legal name EN/AR, CR number, VAT number, Authorized Person, and a required reason). Rabaed Admin emails the Authorized Person an invitation in their language, linking to `WEB_URL/<locale>/accept-invitation#token=<token>`. The token sits in the URL fragment, so it never reaches a server log. It works once and expires after `INVITATION_TTL_HOURS`. If it expires, invite the Authorized Person again, by CR number, with a reason.

The Authorized Person then manages their Company's Members at `/en/members`: invite a Member (the page shows the one-time invitation link to pass on until email delivery exists), mark Members as Project Creators, and deactivate Members who leave, which ends their sessions at once. Every Member of the Company can read the list; no other Company can.

Members sign in at `/en/sign-in`. The web app forwards `/api/v1/*` to the API at runtime, so the session cookie stays first-party. The customer api has no Rabaed Admin route and no admin connection, and does not sign Engineers in (`apps/api/src/admin-boundary.test.ts`).

## Tests

All config comes from environment variables. The database suites use `<database>_test` on the same server, so they never touch your dev data.

```bash
pnpm test:unit    # pure logic, no database
pnpm test:seam1   # the API called as a given signed-in Member (apps/api/test); Documents need docker compose up -d files
pnpm test:seam2   # the database as the app role with a Member set (packages/db/test)
pnpm test:infra   # assertions on the synthesised AWS templates (packages/infra/test)
pnpm test:mail    # the mailer against Mailpit (packages/mailer/test); start it with docker compose up -d mailpit
pnpm lint
pnpm typecheck
```

Seam 1 is the primary suite: scenarios call the API through `createTestApi()` (`apps/api/test/support/harness.ts`) with real sign-in: `api.authorizedPerson()` onboards a Company and signs its Authorized Person in, `api.engineer()` gives a signed-in Rabaed Engineer, and `api.advanceClock()` moves time to test expiry.

Per-function timing: the local `db` service runs with `track_functions=pl` (`show track_functions`), so after a seam run you can see where the time went in the lane's `<db>_test` database:

```sql
select funcname, calls, total_time, self_time from pg_stat_user_functions where schemaname = 'app' order by total_time desc;
```

The test database is recreated on every run (`prepareTestDatabase`), so the stats cover the last run only. An existing lane database picks the setting up after `docker compose up -d db` (the container is recreated; the data volume stays). CI's service containers are left as they are.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit, web build, seam 1 and seam 2 against Postgres 16, the mailer against Mailpit, and the infra assertions, on each pull request (once per push to its branch), on every push to `main` and in the merge queue; `secret-scan.yml` runs gitleaks (default rules plus `.gitleaks.toml`) and `scripts/check-no-fonts.ts` over a pull request's own commits, a queue entry's, or `main`'s history, so a finding on one branch fails only that branch's checks, and nightly over every branch (not a required check: a red run means a secret on a public branch, to rotate, not just delete; RP-678); `dependency-audit.yml` (the required check `pnpm audit`) runs `pnpm audit` over every package, dev dependencies included, and fails on an advisory at high or above that `.audit-allowlist.json` does not list with a reason and a review date (`scripts/dependency-audit.ts`; RP-1023, RP-1032, RP-1070): it audits a pull request or queue entry only when it changes the lockfile, a package.json or another audit input (`scripts/dependency-audit-needed.ts`), and always nightly on `main`; `deploy-uat.yml` deploys each merge to `main` to UAT on Vercel (migrate, api and Admin, their smoke, web, its smoke), and `reset-uat.yml` seeds UAT's demo again by hand (ADR 0026). For a failure to block merging, `main`'s branch protection must list these jobs as required status checks.

## Secrets

The repo is public. Commit only `.env.example`; real values come from the secrets manager.
