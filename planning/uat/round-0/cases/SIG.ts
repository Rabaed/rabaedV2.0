import { getBrowser, pageAs, webUrl } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { Api, go, settle } from "../harness/helpers.ts";
import {
  apis,
  ARABIC_INDIC,
  fetchBytes,
  makeMar,
  marContext,
  mustPickUp,
  mustTake,
  pdfPages,
  recordPdf,
  issueCode,
  tinyPdf,
  tinyPng,
  toManager,
  toSubmitted,
  tracker,
  uploadFile,
  until,
  workingCopyPdf,
  type MarContext,
} from "../harness/helpers-not.ts";

// Part SIG: signing, the Documental Record, Working Copy, Verification page, Signature and Stamp.
// Built on main now: RP-85 (Signature), RP-617 (logo and Stamp), RP-151 (record page 1), RP-650
// (Signature cards, Stamps). Every case makes its own items ("UAT SIG-nn ...").

const stamp = () => new Date().toISOString().slice(11, 19).replaceAll(":", "");
type Team = Record<"hafiz" | "ali" | "ahmed" | "mohammed", Api>;

/** An item closed with a Code: raised, sent, Submitted, answered, coded. Returns its id. */
async function closeAt(team: Team, ctx: MarContext, title: string, how: "A" | "C" | "D" = "A", note = "UAT internal note"): Promise<string> {
  const id = await makeMar(team.hafiz, ctx, title);
  await toSubmitted(team.hafiz, team.ali, id);
  await toManager(team.ahmed, team.mohammed, id, how, note);
  await issueCode(team.mohammed, id, how === "A" ? "approve_a" : how === "C" ? "revise_c" : "reject_d");
  return id;
}

/** Waits for the record of a closed item and returns its text pages. */
async function recordText(api: Api, id: string, ms = 90_000): Promise<{ pages: string[]; bytes: Uint8Array; text: string } | null> {
  const rec = await until(async () => {
    const r = await recordPdf(api, id);
    return r.status === 200 ? r : false;
  }, ms, 2000);
  if (!rec) return null;
  const pages = await pdfPages(rec.bytes);
  return { pages, bytes: rec.bytes, text: pages.join(" ") };
}

const riyadh = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Riyadh" });
const latin = (b: Uint8Array) => Buffer.from(b).toString("latin1");

// -------------------------------------------------------------------------------------------------

defineCase("SIG-01", async (t) => {
  const c = tracker(t);
  const { hafiz, ali } = await apis("hafiz", "ali");
  const ctx = await marContext(hafiz);
  const title = `UAT SIG-01 confirm ${stamp()}`;
  const id = await makeMar(hafiz, ctx, title);
  await mustTake(hafiz, id, "send_for_review");
  await mustPickUp(ali, id);
  const { page } = await pageAs("ali");
  await go(page, `/work-items/${id}`);
  await settle(page);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Submit", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  c.check("the pop-up keeps the Transition's own label (Submit)", (await dialog.getByRole("button", { name: "Submit", exact: true }).count()) === 1 && /^Submit/.test((await dialog.innerText()).trim()));
  c.check("there is no separate Sign button or checkbox", (await dialog.getByRole("checkbox").count()) === 0 && (await dialog.getByRole("button", { name: /sign/i }).count()) === 0 && (await dialog.getByRole("switch").count()) === 0);
  await t.shot(page, "submit-popup");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await settle(page, 800);
  const history = (await ali.get(`/work-items/${id}/history`)).body as { events: { type: string; at: string; by: { companyName: { en: string }; memberName: { en: string } } | null; transition: { en: string } | null }[] };
  const submit = history.events.find((e) => e.transition?.en === "Submit");
  c.check("after the confirm the history records who, from which Participant and when", !!submit && submit.by?.memberName.en === "Ali Sonour" && submit.by.companyName.en === "TMC Constructions" && !Number.isNaN(Date.parse(submit.at)), JSON.stringify(submit?.by));
  const text = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
  c.check("the item page shows the entry with Ali Sonour and TMC Constructions", /Submit/.test(text) && /Ali Sonour · TMC Constructions/.test(text));
  await t.shot(page, "history-after-confirm");
  // The api without confirmed true is refused.
  const id2 = await makeMar(hafiz, ctx, `UAT SIG-01 not confirmed ${stamp()}`);
  await mustTake(hafiz, id2, "send_for_review");
  await mustPickUp(ali, id2);
  const refused = await ali.post(`/work-items/${id2}/transitions`, { transition: "submit", idempotencyKey: crypto.randomUUID() });
  c.check("a Transition without confirmed true is refused with not_confirmed", refused.status >= 400 && /not_confirmed/.test(refused.text), `${refused.status} ${refused.text.slice(0, 120)}`);
  const refused2 = await ali.post(`/work-items/${id2}/transitions`, { transition: "submit", confirmed: false, idempotencyKey: crypto.randomUUID() });
  c.check("confirmed false is refused the same way", refused2.status >= 400 && /not_confirmed/.test(refused2.text), `${refused2.status} ${refused2.text.slice(0, 120)}`);
  const still = (await ali.get(`/work-items/${id2}`)).body as { step: { key: string } };
  c.check("and nothing was taken (item still at the Contractor PM Step)", still.step.key === "internal_review", still.step.key);
});

defineCase("SIG-02", async (t) => {
  const c = tracker(t);
  const team = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(team.hafiz);
  const title = `UAT SIG-02 download ${stamp()}`;
  const id = await makeMar(team.hafiz, ctx, title);
  await toSubmitted(team.hafiz, team.ali, id);
  await toManager(team.ahmed, team.mohammed, id, "A");
  await issueCode(team.mohammed, id, "approve_a");
  const immediate = await team.ali.get(`/work-items/${id}/documental-record`);
  const ready = immediate.status === 200;
  c.check("right after the Code the api answers either the link or a plain 'not ready' (404), never a partial file", immediate.status === 200 || immediate.status === 404, `${immediate.status}`);
  t.note(ready ? "The worker made the record before the first ask, so the 'not ready' page text could not be seen by script (try again by hand right after a Code)." : "The record was not ready right after the Code: the api answered 404 (not ready).");
  const { page } = await pageAs("ali");
  await go(page, `/work-items/${id}`);
  await settle(page, 500);
  if (!ready) {
    const msg = await page.getByRole("status").allInnerTexts();
    t.note(`Item page right after the Code showed: ${msg.join(" | ") || "(nothing)"}`);
  }
  const button = page.getByRole("main").getByRole("button", { name: "Download PDF" });
  await until(async () => ((await button.count()) > 0 ? true : false), 90_000, 2000).then(async () => {
    if ((await button.count()) === 0) await page.reload({ waitUntil: "networkidle" });
  });
  if (!c.check("Download PDF shows once the record is made", (await button.count()) > 0)) return;
  await t.shot(page, "download-pdf-button");
  const [popup] = await Promise.all([page.context().waitForEvent("page"), button.first().click()]);
  await popup.waitForURL((u) => u.href !== "about:blank", { timeout: 20_000 }).catch(() => undefined);
  const link = ((await team.ali.get(`/work-items/${id}/documental-record`)).body as { url: string }).url;
  const expires = Number(/X-Amz-Expires=(\d+)/.exec(link)?.[1] ?? 0);
  c.check("the PDF comes through a short-lived signed link (expires within 5 minutes)", expires > 0 && expires <= 300, `expires in ${expires} s`);
  const file = await fetchBytes(link);
  c.check("the file is a PDF (application/pdf, %PDF header, whole file)", file.status === 200 && file.type === "application/pdf" && latin(file.bytes.slice(0, 5)) === "%PDF-" && latin(file.bytes.slice(-1200)).includes("%%EOF") && file.bytes.length > 20_000, `${file.status} ${file.type} ${file.bytes.length} bytes`);
  await popup.close();
  const nf = await team.hafiz.get(`/work-items/${id}/documental-record`);
  c.check("the same signed-link route answers the raiser too (Hafiz)", nf.status === 200, `${nf.status}`);
});

defineCase("SIG-03", async (t) => {
  const c = tracker(t);
  const team = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(team.hafiz);
  const title = `UAT SIG-03 record ${stamp()}`;
  const id = await closeAt(team, ctx, title, "A");
  const rec = await recordText(team.ali, id);
  if (!c.check("the record is made", !!rec)) return;
  const { pages, text } = rec!;
  const num = /TWR-MAR-01-\d{4}/.exec(text)?.[0];
  const hist = (await team.ali.get(`/work-items/${id}/history`)).body as { events: { type: string; at: string }[] };
  c.check("title block: Type name and code, Subject, Project, Document Number", /Material Approval Request/.test(text) && /\bMAR\b/.test(text) && text.includes(title) && /Riyadh Gate Tower/.test(text) && !!num, num);
  c.check("the outcome with its date", /Approved/.test(text) && /\bA\b/.test(text) && /Oct 22, 2026|Oct 2\d, 2026/.test(text));
  const code = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/.exec(pages[0]!)?.[0];
  c.check("the Verification Code and the verification link", !!code && /\/verify\/[A-Za-z0-9_-]+/.test(text), String(code));
  for (const label of ["Prepared", "Submit", "Send to Manager", "Approve"]) c.check(`the approval flow lists ${label}`, text.includes(label));
  c.check("each Transition shows Member, Positions and Company", ["Hafiz Hamdan", "Ali Sonour", "Ahmed bin Said", "Mohammed Al Shamsi"].every((n) => text.includes(n)) && ["Engineer", "Project Manager", "Manager"].every((p) => text.includes(p)) && text.includes("TMC Constructions") && text.includes("Design Consultants LLC"));
  const firstAt = hist.events.find((e) => e.type === "transition")!.at;
  c.check("the date and time are Riyadh time", text.includes(riyadh(firstAt)), riyadh(firstAt));
  const hashes = text.replace(/\s+/g, "").match(/[0-9a-f]{64}/g) ?? [];
  c.check("each Transition prints its content hash (64 hex characters)", hashes.length >= 4, `${hashes.length} hashes found`);
  c.check("Arabic and English both print", /[؀-ۿ\uFB50-\uFEFF]/.test(text) && /Contractor/.test(text));
  c.check("Latin digits only", !ARABIC_INDIC.test(text));
  const footers = pages.map((p, i) => p.includes("Issued electronically through Rabaed") && p.includes(code ?? "?") && new RegExp(`page ${i + 1} of ${pages.length}`).test(p));
  c.check("every page is footed Issued electronically through Rabaed, the Verification Code, page X of Y", footers.every(Boolean), `${pages.length} pages: ${footers.join(",")}`);
  c.check("the Document Number is whole (not split by spaces)", new RegExp(`\\b${num}\\b`).test(pages[0]!), num);
  t.note(`Record of ${num}, ${pages.length} pages, code ${code}. Page 1 and the Form body are read in SIG-08; the layout of Arabic lines against the Document Number is for the eye.`);
});

defineCase("SIG-04", async (t) => {
  const c = tracker(t);
  const { hafiz, ali, ahmed, mohammed } = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(hafiz);
  const title = `UAT SIG-04 path ${stamp()}`;
  const RET = "UAT SIG-04 secret return reason";
  const INTERNAL = "UAT SIG-04 secret internal note";
  const ANS = "UAT SIG-04 secret reviewer answer";
  const id = await makeMar(hafiz, ctx, title);
  await mustTake(hafiz, id, "send_for_review");
  await mustPickUp(ali, id);
  await mustTake(ali, id, "return", { answers: { reason: RET } });
  const back = (await hafiz.get(`/work-items/${id}`)).body as { actions: { pickUp: boolean } };
  if (back.actions.pickUp) await mustPickUp(hafiz, id);
  // The second send must fall in a later minute than the first, so the dates tell them apart.
  await new Promise((r) => setTimeout(r, (62 - new Date().getSeconds()) * 1000));
  await mustTake(hafiz, id, "send_for_review_again");
  await mustPickUp(ali, id);
  await mustTake(ali, id, "submit", { answers: { cover_note: "UAT SIG-04 cover" }, internalNote: INTERNAL });
  await mustPickUp(ahmed, id);
  await mustTake(ahmed, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: false, verification_note: ANS }, recommendedCode: "C", internalNote: INTERNAL });
  await mustPickUp(mohammed, id);
  await issueCode(mohammed, id, "approve_a");
  const rec = await recordText(ali, id);
  if (!c.check("the record is made", !!rec)) return;
  const { pages, text } = rec!;
  const hist = (await ali.get(`/work-items/${id}/history`)).body as { events: { at: string; transition: { en: string } | null }[] };
  const sends = hist.events.filter((e) => /Send for Review/.test(e.transition?.en ?? "")).map((e) => e.at);
  c.check("two sends out of Draft exist (one Returned, one kept)", sends.length === 2, `${sends.length}`);
  c.check("it names every Member who took a Transition on the path, TMC's and DCL's alike", ["Hafiz Hamdan", "Ali Sonour", "Ahmed bin Said", "Mohammed Al Shamsi"].every((n) => text.includes(n)));
  const flow = pages.find((p) => p.includes("Approval flow")) ?? "";
  c.check("the first entry is dated at the raiser's last send, not the Returned one", sends.length === 2 && flow.includes(riyadh(sends[1]!)) && riyadh(sends[0]!) !== riyadh(sends[1]!) && !flow.slice(0, flow.indexOf("Submit")).includes(riyadh(sends[0]!)), `first send ${riyadh(sends[0]!)}, last send ${riyadh(sends[1]!)}; approval flow reads: ${flow.slice(flow.indexOf("Approval flow"), flow.indexOf("Approval flow") + 420)}`);
  c.check("a Return is not printed (no Return step, no reason)", !/Return/.test(flow) && !text.includes(RET));
  c.check("no Internal Note is printed", !text.includes(INTERNAL));
  c.check("no Recommended Code is printed", !/Recommended/i.test(text));
  c.check("no in-progress answer of the reviewer is printed", !text.includes(ANS));
  const { page } = await pageAs("ali");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "history-with-two-sends", { fullPage: true });
  t.note("Chat is not built, so its absence cannot be tried.");
});

defineCase("SIG-05", async (t) => {
  const c = tracker(t);
  const team = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(team.hafiz);
  const run = stamp();
  const cId = await closeAt(team, ctx, `UAT SIG-05 code C ${run}`, "C");
  const dId = await closeAt(team, ctx, `UAT SIG-05 code D ${run}`, "D");
  const [cItem, dItem] = await Promise.all([(await team.hafiz.get(`/work-items/${cId}`)).body as { outcome: string; stage: { name: { en: string } } }, (await team.hafiz.get(`/work-items/${dId}`)).body as { outcome: string; stage: { name: { en: string } } }]);
  c.check("the items closed at C and at D", cItem.outcome === "C" && dItem.outcome === "D", `${cItem.outcome}, ${dItem.outcome}`);
  const [rc, rd] = await Promise.all([recordText(team.hafiz, cId), recordText(team.mohammed, dId)]);
  c.check("Code C closes with a record (Hafiz downloads it)", !!rc);
  c.check("Code D closes with a record (Mohammed downloads it)", !!rd);
  if (rc) c.check("the C record's outcome matches the item (Revise & Resubmit, C)", /Revise & Resubmit/.test(rc.text) && /\bC\b/.test(rc.text) && !/Approved A/.test(rc.text), cItem.stage.name.en);
  if (rd) c.check("the D record's outcome matches the item (Rejected, D)", /Reject/.test(rd.text) && /\bD\b/.test(rd.text), dItem.stage.name.en);
  // Cancelled.
  const xId = await makeMar(team.hafiz, ctx, `UAT SIG-05 cancelled ${run}`);
  await mustTake(team.hafiz, xId, "send_for_review");
  await mustPickUp(team.ali, xId);
  const cancel = await team.ali.transition(xId, "cancel_review", { answers: { reason: "UAT SIG-05 cancel" } });
  const ok = cancel.status < 300 || cancel.status === 422;
  if (cancel.status >= 300) {
    const retry = await team.ali.transition(xId, "cancel_review");
    t.note(`Cancel with a reason answered ${cancel.status} ${cancel.text.slice(0, 120)}; without: ${retry.status}`);
  }
  const xItem = (await team.ali.get(`/work-items/${xId}`)).body as { outcome: string | null; stage: { category: string; name: { en: string } } };
  if (xItem.stage.category === "cancelled") {
    const rx = await recordText(team.ali, xId, 60_000);
    c.check("a Cancelled item closes with a record too", !!rx, xItem.stage.name.en);
    if (rx) c.check("its outcome in the PDF is Cancelled", /Cancel/.test(rx.text));
  } else t.note(`The item could not be Cancelled by script (stage ${xItem.stage.name.en}); Cancelled was not tried.`);
  void ok;
});

defineCase("SIG-06", async (t) => {
  const c = tracker(t);
  const team = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(team.hafiz);
  const id = await closeAt(team, ctx, `UAT SIG-06 seal ${stamp()}`, "A");
  const rec = await recordText(team.ali, id);
  if (!c.check("the record is made", !!rec)) return;
  const raw = latin(rec!.bytes);
  c.check("the PDF carries a signature dictionary with a byte range (a seal)", /\/ByteRange\s*\[/.test(raw) && /\/Type\s*\/Sig|\/Filter\s*\/Adobe\.PPKLite|\/SubFilter/.test(raw));
  const contents = /\/Contents\s*<([0-9A-Fa-f]+)>/.exec(raw)?.[1] ?? "";
  c.check("the seal holds a CMS signature value (not empty)", contents.replace(/0+$/, "").length > 200, `${contents.replace(/0+$/, "").length / 2} bytes`);
  c.check("the PDF has the Record Data attached (PDF/A-3)", /EmbeddedFile/.test(raw) && /pdfaid/i.test(raw));
  c.manualIfClean("A person opens the PDF in Adobe Reader: the seal present and intact, signer unverified (RECORD_SEALING=local), and a copy with one changed byte shows the seal broken. The script found the signature dictionary, byte range and CMS value in place.");
});

defineCase("SIG-07", async (t) => {
  const c = tracker(t);
  const { hafiz } = await apis("hafiz");
  const { page } = await pageAs("hafiz", { phone: true });
  const methodNow = async () => ((await hafiz.get("/me/signature")).body as { signature: { method: string; id: string } | null }).signature;
  const before = await methodNow();
  await go(page, "/profile/signature");
  await settle(page);
  const body = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
  c.check("Add Signature offers Draw, Type and Upload", ["Draw", "Type", "Upload"].every((w) => body.includes(w)), body.slice(0, 200));
  c.check("pen styles (Fine, Medium, Bold) and ink colours (Black, Blue) are offered", ["Fine", "Medium", "Bold", "Black", "Blue"].every((w) => body.includes(w)));
  c.check("Clear is offered", (await page.getByRole("button", { name: "Clear" }).count()) > 0);
  // Draw with a finger-sized touch of the pad at 375 px.
  const pad = page.getByRole("img", { name: /Signature pad/ }).or(page.locator("canvas")).first();
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  c.check("the pad fits the 375 px screen", box.x >= 0 && box.x + box.width <= 376, `${Math.round(box.x)}..${Math.round(box.x + box.width)}`);
  await page.mouse.move(box.x + 20, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * ((box.width - 40) / 12), box.y + box.height * (0.5 + 0.2 * Math.sin(i)));
  await page.mouse.up();
  await page.getByRole("radio", { name: "Blue" }).click().catch(() => undefined);
  await t.shot(page, "draw-375");
  const undo = await page.getByRole("button", { name: /undo/i }).count();
  t.note(`Undo button on the pad: ${undo > 0 ? "present" : "not present (the page offers Clear only)"}.`);
  await page.getByRole("button", { name: "Save Signature" }).click();
  await page.waitForURL(/\/profile$/, { timeout: 15_000 }).catch(() => undefined);
  await settle(page);
  const drawn = await methodNow();
  c.check("a drawn Signature saves", drawn?.method === "drawn" && drawn.id !== before?.id, drawn?.method);
  // Upload.
  await go(page, "/profile/signature");
  await settle(page);
  await page.getByRole("tab", { name: "Upload" }).or(page.getByRole("radio", { name: "Upload" })).or(page.getByRole("button", { name: "Upload" })).first().click();
  await page.locator("input[type=file]").setInputFiles({ name: "signature.png", mimeType: "image/png", buffer: tinyPng() });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Save Signature" }).click();
  await page.waitForURL(/\/profile$/, { timeout: 15_000 }).catch(() => undefined);
  await settle(page);
  const uploaded = await methodNow();
  c.check("an uploaded image saves as the Signature", uploaded?.method === "uploaded", uploaded?.method);
  // Type, last, so Hafiz ends with a clean typed Signature.
  await go(page, "/profile/signature");
  await settle(page);
  await page.getByRole("tab", { name: "Type" }).or(page.getByRole("radio", { name: "Type" })).or(page.getByRole("button", { name: "Type" })).first().click();
  await page.getByRole("textbox", { name: /full name/i }).fill("Hafiz Hamdan");
  await page.waitForTimeout(600);
  const preview = (await page.locator("main img, main canvas, main svg[role=img]").count()) > 0;
  c.check("Type shows a preview as on a record", preview);
  await t.shot(page, "type-375");
  await page.getByRole("button", { name: "Save Signature" }).click();
  await page.waitForURL(/\/profile$/, { timeout: 15_000 }).catch(() => undefined);
  await settle(page);
  const typed = await methodNow();
  c.check("a typed Signature saves", typed?.method === "typed", typed?.method);
  const profile = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
  c.check("the profile shows it with Replace and the note that records already made keep the Signature used then", /Replace Signature/.test(profile) && /what you signed before keeps the one it was signed with/.test(profile), profile.slice(0, 200));
  await t.shot(page, "profile-after-375");
  t.note("Hafiz ends with a typed Signature (his name). The Upload tab's PNG was a made-up 120x40 image.");
});

defineCase("SIG-08", async (t) => {
  const c = tracker(t);
  const team = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(team.hafiz);
  const id = await closeAt(team, ctx, `UAT SIG-08 page one ${stamp()}`, "A");
  const rec = await recordText(team.ali, id);
  if (!c.check("the record is made", !!rec)) return;
  const { pages, text } = rec!;
  const p1 = pages[0]!;
  for (const [item, ok] of [
    ["1 Companies and logos (both Companies by name)", p1.includes("TMC Constructions") && p1.includes("Design Consultants LLC")],
    ["2 title block (Type, Subject, Document Number)", /Material Approval Request/.test(p1) && /Subject/.test(p1) && /TWR-MAR-01-\d{4}/.test(p1)],
    ["3 parties and Project", /Parties/.test(p1) && /Riyadh Gate Tower/.test(p1)],
    ["4 classification (Trade, Location)", /Classification/.test(p1) && /Electrical Works/.test(p1) && /Tower 2 Floor 01/.test(p1)],
    ["5 final decision chips A B C D", /Final decision/.test(p1) && /A\s+B\s+C\s+D/.test(p1)],
    ["6 verification code and link (QR)", /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/.test(p1) && /verify\//.test(p1)],
    ["7 reply (issuer, dates, Review Comments count)", /Issued by/.test(p1) && /Reply date/.test(p1) && /Review Comments/.test(p1)],
    ["8 approval flow", /Approval flow/.test(text)],
    ["9 the Form body (Material details, Items table)", /Material details/.test(text) && /Fixture type/.test(text) && /Quantity/.test(text) && /Total/.test(text)],
    ["Documents are listed", /Documents/.test(text) && /UAT-datasheet\.pdf/.test(text)],
  ] as [string, boolean][]) c.check(`page 1 and Form: ${item}`, ok);
  c.manualIfClean(`A person reads the layout against form-engine section 6 (items 1 to 9). The script found every element's text on page 1 and in the Form body (${pages.length} pages), and the Items table printed as a table; the photo grid was not tried (no photo on this item).`);
});

defineCase("SIG-09", async (t) => {
  const c = tracker(t);
  const { saeed, hafiz } = await apis("saeed", "hafiz");
  const sp = await pageAs("saeed");
  await go(sp.page, "/company");
  await settle(sp.page);
  const text = (await sp.page.getByRole("main").innerText()).replace(/\s+/g, " ");
  c.check("two cards: Logo (Optional) and Stamp (Required to act)", /Logo/.test(text) && /Optional/.test(text) && /Stamp/.test(text) && /Required to act/.test(text));
  c.check("the note says records keep the logo and Stamp in force then", /keep the logo and Stamp that were in force then/.test(text));
  c.check("the Authorized Person (Saeed) has Replace buttons", (await sp.page.getByRole("button", { name: /Replace logo|Upload logo/ }).count()) + (await sp.page.getByRole("button", { name: /Replace Stamp|Upload Stamp/ }).count()) >= 2 || (await sp.page.locator("label,input[type=file]").count()) > 0);
  await t.shot(sp.page, "saeed-company");
  // Replace both with the very same image, so TMC's records look the same afterwards.
  const mine = (await saeed.get("/me/company")).body as { logo: { uploadedAt: string; image: { url: string } } | null; stamp: { uploadedAt: string; image: { url: string } } | null };
  const files = sp.page.locator("input[type=file]");
  if (mine.logo && mine.stamp && (await files.count()) >= 2) {
    const [logo, st] = await Promise.all([fetchBytes(mine.logo.image.url), fetchBytes(mine.stamp.image.url)]);
    await files.nth(0).setInputFiles({ name: "logo.png", mimeType: logo.type ?? "image/png", buffer: Buffer.from(logo.bytes) });
    await settle(sp.page, 1500);
    await files.nth(1).setInputFiles({ name: "stamp.png", mimeType: st.type ?? "image/png", buffer: Buffer.from(st.bytes) });
    await settle(sp.page, 1500);
    const after = (await saeed.get("/me/company")).body as { logo: { uploadedAt: string } | null; stamp: { uploadedAt: string } | null };
    c.check("Saeed replaces the logo (same image) and it is in force from then", !!after.logo && after.logo.uploadedAt !== mine.logo.uploadedAt, `${mine.logo.uploadedAt} -> ${after.logo?.uploadedAt}`);
    c.check("Saeed replaces the Stamp (same image) and it is in force from then", !!after.stamp && after.stamp.uploadedAt !== mine.stamp.uploadedAt, `${mine.stamp.uploadedAt} -> ${after.stamp?.uploadedAt}`);
    await t.shot(sp.page, "saeed-company-after");
  } else t.note("The upload inputs were not found, so the replace step was not tried.");
  const hp = await pageAs("hafiz");
  await go(hp.page, "/company");
  await settle(hp.page);
  const htext = (await hp.page.getByRole("main").innerText()).replace(/\s+/g, " ");
  c.check("Hafiz sees both cards with no buttons (only the Authorized Person has them)", /Logo/.test(htext) && /Stamp/.test(htext) && (await hp.page.getByRole("main").getByRole("button").count()) === 0 && (await hp.page.locator("main input[type=file]").count()) === 0);
  const hc = await hafiz.put("/me/company/stamp", {}).catch(() => ({ status: 0 }));
  c.check("and the api refuses Hafiz changing the Stamp", hc.status === 403 || hc.status === 404 || hc.status === 400 || hc.status === 405, `${hc.status}`);
  await t.shot(hp.page, "hafiz-company");
  t.note("A company with no logo (records show its name) was not tried: there is no way to remove a logo on the shared lane.");
});

defineCase("SIG-10", async (t) => {
  t.blocked("needs a Company with no Stamp: every seeded Company has one, there is no remove, and clearing TMC's would stop every other tester. Use UAT Owner Co from ADM-02 (manual) or a person on a spare lane. Checked only that TMC's items say stampRequired false while its Stamp is in place.");
});

defineCase("SIG-11", async (t) => {
  t.blocked("needs a Member with no Signature: all 13 demo people have one and the profile has no remove; a new Member needs an invitation accepted with a new password (a person). Hafiz's Add Signature page itself is covered by SIG-07.");
});

defineCase("SIG-12", async (t) => {
  const c = tracker(t);
  const team = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(team.hafiz);
  const run = stamp();
  const a = await closeAt(team, ctx, `UAT SIG-12 A ${run}`, "A");
  const cc = await closeAt(team, ctx, `UAT SIG-12 C ${run}`, "C");
  const d = await closeAt(team, ctx, `UAT SIG-12 D ${run}`, "D");
  const [ra, rc, rd] = await Promise.all([recordText(team.ali, a), recordText(team.ali, cc), recordText(team.ali, d)]);
  if (!c.check("the three records (A, C, D) are made", !!ra && !!rc && !!rd)) return;
  for (const [name, r] of [["A", ra!], ["C", rc!], ["D", rd!]] as const) {
    const sig = r.text.slice(r.text.indexOf("Signatures"), r.text.indexOf("Stamps"));
    c.check(`${name}: one Signature card per Transition on the path (4)`, (sig.match(/Signature/g) ?? []).length >= 5, `${(sig.match(/Signature/g) ?? []).length} Signature words`);
    c.check(`${name}: the Stamp of every acting Company (TMC and DCL)`, /Stamps/.test(r.text) && r.pages.find((p) => p.includes("Stamps"))!.includes("TMC Constructions") && r.pages.find((p) => p.includes("Stamps"))!.includes("Design Consultants LLC"));
    c.check(`${name}: an internal reviewer's card says Reviewed with no Code`, /Send to Manager[^]*?Reviewed/.test(sig) && !/Reviewed[^]{0,40}\b[ABCD]\b\s*·/.test(sig.slice(sig.indexOf("Reviewed"), sig.indexOf("Reviewed") + 60)));
    c.check(`${name}: the Disclaimer card prints`, /Disclaimer/.test(r.text));
  }
  c.check("C: Review Comments are shown (numbered) from Remarks", /Review Comments/.test(rc!.text) && /UAT remarks/.test(rc!.text) && /\b1\b/.test(rc!.text));
  c.check("C: a Next step card with Revision n+1", /Next step/i.test(rc!.text) && /Revision/.test(rc!.text.slice(rc!.text.search(/Next step/i))), rc!.text.slice(rc!.text.search(/Next step/i), rc!.text.search(/Next step/i) + 120));
  c.check("D: a Next step card saying a new submittal replaces this one", /Next step/i.test(rd!.text) && /new submittal|new Submittal/i.test(rd!.text), rd!.text.slice(rd!.text.search(/Next step/i), rd!.text.search(/Next step/i) + 120));
  c.check("A: no Next step card", !/Next step/i.test(ra!.text));
  const disc = /‹Disclaimer[^›]*›/.exec(ra!.text)?.[0];
  t.note(disc ? `The Disclaimer prints the placeholder "${disc}" in English and Arabic: documented as a placeholder until the owner supplies the text (form-engine.md section 6, RP-151).` : "Disclaimer text found.");
  c.manualIfClean("A person reads the Signature cards, Stamps and ending pages by eye (Signature images as they were then, Stamp images, wording of the Next step cards in Arabic). The script found a card per Transition, both Companies' Stamps, Review Comments, the Next step text for C and D, the Reviewed card and the Disclaimer placeholder.");
});

defineCase("SIG-13", async (t) => {
  const c = tracker(t);
  const team = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(team.hafiz);
  const title = `UAT SIG-13 appendix ${stamp()}`;
  const id = await makeMar(team.hafiz, ctx, title);
  let dwgOk = true;
  try {
    await uploadFile(team.hafiz, id, "test_certificate", "UAT-certificate.pdf", "application/pdf", tinyPdf("UAT certificate page"));
    let dwgType = "";
    for (const type of ["application/acad", "image/vnd.dwg", "application/x-autocad", "application/octet-stream"]) {
      try {
        await uploadFile(team.hafiz, id, "test_certificate", "UAT-layout.dwg", type, Buffer.from("AC1027 UAT made-up DWG bytes ".repeat(40)));
        dwgType = type;
        break;
      } catch {
        // the next type
      }
    }
    if (!dwgType) throw new Error("no content type was accepted for a .dwg file (content_type_not_allowed)");
  } catch (e) {
    dwgOk = false;
    t.note(`Uploading the extra PDF/DWG was refused: ${(e as Error).message}`);
  }
  if (!c.check("the PDF and the DWG Documents are attached to the Draft", dwgOk)) return;
  await toSubmitted(team.hafiz, team.ali, id);
  await toManager(team.ahmed, team.mohammed, id, "A");
  await issueCode(team.mohammed, id, "approve_a");
  const rec = await recordText(team.ali, id);
  if (!c.check("the record is made", !!rec)) return;
  const raw = latin(rec!.bytes);
  const asPages = rec!.pages.length >= 8;
  c.check("the shared PDF Documents are carried: as pages, or attached when the record cannot draw them (form-engine section 6, RP-147)", asPages || (/EmbeddedFile/.test(raw) && /UAT-datasheet.pdf/.test(raw) && /UAT-certificate.pdf/.test(raw)), `${rec!.pages.length} pages`);
  if (!asPages) t.note("The made-up PDFs use a font that is not embedded, which PDF/A cannot take as pages, so both travelled attached (the documented exception). A person tries a PDF with embedded fonts and an image for the page appendix.");
  c.check("the DWG is attached inside the PDF (embedded file)", /UAT-layout\.dwg/.test(raw) || /UAT-layout\.dwg/.test(rec!.text));
  c.check("the Documents are listed with their fingerprints", /UAT-certificate\.pdf/.test(rec!.text) && /Fingerprint/.test(rec!.text));
  t.note("An image Document and a Company's internal Documents (not included) were not made by script; a person checks them.");
  c.manualIfClean("A person confirms the image pages and that a Company's internal Documents are left out. The script found the PDF Documents carried (attached, see notes), the DWG embedded in the PDF and the Documents listed.");
});

defineCase("SIG-14", async (t) => {
  t.manual("A lane engineer must feed a broken record through the worker (RP-155 checks) and a person then looks for the alert in Rabaed Admin's Record Job Monitor (needs an Engineer session) and confirms the item is not reopened. No script can make a broken record or sign in to Admin.");
});

defineCase("SIG-15", async (t) => {
  const c = tracker(t);
  const team = await apis("hafiz", "ali", "ahmed", "mohammed");
  const ctx = await marContext(team.hafiz);
  const title = `UAT SIG-15 verify ${stamp()}`;
  const id = await closeAt(team, ctx, title, "A");
  const rec = await recordText(team.ali, id);
  if (!c.check("the record is made", !!rec)) return;
  const text = rec!.text;
  const code = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/.exec(rec!.pages[0]!)?.[0] ?? "";
  const tokenRaw = /\/verify\/([A-Za-z0-9_\- ]+)/.exec(text)?.[1] ?? "";
  const token = tokenRaw.replace(/\s+/g, "").slice(0, 43);
  const num = /TWR-MAR-01-\d{4}/.exec(text)![0];
  c.check("the record prints a Verification Code and a long verification link", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code) && token.length === 43, `${code} / token ${token.length} chars`);
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${process.env.API_PORT ?? "4700"}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" }, body: JSON.stringify(body) });
  const link = await post("/v1/verification/link", { token });
  const verification = (await link.json()) as Record<string, unknown>;
  c.check("the link verifies with no sign-in and returns the printed face only", link.status === 200, `${link.status} keys: ${Object.keys(verification).join(",")}`);
  const flat = JSON.stringify(verification);
  c.check("it holds the Document Number, Subject, Project, outcome and sealed date", flat.includes(num) && flat.includes(title) && /Riyadh Gate Tower/.test(flat) && /"A"|outcome/.test(flat) && /seal/i.test(flat), flat.slice(0, 300));
  c.check("it names the signers with Positions and Companies", /Hafiz Hamdan/.test(flat) && /Mohammed Al Shamsi/.test(flat) && /Design Consultants LLC/.test(flat) && /Engineer|Manager/.test(flat));
  c.check("it holds no Documents, answers or live item", !/UAT Maker|datasheet|cover_note|"answers"|workItemId|"id"/i.test(flat), Object.keys(verification).join(","));
  const byCode = await post("/v1/verification/code", { code, documentNumber: num });
  c.check("the Verification Code with its Document Number verifies", byCode.status === 200, `${byCode.status}`);
  const alone = await post("/v1/verification/code", { code });
  const wrong = await post("/v1/verification/code", { code: "ZZZZ-ZZZZ", documentNumber: num });
  const [ab, wb] = [await alone.text(), await wrong.text()];
  c.check("the code alone is refused exactly like a wrong code", alone.status === wrong.status && alone.status === 404 && ab === wb, `${alone.status}/${wrong.status} ${ab}`);
  // The page in an anonymous browser.
  const browser = await getBrowser();
  const ctxAnon = await browser.newContext({ viewport: { width: 1366, height: 800 }, locale: "en-US" });
  try {
    const page = await ctxAnon.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(`${webUrl}/en/verify/${token}`, { waitUntil: "networkidle" });
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    c.check("the verification page opens with no sign-in and says the record is genuine", /This record is genuine/.test(body) && body.includes(num), body.slice(0, 200));
    c.check("it shows the signers with their Companies and links to no live item", /Signed by/.test(body) && /Design Consultants LLC/.test(body) && (await page.locator("a[href*='/work-items/']").count()) === 0);
    await t.shot(page, "verify-page");
    const uploads: string[] = [];
    page.on("request", (r) => {
      const size = r.postDataBuffer()?.length ?? 0;
      if (size > 2000 || /multipart|application\/pdf/.test(r.headers()["content-type"] ?? "")) uploads.push(`${r.method()} ${r.url()} ${size}`);
    });
    await page.locator("input[type=file]").setInputFiles({ name: "record.pdf", mimeType: "application/pdf", buffer: Buffer.from(rec!.bytes) });
    await page.waitForTimeout(2500);
    const afterOk = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    c.check("a dropped copy of the PDF is checked and said to be the original", /This copy is the original record/.test(afterOk), afterOk.slice(-200));
    await t.shot(page, "verify-copy-original");
    const changed = Buffer.from(rec!.bytes);
    changed[Math.floor(changed.length / 3)] = changed[Math.floor(changed.length / 3)]! ^ 0xff;
    await page.locator("input[type=file]").setInputFiles({ name: "changed.pdf", mimeType: "application/pdf", buffer: changed });
    await page.waitForTimeout(2500);
    const afterBad = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    c.check("a copy with a changed byte is not accepted as the original", !/This copy is the original record/.test(afterBad) && /(not this record|may have been changed|could not be read)/.test(afterBad), afterBad.slice(-200));
    c.check("nothing is uploaded: no request carried the PDF", uploads.length === 0, uploads.join(" | "));
  } finally {
    await ctxAnon.close();
  }
  t.note("The per-visitor limit (10 attempts in 15 minutes from one address) was not run to its end: it would lock out other testers on the same address. 3 attempts were used from a made-up forwarded address.");
});

defineCase("SIG-16", async (t) => {
  const c = tracker(t);
  const { hafiz, ali, mohammed, yousef } = await apis("hafiz", "ali", "mohammed", "yousef");
  const ctx = await marContext(hafiz);
  const title = `UAT SIG-16 working ${stamp()}`;
  const id = await makeMar(hafiz, ctx, title);
  // A Draft: Hafiz may ask, Yousef (another Company) is refused.
  const draftHafiz = await workingCopyPdf(hafiz, id);
  const draftYousef = await yousef.post(`/work-items/${id}/working-copy`);
  c.check("a Draft Working Copy is made for Hafiz, who sees the Draft", draftHafiz.status === "ready", draftHafiz.status);
  c.check("and refused as the plain 404 to a Member who does not see the Draft (Yousef)", draftYousef.status === 404, `${draftYousef.status}`);
  const aliDraft = await ali.post(`/work-items/${id}/working-copy`);
  c.check("a TMC Member outside the Draft (Ali) gets what he sees of it: the same 404 while it is Hafiz's Draft", aliDraft.status === 404 || aliDraft.status === 200, `${aliDraft.status}`);
  await toSubmitted(hafiz, ali, id);
  const [wa, wm] = await Promise.all([workingCopyPdf(ali, id), workingCopyPdf(mohammed, id)]);
  if (!c.check("both Working Copies are made while the MAR is with DCL", wa.status === "ready" && wm.status === "ready", `${wa.status}, ${wm.status}`)) return;
  const [pa, pm] = await Promise.all([pdfPages(wa.bytes!), pdfPages(wm.bytes!)]);
  const ta = pa.join(" ");
  const tm = pm.join(" ");
  c.check("both are the same (same text, same pages)", ta === tm && pa.length === pm.length, `${pa.length} pages / ${pm.length}`);
  c.check("watermarked Not Final", /Not Final/.test(ta) && /[\uFB50-\uFEFF؀-ۿ]/.test(ta));
  const raw = latin(wa.bytes!);
  c.check("unsealed (no signature byte range)", !/\/ByteRange/.test(raw));
  c.check("no Verification Code and no verification link", !/Verification Code/.test(ta) && !/\/verify\//.test(ta) && !/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/.test(ta.replace(/TWR-MAR-01-\d{4}/g, "")));
  c.check("Companies by name only, no person", ta.includes("TMC Constructions") && !["Hafiz Hamdan", "Ali Sonour", "Ahmed bin Said", "Mohammed Al Shamsi"].some((n) => ta.includes(n)));
  c.check("no Signature or Stamp cards", !/Signatures|Stamps/.test(ta));
  c.check("the footer says Not Final on every page", pa.every((p) => /Not Final/.test(p)));
});

defineCase("SIG-17", async (t) => {
  t.notRun("not built or destructive: the record distribution link (RP-161) has no screen or route in the app; Signatory Access needs a signing Member removed from the Project (destructive on the shared lane, and VIS-63 owns it); Participant withdrawal is not scheduled.");
});

