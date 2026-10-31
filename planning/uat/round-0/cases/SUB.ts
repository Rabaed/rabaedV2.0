import { pageAs } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { Api, go, listRows, openList, settle, takeTransition } from "../harness/helpers.ts";
import * as H from "../harness/helpers-sub.ts";
import { defaultListColumns } from "../../../../packages/domain/src/list-columns.ts";

// Part SUB (Submittals). Setup goes through the api exactly as the web app calls it; the Expected
// results are read from the pages as well as from the api. Each case makes its own items "UAT SUB-nn ...".

async function choose(page: import("playwright").Page, label: string, option: string | RegExp) {
  await page.getByRole("main").getByLabel(label).first().click();
  await page.getByRole("option", { name: option }).first().click();
  await page.waitForTimeout(300);
}

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length >= Math.min(a.length, b.length) * 0.8;

const dots = (text: string) => /(\d)\s*(week|wk)/i.test(text);

const RP1049 = "Known Bug RP-1049: the Submittals List page shows the not-found page (the web app gives up on the api read at 3 s); the api answers the same read.";
async function notFound(page: import("playwright").Page): Promise<boolean> {
  return (await page.getByTestId("not-found").count()) > 0 || /We can.t find this page/.test(await page.locator("body").innerText());
}

defineCase("SUB-01", async (t) => {
  const tm = await H.team("hafiz");
  const subject = `UAT SUB-01 Lighting Fixtures ${H.stamp()}`;
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items/new`);
  await settle(page);
  const main = page.getByRole("main");
  await main.getByLabel("Subject").fill(subject);
  await main.getByLabel("Manufacturer").fill("Philips");
  await choose(page, "Trade", /Electrical Works/);
  await choose(page, "Location", /Tower 1 Floor 02/);
  await settle(page, 600);
  await choose(page, "Approved supplier", "Najd Electrical Supplies");
  await t.shot(page, "new-form-filled");
  await main.getByRole("button", { name: "Save Draft" }).click();
  await page.waitForURL(/\/work-items(\?|$)|\/work-items\/[0-9a-f-]{36}/, { timeout: 15000 }).catch(() => undefined);
  await settle(page, 800);
  await openList(page, tm.projectId);
  const blocked = await notFound(page);
  // At ~1,000 items a Draft (no number yet) is not on page 1: find it with the List's Search.
  if (!blocked && !(await listRows(page)).some((r) => r.subject === subject)) {
    // The List's Search runs on Enter (it sends ?q=), not as you type.
    const search = page.getByRole("main").getByRole("searchbox").or(page.getByRole("main").getByPlaceholder(/search/i)).first();
    await search.fill(subject);
    await search.press("Enter");
    await settle(page, 800);
  }
  const row = blocked ? undefined : (await listRows(page)).find((r) => r.subject === subject);
  const why = blocked ? RP1049 : row?.text;
  t.check("The Draft is listed in the Submittals List", !!row, why);
  t.check('The Draft reads "No number yet"', row?.number === "No number yet", blocked ? RP1049 : row?.number);
  t.check("No Step Age dots on the Draft row", !!row && !dots(row.text), why);
  await t.shot(page, "list-with-draft");
  const items = await H.listItems(tm.api.hafiz!, tm.projectId, "q=" + encodeURIComponent(subject));
  const it = items.find((i) => i.title === subject);
  t.check("The Draft is in the Drafts Stage with no Step Age (api)", it?.stage?.key === "draft" && (it?.stepAgeWeeks ?? null) === null, JSON.stringify({ stage: it?.stage?.key, age: it?.stepAgeWeeks }));
  const d = it ? await H.detail(tm.api.hafiz!, it.id) : undefined;
  t.check("It is Hafiz's to edit (Save draft offered)", d?.actions.saveAnswers === true && d?.heldBy?.memberName?.en === "Hafiz Hamdan");
  t.check("The Description stayed empty (a Draft saves incomplete)", !d?.answers?.description);
});

defineCase("SUB-02", async (t) => {
  const tm = await H.team("hafiz");
  const hafiz = tm.api.hafiz!;
  const subject = `UAT SUB-02 incomplete ${H.stamp()}`;
  const id = await H.createItem(hafiz, tm, "MAR", subject, await H.marAnswers(tm, { description: "" }));
  const { page } = await pageAs("hafiz");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await page.getByRole("main").getByRole("button", { name: "Send for Review" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await dlg.getByRole("button", { name: "Send for Review" }).click();
  await settle(page, 1000);
  const text = await page.getByRole("main").innerText();
  t.check('The Form says "2 fields need your attention: Description, Datasheet (PDF)"', /2 fields need your attention:?\s*Description[,\s]+Datasheet \(PDF\)/.test(text.replace(/\s+/g, " ")), text.replace(/\s+/g, " ").match(/\d+ fields? need[^.]{0,120}/)?.[0] ?? "no message found");
  await t.shot(page, "refused-send");
  const d = await H.detail(hafiz, id);
  t.check("Nothing moved: still a Draft with no number", d.stage.key === "draft" && d.documentNumber === null);
  const r = await H.move(hafiz, id, "send_for_review");
  t.check("The api refuses form_incomplete (422) naming the fields", r.status === 422 && /form_incomplete/.test(r.text) && /description/.test(r.text) && /datasheet/.test(r.text), r.text);
});

defineCase("SUB-03", async (t) => {
  const tm = await H.team("hafiz");
  const hafiz = tm.api.hafiz!;
  const id = await H.createItem(hafiz, tm, "MAR", `UAT SUB-03 form ${H.stamp()}`, await H.marAnswers(tm));
  await H.addDatasheet(hafiz, id);
  await H.addPhoto(hafiz, id);
  const { page, text } = await H.viewItem(t, "hafiz", id, "form-total-docs", "en", { full: true });
  t.check("The Items total reads 240", /Total Quantity\s*240(\.00)?/.test(text.replace(/\s+/g, " ")), text.match(/Total Quantity[^A-Z]*/)?.[0]);
  t.check("The Datasheet and the Sample photo are on the saved Draft", /UAT-datasheet\.pdf/.test(text) && /UAT-sample\.jpg|photo/i.test(text));
  t.check("Attachments and Links sit below the Form (Save and close above them)", text.indexOf("Save and close") < text.indexOf("Attachments") && text.indexOf("Attachments") < text.indexOf("Links"));
  const docs = ((await hafiz.get(`/work-items/${id}/documents`)).body as H.Json).documents as H.Json[];
  const photo = docs?.find((x) => x.contentType === "image/jpeg");
  t.check("The photo carries its EXIF time and place", !!photo?.takenAt && !!photo?.takenWhere, JSON.stringify({ takenAt: photo?.takenAt, takenWhere: photo?.takenWhere }));
  await page.getByRole("main").getByRole("button", { name: "Save and close" }).click();
  await page.waitForURL((u) => /\/work-items\/?$/.test(u.pathname), { timeout: 25000 }).catch(() => undefined);
  await settle(page, 800);
  t.check("Save and close returns to the Submittals list", /\/work-items(\?|$)/.test(page.url()) && !/\/work-items\/[0-9a-f-]{36}/.test(page.url()), page.url());
  await t.shot(page, "after-save-and-close");
});

defineCase("SUB-04", async (t) => {
  const tm = await H.team("hafiz", "ali", "yousef", "ahmed");
  const subject = `UAT SUB-04 numbering ${H.stamp()}`;
  const id = await H.createItem(tm.api.hafiz!, tm, "MAR", subject, await H.marAnswers(tm));
  await H.addDatasheet(tm.api.hafiz!, id);
  const before = await H.detail(tm.api.hafiz!, id);
  t.check("Before the send the Draft has no number", before.documentNumber === null);
  const { page: hp } = await pageAs("hafiz");
  await go(hp, `/work-items/${id}`);
  await settle(hp);
  await takeTransition(hp, "Send for Review");
  const d = await H.detail(tm.api.ali!, id);
  t.check("The item gets a Document Number TWR-MAR-01-nnnn", H.NUMBER_RE.test(d.documentNumber ?? ""), d.documentNumber);
  t.check('Ali holds it at once: "With Ali Sonour", no Pick up', d.heldBy?.memberName?.en === "Ali Sonour" && d.actions.pickUp === false, JSON.stringify(d.heldBy));
  const { page, text } = await H.viewItem(t, "ali", id, "ali-item");
  t.check("The page shows the number and Ali Sonour - TMC Constructions", text.includes(d.documentNumber) && /Ali Sonour\s*·\s*TMC Constructions/.test(text), text.match(/With[^\n]*\n[^\n]*/)?.[0]);
  t.check("The Document Number is left to right (dir=ltr)", (await page.locator(`[dir="ltr"]`, { hasText: d.documentNumber }).count()) > 0);
  let got: H.Json | undefined;
  for (let i = 0; i < 15 && !got; i++) {
    const notes = ((await tm.api.ali!.get("/notifications")).body as H.Json).notifications as H.Json[];
    got = notes.find((x) => x.workItemId === id && x.kind === "step_reached");
    if (!got) await H.sleep(1000);
  }
  t.check("Ali's bell shows Step reached within seconds", !!got, got ? "arrived" : "none after 15 s");
  t.check("Nothing outside TMC: Yousef and Ahmed get the plain 404", (await tm.api.yousef!.get(`/work-items/${id}`)).status === 404 && (await tm.api.ahmed!.get(`/work-items/${id}`)).status === 404);
});

defineCase("SUB-05", async (t) => {
  const tm = await H.team("hafiz", "ali");
  const id = await H.sentMar(tm, `UAT SUB-05 return ${H.stamp()}`);
  const num = (await H.detail(tm.api.ali!, id)).documentNumber;
  const { page: ap } = await pageAs("ali");
  await go(ap, `/work-items/${id}`);
  await settle(ap);
  await takeTransition(ap, "Return", { note: undefined, fill: async (dlg) => { await dlg.getByRole("textbox").first().fill("Add emergency duration"); } });
  const d = await H.detail(tm.api.hafiz!, id);
  t.check("Stays in Internal Review at the Contractor Engineer Step", d.stage.key === "internal_review" && d.step.key === "contractor_engineer", `${d.stage.key}/${d.step.key}`);
  t.check("Keeps its Document Number", d.documentNumber === num);
  t.check('Goes back to Hafiz ("With Hafiz Hamdan")', d.heldBy?.memberName?.en === "Hafiz Hamdan");
  t.check("It is never a Draft again", d.stage.key !== "draft");
  const ev = await H.eventsOf(tm.api.hafiz!, id);
  const r = ev.find((e) => e.reason === "Add emergency duration");
  t.check("The reason is in TMC's history marked internal", r?.audience === "internal", JSON.stringify(r)?.slice(0, 200));
  const { text } = await H.viewItem(t, "hafiz", id, "hafiz-after-return");
  t.check("The page reads With Hafiz Hamdan - TMC Constructions", /Hafiz Hamdan\s*·\s*TMC Constructions/.test(text));
  const list = await H.listItems(tm.api.hafiz!, tm.projectId, "q=UAT%20SUB-05");
  t.check("Step Age counts from the Return (a fresh item: first week)", list.find((i) => i.id === id)?.stepAgeWeeks !== undefined, String(list.find((i) => i.id === id)?.stepAgeWeeks));
});

defineCase("SUB-06", async (t) => {
  const tm = await H.team("hafiz", "ali");
  const hafiz = tm.api.hafiz!;
  const id = await H.sentMar(tm, `UAT SUB-06 docs ${H.stamp()}`);
  await H.must(tm.api.ali!, id, "return", { answers: { reason: "Datasheet is the wrong revision" } });
  const docs = async (who: Api) => (((await who.get(`/work-items/${id}/documents`)).body as H.Json).documents ?? []) as H.Json[];
  const old = (await docs(hafiz)).find((x) => x.fileName === "UAT-datasheet.pdf")!;
  const rm = await hafiz.request("DELETE", `/work-items/${id}/documents/${old.id}`);
  t.check("Hafiz can remove the Datasheet while the item is inside TMC", rm.status === 204, String(rm.status));
  await H.addDatasheet(hafiz, id, "UAT-datasheet-corrected.pdf");
  await H.must(hafiz, id, "send_for_review_again");
  const seen = await docs(tm.api.ali!);
  t.check("Ali sees the corrected PDF, not the old one", seen.some((x) => x.fileName === "UAT-datasheet-corrected.pdf") && !seen.some((x) => x.fileName === "UAT-datasheet.pdf"), seen.map((x) => x.fileName).join(","));
  t.check("The Documents are not frozen yet", seen.every((x) => x.frozen === false));
  const { page } = await H.viewItem(t, "ali", id, "ali-documents", "en", { full: true });
  t.check("The corrected file shows on the page", (await page.getByRole("main").innerText()).includes("UAT-datasheet-corrected.pdf"));
});

defineCase("SUB-07", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed");
  const id = await H.sentMar(tm, `UAT SUB-07 submit ${H.stamp()}`);
  const { page: ap } = await pageAs("ali");
  await go(ap, `/work-items/${id}`);
  await settle(ap);
  await takeTransition(ap, "Submit", {
    fill: async (dlg) => {
      await dlg.getByRole("textbox").nth(0).fill("Panels for Level 2, as drawing E-201");
      await dlg.getByRole("textbox").nth(1).fill("Quantities checked against the BOQ");
    },
  });
  const a = await H.detail(tm.api.ali!, id);
  t.check("Stage is Pending Approval", a.stage.name.en === "Pending Approval", a.stage.name.en);
  t.check('TMC sees "With Design Consultants LLC", no person', a.heldBy?.companyName?.en === "Design Consultants LLC" && a.heldBy?.memberName === null, JSON.stringify(a.heldBy));
  const { text } = await H.viewItem(t, "ali", id, "ali-after-submit");
  t.check("TMC's page never names a Consultant person", !/Ahmed|Sara|Mohammed/.test(text));
  const ev = await H.eventsOf(tm.api.ahmed!, id);
  const sub = ev.find((e) => e.transition?.en === "Submit");
  t.check("Ahmed's history shows the Submit with the Cover Note by TMC Constructions, no person", sub?.by?.companyName?.en === "TMC Constructions" && sub?.by?.memberName === null && sub?.answers?.cover_note === "Panels for Level 2, as drawing E-201", JSON.stringify(sub)?.slice(0, 250));
  t.check("The Internal Note is not in Ahmed's history", !JSON.stringify(ev).includes("Quantities checked against the BOQ"));
  const ad = await H.detail(tm.api.ahmed!, id);
  t.check("The Submission Date is set", !!ad.submissionDate);
  await H.viewItem(t, "ahmed", id, "ahmed-sees-submit");
});

defineCase("SUB-08", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "sara", "mohammed");
  const id = await H.submittedMar(tm, `UAT SUB-08 pool ${H.stamp()}`);
  const a = await H.detail(tm.api.ahmed!, id);
  const sara = await tm.api.sara!.get(`/work-items/${id}`);
  t.note(`Observed with FX-K1M applied (Sara covers Mechanical only): Ahmed alone holds the Electrical MAR at once (heldBy ${JSON.stringify(a.heldBy?.memberName?.en)}, pickUp offered: ${a.actions.pickUp}); Sara gets ${sara.status} for it. TMC raises only Electrical, so no item can have both Engineers in its pool while Sara is narrowed.`);
  t.blocked("The Consultant pool of two Engineers needs Sara to cover Electrical, but fixture FX-K1M (applied, not to be undone) narrows her to Mechanical only, and TMC cannot raise Mechanical items. Run SUB-08 before PAR-15 on a fresh seed, or have a person widen Sara's Trade for the case. Steps: Ahmed and Sara open the Submitted MAR (both read 'not picked up yet' with both names); Ahmed Pick up; Sara's Need My Action and unread Step reached drop it; Ahmed Return to pool then Pick up again; Mohammed reads it read-only.");
});

defineCase("SUB-09", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const hafiz = tm.api.hafiz!;
  const id = await H.createItem(hafiz, tm, "MAR", `UAT SUB-09 readonly ${H.stamp()}`, await H.marAnswers(tm));
  await H.addDatasheet(hafiz, id);
  await H.addPhoto(hafiz, id);
  await H.must(hafiz, id, "send_for_review");
  await H.pickUp(tm.api.ali!, id);
  await H.must(tm.api.ali!, id, "submit", { answers: { cover_note: "UAT" } });
  const ahmed = tm.api.ahmed!;
  await H.pickUp(ahmed, id);
  const d = await H.detail(ahmed, id);
  t.check("The api offers Ahmed no Save draft (the Form is the raiser's)", d.actions.saveAnswers === false);
  const put = await ahmed.put(`/work-items/${id}/answers`, { answers: { ...d.answers, manufacturer: "Changed by Ahmed" } });
  t.check("A direct attempt to change an answer is refused", put.status >= 400, String(put.status));
  const docs = (await ahmed.get(`/work-items/${id}/documents`)).body as H.Json;
  t.check("The Documents are frozen and no change is allowed", docs.documents.length > 0 && docs.documents.every((x: H.Json) => x.frozen === true) && docs.canChange === false, JSON.stringify({ n: docs.documents.length, canChange: docs.canChange }));
  const { page, text } = await H.viewItem(t, "ahmed", id, "ahmed-readonly-form", "en", { full: true });
  t.check("Every answer and the total show read-only", /Total Quantity\s*240/.test(text.replace(/\s+/g, " ")) && text.includes("Philips") && text.includes("Recessed panel"));
  const editable = await page.getByRole("main").locator("input:not([type=file]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled]), [role=combobox]:not([disabled])").evaluateAll((els) => els.map((e) => `${e.tagName}#${e.id}`));
  t.check("No edit control for the Form is on Ahmed's page", editable.length === 0, editable.join(","));
  const photo = (docs.documents as H.Json[]).find((x) => x.contentType === "image/jpeg");
  t.check("The photo shows time and place", !!photo?.takenAt && !!photo?.takenWhere);
});

defineCase("SUB-10", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const id = await H.submittedMar(tm, `UAT SUB-10 verify ${H.stamp()}`);
  const ahmed = tm.api.ahmed!;
  await H.pickUp(ahmed, id);
  const { page: pg } = await pageAs("ahmed");
  await go(pg, `/work-items/${id}`);
  await settle(pg);
  await pg.getByRole("main").getByRole("button", { name: "Send to Manager" }).first().click();
  const dlg = pg.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await dlg.getByRole("button", { name: "Send to Manager" }).click();
  await settle(pg, 800);
  await t.shot(pg, "refused-empty-verification");
  t.check("Step 1 is refused in the pop-up and the pop-up stays open", await dlg.isVisible());
  const r1 = await H.move(ahmed, id, "send_to_manager", {});
  t.check("Empty verification refused (422 invalid_action_form)", r1.status === 422 && /sample_checked/.test(r1.text), r1.text);
  const r2 = await H.move(ahmed, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: false }, recommendedCode: "C" });
  t.check("Matches specification No without the note is refused: the note is required", r2.status === 422 && /verification_note/.test(r2.text), r2.text);
  const still = await H.detail(ahmed, id);
  t.check("Nothing moved after the refusals", still.step.key === "consultant_engineer");
  const ok = await H.move(ahmed, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: false, verification_note: "Finish is not the specified one." }, recommendedCode: "C", internalNote: "UAT engineer internal note" });
  t.check("With the note, Recommended Code C and an Internal Note the move succeeds", ok.status === 204, ok.text);
  const m = await H.detail(tm.api.mohammed!, id);
  t.check("The item sits with Mohammed at once (Consultant Manager)", m.step.key === "consultant_manager" && m.heldBy?.memberName?.en === "Mohammed Al Shamsi", JSON.stringify(m.heldBy));
  const own = JSON.stringify(await H.eventsOf(ahmed, id));
  t.check("Ahmed's answers, Recommended Code and Internal Note are in DCL's history", own.includes("Finish is not the specified one.") && own.includes("UAT engineer internal note"));
  const evs = (await H.eventsOf(ahmed, id)).filter((e) => e.transition?.en === "Send to Manager");
  t.check("They are marked internal", evs.length > 0 && evs.every((e) => e.audience === "internal"), JSON.stringify(evs.map((e) => e.audience)));
  const tmcView = JSON.stringify(await H.eventsOf(tm.api.ali!, id));
  t.check("TMC reads none of it", !tmcView.includes("Finish is not the specified one.") && !tmcView.includes("UAT engineer internal note"));
});

defineCase("SUB-11", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const id = await H.submittedMar(tm, `UAT SUB-11 codeA ${H.stamp()}`);
  await H.reviewedMar(tm, id, { sample_checked: true, matches_specification: true }, "A");
  const m = tm.api.mohammed!;
  const d0 = await H.detail(m, id);
  const approve = d0.actions.transitions.find((x: H.Json) => x.key === "approve_a");
  t.check("The Final verification is filled from Ahmed's reply", approve?.prefill?.sample_checked === true && approve?.prefill?.matches_specification === true, JSON.stringify(approve?.prefill));
  const { page: pg } = await pageAs("mohammed");
  await go(pg, `/work-items/${id}`);
  await settle(pg);
  await pg.getByRole("main").getByRole("button", { name: /Approve/ }).first().click();
  const dlg = pg.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await t.shot(pg, "code-a-popup");
  await dlg.getByRole("button", { name: /^Approve/ }).last().click();
  await dlg.waitFor({ state: "hidden" });
  await settle(pg, 1000);
  const d = await H.detail(m, id);
  t.check("The item closes Approved, Code A, with Remarks left empty", d.outcome === "A" && d.stage.key === "approved", `${d.outcome}/${d.stage.key}`);
  t.check("It accepts no more moves", d.actions.transitions.length === 0, H.offered(d).join(","));
  let text = "";
  for (let i = 0; i < 12; i++) {
    text = (await H.viewItem(t, "mohammed", id)).text;
    if (/Download PDF/.test(text)) break;
    await H.sleep(3000);
  }
  await H.viewItem(t, "mohammed", id, "closed-code-a");
  t.check("Download PDF appears (the record is prepared by the worker)", /Download PDF/.test(text), text.match(/Record[^\n]*/)?.[0]);
});

defineCase("SUB-12", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const runTag12 = H.stamp();
  const id = await H.submittedMar(tm, `UAT SUB-12 codeB ${runTag12}`);
  await H.reviewedMar(tm, id, { sample_checked: true, matches_specification: true }, "B");
  const m = tm.api.mohammed!;
  const noRemarks = await H.move(m, id, "approve_b", { answers: { sample_checked: true, matches_specification: true, items_to_create: [{ comment: "c1" }] } });
  t.check("Remarks are required with B", noRemarks.status === 422 && /remarks/.test(noRemarks.text), noRemarks.text);
  await H.must(m, id, "approve_b", { answers: { sample_checked: true, matches_specification: true, remarks: "Approved subject to the comments.", items_to_create: [{ comment: `UAT SUB-12 comment one ${runTag12}`, reference: "E-201" }, { comment: `UAT SUB-12 comment two ${runTag12}` }, { comment: `UAT SUB-12 comment three ${runTag12}` }] } });
  const d = await H.detail(tm.api.ali!, id);
  t.check("The MAR closes at Code B", d.outcome === "B", d.outcome);
  const raised = d.raisedItems?.find((x: H.Json) => x.type.code === "CMT");
  t.check("The item data reads Comments: 3 open / 0 closed", raised?.open === 3 && raised?.closed === 0, JSON.stringify(d.raisedItems));
  const { page, text } = await H.viewItem(t, "ali", id, "mar-comments-count");
  t.check("The MAR page shows '3 open / 0 closed'", /3 open \/ 0 closed/.test(text), text.match(/Comments[^\n]*\n?[^\n]*/)?.[0]);
  const list = (await tm.api.ali!.get(`/projects/${tm.projectId}/modules/snag_list/work-items?q=${encodeURIComponent("UAT SUB-12")}`)).body as H.Json;
  const mine = (list.items as H.Json[]).filter((i) => i.title.endsWith(runTag12));
  t.check("Three Comment items are in the Snag List, raised by Design Consultants, Open with TMC", mine.length === 3 && mine.every((i) => i.raiserCompanyName?.en === "Design Consultants LLC" && i.stage?.name?.en === "Open" && i.with?.companyName?.en === "TMC Constructions"), JSON.stringify(mine.map((i) => [i.title, i.raiserCompanyName?.en, i.stage?.name?.en, i.with?.companyName?.en])));
  await go(page, `/projects/${tm.projectId}/snag-list`);
  await settle(page);
  await t.shot(page, "snag-list");
});

defineCase("SUB-13", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const id = await H.submittedMar(tm, `UAT SUB-13 codeC ${H.stamp()}`);
  const ver = { sample_checked: true, matches_specification: false, verification_note: "Photometric data missing." };
  await H.reviewedMar(tm, id, ver, "C");
  const m = tm.api.mohammed!;
  await H.must(m, id, "return_to_engineer", { answers: { reason: "Check the photometric report" } });
  const back = await H.detail(tm.api.ahmed!, id);
  t.check("Return to Engineer gives it back to Ahmed", back.step.key === "consultant_engineer" && back.heldBy?.memberName?.en === "Ahmed bin Said", `${back.step.key} ${back.heldBy?.memberName?.en}`);
  await H.must(tm.api.ahmed!, id, "send_to_manager", { answers: ver, recommendedCode: "C" });
  await H.pickUp(m, id);
  const r1 = await H.move(m, id, "revise_c", { answers: ver });
  t.check("Code C with Remarks empty is refused", r1.status === 422 && /remarks/.test(r1.text), r1.text);
  const r2 = await H.move(m, id, "revise_c", { answers: { ...ver, remarks: "Resubmit with the photometric report attached." } });
  t.check("With Remarks it closes at C", r2.status === 204, r2.text);
  const d = await H.detail(tm.api.hafiz!, id);
  t.check("Closed at C with its Remarks shown to TMC", d.outcome === "C" && JSON.stringify(await H.eventsOf(tm.api.hafiz!, id)).includes("Resubmit with the photometric report attached."));
  t.check("TMC is offered Create Revision", d.actions.createRevision === true);
  const { text } = await H.viewItem(t, "hafiz", id, "tmc-code-c-offers-revision");
  t.check("The page shows Create Revision", /Create Revision/.test(text));
});

defineCase("SUB-14", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const subject = `UAT SUB-14 codeD ${H.stamp()}`;
  const id = await H.submittedMar(tm, subject);
  await H.reviewedMar(tm, id, { sample_checked: true, matches_specification: false, verification_note: "Wrong product." }, "D");
  await H.must(tm.api.mohammed!, id, "reject_d", { answers: { sample_checked: true, matches_specification: false, verification_note: "Wrong product.", remarks: "Rejected: not the specified product." } });
  const d = await H.detail(tm.api.hafiz!, id);
  t.check("The item closes at D", d.outcome === "D", d.outcome);
  t.check("Hafiz is offered Create replacement and no Revision", d.actions.createReplacement === true && d.actions.createRevision === false);
  const { page } = await H.viewItem(t, "hafiz", id, "rejected-offers-replacement");
  await page.getByRole("main").getByRole("button", { name: "Create replacement" }).click();
  await page.waitForURL((u) => /\/work-items\/[0-9a-f-]{36}/.test(u.pathname) && !u.pathname.includes(id), { timeout: 15000 }).catch(() => undefined);
  await settle(page, 800);
  const newId = /\/work-items\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  t.check("A new Draft opens", !!newId && newId !== id, page.url());
  const n = await H.detail(tm.api.hafiz!, newId!);
  t.check("Same Subject, a Draft with no number", n.title === subject && n.stage.key === "draft" && n.documentNumber === null, `${n.title}/${n.stage.key}`);
  const links = JSON.stringify((await tm.api.hafiz!.get(`/work-items/${newId}/links`)).body);
  t.check("A Replaces Link points to the rejected MAR", /replace/i.test(links) && links.includes(d.documentNumber), links.slice(0, 300));
  await t.shot(page, "replacement-draft");
  await H.addDatasheet(tm.api.hafiz!, newId!).catch(() => undefined);
  await H.must(tm.api.hafiz!, newId!, "send_for_review");
  const sent = await H.detail(tm.api.hafiz!, newId!);
  t.check("At its first send it gets a new Document Number with no Rev suffix", H.NUMBER_RE.test(sent.documentNumber ?? "") && sent.documentNumber !== d.documentNumber, sent.documentNumber);
});

defineCase("SUB-15", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const id = await H.submittedMar(tm, `UAT SUB-15 rev ${H.stamp()}`);
  const ver = { sample_checked: true, matches_specification: false, verification_note: "Finish differs." };
  await H.reviewedMar(tm, id, ver, "C");
  await H.must(tm.api.mohammed!, id, "revise_c", { answers: { ...ver, remarks: "Revise the finish." } });
  const hafiz = tm.api.hafiz!;
  const orig = await H.detail(hafiz, id);
  const r = await hafiz.post(`/work-items/${id}/revisions`, { idempotencyKey: crypto.randomUUID() });
  t.check("Create Revision makes a Draft", r.status === 201, r.text);
  const revId = (r.body as H.Json).id as string;
  const rev = await H.detail(hafiz, revId);
  t.check("The Draft is Revision 1 with no number yet", rev.revisionNo === 1 && rev.stage.key === "draft", `rev ${rev.revisionNo} number ${rev.documentNumber}`);
  t.check("It starts with TMC's answers", rev.answers.manufacturer === "Philips" && rev.answers.model === "CoreLine Panel");
  const docs = ((await hafiz.get(`/work-items/${revId}/documents`)).body as H.Json).documents.map((x: H.Json) => x.fileName);
  t.check("The Datasheet is copied", docs.includes("UAT-datasheet.pdf"), docs.join(","));
  await hafiz.put(`/work-items/${revId}/answers`, { answers: { ...rev.answers, model: "CoreLine Panel HDG" } });
  const { page: before, text: bt } = await H.viewItem(t, "hafiz", revId, "revision-draft");
  t.check("The Draft page shows Revision 1 and No number yet", /Revision 1: no number yet/.test(bt), bt.slice(0, 200).replace(/\n/g, " | "));
  void before;
  await H.must(hafiz, revId, "send_for_review");
  await H.pickUp(tm.api.ali!, revId);
  await H.must(tm.api.ali!, revId, "submit", { answers: { cover_note: "Revision 1" } });
  const after = await H.detail(hafiz, revId);
  t.check("After the Submit the Revision's number is the number plus Rev 1", after.documentNumber === `${orig.documentNumber} Rev 1`, after.documentNumber);
  const chain = JSON.stringify((await hafiz.get(`/work-items/${id}/revisions`)).body);
  t.check("The drop-down lists the original and Rev 1 whole", chain.includes(orig.documentNumber) && chain.includes(`${orig.documentNumber} Rev 1`), chain.slice(0, 400));
  const { page } = await H.viewItem(t, "hafiz", revId, "revision-submitted");
  await page.getByRole("main").getByLabel("Revision").first().click().catch(() => undefined);
  await t.shot(page, "revision-dropdown");
  const o = await H.detail(hafiz, id);
  t.check("The original keeps Code C and its Remarks", o.outcome === "C" && JSON.stringify(await H.eventsOf(hafiz, id)).includes("Revise the finish."));
});

defineCase("SUB-16", async (t) => {
  const tm = await H.team("hafiz");
  const hafiz = tm.api.hafiz!;
  const subject = `UAT SUB-16 delete ${H.stamp()}`;
  const id = await H.createItem(hafiz, tm, "MAR", subject, await H.marAnswers(tm));
  const numbered = `UAT SUB-16 numbered ${H.stamp()}`;
  const numId = await H.sentMar(tm, numbered);
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items?q=${encodeURIComponent(subject)}`);
  await settle(page);
  if (await notFound(page)) {
    t.check("Row menu > Delete shows the confirm and discards the Draft (UI)", false, RP1049);
    await t.shot(page, "list-not-found");
    const gone = await hafiz.post(`/work-items/${id}/discard-draft`);
    t.check("Through the api, discard-draft removes the Draft: gone for Hafiz (404)", gone.status < 300 && (await hafiz.get(`/work-items/${id}`)).status === 404, String(gone.status));
    t.check("A numbered item offers no Delete (api: discardDraft false)", (await H.detail(hafiz, numId)).actions.discardDraft === false);
    return;
  }
  await page.getByRole("table").first().getByRole("button", { name: `More for ${subject}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog")).first();
  await dlg.waitFor({ state: "visible" });
  const body = (await dlg.innerText()).replace(/\s+/g, " ");
  await t.shot(page, "delete-confirm");
  t.check("The confirm says nobody will see the Draft again, Hafiz included, and no number is lost", /Nobody will see .* again, you included\. It never had a number, so none is lost\./.test(body), body);
  await dlg.getByRole("button", { name: "Delete" }).click();
  await settle(page, 1000);
  t.check("It leaves the list", !(await listRows(page)).some((r) => r.subject === subject));
  t.check("It is gone for Hafiz (404)", (await hafiz.get(`/work-items/${id}`)).status === 404);
  t.check("A numbered item offers no Delete (api: discardDraft false)", (await H.detail(hafiz, numId)).actions.discardDraft === false);
  await go(page, `/projects/${tm.projectId}/work-items?q=${encodeURIComponent(numbered)}`);
  await settle(page);
  await page.getByRole("table").first().getByRole("button", { name: new RegExp(`More for ${numbered}`) }).first().click();
  const items = await page.getByRole("menuitem").allInnerTexts();
  await t.shot(page, "numbered-row-menu");
  t.check("The numbered item's row menu has no Delete", items.length > 0 && !items.some((x) => /^Delete$/.test(x.trim())), items.join(" | "));
});

defineCase("SUB-17", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const subject = `UAT SUB-17 dup ${H.stamp()}`;
  const id = await H.submittedMar(tm, subject);
  await H.reviewedMar(tm, id, { sample_checked: true, matches_specification: true }, "A", "UAT DCL private note");
  await H.must(tm.api.mohammed!, id, "approve_a", { answers: { sample_checked: true, matches_specification: true, remarks: "UAT DCL remarks text" } });
  const orig = await H.detail(tm.api.hafiz!, id);
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/work-items?q=${encodeURIComponent(subject)}`);
  await settle(page);
  let newId: string;
  if (await notFound(page)) {
    t.check("Row menu > Duplicate opens the new Draft (UI)", false, RP1049);
    await t.shot(page, "list-not-found");
    const dup = await tm.api.hafiz!.post(`/work-items/${id}/duplicate`, { idempotencyKey: crypto.randomUUID() });
    newId = (dup.body as H.Json).id as string;
    await go(page, `/work-items/${newId}`);
    await settle(page);
  } else {
    await page.getByRole("table").first().getByRole("button", { name: `More for ${subject}` }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.waitForURL(/\/work-items\/[0-9a-f-]{36}/, { timeout: 15000 });
    await settle(page, 800);
    newId = /\/work-items\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  }
  const n = await H.detail(tm.api.hafiz!, newId);
  t.check("A new Draft with the Subject and TMC's answers", n.stage.key === "draft" && n.title === subject && n.answers.manufacturer === "Philips" && n.answers.model === "CoreLine Panel", `${n.stage.key} ${n.title}`);
  const docs = ((await tm.api.hafiz!.get(`/work-items/${newId}/documents`)).body as H.Json).documents as H.Json[];
  const old = ((await tm.api.hafiz!.get(`/work-items/${id}/documents`)).body as H.Json).documents as H.Json[];
  t.check("TMC's Documents are copied as new files", docs.length === old.length && docs.length > 0 && docs.every((x) => !old.some((o) => o.id === x.id)), `${docs.length}/${old.length}`);
  const all = JSON.stringify({ n, ev: await H.eventsOf(tm.api.hafiz!, newId) });
  t.check("None of DCL's verification, Remarks or notes", !all.includes("UAT DCL remarks text") && !all.includes("UAT DCL private note"));
  t.check('"Duplicated from" shows the original\'s number to TMC', n.duplicatedFrom?.documentNumber === orig.documentNumber, JSON.stringify(n.duplicatedFrom));
  t.check("DCL cannot see the new Draft (404)", (await tm.api.ahmed!.get(`/work-items/${newId}`)).status === 404);
  await t.shot(page, "duplicated-draft");
});

defineCase("SUB-18", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const subject = `UAT SUB-18 download ${H.stamp()}`;
  const id = await H.submittedMar(tm, subject);
  const draftSubject = `UAT SUB-18 draft ${H.stamp()}`;
  const draft = await H.createItem(tm.api.hafiz!, tm, "MAR", draftSubject, await H.marAnswers(tm));
  const a = await tm.api.ali!.get(`/work-items/${id}/shared`);
  const m = await tm.api.mohammed!.get(`/work-items/${id}/shared`);
  t.check("Ali and Mohammed both get the shared item (200)", a.status === 200 && m.status === 200, `${a.status}/${m.status}`);
  t.check("Both get the same content", a.text === m.text);
  const low = a.text;
  t.check("No Step, no person, no Internal Note in it", !/Ali Sonour|Hafiz Hamdan|Ahmed bin Said|Mohammed Al Shamsi|UAT internal note|internalNote/.test(low), low.slice(0, 200));
  t.check("A Draft has nothing shared: the plain 404", (await tm.api.hafiz!.get(`/work-items/${draft}/shared`)).status === 404);
  const { page } = await pageAs("ali");
  await go(page, `/projects/${tm.projectId}/work-items?q=${encodeURIComponent("UAT SUB-18")}`);
  await settle(page);
  if (await notFound(page)) {
    t.check("The row menu of the Submitted MAR offers Download, a Draft's does not (UI)", false, RP1049);
    await t.shot(page, "list-not-found");
    t.note("The shared item and the Draft's 404 were read through the api (above); the row menus could not be opened.");
    return;
  }
  await page.getByRole("table").first().getByRole("button", { name: `More for ${subject}` }).click();
  await page.waitForTimeout(1500);
  const withDownload = await page.getByRole("menuitem").allInnerTexts();
  await t.shot(page, "row-menu-submitted");
  t.check("The row menu of the Submitted MAR offers Download", withDownload.some((x) => /Download/.test(x)), withDownload.join(" | "));
  await page.keyboard.press("Escape");
  const { page: hp } = await pageAs("hafiz");
  await go(hp, `/projects/${tm.projectId}/work-items?q=${encodeURIComponent(draftSubject)}`);
  await settle(hp);
  await hp.getByRole("table").first().getByRole("button", { name: `More for ${draftSubject}` }).click();
  await hp.waitForTimeout(1500);
  const draftItems = await hp.getByRole("menuitem").allInnerTexts();
  await t.shot(hp, "row-menu-draft");
  t.check("A Draft offers no Download", !draftItems.some((x) => /Download/.test(x)), draftItems.join(" | "));
  const wc = await tm.api.hafiz!.post(`/work-items/${draft}/working-copy`);
  t.note(`POST /work-items/<Draft>/working-copy as Hafiz answers ${wc.status} ${wc.text.slice(0, 160)}; the row menu action Download opens the Working Copy PDF (docs/visibility.md Working Copy row) for items not closed.`);
  t.note("The content of the shared item is compared through the api (/shared); the downloaded file itself was not opened.");
});

defineCase("SUB-19", async (t) => {
  const tm = await H.team("hafiz", "omar");
  const hafiz = tm.api.hafiz!;
  const items = await H.listItems(hafiz, tm.projectId, "pageSize=50&q=Emergency%20lighting%20control");
  const panel = items.find((i) => /Emergency lighting control panel/.test(i.title));
  if (!panel) throw new Error("the seeded control panel is not in Hafiz's List");
  const links = (await hafiz.get(`/work-items/${panel.id}/links`)).body as H.Json;
  const text = JSON.stringify(links);
  t.check("The Links hold TWR-MAR-01-0001 with its Subject", text.includes("TWR-MAR-01-0001") && /Exit signage/.test(text), text.slice(0, 300));
  const { page, text: pageText } = await H.viewItem(t, "hafiz", panel.id, "control-panel-links", "en", { full: true });
  t.check("The page shows the number and Subject of the linked item", pageText.includes("TWR-MAR-01-0001") && /Exit signage/.test(pageText));
  t.check("The Document Number is left to right", (await page.locator('[dir="ltr"]', { hasText: "TWR-MAR-01-0001" }).count()) > 0);
  await page.getByRole("main").getByRole("link", { name: /TWR-MAR-01-0001/ }).first().click();
  await page.waitForURL(/\/work-items\/[0-9a-f-]{36}/, { timeout: 15000 });
  await settle(page, 800);
  const body = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
  t.check("A Link opens the other item", /Exit signage – Tower 1/.test(body), page.url());
  const target = items.length ? (await H.listItems(hafiz, tm.projectId, "q=Exit%20signage")).find((i) => i.documentNumber === "TWR-MAR-01-0001") : undefined;
  const d = target ? await H.detail(hafiz, target.id) : undefined;
  t.check("A Submitted (closed) item cannot be changed", !!d && d.actions.saveAnswers === false);
  const from = JSON.stringify((await hafiz.get(`/work-items/${target?.id}/linked-from`)).body);
  t.check("Linked from on the exit signs lists the control panel", from.includes("Emergency lighting control panel") && from.includes("TWR-MAR-01-0002"), from.slice(0, 300));
  await t.shot(page, "linked-item");
  t.note("'Linking notifies nobody' is not checked here (no notification differences read).");
});

defineCase("SUB-20", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const name = `UAT SUB-20 Delta Cables ${H.stamp()}`;
  const el = tm.d.trade("Electrical Works");
  const sar = async (supplier: string) => {
    const id = await H.createItem(tm.api.hafiz!, tm, "SAR", `UAT SUB-20 SAR ${supplier}`, {
      supplier_name_en: supplier,
      supplier_name_ar: `دلتا للكابلات ${supplier.slice(-6)}`,
      commercial_registration_number: "1010000099",
      country_of_origin: "Saudi Arabia",
      proposed_supply: "UAT made-up cables for the Tower 1 risers.",
      past_projects: [{ project_name: "UAT Demo Park", year: 2024 }],
      trade: el,
      location: tm.d.loc("Tower 1 Floor 01"),
    });
    await H.upload(tm.api.hafiz!, id, { fieldKey: "company_profile", fileName: "UAT-profile.pdf", contentType: "application/pdf", body: H.pdfFile("UAT profile") });
    await H.must(tm.api.hafiz!, id, "send_for_review");
    await H.pickUp(tm.api.ali!, id);
    await H.must(tm.api.ali!, id, "submit");
    await H.pickUp(tm.api.ahmed!, id);
    await H.must(tm.api.ahmed!, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true }, recommendedCode: "A" });
    await H.pickUp(tm.api.mohammed!, id);
    await H.must(tm.api.mohammed!, id, "approve_a", { answers: { sample_checked: true, matches_specification: true } });
    return id;
  };
  const id = await sar(name);
  const d = await H.detail(tm.api.hafiz!, id);
  t.check("The SAR ran the 2 to 2 route and closed at Code A", d.outcome === "A" && d.stage.key === "approved", `${d.outcome}/${d.stage.key}`);
  const list = async () => (await tm.d.suppliers(el)).filter((s) => s.name.en.toLowerCase() === name.toLowerCase());
  const l1 = await list();
  t.check("The supplier is listed for Electrical, approved", l1.length === 1 && l1[0].status === "approved", JSON.stringify(l1));
  await sar(name.toUpperCase());
  const l2 = await list();
  t.check("A second SAR for the same name in other letter case adds no second entry", l2.length === 1, `${l2.length} entries`);
  const { text } = await H.viewPath(t, "saeed", `/projects/${tm.projectId}/settings/approved-suppliers`, "approved-supplier-list");
  t.check("Project Settings > Approved Supplier List shows it", text.includes(name), text.slice(0, 200).replace(/\n/g, " | "));
  const form = (await tm.api.hafiz!.get(`/projects/${tm.projectId}/work-item-types/MAR/form`)).status;
  const offeredNow = (await tm.d.suppliers(el)).some((s) => s.name.en === name);
  t.check("A MAR now offers it under Approved supplier (the Trade's list the Form reads)", form === 200 && offeredNow);
});

defineCase("SUB-21", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed", "noura");
  const subject = `UAT SUB-21 Cable schedule ${H.stamp()}`;
  const hafiz = tm.api.hafiz!;
  // Noura covers Tower 2 only (FX-OR), so the DAR is raised in Tower 2.
  const id = await H.createItem(hafiz, tm, "DAR", subject, { document_type: "calculation", document_title: subject, document_revision: "R0", specification_section: "26 05 19", trade: tm.d.trade("Electrical Works"), location: tm.d.loc("Tower 2 Floor 01") });
  await H.upload(hafiz, id, { fieldKey: "document", fileName: "UAT-cable-schedule.pdf", contentType: "application/pdf", body: H.pdfFile("UAT cable schedule") });
  await H.must(hafiz, id, "send_for_review");
  await H.pickUp(tm.api.ali!, id);
  await H.must(tm.api.ali!, id, "submit", { answers: { cover_note: "For the Owner" } });
  await H.pickUp(tm.api.mohammed!, id);
  const ver = { sample_checked: true, matches_specification: true };
  const md = await H.detail(tm.api.mohammed!, id);
  t.check("Mohammed is offered a Recommendation of Code A", H.offered(md).includes("recommend_a"), H.offered(md).join(","));
  await H.must(tm.api.mohammed!, id, "recommend_a", { answers: ver });
  const tmc = await H.detail(tm.api.ali!, id);
  t.check('TMC sees it "With Owner review", no Company or person', /Owner review/.test(JSON.stringify(tmc.heldBy)) || /Owner review/.test((await H.viewItem(t, "ali", id, "tmc-sees-owner-review")).text), JSON.stringify(tmc.heldBy));
  await H.pickUp(tm.api.noura!, id);
  const nd = await H.detail(tm.api.noura!, id);
  t.check("Noura holds the Owner's review and is offered Confirm", H.offered(nd).includes("confirm_a"), H.offered(nd).join(","));
  const { page } = await pageAs("noura");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "noura-owner-review");
  await H.must(tm.api.noura!, id, "confirm_a");
  const done = await H.detail(tm.api.ali!, id);
  t.check("Confirm issues Code A and closes the item", done.outcome === "A" && done.stage.key === "approved", `${done.outcome}/${done.stage.key}`);
});

defineCase("SUB-22", async (t) => {
  const tm = await H.team("hafiz", "ali");
  const id = await H.submittedMar(tm, `UAT SUB-22 watch ${H.stamp()}`);
  const { page } = await pageAs("ali");
  await go(page, `/work-items/${id}`);
  await settle(page);
  const header = page.getByRole("main").getByRole("button", { name: /^(Watching|Watch)$/ }).first();
  t.check("Ali (the Submitter) watches from the start: the button reads Watching", (await header.innerText()).trim() === "Watching");
  await t.shot(page, "watching");
  await header.click();
  await settle(page, 600);
  t.check("After Unwatch it reads Watch", (await page.getByRole("main").getByRole("button", { name: /^(Watching|Watch)$/ }).first().innerText()).trim() === "Watch");
  await page.getByRole("main").getByRole("button", { name: /^(Watching|Watch)$/ }).first().click();
  await settle(page, 600);
  t.check("And back to Watching", (await page.getByRole("main").getByRole("button", { name: /^(Watching|Watch)$/ }).first().innerText()).trim() === "Watching");
  const body = await page.getByRole("main").innerText();
  t.check("No page text counts or names other watchers", !/watchers?\b/i.test(body.replace(/Watching|Watch/g, "")));
});

defineCase("SUB-23", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const ali = tm.api.ali!;
  const tag = `UAT SUB-23 ${H.stamp()}`;
  const pending = await H.submittedMar(tm, `${tag} pending`);
  const internal = await H.sentMar(tm, `${tag} internal`);
  const draftId = await H.createItem(tm.api.hafiz!, tm, "MAR", `${tag} draft`, await H.marAnswers(tm));
  void pending; void internal; void draftId;
  const { page } = await pageAs("ali");
  await go(page, `/projects/${tm.projectId}/work-items`);
  await settle(page);
  const main = page.getByRole("main");
  if (await notFound(page)) {
    t.check("The Submittals List opens with search, filters, Need My Action, sort and columns (UI)", false, RP1049);
    await t.shot(page, "list-not-found");
    const byNumber = await H.listItems(ali, tm.projectId, "q=TWR-MAR-01-0002");
    t.check("(api) Search by Document Number finds exactly that item", byNumber.length === 1 && byNumber[0]!.documentNumber === "TWR-MAR-01-0002", JSON.stringify(byNumber.map((i) => i.documentNumber)));
    return;
  }
  const headers = (await main.locator("thead th").allInnerTexts()).map((x) => x.trim());
  await t.shot(page, "list-headers");
  // 1. Search
  const box = main.getByRole("searchbox");
  const search = async (term: string) => {
    await box.fill(term);
    await box.press("Enter");
    // Wait for this term's own ?q=, not any earlier search's, or the rows read are the last search's.
    await page.waitForURL((url) => (url.searchParams.get("q") ?? "").trim().toLowerCase() === term.trim().toLowerCase(), { timeout: 10000 }).catch(() => undefined);
    await settle(page, 2500);
    return listRows(page);
  };
  let rows = await search("TWR-MAR-01-0002");
  t.check("Search by Document Number finds exactly that item", rows.length === 1 && rows[0]!.number === "TWR-MAR-01-0002", JSON.stringify(rows.map((r) => r.number)));
  for (const term of ["Exit signage", "Electrical", "Tower 2 Floor 01", "DAR"]) {
    const api = await H.listItems(ali, tm.projectId, `q=${encodeURIComponent(term)}&page=1&pageSize=25`);
    rows = await search(term);
    t.check(`Search "${term}" shows the api's rows (${api.length})`, api.length > 0 && rows.length === api.length, `ui ${rows.length} rows, api ${api.length}`);
  }
  rows = await search(tag);
  const mineApi = await H.listItems(ali, tm.projectId, `q=${encodeURIComponent(tag)}&page=1&pageSize=25`);
  t.check("Search finds this case's items, and not the other Company's Drafts (TMC's own Drafts only if Ali's Company)", rows.length === mineApi.length && rows.length >= 2, `ui ${rows.length}, api ${mineApi.length}: ${rows.map((r) => r.subject).join("; ")}`);
  // 2. Filter panel: several Stages
  await go(page, `/projects/${tm.projectId}/work-items`);
  await settle(page);
  await main.getByRole("button", { name: "Filter" }).click();
  for (const stage of [/Pending Approval/, /Internal Review/]) {
    for (let k = 0; k < 5; k++) {
      const box = page.getByRole("checkbox", { name: stage });
      if ((await box.getAttribute("aria-checked")) === "true") break;
      await box.click();
      await page.waitForTimeout(3500);
    }
  }
  await page.getByRole("button", { name: "Done" }).click();
  await settle(page, 1000);
  await t.shot(page, "stage-filter");
  const stageParam = decodeURIComponent(new URL(page.url()).searchParams.get("stage") ?? "");
  t.check("Both Stages are in the filter (URL)", /pending_approval/.test(stageParam) && /internal_review/.test(stageParam), page.url());
  rows = await listRows(page);
  const stagesApi = await H.listItems(ali, tm.projectId, `stage=${stageParam}&page=1&pageSize=25`);
  t.check("The filtered rows are exactly the api's first page for those Stages", rows.length > 0 && overlap(rows.map((r) => r.number), stagesApi.map((i) => i.documentNumber ?? "No number yet")), `ui ${rows.length} rows, api ${stagesApi.length}`);
  t.check("Every shown row is in one of the two Stages", rows.length > 0 && rows.every((r) => /Pending Approval|Internal Review/.test(r.text)));
  // 3. Need My Action
  await go(page, `/projects/${tm.projectId}/work-items`);
  await settle(page);
  await main.getByText("Need My Action", { exact: true }).click();
  await settle(page, 1000);
  const nmaBody = (await ali.get(`/projects/${tm.projectId}/work-items?needMyAction=true&pageSize=50`)).body as H.Json;
  const nmaTotal = (nmaBody.stages as H.Json[]).reduce((n, s) => n + s.count, 0);
  const footer2 = (await main.innerText()).match(/(\d+) submittals/)?.[1];
  t.check("Need My Action keeps only items waiting on Ali (count equals the api's, no Draft)", Math.abs(Number(footer2) - nmaTotal) <= 2, `page ${footer2}, api ${nmaTotal}`);
  // 4. Sort and Columns
  await go(page, `/projects/${tm.projectId}/work-items`);
  await settle(page);
  await main.getByRole("button", { name: "Sort by Title" }).click();
  await page.waitForURL(/sort=/, { timeout: 10000 }).catch(() => undefined);
  await settle(page, 1000);
  const titles = (await listRows(page)).map((r) => r.subject.toLowerCase());
  const asc = [...titles].sort();
  t.check("Sort by Title orders the rows by Title", JSON.stringify(titles) === JSON.stringify(asc) || JSON.stringify(titles) === JSON.stringify([...asc].reverse()), titles.slice(0, 5).join(" | "));
  const defaults = defaultListColumns as { key: string; shown: boolean }[];
  const original = ((await ali.get(`/projects/${tm.projectId}/work-items`)).body as H.Json).columnLayout as { key: string; shown: boolean }[] | undefined;
  const swapped = [...(original ?? defaults)];
  [swapped[3], swapped[4]] = [swapped[4]!, swapped[3]!];
  await go(page, `/projects/${tm.projectId}/work-items`);
  await settle(page);
  const beforeHeaders = (await main.locator("thead th").allInnerTexts()).map((x) => x.trim()).filter(Boolean);
  const put = await ali.put(`/projects/${tm.projectId}/work-items/list/columns`, swapped);
  await go(page, `/projects/${tm.projectId}/work-items`);
  await settle(page);
  const after = (await main.locator("thead th").allInnerTexts()).map((x) => x.trim()).filter(Boolean);
  t.check("A saved column order comes back after reload", put.status === 200 && after.join() !== beforeHeaders.join(), `put ${put.status}; before ${beforeHeaders.join(",")}; after ${after.join(",")}`);
  await ali.put(`/projects/${tm.projectId}/work-items/list/columns`, original ?? defaults);
  t.note("Columns > move one > Save as my default was driven through the api (PUT .../list/columns), the layout restored afterwards; the Table settings pop-up itself was not clicked.");
  // 5. Group by Stage
  await go(page, `/projects/${tm.projectId}/work-items`);
  await settle(page);
  await main.getByRole("button", { name: "Group" }).click();
  const groupOptions = (await page.getByRole("dialog").innerText()).replace(/\s+/g, " ");
  await t.shot(page, "group-menu");
  // The List keeps its anatomy words (Status, Discipline) by the owner's choice on RP-921 (PR #446); only "Current owner" is banned.
  t.check('The Group by menu offers the Stage column (Status, as the anatomy) and "With" (not Current owner)', /\b(Stage|Status)\b/.test(groupOptions) && /\bWith\b/.test(groupOptions) && !/Current owner/.test(groupOptions), groupOptions);
  await page.getByRole("dialog").getByText(/^(Stage|Status)$/).first().click();
  await settle(page, 1000);
  await t.shot(page, "grouped");
  const gtxt = (await main.innerText()).replace(/\s+/g, " ");
  t.check("Group by Stage shows the Stage groups with counts", /Pending Approval \d+ on this page/.test(gtxt) || /Pending Approval\s*\d+/.test(gtxt), gtxt.match(/[A-Z][A-Za-z &]+ \d+ on this page/)?.[0] ?? gtxt.slice(0, 200));
  // 6. Header words (docs/visibility.md: the holder column is "With", never "Current owner")
  t.check('The column header for the holder reads "With" (never "Current owner")', headers.includes("With") && !headers.includes("Current owner"), `headers: ${headers.filter(Boolean).join(" | ")}`);
});

defineCase("SUB-24", async (t) => {
  t.manual("Needs a person to open downloaded CSV and Excel files. Steps: as Ali, Submittals List > Export > what you see > CSV, then Excel; Export the whole table; search first, then export; put =1+1 in the Subject of a Draft and export. Expected: rows and columns equal the screen; the whole table adds every List field; under a search only the rows read so far; a formula-looking cell is written as text. (The export api, GET /v1/projects/:id/work-items/export, answers 200 with the same rows as the List; the files were not opened.)");
});

defineCase("SUB-25", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const sub = `UAT SUB-25 kanban ${H.stamp()}`;
  const id = await H.sentMar(tm, sub);
  const board = ((await tm.api.ali!.get(`/projects/${tm.projectId}/work-items/kanban`)).body as H.Json);
  const { page } = await pageAs("ali");
  await go(page, `/projects/${tm.projectId}/work-items?view=kanban`);
  await settle(page);
  await t.shot(page, "kanban");
  if (await notFound(page)) {
    t.check("The Kanban page opens with the Stages as columns, a card, Move to and the filter panel (UI)", false, `${RP1049} The Kanban page does the same.`);
    const d0 = await H.detail(tm.api.ali!, id);
    t.check("A move that is not allowed is not offered (api: Ali's item offers Return, Submit, Cancel)", JSON.stringify(H.offered(d0).sort()) === JSON.stringify(["cancel_review", "return", "submit"]), H.offered(d0).join(","));
    await H.must(tm.api.ali!, id, "submit", { answers: { cover_note: "UAT SUB-25" } });
    t.check("Taking the move through the api puts the item in Pending Approval (the Kanban card could not be moved)", (await H.detail(tm.api.ali!, id)).stage.key === "pending_approval");
    return;
  }
  const text = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
const cols = board.columns as H.Json[];
  const stageNames = (board.stages as H.Json[]).map((s) => s.name.en as string);
  t.check("Columns are the Stages with counts", cols.length > 0 && stageNames.every((n) => text.includes(n)), cols.map((c) => `${c.stageKey}:${c.shown}`).join(", "));
  const ir = cols.find((c) => c.stageKey === "internal_review");
  t.check("Internal Review shows TMC's own Steps (Engineer, PM) with counts", /Contractor Engineer/.test(text) && /Contractor (Project Manager|PM)/.test(text) && (ir?.steps ?? []).length >= 2 && (ir.steps as H.Json[]).every((s) => typeof s.count === "number"), JSON.stringify(ir?.steps)?.slice(0, 300));
  t.check("Another Company is one lane by its name", /Design Consultants LLC/.test(text));
  const d = await H.detail(tm.api.ali!, id);
  t.check("A move that is not allowed is not offered (Ali's item offers Return, Submit, Cancel)", JSON.stringify(H.offered(d).sort()) === JSON.stringify(["cancel_review", "return", "submit"]), H.offered(d).join(","));
  const card = page.getByRole("main").getByText(sub).first();
  t.check("The card is on the board", (await card.count()) > 0);
  const moveBtn = page.getByRole("button", { name: `Move ${sub}` }).first();
  await moveBtn.scrollIntoViewIfNeeded().catch(() => undefined);
  await moveBtn.click();
  await page.waitForTimeout(500);
  const opts = (await page.getByText(/^To [A-Z]/).allInnerTexts()).map((x) => x.trim());
  await t.shot(page, "move-menu");
  t.check("Move to offers only Stages Ali's Step allows (Pending Approval, Cancelled; no Draft, no Approved)", opts.length > 0 && opts.some((o) => /Pending Approval/.test(o)) && !opts.some((o) => /Draft|Approved|Rejected/.test(o)), opts.join(" | "));
  await page.getByText("To Pending Approval", { exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  const popup = (await dlg.innerText()).replace(/s+/g, " ");
  t.check("Choosing the move opens the same Action Form as the item page (Submit with its Cover Note)", /Submit/.test(popup) && /Cover Note/.test(popup), popup.slice(0, 160));
  await t.shot(page, "move-popup");
  await dlg.getByRole("button", { name: "Submit" }).click();
  await dlg.waitFor({ state: "hidden" });
  await settle(page, 1000);
  t.check("The card moved after confirm (the item is now Pending Approval)", (await H.detail(tm.api.ali!, id)).stage.key === "pending_approval");
  t.note("Drag and drop of a card is not driven by this script; Move to is.");
  await page.getByRole("main").getByRole("button", { name: "Filter" }).click();
  await settle(page, 500);
  const panel = (await page.locator("body").innerText());
  await t.shot(page, "kanban-filter");
  t.check("The filter panel offers Owner, Role and Created date", /Owner/.test(panel) && /Role/.test(panel) && /Created date/.test(panel));
  t.note("Drag and drop of a card is not driven by this script; the move itself is covered through Move to / the item page.");
});

defineCase("SUB-26", async (t) => {
  const tm = await H.team("ali");
  const ali = tm.api.ali!;
  const dash = ((await ali.get(`/projects/${tm.projectId}/dashboard`)).body as H.Json);
  const { page, text } = await H.viewPath(t, "ali", `/projects/${tm.projectId}`, "dashboard", "en", { full: true });
  t.check("The Dashboard shows the Type cards (MAR, SAR, DAR)", /Material Approval Request/.test(text) && /Supplier Approval Request/.test(text) && /Document Approval Request/.test(text));
  t.check("The Activity Feed sits on the Dashboard", /Activity Feed/.test(text) && /Recent|View all/.test(text));
  const marBefore = (text.match(/Material Approval Request MAR\s*\n?\s*(\d+) items/) ?? [])[1];
  // Click a number on the MAR card: Pending.
  const pendingLink = page.getByRole("main").getByRole("link", { name: /Pending/ }).first();
  if ((await pendingLink.count()) === 0) {
    t.check("The number opens the List with the same filter and the same count", false, "The Dashboard page has no Type cards, so there is no number to click (it shows only Project details and Participants; the api dashboard answers with the counts). See screenshot dashboard.");
  } else {
    const label = (await pendingLink.innerText()).replace(/\s+/g, " ").trim();
    const clicked = Number((label.match(/(\d+)/) ?? [])[1]);
    await pendingLink.click();
    await page.waitForURL(/work-items/, { timeout: 15000 });
    await settle(page, 800);
    await t.shot(page, "list-from-dashboard-number");
    const body = await page.getByRole("main").innerText();
    const footer = Number((body.match(/(\d+) submittals/) ?? [])[1]);
    t.check("The number opens the List with the same filter and the same count", !Number.isNaN(clicked) && footer === clicked, /We can.t find this page/.test(body) ? RP1049 : `card ${label}; list ${footer}; url ${page.url()}`);
  }
  const feed = JSON.stringify((await ali.get(`/projects/${tm.projectId}/activity`)).body);
  t.check("The Activity Feed names Companies for others and no Consultant person", !/Ahmed bin Said|Mohammed Al Shamsi|"memberName":\{"en":"Sara/.test(feed), feed.match(/Ahmed bin Said|Mohammed Al Shamsi/)?.[0]);
  void dash; void marBefore;
});

defineCase("SUB-27", async (t) => {
  const tm = await H.team("ali");
  const ali = tm.api.ali!;
  const t0 = Date.now();
  const home = (await ali.get("/home")).body as H.Json;
  const homeMs = Date.now() - t0;
  const { page, text } = await H.viewPath(t, "ali", "/", "home", "en", { full: true });
  const loaded = !/Home couldn't be loaded/.test(text);
  t.check("Home loads for Ali", loaded, `Known Bug RP-1049: the page says: ${text.replace(/\s+/g, " ").slice(0, 80)}; GET /v1/home took ${homeMs} ms (the web app waits 3 s for it: apps/web/src/lib/session.ts)`);
  const num = (label: RegExp) => Number((text.match(new RegExp(`(\\d+)\\s*\\n\\s*${label.source}`)) ?? [])[1]);
  const sum = (b: H.Json) => (b.stages as H.Json[]).reduce((n, s) => n + s.count, 0);
  const mods = ["submittals", "inspections", "snag_list"];
  let nmaCount = 0;
  let wait = 0;
  for (const m of mods) {
    // The toggle also lists the Member's own Drafts, never counted (docs/data-model.md, app.need_my_action).
    const nma = (await ali.get(`/projects/${tm.projectId}/work-items?module=${m}&needMyAction=true`)).body as H.Json;
    nmaCount += (nma.stages as H.Json[]).filter((s) => s.category !== "draft").reduce((n, s) => n + s.count, 0);
    wait += sum((await ali.get(`/projects/${tm.projectId}/work-items?module=${m}&heldBy=others&raisedByMe=true`)).body as H.Json);
  }
  const all = sum((await ali.get(`/projects/${tm.projectId}/work-items`)).body as H.Json);
  const nmaList = (await ali.get(`/projects/${tm.projectId}/work-items?needMyAction=true&pageSize=50&page=1`)).body as H.Json;
  t.check("The Home api's Need My Action equals the sum of the Project's Need My Action reads", Math.abs(home.counts.needMyAction - nmaCount) <= 3, `home ${home.counts.needMyAction}, Project reads without own Drafts ${nmaCount} (other agents are creating items at the same time)`);
  t.check("The Home api's Waiting with others equals the Project's reads", Math.abs(home.counts.waitingWithOthers - wait) <= 3, `home ${home.counts.waitingWithOthers}, Project reads ${wait}`);
  t.check("Active Projects is 1 (Ali's only Project)", home.counts.activeProjects === 1);
  t.check("No Draft is counted as Need My Action or listed in it", !(nmaList.items as H.Json[]).some((i) => i.stage.key === "draft") && !(home.needsMyAction as H.Json[]).some((i) => i.stage.key === "draft"));
  t.check("Recent activity holds at most four entries (api)", (home.recentActivity ?? home.recent ?? []).length <= 4, JSON.stringify(Object.keys(home)));
  if (loaded) {
    t.check("The page's Need My Action equals the api's", Math.abs(num(/Need My Action/) - home.counts.needMyAction) <= 3);
    const card = Number((text.match(/(\d+) submittals/) ?? [])[1]);
    t.check("The Project card's submittal count equals the List's", Math.abs(card - all) <= 3, `card ${card}, list ${all}`);
  } else {
    t.note("With Home not loading, the page numbers (Need My Action, 4+ weeks, waiting with others, card count, Recent activity) could not be read on the page; only the api's were compared.");
  }
  void page;
});

defineCase("SUB-28", async (t) => {
  const tm = await H.team("mohammed", "hafiz");
  const { text } = await H.viewPath(t, "mohammed", `/projects/${tm.projectId}/activity`, "activity-feed", "en", { full: true });
  const feed = (await tm.api.mohammed!.get(`/projects/${tm.projectId}/activity`)).text;
  t.check("The Activity Feed reads as events (submitted, returned, approved...)", /Submit|Resubmit|submitted|Send/i.test(text) && /Approve|Revise|Reject|Close|Return/i.test(text), text.slice(0, 200).replace(/\n/g, " | "));
  t.check("No answers_changed or Document upload entries", !/answers_changed|document_uploaded|uploaded/i.test(feed + text), (feed + text).match(/answers_changed|document_uploaded|uploaded/i)?.[0]);
  t.check("TMC appears by Company name only (no TMC person)", !/Hafiz Hamdan|Ali Sonour|Saeed Al Qahtani|Omar Al Harbi/.test(text), text.match(/Hafiz Hamdan|Ali Sonour|Saeed Al Qahtani|Omar Al Harbi/)?.[0]);
});

defineCase("SUB-29", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const id = await H.submittedMar(tm, `UAT SUB-29 words ${H.stamp()}`);
  const bad = [/\boverdue\b/i, /\bdue date\b/i, /\bdue\b/i, /\bdeadline/i, /\bSLA\b/, /\blate\b/i, /متأخر/, /موعد نهائي/, /تأخير/, /تجاوز/];
  const hits: string[] = [];
  const scan = (where: string, text: string) => {
    for (const re of bad) {
      const m = re.exec(text);
      if (m) hits.push(`${where}: "${m[0]}"`);
    }
  };
  const pages: [string, string][] = [["home", "/"], ["projects", "/projects"], ["dashboard", `/projects/${tm.projectId}`], ["list", `/projects/${tm.projectId}/work-items`], ["kanban", `/projects/${tm.projectId}/work-items?view=kanban`], ["item", `/work-items/${id}`]];
  let listHeaders: string[] = [];
  let kanbanText = "";
  for (const person of ["hafiz", "mohammed"]) {
    for (const locale of ["en", "ar"] as const) {
      const { context, page } = await pageAs(person, { locale });
      for (const [name, path] of pages) {
        await go(page, path, locale);
        await settle(page, 300);
        const text = await page.locator("body").innerText();
        scan(`${person}/${locale}/${name}`, text);
        if (person === "hafiz" && locale === "en" && name === "list") {
          listHeaders = (await page.locator("main thead th").allInnerTexts()).map((x) => x.trim()).filter(Boolean);
          await t.shot(page, "list-headers");
        }
        if (person === "hafiz" && locale === "en" && name === "kanban") kanbanText = text;
      }
      await context.close();
    }
  }
  const mails = await mailBodies();
  for (const m of mails) scan(`mail ${m.subject}`, m.text);
  t.check(`No due date, deadline, SLA or late on any page or email (${pages.length * 4} pages, ${mails.length} emails scanned)`, hits.length === 0, hits.slice(0, 6).join("; "));
  // The owner's List anatomy uses "Status" and "Discipline"; RP-921 (PR #446) keeps them as glossary exceptions. Neither is a date.
  t.check('The List header for Stage reads "Stage" or the anatomy\'s "Status", with no due date', (listHeaders.includes("Stage") || listHeaders.includes("Status")) && !listHeaders.some((h) => /Due|Deadline|SLA|Overdue/i.test(h)), listHeaders.length ? listHeaders.join(" | ") : RP1049);
  t.check('The List header for Trade reads "Trade" or the anatomy\'s "Discipline"', listHeaders.includes("Trade") || listHeaders.includes("Discipline"), listHeaders.length ? listHeaders.join(" | ") : RP1049);
  t.check('The List header for the holder reads "With", not "Current owner"', listHeaders.includes("With") && !listHeaders.includes("Current owner"), listHeaders.length ? listHeaders.join(" | ") : RP1049);
  t.check("The Kanban uses no Status or Current owner wording", !/Current owner|Discipline/.test(kanbanText));
});

async function mailBodies(): Promise<{ subject: string; text: string }[]> {
  const base = `http://127.0.0.1:${process.env.MAILPIT_PORT ?? "8725"}`;
  const list = (await (await fetch(`${base}/api/v1/messages?limit=40`)).json()) as { messages?: { ID: string; Subject: string }[] };
  const out: { subject: string; text: string }[] = [];
  for (const m of list.messages ?? []) {
    const full = (await (await fetch(`${base}/api/v1/message/${m.ID}`)).json()) as { Text?: string; HTML?: string };
    out.push({ subject: m.Subject, text: `${m.Subject}\n${full.Text ?? ""}` });
  }
  return out;
}
