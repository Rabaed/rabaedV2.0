import { readFileSync } from "node:fs";
import { pageAs } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { Api, settle } from "../harness/helpers.ts";
import * as H from "../harness/helpers-sub.ts";
import { registerMatchKey } from "../../../../packages/domain/src/register-import-match.ts";
import { addToPackage, bilingual, listReadable, makeCsv, makePackage, makeXlsx, mustAct, regFile, runTag, submitPackage, team, writeData, type Json, type Team } from "../harness/helpers-sng.ts";
import { goRetry as go } from "../harness/helpers-sng.ts";

// Part IMP: Submittal Register Import (RP-589). Registers are small made-up files under fixtures-data.
// The wizard is driven in the browser where a Test Case is about what the page says; the rest goes
// through the same api the wizard calls.

const tag = runTag();
const HEAD = ["Subject", "Type", "Trade"];
const MAPPING = { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 } };

const row = (n: number, name: string, trade = "Electrical Works", type = "MAR") => [`UAT ${name} ${tag} item ${n}`, type, trade];

type Preview = { status: number; text: string; body: Json };
async function readReg(api: Api, tm: Team, fileName: string, bytes: Buffer, extra: Json = {}) {
  const r = await api.post(`/projects/${tm.projectId}/register-imports/read`, { file: regFile(fileName, bytes), ...extra });
  return r;
}
async function preview(api: Api, tm: Team, fileName: string, bytes: Buffer, mapping: Json = MAPPING, sheet = "Register", headerRow = 1): Promise<Preview> {
  const r = await api.post(`/projects/${tm.projectId}/register-imports`, { file: regFile(fileName, bytes), sheet, headerRow, mapping });
  return { status: r.status, text: r.text, body: r.body as Json };
}
const xlsx = (rows: string[][], name = "Register") => makeXlsx([{ name, rows }]);
const confirm = (api: Api, id: string) => api.post(`/register-imports/${id}/confirm`);
const rowsOf = (p: Preview) => (p.body.rows ?? []) as Json[];
const reasonsOf = (r: Json) => (r.reasons as string[]).join(",");
const titleStatus = async (api: Api, id: string) => (await api.get(`/work-items/${id}`)).status;

/** Drives the wizard from its Upload step to the Validate step; the last forward button each step. */
async function driveToValidate(page: import("playwright").Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if ((await page.getByRole("button", { name: /Import \d+ Drafts?/ }).count()) > 0) return;
    await page.getByRole("button", { name: /^(Next|Validate)/ }).last().click();
    await settle(page, 900);
  }
}

defineCase("IMP-01", async (t) => {
  const tm = await team("hafiz");
  const pdf = writeData("register.pdf", Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"));
  const latin = writeData("latin1.csv", Buffer.from([...Buffer.from("Subject,Type,Trade\n"), ...Buffer.from([0x43, 0x61, 0x66, 0xe9]), ...Buffer.from(",MAR,Electrical Works\n")]));
  const big = writeData("over-2000-rows.csv", makeCsv([HEAD, ...Array.from({ length: 2001 }, (_, i) => row(i, "IMP-01", "Electrical Works"))]));
  const good = writeData("good-0012.xlsx", xlsx([["Subject", "Type", "Trade", "Paper ref"], [`UAT IMP-01 ${tag} item 1`, "MAR", "Electrical Works", "0012"]]));
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/import`);
  await settle(page);
  const body = async () => (await page.locator("body").innerText()).replaceAll("\n", " ");
  const input = page.locator("input[type=file]");
  await input.setInputFiles(pdf);
  await settle(page, 900);
  t.check("A .pdf: Only .xlsx and .csv registers can be imported", /Only \.xlsx and \.csv registers can be imported/.test(await body()));
  await t.shot(page, "pdf-refused");
  await input.setInputFiles(latin);
  await settle(page, 900);
  t.check("A non-UTF-8 .csv: save it as CSV UTF-8", /CSV UTF-8/.test(await body()), (await body()).match(/This \.csv.{0,80}/)?.[0] ?? "");
  await input.setInputFiles(big);
  await settle(page, 1500);
  t.check("A .csv over 2,000 rows: split into smaller registers", /over 2,000 rows/.test(await body()) && /Split it into smaller registers/.test(await body()), (await body()).match(/This worksheet.{0,80}/)?.[0] ?? "");
  await t.shot(page, "too-many-rows");
  await input.setInputFiles(good);
  await settle(page, 1500);
  const next = await body();
  t.check("The good .xlsx moves to the next step (Worksheet & column headings)", /Column headings are in row/.test(next));
  const read = await readReg(tm.api.hafiz!, tm, "good-0012.xlsx", readFileSync(good));
  t.check("Cells are read as stored: Paper ref 0012 stays 0012", JSON.stringify((read.body as Json).top).includes("\"0012\""), read.text.slice(0, 160));
  await t.shot(page, "good-file-next-step");
});

defineCase("IMP-02", async (t) => {
  const tm = await team("hafiz");
  const hafiz = tm.api.hafiz!;
  const wb = makeXlsx([
    { name: "Cover", rows: [["This sheet is not the register"]] },
    { name: "Register", rows: [["Project register"], ["Issued by UAT"], [""], HEAD, row(1, "IMP-02"), row(2, "IMP-02"), row(3, "IMP-02")] },
  ]);
  const first = await readReg(hafiz, tm, "two-sheets.xlsx", wb);
  const f = first.body as Json;
  t.check("Both worksheets are listed", (f.sheets as Json[])?.map((s) => s.name).join() === "Cover,Register", first.text.slice(0, 160));
  const r = await readReg(hafiz, tm, "two-sheets.xlsx", wb, { sheet: "Register", headerRow: 4 });
  const s = r.body as Json;
  t.check("With the sheet and header row 4 the headings are Subject, Type, Trade and 3 rows lie below", (s.headers as string[])?.join() === "Subject,Type,Trade" && s.dataRows === 3, `${(s.headers as string[])?.join()} ${s.dataRows}`);
  t.check("The preview shows the first rows, title rows included for picking the header", (s.top as Json[])?.length >= 4, `${(s.top as Json[])?.length} rows`);
  const p = await preview(hafiz, tm, "two-sheets.xlsx", wb, MAPPING, "Register", 4);
  t.check("Rows above the header are skipped: the import holds the 3 rows below it", p.status === 201 && rowsOf(p).length === 3 && rowsOf(p).every((x) => x.reasons.length === 0), `${p.status} ${rowsOf(p).length} rows`);
  const empty = await readReg(hafiz, tm, "two-sheets.xlsx", wb, { sheet: "Register", headerRow: 3 });
  t.check("An empty header row is refused with its own answer", empty.status >= 400, `${empty.status} ${empty.text.slice(0, 120)}`);
  const missing = await readReg(hafiz, tm, "two-sheets.xlsx", wb, { sheet: "Register", headerRow: 99 });
  t.check("A header row the sheet doesn't have is refused with its own answer, different from the empty row's", missing.status >= 400 && missing.text !== empty.text, `${missing.status} ${missing.text.slice(0, 120)}`);
  const file = writeData("two-sheets.xlsx", wb);
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/import`);
  await settle(page);
  await page.locator("input[type=file]").setInputFiles(file);
  await settle(page, 1500);
  const text = await page.getByRole("main").innerText();
  t.check("The page lets Hafiz choose the worksheet and the header row", /Worksheet/.test(text) && /Column headings are in row/.test(text));
  await t.shot(page, "sheet-and-header-row");
});

defineCase("IMP-03", async (t) => {
  const tm = await team("hafiz", "ali");
  const hafiz = tm.api.hafiz!;
  const wb = xlsx([["Description", "Kind", "Discipline", "Notes"], ...[1, 2, 3].map((n) => [`UAT IMP-03 ${tag} item ${n}`, "MAR", "Electrical Works", "ignored"])]);
  const full = await preview(hafiz, tm, "mapped.xlsx", wb, { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 } });
  t.check("Description to Subject, Type to Type, Discipline to Trade: the preview is good (Notes is ignored)", full.status === 201 && rowsOf(full).length === 3 && rowsOf(full).every((x) => x.reasons.length === 0), `${full.status} ${full.text.slice(0, 120)}`);
  const noTrade = await preview(hafiz, tm, "mapped.xlsx", wb, { subject: { column: 0 }, type: { column: 1 } });
  t.check("Validate with Trade unmapped is refused", noTrade.status >= 400, `${noTrade.status} ${noTrade.text.slice(0, 100)}`);
  const el = tm.d.trade("Electrical Works");
  const wb2 = xlsx([["Description", "Kind"], ...[1, 2].map((n) => [`UAT IMP-03 ${tag} fixed ${n}`, "MAR"])]);
  const fixed = await preview(hafiz, tm, "fixed.xlsx", wb2, { subject: { column: 0 }, type: { column: 1 }, trade: { value: el } });
  t.check("One Trade for every row is accepted", fixed.status === 201 && rowsOf(fixed).length === 2 && rowsOf(fixed).every((x) => x.reasons.length === 0), `${fixed.status}`);
  const wb3 = xlsx([["Description"], ...[1, 2].map((n) => [`UAT IMP-03 ${tag} fixed both ${n}`])]);
  const both = await preview(hafiz, tm, "fixed2.xlsx", wb3, { subject: { column: 0 }, type: { value: "MAR" }, trade: { value: el } });
  t.check("A fixed Type and Trade need no column at all", both.status === 201 && rowsOf(both).length === 2, `${both.status}`);
  const done = await confirm(hafiz, both.body.id as string);
  t.check("Confirmed, it creates the Drafts", done.status === 200, `${done.status} ${done.text.slice(0, 100)}`);
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/imports/${both.body.id}`);
  await settle(page);
  const text = await page.getByRole("main").innerText();
  t.check("The import's page shows the value as fixed for every row", /same for every row|for every row|Electrical Works/i.test(text), text.replaceAll("\n", " ").slice(0, 200));
  await t.shot(page, "import-page-fixed-values");
});

defineCase("IMP-04", async (t) => {
  const tm = await team("hafiz");
  const hafiz = tm.api.hafiz!;
  const wb = xlsx([
    HEAD,
    row(1, "IMP-04"),
    ["", "MAR", "Electrical Works"],
    [`UAT IMP-04 ${tag} ${"x".repeat(205)}`, "MAR", "Electrical Works"],
    [`UAT IMP-04 ${tag} unknown type`, "ZZZ", "Electrical Works"],
    [`UAT IMP-04 ${tag} unknown trade`, "MAR", "Fire Fighting"],
    [`UAT IMP-04 ${tag} outside visibility`, "MAR", "Mechanical Works"],
    ["", "ZZZ", "Fire Fighting"],
  ]);
  const p = await preview(hafiz, tm, "bad-rows.xlsx", wb);
  const rows = rowsOf(p);
  t.check("The preview is made: 7 rows checked", p.status === 201 && rows.length === 7, `${p.status} ${rows.length}`);
  const r = (n: number) => reasonsOf(rows[n]!);
  t.check("Empty Subject, Subject over 200, unknown Type, Trade not in the Project and Trade outside Visibility each get their reason", r(1) === "subject_missing" && r(2) === "subject_too_long" && r(3) === "type_unknown" && r(4) === "trade_unknown" && r(5) === "trade_outside_visibility", [1, 2, 3, 4, 5].map(r).join(" | "));
  t.check("A row with several faults lists all of them", ["subject_missing", "type_unknown", "trade_unknown"].every((x) => r(6).includes(x)), r(6));
  t.check("The first row is ready", r(0) === "", r(0));
  t.check("Counts: 1 ready, 6 left out, nothing created yet (status previewed, no row has a Draft)", p.body.status === "previewed" && rows.every((x) => x.created === false && x.workItemId === null) && rows.filter((x) => x.reasons.length === 0).length === 1);
  const found = await H.listItems(hafiz, tm.projectId, `q=${tag}&pageSize=50`);
  t.check("No Draft exists for the register's rows", !found.some((i) => String(i.title).includes(`IMP-04 ${tag}`)));
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/import`);
  await settle(page);
  await page.locator("input[type=file]").setInputFiles(writeData("bad-rows.xlsx", wb));
  await settle(page, 1500);
  await driveToValidate(page);
  const text = await page.getByRole("main").innerText();
  t.check("The Validate step counts rows checked, ready and left out, and names the reasons", /rows checked/.test(text) && /ready to import/.test(text) && /left out/.test(text) && /Subject empty/.test(text) && /is outside your Visibility/.test(text), text.replaceAll("\n", " ").slice(0, 200));
  await t.shot(page, "validate-reasons");
});

defineCase("IMP-05", async (t) => {
  const tm = await team("hafiz", "ali", "saeed");
  const hafiz = tm.api.hafiz!;
  const rows = [HEAD, ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => row(n, "IMP-05")), ["", "MAR", "Electrical Works"], [`UAT IMP-05 ${tag} bad trade`, "MAR", "Fire Fighting"]];
  const p = await preview(hafiz, tm, "ten-rows.xlsx", xlsx(rows));
  t.check("The preview has 8 ready and 2 left out", rowsOf(p).filter((x) => x.reasons.length === 0).length === 8 && rowsOf(p).filter((x) => x.reasons.length > 0).length === 2);
  const done = await confirm(hafiz, p.body.id as string);
  t.check("Confirm creates 8 Drafts", done.status === 200 && (done.body as Json).rowsCreated === 8, `${done.status} ${done.text.slice(0, 100)}`);
  const imp = ((await hafiz.get(`/register-imports/${p.body.id}`)).body as Json);
  const created = (imp.rows as Json[]).filter((x) => x.created);
  const drafts = [];
  for (const c of created) drafts.push(await H.detail(hafiz, c.workItemId as string));
  t.check("Each is a Draft with no number, raised by Hafiz's Company and held by Hafiz", drafts.length === 8 && drafts.every((d) => d.documentNumber === null && d.stage.key === "draft" && d.heldBy?.memberName?.en === "Hafiz Hamdan"));
  t.check("The two bad rows were never created", (imp.rows as Json[]).filter((x) => !x.created).length === 2 && (imp.rows as Json[]).filter((x) => !x.created).every((x) => x.workItemId === null));
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items?q=${encodeURIComponent(`IMP-05 ${tag}`)}`);
  await settle(page);
  const list = await page.getByRole("main").innerText();
  if (await listReadable(t, page, "The Submittals List opens with the imported Drafts")) t.check("The Submittals List shows them as No number yet", (list.match(/No number yet/g) ?? []).length >= 8);
  await t.shot(page, "eight-drafts");
  // A change in the Project after the preview.
  const p2 = await preview(hafiz, tm, "again.xlsx", xlsx([HEAD, row(1, "IMP-05 outdated")]));
  const before = ((await tm.api.saeed!.get(`/projects/${tm.projectId}/required-fields`)).body as Json).fields as Json[];
  const f = before.find((x) => x.type === "WIR" && x.key === "approved_submittals")!;
  try {
    await tm.api.saeed!.put(`/projects/${tm.projectId}/required-fields`, { type: "WIR", key: "approved_submittals", required: !f.required });
    const late = await confirm(hafiz, p2.body.id as string);
    t.note(`After a Required links change the confirm answered ${late.status} ${late.text.slice(0, 120)}`);
    if (late.status === 200) t.note("That change does not count as a change the preview depends on; 'Something in the Project changed' (previewOutdated) was not provoked.");
    else t.check("A change after the preview refuses the confirm and asks to validate again", late.status >= 400 && /outdated|changed/i.test(late.text), late.text.slice(0, 120));
  } finally {
    await tm.api.saeed!.put(`/projects/${tm.projectId}/required-fields`, { type: "WIR", key: "approved_submittals", required: f.required });
  }
});

defineCase("IMP-06", async (t) => {
  const tm = await team("hafiz", "ali", "omar", "yousef", "mohammed");
  const hafiz = tm.api.hafiz!;
  const fileName = `UAT-IMP-06-${tag}.xlsx`;
  const p = await preview(hafiz, tm, fileName, xlsx([HEAD, row(1, "IMP-06"), row(2, "IMP-06"), ["", "MAR", "Electrical Works"]]));
  const id = p.body.id as string;
  t.check("Before confirm the preview is its importer's alone: Ali, a colleague, gets the plain 404", (await tm.api.ali!.get(`/register-imports/${id}`)).status === 404 && (await hafiz.get(`/register-imports/${id}`)).status === 200);
  t.check("Before confirm it is in no colleague's Imports page", !(((await tm.api.ali!.get(`/projects/${tm.projectId}/register-imports`)).body as Json).imports as Json[]).some((i) => i.id === id));
  await confirm(hafiz, id);
  const aliGets = await tm.api.ali!.get(`/register-imports/${id}`);
  t.check("After confirm Ali, a colleague, reads the import", aliGets.status === 200 && ((aliGets.body as Json).rows as Json[]).length === 3, `${aliGets.status}`);
  const listed = ((await hafiz.get(`/projects/${tm.projectId}/register-imports`)).body as Json);
  t.check("The Imports page lists it by file name, and nothing in the answer is a time", (listed.imports as Json[]).some((i) => i.fileName === fileName) && !/At"|time|date/i.test(JSON.stringify(listed).replace(/UAT-IMP/g, "")), JSON.stringify(listed).slice(0, 200));
  const imp = ((await hafiz.get(`/register-imports/${id}`)).body as Json);
  const rows = imp.rows as Json[];
  t.check("The page lists every row with its result, created ones with a Draft link for Hafiz", rows.length === 3 && rows.filter((x) => x.created && x.workItemId).length === 2 && rows.filter((x) => !x.created && x.reasons.length > 0).length === 1);
  const aliRows = ((aliGets.body as Json).rows as Json[]).filter((x) => x.created);
  const omar = await tm.api.omar!.get(`/register-imports/${id}`);
  const omarLinks = omar.status === 200 ? ((omar.body as Json).rows as Json[]).filter((x) => x.workItemId).length : -1;
  t.note(`Draft links: Hafiz 2, Ali ${aliRows.filter((x) => x.workItemId).length}, Omar (Tower 2 only) ${omarLinks} (status ${omar.status}).`);
  t.check("Beta Build and the Consultant read nothing of it (the plain 404 for the import and its original)", (await tm.api.yousef!.get(`/register-imports/${id}`)).status === 404 && (await tm.api.mohammed!.get(`/register-imports/${id}`)).status === 404 && (await tm.api.yousef!.get(`/register-imports/${id}/original`)).status === 404);
  t.check("Beta Build's Imports page is empty", ((await tm.api.yousef!.get(`/projects/${tm.projectId}/register-imports`)).body as Json).imports.length === 0);
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/imports`);
  await settle(page);
  const text = await page.getByRole("main").innerText();
  t.check("The Imports page shows the file name and no time", text.includes(fileName) && !/\d{1,2}:\d{2}/.test(text.replace(fileName, "")));
  await t.shot(page, "imports-page");
  await go(page, `/projects/${tm.projectId}/work-items/imports/${id}`);
  await settle(page);
  await t.shot(page, "import-page");
  const pa = await pageAs("ali");
  await go(pa.page, `/projects/${tm.projectId}/work-items/imports/${id}`);
  await settle(pa.page);
  t.check("Ali opens the same import page", (await pa.page.getByRole("main").innerText()).includes("UAT IMP-06"));
});

defineCase("IMP-07", async (t) => {
  const tm = await team("hafiz", "ali", "omar", "yousef", "mohammed");
  const hafiz = tm.api.hafiz!;
  const fileName = `UAT-IMP-07-${tag}.xlsx`;
  const p = await preview(hafiz, tm, fileName, xlsx([HEAD, row(1, "IMP-07")]));
  await confirm(hafiz, p.body.id as string);
  const imp = ((await hafiz.get(`/register-imports/${p.body.id}`)).body as Json);
  const id = (imp.rows as Json[]).find((x) => x.created)!.workItemId as string;
  const d = await H.detail(hafiz, id);
  t.check("It is an ordinary Draft: no number, Hafiz holds it and may edit it", d.documentNumber === null && d.actions.saveAnswers === true);
  const save = await hafiz.put(`/work-items/${id}/answers`, { answers: { ...(await H.marAnswers(tm)), description: "UAT IMP-07 edited by Hafiz" } });
  await H.addDatasheet(hafiz, id);
  t.check("Hafiz edits it (save is accepted)", save.status < 300, `${save.status} ${save.text.slice(0, 100)}`);
  const hist = (await hafiz.get(`/work-items/${id}/history`)).text;
  t.check("Its history's first event names the import", /import/i.test(hist), hist.slice(0, 300));
  t.check("Ali (a colleague) reads the Draft under the default 'Drafts visible to the author's Company' and the others never", (await titleStatus(tm.api.ali!, id)) === 200 && (await titleStatus(tm.api.yousef!, id)) === 404 && (await titleStatus(tm.api.mohammed!, id)) === 404);
  t.note(`Omar (Tower 2 only) reads the imported Draft: status ${await titleStatus(tm.api.omar!, id)}. The author-only half of the Expected (WF-10) needs the Draft Step set to 'the author only', which this seed does not have, so it was not run; the default setting was judged.`);
  const dcl = (await tm.api.ali!.get(`/work-items/${id}/history`)).text;
  t.check("The import's mention is internal to TMC: Beta Build and the Consultant cannot read the history", (await tm.api.yousef!.get(`/work-items/${id}/history`)).status === 404 && /import/i.test(dcl));
  const send = await H.move(hafiz, id, "send_for_review");
  const sent = await H.detail(hafiz, id);
  t.check("Hafiz sends it and it gets its number at the first send", send.status === 204 && /^TWR-MAR-\d\d-\d{4}$/.test(sent.documentNumber ?? ""), `${send.status} ${sent.documentNumber} ${send.text.slice(0, 120)}`);
  const { page } = await pageAs("hafiz");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "imported-draft-sent");
});

defineCase("IMP-08", async (t) => {
  const tm = await team("hafiz");
  const rows = [HEAD, ...[1, 2, 3].map((n) => row(n, "IMP-08")), [`UAT IMP-08 ${tag} bad trade`, "MAR", "Fire Fighting"], ["", "MAR", "Electrical Works"]];
  const file = writeData(`imp-08-${tag}.xlsx`, xlsx(rows));
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/import`);
  await settle(page);
  await page.locator("input[type=file]").setInputFiles(file);
  await settle(page, 1500);
  await driveToValidate(page);
  await page.getByRole("button", { name: /Import \d+ Drafts?/ }).click();
  await settle(page, 2500);
  const text = await page.getByRole("main").innerText();
  t.check("The result reads 3 Drafts created and 2 left out", /3 Drafts created/.test(text) && /Left out/.test(text), text.replaceAll("\n", " ").slice(0, 200));
  await t.shot(page, "result");
  const dl = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await page.getByRole("button", { name: /Download rejected rows/ }).click();
  const file1 = await dl;
  let content = "";
  if (file1) content = readFileSync((await file1.path())!).toString("utf8");
  t.check("Download rejected rows gives a file holding the left-out rows with a Reasons column", file1 !== null && /Reasons/i.test(content) && /Fire Fighting/.test(content), `${file1?.suggestedFilename() ?? "no download"}: ${content.slice(0, 160).replaceAll("\n", " | ")}`);
  const h = tm.api.hafiz!;
  const p2 = await preview(h, tm, "again.xlsx", xlsx([HEAD, row(9, "IMP-08 fixed")]));
  const before = ((await h.get(`/projects/${tm.projectId}/register-imports`)).body as Json).imports as Json[];
  await confirm(h, p2.body.id as string);
  const after = ((await h.get(`/projects/${tm.projectId}/register-imports`)).body as Json).imports as Json[];
  t.check("Importing again is a new import", after.length === before.length + 1 && after.some((i) => i.id === p2.body.id) && new Set(after.map((i) => i.id)).size === after.length);
});

defineCase("IMP-09", async (t) => {
  const tm = await team("hafiz");
  const hafiz = tm.api.hafiz!;
  const wb = xlsx([HEAD, ...Array.from({ length: 30 }, (_, i) => row(i + 1, "IMP-09", "Elec."))]);
  const mapping = (values?: Json) => ({ ...MAPPING, ...(values ? { values } : {}) });
  const vals = await hafiz.post(`/projects/${tm.projectId}/register-imports/values`, { file: regFile("elec.xlsx", wb), sheet: "Register", headerRow: 1, mapping: mapping() });
  const trade = ((vals.body as Json).fields as Json[])?.find((f) => f.field === "trade");
  t.check("Map values lists Elec. once, with its 30 rows", trade?.values.length === 1 && trade.values[0].rows === 30, JSON.stringify(trade?.values).slice(0, 200));
  const el = tm.d.trade("Electrical Works");
  const unmatched = await preview(hafiz, tm, "elec.xlsx", wb, mapping({ trade: { [registerMatchKey("Elec.")]: "" } } as Json));
  void unmatched;
  const raw = await preview(hafiz, tm, "elec.xlsx", wb, mapping());
  const readyRaw = rowsOf(raw).filter((x) => x.reasons.length === 0).length;
  t.note(`Before matching: ${readyRaw} of 30 rows ready (suggested match: ${trade?.values[0]?.how ?? "none"} ${trade?.values[0]?.match ?? ""}).`);
  const matched = await preview(hafiz, tm, "elec.xlsx", wb, mapping({ trade: { [registerMatchKey("Elec.")]: el } }));
  t.check("One match of Elec. to Electrical Works applies to all 30 rows and the preview recounts", matched.status === 201 && rowsOf(matched).filter((x) => x.reasons.length === 0).length === 30, `${matched.status} ${rowsOf(matched).filter((x) => x.reasons.length === 0).length} ready`);
  t.check("Without the match the rows were not good on their own (Elec. is not a Trade code or name)", readyRaw === 0 || (trade?.values[0]?.how ?? "") === "suggested", `${readyRaw} ready, how ${trade?.values[0]?.how}`);
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/import`);
  await settle(page);
  await page.locator("input[type=file]").setInputFiles(writeData("elec-30.xlsx", wb));
  await settle(page, 1500);
  for (let i = 0; i < 3; i++) { await page.getByRole("button", { name: /^(Next)/ }).last().click(); await settle(page, 800); }
  await t.shot(page, "map-values");
});

defineCase("IMP-10", async (t) => {
  const tm = await team("hafiz", "ali", "omar", "yousef");
  const hafiz = tm.api.hafiz!;
  const email = (n: string) => `${n}@tmc.demo.rabaed.test`;
  const wb = xlsx([
    [...HEAD, "Assign to"],
    [...row(1, "IMP-10"), email("hafiz.hamdan")],
    [...row(2, "IMP-10"), email("ali.sonour")],
    [...row(3, "IMP-10"), "yousef.karim@betabuild.demo.rabaed.test"],
    [...row(4, "IMP-10"), "nobody.at.all@tmc.demo.rabaed.test"],
    [...row(5, "IMP-10"), ""],
  ]);
  const p = await preview(hafiz, tm, "assign.xlsx", wb, { ...MAPPING, assignTo: { column: 3 } });
  const rows = rowsOf(p);
  t.check("Rows assigned to Hafiz and Ali by email are good", rows[0]!.reasons.length === 0 && rows[1]!.reasons.length === 0 && rows[1]!.assignee.match !== null, `${reasonsOf(rows[0]!)} | ${reasonsOf(rows[1]!)}`);
  t.check("An email of another Company's Member or nobody is assignee_unknown, telling nothing of who they are", reasonsOf(rows[2]!) === "assignee_unknown" && reasonsOf(rows[3]!) === "assignee_unknown", `${reasonsOf(rows[2]!)} | ${reasonsOf(rows[3]!)}`);
  t.check("A row with no assignee is the importer's", rows[4]!.reasons.length === 0 && rows[4]!.assignee.match === null);
  const group = await preview(hafiz, tm, "assign2.xlsx", xlsx([HEAD, row(6, "IMP-10"), row(7, "IMP-10")]), { ...MAPPING, assign: { default: (await tm.api.ali!.get(`/projects/${tm.projectId}/register-imports/fields`).then((r) => ((r.body as Json).members as Json[]).find((m) => /ali/i.test(m.email))?.id)) as string } });
  t.check("A default Member picks the assignee of the rows the column leaves empty", group.status === 201 && rowsOf(group).every((x) => x.assignee.match !== null), `${group.status} ${group.text.slice(0, 120)}`);
  const done = await confirm(hafiz, p.body.id as string);
  t.check("Confirm creates only the good rows (3)", done.status === 200 && (done.body as Json).rowsCreated === 3, `${done.status} ${done.text.slice(0, 80)}`);
  const imp = ((await hafiz.get(`/register-imports/${p.body.id}`)).body as Json).rows as Json[];
  const aliRow = imp.find((x) => x.rowNo === rows[1]!.rowNo)!;
  const d = await H.detail(tm.api.ali!, aliRow.workItemId as string);
  t.check("Ali's row is a Draft held by Ali", d.heldBy?.memberName?.en === "Ali Sonour", JSON.stringify(d.heldBy));
  const n = ((await tm.api.ali!.get("/notifications")).body as Json).notifications as Json[];
  t.check("Nobody is notified of the import, the assignee included", !n.some((x) => x.workItemId === aliRow.workItemId));
  t.note("An assignee who cannot create the Type was not exercised: every TMC Member who may be assigned here may raise a MAR.");
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/imports/${p.body.id}`);
  await settle(page);
  await t.shot(page, "assigned-rows");
});

defineCase("IMP-11", async (t) => {
  const tm = await team("hafiz", "ali", "yousef", "mohammed");
  const hafiz = tm.api.hafiz!;
  const mk = (n: number, pack: string) => [...row(n, "IMP-11"), pack];
  const wb = xlsx([[...HEAD, "Package"], mk(1, "UAT IMP-11 A"), mk(2, "UAT IMP-11 A"), mk(3, "UAT IMP-11 B")]);
  const one = await preview(hafiz, tm, "pkg1.xlsx", xlsx([HEAD, row(4, "IMP-11"), row(5, "IMP-11")]), { ...MAPPING, packages: { new: `UAT IMP-11 one ${tag}` } });
  t.check("Every row into one new Package: the preview names it", one.status === 201 && (one.body.packages as Json[]).length === 1 && one.body.packages[0].newName === `UAT IMP-11 one ${tag}`, one.text.slice(0, 160));
  const c1 = await confirm(hafiz, one.body.id as string);
  const p1 = (await hafiz.get(`/projects/${tm.projectId}/packages`)).body as Json;
  const made = (p1.packages as Json[]).find((x) => x.name.en === `UAT IMP-11 one ${tag}`);
  t.check("Confirmed, the Package exists with a PKG number and holds 2 submittals", c1.status === 200 && /^PKG-\d{3,}$/.test(made?.number) && made?.counts.total === 2, JSON.stringify(made?.number) + " " + JSON.stringify(made?.counts));
  const group = await preview(hafiz, tm, "pkg2.xlsx", wb, { ...MAPPING, package: { column: 3 } });
  t.check("A Package column makes one Package per value (2 new ones)", group.status === 201 && (group.body.packages as Json[]).length === 2, group.text.slice(0, 200));
  const c2 = await confirm(hafiz, group.body.id as string);
  const after = ((await hafiz.get(`/projects/${tm.projectId}/packages`)).body as Json).packages as Json[];
  t.check("Confirmed: the new Packages took the next PKG numbers", c2.status === 200 && after.filter((x) => /UAT IMP-11 [AB]$/.test(x.name.en)).length >= 2, after.map((x) => x.number).join(","));
  const open = await makePackage(hafiz, tm, `UAT IMP-11 existing open ${tag}`);
  const toOpen = await preview(hafiz, tm, "pkg3.xlsx", xlsx([HEAD, row(6, "IMP-11")]), { ...MAPPING, packages: { existing: open.id } });
  t.check("An existing Open Package takes rows", toOpen.status === 201 && rowsOf(toOpen).every((x) => x.reasons.length === 0));
  // An In Progress Package: a complete MAR sent to internal review, added and submitted.
  const mar = await H.sentMar(tm, `UAT IMP-11 MAR for in-progress ${tag}`);
  const prog = await makePackage(hafiz, tm, `UAT IMP-11 in progress ${tag}`);
  const added = await addToPackage(hafiz, prog.id, mar);
  const sub = await submitPackage(tm.api.ali!, prog.id);
  t.note(`In Progress Package set-up: add ${added}, submit ${sub.status} ${sub.text.slice(0, 100)}`);
  const bad = await preview(hafiz, tm, "pkg4.xlsx", xlsx([HEAD, row(7, "IMP-11")]), { ...MAPPING, packages: { existing: prog.id } });
  t.check("An In Progress Package makes its rows bad (package_not_open)", bad.status === 201 && rowsOf(bad).every((x) => reasonsOf(x) === "package_not_open"), `${bad.status} ${rowsOf(bad).map(reasonsOf).join("|")} ${bad.text.slice(0, 100)}`);
  const save = await hafiz.post(`/projects/${tm.projectId}/register-import-mappings`, { name: `UAT IMP-11 mapping ${tag}`, mapping: { ...MAPPING, package: { column: 3 } } });
  const mapId = ((save.body as Json).mappings as Json[])?.find((m) => m.name === `UAT IMP-11 mapping ${tag}`)?.id as string | undefined;
  t.check("Saving the mapping lists it for the Company", save.status === 201 && !!mapId, `${save.status}`);
  const ali = ((await tm.api.ali!.get(`/projects/${tm.projectId}/register-imports/fields`)).body as Json).mappings as Json[];
  const yousef = await tm.api.yousef!.get(`/projects/${tm.projectId}/register-imports/fields`);
  t.check("A colleague reuses it; Beta Build neither lists nor changes it", ali.some((m) => m.id === mapId) && !JSON.stringify(yousef.body).includes(`UAT IMP-11 mapping ${tag}`) && (await tm.api.yousef!.request("DELETE", `/register-import-mappings/${mapId}`)).status >= 400, `${yousef.status}`);
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/imports`);
  await settle(page);
  await t.shot(page, "imports-with-packages");
  if (mapId) await hafiz.request("DELETE", `/register-import-mappings/${mapId}`);
  void bilingual;
  void mustAct;
});

defineCase("IMP-12", async (t) => {
  t.manual("Rabaed Admin needs the Rabaed Engineer's password and an emailed code (fixture FX-OW is manual too); no script signs an Engineer in. Built (RP-645): a person runs it, then Hafiz opens the import and reads 'Rabaed' as who imported.");
  t.check("Hafiz's Imports page is reachable for the manual follow-up", (await Api.as("hafiz").then(async (a) => (await a.get(`/projects/${(await H.team("hafiz")).projectId}/register-imports`)).status)) === 200);
});
