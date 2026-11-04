# Rabaed v2.0

B2B construction management platform for KSA. Start with `CLAUDE.md`, `GLOSSARY.md` and `docs/visibility.md`.

## Run it locally

You need Node 24, Docker, and pnpm (`corepack enable`).

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm install` also turns on the git hooks in `.githooks` for the clone and every worktree (`core.hooksPath`, RP-989; not in CI). `pre-commit` refuses a staged conflict marker (`git diff --cached --check`; a Markdown line of exactly `=======` counts as one), an Atlassian, GitHub, Vercel, AWS or SendGrid token, a Basic auth header or a private key (`scripts/check-secrets.ts`, RP-1100; CI runs it again), a font file or embedded font data. Rebase and cherry-pick commit without it, so resolve conflicts with a merge. `pre-push` runs `pnpm lint` and `pnpm typecheck` side by side, about a minute, and refuses a push to a branch when either exits non-zero; a push that changes only docs, a tag or a branch deletion runs neither. They check the working tree, so push the branch you have checked out with nothing uncommitted.

`pnpm dev` starts Postgres 16, Mailpit (the mail catcher) and the file store in Docker, creates the database roles, applies migrations, then runs:

| App | URL |
|---|---|
| web | http://localhost:3000 (`/en`, `/ar`; health page at `/en/health`) |
| api | http://127.0.0.1:4000 (`GET /health`) |
| worker | background process, logs only |
| Mailpit | http://127.0.0.1:8025: every email the apps send locally lands here, never in a real mailbox |
| File store | http://127.0.0.1:9000: RustFS, S3-compatible. Documents' files go here locally and in CI, never to a hosted store; the api creates its bucket on start |

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
pnpm demo:session --uat hafiz      # UAT web host only, a demo Member only; password from UAT_DEMO_PASSWORD (never printed); writes %LOCALAPPDATA%\rabaed\demo-sessions\hafiz.uat.json (~/.local/state/rabaed/demo-sessions/ elsewhere), outside the repo
```

signs in as that person (`hafiz`, `ali`, `saeed`, `omar`, `yousef`, `ahmed`, `sara`, `mohammed`, `faisal`, `noura`, `nasser`) and prints only the path of a Playwright storage-state file (default `.demo-sessions/<name>.json`, git-ignored), for example `browser.newContext({ storageState })`. It signs in at `WEB_URL` from `.env` (`http://127.0.0.1:3000` without one), and the cookies are for that host only. In a lane, that is `http://laneN.localhost:<port>`, so open the pages there, not on `127.0.0.1`. Node on Windows cannot resolve `*.localhost`, so the script connects to `127.0.0.1` itself and still sends the lane host. The password is read inside the script and never printed. Behind it, sign-in is `POST /api/v1/session` on the web origin with `{email, password}` (204 and the `rabaed_session` cookie). A Transition is `POST /api/v1/work-items/<id>/transitions` with `{transition, idempotencyKey, confirmed: true}` (`idempotencyKey` a UUID; without `confirmed: true` it is refused with `not_confirmed`). Column names for direct SQL are in `docs/data-model.md`.

**PR screenshots.** `pnpm screens /work-items/<id> --as hafiz` shoots each route full-page at 1366 and 1920 in English and Arabic, signed in the same way, into `.screens/<issue key>/` (git-ignored). `--setup <file>` runs API calls from inside the signed-in page first (its `{name}` results fill the routes; `api.as("<person>")` acts as someone else, `api.upload` fills a file field). The same file may `export const screens`, each a route with ordered actions run before its shot (click a role and name, check a row's checkbox, wait for a role; names given in English and Arabic), so dialogs and selections get shot too: see `scripts/screens-examples/`. For a flow those actions cannot reach (a wizard, an upload), `--steps <file>` drives the page itself and names each shot (`await shot("map-columns")`), once per language and width. `--publish` commits the shots to `screens-<branch>` on origin, never merged, and prints a markdown table of their raw URLs for the PR body; `--publish-dir <dir>` does the same for PNGs already on disk (`<page>-<width>-<locale>.png`), shooting nothing. `scripts/screens.ts` has the details.

**Project:** Riyadh Gate Tower – Phase 2 (`TWR`). Trades Electrical Works (`EL`), Mechanical Works (`ME`) and Civil Works (`CV`, covered by no Participant: it only carries a supplier); Locations Main Zone › Tower 1 (Floors 01–03) and Tower 2 (Floor 01).

| Company | Role on the Project | Covers | Person | Email |
|---|---|---|---|---|
| TMC Constructions | Contractor, Project Admin | Electrical, everywhere | Saeed Al Qahtani (Authorized Person) | `saeed.alqahtani@tmc.demo.rabaed.test` |
| | | | Hafiz Hamdan (Engineer) | `hafiz.hamdan@tmc.demo.rabaed.test` |
| | | | Ali Sonour (Project Manager, also holds Assign) | `ali.sonour@tmc.demo.rabaed.test` |
| | | Tower 2 only | Omar Al Harbi (Engineer) | `omar.alharbi@tmc.demo.rabaed.test` |
| Beta Build | Contractor | Electrical, everywhere (like TMC: only the Company boundary hides TMC's work) | Yousef Karim (Engineer, also holds Assign) | `yousef.karim@betabuild.demo.rabaed.test` |
| Design Consultants LLC | Consultant | Electrical and Mechanical | Ahmed bin Said (Engineer) | `ahmed.binsaid@designconsultants.demo.rabaed.test` |
| | | Mechanical only, at every Location | Sara (Engineer): Mechanical only | `sara@designconsultants.demo.rabaed.test` |
| | | | Mohammed Al Shamsi (Manager) | `mohammed.alshamsi@designconsultants.demo.rabaed.test` |
| Al Waha PMC | Owner Representative | Electrical, everywhere | Faisal Al Otaibi (Engineer, Arabic) | `faisal.alotaibi@alwaha.demo.rabaed.test` |
| | | | Noura Al Harbi (Project Manager, Arabic): holds the Owner's review | `noura.alharbi@alwaha.demo.rabaed.test` |

**Sara: Mechanical only** (RP-1207). Sara works one Trade: Design Consultants' Authorized Person narrowed her to Mechanical Works at every Location, so she sees none of the seed's items (all Electrical), they are not in her Step Pool, and Ahmed and Mohammed still cover both Trades. She sees nothing of another Company either way. Because of her, an Electrical Submittal that reaches the Consultant Engineer Step has a pool of one, Ahmed, who holds it at once with no Pick up; a Mechanical one has Ahmed and Sara in its pool.

**Ali and Yousef hold Assign** (RP-1186). No Rabaed Default Position holds Assign on Submittals, so the weekly Step Age report had no recipient. The seed adds a Contractor Position, **Step Age Report** (View and Assign on Submittals and nothing else), and gives it to Ali beside Project Manager and to Yousef beside Engineer. After `pnpm demo`, `pnpm uat:run-job weekly-report` queues a report for each of them. Positions are shared by every Project, so any Contractor's Authorized Person can give it too. The seed ages no item: every open Submittal shows no Step Age dots until `pnpm uat:age` moves it (below).

Each Company's Authorized Person (`<first>.<last>@<company>.demo.rabaed.test`) can sign in too, and the Rabaed Engineer is `engineer@rabaed.demo.rabaed.test`. The seed also leaves one Draft of Hafiz's, "Emergency lighting – Tower 2", which only TMC sees, filled through the MAR Form: two Items (36 + 12 pcs, a total of 48), its Datasheet (a PDF) and a Sample photo taken in Riyadh, whose time and place show under it.

**Two linked MARs** (Links, the MAR Form Version 3): "Exit signage – Tower 1" (`TWR-MAR-01-0001`), approved with Code A, and "Emergency lighting control panel – Tower 2" (`TWR-MAR-01-0002`), Submitted and waiting with Design Consultants LLC, which links the exit signs twice: under **Related submittals** in its Form and as a free Link in its Links section. Omar covers only Tower 2, so to him the exit signs are just their Document Number and Subject. A third, "Cable tray risers – Tower 1" (`TWR-MAR-01-0003`), ends Revise & Resubmit with Code C: Ahmed (Consultant Engineer) answered in his reply, **Send to Manager** (sample checked, not matching the specification, with a note in English and Arabic, and a Recommended Code C), which only Design Consultants reads, and Mohammed issued the Code with **Remarks** and the **final verification**, filled in from Ahmed's reply; both Companies now read the Code, its Remarks and its final verification, never Ahmed's reply (the Code A item has its final verification too, matching). Each seeded Submit carries a **Cover Note**, which the Consultant reads. Hafiz then created its **Rev 1** (the trays changed to hot dip galvanised, the Datasheet copied) and Ali Submitted it: `TWR-MAR-01-0003 Rev 1`, waiting with Design Consultants LLC. A Revision takes the original's number and uses no counter. The walkthrough's MARs come on top of these (its first one is `TWR-MAR-01-0004`), and the seed's MARs have already put a few notifications in Ali's and Mohammed's bells.

**The MAR Form (Version 6)**, the same in English and Arabic: Manufacturer, **Approved supplier** (required: chosen from the Project's Approved Supplier List for the MAR's Trade), Model, Specification section and Description; **Items**, a table of Fixture type, Description, Quantity and Unit, with the total quantity under it; **Datasheet (PDF)**, **Test certificate** and **Sample photo**; **Related submittals** (optional: pick earlier Submitted items by Document Number or Subject); then Trade, Location and Scopes. The Form is the Contractor's (ADR 0019): the Consultant answers in its replies, never in the Form. The Consultant Engineer's reply, **Send to Manager**, asks Sample checked, Matches specification and Verification note (required when it does not match), read only by the Consultant; the Manager's Code asks them again as the **final verification**, filled in from the Engineer's answers and shared with the Code. **The MAR Workflow (Version 3)**: Draft → Send for Review → Internal Review (Contractor PM); a Return goes to Internal Review (Contractor Engineer), never back to the Draft; Submit (with an optional **Cover Note**) → Pending Approval (Consultant Engineer, then Consultant Manager) → Approve · A, Approve with Comments · B, Revise & Resubmit · C or Reject · D. The Rabaed Defaults are documents in `apps/admin` (`workflows`, `forms`, `screens`) that the seed publishes with `pnpm defaults:publish`; Supplier Approval Requests (SAR) and Document Approval Requests (DAR) have Forms and Workflows of their own (MAR and SAR run 2→2, DAR runs 1→1 → Owner review), and the Inspections Module has the Work Inspection Request (WIR). The Consultant Engineer Step's pool is the Consultant's Engineers only, never its Manager: with one Engineer it is his at once; Design Consultants has two, Ahmed and Sara, but Sara covers Mechanical only, so an Electrical Step is Ahmed's at once, and a Mechanical one is picked up by Ahmed or Sara. Remarks are optional with Code A only, required with B, C and D. Manufacturer, Description, the Datasheet, Trade and Location are required to Send for Review. The Datasheet, Test certificate and Sample photo can be added once the Draft is saved; the Attachments and Links System Fields sit below the Form. A MAR started on Version 1 (a single Quantity, no Datasheet) Version 2 (no Related submittals), Version 3 (no Consultant verification) or Version 4 (the Consultant verification in the Form) keeps its Version, and one on MAR Workflow Version 2 keeps its route (a Return goes back to the Draft). The seed uploads the Datasheets and the photo through the local file store, so Docker must be up; the dev demo, whose seed has no reach to the files bucket, has no seeded files, and so no linked MARs either (each needs its Datasheet to leave Draft), and its walkthrough MAR is `TWR-MAR-01-0001`.

**Submittals: the three Types and the Approved Supplier List** (spec RP-598; the seed's files need the file store, so the dev demo has none of the items below). Project Settings → Approved Supplier List holds three fictional suppliers: two preloaded by TMC's Project Admin, **Al-Rimal Building Materials** (Civil Works) and **Najd Electrical Supplies** (Electrical Works), and **Tabuk Cable Industries** (Electrical), which joined the list by itself when its **SAR** (Supplier Approval Request, "Tabuk Cable Industries") was closed at Code A on the 2→2 Workflow: Hafiz raised it, Ali submitted it, Ahmed and Mohammed replied and approved. Every Participant reads the list, never the SAR behind a supplier. The MARs choose their **Approved supplier** from the list for their Trade: the Emergency lighting and Exit signage MARs choose Najd, and "Cable tray risers – Tower 1" chose Tabuk, the supplier the SAR added. A **DAR** (Document Approval Request, "Cable sizing calculation – Tower 1") ran 1→1 → Owner review: Hafiz raised it, Ali submitted it, Mohammed recommended Code A and Noura (Al Waha, the Owner Representative's Project Manager) Confirmed it, so it closed at A; sign in as `noura` to see the Owner's review step in its history, or raise another DAR and Confirm it yourself. New items start with a Type picker: MAR, SAR or DAR.

**The sample Project** (RP-1217): Al Nakheel District – Block A (`NKD`), TMC's, with the same Companies and people as Riyadh Gate Tower (not Omar, not Nasser) and a realistic volume of records, so the Lists, Kanban, Dashboard and Snag List look full. Trades `EL`, `ME`, `CV`; Locations Block A › Podium (Basement 1, Ground Floor, Level 01) and Tower A (Levels 02–06); every Participant covers all of it, Sara Mechanical only. Its Submittals, as TMC's List reads them: 12 in Internal Review (with Ali, back with Hafiz, and 4 Rev 1s), 50 Pending Approval (with Ahmed or Sara, some still in the pool, or with Mohammed), 26 approved at Code A or B, 10 Revise & Resubmit (Code C) and 5 Rejected (Code D); the Snag List has 20 Snags at every Stage, 6 Site Observations and the Code B Comments, some resolved and closed. Every Submittal carries its Datasheet or company profile, and half the Snags their photos. **Packages** (RP-1220), each Contractor numbering its own: TMC's group its Submittals as they stand (Lighting and power, Done; Chilled water and HVAC, In Progress with a Code C waiting for its Revision) plus Fire protection, Open with three Drafts; Beta Build, through Yousef (Engineer and Project Manager here), Submits its own with Submit Package (Facade glazing, In Progress; Precast stairs, Done) and keeps Basement waterproofing Open. **Inspections** (RP-1220): 19 WIRs on the current WIR Workflow, each picking its Trade's Checklist Template (Cable containment and wiring, Pipework installation, Concrete pour), at every Stage from Draft to a Review Code (ADR 0025), with two Code C items re-inspected as their Rev 1 (one still with the Consultant Engineer, one passed at Code A), a Rejected one, and two of Beta Build's. `pnpm demo` seeds it. `pnpm demo:add-sample-project` adds it to a database that has the demo but not it, without a reset, and then spreads its open items' Step Age over 1 to 4+ weeks (`scripts/sample-project-age.ts`); running it again changes nothing. The plan is `apps/api/src/demo/sample-project-plan.ts`.

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
| 6 | Ali | Submit, writing the **Cover Note** "Panels for Level 2, as drawing E-201" and an Internal Note "Quantities checked against the BOQ" | Pending Approval. TMC sees "With Design Consultants LLC", never a Consultant's name. Sara covers Mechanical only and this MAR is Electrical, so she sees nothing of it and Ahmed, its only Consultant Engineer, holds it at once ("With Ahmed bin Said · Design Consultants LLC", no Pick up); Mohammed, the Manager, sees it read-only until Ahmed sends it to him. Faisal (Al Waha) sees it as oversight, read-only. Yousef (Beta Build) still sees nothing. The Consultant's and Al Waha's history shows the Submit with its Cover Note, by TMC Constructions (no person named), never the Internal Note or the Return. |
| 7 | Ahmed | Open it (it is his at once) → read the Form (Manufacturer, Model, Specification section, Description, the Items and their total, Trade, Location) and open the PDF under Datasheet (PDF) | The Consultant reads every answer and the corrected Datasheet, none of them editable, each Document frozen; a Sample photo shows its time and place. Yousef (Beta Build) still gets nothing. |
| 8 | Ahmed, Mohammed | Ahmed: **Send to Manager**, answering in its pop-up Sample checked Yes, Matches specification Yes, Recommended Code A and an Internal Note (a Send to Manager is refused until the verification is answered). Mohammed (the Consultant's only Manager, so it is his at once): Approve · A: its **Final verification** is already filled in from Ahmed's answers → confirm | Ahmed's answers, his Recommended Code and his Internal Note are in Design Consultants' history only, marked internal; TMC and Al Waha see no change. Then Approved, Code A: TMC and Al Waha see the Code, its final verification and that Mohammed Al Shamsi issued it; nobody else of the Consultant is named to them, and Ahmed's reply never reaches them. The item accepts no more moves. |
| 9 | Hafiz, Ali, Ahmed, Mohammed | Repeat with "Cable tray layout – Level 2" (its Form complete and a PDF under Datasheet (PDF) before Send for Review); Ahmed answers Matches specification No with the note "Wrong datasheet revision" and recommends C; Mohammed ends with Revise & Resubmit · C, writing Remarks (required for Code C) | Revise & Resubmit, Code C. |
| 10 | Hafiz | Open "Emergency lighting control panel – Tower 2" → Links: the exit signs (`TWR-MAR-01-0001`) under Related submittals and again as a free Link → open it; scroll to Linked from | Each Link shows the Document Number (left to right, in Arabic too) and Subject, and opens the item; nothing can be changed, as it is Submitted. The exit signs' Linked from lists the control panel. Ahmed sees the same. Yousef (Beta Build) sees neither MAR. |
| 11 | Omar | Open "Emergency lighting control panel – Tower 2" → Links → open `TWR-MAR-01-0001` | Omar covers Tower 2 only: both Links show only the number and Subject "Exit signage – Tower 1". Opening one goes to that Link's own page ("Linked item", at `/work-items/<control panel>/links/<Link>`): the number, the Subject and only "You are not allowed to see the details of this item.", with "Back to the item it is linked from". The exit signs aren't in his list, and their own address is "not found" to him. |
| 12 | Hafiz, Ali | New Submittal → Material Approval Request "Lighting control wiring – Tower 1", Tower 1 Floor 02, Form complete as in step 3; in Related submittals, type "control panel" → pick `TWR-MAR-01-0002` → Save Draft; on the saved Draft, under Links, Find an item to link: "Lighting Fixtures" → pick it; add the Datasheet → Send for Review; Ali Submits | Link search offers only Submitted items Hafiz can see in this Project: no Drafts, nothing still in a Company's internal review, nothing of Beta Build. While it is in TMC's review, nobody sees it under the control panel's Linked from; once Submitted, Hafiz sees it there as a link, and Omar (who can't see Tower 1) sees only its number and Subject. |
| 13 | Hafiz, Ali, Ahmed, Mohammed | The Consultant's replies on a new MAR "Lighting control – Tower 2" (Form complete, a PDF under Datasheet (PDF)): Hafiz sends it and Ali Submits it. It is Ahmed's at once (Sara covers Mechanical only, so he is the only Engineer of an Electrical item, and Mohammed is never in that pool) → Send to Manager: Sample checked Yes, Matches specification No (so the Verification note becomes required: "Lamp efficacy is below the specified 110 lm/W"), Recommended Code C. Mohammed → **Return to Engineer**, reason "Check the photometric report"; Ahmed has it again and Sends it to the Manager unchanged. Mohammed tries Revise & Resubmit · C: refused until the Remarks are written. He writes them and issues Code C, the final verification as filled in from Ahmed's reply | Until the Code, TMC and Al Waha see no change at all: no reply, no Return to Engineer, no Recommended Code. After it, both read the Code, its Remarks and its final verification, and never Ahmed's answers, his Recommended Code or an Internal Note. |
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

**UAT tool** (RP-922). Step Age takes weeks to show and the digest and weekly report wait for 07:00 Riyadh, so two commands bring them forward. They change data only on this worktree's lane database, with mail landing in the lane's Mailpit, and refuse anything else (`scripts/uat-guard.ts`). `pnpm uat:age --item <Document Number or exact Subject> --weeks <1-52> [--dry-run]` moves an open item back so it reads Step Age N to its holder; every time of the item moves by the same amount and its history is never changed. `pnpm uat:run-job digest|weekly-report [--member <email>] [--dry-run]` runs the job now, sending through the worker's own handlers on the worker's connection, without claiming the scheduled run. `--lane <n>` picks another lane. Vercel UAT's database is reached only from its GitHub job, never from a machine: Actions > Age UAT items (`.github/workflows/age-uat.yml`, on main, environment `uat`) runs the same two commands there, a dry run unless unticked, with mail through UAT's SendGrid.

## Layout

| Package | What it holds |
|---|---|
| `apps/web` | Next.js, React, Tailwind + shadcn/ui, next-intl (English and Arabic, RTL, Latin digits). UI strings live in `apps/web/messages/*.json` as translation keys. |
| `apps/api` | Fastify with zod validation. |
| `apps/worker` | Outbox processor (in-app notifications, from RP-195; immediate notification emails, RP-357, linking to `WEB_URL`). |
| `packages/domain` | Shared rules and types, no I/O. |
| `packages/mailer` | Email: `send({ to, template, locale, values })`, with the templates in English and Arabic (RTL, Latin digits). SendGrid on Vercel (`SENDGRID_API_KEY`, tracking off, ADR 0026); locally and in CI, Mailpit (`MAIL_CATCHER_URL`). Its SES transport stays until the production decision (RP-1230). |
| `packages/db` | Kysely, the migration runner, role bootstrap and `withMember`. Migrations are plain SQL in `packages/db/migrations`, named `YYYYMMDDHHMMSS_what.sql`. |

## Where it runs

Dev, demo and UAT run on Vercel ([ADR 0026](docs/adr/0026-dev-and-uat-run-on-vercel.md)): web, the api and Rabaed Admin as three Vercel projects, the database on Supabase (plain PostgreSQL 16), files and the Thmanyah fonts on Cloudflare R2, email through SendGrid, and the Documental Records on the worker's image in an always-on container (the Records container). `.github/workflows/deploy-uat.yml` deploys every merge to `main`; `docs/tech-stack.md` has the details. The AWS account is closed and its CDK code removed ([ADR 0029](docs/adr/0029-the-aws-account-is-closed.md)). Where production runs is not decided yet.

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

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit, web build, seam 1 and seam 2 against Postgres 16, and the mailer against Mailpit, on each pull request (once per push to its branch), on every push to `main` and in the merge queue; `secret-scan.yml` runs gitleaks (default rules plus `.gitleaks.toml`), `scripts/check-no-fonts.ts` and `scripts/check-secrets.ts` (the pre-commit hook's token check, so a skipped hook is still caught; RP-1100) over a pull request's own commits, a queue entry's, or `main`'s history, so a finding on one branch fails only that branch's checks, and nightly over every branch (not a required check: a red run means a secret on a public branch, to rotate, not just delete; RP-678); `dependency-audit.yml` (the required check `pnpm audit`) runs `pnpm audit` over every package, dev dependencies included, and fails on an advisory at high or above that `.audit-allowlist.json` does not list with a reason and a review date (`scripts/dependency-audit.ts`; RP-1023, RP-1032, RP-1070): it audits a pull request or queue entry only when it changes the lockfile, a package.json or another audit input (`scripts/dependency-audit-needed.ts`), and always nightly on `main`; `deploy-uat.yml` deploys each merge to `main` to UAT on Vercel (migrate, api and Admin, their smoke, web, its smoke), `reset-uat.yml` seeds UAT's demo again by hand (ADR 0026), and `age-uat.yml` runs the UAT tool on UAT's database by hand (RP-922). For a failure to block merging, `main`'s branch protection must list these jobs as required status checks.

## Secrets

The repo is public. Commit only `.env.example`; real values come from the secrets manager.
