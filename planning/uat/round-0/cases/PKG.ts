import { pageAs } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { Api, mailTo, notFoundFor, openProject, settle } from "../harness/helpers.ts";
import * as H from "../harness/helpers-sub.ts";
import { addToPackage, listReadable, makePackage, runTag, submitPackage, team, type Json, type Team } from "../harness/helpers-sng.ts";
import { goRetry as go } from "../harness/helpers-sng.ts";

// Part PKG: Packages (RP-588). TMC covers Electrical only in the seed, so a Package of Electrical and
// Mechanical items (PKG-10, PKG-12) cannot be built by TMC: those cases run on Electrical items, and
// Sara (Mechanical only) is the Member who must see none of them.

const tag = runTag();
const pkg = async (api: Api, id: string) => (await api.get(`/packages/${id}`)).body as Json;
const pkgStatus = async (api: Api, id: string) => (await api.get(`/packages/${id}`)).status;

/** An item sent for review by Hafiz and picked up by Ali: the Step where Submit Package can Submit it. */
async function readyItem(tm: Team, title: string): Promise<string> {
  const id = await H.sentMar(tm, title);
  await H.pickUp(tm.api.ali!, id);
  return id;
}

/** A Package of Ali's with `n` ready items; returns the Package and its item ids. */
async function packageOf(tm: Team, name: string, n: number): Promise<{ id: string; number: string; items: string[] }> {
  const p = await makePackage(tm.api.ali!, tm, name);
  const items: string[] = [];
  for (let i = 1; i <= n; i++) {
    const it = await readyItem(tm, `${name} item ${i}`);
    await addToPackage(tm.api.ali!, p.id, it);
    items.push(it);
  }
  return { ...p, items };
}

function fill(form: Json | null): Json {
  const out: Json = {};
  for (const s of form?.sections ?? []) {
    for (const f of s.fields as Json[]) {
      if (f.type === "yes_no") out[f.key] = true;
      else if (f.type === "textarea" || f.type === "text") out[f.key] = `UAT ${f.key}`;
      else if (f.type === "table") out[f.key] = [{ comment: "UAT comment one", reference: "Sheet 1" }, { comment: "UAT comment two", reference: "Sheet 2" }];
    }
  }
  return out;
}

/** Ahmed reviews (picks up, sends to the Manager), Mohammed picks up. */
async function reviewed(tm: Team, id: string): Promise<void> {
  await H.reviewedMar(tm, id);
}

async function code(tm: Team, id: string, key: string): Promise<{ status: number; text: string }> {
  const mo = tm.api.mohammed!;
  const d = await H.detail(mo, id);
  const t = (d.actions.transitions as Json[]).find((x) => x.key === key);
  if (!t) return { status: 0, text: `not offered: ${(d.actions.transitions as Json[]).map((x) => x.key).join(",")}` };
  return mo.transition(id, key, { answers: fill(t.actionForm) });
}

defineCase("PKG-01", async (t) => {
  const tm = await team("ali", "hafiz");
  const { page } = await pageAs("ali");
  const projectId = await openProject(page);
  await go(page, `/projects/${projectId}/work-items`);
  await settle(page);
  if (await listReadable(t, page, "Ali's Submittals page opens, with its view toggle")) {
    await page.getByRole("link", { name: "Packages" }).first().click();
    await settle(page, 900);
    t.check("The view toggle's Packages opens the Packages view in the URL", /view=packages/.test(page.url()), page.url());
  } else {
    await go(page, `/projects/${projectId}/work-items?view=packages`);
    await settle(page, 900);
  }
  if (!(await listReadable(t, page, "Ali's Packages view opens"))) {
    t.note(`Board by api: ${(((await tm.api.ali!.get(`/projects/${tm.projectId}/packages`)).body as Json).packages as Json[]).length} Packages; the page checks need the page.`);
    return;
  }
  const text = await page.getByRole("main").innerText();
  t.check("Three columns Open, In Progress and Done", /Open/.test(text) && /In Progress/.test(text) && /Done/.test(text));
  t.check("A New Package button is offered to TMC", (await page.getByRole("button", { name: /New Package/ }).count()) > 0 || (await page.getByRole("link", { name: /New Package/ }).count()) > 0);
  t.check("Search by PKG number or name is offered", (await page.getByPlaceholder(/Search PKG number or name/).count()) > 0);
  await page.getByRole("button", { name: /Filter/ }).first().click().catch(() => undefined);
  await settle(page, 500);
  const body = await page.locator("body").innerText();
  t.check("Filters by Trade and owning Company are offered", /Trade/.test(body) && /Owning Company/.test(body));
  await t.shot(page, "packages-board");
  const board = ((await tm.api.ali!.get(`/projects/${tm.projectId}/packages`)).body as Json).packages as Json[];
  const counts = { open: board.filter((p) => p.status === "open").length, prog: board.filter((p) => p.status === "in_progress").length, done: board.filter((p) => p.status === "done").length };
  t.note(`Board by api: ${JSON.stringify(counts)}`);
  const { page: d } = await pageAs("ali");
  await go(d, `/projects/${projectId}/work-items?view=packages`);
  await settle(d);
  if (!(await listReadable(t, d, "Ali's Packages view opens for the column counts"))) return;
  const cols = await d.getByRole("main").innerText();
  const m = [...cols.matchAll(/(Open|In Progress|Done)\s*(\d+)/g)].map((x) => `${x[1]} ${x[2]}`);
  t.check("Each column carries a count equal to the Packages the api gives Ali", m.length >= 3 && m.some((x) => x === `Open ${counts.open}`) && m.some((x) => x === `In Progress ${counts.prog}`) && m.some((x) => x === `Done ${counts.done}`), `${m.join(", ")} vs ${JSON.stringify(counts)}`);
});

defineCase("PKG-02", async (t) => {
  const tm = await team("ali", "yousef");
  const { page } = await pageAs("ali");
  const projectId = await openProject(page);
  await go(page, `/projects/${projectId}/work-items?view=packages`);
  await settle(page);
  const boardOk = await listReadable(t, page, "Ali's Packages board opens, with its New Package button");
  const before = ((await tm.api.ali!.get(`/projects/${tm.projectId}/packages`)).body as Json).packages as Json[];
  const mine = before.filter((p) => p.owner.companyName.en === "TMC Constructions");
  const next = Math.max(0, ...mine.map((p) => Number(String(p.number).slice(4)))) + 1;
  if (boardOk) {
    await page.getByRole("button", { name: /New Package/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.getByLabel(/Name \(English\)/).fill(`UAT PKG-02 first ${tag}`);
    await dialog.getByLabel(/Name \(Arabic\)/).fill(`UAT PKG-02 الأولى ${tag}`);
    await t.shot(page, "new-package-dialog");
    await dialog.getByRole("button", { name: /^Create/ }).click();
    await settle(page, 1500);
    await page.waitForURL(/\/packages\/[0-9a-f-]{36}/, { timeout: 15000 }).catch(() => undefined);
  } else {
    const made = await makePackage(tm.api.ali!, tm, `UAT PKG-02 first ${tag}`);
    await go(page, `/packages/${made.id}`);
    await settle(page);
  }
  const text = await page.getByRole("main").innerText();
  const expected = `PKG-${String(next).padStart(3, "0")}`;
  t.check("The new Package page shows its PKG number beside TMC's name, Open, with no submittals", text.includes(expected) && /TMC Constructions/.test(text) && /Open/.test(text) && /No submittals in this Package yet/.test(text), `${expected}; ${text.replaceAll("\n", " ").slice(0, 160)}`);
  await t.shot(page, "package-page");
  const second = await makePackage(tm.api.ali!, tm, `UAT PKG-02 second ${tag}`);
  t.check("A second Package is the next number", second.number === `PKG-${String(next + 1).padStart(3, "0")}`, second.number);
  const ownList = ((await tm.api.yousef!.get(`/projects/${tm.projectId}/packages`)).body as Json).packages as Json[];
  const yMine = ownList.filter((p) => p.owner.companyName.en === "Beta Build");
  const beta = await makePackage(tm.api.yousef!, tm, `UAT PKG-02 beta ${tag}`);
  t.check("Beta Build's Packages are numbered from their own count (its first is PKG-001), never counting TMC's", beta.number === `PKG-${String(yMine.length + 1).padStart(3, "0")}` && (yMine.length > 0 || beta.number === "PKG-001"), `${beta.number}; Beta had ${yMine.length}`);
  const ar = await pageAs("ali");
  await go(ar.page, `/packages/${second.id}`, "ar");
  await settle(ar.page);
  const dir = await ar.page.getByText(second.number).first().evaluate((el) => getComputedStyle(el).direction + "|" + (el.closest("[dir]")?.getAttribute("dir") ?? "")).catch(() => "none");
  t.check("In Arabic the number is left to right", /ltr/.test(dir), dir);
  await t.shot(ar.page, "package-page-arabic");
});

defineCase("PKG-03", async (t) => {
  const tm = await team("hafiz", "ali", "yousef");
  const { ali, yousef } = tm.api;
  const p = await makePackage(ali!, tm, `UAT PKG-03 ${tag}`);
  const other = await makePackage(ali!, tm, `UAT PKG-03 other ${tag}`);
  await H.createItem(ali!, tm, "MAR", `UAT PKG-03 draft one ${tag}`, await H.marAnswers(tm));
  const d2 = await H.createItem(ali!, tm, "MAR", `UAT PKG-03 draft two ${tag}`, await H.marAnswers(tm));
  const review = await H.sentMar(tm, `UAT PKG-03 in review ${tag}`);
  const taken = await H.createItem(ali!, tm, "MAR", `UAT PKG-03 in other ${tag}`, await H.marAnswers(tm));
  const beta = await H.createItem(yousef!, tm, "MAR", `UAT PKG-03 Beta draft ${tag}`, await H.marAnswers(tm, { location: tm.d.loc("Tower 2 Floor 01") }));
  await addToPackage(ali!, other.id, taken);
  const { page } = await pageAs("ali");
  await go(page, `/packages/${p.id}`);
  await settle(page);
  await page.getByRole("button", { name: /Add items/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.getByPlaceholder(/Number, Subject/).fill(tag);
  await dialog.getByRole("checkbox").first().waitFor({ timeout: 15000 });
  await settle(page, 800);
  const list = await dialog.innerText();
  t.check("TMC's own Drafts and the item in review are offered", /draft one/.test(list) && /draft two/.test(list) && /in review/.test(list));
  t.check("Beta Build's Draft is never offered", !/Beta draft/.test(list));
  t.check("An item already in another Package is marked with that Package", new RegExp(`In ${other.number}`).test(list), list.replaceAll("\n", " ").slice(0, 200));
  await t.shot(page, "add-items-dialog");
  await dialog.getByRole("checkbox", { name: /draft one/ }).check();
  await dialog.getByRole("checkbox", { name: /in review/ }).check();
  const pickTaken = await dialog.getByRole("checkbox", { name: /in other/ }).isDisabled().catch(() => true);
  t.check("The item in another Package cannot be picked", pickTaken);
  await dialog.getByRole("button", { name: /^Add 2 submittals/ }).click();
  await settle(page, 1200);
  t.check("The two picked items are now in the Package", (await pkg(ali!, p.id)).counts.total === 2);
  await t.shot(page, "after-add");
  t.check("The api refuses an item already in another Package", (await ali!.post(`/packages/${p.id}/items`, { workItemId: taken })).status >= 400);
  t.check("The api refuses Beta Build's item (one answer, not offered)", (await ali!.post(`/packages/${p.id}/items`, { workItemId: beta })).status >= 400);
  t.check("Beta Build cannot add to TMC's Package (the plain 404)", (await yousef!.post(`/packages/${p.id}/items`, { workItemId: beta })).status === 404);
  t.note("Hafiz's Draft cannot be added by Ali (not_editable: Ali may not edit it, per app.add_package_item); the Drafts here are Ali's own.");
  void d2; void review;
});

defineCase("PKG-04", async (t) => {
  const tm = await team("hafiz", "ali");
  const { ali } = tm.api;
  const p = await makePackage(ali!, tm, `UAT PKG-04 ${tag}`);
  const a = await H.createItem(ali!, tm, "MAR", `UAT PKG-04 a ${tag}`, await H.marAnswers(tm));
  const b = await H.createItem(ali!, tm, "MAR", `UAT PKG-04 b ${tag}`, await H.marAnswers(tm));
  await addToPackage(ali!, p.id, a);
  await addToPackage(ali!, p.id, b);
  const { page } = await pageAs("ali");
  await go(page, `/packages/${p.id}`);
  await settle(page);
  await page.getByRole("button", { name: /^Remove UAT PKG-04 a/ }).click();
  await settle(page, 1200);
  t.check("Removing one item leaves one", (await pkg(ali!, p.id)).counts.total === 1);
  await page.getByRole("button", { name: "Rename" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await dlg.getByLabel(/Name \(English\)/).fill(`UAT PKG-04 renamed ${tag}`);
  await dlg.getByLabel(/Name \(Arabic\)/).fill(`UAT PKG-04 معاد ${tag}`);
  await dlg.getByRole("button", { name: "Save" }).click();
  await settle(page, 1200);
  t.check("Rename is saved", (await pkg(ali!, p.id)).name.en === `UAT PKG-04 renamed ${tag}`);
  await go(page, `/packages/${p.id}`);
  await page.getByRole("button", { name: /^Delete/ }).first().click();
  const del = page.getByRole("dialog");
  await del.waitFor({ state: "visible" });
  const dtext = await del.innerText();
  t.check("Delete says the submittals stay, without a Package", /stay as they are, without a Package/.test(dtext), dtext.replaceAll("\n", " ").slice(0, 160));
  await t.shot(page, "delete-dialog");
  await del.getByRole("button", { name: /Delete Package/ }).click();
  await settle(page, 1500);
  t.check("The Package is gone", (await pkgStatus(ali!, p.id)) === 404);
  const bd = await H.detail(ali!, b);
  t.check("Its Draft stays, without a Package", bd.stage.key === "draft" && bd.package === undefined);
  // Rename in every status, remove and delete only while Open.
  const q = await packageOf(tm, `UAT PKG-04 later ${tag}`, 1);
  const sub = await submitPackage(ali!, q.id);
  t.check("A Package can be submitted for the status checks", sub.status === 200, `${sub.status} ${sub.text.slice(0, 100)}`);
  t.check("After the Submit, remove is refused", (await ali!.request("DELETE", `/packages/${q.id}/items/${q.items[0]}`)).status >= 400);
  t.check("After the Submit, delete is refused", (await ali!.request("DELETE", `/packages/${q.id}`)).status >= 400);
  t.check("After the Submit, rename still works", (await ali!.request("PATCH", `/packages/${q.id}`, { name: { en: `UAT PKG-04 later renamed ${tag}`, ar: "معاد" } })).status === 204);
});

defineCase("PKG-05", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed");
  const { ali } = tm.api;
  const good = await readyItem(tm, `UAT PKG-05 good ${tag}`);
  const bad = await H.createItem(ali!, tm, "MAR", `UAT PKG-05 draft not sent ${tag}`, await H.marAnswers(tm));
  const p = await makePackage(ali!, tm, `UAT PKG-05 ${tag}`);
  await addToPackage(ali!, p.id, good);
  await addToPackage(ali!, p.id, bad);
  const { page } = await pageAs("ali");
  await go(page, `/packages/${p.id}`);
  await settle(page);
  const text = await page.getByRole("main").innerText();
  t.check("The page lists what stops the Submit, naming the blocking item", /These stop it now/.test(text) && text.includes("draft not sent"), text.replaceAll("\n", " ").slice(0, 240));
  t.check("Submit Package is not offered while something stops it", (await page.getByRole("button", { name: /Submit Package/ }).count()) === 0);
  await t.shot(page, "not-ready-list");
  const refused = await submitPackage(ali!, p.id);
  const named = ((refused.body as Json)?.notReady as Json[]) ?? [];
  t.check("The api refuses, names the blocking item and why", refused.status === 409 && named.length === 1 && named[0]!.title.includes("draft not sent") && named[0]!.reason === "cannot_submit", `${refused.status} ${refused.text.slice(0, 200)}`);
  const cur = await H.detail(ali!, good);
  t.check("The good item is still at internal review with Ali", cur.step.key === "internal_review");
  await ali!.request("DELETE", `/packages/${p.id}/items/${bad}`);
  await go(page, `/packages/${p.id}`);
  await settle(page);
  t.check("With the blocker removed, Submit Package is offered", (await page.getByRole("button", { name: /Submit Package/ }).count()) > 0);
  await page.getByRole("button", { name: /Submit Package/ }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await t.shot(page, "submit-confirm");
  await dlg.getByRole("button", { name: /^Submit Package/ }).click();
  await settle(page, 2000);
  const done = await H.detail(ali!, good);
  t.check("One confirm Submits the item and it gets its own Document Number", /^TWR-MAR-\d\d-\d{4}$/.test(done.documentNumber ?? "") && done.step.key === "consultant_engineer", `${done.documentNumber} ${done.step.key}`);
  t.note("Judged against RP-638/RP-974: a Draft not yet sent for review is 'cannot_submit' (it waits at a Step where Ali cannot Submit it); a Draft cannot hold a missing required field past Send for Review, so 'required field Supplier missing' does not arise at Submit Package.");
});

defineCase("PKG-06", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed");
  const { ali } = tm.api;
  const p = await packageOf(tm, `UAT PKG-06 ${tag}`, 4);
  t.check("A Package of unsent items is Open", (await pkg(ali!, p.id)).status === "open");
  const sub = await submitPackage(ali!, p.id);
  t.check("Submit Package submits all 4", sub.status === 200 && (sub.body as Json).submitted.length === 4, `${sub.status} ${sub.text.slice(0, 100)}`);
  t.check("In Progress as soon as anything is submitted", (await pkg(ali!, p.id)).status === "in_progress");
  const [a, b, c, d] = p.items as [string, string, string, string];
  for (const id of p.items) await reviewed(tm, id);
  const results = [await code(tm, a, "approve_a"), await code(tm, b, "approve_b"), await code(tm, c, "revise_c"), await code(tm, d, "reject_d")];
  t.check("Mohammed closes the items at A, B, C and D", results.every((r) => r.status === 204), results.map((r) => `${r.status} ${r.text.slice(0, 60)}`).join(" | "));
  t.check("With a Code C waiting for its Revision the Package is still In Progress", (await pkg(ali!, p.id)).status === "in_progress");
  const rev = await ali!.post(`/work-items/${c}/revisions`, { idempotencyKey: crypto.randomUUID() });
  const rid = (rev.body as Json)?.id as string;
  t.check("A Revision of the Code C item is created", rev.status === 201, `${rev.status}`);
  const detail = await pkg(ali!, p.id);
  t.check("The Revision joins the Package by itself and the Package stays In Progress", detail.status === "in_progress" && (detail.items as Json[]).some((i) => i.id === rid), `${detail.status} ${(detail.items as Json[]).length} items`);
  await H.must(ali!, rid, "send_for_review");
  await H.pickUp(ali!, rid);
  await H.must(ali!, rid, "submit", { answers: { cover_note: "Revised" } });
  await reviewed(tm, rid);
  const r2 = await code(tm, rid, "approve_a");
  t.check("The Revision closes at A", r2.status === 204, `${r2.status} ${r2.text.slice(0, 80)}`);
  const finished = await pkg(ali!, p.id);
  t.check("Done: every latest submittal has closed at A, B or D", finished.status === "done", finished.status);
  const rep = await ali!.post(`/work-items/${d}/replacements`, { idempotencyKey: crypto.randomUUID() });
  const repId = (rep.body as Json)?.id as string | undefined;
  const afterRep = await pkg(ali!, p.id);
  t.check("A replacement for the Code D item joins and puts the Package back In Progress", rep.status === 201 && afterRep.status === "in_progress", `${rep.status} ${afterRep.status}`);
  const { page } = await pageAs("ali");
  await go(page, `/packages/${p.id}`);
  await settle(page);
  const text = await page.getByRole("main").innerText();
  t.check("The word is In Progress or Done, never Closed", !/\bClosed\b/.test(text.replace(/closed of/g, "")), "");
  await t.shot(page, "package-in-progress-again");
  void repId;
});

defineCase("PKG-07", async (t) => {
  const tm = await team("hafiz", "ali");
  const { ali } = tm.api;
  const p = await packageOf(tm, `UAT PKG-07 ${tag}`, 1);
  await submitPackage(ali!, p.id);
  t.check("The Package is In Progress", (await pkg(ali!, p.id)).status === "in_progress");
  const extra = await H.createItem(ali!, tm, "MAR", `UAT PKG-07 added later ${tag}`, await H.marAnswers(tm));
  t.check("Adding a submittal to an In Progress Package works", (await addToPackage(ali!, p.id, extra)) === 204 && (await pkg(ali!, p.id)).counts.total === 2);
  t.check("Removing one is refused", (await ali!.request("DELETE", `/packages/${p.id}/items/${p.items[0]}`)).status >= 400);
  const { page } = await pageAs("ali");
  await go(page, `/packages/${p.id}`);
  await settle(page);
  t.check("The page offers no remove button, and Rename works", (await page.getByRole("button", { name: /^Remove / }).count()) === 0 && (await page.getByRole("button", { name: "Rename" }).count()) > 0);
  await t.shot(page, "in-progress-package");
  const ren = await ali!.request("PATCH", `/packages/${p.id}`, { name: { en: `UAT PKG-07 renamed ${tag}`, ar: "معاد" } });
  t.check("Rename is saved", ren.status === 204 && (await pkg(ali!, p.id)).name.en.includes("renamed"));
});

defineCase("PKG-08", async (t) => {
  const tm = await team("hafiz", "ali", "yousef");
  const { ali } = tm.api;
  const p = await packageOf(tm, `UAT PKG-08 ${tag}`, 2);
  const loose = await H.createItem(ali!, tm, "MAR", `UAT PKG-08 loose ${tag}`, await H.marAnswers(tm));
  const filtered = ((await ali!.get(`/projects/${tm.projectId}/modules/submittals/work-items?packageId=${p.id}&pageSize=50`)).body as Json).items as Json[];
  t.check("The Package filter narrows the List to its items", filtered.length === 2 && filtered.every((i) => p.items.includes(i.id)), `${filtered.length}`);
  const board = ((await ali!.get(`/projects/${tm.projectId}/modules/submittals/work-items/kanban?packageId=${p.id}`)).body as Json).columns as Json[];
  const cards = board.flatMap((c) => (c.lanes as Json[]).flatMap((l) => l.cards as Json[]));
  t.check("The Package filter narrows the Kanban too", cards.length === 2, `${cards.length}`);
  const { page } = await pageAs("ali");
  await go(page, `/projects/${tm.projectId}/work-items?packageId=${p.id}`);
  await settle(page);
  const text = await page.getByRole("main").innerText();
  if (await listReadable(t, page, "The Package-filtered Submittals List opens")) t.check("The List rows show the chip PKG number with the name", text.includes(p.number) && !text.includes("UAT PKG-08 loose"), text.replaceAll("\n", " ").slice(0, 160));
  await t.shot(page, "list-filtered-by-package");
  await go(page, `/projects/${tm.projectId}/work-items?view=kanban&packageId=${p.id}`);
  await settle(page);
  if (await listReadable(t, page, "The Package-filtered Kanban opens")) t.check("The Kanban cards show the chip", (await page.getByRole("main").innerText()).includes(p.number));
  await go(page, `/work-items/${p.items[0]}`);
  await settle(page);
  const link = page.getByRole("main").getByRole("link", { name: new RegExp(p.number) }).first();
  t.check("The item page shows the chip with the Package name", (await link.count()) > 0);
  await link.click();
  await page.waitForURL(/\/packages\/[0-9a-f-]{36}/, { timeout: 10000 }).catch(() => undefined);
  t.check("The chip opens the Package page", page.url().includes(`/packages/${p.id}`), page.url());
  await t.shot(page, "chip-opens-package");
  const looseDetail = await H.detail(ali!, loose);
  t.check("An item in no Package shows no chip, and Package is not a Form field", looseDetail.package === undefined && !JSON.stringify((await ali!.get(`/projects/${tm.projectId}/work-item-types/MAR/form`)).body).includes("package"));
  const nf = await notFoundFor("yousef", `/packages/${p.id}`);
  t.check("Beta Build opening the Package gets the plain 404", nf.notFound);
});

defineCase("PKG-09", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed");
  const { ali, mohammed: mo } = tm.api;
  const p = await packageOf(tm, `UAT PKG-09 ${tag}`, 4);
  await submitPackage(ali!, p.id);
  const [a, b, c, d] = p.items as [string, string, string, string];
  await reviewed(tm, a);
  await reviewed(tm, b);
  await reviewed(tm, d);
  const form = ((await H.detail(mo!, a)).actions.transitions as Json[]).find((x) => x.key === "approve_a")!.actionForm as Json;
  const body = (ids: string[]) => ({ transition: "approve_a", workItemIds: ids, answers: fill(form), confirmed: true, idempotencyKey: crypto.randomUUID() });
  const stopped = await mo!.post(`/work-items/bulk-transitions`, body([a, b, c]));
  t.check("Item c still waits at the Consultant Engineer: the bulk Code is refused for all, naming that item and why", stopped.status === 409 && /transition_not_offered|not_waiting/.test(stopped.text) && stopped.text.includes("PKG-09"), `${stopped.status} ${stopped.text.slice(0, 260)}`);
  t.check("All or nothing: a and b did not move", (await H.detail(mo!, a)).stage.key === "pending_approval" && (await H.detail(mo!, b)).stage.key === "pending_approval");
  const ok = await mo!.post(`/work-items/bulk-transitions`, body([a, b]));
  t.check("One Action Form applies to two items waiting on Mohammed", ok.status === 200 && (ok.body as Json).taken.length === 2, `${ok.status} ${ok.text.slice(0, 160)}`);
  const da = await H.detail(mo!, a);
  const db = await H.detail(mo!, b);
  t.check("Each item is closed at Code A with its own event", da.outcome === "A" && db.outcome === "A");
  const ea = ((await mo!.get(`/work-items/${a}/history`)).body as Json).events as Json[];
  t.check("Each has its own signed Transition event", ea.some((e) => /Approve/.test(JSON.stringify(e))));
  await new Promise((r) => setTimeout(r, 4000));
  t.check("Each gets its own Documental Record (preparing or published)", (await H.detail(mo!, a)).documentalRecord !== null && (await H.detail(mo!, b)).documentalRecord !== null, `${(await H.detail(mo!, a)).documentalRecord} / ${(await H.detail(mo!, b)).documentalRecord}`);
  const { page } = await pageAs("mohammed");
  await go(page, `/packages/${p.id}`);
  await settle(page);
  await t.shot(page, "package-bulk");
  t.note("Not run: the 'DCL Member without a Signature' half needs a fixture (remove a Signature in a profile); Mohammed is the only DCL Manager and the seed's Engineers cannot take a Code, so no Member could be taken in bulk. Mohammed has a Signature.");
  t.note("The Package page's own bulk bar (select rows, shared Transitions) was not driven; the bulk call is the api it uses.");
  void d;
});

defineCase("PKG-10", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "sara", "mohammed");
  const { ali, ahmed, sara } = tm.api;
  const p = await packageOf(tm, `UAT PKG-10 ${tag}`, 3);
  const sub = await submitPackage(ali!, p.id);
  t.check("Ali Submits a Package of three Electrical items", sub.status === 200, `${sub.status}`);
  await new Promise((r) => setTimeout(r, 4000));
  const mine = (((await ahmed!.get("/notifications")).body as Json).notifications as Json[]).filter((n) => n.kind === "package_submitted" && n.package?.id === p.id);
  t.check("Ahmed has one grouped notification for the Package, counting the 3 submittals he sees", mine.length === 1 && mine[0]!.package.count === 3 && mine[0]!.package.number === p.number && mine[0]!.package.companyName.en === "TMC Constructions", JSON.stringify(mine[0]?.package));
  const stepReached = (((await ahmed!.get("/notifications")).body as Json).notifications as Json[]).filter((n) => n.kind === "step_reached" && p.items.includes(n.workItemId));
  t.check("There is no separate Step reached notification for those items", stepReached.length === 0, `${stepReached.length}`);
  const theirs = (((await sara!.get("/notifications")).body as Json).notifications as Json[]).filter((n) => n.package?.id === p.id || p.items.includes(n.workItemId));
  t.check("Sara (Mechanical only) sees none of the three, so she is told nothing of the Package", theirs.length === 0 && (await pkgStatus(sara!, p.id)) === 404);
  const mail = (await mailTo("ahmed.binsaid@designconsultants.demo.rabaed.test")).filter((m) => m.subject.includes(p.number));
  t.check("Ahmed's email in Mailpit names the Package number and submittal count", mail.length >= 1 && /3 submittals?/.test(mail[0]?.subject ?? ""), mail.map((m) => m.subject).join(" | "));
  const { page } = await pageAs("ahmed");
  await go(page, `/notifications`);
  await settle(page);
  await t.shot(page, "ahmed-notifications");
  t.note("TMC covers Electrical only, so a Package with Mechanical items cannot be built by TMC in this seed; Sara's count (n = Mechanical only) is therefore 0 and she gets no notification.");
});

defineCase("PKG-11", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed");
  const { ali, mohammed: mo } = tm.api;
  const p = await packageOf(tm, `UAT PKG-11 ${tag}`, 1);
  await submitPackage(ali!, p.id);
  await reviewed(tm, p.items[0]!);
  const r = await code(tm, p.items[0]!, "approve_b");
  t.check("Mohammed issues Code B with comment rows", r.status === 204, `${r.status} ${r.text.slice(0, 100)}`);
  const c = (await ali!.get(`/packages/${p.id}/comments`)).body as Json;
  const list = (c.comments ?? c.items ?? []) as Json[];
  t.check("The Package's Comments list the Comments raised from its submittals", list.length === 2, JSON.stringify(c).slice(0, 200));
  const status = (await pkg(ali!, p.id)).status;
  t.check("They do not change its status (the Code B item is closed; status follows the items only)", status === "done" || status === "in_progress", status);
  const { page } = await pageAs("ali");
  await go(page, `/packages/${p.id}`);
  await settle(page);
  const text = await page.getByRole("main").innerText();
  t.check("The Comments section shows them with the note that Comments are not part of the Package", /Comments/.test(text) && /not part of the Package/.test(text) && /For information/.test(text), text.replaceAll("\n", " ").slice(-300));
  await t.shot(page, "package-comments", { fullPage: true });
  t.check("Mohammed also reads them for the items he sees", (await mo!.get(`/packages/${p.id}/comments`)).status === 200);
});

defineCase("PKG-12", async (t) => {
  const tm = await team("hafiz", "ali", "yousef", "ahmed", "sara", "mohammed");
  const { ali, yousef, ahmed, sara } = tm.api;
  const p = await makePackage(ali!, tm, `UAT PKG-12 ${tag}`);
  const items: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const id = await H.sentMar(tm, `UAT PKG-12 item ${i} ${tag}`);
    await H.pickUp(ali!, id);
    await addToPackage(ali!, p.id, id);
    items.push(id);
  }
  const listed = async (api: Api) => (((await api.get(`/projects/${tm.projectId}/packages`)).body as Json).packages as Json[]).some((x) => x.id === p.id);
  t.check("Positive control: Ali sees the Open Package with its items", (await listed(ali!)) && (await pkg(ali!, p.id)).counts.total === 2);
  for (const [who, api] of [["Yousef", yousef], ["Ahmed", ahmed], ["Sara", sara]] as const) {
    t.check(`${who}: an Open Package of Drafts is not in the board, and its id is the plain 404`, !(await listed(api!)) && (await pkgStatus(api!, p.id)) === 404);
  }
  const nf = await notFoundFor("yousef", `/packages/${p.id}`);
  t.check("Yousef opening it in the browser gets the plain 404 page", nf.notFound, nf.text);
  const sub = await submitPackage(ali!, p.id);
  t.check("Ali Submits the Package", sub.status === 200, `${sub.status}`);
  const a = await pkg(ahmed!, p.id);
  t.check("After the Submit Ahmed sees the Package with all submittals of his Trades and one status word", a.status === "in_progress" && a.counts.total === 2 && (a.items as Json[]).length === 2, `${a.status} ${JSON.stringify(a.counts)}`);
  t.check("Sara (Mechanical only) sees none of its items, so no Package at all", !(await listed(sara!)) && (await pkgStatus(sara!, p.id)) === 404);
  t.check("Yousef (another Contractor) still sees nothing", !(await listed(yousef!)) && (await pkgStatus(yousef!, p.id)) === 404);
  t.check("Ahmed cannot change it (the plain 404 for rename and add)", (await ahmed!.request("PATCH", `/packages/${p.id}`, { name: { en: "x", ar: "x" } })).status === 404 && (await ahmed!.post(`/packages/${p.id}/items`, { workItemId: items[0] })).status === 404);
  const { page } = await pageAs("ahmed");
  await go(page, `/projects/${tm.projectId}/work-items?view=packages`);
  await settle(page);
  if (await listReadable(t, page, "Ahmed's Packages board opens")) t.check("Ahmed's board shows it by number and Company name only", (await page.getByRole("main").innerText()).includes(p.number));
  await t.shot(page, "ahmed-packages-board");
  const ps = await pageAs("sara");
  await go(ps.page, `/projects/${tm.projectId}/work-items?view=packages`);
  await settle(ps.page);
  t.check("Sara's board does not show it", !(await ps.page.getByRole("main").innerText()).includes(`UAT PKG-12 ${tag}`));
  await t.shot(ps.page, "sara-packages-board");
  t.note("TMC covers Electrical only, so the Package has no Mechanical items; Sara's 'only the Mechanical ones and their counts' reads as none, hence no Package. A Mechanical-only counts check needs TMC to cover Mechanical (a fixture).");
});
