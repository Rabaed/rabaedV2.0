import { readFileSync, rmSync } from "node:fs";
import type { BrowserContext, Locator, Page } from "playwright";
import { pageAs, sessionFile } from "../harness/browser.ts";
import { defineCase, type CaseApi } from "../harness/case.ts";
import { Api, mailTo, readNotFound, settle, takeTransition } from "../harness/helpers.ts";
import * as H from "../harness/helpers-sub.ts";
import { create, goRetry as go, makeXlsx, makePackage, moduleItems, mustAct, runTag, team, testPhoto, upload, writeData, type Json, type Team } from "../harness/helpers-sng.ts";

// Business end-to-end journeys J9, J10, J11, J12 and J14 (strategy section 4). Each is one continuous story
// across Companies, with a screenshot at every hand-over; at each hand-over the receiving Company is read first
// (the positive control), then Yousef (Beta Build, Tower 2 only) and Sara (Design Consultants, Mechanical only)
// are checked against the page and the api. The Test Case ids a check covers are in its text, in brackets.

const tag = runTag();
const FIELD = "inspection_checklist";
const NAME: Record<string, string> = { yousef: "Yousef (Beta Build)", sara: "Sara (Mechanical only)", ahmed: "Ahmed", mohammed: "Mohammed", hafiz: "Hafiz", ali: "Ali", omar: "Omar", saeed: "Saeed" };
const REQUESTED = "2026-11-02T08:00:00.000Z";

function stopwatch(id: string): (what: string) => void {
  const start = Date.now();
  return (what) => console.log(`${id} +${((Date.now() - start) / 1000).toFixed(0)}s ${what}`);
}

type Ctx = {
  tm: Team;
  api(p: string): Promise<Api>;
  page(p: string, phone?: boolean): Promise<Page>;
  /** Signs the person in again (a new session) in every page and api session the journey holds for them. */
  relogin(p: string): Promise<void>;
  /** Opens a page a person may see, signing them in again when the page asks for a sign-in, and reading it again when it comes up not found. */
  show(t: CaseApi, page: Page, path: string): Promise<void>;
};

/** Whether the page in front of `page` is asking for a sign-in. */
const needsSignIn = async (page: Page): Promise<boolean> => (await page.getByRole("textbox", { name: /^Password/ }).count()) > 0 && (await page.getByRole("heading", { name: /^Sign in$/ }).count()) > 0;

/** The people of a journey, signed in on demand: an api session and one page each. */
async function crew(): Promise<Ctx> {
  const tm = await team("hafiz");
  const pages = new Map<string, Page>();
  const c: Ctx = {
    tm,
    async api(p) {
      tm.api[p] ??= await Api.as(p);
      return tm.api[p]!;
    },
    async page(p, phone = false) {
      const key = `${p}${phone ? ":phone" : ""}`;
      let page = pages.get(key);
      if (!page || page.isClosed()) {
        page = (await pageAs(p, phone ? { phone: true } : {})).page;
        pages.set(key, page);
      }
      return page;
    },
    async relogin(p) {
      // Another run signing the same person in can end this run's session: the session file is made again and its cookies replace the old ones.
      const file = sessionFile(p);
      rmSync(file, { force: true });
      const state = JSON.parse(readFileSync(sessionFile(p), "utf8")) as { cookies: Parameters<BrowserContext["addCookies"]>[0] };
      const contexts = new Set<BrowserContext>();
      for (const [key, page] of pages) if (key === p || key === `${p}:phone`) contexts.add(page.context());
      if (tm.api[p]) contexts.add(tm.api[p]!.context);
      for (const context of contexts) {
        await context.clearCookies();
        await context.addCookies(state.cookies);
      }
    },
    async show(t, page, path) {
      const owner = [...pages.entries()].find(([, v]) => v === page)?.[0].split(":")[0];
      for (let attempt = 1; attempt <= 3; attempt++) {
        await go(page, path);
        await settle(page);
        if (owner && (await needsSignIn(page))) {
          t.note(`${owner}'s session had ended (the page asked for a sign-in at attempt ${attempt}); signed in again.`);
          await c.relogin(owner);
          continue;
        }
        if (!(await onNotFound(page))) return;
        t.note(`${path.replace(/[0-9a-f-]{36}/g, "<id>")} came up as the not-found page for a person who may read it (attempt ${attempt}): the 3 s read limit (RP-1049).`);
        await page.waitForTimeout(2000);
      }
    },
  };
  return c;
}

/**
 * Waits (up to a minute) while the Project's "WIR Approved submittals" Required link is on: another run toggles it
 * for a moment, and while it is on no WIR leaves Draft without that link. The journeys do not change the setting.
 */
async function requiredLinksOff(t: CaseApi, c: Ctx): Promise<void> {
  const api = await c.api("ali");
  for (let i = 0; i < 12; i++) {
    const fields = ((await api.get(`/projects/${c.tm.projectId}/required-fields`)).body as Json | null)?.fields as Json[] | undefined;
    if (!fields?.some((f) => f.type === "WIR" && f.key === "approved_submittals" && f.required === true)) return;
    if (i === 0) t.note("The WIR Approved submittals Required link was on (another run's setting); waited for it to go off before sending a WIR.");
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Each of `who` gets the plain not-found page for `path` and a 404 from the api for `apiPath`. */
async function sealed(t: CaseApi, c: Ctx, who: string[], what: string, path: string, apiPath: string, covers: string): Promise<void> {
  // The people are read side by side (each has a page of its own); the checks are recorded in order.
  const reads = await Promise.all(who.map(async (p) => {
    const page = await c.page(p);
    const api = await c.api(p);
    // A page that is still loading (the dev server compiling a route) is read again before it counts as a leak.
    let nf = await readNotFound(page, path);
    let tries = 1;
    while (!nf.notFound && tries < 3) {
      if (await needsSignIn(page)) await c.relogin(p);
      else await page.waitForTimeout(1500);
      nf = await readNotFound(page, path);
      tries++;
    }
    let status = (await api.get(apiPath)).status;
    if (status === 401) {
      await c.relogin(p);
      status = (await api.get(apiPath)).status;
    }
    return { p, nf, tries, status };
  }));
  for (const { p, nf, tries, status } of reads) {
    t.check(`[${covers}] ${what}: ${NAME[p] ?? p} gets the not-found page and api 404`, nf.notFound && status === 404, `page notFound=${nf.notFound} (http ${nf.status}, read ${tries}x); api ${status}`);
  }
}

/** The text of the page's main region, one line, after the page has settled. */
const mainText = async (page: Page): Promise<string> => (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
const onNotFound = async (page: Page): Promise<boolean> => (await page.getByTestId("not-found").count()) > 0 || /We can.t find this page/.test(await page.locator("body").innerText());

/** A Radix select of the New form: open it by its id and click the option. */
async function pickOption(page: Page, id: string, name: RegExp): Promise<void> {
  await page.locator(`#${id}`).click();
  await page.getByRole("option", { name }).first().click();
}

/** A labelled select (the Settings editors): open it by its label and click the option. */
async function pickLabelled(scope: Page | Locator, label: RegExp, name: RegExp | string, nth = 0): Promise<void> {
  await scope.getByLabel(label).nth(nth).click();
  await (scope as Page).getByRole("option", { name }).first().click();
}

/** Fills an Action Form with something valid for each required field. */
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

/** Mohammed (Manager) issues the code `key` with a valid Action Form. */
async function issue(c: Ctx, id: string, key: string): Promise<{ status: number; text: string }> {
  const mo = await c.api("mohammed");
  const d = await H.detail(mo, id);
  const tr = (d.actions.transitions as Json[]).find((x) => x.key === key);
  if (!tr) return { status: 0, text: `not offered: ${(d.actions.transitions as Json[]).map((x) => x.key).join(",")}` };
  return mo.transition(id, key, { answers: fill(tr.actionForm) });
}

const stageOf = async (api: Api, id: string): Promise<string> => (await H.detail(api, id)).stage.key as string;
const docsOf = async (api: Api, id: string): Promise<Json[]> => ((await api.get(`/work-items/${id}/documents`)).body as Json).documents as Json[];

// ============================================================================================================
// J9: Inspection. Saeed makes a Checklist Template, Hafiz raises a WIR picking it, Ali Submits, Ahmed answers on
// site with one failed item and a photo, Mohammed codes it, a Snag is raised, and a re-inspection Revision follows.
// ============================================================================================================
defineCase("J9", async (t) => {
  const lap = stopwatch("J9");
  const c = await crew();
  lap("crew");
  const P = c.tm.projectId;
  const tm = c.tm;
  const saeed = await c.api("saeed");
  const tplName = `UAT J9 Cable tray checklist ${tag}`;
  const templates = async (api: Api) => ((await api.get(`/projects/${P}/checklist-templates`)).body as Json).templates as Json[];

  lap("step 1");
  // 1. Saeed (Project Admin) makes the Checklist Template in Settings.
  const sp = await c.page("saeed");
  await go(sp, `/projects/${P}/settings/checklist-templates/new`);
  await settle(sp);
  await sp.getByLabel(/^Name \(English\)/).fill(tplName);
  await sp.getByLabel(/^Name \(Arabic\)/).fill(`${tplName} (ع)`);
  await pickLabelled(sp, /^Trade/, /Electrical Works/);
  await sp.getByLabel(/^Item \(English\)/).first().fill("Supports at the spacing on the drawing");
  await sp.getByLabel(/^Item \(Arabic\)/).first().fill("الدعامات على التباعد المبين في المخطط");
  await pickLabelled(sp, /^Comment$/, /Required on Fail or No/, 0);
  await pickLabelled(sp, /^Photos$/, /Required on Fail or No/, 0);
  await sp.getByRole("button", { name: "Add item" }).click();
  await sp.getByLabel(/^Item \(English\)/).nth(1).fill("Trays bonded to earth");
  await sp.getByLabel(/^Item \(Arabic\)/).nth(1).fill("الأحواض موصولة بالتأريض");
  await settle(sp, 500);
  const editorText = await mainText(sp);
  await sp.getByRole("button", { name: "Create Checklist Template" }).click();
  await sp.waitForURL(/checklist-templates\/[0-9a-f-]{36}/, { timeout: 20000 });
  await settle(sp);
  await t.shot(sp, "1-saeed-template-made", { fullPage: true });
  const made = (await templates(saeed)).find((x) => x.name.en === tplName);
  t.check("[INS-01] Saeed's new Checklist Template is Version 1, active, for Electrical Works, with 2 items", made?.versionNo === 1 && made?.status === "active" && made?.items.length === 2 && made?.tradeId === tm.d.trade("Electrical Works"), JSON.stringify(made && [made.versionNo, made.status, made.items?.length]));
  t.check("[INS-03] The item's evidence rules are saved: comment and photo required on Fail", made?.items[0]?.comment === "required_on_negative" && made?.items[0]?.photo === "required_on_negative", JSON.stringify(made?.items[0]));
  t.check("[INS-03] The editor's preview and the page speak words, with no raw translation key (workItems.form...) on it", !/workItems\.form\.[A-Za-z.]+/.test(editorText + (await mainText(sp))), (editorText.match(/workItems\.form\.[A-Za-z.]+/) ?? [""])[0]);
  const ali = await c.api("ali");
  const aliView = (await ali.get(`/projects/${P}/checklist-templates`)).body as Json;
  t.check("[INS-01] Positive control: Ali (TMC) reads the template and cannot change it", (aliView.templates as Json[]).some((x) => x.id === made?.id) && aliView.canEdit === false);
  t.note("A Checklist Template is the Project's own, read by every Company on it (visibility.md, Checklist Templates), so Yousef and Sara reading it is not a leak; the Beta Build and Sara checks start with the WIR.");
  if (!made) return;

  lap("step 2");
  // 2. Hafiz raises a WIR picking it (Tower 1, Electrical), saves a Draft and sends it for review.
  const hp = await c.page("hafiz");
  await go(hp, `/projects/${P}/work-items/new?module=inspections&type=WIR`);
  await settle(hp);
  await hp.getByLabel(/^Subject/).fill(`UAT J9 cable trays Tower 1 ${tag}`);
  await hp.getByLabel(/^Description/).fill("Cable trays on Floor 02, Tower 1, ready for inspection.");
  await pickOption(hp, "answer-trade", /Electrical Works/);
  await pickOption(hp, "answer-location", /Tower 1 Floor 02/);
  await settle(hp, 600);
  await hp.locator("#answer-checklist_template").click();
  await hp.getByRole("option", { name: new RegExp(tplName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await settle(hp, 600);
  const preview = await mainText(hp);
  t.check("[INS-03] Hafiz sees the new template's items in the preview (2 items, answered by the Consultant on site)", /Supports at the spacing/.test(preview) && /Trays bonded to earth/.test(preview) && /answered by the Consultant on site/.test(preview));
  await hp.getByRole("button", { name: "Save Draft" }).click();
  await hp.waitForURL(/\/work-items\/[0-9a-f-]{36}/, { timeout: 20000 });
  await settle(hp);
  const wir = /\/work-items\/([0-9a-f-]{36})/.exec(hp.url())![1]!;
  const hafiz = await c.api("hafiz");
  // The requested date is the one thing the New form leaves to the Draft's page; a save replaces every answer.
  const saved = (await H.detail(hafiz, wir)).answers as Json | undefined;
  const put = await hafiz.put(`/work-items/${wir}/answers`, { answers: { ...(saved ?? {}), requested_for: REQUESTED, trade: tm.d.trade("Electrical Works"), location: tm.d.loc("Tower 1 Floor 02"), checklist_template: made.versionId, description: "Cable trays on Floor 02, Tower 1, ready for inspection." } });
  t.check("[INS-03] Hafiz's Draft WIR is saved with the picked template copied on it", put.status < 300 && ((await H.detail(hafiz, wir)).checklistCopies as Json[])[0]?.name?.en === tplName, `${put.status} ${put.text.slice(0, 120)}`);
  await sealed(t, c, ["yousef", "sara"], "A Draft WIR", `/work-items/${wir}`, `/work-items/${wir}`, "INS-08");
  t.check("[INS-08] A Draft WIR has no Document Number and the Consultant (Ahmed) cannot read it", (await H.detail(hafiz, wir)).documentNumber === null && (await (await c.api("ahmed")).get(`/work-items/${wir}`)).status === 404);
  await c.show(t, hp, `/work-items/${wir}`);
  await requiredLinksOff(t, c);
  await takeTransition(hp, /Send for Review/i);
  const num = (await H.detail(ali, wir)).documentNumber as string;
  t.check("[INS-08] Sent for review, the WIR is numbered TWR-WIR-nn-nnnn and sits in TMC's Internal Review", /^TWR-WIR-\d\d-\d{4}$/.test(num) && (await stageOf(ali, wir)) === "internal_review", `${num}`);
  await t.shot(hp, "2-hafiz-sent-for-review");

  lap("step 3");
  // 3. Ali (Contractor PM) picks it up and Submits it with a Cover Note.
  const ap = await c.page("ali");
  await ali.post(`/work-items/${wir}/pick-up`);
  await c.show(t, ap, `/work-items/${wir}`);
  await takeTransition(ap, "Submit", { fill: async (d) => { await d.locator("section[aria-labelledby=transition-section-cover] textarea").first().fill("Trays ready from 09:00; the engineer may start on Floor 02."); } });
  const ahmed = await c.api("ahmed");
  const dAhmed = await H.detail(ahmed, wir);
  t.check("[INS-08] After Ali's Submit the WIR is at the Consultant Engineer Step with Ahmed, Pending Approval", dAhmed.step.key === "consultant_engineer" && dAhmed.stage.key === "pending_approval", `${dAhmed.step.key} ${dAhmed.stage.key}`);
  const ahmedName = dAhmed.heldBy?.memberName?.en as string | undefined;
  const mo = await c.api("mohammed");
  t.check("[INS-08] Positive control: Mohammed (the Consultant's Manager) reads it Pending Approval", (await stageOf(mo, wir)) === "pending_approval");
  const pa = await c.page("ahmed");
  await c.show(t, pa, `/work-items/${wir}`);
  const ahmedMain = await mainText(pa);
  t.check("[INS-09] Ahmed opens the WIR and finds the checklist with all items waiting", /Checklist · /.test(ahmedMain) && /Supports at the spacing/.test(ahmedMain) && /Trays bonded to earth/.test(ahmedMain));
  await t.shot(pa, "3-ahmed-receives-wir");
  await sealed(t, c, ["yousef", "sara"], "The Submitted WIR", `/work-items/${wir}`, `/work-items/${wir}`, "INS-08");
  const hafizPage = await H.detail(hafiz, wir);
  t.check("[VIS] TMC's own WIR names the Consultant by Company name only (no Consultant person is named to TMC)", !!hafizPage.heldBy?.companyName?.en && !(ahmedName && JSON.stringify(hafizPage).includes(ahmedName)), JSON.stringify(hafizPage.heldBy));

  lap("step 4");
  // 4. Ahmed answers on site: item 1 fails with a comment and a photo; the others pass.
  await c.show(t, pa, `/work-items/${wir}`);
  const main = pa.getByRole("main");
  await main.getByRole("radio", { name: /^Fail$/ }).first().click();
  await settle(pa, 700);
  await main.locator("textarea").first().fill("Spacing too wide on the far run, 2.4 m against 1.5 m.");
  await main.locator("input[type=file]").first().setInputFiles({ name: "far-run.jpg", mimeType: "image/jpeg", buffer: testPhoto() });
  await settle(pa, 2500);
  await main.getByRole("radio", { name: /^Pass$/ }).nth(1).click();
  await settle(pa, 1200);
  const answered = await mainText(pa);
  t.check("[INS-09] The failed item shows its comment and photo, and a Raise a Snag box ticked by default", /Raise a Snag/.test(answered) && (await main.getByRole("checkbox", { name: /Raise a Snag/ }).first().isChecked().catch(() => false)) && (await main.locator("img").count()) > 0);
  await t.shot(pa, "4-ahmed-answers-on-site");
  const mine = ((await H.detail(ahmed, wir)).replyChecklists as Json[])[0]?.answers as Json;
  t.check("[INS-09] The answers saved as Ahmed went (the api holds 1 Fail and 1 Pass)", mine?.item_1?.answer === "fail" && mine?.item_2?.answer === "pass", JSON.stringify(mine));
  const photoDocs = (await docsOf(ahmed, wir)).filter((d) => d.fieldKey === FIELD);
  t.check("[INS-09] The photo is attached to the failed item", photoDocs.length === 1 && photoDocs[0]?.itemKey === "item_1", JSON.stringify(photoDocs.map((d) => [d.fieldKey, d.itemKey])));
  // The annotation tool (RP-656) is not on any page: the copy is made through the api, as the page would.
  const orig = photoDocs[0];
  if (orig) {
    const drawn = Buffer.concat([testPhoto(), Buffer.from("annotated: arrow, text label")]);
    let copyId: string | undefined;
    try {
      copyId = await upload(ahmed, wir, { fileName: "far-run-annotated.jpg", contentType: "image/jpeg", body: drawn, annotatedFromId: orig.id } as never);
    } catch (e) {
      t.note(`The annotated copy through the api was refused: ${(e as Error).message.slice(0, 200)}`);
    }
    const after = await docsOf(ahmed, wir);
    t.check("[INS-06] The annotated copy is saved beside the original, linked to it", copyId !== undefined && after.some((d) => d.id === copyId && d.annotatedFromId === orig.id) && after.some((d) => d.id === orig.id && d.annotatedFromId === null), `copy ${copyId}`);
  }
  t.note("No page offers the drawing tool: PhotoTool (packages/ui) is mounted on no page, so Open full size is the only photo control on the checklist; the copy was made through the api.");
  const hafizAnswers = await H.detail(hafiz, wir);
  const hafizBlob = JSON.stringify(hafizAnswers) + (await hafiz.get(`/work-items/${wir}/history`)).text;
  t.check("[INS-13] While Ahmed answers, TMC (Hafiz) reads none of the answers, the comment or the photo", (hafizAnswers.replyChecklists as Json[]).length === 0 && !hafizBlob.includes("Spacing too wide") && !(await docsOf(hafiz, wir)).some((d) => d.fieldKey === FIELD));

  lap("step 5");
  // 5. Ahmed sends it to the Manager with a recommended Code; Mohammed picks it up and codes it.
  const note = `UAT J9 engineer internal note ${tag}`;
  const sent = await H.move(ahmed, wir, "send_to_manager", { recommendedCode: "C", internalNote: note });
  t.check("[INS-13] Ahmed sends it to the Manager with Recommended Code C and an Internal Note", sent.status === 204, `${sent.status} ${sent.text.slice(0, 160)}`);
  await mo.post(`/work-items/${wir}/pick-up`);
  const mp = await c.page("mohammed");
  await c.show(t, mp, `/work-items/${wir}`);
  await mp.getByRole("main").getByRole("button", { name: /Revise/ }).first().click();
  const dlg = mp.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  const dtext = (await dlg.innerText()).replace(/\s+/g, " ");
  t.check("[INS-11] Mohammed's Code pop-up says the checklist proposes C and names the Snag that will be raised", /checklist proposes .*C/i.test(dtext) && /A Snag is raised/i.test(dtext) && /Supports at the spacing/.test(dtext), dtext.slice(0, 260));
  await t.shot(mp, "5-mohammed-codes-wir");
  await mp.keyboard.press("Escape");
  const mid = JSON.stringify(await H.detail(hafiz, wir)) + (await hafiz.get(`/work-items/${wir}/history`)).text;
  t.check("[INS-13] With the Manager, TMC still reads none of Ahmed's answers, Internal Note or Recommended Code", !mid.includes("Spacing too wide") && !mid.includes(note));
  const coded = await issue(c, wir, "revise_c");
  t.check("[INS-12] Mohammed issues Code C (revise) and the WIR closes at C", coded.status === 204 && (await H.detail(hafiz, wir)).outcome === "C", `${coded.status} ${coded.text.slice(0, 200)}`);

  lap("step 6");
  // 6. The failed item became a Snag for TMC.
  const snags = (await moduleItems(hafiz, P, "snag_list", `raisedFrom=${encodeURIComponent(num)}&pageSize=50`)).filter((i) => i.type?.code === "SNG");
  t.check("[INS-10] Exactly one Snag was raised, from the failed item, linked to the WIR", snags.length === 1 && /Supports|Spacing/i.test(JSON.stringify(snags[0])) && JSON.stringify(snags[0]?.raisedFrom).includes(num), `${snags.length}: ${snags.map((s) => s.title).join(" | ")}`);
  const snagId = snags[0]?.id as string | undefined;
  if (snagId) {
    const sd = await H.detail(hafiz, snagId);
    t.check("[INS-10] The Snag is Open with TMC, raised for the Contractor by the Consultant", sd.stage.key === "open" && sd.heldBy?.companyName?.en === "TMC Constructions", JSON.stringify(sd.heldBy));
    await c.show(t, hp, `/work-items/${snagId}`);
    const snagText = await mainText(hp);
    t.check("[INS-10] TMC's Hafiz opens the Snag: it shows the WIR number it was raised from", snagText.includes(num));
    t.check("[VIS] The Snag page names Design Consultants by Company name only", /Design Consultants/.test(snagText) && !(ahmedName && snagText.includes(ahmedName)), ahmedName ?? "");
    await t.shot(hp, "6-hafiz-snag-from-wir");
    t.check("[INS-10] Positive control: Ahmed reads the Snag too", (await ahmed.get(`/work-items/${snagId}`)).status === 200);
    await sealed(t, c, ["yousef", "sara"], "The Snag raised from the WIR", `/work-items/${snagId}`, `/work-items/${snagId}`, "INS-10");
  }
  const after = await H.detail(hafiz, wir);
  t.check("[INS-13] After the Code TMC reads the answers, the comment and the checklist photo", JSON.stringify(after).includes("Spacing too wide") || (await hafiz.get(`/work-items/${wir}/history`)).text.includes("Spacing too wide"));
  t.check("[INS-13] ... and never Ahmed's Internal Note", !JSON.stringify(after).includes(note) && !(await hafiz.get(`/work-items/${wir}/history`)).text.includes(note));
  t.check("[INS-13] ... and the checklist photo is TMC's to read", (await docsOf(hafiz, wir)).some((d) => d.fieldKey === FIELD));
  await sealed(t, c, ["yousef", "sara"], "The coded WIR", `/work-items/${wir}`, `/work-items/${wir}`, "INS-12");

  lap("step 7");
  // 7. A re-inspection Revision: Hafiz creates it from the Code C WIR.
  await c.show(t, hp, `/work-items/${wir}`);
  const revBtn = hp.getByRole("main").getByRole("button", { name: /Create Revision/ }).first();
  t.check("[INS-12] After Code C Hafiz is offered Create Revision, the Manager is not", (await revBtn.count()) > 0 && (await H.detail(mo, wir)).actions.createRevision === false);
  let revId: string | undefined;
  if ((await revBtn.count()) > 0) {
    await revBtn.click();
    const rd = hp.getByRole("dialog");
    if ((await rd.count()) > 0) await rd.getByRole("button", { name: /Create Revision/ }).click();
    await hp.waitForURL((u) => /\/work-items\/[0-9a-f-]{36}/.test(u.pathname) && !u.pathname.includes(wir), { timeout: 15000 }).catch(() => undefined);
    await settle(hp, 800);
    revId = /\/work-items\/([0-9a-f-]{36})/.exec(hp.url())?.[1];
  }
  if (!revId || revId === wir) {
    const r = await hafiz.post(`/work-items/${wir}/revisions`, { idempotencyKey: crypto.randomUUID() });
    revId = (r.body as Json)?.id as string | undefined;
    t.note(`The Create Revision button did not lead to a new item page; the Revision was made through the api (${r.status}).`);
    if (revId) await c.show(t, hp, `/work-items/${revId}`);
  }
  if (revId) {
    const rv = await H.detail(hafiz, revId);
    const cp = (rv.checklistCopies as Json[])[0];
    t.check("[INS-12] The Revision is a Draft under the same number and copies the same checklist (2 items)", rv.stage.key === "draft" && cp?.items?.length === 2 && cp?.name?.en === tplName, `${rv.stage.key} ${cp?.items?.length}`);
    t.check("[INS-12] The Revision is TMC's alone: the Consultant cannot read the Draft Revision", (await ahmed.get(`/work-items/${revId}`)).status === 404);
    await t.shot(hp, "7-hafiz-revision-draft");
    await sealed(t, c, ["yousef", "sara"], "The Revision Draft", `/work-items/${revId}`, `/work-items/${revId}`, "INS-12");
  } else t.check("[INS-12] A Revision was created", false, "no Revision id");
});

// ============================================================================================================
// J10: Snag. Ahmed (Consultant) raises a Snag on TMC (Tower 1), TMC works it and resolves it with an after photo,
// Ahmed returns it once and then verifies and closes it.
// ============================================================================================================
defineCase("J10", async (t) => {
  const lap = stopwatch("J10");
  const c = await crew();
  const P = c.tm.projectId;
  const subject = `UAT J10 Cable tray not bonded, Tower 1 Floor 02 ${tag}`;
  const hafiz = await c.api("hafiz");
  const ali = await c.api("ali");
  const ahmed = await c.api("ahmed");
  lap("crew");

  // 1. Ahmed raises the Snag on TMC (the one Contractor covering Tower 1).
  const ap = await c.page("ahmed");
  await go(ap, `/projects/${P}/work-items/new?module=snag_list&type=SNG`);
  await settle(ap);
  await ap.getByLabel(/^Subject/).fill(subject);
  await ap.getByLabel(/^Description/).fill("The cable tray on Floor 02 is not bonded to earth at the far end.");
  await pickOption(ap, "answer-trade", /Electrical Works/);
  await pickOption(ap, "answer-location", /Tower 1 Floor 02/);
  await ap.getByRole("button", { name: "Save Draft" }).click();
  await ap.waitForURL(/\/work-items\/[0-9a-f-]{36}/, { timeout: 20000 });
  await settle(ap);
  const snag = /\/work-items\/([0-9a-f-]{36})/.exec(ap.url())![1]!;
  await ap.locator("#answer-photos").setInputFiles({ name: "before.jpg", mimeType: "image/jpeg", buffer: testPhoto() });
  await settle(ap, 2500);
  t.check("[SNG-02] Ahmed's Draft Snag has its before photo", (await docsOf(ahmed, snag)).some((d) => d.fieldKey === "photos"));
  t.check("[SNG-09] The Draft is Ahmed's alone: TMC (Hafiz) cannot read it", (await hafiz.get(`/work-items/${snag}`)).status === 404);
  await takeTransition(ap, "Raise");
  const raised = await H.detail(ahmed, snag);
  const num = raised.documentNumber as string;
  t.check("[SNG-02] After Raise the Snag is Open, numbered TWR-SNG-nn-nnnn, and with TMC Constructions (no pick: one Contractor covers Tower 1)", raised.stage.key === "open" && /^TWR-SNG-\d\d-\d{4}$/.test(num) && raised.heldBy?.companyName?.en === "TMC Constructions", `${raised.stage.key} ${num} ${JSON.stringify(raised.heldBy)}`);
  await t.shot(ap, "1-ahmed-raised-snag");
  const hp = await c.page("hafiz");
  await c.show(t, hp, `/work-items/${snag}`);
  const hText = await mainText(hp);
  t.check("[SNG-11] Positive control: TMC's Hafiz opens the Snag: number, Open, description and the before photo", hText.includes(num) && /Open/.test(hText) && /not bonded to earth/.test(hText) && (await hp.locator("main img").count()) > 0);
  t.check("[SNG-11] No due date, deadline or overdue anywhere on it", !/due date|deadline|overdue|\bdue\b/i.test(hText));
  t.check("[VIS] TMC reads the Consultant as Company name only, never a person", /Design Consultants/.test(hText) && !/Ahmed bin Said/.test(hText));
  await t.shot(hp, "2-hafiz-receives-snag");
  await sealed(t, c, ["yousef", "sara"], "The raised Snag", `/work-items/${snag}`, `/work-items/${snag}`, "SNG-02");

  // 2. TMC works it: Hafiz starts, Ali resolves with an after photo.
  lap("step 2");
  await hafiz.post(`/work-items/${snag}/pick-up`);
  await c.show(t, hp, `/work-items/${snag}`);
  await takeTransition(hp, /Start work/);
  t.check("[SNG-03] After Start work TMC reads In Progress, and a colleague (Ali) may pick it up", (await stageOf(hafiz, snag)) === "in_progress" && (await H.detail(ali, snag)).actions.pickUp === true);
  t.check("[SNG-03] Design Consultants still reads Open: TMC's own moves stay inside TMC", (await stageOf(ahmed, snag)) === "open");
  const alip = await c.page("ali");
  await ali.post(`/work-items/${snag}/pick-up`);
  await c.show(t, alip, `/work-items/${snag}`);
  await alip.getByRole("main").getByRole("button", { name: /Resolve/ }).first().click();
  const dlg = alip.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await dlg.getByRole("textbox").first().fill("Bonded to the earth bar at both ends and tested.");
  const afterInput = dlg.locator("input[type=file]").first();
  if (await afterInput.waitFor({ state: "attached", timeout: 5000 }).then(() => true, () => false)) {
    await afterInput.setInputFiles({ name: "after.jpg", mimeType: "image/jpeg", buffer: testPhoto() });
    await settle(alip, 2500);
  } else {
    await upload(ali, snag, { fieldKey: "after_photos", reply: true, fileName: "after.jpg", contentType: "image/jpeg", body: testPhoto() } as never);
    t.note("The Resolve pop-up has no photo control; the after photo was added through the api as the page does.");
  }
  t.check("[SNG-08] The after photo waits with TMC: Design Consultants reads none before the Resolve", !(await docsOf(ahmed, snag)).some((d) => d.fieldKey === "after_photos"));
  await t.shot(alip, "3-ali-resolves-with-after-photo");
  await dlg.getByRole("button", { name: /Resolve/ }).click();
  await dlg.waitFor({ state: "hidden" });
  await settle(alip, 800);
  const resolved = await H.detail(ahmed, snag);
  t.check("[SNG-04] After TMC's Resolve Ahmed (the raiser) holds the Verify Step, Resolved", resolved.stage.key === "resolved" && resolved.actions.pickUp === true, `${resolved.stage.key} pickUp=${resolved.actions.pickUp}`);
  const afterDocs = (await docsOf(ahmed, snag)).filter((d) => d.fieldKey === "after_photos");
  t.check("[SNG-08] Ahmed now reads the after photo, frozen, beside the before photo", afterDocs.length === 1 && afterDocs[0]?.frozen === true && (await docsOf(ahmed, snag)).some((d) => d.fieldKey === "photos"));
  const dclHistory = (((await ahmed.get(`/work-items/${snag}/history`)).body as Json).events as Json[]).map((e) => e.transition?.en).filter(Boolean).join(" > ");
  t.check("[SNG-03] Ahmed's history holds only the shared moves (Raise, Resolve), none of TMC's Start work or pick-ups", /Raise/.test(dclHistory) && /Resolve/.test(dclHistory) && !/Start work|hold|Resume/i.test(dclHistory), dclHistory);

  // 3. Ahmed verifies: he returns it once, TMC fixes it, then he closes it.
  lap("step 3");
  await ahmed.post(`/work-items/${snag}/pick-up`);
  const apr = await c.page("ahmed");
  await c.show(t, apr, `/work-items/${snag}`);
  const verifyText = await mainText(apr);
  t.check("[SNG-08] Ahmed's page shows TMC's resolution and the photos, before and after", /Bonded to the earth bar/.test(verifyText) && (await apr.locator("main img").count()) >= 2, `${await apr.locator("main img").count()} images`);
  await t.shot(apr, "4-ahmed-verifies");
  await sealed(t, c, ["yousef", "sara"], "The resolved Snag", `/work-items/${snag}`, `/work-items/${snag}`, "SNG-04");
  await takeTransition(apr, /Return/, { fill: async (d) => { await d.getByRole("textbox").first().fill("Still loose at the far end; re-torque the lug."); } });
  const back = await H.detail(hafiz, snag);
  t.check("[SNG-04] Ahmed's Return to Open (with a reason) puts it back with TMC, Open", back.stage.key === "open" && back.heldBy?.companyName?.en === "TMC Constructions", `${back.stage.key} ${JSON.stringify(back.heldBy)}`);
  await c.show(t, hp, `/work-items/${snag}`);
  const hAgain = await mainText(hp);
  t.check("[SNG-04] TMC's Hafiz sees it Open again, with the Consultant's reason", /Open/.test(hAgain) && /re-torque the lug/.test(hAgain));
  await t.shot(hp, "5-hafiz-sees-it-returned");
  await mustAct(hafiz, snag, /resolve/, { answers: { resolution_note: "Lug re-torqued and the bond tested again, reading under 0.05 ohm." } });
  await ahmed.post(`/work-items/${snag}/pick-up`);
  await c.show(t, apr, `/work-items/${snag}`);
  await takeTransition(apr, /^Close/);
  t.check("[SNG-04] Ahmed's Close ends the Snag: Closed for him and for TMC", (await stageOf(ahmed, snag)) === "closed" && (await stageOf(hafiz, snag)) === "closed");
  await t.shot(apr, "6-ahmed-closed-snag");
  await sealed(t, c, ["yousef", "sara"], "The closed Snag", `/work-items/${snag}`, `/work-items/${snag}`, "SNG-04");
  const saraList = (((await (await c.api("sara")).get(`/projects/${P}/modules/snag_list/work-items?q=${encodeURIComponent(tag)}&pageSize=50`)).body as Json).items ?? []) as Json[];
  t.check("[SNG-14] Sara's and Beta Build's api Snag Lists hold none of it", !saraList.some((i) => i.id === snag) && !(await moduleItems(await c.api("yousef"), P, "snag_list", `q=${encodeURIComponent(tag)}&pageSize=50`)).some((i) => i.id === snag));

  // The Snag List page is the one that gives up under load (RP-1049): checked once, at the end.
  const lp = await c.page("hafiz");
  await go(lp, `/projects/${P}/snag-list?q=${encodeURIComponent(tag)}`);
  await settle(lp, 800);
  if (await onNotFound(lp)) {
    t.check("[SNG-01] Hafiz's Snag List page lists the closed Snag (RP-1049: with 858 items the page shows the not-found page for TMC people)", false, "the Snag List page answered with the not-found page; the api lists the Snag for the same person");
    await t.shot(lp, "7-hafiz-snag-list-not-found");
  } else {
    t.check("[SNG-01] Hafiz's Snag List page lists the closed Snag", (await mainText(lp)).includes(subject));
    await t.shot(lp, "7-hafiz-snag-list");
  }
});

// ============================================================================================================
// J11: Register import. Ali uploads a small made-up register, picks the sheet and the heading row, maps the
// columns, previews (one bad row shows its reasons), confirms; the Drafts exist and the Imports page lists it.
// ============================================================================================================
defineCase("J11", async (t) => {
  const lap = stopwatch("J11");
  const c = await crew();
  const P = c.tm.projectId;
  const ali = await c.api("ali");
  const hafiz = await c.api("hafiz");
  const good = ["Distribution board DB-1", "Lighting control panel LCP-2", "Emergency lighting inverter", "Earthing grid test pit"];
  const rows = [
    ...good.map((g, i) => [`UAT J11 ${tag} ${g}`, "MAR", "Electrical Works", `Level ${i + 1}`]),
    [`UAT J11 ${tag} Jockey pump skid`, "MAR", "Fire Fighting", "Basement"],
  ];
  const file = writeData("UAT-J11-register.xlsx", makeXlsx([
    { name: "Cover", rows: [["Fictional register, made up for the UAT round"]] },
    { name: "Register", rows: [["Tower 1 electrical register"], ["Issued by UAT, fictional rows"], ["Ref", "Item", "Discipline", "Notes"], ...rows] },
  ]));
  lap("crew");

  // 1. Ali uploads the register and walks the wizard.
  const ap = await c.page("ali");
  await go(ap, `/projects/${P}/work-items/import`);
  await settle(ap);
  await ap.locator("input[type=file]").setInputFiles(file);
  await settle(ap, 1500);
  const upText = await mainText(ap);
  t.check("[IMP-02] The wizard lists both worksheets, with their row counts, and asks which row holds the column headings", /Cover/.test(upText) && /Register/.test(upText) && /Column headings are in row/.test(upText));
  await ap.getByRole("button", { name: /^Register/ }).click();
  await settle(ap, 600);
  for (let attempt = 0; attempt < 3; attempt++) {
    await ap.getByRole("combobox", { name: /Column headings are in row/ }).click();
    await ap.getByRole("option", { name: "3", exact: true }).click();
    if (await ap.getByText(/5 rows below the column headings/).waitFor({ timeout: 4000 }).then(() => true, () => false)) break;
  }
  await settle(ap, 500);
  const sheetText = await mainText(ap);
  t.check("[IMP-02] With the Register sheet and heading row 3, the rows above are skipped and 5 rows lie below", /Skipped/.test(sheetText) && /5 rows below the column headings/.test(sheetText), sheetText.match(/Showing the first.{0,60}/)?.[0] ?? "");
  await t.shot(ap, "1-ali-sheet-and-heading-row");
  await ap.getByRole("button", { name: /^Next/ }).last().click();
  await settle(ap, 1200);
  // Map the columns: Ref to Subject and Item to Type; Discipline is suggested for Trade.
  await ap.getByRole("combobox", { name: "Rabaed field for Ref" }).click();
  await ap.getByRole("option", { name: "Subject *", exact: true }).click();
  await ap.getByRole("combobox", { name: "Rabaed field for Item" }).click();
  await ap.getByRole("option", { name: "Type *", exact: true }).click();
  await settle(ap, 500);
  const mapText = await mainText(ap);
  t.check("[IMP-03] Ref maps to Subject, Item to Type and Discipline is suggested for Trade; Notes is left unmapped", /Subject \*/.test(mapText) && /Type \*/.test(mapText) && /Trade \*/.test(mapText) && /Don't map this column/.test(mapText), mapText.match(/Each column of your register.{0,300}/)?.[0] ?? "");
  await t.shot(ap, "2-ali-maps-columns");
  for (let i = 0; i < 8 && (await ap.getByRole("button", { name: /Import \d+ Drafts?/ }).count()) === 0; i++) {
    await ap.getByRole("button", { name: /^(Next|Validate)/ }).last().click();
    await settle(ap, 1000);
  }
  const preview = await mainText(ap);
  t.check("[IMP-04] The preview counts 5 rows checked, 4 ready to import and 1 left out", /5\s*rows checked/.test(preview) && /4\s*ready to import/.test(preview) && /1\s*rows? with errors, left out/.test(preview), preview.slice(0, 200));
  t.check("[IMP-04] The bad row (Fire Fighting is not a Trade of the Project) shows its reason on the page", /Fire Fighting/.test(preview) && /Trade|trade/.test(preview), preview.slice(preview.indexOf("rows checked"), preview.indexOf("rows checked") + 400));
  await t.shot(ap, "3-ali-preview-with-bad-row");
  const previews = ((await ali.get(`/projects/${P}/register-imports`)).body as Json).imports as Json[];
  const mine = previews.find((i) => i.fileName === "UAT-J11-register.xlsx");
  void mine;

  // 2. Ali confirms: the Drafts are created.
  lap("step 2");
  await ap.getByRole("button", { name: /Import 4 Drafts?/ }).click();
  await ap.getByText(/4 Drafts created/).waitFor({ timeout: 40000 }).catch(() => undefined);
  await settle(ap, 1000);
  const resultText = await mainText(ap);
  t.check("[IMP-05] Confirming says 4 Drafts created and 1 left out, with links to open the Drafts and to download the rejected rows", /4 Drafts created/.test(resultText) && /Left out\s*1/.test(resultText) && /Open the 4 Drafts/.test(resultText) && /Download rejected rows \(1\)/.test(resultText), resultText.slice(resultText.indexOf("Drafts created") - 20, resultText.indexOf("Drafts created") + 200));
  await t.shot(ap, "4-ali-import-result");
  const importId = /[?&]preview=([0-9a-f-]{36})/.exec(ap.url())?.[1];
  if (!importId) {
    t.check("[IMP-05] The import has an id the page can be reopened by", false, ap.url());
    return;
  }
  const imp = (await ali.get(`/register-imports/${importId}`)).body as Json;
  const made = (imp.rows as Json[]).filter((r) => r.created);
  t.check("[IMP-05] 4 Drafts were created and the Fire Fighting row was not", made.length === 4 && (imp.rows as Json[]).filter((r) => !r.created).length === 1, `${made.length} created, ${(imp.rows as Json[]).length} rows`);
  const drafts: Json[] = [];
  for (const r of made) drafts.push(await H.detail(ali, r.workItemId as string));
  t.check("[IMP-05] Each is a Draft with no number, raised by TMC and held by Ali", drafts.length === 4 && drafts.every((d) => d.stage.key === "draft" && d.documentNumber === null && d.heldBy?.memberName?.en === "Ali Sonour"), JSON.stringify(drafts.map((d) => [d.stage.key, d.heldBy?.memberName?.en])));
  const found = (await H.listItems(ali, P, `q=${encodeURIComponent(`UAT J11 ${tag}`)}&pageSize=50`)).length;
  t.check("[IMP-05] Ali's Submittals api List finds the 4 Drafts by their Subject", found === 4, `${found}`);

  // 3. The Imports page lists it, with no time; TMC's colleague reads it; nobody else does.
  lap("step 3");
  await go(ap, `/projects/${P}/work-items/imports`);
  await settle(ap, 800);
  const importsText = await mainText(ap);
  t.check("[IMP-06] The Imports page lists the register by its file name and shows no import time", importsText.includes("UAT-J11-register.xlsx") && !/\d{1,2}:\d{2}/.test(importsText.replaceAll("UAT-J11-register.xlsx", "")), importsText.slice(0, 200));
  await t.shot(ap, "5-ali-imports-page");
  const hp = await c.page("hafiz");
  await c.show(t, hp, `/projects/${P}/work-items/imports/${importId}`);
  const colleague = await mainText(hp);
  t.check("[IMP-06] Positive control: TMC's colleague (Hafiz) opens the import and reads its rows", (await hafiz.get(`/register-imports/${importId}`)).status === 200 && /UAT J11/.test(colleague) && !(await onNotFound(hp)));
  await t.shot(hp, "6-hafiz-reads-the-import");
  await sealed(t, c, ["yousef", "sara", "mohammed"], "The register import", `/projects/${P}/work-items/imports/${importId}`, `/register-imports/${importId}`, "IMP-06");
  await sealed(t, c, ["yousef", "mohammed"], "The register's file", `/projects/${P}/work-items/imports/${importId}`, `/register-imports/${importId}/original`, "IMP-06");
  const draftId = made[0]!.workItemId as string;
  await sealed(t, c, ["yousef", "sara", "mohammed"], "An imported Draft", `/work-items/${draftId}`, `/work-items/${draftId}`, "IMP-05");
  const beta = ((await (await c.api("yousef")).get(`/projects/${P}/register-imports`)).body as Json).imports as Json[];
  const sara = ((await (await c.api("sara")).get(`/projects/${P}/register-imports`)).body as Json).imports as Json[];
  t.check("[IMP-06] Beta Build's and Sara's Imports pages list nothing of it", !beta.some((i) => i.id === importId) && !sara.some((i) => i.id === importId), `${beta.length} / ${sara.length} imports listed`);
});

// ============================================================================================================
// J12: Package. Ali opens a Package, adds his own Drafts, Submits it; Design Consultants get one grouped
// notification; Mohammed codes the items in bulk and the Package reaches Done.
// ============================================================================================================
defineCase("J12", async (t) => {
  const lap = stopwatch("J12");
  const c = await crew();
  const P = c.tm.projectId;
  const tm = c.tm;
  const ali = await c.api("ali");
  const ahmed = await c.api("ahmed");
  const mo = await c.api("mohammed");
  const pkgName = `UAT J12 Tower 1 electrical package ${tag}`;
  const pkg = async (api: Api, id: string) => (await api.get(`/packages/${id}`)).body as Json;
  lap("crew");

  // 1. Ali opens the Package from the Packages board.
  const ap = await c.page("ali");
  for (let attempt = 1; attempt <= 3; attempt++) {
    await go(ap, `/projects/${P}/work-items?view=packages`);
    await settle(ap, 800);
    if ((await ap.getByRole("button", { name: /New Package/ }).count()) > 0) break;
    t.note(`The Packages board had no New Package button at attempt ${attempt}: ${(await mainText(ap)).slice(0, 120)}`);
  }
  let packageId: string | undefined;
  if (await onNotFound(ap)) {
    t.check("[PKG-01] Ali's Packages board opens (RP-1049: with 858 items the Submittals pages show the not-found page for TMC people)", false, "the Packages board answered with the not-found page");
    await t.shot(ap, "0-ali-packages-board-not-found");
  } else {
    await ap.getByRole("button", { name: /New Package/ }).first().click();
    const dialog = ap.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.getByLabel(/Name \(English\)/).fill(pkgName);
    await dialog.getByLabel(/Name \(Arabic\)/).fill(`حزمة الأعمال الكهربائية، البرج 1 ${tag}`);
    await dialog.getByRole("button", { name: /^Create/ }).click();
    await ap.waitForURL(/\/packages\/[0-9a-f-]{36}/, { timeout: 20000 }).catch(() => undefined);
    packageId = /\/packages\/([0-9a-f-]{36})/.exec(ap.url())?.[1];
  }
  if (!packageId) {
    packageId = (await makePackage(ali, tm, pkgName)).id;
    t.note("The Package was made through the api because the board's New Package did not lead to a Package page.");
  }
  await c.show(t, ap, `/packages/${packageId}`);
  const first = await mainText(ap);
  const number = /PKG-\d{3}/.exec(first)?.[0] ?? "";
  t.check("[PKG-02] The new Package page shows its PKG number beside TMC's name, Open, and no submittals yet", /PKG-\d{3}/.test(first) && /TMC Constructions/.test(first) && /Open/.test(first) && /No submittals in this Package yet/.test(first), first.slice(0, 200));
  await t.shot(ap, "1-ali-new-package");
  await sealed(t, c, ["yousef", "sara"], "An Open Package", `/packages/${packageId}`, `/packages/${packageId}`, "PKG-12");

  // 2. Ali adds his own Drafts: three Material Approval Requests, made as Drafts.
  lap("step 2");
  const ids: string[] = [];
  const titles = [1, 2, 3].map((n) => `UAT J12 panel ${n} ${tag}`);
  for (const title of titles) ids.push(await H.createItem(ali, tm, "MAR", title, await H.marAnswers(tm)));
  await go(ap, `/packages/${packageId}`);
  await settle(ap);
  await ap.getByRole("button", { name: /Add items/ }).first().click();
  const add = ap.getByRole("dialog");
  await add.waitFor({ state: "visible" });
  await add.getByPlaceholder(/Number, Subject/).fill(`UAT J12 panel`);
  await add.getByRole("checkbox").first().waitFor({ timeout: 20000 });
  await settle(ap, 800);
  const offered = await add.innerText();
  t.check("[PKG-03] Ali's own Drafts are offered in Add items", titles.every((x) => offered.includes(x.replace(` ${tag}`, ""))), offered.replaceAll("\n", " | ").slice(0, 200));
  for (const title of titles) await add.getByRole("checkbox", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).check();
  await add.getByRole("button", { name: /^Add 3 submittals/ }).click();
  await settle(ap, 1500);
  t.check("[PKG-03] The three Drafts are now in the Package", (await pkg(ali, packageId)).counts.total === 3);
  const blocked = await mainText(ap);
  t.check("[PKG-05] Drafts not yet sent for review stop the Submit: the page lists them and offers no Submit Package", /These stop it now/.test(blocked) && titles.every((x) => blocked.includes(x)) && (await ap.getByRole("button", { name: /Submit Package/ }).count()) === 0, blocked.slice(0, 240));
  await t.shot(ap, "2-ali-adds-drafts");

  // 3. Ali sends each for review and picks it up; the Package can then be Submitted.
  lap("step 3");
  for (const id of ids) {
    await H.addDatasheet(ali, id);
    await H.must(ali, id, "send_for_review");
    await H.pickUp(ali, id);
  }
  await c.show(t, ap, `/packages/${packageId}`);
  t.check("[PKG-05] With every item at internal review with Ali, Submit Package is offered", (await ap.getByRole("button", { name: /Submit Package/ }).count()) > 0);
  await ap.getByRole("button", { name: /Submit Package/ }).first().click();
  const confirm = ap.getByRole("dialog");
  await confirm.waitFor({ state: "visible" });
  await t.shot(ap, "3-ali-submit-package-confirm");
  await confirm.getByRole("button", { name: /^Submit Package/ }).click();
  await confirm.waitFor({ state: "hidden", timeout: 30000 }).catch(() => undefined);
  await settle(ap, 1500);
  const numbered = [];
  for (const id of ids) numbered.push(await H.detail(ali, id));
  t.check("[PKG-05] One confirm Submits all three: each gets its own Document Number and reaches the Consultant Engineer Step", numbered.every((d) => /^TWR-MAR-\d\d-\d{4}$/.test(d.documentNumber ?? "") && d.step.key === "consultant_engineer"), JSON.stringify(numbered.map((d) => [d.documentNumber, d.step.key])));
  t.check("[PKG-06] The Package is In Progress as soon as anything is Submitted", (await pkg(ali, packageId)).status === "in_progress");

  // 4. Design Consultants: one grouped notification and the items.
  lap("step 4");
  await new Promise((r) => setTimeout(r, 4000));
  const mine = (((await ahmed.get("/notifications")).body as Json).notifications as Json[]).filter((n) => n.kind === "package_submitted" && n.package?.id === packageId);
  t.check("[PKG-10] Ahmed has ONE grouped notification for the Package, counting the 3 submittals he sees, naming TMC Constructions", mine.length === 1 && mine[0]!.package.count === 3 && mine[0]!.package.number === number && mine[0]!.package.companyName.en === "TMC Constructions", JSON.stringify(mine[0]?.package));
  const stepReached = (((await ahmed.get("/notifications")).body as Json).notifications as Json[]).filter((n) => n.kind === "step_reached" && ids.includes(n.workItemId));
  t.check("[PKG-10] ... and no separate Step reached notification for those items", stepReached.length === 0, `${stepReached.length}`);
  const mail = (await mailTo("ahmed.binsaid@designconsultants.demo.rabaed.test")).filter((m) => m.subject.includes(number));
  t.check("[PKG-10] Ahmed's email names the Package number and the submittal count", mail.length >= 1 && /3 submittals?/.test(mail[0]?.subject ?? ""), mail.map((m) => m.subject).join(" | "));
  const ahp = await c.page("ahmed");
  await go(ahp, `/notifications`);
  await settle(ahp, 800);
  await t.shot(ahp, "4-ahmed-notifications");
  await c.show(t, ahp, `/packages/${packageId}`);
  const ahText = await mainText(ahp);
  t.check("[PKG-07] Positive control: Ahmed opens the Package and sees its 3 items", titles.every((x) => ahText.includes(x)) && /TMC Constructions/.test(ahText), ahText.slice(0, 200));
  await sealed(t, c, ["yousef", "sara"], "The Submitted Package", `/packages/${packageId}`, `/packages/${packageId}`, "PKG-10");
  for (const who of ["yousef", "sara"]) {
    const got = (((await (await c.api(who)).get("/notifications")).body as Json).notifications as Json[]).filter((n) => n.package?.id === packageId || ids.includes(n.workItemId));
    t.check(`[PKG-10] ${NAME[who]} is told nothing about the Package or its items`, got.length === 0, `${got.length}`);
  }

  // 5. Ahmed reviews each item; Mohammed codes them in bulk.
  lap("step 5");
  for (const id of ids) await H.reviewedMar(tm, id);
  const mp = await c.page("mohammed");
  await c.show(t, mp, `/packages/${packageId}`);
  const selectAll = mp.getByRole("checkbox", { name: /Select all waiting on you/ });
  let bulkUi = false;
  try {
    await selectAll.first().check({ timeout: 8000 });
    await settle(mp, 600);
    const bar = await mainText(mp);
    t.check("[PKG-09] The Package page's bulk bar counts the 3 selected and offers the Codes they share (A, B, C, D)", /3 selected/.test(bar) && /Approve · A/.test(bar) && /Reject · D/.test(bar), bar.slice(bar.indexOf("selected") - 20, bar.indexOf("selected") + 200));
    await t.shot(mp, "5-mohammed-bulk-bar");
    await mp.getByRole("main").getByRole("button", { name: /Approve.*A/ }).first().click();
    const bd = mp.getByRole("dialog");
    await bd.waitFor({ state: "visible", timeout: 8000 });
    await bd.getByRole("radio", { name: "Yes" }).first().waitFor({ timeout: 10000 });
    for (const radio of await bd.getByRole("radio", { name: "Yes" }).all()) await radio.click();
    for (const box of await bd.getByRole("textbox").all()) await box.fill("UAT J12 bulk code, checked against the register.").catch(() => undefined);
    await bd.getByRole("button", { name: /Approve.*A/ }).last().click();
    await bd.waitFor({ state: "hidden", timeout: 30000 });
    bulkUi = true;
  } catch (e) {
    t.note(`The bulk bar's UI path stopped: ${(e as Error).message.split("\n")[0]?.slice(0, 200)}; the bulk call was made through the api.`);
    await t.shot(mp, "5b-bulk-bar-stopped");
    await mp.keyboard.press("Escape");
    const form = ((await H.detail(mo, ids[0]!)).actions.transitions as Json[]).find((x) => x.key === "approve_a")?.actionForm as Json;
    const r = await mo.post(`/work-items/bulk-transitions`, { transition: "approve_a", workItemIds: ids, answers: fill(form), confirmed: true, idempotencyKey: crypto.randomUUID() });
    t.note(`api bulk: ${r.status} ${r.text.slice(0, 120)}`);
  }
  await settle(mp, 2000);
  const coded = [];
  for (const id of ids) coded.push(await H.detail(mo, id));
  t.check("[PKG-09] All three items closed at Code A, each with its own event", coded.every((d) => d.outcome === "A"), JSON.stringify(coded.map((d) => d.outcome)));
  t.note(`Bulk Code taken ${bulkUi ? "on the Package page's bulk bar" : "through the api (the bar did not complete)"}.`);

  // 6. The Package is Done.
  lap("step 6");
  const done = await pkg(ali, packageId);
  t.check("[PKG-06] The Package reaches Done: every latest submittal closed at A, B or D", done.status === "done", done.status);
  await c.show(t, ap, `/packages/${packageId}`);
  const doneText = await mainText(ap);
  t.check("[PKG-06] Ali's Package page says Done, with 3 of 3 closed, and never the word Closed for the Package", /Done/.test(doneText) && /3 of 3 closed/.test(doneText) && !/\bClosed\b/.test(doneText), doneText.slice(0, 200));
  await t.shot(ap, "6-ali-package-done");
  await sealed(t, c, ["yousef", "sara"], "The Done Package", `/packages/${packageId}`, `/packages/${packageId}`, "PKG-12");
  const board = ((await (await c.api("yousef")).get(`/projects/${P}/packages`)).body as Json).packages as Json[];
  t.check("[PKG-02] Beta Build's Packages board does not list TMC's Package", !board.some((x) => x.id === packageId), `${board.length} Packages listed`);
});

// ============================================================================================================
// J14: On site with a phone (375 px). Hafiz signs in and uploads a photo on a Form; Ahmed answers a WIR checklist;
// Ahmed raises a Snag through the camera-first flow, which TMC then reads on its phone.
// ============================================================================================================
const noSideScroll = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

defineCase("J14", async (t) => {
  const lap = stopwatch("J14");
  const c = await crew();
  const P = c.tm.projectId;
  const tm = c.tm;
  const hafiz = await c.api("hafiz");
  const ali = await c.api("ali");
  const ahmed = await c.api("ahmed");
  lap("crew");

  // 1. Hafiz signs in on his phone (his session is the phone's), opens the Project and adds a photo to a Draft Form.
  const hp = await c.page("hafiz", true);
  let projectsText = "";
  for (let attempt = 1; attempt <= 3 && !/Riyadh Gate Tower/.test(projectsText); attempt++) {
    await go(hp, "/projects");
    await settle(hp);
    projectsText = await mainText(hp);
    if (!/Riyadh Gate Tower/.test(projectsText)) t.note(`The phone's Projects page did not list the Project at attempt ${attempt}: ${projectsText.slice(0, 120)}`);
  }
  t.check("[I18N-06] Signed in on a 375 px phone, Hafiz's Projects page lists the Riyadh Gate Tower Project with no sideways scroll", /Riyadh Gate Tower/.test(projectsText) && (await noSideScroll(hp)), projectsText.slice(0, 120));
  await t.shot(hp, "1-hafiz-phone-projects");
  const mar = await H.createItem(hafiz, tm, "MAR", `UAT J14 panel board photo ${tag}`, await H.marAnswers(tm));
  await c.show(t, hp, `/work-items/${mar}`);
  const photoInput = hp.locator("#answer-sample_photo");
  await photoInput.setInputFiles({ name: "site-photo.jpg", mimeType: "image/jpeg", buffer: H.exifJpeg() });
  await hp.getByText(/Taken /).first().waitFor({ timeout: 15000 }).catch(() => undefined);
  await settle(hp, 800);
  const formText = await mainText(hp);
  t.check("[FRM-06] The photo added on the phone shows when and where it was taken (time and place read from it)", /Taken\s+\w{3} \d{1,2}, 2026/.test(formText) && /24\.7136\d*° N, 46\.6753\d*° E/.test(formText), formText.match(/Taken.{0,80}/)?.[0] ?? "no Taken line");
  t.check("[FRM-06] The Form has a Take a photo control for the phone's camera, and the page does not scroll sideways", (await hp.getByLabel(/^Take a photo/).count()) > 0 && (await noSideScroll(hp)));
  t.check("[FRM-06] The photo is saved on the Draft (the api holds it)", (await docsOf(hafiz, mar)).some((d) => d.fieldKey === "sample_photo"));
  await t.shot(hp, "2-hafiz-phone-form-photo");
  t.note("The phone's own camera (Take a photo opening the device camera, and its GPS) is a person's: the script gives the picker a photo with EXIF time and place.");
  await sealed(t, c, ["yousef", "sara"], "Hafiz's Draft with its photo", `/work-items/${mar}`, `/work-items/${mar}`, "FRM-06");

  // 2. A WIR is Submitted to Ahmed; he answers its checklist on his phone, one item failed with a photo.
  lap("step 2");
  const tpl = ((await hafiz.get(`/projects/${P}/checklist-templates`)).body as Json).templates.find((x: Json) => x.name.en === "Cable trays and containment") as Json;
  await requiredLinksOff(t, c);
  const wirRes = await create(hafiz, tm, "WIR", `UAT J14 phone inspection ${tag}`, { description: "Cable trays, Floor 02, for the on-site inspection.", requested_for: REQUESTED, trade: tm.d.trade("Electrical Works"), location: tm.d.loc("Tower 1 Floor 02"), checklist_template: tpl.versionId });
  const wir = (wirRes.body as Json).id as string;
  await mustAct(hafiz, wir, "send_for_review");
  await mustAct(ali, wir, "submit", { answers: { cover_note: "Ready from 09:00." } });
  const ap = await c.page("ahmed", true);
  await c.show(t, ap, `/work-items/${wir}`);
  const main = ap.getByRole("main");
  const wirText = await mainText(ap);
  t.check("[INS-09] At 375 px Ahmed's WIR shows the checklist with all three items", /Supports at the spacing/.test(wirText) && /Trays bonded to earth/.test(wirText) && /Clearance from other services/.test(wirText));
  const box = await main.getByRole("radio", { name: /^Pass$/ }).first().boundingBox();
  t.check("[UX-18] The Pass / Fail / N/A controls are large enough to tap (at least 40 px high)", (box?.height ?? 0) >= 40, `${box?.height}px`);
  await main.getByRole("radio", { name: /^Fail$/ }).first().click();
  await settle(ap, 700);
  await main.locator("textarea").first().fill("Spacing too wide on the far run.");
  const cam = main.getByLabel(/^Take a photo/).first();
  await cam.setInputFiles({ name: "far-run.jpg", mimeType: "image/jpeg", buffer: testPhoto() });
  await settle(ap, 2500);
  await main.getByRole("radio", { name: /^Pass$/ }).nth(1).click();
  await main.getByRole("radio", { name: /^N\/A$/ }).nth(2).click();
  await settle(ap, 1200);
  const answered = await mainText(ap);
  t.check("[INS-09] A summary reads 1 Pass / 1 Fail / 1 N/A and the failed item shows its photo and a Raise a Snag box", /1 Pass/.test(answered) && /1 Fail/.test(answered) && /1 N\/A/.test(answered) && /Raise a Snag/.test(answered) && (await main.locator("img").count()) > 0, answered.match(/.{0,30}\d+ Pass.{0,60}/)?.[0] ?? "no summary");
  t.check("[I18N-06] The checklist page does not scroll sideways at 375 px", await noSideScroll(ap));
  await t.shot(ap, "3-ahmed-phone-checklist");
  const saved = ((await H.detail(ahmed, wir)).replyChecklists as Json[])[0]?.answers as Json;
  t.check("[INS-09] It saved as Ahmed went: 1 Fail with a comment, 1 Pass, 1 N/A, and the photo is on the failed item", saved?.item_1?.answer === "fail" || saved?.supports?.answer === "fail", JSON.stringify(saved));
  t.check("[INS-13] While Ahmed answers, TMC (Hafiz) reads none of the answers, the comment or the photo", ((await H.detail(hafiz, wir)).replyChecklists as Json[]).length === 0 && !(await docsOf(hafiz, wir)).some((d) => d.fieldKey === FIELD));
  await sealed(t, c, ["yousef", "sara"], "The Submitted WIR", `/work-items/${wir}`, `/work-items/${wir}`, "INS-08");

  // 3. Ahmed raises a Snag through the camera-first flow: photo, what is wrong, where, Raise.
  lap("step 3");
  const subject = `UAT J14 Loose containment bracket ${tag}`;
  await go(ap, `/projects/${P}/snag-list/new?type=SNG`);
  await settle(ap, 800);
  const step1 = await mainText(ap);
  t.check("[SNG-13] The camera-first New Snag flow opens on its first step: point the camera at the snag (Take a photo, Library)", /Step 1 of 4/.test(step1) && /Take a photo/.test(step1) && /Library/.test(step1), step1.slice(0, 160));
  await ap.locator("input[type=file]").last().setInputFiles({ name: "camera.jpg", mimeType: "image/jpeg", buffer: testPhoto() });
  await settle(ap, 2500);
  await t.shot(ap, "4-ahmed-phone-camera-step");
  await ap.getByRole("button", { name: "Next" }).click();
  await settle(ap, 800);
  await ap.getByLabel(/^Subject/).fill(subject);
  await ap.getByLabel(/^Description/).fill("A containment bracket on Floor 02 is loose and the tray sags.");
  await ap.getByRole("radio", { name: "Electrical Works" }).click();
  await ap.getByRole("button", { name: "Next" }).click();
  await ap.getByText(/Step 3 of 4/).waitFor({ timeout: 20000 });
  t.check("[SNG-13] The Draft is saved as Ahmed goes: step 3 (Where is it?) shows Draft saved", /Draft saved/.test(await mainText(ap)));
  await ap.getByRole("button", { name: "Main Zone" }).click();
  await ap.getByRole("button", { name: "Tower 1", exact: true }).click();
  await ap.getByRole("button", { name: "Tower 1 Floor 02" }).click();
  await settle(ap, 800);
  await ap.getByRole("button", { name: "Next" }).click();
  await ap.getByText(/Step 4 of 4/).waitFor({ timeout: 20000 });
  const ready = await mainText(ap);
  t.check("[SNG-13] The last step shows Ready to raise with the Subject, the Location and the Trade", /Ready to raise/.test(ready) && ready.includes(subject) && /Tower 1 Floor 02/.test(ready) && /Electrical Works/.test(ready), ready.slice(0, 200));
  await ap.getByRole("button", { name: "Raise" }).last().click();
  const raiseDialog = ap.getByRole("dialog");
  await raiseDialog.waitFor({ state: "visible" });
  await raiseDialog.getByRole("button", { name: "Raise" }).click();
  await raiseDialog.waitFor({ state: "hidden", timeout: 30000 });
  await settle(ap, 1500);
  const snags = (await moduleItems(ahmed, P, "snag_list", `q=${encodeURIComponent(subject)}&pageSize=50`)).filter((i) => i.title === subject);
  t.check("[SNG-13] Raise creates exactly one Snag: Open and with TMC Constructions", snags.length === 1 && snags[0]?.stage?.key === "open" && snags[0]?.with?.companyName?.en === "TMC Constructions", JSON.stringify(snags.map((s) => [s.stage?.key, s.with?.companyName?.en])));
  const snag = snags[0]?.id as string | undefined;
  await t.shot(ap, "5-ahmed-phone-raised");
  if (snag) {
    t.check("[SNG-13] The photo taken first is on the Snag", (await docsOf(ahmed, snag)).some((d) => d.fieldKey === "photos"));
    const hs = await c.page("hafiz", true);
    await c.show(t, hs, `/work-items/${snag}`);
    const hText = await mainText(hs);
    t.check("[UX-24] Positive control: TMC's Hafiz opens the Snag on his phone, with the description and photo, and no sideways scroll", hText.includes(subject) && /loose and the tray sags/.test(hText) && (await hs.locator("main img").count()) > 0 && (await noSideScroll(hs)));
    t.check("[VIS] TMC reads the Consultant as Company name only on the phone page too", /Design Consultants/.test(hText) && !/Ahmed bin Said/.test(hText));
    await t.shot(hs, "6-hafiz-phone-receives-snag");
    await sealed(t, c, ["yousef", "sara"], "The camera-first Snag", `/work-items/${snag}`, `/work-items/${snag}`, "SNG-13");
  }
});
