import { pageAs } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { Api, notFoundFor, openProject, settle, takeTransition } from "../harness/helpers.ts";
import * as H from "../harness/helpers-sub.ts";
import { act, createSnagItem, findByTitle, isNotFoundPage, keysOf, moduleItems, mustAct, RP1049, runTag, team, upload, testPhoto, type Json, type Team } from "../harness/helpers-sng.ts";
import { goRetry as go } from "../harness/helpers-sng.ts";

// Part SNG: the Snag List (RP-28). Items are made through the api as the people do; the pages are
// opened and read as the person would, and the checks pair every refusal with who does see it.

const tag = runTag();

/** A Radix select of the New form: open it by its id and click the option. */
async function pickOption(page: import("playwright").Page, id: string, name: RegExp): Promise<void> {
  await page.locator("#" + id).click();
  await page.getByRole("option", { name }).first().click();
}
const events = async (api: Api, id: string): Promise<Json[]> => ((await api.get(`/work-items/${id}/history`)).body as Json).events;
const stageOf = async (api: Api, id: string) => (await H.detail(api, id)).stage.key as string;
const status = async (api: Api, id: string) => (await api.get(`/work-items/${id}`)).status;

/** A Snag raised by Mohammed on Tower 1 Floor 02 (TMC alone covers Tower 1 with FX-C2): Open with TMC. */
async function openSnag(tm: Team, title: string, over: Json = {}): Promise<string> {
  const mo = tm.api.mohammed!;
  const id = await createSnagItem(mo, tm, "SNG", title, over);
  await upload(mo, id, { fieldKey: "photos", fileName: "before.jpg", contentType: "image/jpeg", body: testPhoto() });
  await mustAct(mo, id, "raise");
  return id;
}

/** Hafiz picks up (if needed) and takes the move. */
const hafizDoes = (tm: Team, id: string, key: string | RegExp, extra: Json = {}) => mustAct(tm.api.hafiz!, id, key, extra);

defineCase("SNG-01", async (t) => {
  const tm = await team("ali", "mohammed", "yousef");
  const title = `UAT SNG-01 list probe ${tag}`;
  const id = await openSnag(tm, title);
  const { page } = await pageAs("ali");
  const projectId = await openProject(page);
  const t0 = Date.now();
  const apiRead = await tm.api.ali!.get(`/projects/${projectId}/modules/snag_list/work-items`);
  const took = Date.now() - t0;
  await go(page, `/projects/${projectId}/snag-list`);
  await settle(page);
  if (await isNotFoundPage(page)) {
    t.check(`Ali's Snag List page opens (${RP1049})`, false, `The page shows the not-found page although the api answers 200 for the same read in ${took} ms (${((apiRead.body as Json).stages as Json[]).map((x) => x.key + ":" + x.count).join(" ")}); the web app gives up on an api read after 3000 ms (apps/web/src/lib/session.ts apiGet) and shows not found.`);
    await t.shot(page, "snag-list-not-found");
    // The rest of the story, by the api the page reads.
    const rows = (await moduleItems(tm.api.ali!, projectId, "snag_list", "pageSize=50")) as Json[];
    const found = await findByTitle(tm.api.ali!, projectId, "snag_list", title);
    t.check("By api: Ali's Snag List holds the new Snag, under the Open Stage", found?.id === id && found.stage.key === "open", `${found?.stage?.key ?? "not found"} (found by its Subject; ${rows.length} items on the first page of 50)`);
    t.check("By api: Ali does not see another Company's Draft in the List", !rows.some((i) => i.raiserCompanyName?.en !== "TMC Constructions" && i.stage.key === "draft"));
    t.check("Positive control: TMC sees the Snag by api", (await status(tm.api.ali!, id)) === 200);
    const yApiOnly = await moduleItems(tm.api.yousef!, projectId, "snag_list");
    t.check("Beta Build's Yousef does not see it in his api Snag List", !yApiOnly.some((i) => i.id === id), `${yApiOnly.length} items for Yousef`);
    return;
  }
  const main = page.getByRole("main");
  const text = await main.innerText();
  t.check("Ali sees the Snag List tab with the Types chips All, Snag, Comment", /All/.test(text) && /Snag/.test(text) && /Comment/.test(text));
  const api = (await moduleItems(tm.api.ali!, projectId, "snag_list", "pageSize=50")) as Json[];
  t.check("Ali's List shows the new Snag, grouped under its Stage (Open)", text.includes(title) && /Open\s*\d+ item/.test(text.replace(/\n+/g, " ")), `${api.length} items by api`);
  // The List loads 50 rows a page, so only the groups on page 1 show their header. Each shown
  // header must equal the api's count for its Stage, and the All chip the api's total.
  const flat = text.replace(/\n+/g, " ");
  const stageKey = (label: string) => label.toLowerCase().replace(" ", "_");
  const groups = [...flat.matchAll(/(Draft|Open|In Progress|On Hold|Resolved|Closed) (\d+) items?/g)].map((m) => ({ key: stageKey(m[1]!), count: Number(m[2]) }));
  const stageCounts = ((apiRead.body as Json).stages as Json[]).map((x) => ({ key: x.key as string, count: x.count as number }));
  const apiTotal = stageCounts.reduce((a, s) => a + s.count, 0);
  const allChip = Number(/All (\d+)/.exec(flat)?.[1] ?? NaN);
  const headersMatch = groups.length > 0 && groups.every((g) => stageCounts.find((s) => s.key === g.key)?.count === g.count);
  t.check("The Stage counts add up to the rows Ali sees", headersMatch && allChip === apiTotal, `headers ${groups.map((g) => g.key + ":" + g.count).join(" ")}, All chip ${allChip} vs api Stage counts ${stageCounts.map((s) => s.key + ":" + s.count).join(" ")} = ${apiTotal}`);
  const other = api.some((i) => i.raiserCompanyName?.en !== "TMC Constructions" && i.stage.key === "draft");
  t.check("Ali does not see another Company's Draft in the List or counts", !other);
  await t.shot(page, "ali-snag-list");
  // type chip
  await main.getByRole("link", { name: /^Snag\s*\d+$/ }).or(main.getByRole("button", { name: /^Snag\s*\d+$/ })).first().click().catch(() => undefined);
  await settle(page);
  // search with no match
  await page.getByRole("main").getByRole("searchbox").or(page.getByRole("main").getByPlaceholder(/search/i)).first().fill("zzz-no-such-snag-zzz");
  await page.keyboard.press("Enter");
  await settle(page, 900);
  const none = await main.innerText();
  t.check("A search with no match says nothing you can see matches", /Nothing you can see matches/.test(none));
  // kanban
  await go(page, `/projects/${projectId}/snag-list?view=kanban`);
  await settle(page);
  const kan = await main.innerText();
  t.check("The Kanban shows the Stages with the Snag", /Open/.test(kan) && kan.includes(title));
  await t.shot(page, "ali-snag-kanban");
  // empty state: someone who sees none (Beta Build's Engineer: the Snag is TMC's)
  const y = await pageAs("yousef");
  await go(y.page, `/projects/${projectId}/snag-list`);
  await settle(y.page);
  const yt = await y.page.getByRole("main").innerText();
  const yApi = await moduleItems(tm.api.yousef!, projectId, "snag_list");
  t.check("Positive control: TMC sees the Snag by api", (await status(tm.api.ali!, id)) === 200);
  t.check("Beta Build's Yousef does not see it and his empty List reads No snags. Nice work.", !yt.includes(title) && !yApi.some((i) => i.id === id) && (yApi.length > 0 || /No snags\. Nice work\./.test(yt)), `${yApi.length} items for Yousef`);
  await t.shot(y.page, "yousef-empty-snag-list");
});

defineCase("SNG-02", async (t) => {
  const tm = await team("mohammed", "ali", "yousef", "hafiz");
  const subject = `UAT SNG-02 Cable tray not bonded ${tag}`;
  const { page } = await pageAs("mohammed");
  const projectId = await openProject(page);
  await go(page, `/projects/${projectId}/work-items/new?module=snag_list&type=SNG`);
  await settle(page);
  await page.getByLabel(/^Subject/).fill(subject);
  await page.getByLabel(/^Description/).fill("Cable tray on Floor 02 is not bonded to earth.");
  await pickOption(page, "answer-trade", /Electrical Works/);
  await pickOption(page, "answer-location", /Tower 1 Floor 02/);
  await page.getByRole("button", { name: "Save Draft" }).click();
  await page.waitForURL(/\/work-items\/[0-9a-f-]{36}/, { timeout: 20000 });
  await settle(page);
  const id = /\/work-items\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await t.shot(page, "draft-saved");
  await upload(tm.api.mohammed!, id, { fieldKey: "photos", fileName: "before.jpg", contentType: "image/jpeg", body: testPhoto() });
  await go(page, `/work-items/${id}`);
  await settle(page);
  await takeTransition(page, "Raise");
  await t.shot(page, "raised");
  const d = await H.detail(tm.api.mohammed!, id);
  t.check("The Snag is Open after the Raise", d.stage.key === "open", d.stage.key);
  t.check("It is with TMC Constructions, the one Contractor covering Tower 1", d.heldBy?.companyName?.en === "TMC Constructions", JSON.stringify(d.heldBy));
  t.check("It has a Document Number of the Snag pattern", /^TWR-SNG-\d\d-\d{4}$/.test(d.documentNumber ?? ""), String(d.documentNumber));
  t.check("Positive control: Ali (TMC) reads it", (await status(tm.api.ali!, id)) === 200);
  const nf = await notFoundFor("yousef", `/work-items/${id}`);
  t.check("Beta Build (Tower 2 only) gets the plain 404 page", nf.notFound, nf.text);
  const yl = await moduleItems(tm.api.yousef!, projectId, "snag_list");
  t.check("It is in no Snag List of Beta Build", !yl.some((i) => i.id === id));
  t.note("Spec now (RP-658-1): with two Contractors covering a Location Raise asks which one; that is SNG-14 on Tower 2. FX-C2 leaves one Contractor on Tower 1.");
});

defineCase("SNG-03", async (t) => {
  const tm = await team("mohammed", "ali", "hafiz");
  const { mohammed: mo, ali, hafiz } = tm.api;
  const id = await openSnag(tm, `UAT SNG-03 moves ${tag}`);
  const before = await H.detail(mo!, id);
  const enteredAt = before.stepEnteredAt;
  await mustAct(ali!, id, /start_work/);
  const tmc1 = await H.detail(ali!, id);
  t.check("After Start work TMC reads In Progress", tmc1.stage.key === "in_progress", tmc1.stage.key);
  t.check("The send leaves it in TMC's Step Pool: a colleague (Hafiz) may pick it up", (await H.detail(hafiz!, id)).actions.pickUp === true);
  const dcl1 = await H.detail(mo!, id);
  t.check("Design Consultants still reads it Open", dcl1.stage.key === "open", dcl1.stage.key);
  await mustAct(hafiz!, id, /put_on_hold/);
  t.check("After Put on hold TMC reads On Hold", (await stageOf(ali!, id)) === "on_hold");
  t.check("Design Consultants still reads Open", (await stageOf(mo!, id)) === "open");
  await mustAct(ali!, id, /resume/);
  t.check("Resume work brings it back to In Progress", (await stageOf(ali!, id)) === "in_progress");
  const back = await act(hafiz!, id, /back_to_open/);
  t.check("Back to Open is offered and taken inside TMC", back.status === 204, back.text.slice(0, 120));
  t.check("TMC reads Open again; Mohammed too", (await stageOf(ali!, id)) === "open" && (await stageOf(mo!, id)) === "open");
  const dcl2 = await H.detail(mo!, id);
  t.check("Mohammed's Step Age counts from when it reached TMC: unchanged by TMC's moves", dcl2.stepEnteredAt === enteredAt, `${enteredAt} vs ${dcl2.stepEnteredAt}`);
  const dclEvents = (await events(mo!, id)).map((e) => e.transition?.en).filter(Boolean);
  t.check("Mohammed's history holds none of TMC's internal moves", !dclEvents.some((n: string) => /Start work|hold|Resume|Back to Open/i.test(n)), dclEvents.join(", "));
  const { page } = await pageAs("mohammed");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "mohammed-reads-open");
  const p2 = await pageAs("ali");
  await go(p2.page, `/work-items/${id}`);
  await settle(p2.page);
  await t.shot(p2.page, "ali-tmc-view");
});

defineCase("SNG-04", async (t) => {
  const tm = await team("mohammed", "ali", "hafiz");
  const { mohammed: mo, hafiz } = tm.api;
  const id = await openSnag(tm, `UAT SNG-04 resolve ${tag}`);
  const noNote = await act(hafiz!, id, /resolve/, { answers: {} });
  t.check("Resolve without a resolution note is refused", noNote.status === 422 || noNote.status === 409, `${noNote.status} ${noNote.text.slice(0, 100)}`);
  await hafizDoes(tm, id, /resolve/, { answers: { resolution_note: "Bonded and tested." } });
  const m1 = await H.detail(mo!, id);
  t.check("Resolved: Mohammed (the raiser) holds Verify", m1.stage.key === "resolved" && m1.actions.pickUp === true, `${m1.stage.key} pickUp=${m1.actions.pickUp}`);
  await mo!.post(`/work-items/${id}/pick-up`);
  const offered = keysOf(await H.detail(mo!, id));
  t.check("Mohammed is offered Return to Open and Close", offered.some((k) => /return/.test(k)) && offered.some((k) => /close/.test(k)), offered.join(", "));
  const ret = await act(mo!, id, /return/, { answers: { reason: "Still not bonded at the far end." } });
  t.check("Return to Open with a reason is taken", ret.status === 204, ret.text.slice(0, 100));
  const th = await H.detail(hafiz!, id);
  t.check("It is back with TMC, Open", th.stage.key === "open" && th.heldBy?.companyName?.en === "TMC Constructions", `${th.stage.key} ${JSON.stringify(th.heldBy)}`);
  t.note(`After the Return: Hafiz holds it? pickUp=${th.actions.pickUp}, holder=${th.heldBy?.memberName?.en ?? "pool"}; transitions ${keysOf(th).join(",")}`);
  const tmcSees = ((await events(hafiz!, id)).map((e) => e.transition?.en).filter(Boolean) as string[]).join(" > ");
  const dclSees = ((await events(mo!, id)).map((e) => e.transition?.en).filter(Boolean) as string[]).join(" > ");
  await hafizDoes(tm, id, /resolve/, { answers: { resolution_note: "Bonded at both ends, tested." } });
  await mo!.post(`/work-items/${id}/pick-up`);
  const close = await act(mo!, id, /close/);
  t.check("Mohammed's Close ends the Snag", close.status === 204 && (await stageOf(mo!, id)) === "closed", `${close.status}`);
  const dcl2 = ((await events(mo!, id)).map((e) => e.transition?.en).filter(Boolean) as string[]).join(" > ");
  t.check("Mohammed's history holds only shared moves (no Start work, pick-ups)", !/Start work|hold|Resume/i.test(dcl2) && /Raise/.test(dcl2) && /Resolve/.test(dcl2), dcl2);
  t.note(`TMC reads: ${tmcSees}. DCL read before the second Resolve: ${dclSees}.`);
  const { page } = await pageAs("mohammed");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "closed-snag-as-mohammed");
});

defineCase("SNG-05", async (t) => {
  const tm = await team("ali", "hafiz", "mohammed", "yousef", "ahmed");
  const ali = tm.api.ali!;
  const id = await createSnagItem(ali, tm, "SNG", `UAT SNG-05 own snag ${tag}`);
  t.check("DCL does not see the Draft", (await status(tm.api.mohammed!, id)) === 404);
  const d = await H.detail(ali, id);
  t.check("Ali (the raiser) holds the Draft and is offered Raise", keysOf(d).some((k) => /raise/.test(k)), keysOf(d).join(", "));
  await mustAct(ali, id, "raise");
  const steps: string[] = [];
  for (const k of [/start_work/, /resolve/, /close/]) {
    const extra = String(k).includes("resolve") ? { answers: { resolution_note: "Done by TMC." } } : {};
    const r = await act(ali, id, k, extra);
    steps.push(`${String(k)}:${r.status}`);
    if (r.status !== 204) t.note(`${String(k)} -> ${r.status} ${r.text.slice(0, 200)}; offered ${keysOf(await H.detail(ali, id)).join(",")}`);
  }
  t.check("TMC moves it through Start work, Resolve and Close itself", (await stageOf(ali, id)) === "closed", steps.join(" "));
  t.check("Positive control: Hafiz (TMC) reads it", (await status(tm.api.hafiz!, id)) === 200);
  t.check("Beta Build never sees it", (await status(tm.api.yousef!, id)) === 404);
  const dcl = await status(tm.api.mohammed!, id);
  t.check("Design Consultants reads it from the Raise (informed, RP-625-1), as read only", dcl === 200, `status ${dcl}`);
  const od = dcl === 200 ? await H.detail(tm.api.mohammed!, id) : null;
  t.check("The Consultant is offered nothing on it", !od || od.actions.transitions.length === 0 && !od.actions.pickUp);
  t.note("The Test Case Expected says DCL never sees it and defers informing to SNG-09; judged against RP-625-1 on main: Raise informs the Consultant, so it reads it from the Raise.");
  const { page } = await pageAs("ali");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "own-snag-closed");
});

defineCase("SNG-06", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed", "yousef");
  const { ali, mohammed: mo, ahmed } = tm.api;
  const title = `UAT SNG-06 MAR ${tag}`;
  const marId = await H.submittedMar(tm, title);
  await H.reviewedMar(tm, marId);
  const code = await act(mo!, marId, "approve_b", {
    answers: {
      sample_checked: true,
      matches_specification: true,
      remarks: "Two comments to close.",
      items_to_create: [
        { comment: "UAT SNG-06 comment one: add the emergency duration", reference: "Sheet 2" },
        { comment: "UAT SNG-06 comment two: show the IP rating", reference: "Sheet 3" },
      ],
    },
  });
  t.check("Mohammed issues Code B with two Comments", code.status === 204, `${code.status} ${code.text.slice(0, 200)}`);
  const marNumber = (await H.detail(ali!, marId)).documentNumber as string;
  const comments = await moduleItems(ali!, tm.projectId, "snag_list", `raisedFrom=${encodeURIComponent(marNumber)}&pageSize=50`);
  const mine = comments.filter((c) => c.type?.code === "CMT" && c.raisedFrom?.documentNumber && JSON.stringify(c.raisedFrom).includes(title));
  t.check("TMC's Snag List holds the two Comments raised from the MAR", mine.length === 2, `${mine.length}; ${comments.length} items`);
  if (mine.length === 0) return;
  const rf = mine[0]!.raisedFrom;
  t.check("Each Comment shows Raised from the number, Subject and Code B", /B/.test(JSON.stringify(rf)) && JSON.stringify(rf).includes(title), JSON.stringify(rf).slice(0, 300));
  t.check("A Comment is held by TMC", mine[0]!.with?.companyName?.en === "TMC Constructions", JSON.stringify(mine[0]!.with).slice(0, 200));
  const cid = mine[0]!.id as string;
  const resolved = await act(ali!, cid, /resolve/, { answers: { resolution_note: "Added." } });
  t.check("TMC resolves one Comment", resolved.status === 204, `${resolved.status} ${resolved.text.slice(0, 150)}`);
  await mo!.post(`/work-items/${cid}/pick-up`);
  const closed = await act(mo!, cid, /close/);
  t.check("Mohammed closes it", closed.status === 204 && (await stageOf(mo!, cid)) === "closed", `${closed.status} ${closed.text.slice(0, 150)}`);
  const mar = await H.detail(ali!, marId);
  const cmt = (mar.raisedItems as Json[]).find((r) => r.type.code === "CMT");
  t.check("The MAR counts Comments: 1 open / 1 closed", cmt?.open === 1 && cmt?.closed === 1, JSON.stringify(mar.raisedItems));
  t.check("Beta Build sees none of the Comments", !(await moduleItems(tm.api.yousef!, tm.projectId, "snag_list", "pageSize=50")).some((c) => c.id === cid));
  const { page } = await pageAs("ali");
  await go(page, `/projects/${tm.projectId}/snag-list?q=SNG-06`);
  await settle(page);
  await t.shot(page, "comments-in-snag-list");
  await go(page, `/work-items/${marId}`);
  await settle(page);
  await t.shot(page, "mar-comment-counts");
  void ahmed;
});

defineCase("SNG-07", async (t) => {
  const tm = await team("ali", "mohammed");
  const r = await tm.api.ali!.get(`/projects/${tm.projectId}/raisable-types?module=snag_list`);
  const codes = ((r.body as Json).types as Json[]).map((x) => x.code);
  t.check("Ali's New offers Snag and not Comment", codes.includes("SNG") && !codes.includes("CMT"), codes.join(", "));
  const { page } = await pageAs("ali");
  await go(page, `/projects/${tm.projectId}/snag-list?q=SNG-07`);
  await settle(page);
  if (await isNotFoundPage(page)) {
    t.check(`Ali's Snag List page opens, with its New menu (${RP1049})`, false, "the Snag List page shows the not-found page, so its New menu cannot be opened; the api's raisable types above are what the menu lists");
    await t.shot(page, "snag-list-not-found");
  } else {
    await page.getByRole("main").getByRole("button", { name: /^New/ }).first().click();
    await settle(page, 600);
    const menu = (await page.locator("[data-radix-popper-content-wrapper]").first().innerText()).replaceAll("\n", " | ");
    t.check("The New menu lists Snag and no Comment", /Snag/.test(menu) && !/Comment/.test(menu), menu);
    await t.shot(page, "new-menu");
  }
  const cmt = await go(page, `/projects/${tm.projectId}/work-items/new?module=snag_list&type=CMT`);
  t.note(`Opening New with type=CMT by URL answers ${cmt}; the page: ${(await page.getByRole("main").innerText()).replace(/\n+/g, " | ").slice(0, 160)}`);
});

defineCase("SNG-08", async (t) => {
  const tm = await team("mohammed", "ali", "hafiz");
  const { mohammed: mo, hafiz } = tm.api;
  const id = await openSnag(tm, `UAT SNG-08 after photos ${tag}`);
  await hafiz!.post(`/work-items/${id}/pick-up`);
  await upload(hafiz!, id, { fieldKey: "after_photos", reply: true, fileName: "after.jpg", contentType: "image/jpeg", body: testPhoto() } as never);
  const docs = async (api: Api) => ((await api.get(`/work-items/${id}/documents`)).body as Json).documents as Json[];
  const own = (await docs(hafiz!)).filter((d) => d.fieldKey === "after_photos");
  t.check("Hafiz sees his after photo, waiting for the Resolve (not frozen)", own.length === 1 && own[0]!.reply?.taken === false && own[0]!.frozen === false, JSON.stringify(own.map((d) => ({ f: d.frozen, r: d.reply }))));
  const dclBefore = (await docs(mo!)).filter((d) => d.fieldKey === "after_photos");
  t.check("Design Consultants reads no after photo before the Resolve", dclBefore.length === 0, `${dclBefore.length}`);
  await hafizDoes(tm, id, /resolve/, { answers: { resolution_note: "Bonded; photo attached." } });
  const dclAfter = (await docs(mo!)).filter((d) => d.fieldKey === "after_photos");
  t.check("After the Resolve the after photo is frozen and shared, beside the before photo", dclAfter.length === 1 && dclAfter[0]!.frozen === true && (await docs(mo!)).some((d) => d.fieldKey === "photos"), JSON.stringify(dclAfter.map((d) => ({ f: d.frozen, r: d.reply }))));
  const { page } = await pageAs("mohammed");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "after-photos-beside-before");
  t.note("A Send Back discarding after photos is not exercised: the Snag Workflow has Return to Open (a Return), no Send Back.");
});

defineCase("SNG-09", async (t) => {
  const tm = await team("hafiz", "ali", "mohammed", "ahmed", "yousef", "sara");
  const hafiz = tm.api.hafiz!;
  const id = await createSnagItem(hafiz, tm, "SNG", `UAT SNG-09 informed ${tag}`);
  t.check("Design Consultants cannot read the Draft", (await status(tm.api.mohammed!, id)) === 404);
  await mustAct(hafiz, id, "raise");
  const num = (await H.detail(hafiz, id)).documentNumber as string;
  t.check("Positive control: TMC's Ali reads it", (await status(tm.api.ali!, id)) === 200);
  const dcl = await status(tm.api.mohammed!, id);
  t.check("The named Participant (Design Consultants: Mohammed) reads it from the Raise", dcl === 200, `${dcl}`);
  t.check("Ahmed (DCL, covering the Trade) reads it too", (await status(tm.api.ahmed!, id)) === 200);
  const d = dcl === 200 ? await H.detail(tm.api.mohammed!, id) : null;
  t.check("The informed Consultant holds no Step and is offered nothing", !d || (d.actions.transitions.length === 0 && d.actions.pickUp === false));
  await mustAct(hafiz, id, /start_work/);
  t.check("DCL still reads Open, not TMC's In Progress", !d || (await stageOf(tm.api.mohammed!, id)) === "open");
  t.check("Beta Build (not informed) gets 404", (await status(tm.api.yousef!, id)) === 404);
  const n = (await tm.api.mohammed!.get("/notifications")).body as Json;
  t.check("An informed Participant gets no Step reached notification (workflow-engine 5.1): it reads the item, it is not asked to act", !(n.notifications as Json[]).some((x) => x.workItemId === id && x.kind === "step_reached"), num);
  const { page } = await pageAs("mohammed");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "informed-consultant-view");
  t.note("Informed Participants are the Snag Workflow's (RP-625: Raise informs the Consultant), not a field of the New form.");
});

defineCase("SNG-10", async (t) => {
  const tm = await team("mohammed", "hafiz", "ali");
  const mo = tm.api.mohammed!;
  const raisable = ((await mo.get(`/projects/${tm.projectId}/raisable-types?module=snag_list`)).body as Json).types as Json[];
  const codes = raisable.map((x) => x.code);
  t.check("Mohammed may raise Site Observation, Question to Contractor and Snag", ["OBS", "QSC", "SNG"].every((c) => codes.includes(c)), codes.join(", "));
  const obs = await createSnagItem(mo, tm, "OBS", `UAT SNG-10 observation ${tag}`);
  const qsc = await createSnagItem(mo, tm, "QSC", `UAT SNG-10 question ${tag}`, { description: undefined, question: "UAT SNG-10: which cable size is meant on sheet E-201?" });
  const sng = await createSnagItem(mo, tm, "SNG", `UAT SNG-10 snag ${tag}`);
  const [dO, dQ, dS] = [await H.detail(mo, obs), await H.detail(mo, qsc), await H.detail(mo, sng)];
  t.check("Each Type has its own Form and Workflow", new Set([dO.formVersionId, dQ.formVersionId, dS.formVersionId]).size === 3 && new Set([dO.workflow.name.en, dQ.workflow.name.en, dS.workflow.name.en]).size === 3, `${dO.workflow.name.en} / ${dQ.workflow.name.en} / ${dS.workflow.name.en}`);
  await mustAct(mo, obs, "raise");
  await mustAct(mo, qsc, "ask");
  const hq = await H.detail(tm.api.hafiz!, qsc);
  t.check("A Question to Contractor has no reviewed item behind it", hq.raisedFrom === null && (hq.raisedItems as Json[]).length === 0, JSON.stringify(hq.raisedFrom));
  t.check("Positive control: TMC reads the Question and the Observation", (await status(tm.api.hafiz!, qsc)) === 200 && (await status(tm.api.hafiz!, obs)) === 200);
  const { page } = await pageAs("mohammed");
  await go(page, `/projects/${tm.projectId}/snag-list?q=SNG-10`);
  await settle(page);
  const text = await page.getByRole("main").innerText();
  if (await isNotFoundPage(page)) {
    t.check(`Mohammed's Snag List page opens, with its Type chips (${RP1049})`, false, "the Snag List page shows the not-found page, so the chips cannot be read; the Types themselves are checked above by api");
    await t.shot(page, "snag-list-not-found");
  } else {
    t.check("The Type chips show Site Observation and Question to Contractor", /Site Observation/.test(text) && /Question to Contractor/.test(text));
    await t.shot(page, "type-chips");
  }
  t.check("Nothing is called Violation", !/violation/i.test(text) && !/violation/i.test(JSON.stringify([dO, dQ])));
});

defineCase("SNG-11", async (t) => {
  const tm = await team("hafiz", "mohammed", "ali");
  const id = await openSnag(tm, `UAT SNG-11 detail ${tag}`);
  const num = (await H.detail(tm.api.mohammed!, id)).documentNumber as string;
  await mustAct(tm.api.hafiz!, id, /start_work/);
  for (const who of ["hafiz", "mohammed"]) {
    const { page } = await pageAs(who);
    await go(page, `/work-items/${id}`);
    await settle(page);
    const text = await page.getByRole("main").innerText();
    t.check(`${who}: the header shows the number, the Type and the Stage`, text.includes(num) && /Snag/.test(text) && /Open|In Progress/.test(text));
    t.check(`${who}: the description and a photo are on the page`, /UAT made-up snag description/.test(text) && (await page.locator("main img").count()) > 0);
    t.check(`${who}: no due date, deadline or overdue anywhere`, !/due date|deadline|overdue|\bdue\b/i.test(text));
    t.check(`${who}: the history is on the page`, /Raise/.test(text));
    await t.shot(page, `${who}-detail`);
  }
  const cm = (await moduleItems(tm.api.ali!, tm.projectId, "snag_list", "pageSize=50")).find((c) => c.type?.code === "CMT");
  if (cm) {
    const { page } = await pageAs("ali");
    let text = "";
    // The item page gives up on a slow read after 3 s (RP-1049): open it again before it counts.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await go(page, `/work-items/${cm.id}`);
      await settle(page);
      text = await page.getByRole("main").innerText();
      if (!(await isNotFoundPage(page))) break;
      t.note(`The Comment's page came up as the not-found page at attempt ${attempt} although the api answers 200 for Ali.`);
      await page.waitForTimeout(2000);
    }
    t.check(`A Comment's page has the Raised from card naming the MAR and its Code${(await isNotFoundPage(page)) ? ` (${RP1049})` : ""}`, /Raised from/i.test(text) && /TWR-MAR/.test(text), text.slice(0, 200).replaceAll("\n", " | "));
    await t.shot(page, "comment-raised-from");
  } else t.note("No Comment in Ali's List to read the Raised from card on.");
});

defineCase("SNG-12", async (t) => {
  const tm = await team("mohammed", "ali", "hafiz");
  const subjects = [1, 2, 3].map((n) => `UAT SNG-12 bulk ${n} ${tag}`);
  const ids: string[] = [];
  for (const s of subjects) ids.push(await openSnag(tm, s));
  const { page } = await pageAs("ali");
  await go(page, `/projects/${tm.projectId}/snag-list?q=${tag}`);
  await settle(page);
  if (await isNotFoundPage(page)) {
    t.check(`Ali's Snag List page opens, to select the three Snags and Reassign them (${RP1049})`, false, "the Snag List page shows the not-found page, so the checkboxes, the Reassign dialog and the Excel export cannot be reached; the checks left are the api's");
    await t.shot(page, "snag-list-not-found");
    const cand0 = await tm.api.ali!.post(`/projects/${tm.projectId}/snag-list/reassign-candidates`, { ids });
    t.check("By api: Ali may reassign all three of TMC's Snags", (cand0.body as Json)?.reassignable === 3, cand0.text.slice(0, 120));
    const cand1 = await tm.api.mohammed!.post(`/projects/${tm.projectId}/snag-list/reassign-candidates`, { ids });
    t.check("Design Consultants can reassign none of TMC's Snags", (cand1.body as Json)?.reassignable === 0, cand1.text.slice(0, 120));
    return;
  }
  for (const s of subjects) await page.getByRole("checkbox", { name: `Select ${s}` }).check();
  await t.shot(page, "three-selected");
  await page.getByRole("button", { name: "Reassign" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await t.shot(page, "reassign-dialog");
  await dialog.getByRole("radio", { name: /Hafiz/ }).check();
  await dialog.getByRole("button", { name: "Reassign" }).click();
  await settle(page, 1200);
  const doneText = await page.locator("body").innerText();
  t.check("The dialog reports 3 items done", /3 items done/.test(doneText), doneText.match(/\d+ items? (done|skipped)/g)?.join(", ") ?? "");
  await page.keyboard.press("Escape");
  const holders = [];
  for (const id of ids) holders.push((await H.detail(tm.api.hafiz!, id)).heldBy?.memberName?.en);
  t.check("Each Snag is now held by Hafiz, inside TMC", holders.every((h) => h === "Hafiz Hamdan"), holders.join(", "));
  const cand = await tm.api.mohammed!.post(`/projects/${tm.projectId}/snag-list/reassign-candidates`, { ids });
  t.check("Design Consultants can reassign none of TMC's Snags", (cand.body as Json)?.reassignable === 0, cand.text.slice(0, 120));
  const rows = (await moduleItems(tm.api.ali!, tm.projectId, "snag_list", `q=${tag}&pageSize=50`)).length;
  await go(page, `/projects/${tm.projectId}/snag-list?q=${tag}`);
  await settle(page);
  const dl = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await page.getByRole("button", { name: "Export to Excel" }).click();
  const file = await dl;
  await settle(page, 600);
  const body = await page.locator("body").innerText();
  const exported = Number(/Exported (\d+) items?/.exec(body)?.[1] ?? "-1");
  t.check("The Excel export is made and exports exactly the visible rows", file !== null && exported === rows, `file ${file?.suggestedFilename() ?? "none"}; exported ${exported}; rows ${rows}`);
  await t.shot(page, "exported");
});

defineCase("SNG-13", async (t) => {
  const tm = await team("hafiz");
  const { page } = await pageAs("hafiz", { phone: true });
  await go(page, `/projects/${tm.projectId}/snag-list`);
  await settle(page);
  const text = await page.locator("main").innerText();
  const listOk = t.check(`At 375 px the Snag List opens with cards and no horizontal scroll${(await isNotFoundPage(page)) ? ` (${RP1049})` : ""}`, !(await isNotFoundPage(page)) && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && text.length > 0);
  await t.shot(page, "phone-list");
  await go(page, `/projects/${tm.projectId}/snag-list/new?type=SNG`);
  await settle(page);
  const flow = await page.locator("main").innerText();
  const newOk = t.check("The camera-first New flow opens (Take a photo / New Snag)", /Take a photo|New Snag/.test(flow), flow.slice(0, 160).replaceAll("\n", " | "));
  await t.shot(page, "phone-new");
  if (listOk && newOk) t.manual("The camera itself (Take photo opens the device camera) and the saved-as-you-go feel are a person's. Automated: the list at 375 px has no horizontal scroll and the New flow page opens.");
});

defineCase("SNG-14", async (t) => {
  const tm = await team("mohammed", "ali", "yousef", "hafiz");
  const mo = tm.api.mohammed!;
  const t2 = tm.d.loc("Tower 2 Floor 01");
  const a = await createSnagItem(mo, tm, "SNG", `UAT SNG-14 pick TMC ${tag}`, { location: t2 });
  const da = await H.detail(mo, a);
  const raise = (da.actions.transitions as Json[]).find((x) => x.key === "raise");
  const names = ((raise?.participants ?? []) as Json[]).map((p) => p.companyName.en).sort();
  t.check("The Raise pop-up asks which Contractor: both covering Tower 2, by Company name only", names.join(",") === "Beta Build,TMC Constructions", names.join(", "));
  const { page } = await pageAs("mohammed");
  await go(page, `/work-items/${a}`);
  await settle(page);
  await page.getByRole("main").getByRole("button", { name: "Raise", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  const dtext = await dialog.innerText();
  t.check("The pop-up shows the Contractor to pick", /Contractor|Participant|Company/i.test(dtext), dtext.replaceAll("\n", " | ").slice(0, 200));
  await t.shot(page, "raise-pick-dialog");
  await page.keyboard.press("Escape");
  const noPick = await mo.transition(a, "raise");
  t.check("Raise without a pick is refused (participant_not_picked), nothing moves", noPick.status === 422 && /participant_not_picked/.test(noPick.text) && (await stageOf(mo, a)) === "draft", `${noPick.status} ${noPick.text.slice(0, 120)}`);
  const tmcId = raise!.participants.find((p: Json) => p.companyName.en === "TMC Constructions").participantId;
  const betaId = raise!.participants.find((p: Json) => p.companyName.en === "Beta Build").participantId;
  const ok = await mo.transition(a, "raise", { participant: tmcId });
  t.check("Picking TMC raises it on TMC", ok.status === 204 && (await H.detail(mo, a)).heldBy?.companyName?.en === "TMC Constructions", `${ok.status}`);
  t.check("Positive control: TMC reads it", (await status(tm.api.ali!, a)) === 200);
  t.check("Beta Build, the other Contractor, never sees it: by id and in its Snag List", (await status(tm.api.yousef!, a)) === 404 && !(await moduleItems(tm.api.yousef!, tm.projectId, "snag_list", "pageSize=50")).some((i) => i.id === a));
  const b = await createSnagItem(mo, tm, "SNG", `UAT SNG-14 pick Beta ${tag}`, { location: t2 });
  const okB = await mo.transition(b, "raise", { participant: betaId });
  t.check("Picking Beta Build raises it on Beta Build, which reads it", okB.status === 204 && (await status(tm.api.yousef!, b)) === 200);
  t.check("TMC, the other Contractor, never sees that one", (await status(tm.api.ali!, b)) === 404);
  const bad = await createSnagItem(mo, tm, "SNG", `UAT SNG-14 bad pick ${tag}`, { location: t2 });
  const wrong = await mo.transition(bad, "raise", { participant: "00000000-0000-4000-8000-000000000000" });
  t.check("A made-up pick is refused (participant_not_offered)", wrong.status === 422 && /participant_not_offered/.test(wrong.text), `${wrong.status} ${wrong.text.slice(0, 100)}`);
  t.note("Run on Tower 2 as seeded with FX-C2 (TMC covers all Locations, Beta Build Tower 2), so no fixture was changed.");
});

defineCase("SNG-15", async (t) => {
  const tm = await team("ali");
  const { page } = await pageAs("ali");
  await go(page, `/projects/${tm.projectId}/snag-list?q=UAT%20SNG-12%20bulk`);
  await settle(page);
  const visible = (await moduleItems(tm.api.ali!, tm.projectId, "snag_list", "q=UAT%20SNG-12%20bulk&pageSize=50")).length;
  if (await isNotFoundPage(page)) {
    t.check(`Ali's Snag List page opens, to export the PDF (${RP1049})`, false, "the Snag List page shows the not-found page, so Export PDF cannot be reached");
    await t.shot(page, "snag-list-not-found");
    return;
  }
  await page.getByRole("button", { name: "Export PDF" }).click();
  const link = page.getByRole("button", { name: /Download the Snag List PDF/ }).or(page.getByRole("link", { name: /Download the Snag List PDF/ })).first();
  await link.waitFor({ state: "visible", timeout: 90000 });
  const label = await link.innerText();
  const n = Number(/\((\d+) items?\)/.exec(label)?.[1] ?? "-1");
  t.check("The PDF is made and offers exactly the Snags Ali sees", n === visible, `${label}; Ali sees ${visible}`);
  await t.shot(page, "pdf-ready");
  const dl = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
  await link.click();
  const file = await dl;
  let bytes: Buffer | null = null;
  if (file) {
    const { readFileSync } = await import("node:fs");
    bytes = readFileSync((await file.path())!);
  }
  t.check("It downloads as a PDF", bytes !== null && bytes.subarray(0, 4).toString() === "%PDF", bytes ? `${bytes.length} bytes` : "no download");
  const foreign = (await moduleItems(tm.api.ali!, tm.projectId, "snag_list", "pageSize=50")).filter((i) => i.stage.key === "draft" && i.raiserCompanyName?.en !== "TMC Constructions");
  t.check("No Draft of another Company is among what Ali exports", foreign.length === 0);
  t.note("Mode is Manual: the PDF's pages, photos and wording still want a person's eye; the count and the bytes are checked here.");
});
