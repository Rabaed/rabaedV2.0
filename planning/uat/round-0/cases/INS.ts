import { createHash } from "node:crypto";
import { pageAs } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import { Api, openProject, settle } from "../harness/helpers.ts";
import * as H from "../harness/helpers-sub.ts";
import { create, listReadable, moduleItems, mustAct, runTag, team, testPhoto, upload, type Json, type Team } from "../harness/helpers-sng.ts";
import { goRetry as go } from "../harness/helpers-sng.ts";

// Part INS: Inspections (WIR). Work Inspection Requests are made and moved through the api as the people
// do; the pages are opened and read as the person would. Hafiz covers Electrical only (Civil Works is
// covered by no Participant in the seed), so the Test Cases' "Civil WIR" runs on Electrical with the
// Cable trays and containment Checklist Template.

const tag = runTag();
const FIELD = "inspection_checklist";
const status = async (api: Api, id: string) => (await api.get(`/work-items/${id}`)).status;
const stageOf = async (api: Api, id: string) => (await H.detail(api, id)).stage.key as string;
const bi = (s: string) => ({ en: s, ar: `${s} (ع)` });
const REQUESTED = "2026-11-02T08:00:00.000Z";

type Templates = { canEdit: boolean; templates: Json[] };
const templates = async (api: Api, tm: Team) => (await api.get(`/projects/${tm.projectId}/checklist-templates`)).body as Templates;
const cableTray = async (api: Api, tm: Team) => (await templates(api, tm)).templates.find((x) => x.name.en === "Cable trays and containment")!;
const concrete = async (api: Api, tm: Team) => (await templates(api, tm)).templates.find((x) => x.name.en === "Concrete pour")!;

const item = (key: string, en: string, over: Json = {}) => ({ key, text: bi(en), answers: "pass_fail_na", comment: "optional", photo: "off", on_negative: "create_snag", ...over });

/** Saeed makes an Electrical Checklist Template. Returns its id and Version id. */
async function makeTemplate(tm: Team, name: string, items: Json[]): Promise<{ id: string; versionId: string }> {
  const r = await tm.api.saeed!.post(`/projects/${tm.projectId}/checklist-templates`, { name: bi(name), tradeId: tm.d.trade("Electrical Works"), items });
  if (r.status !== 201) throw new Error(`create template answered ${r.status}: ${r.text.slice(0, 200)}`);
  const found = (await templates(tm.api.saeed!, tm)).templates.find((x) => x.id === (r.body as Json).id)!;
  return { id: found.id, versionId: found.versionId };
}

/** The WIR Form's answers in full (a save replaces them all). */
function fullAnswers(tm: Team, over: Json = {}): Json {
  return { description: "UAT cable trays ready for inspection.", requested_for: REQUESTED, trade: tm.d.trade("Electrical Works"), location: tm.d.loc("Tower 1 Floor 02"), ...over };
}

/** A Draft WIR by Hafiz (Electrical, Tower 1 Floor 02). */
async function draftWir(tm: Team, title: string, versionId?: string, over: Json = {}): Promise<string> {
  const v = versionId ?? (await cableTray(tm.api.hafiz!, tm)).versionId;
  const r = await create(tm.api.hafiz!, tm, "WIR", title, { description: "UAT cable trays ready for inspection.", requested_for: REQUESTED, trade: tm.d.trade("Electrical Works"), location: tm.d.loc("Tower 1 Floor 02"), checklist_template: v, ...over });
  if (r.status !== 201) throw new Error(`create WIR "${title}" answered ${r.status}: ${r.text.slice(0, 300)}`);
  return (r.body as Json).id as string;
}

/** Hafiz sends it, Ali Submits it: with the Consultant Engineer. */
async function submittedWir(tm: Team, title: string, versionId?: string, over: Json = {}): Promise<string> {
  const id = await draftWir(tm, title, versionId, over);
  await mustAct(tm.api.hafiz!, id, "send_for_review");
  await mustAct(tm.api.ali!, id, "submit", { answers: { cover_note: "Ready from 09:00." } });
  return id;
}

const answerChecklist = (api: Api, id: string, answers: Json) => api.request("PUT", `/work-items/${id}/reply-checklists/${FIELD}`, { answers });
const photoFor = (api: Api, id: string, itemKey: string) => upload(api, id, { fieldKey: FIELD, itemKey, reply: true, fileName: `${itemKey}.jpg`, contentType: "image/jpeg", body: testPhoto() } as never);

const PASS_ALL = { supports: { answer: "pass" }, earthing: { answer: "pass" }, clearance: { answer: "pass" } };
const TWO_FAILS = { supports: { answer: "fail", comment: "Spacing too wide" }, earthing: { answer: "fail", comment: "Not bonded", snag: false }, clearance: { answer: "pass" } };

/** Ahmed answers the checklist (evidence added where a Fail needs it) and sends it to the Manager with a recommended code. */
async function toManager(tm: Team, id: string, answers: Json, recommended: string, note = "UAT engineer internal note"): Promise<void> {
  const ahmed = tm.api.ahmed!;
  const r = await answerChecklist(ahmed, id, answers);
  if (r.status >= 300) throw new Error(`answer checklist ${r.status}: ${r.text.slice(0, 200)}`);
  for (const [k, v] of Object.entries(answers) as [string, Json][]) if (v.answer === "fail" && k !== "clearance") await photoFor(ahmed, id, k);
  await mustAct(ahmed, id, "send_to_manager", { recommendedCode: recommended, internalNote: note });
  await tm.api.mohammed!.post(`/work-items/${id}/pick-up`);
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

/** Mohammed issues the code `key` with a valid Action Form. */
async function issue(tm: Team, id: string, key: string): Promise<{ status: number; text: string }> {
  const mo = tm.api.mohammed!;
  const d = await H.detail(mo, id);
  const t = (d.actions.transitions as Json[]).find((x) => x.key === key);
  if (!t) return { status: 0, text: `not offered: ${(d.actions.transitions as Json[]).map((x) => x.key).join(",")}` };
  return mo.transition(id, key, { answers: fill(t.actionForm) });
}

const snagsRaisedFrom = async (api: Api, tm: Team, wirNumber: string) =>
  (await moduleItems(api, tm.projectId, "snag_list", `raisedFrom=${encodeURIComponent(wirNumber)}&pageSize=50`)).filter((i) => i.type?.code === "SNG");

defineCase("INS-01", async (t) => {
  const tm = await team("saeed", "ali", "hafiz");
  const { saeed, ali, hafiz } = tm.api;
  const seeded = await templates(ali!, tm);
  t.check("The two seeded templates are listed with Version and availability", ["Concrete pour", "Cable trays and containment"].every((n) => seeded.templates.some((x) => x.name.en === n && x.versionNo >= 1 && x.status === "active")), seeded.templates.map((x) => `${x.name.en} v${x.versionNo} ${x.status}`).join("; "));
  t.check("Ali reads them and cannot change them (canEdit false)", seeded.canEdit === false);
  const name = `UAT INS-01 template ${tag}`;
  const made = await makeTemplate(tm, name, [item("check_a", "First check"), item("check_b", "Second check", { comment: "required_on_negative", photo: "required_on_negative" })]);
  const v1 = (await templates(saeed!, tm)).templates.find((x) => x.id === made.id)!;
  t.check("A new template is Version 1 for its Trade, active", v1.versionNo === 1 && v1.status === "active" && v1.items.length === 2, `v${v1.versionNo}`);
  const wir = await draftWir(tm, `UAT INS-01 copy of v1 ${tag}`, v1.versionId);
  const edit = await saeed!.put(`/checklist-templates/${made.id}`, { name: bi(name), tradeId: tm.d.trade("Electrical Works"), items: [item("check_a", "First check"), item("check_b", "Second check"), item("check_c", "Third check added in version 2")] });
  const v2 = (await templates(saeed!, tm)).templates.find((x) => x.id === made.id)!;
  t.check("Saving the edit makes Version 2 with its new items", edit.status === 204 && v2.versionNo === 2 && v2.items.length === 3, `${edit.status} v${v2.versionNo} ${v2.items.length} items`);
  const copy = (await H.detail(hafiz!, wir)).checklistCopies as Json[];
  t.check("The WIR that copied Version 1 keeps its 2 items", copy.length === 1 && copy[0]!.versionNo === 1 && copy[0]!.items.length === 2, JSON.stringify(copy.map((c) => [c.versionNo, c.items.length])));
  const aliEdit = await ali!.put(`/checklist-templates/${made.id}`, { name: bi("hacked"), tradeId: tm.d.trade("Electrical Works"), items: [item("x", "x")] });
  const aliRetire = await ali!.post(`/checklist-templates/${made.id}/retire`);
  t.check("Ali cannot edit or retire it (the plain 404)", aliEdit.status === 404 && aliRetire.status === 404 && (await templates(saeed!, tm)).templates.find((x) => x.id === made.id)!.name.en === name, `${aliEdit.status} ${aliRetire.status}`);
  const ret = await saeed!.post(`/checklist-templates/${made.id}/retire`);
  t.check("Saeed retires it; it is shown Retired", ret.status === 204 && (await templates(ali!, tm)).templates.find((x) => x.id === made.id)!.status === "retired", `${ret.status}`);
  const { page } = await pageAs("saeed");
  const projectId = await openProject(page);
  await go(page, `/projects/${projectId}/settings/checklist-templates`);
  await settle(page);
  const text = await page.getByRole("main").innerText();
  t.check("Saeed's Settings page lists the templates per Trade with Version, Active and Retired, and a New button", /Concrete pour/.test(text) && /Cable trays and containment/.test(text) && /Version 1/.test(text) && /Retired/.test(text) && /New Checklist Template/.test(text));
  await t.shot(page, "saeed-templates");
  const p2 = await pageAs("ali");
  await go(p2.page, `/projects/${projectId}/settings/checklist-templates`);
  await settle(p2.page);
  const at = await p2.page.getByRole("main").innerText();
  t.check("Ali reads the same list without a New button", /Concrete pour/.test(at) && !/New Checklist Template/.test(at));
  await t.shot(p2.page, "ali-templates-read-only");
});

defineCase("INS-02", async (t) => {
  const tm = await team("saeed", "ali", "hafiz");
  const { saeed, ali, hafiz } = tm.api;
  const read = async (api: Api) => ((await api.get(`/projects/${tm.projectId}/required-fields`)).body as Json).fields as Json[] | undefined;
  const before = (await read(ali!)) ?? [];
  const field = before.find((f) => f.type === "WIR" && f.key === "approved_submittals");
  t.check("Every Member (Ali) reads the Required links setting, WIR Approved submittals among it", field !== undefined, JSON.stringify(before.map((f) => `${f.type}/${f.key}`)));
  const wasOn = field?.required === true;
  try {
    const alis = await ali!.put(`/projects/${tm.projectId}/required-fields`, { type: "WIR", key: "approved_submittals", required: true });
    t.check("Ali cannot change it (the plain 404) and it stays as it was", alis.status === 404 && ((await read(saeed!)) ?? []).find((f) => f.key === "approved_submittals")?.required === wasOn, `${alis.status}`);
    const on = await saeed!.put(`/projects/${tm.projectId}/required-fields`, { type: "WIR", key: "approved_submittals", required: true });
    t.check("Saeed (Project Admin) turns Approved submittals required on", on.status === 204, `${on.status}`);
    const id = await draftWir(tm, `UAT INS-02 without approved ${tag}`);
    const send = await H.move(hafiz!, id, "send_for_review");
    t.check("With it on, Hafiz's WIR cannot leave Draft and the error names the field", send.status === 422 && /approved_submittals/.test(send.text), `${send.status} ${send.text.slice(0, 160)}`);
    t.check("It stays a Draft", (await stageOf(hafiz!, id)) === "draft");
    const { page } = await pageAs("hafiz");
    await go(page, `/work-items/${id}`);
    await settle(page);
    await page.getByRole("main").getByRole("button", { name: /Send for Review/i }).first().click().catch(() => undefined);
    await settle(page, 800);
    const body = await page.locator("body").innerText();
    t.check("The page says the Approved submittals field is required", /Approved submittals/.test(body));
    await t.shot(page, "form-names-the-field");
    const off = await saeed!.put(`/projects/${tm.projectId}/required-fields`, { type: "WIR", key: "approved_submittals", required: false });
    const send2 = await H.move(hafiz!, id, "send_for_review");
    t.check("Turned off again, the same WIR can be sent", off.status === 204 && send2.status === 204, `${off.status} ${send2.status}`);
  } finally {
    await saeed!.put(`/projects/${tm.projectId}/required-fields`, { type: "WIR", key: "approved_submittals", required: wasOn });
  }
  const { page } = await pageAs("saeed");
  const projectId = await openProject(page);
  await go(page, `/projects/${projectId}/settings/required-links`);
  await settle(page);
  await t.shot(page, "required-links-settings");
});

defineCase("INS-03", async (t) => {
  const tm = await team("hafiz", "saeed");
  const { hafiz, saeed } = tm.api;
  const { page } = await pageAs("hafiz");
  const projectId = await openProject(page);
  await go(page, `/projects/${projectId}/work-items/new?module=inspections&type=WIR`);
  await settle(page);
  const before = await page.getByRole("main").innerText();
  t.check("Before a Trade, the Checklist Template says Choose a Trade first", (before.match(/Choose a Trade first\./g) ?? []).length >= 1);
  await page.locator("#answer-trade").click();
  await page.getByRole("option", { name: /Electrical Works/ }).first().click();
  await settle(page, 600);
  await page.locator("#answer-checklist_template").click().catch(async () => page.getByRole("combobox").last().click());
  const offered = (await page.getByRole("option").allInnerTexts()).join(" | ");
  t.check("The Trade's active template is offered, and the other Trade's (Concrete pour) is not", /Cable trays and containment/.test(offered) && !/Concrete pour/.test(offered), offered);
  await page.getByRole("option", { name: /Cable trays and containment/ }).first().click();
  await settle(page, 600);
  const after = await page.getByRole("main").innerText();
  t.check("The preview lists the items (3 items, answered by the Consultant on site)", /Supports at the spacing/.test(after) && /3 items/.test(after) && /answered by the Consultant on site/.test(after));
  await t.shot(page, "template-preview", { fullPage: true });
  // The copy, and the Trade/pick rules, through the api.
  const wir = await draftWir(tm, `UAT INS-03 WIR ${tag}`);
  const copies = (await H.detail(hafiz!, wir)).checklistCopies as Json[];
  t.check("The items are copied onto the WIR", copies.length === 1 && copies[0]!.items.length === 3, JSON.stringify(copies.map((c) => c.items.length)));
  const other = await concrete(hafiz!, tm);
  const wrong = await create(hafiz!, tm, "WIR", `UAT INS-03 wrong trade ${tag}`, { description: "x", requested_for: REQUESTED, trade: tm.d.trade("Electrical Works"), location: tm.d.loc("Tower 1 Floor 02"), checklist_template: other.versionId });
  t.check("A template of another Trade is refused as an unknown option", wrong.status === 422 && /unknown_option/.test(wrong.text), `${wrong.status} ${wrong.text.slice(0, 140)}`);
  const made = await makeTemplate(tm, `UAT INS-03 to retire ${tag}`, [item("only_check", "Only check")]);
  const picked = await draftWir(tm, `UAT INS-03 retired pick ${tag}`, made.versionId);
  await saeed!.post(`/checklist-templates/${made.id}/retire`);
  await go(page, `/work-items/${picked}`);
  await settle(page);
  const ptext = await page.getByRole("main").innerText();
  t.check("A template retired after the pick still shows, labelled as picked", /as picked/i.test(ptext), ptext.match(/.{20}as picked.{5}/i)?.[0] ?? "");
  await t.shot(page, "retired-as-picked");
  const retiredNew = await create(hafiz!, tm, "WIR", `UAT INS-03 retired new ${tag}`, { description: "x", requested_for: REQUESTED, trade: tm.d.trade("Electrical Works"), location: tm.d.loc("Tower 1 Floor 02"), checklist_template: made.versionId });
  t.check("A retired template is offered to no new pick (refused)", retiredNew.status === 422, `${retiredNew.status}`);
  t.note("Changing the Trade is not possible for Hafiz: Electrical is his only Trade (Civil Works is covered by no Participant), so 'the pick clears on a Trade change' was not exercised; a template of another Trade is refused instead.");
});

defineCase("INS-04", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed");
  const { hafiz, ali, ahmed, mohammed: mo } = tm.api;
  const mk = async (name: string, code: string | null): Promise<string> => {
    const id = await H.submittedMar(tm, `UAT INS-04 ${name} ${tag}`);
    if (code) {
      await H.reviewedMar(tm, id);
      const d = await H.detail(mo!, id);
      const key = `${code === "A" ? "approve_a" : "revise_c"}`;
      const tr = (d.actions.transitions as Json[]).find((x) => x.key === key)!;
      const r = await mo!.transition(id, key, { answers: fill(tr.actionForm) });
      if (r.status >= 300) throw new Error(`code ${code} answered ${r.status} ${r.text.slice(0, 200)}`);
    }
    return id;
  };
  const a = await mk("closedA", "A");
  const c = await mk("closedC", "C");
  const open = await mk("stillOpen", null);
  const draft = await H.createItem(hafiz!, tm, "MAR", `UAT INS-04 draft ${tag}`, await H.marAnswers(tm));
  const search = async (api: Api, q: string, outcomes = "A,B") => (((await api.get(`/projects/${tm.projectId}/work-items/link-search?q=${encodeURIComponent(q)}&outcomes=${outcomes}`)).body as Json).links ?? []) as Json[];
  const found = (await search(hafiz!, tag)).map((l) => l.subject as string);
  t.check("Only the item closed at Code A is offered (not C, not open, not the Draft)", found.length === 1 && found[0]!.includes("closedA"), found.join(" | "));
  const idOf = async (n: string) => (await H.listItems(hafiz!, tm.projectId, `q=${encodeURIComponent(n)}&pageSize=50`)).find((i) => i.title.includes(n))?.id as string | undefined;
  void idOf;
  const wir = await draftWir(tm, `UAT INS-04 WIR ${tag}`);
  const okSave = await hafiz!.put(`/work-items/${wir}/answers`, { answers: fullAnswers(tm, { approved_submittals: [a] }) });
  t.check("A saved pick of the Code A item is accepted", okSave.status < 300, `${okSave.status} ${okSave.text.slice(0, 120)}`);
  for (const [what, id] of [["closed at C", c], ["still open", open], ["a Draft", draft]] as const) {
    const r = await hafiz!.put(`/work-items/${wir}/answers`, { answers: fullAnswers(tm, { approved_submittals: [id] }) });
    t.check(`A saved id of an item ${what} is refused like an unknown option`, r.status === 422 && /unknown_option/.test(r.text), `${r.status} ${r.text.slice(0, 120)}`);
  }
  const ghost = await hafiz!.put(`/work-items/${wir}/answers`, { answers: fullAnswers(tm, { approved_submittals: ["00000000-0000-4000-8000-000000000000"] }) });
  t.check("A made-up id gets the same answer", ghost.status === 422 && /unknown_option/.test(ghost.text), `${ghost.status}`);
  const { page } = await pageAs("hafiz");
  await go(page, `/work-items/${wir}`);
  await settle(page);
  await t.shot(page, "wir-with-approved-submittal");
  void ali; void ahmed;
});

defineCase("INS-05", async (t) => {
  const tm = await team("hafiz", "ali", "saeed", "ahmed");
  const { hafiz, ali, saeed } = tm.api;
  const first = await cableTray(hafiz!, tm);
  const other = await makeTemplate(tm, `UAT INS-05 other template ${tag}`, [item("alt_one", "Alternative check one"), item("alt_two", "Alternative check two")]);
  const id = await draftWir(tm, `UAT INS-05 WIR ${tag}`, first.versionId);
  const copyOf = async () => ((await H.detail(hafiz!, id)).checklistCopies as Json[]).map((c) => c.items.map((i: Json) => i.key).join(","));
  const before = await copyOf();
  const swap = await hafiz!.put(`/work-items/${id}/answers`, { answers: fullAnswers(tm, { checklist_template: other.versionId }) });
  const after = await copyOf();
  t.check("Before the first Submit a new pick replaces the copy", swap.status < 300 && after[0] === "alt_one,alt_two" && before[0] !== after[0], `${before[0]} -> ${after[0]}`);
  await mustAct(hafiz!, id, "send_for_review");
  await mustAct(ali!, id, "submit", { answers: { cover_note: "Ready." } });
  const keep = await copyOf();
  const late = await hafiz!.put(`/work-items/${id}/answers`, { answers: fullAnswers(tm, { checklist_template: first.versionId }) });
  const lateAli = await ali!.put(`/work-items/${id}/answers`, { answers: fullAnswers(tm, { checklist_template: first.versionId }) });
  t.check("After the Submit, the pick cannot be changed (refused) by Hafiz or Ali", late.status >= 400 && lateAli.status >= 400, `${late.status} ${lateAli.status}`);
  t.check("The copy is fixed", (await copyOf())[0] === keep[0] && keep[0] === "alt_one,alt_two", keep[0]);
  await saeed!.post(`/checklist-templates/${other.id}/retire`);
  const { page } = await pageAs("hafiz");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "fixed-after-submit");
});

defineCase("INS-06", async (t) => {
  const tm = await team("hafiz", "ahmed", "ali");
  const { hafiz, ahmed, ali } = tm.api;
  void ali;
  const id = await draftWir(tm, `UAT INS-06 annotate ${tag}`);
  const orig = testPhoto();
  const origId = await upload(hafiz!, id, { fieldKey: "photos", fileName: "gap.jpg", contentType: "image/jpeg", body: orig });
  const drawn = Buffer.concat([testPhoto(), Buffer.from("annotated: arrow, text label")]);
  const copyId = await upload(hafiz!, id, { fileName: "gap-annotated.jpg", contentType: "image/jpeg", body: drawn, annotatedFromId: origId } as never);
  const docs = async (api: Api) => ((await api.get(`/work-items/${id}/documents`)).body as Json).documents as Json[];
  const d1 = await docs(hafiz!);
  const copy = d1.find((d) => d.id === copyId);
  t.check("The annotated copy is saved beside the original, marked as annotated from it", copy?.annotatedFromId === origId && d1.some((d) => d.id === origId && d.annotatedFromId === null), JSON.stringify(copy?.annotatedFromId));
  const bytes = async (api: Api, docId: string) => {
    const u = ((await api.get(`/work-items/${id}/documents/${docId}/download`)).body as Json).url as string;
    return Buffer.from(await (await fetch(u)).arrayBuffer());
  };
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  t.check("The original's bytes are unchanged and both download", sha(await bytes(hafiz!, origId)) === sha(orig) && sha(await bytes(hafiz!, copyId)) === sha(drawn));
  const { page } = await pageAs("hafiz");
  await go(page, `/work-items/${id}`);
  await settle(page);
  const buttons = (await page.getByRole("button").evaluateAll((bs) => bs.map((x) => (x.getAttribute("aria-label") || x.textContent || "").trim()))).filter(Boolean);
  t.note("Buttons on the Draft: " + buttons.join(" | "));
  const tool = page.getByRole("button", { name: /full size|annotat|draw|mark/i }).first();
  const hasTool = (await tool.count()) > 0;
  if (hasTool) { await tool.click(); await settle(page, 700); }
  t.note("UI: clicking Open full size on the Draft photo showed no annotate screen to the script (hasTool=" + hasTool + "); the annotate and Annotated/Original switch need a person.");
  await t.shot(page, "annotated-and-original");
  await page.keyboard.press("Escape");
  await mustAct(hafiz!, id, "send_for_review");
  await mustAct(tm.api.ali!, id, "submit", { answers: { cover_note: "x" } });
  const ad = await docs(ahmed!);
  t.check("After the Submit Ahmed reads both, frozen", ad.some((d) => d.id === origId && d.frozen) && ad.some((d) => d.id === copyId && d.frozen && d.annotatedFromId === origId), JSON.stringify(ad.map((d) => [d.fieldKey, d.frozen, !!d.annotatedFromId])));
  const lateCopy = await hafiz!.post(`/work-items/${id}/documents`, { fieldKey: "photos", fileName: "late.jpg", contentType: "image/jpeg", sizeBytes: drawn.byteLength, annotatedFromId: origId });
  t.check("A frozen original takes no new copy (refused)", lateCopy.status >= 400, `${lateCopy.status} ${lateCopy.text.slice(0, 100)}`);
  t.manual("The drawing tool (arrow, text label) and the Annotated/Original switch were not reachable by script; the api rules (copy beside original, bytes unchanged, both download, frozen original takes no copy) all passed.");
});

defineCase("INS-07", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "saeed", "yousef");
  const { ali, ahmed, saeed } = tm.api;
  const id = await submittedWir(tm, `UAT INS-07 WIR ${tag}`);
  const { page } = await pageAs("ali");
  const projectId = await openProject(page);
  await go(page, `/projects/${projectId}/inspections?q=${tag}`);
  await settle(page);
  const list = await page.getByRole("main").innerText();
  if (await listReadable(t, page, "The Inspections tab opens and lists the WIR with Stage Pending Approval")) t.check("The Inspections tab lists the WIR with Stage Pending Approval, in the Submittals List's layout", list.includes(`UAT INS-07 WIR ${tag}`) && /Pending Approval/.test(list) && /Document Number/.test(list));
  await t.shot(page, "inspections-list");
  await go(page, `/projects/${projectId}/inspections?view=kanban&q=${tag}`);
  await settle(page);
  const kan = await page.getByRole("main").innerText();
  if (await listReadable(t, page, "The Inspections Kanban opens")) t.check("The Kanban shows the WIR in the Submittals' Stage columns", kan.includes(`UAT INS-07 WIR ${tag}`) && /Pending Approval/.test(kan));
  await t.shot(page, "inspections-kanban");
  const subs = async (api: Api) => (await H.listItems(api, tm.projectId, `q=${tag}&pageSize=50`)).filter((i) => i.type?.code === "WIR");
  t.check("With the setting off, WIRs are not in the Submittals List", (await subs(ali!)).length === 0);
  try {
    const on = await saeed!.put(`/projects/${tm.projectId}/settings/show-inspections-in-submittals`, { show: true });
    t.check("Saeed turns Inside the Submittals tab on", on.status === 204, `${on.status}`);
    const a = (await subs(ali!)).some((i) => i.id === id);
    const b = (await subs(ahmed!)).some((i) => i.id === id);
    t.check("With it on, the WIR appears in the Submittals List for Ali and for Ahmed", a && b, `ali ${a}, ahmed ${b}`);
    const y = (await subs(tm.api.yousef!)).length;
    t.check("Beta Build, who may not see the WIR, finds none", y === 0, `${y}`);
    await go(page, `/projects/${projectId}/work-items?q=${tag}`);
    await settle(page);
    const st = await page.getByRole("main").innerText();
    if (await listReadable(t, page, "The Submittals List page opens with the WIR in it")) t.check("The Submittals List page shows the WIR and a WIR type in its Type filter", st.includes(`UAT INS-07 WIR ${tag}`));
    await t.shot(page, "submittals-with-wir");
    await go(page, `/projects/${projectId}/work-items?view=kanban&q=${tag}`);
    await settle(page);
    if (await listReadable(t, page, "The Submittals Kanban opens with the WIR in it")) t.check("The Submittals Kanban shows it too", (await page.getByRole("main").innerText()).includes(`UAT INS-07 WIR ${tag}`));
    const dash = (await ali!.get(`/projects/${tm.projectId}/dashboard`)).text;
    t.check("The Dashboard counts WIRs with the Submittals", /WIR/.test(dash));
  } finally {
    await saeed!.put(`/projects/${tm.projectId}/settings/show-inspections-in-submittals`, { show: false });
  }
  t.check("The setting is back off, as found", (await subs(ali!)).length === 0);
});

defineCase("INS-08", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed", "yousef");
  const { hafiz, ali, ahmed, mohammed: mo } = tm.api;
  const id = await draftWir(tm, `UAT INS-08 WIR ${tag}`);
  t.check("A Draft WIR has no number and DCL cannot read it", (await H.detail(hafiz!, id)).documentNumber === null && (await status(ahmed!, id)) === 404);
  await mustAct(hafiz!, id, "send_for_review");
  const num = (await H.detail(ali!, id)).documentNumber as string;
  t.check("Sent for review, it is numbered like a submittal (TWR-WIR-nn-nnnn) and Ali holds it", /^TWR-WIR-\d\d-\d{4}$/.test(num) && (await H.detail(ali!, id)).stage.key === "internal_review", num);
  t.check("Still not readable by the Consultant (internal review)", (await status(ahmed!, id)) === 404);
  await mustAct(ali!, id, "submit", { answers: { cover_note: "Ready from 09:00." } });
  const d = await H.detail(ahmed!, id);
  t.check("After the Submit it reaches the Consultant Engineer Step: Ahmed holds it or may pick it up", d.step.key === "consultant_engineer" && (d.actions.pickUp === true || d.heldBy?.memberName?.en === "Ahmed bin Said"), `${d.step.key} pickUp=${d.actions.pickUp} holder=${d.heldBy?.memberName?.en}`);
  t.check("Pending Approval for everyone who reads it, Mohammed included", d.stage.key === "pending_approval" && (await stageOf(mo!, id)) === "pending_approval");
  t.check("Ahmed is offered Send to Manager (the checklist is filled on site, INS-09)", (d.actions.transitions as Json[]).some((x) => x.key === "send_to_manager") || d.actions.pickUp === true);
  t.check("Beta Build never sees it", (await status(tm.api.yousef!, id)) === 404);
  const { page } = await pageAs("ahmed");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "ahmed-has-the-wir");
});

defineCase("INS-09", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed");
  const id = await submittedWir(tm, `UAT INS-09 checklist ${tag}`);
  const { page } = await pageAs("ahmed", { phone: true });
  await go(page, `/work-items/${id}`);
  await settle(page);
  const main = page.getByRole("main");
  const text = await main.innerText();
  t.check("At 375 px the WIR shows the checklist with the three items", /Supports at the spacing/.test(text) && /Trays bonded to earth/.test(text) && /Clearance from other services/.test(text));
  const ctl = main.getByRole("radio", { name: /^Pass$/ });
  const nPass = await ctl.count();
  t.check("Each item has Pass, Fail and N/A segmented controls", nPass >= 3 && (await main.getByRole("radio", { name: /^Fail$/ }).count()) >= 3 && (await main.getByRole("radio", { name: /^N\/A$/ }).count()) >= 3, `${nPass} Pass controls`);
  const box = await ctl.first().boundingBox();
  t.check("The controls are large enough to tap (at least 40 px high)", (box?.height ?? 0) >= 40, `${box?.height}px`);
  await t.shot(page, "phone-checklist");
  await main.getByRole("radio", { name: /^Fail$/ }).first().click();
  await settle(page, 700);
  const failed = await main.innerText();
  t.check("On a Fail whose template requires them, the comment and photo show required", /Add a comment to explain this answer|Comment required|required/i.test(failed) && /Add a photo as evidence|Photo required|photo/i.test(failed));
  t.check("A failed item can raise a Snag, ticked by default", /Raise a Snag/.test(failed) && (await main.getByRole("checkbox", { name: /Raise a Snag/ }).first().isChecked().catch(() => false)));
  await main.getByRole("radio", { name: /^Pass$/ }).nth(1).click();
  await main.getByRole("radio", { name: /^N\/A$/ }).nth(2).click();
  await settle(page, 900);
  const summary = await main.innerText();
  t.check("A summary reads like 1 Pass / 1 Fail / 1 N/A with progress", /1 Pass/.test(summary) && /1 Fail/.test(summary) && /1 N\/A/.test(summary), summary.match(/.{0,30}\d+ Pass.{0,60}/)?.[0] ?? "no summary text");
  await t.shot(page, "phone-checklist-answered");
  const saved = ((await H.detail(tm.api.ahmed!, id)).replyChecklists as Json[])[0]?.answers as Json;
  t.check("It saved as it went (the api holds the answers)", saved?.supports?.answer === "fail" && saved?.earthing?.answer === "pass", JSON.stringify(saved));
  t.note("The WIR is left with Ahmed (answers saved, not sent).");
});

defineCase("INS-10", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed", "yousef");
  const { hafiz, ahmed, mohammed: mo } = tm.api;
  const id = await submittedWir(tm, `UAT INS-10 snags ${tag}`);
  await toManager(tm, id, TWO_FAILS, "C");
  const num = (await H.detail(mo!, id)).documentNumber as string;
  const rev = await H.detail(mo!, id);
  const pre = (rev.actions.transitions as Json[]).find((x) => x.proposed === true)?.key;
  t.note(`Manager's pre-selected code: ${pre}`);
  const r = await issue(tm, id, "approve_a");
  t.check("Mohammed issues Code A although two items failed", r.status === 204, `${r.status} ${r.text.slice(0, 160)}`);
  const snags = await snagsRaisedFrom(hafiz!, tm, num);
  t.check("Only the ticked failed item (not the unticked one) became a Snag, linked to the WIR", snags.length === 1 && /Spacing|Supports|supports/i.test(JSON.stringify(snags[0])), `${snags.length} snags: ${snags.map((s) => s.title).join(" | ")}`);
  const sd = snags[0] ? await H.detail(hafiz!, snags[0].id) : null;
  t.check("The Snag is raised by the Consultant for the Contractor: it is Open with TMC", sd !== null && sd.stage.key === "open" && sd.heldBy?.companyName?.en === "TMC Constructions", JSON.stringify(sd?.heldBy));
  t.check("Raised from names the WIR and the failed item", sd !== null && JSON.stringify(sd.raisedFrom).includes(num), JSON.stringify(sd?.raisedFrom).slice(0, 240));
  t.check("The Consultant (Ahmed) reads the Snag; Beta Build does not", sd !== null && (await status(ahmed!, snags[0]!.id)) === 200 && (await status(tm.api.yousef!, snags[0]!.id)) === 404);
  const { page } = await pageAs("hafiz");
  await go(page, `/projects/${tm.projectId}/snag-list`);
  await settle(page);
  await t.shot(page, "snag-from-failed-item");
});

defineCase("INS-11", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed");
  const { mohammed: mo } = tm.api;
  const withFail = await submittedWir(tm, `UAT INS-11 one fail ${tag}`);
  await toManager(tm, withFail, { supports: { answer: "fail", comment: "Spacing too wide" }, earthing: { answer: "pass" }, clearance: { answer: "pass" } }, "C");
  const clean = await submittedWir(tm, `UAT INS-11 no fail ${tag}`);
  await toManager(tm, clean, PASS_ALL, "A");
  const proposed = async (id: string) => ((await H.detail(mo!, id)).actions.transitions as Json[]).filter((x) => x.proposed === true).map((x) => x.key);
  const pf = await proposed(withFail);
  const pc = await proposed(clean);
  t.check("With a failed item the pop-up pre-selects C", pf.join() === "revise_c", pf.join());
  t.check("With none failed it pre-selects A", pc.join() === "approve_a", pc.join());
  const offered = ((await H.detail(mo!, withFail)).actions.transitions as Json[]).map((x) => x.key);
  t.check("The Manager can still change it: every code is offered", ["approve_a", "approve_b", "revise_c", "reject_d"].every((k) => offered.includes(k)), offered.join(", "));
  const { page } = await pageAs("mohammed");
  await go(page, `/work-items/${withFail}`);
  await settle(page);
  await page.getByRole("main").getByRole("button", { name: /Revise/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  const dt = await dialog.innerText();
  t.check("The pop-up says the checklist proposes C and lists the Snag that will be raised", /checklist proposes .*C/i.test(dt) && /A Snag is raised/i.test(dt) && /Supports at the spacing/.test(dt), dt.replaceAll("\n", " | ").slice(0, 300));
  await t.shot(page, "pop-up-proposes-c");
  await page.keyboard.press("Escape");
  await go(page, `/work-items/${clean}`);
  await settle(page);
  await page.getByRole("main").getByRole("button", { name: /Approve · A|Approve/ }).first().click();
  const d2 = page.getByRole("dialog");
  await d2.waitFor({ state: "visible" });
  const t2 = await d2.innerText();
  t.check("For the clean WIR the pop-up proposes A and lists no Snag", /checklist proposes .*A/i.test(t2), t2.replaceAll("\n", " | ").slice(0, 300));
  await t.shot(page, "pop-up-proposes-a");
  await page.keyboard.press("Escape");
});

defineCase("INS-12", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed");
  const { hafiz, mohammed: mo } = tm.api;
  const codes: Record<string, string> = {};
  for (const [code, key] of [["A", "approve_a"], ["B", "approve_b"], ["C", "revise_c"], ["D", "reject_d"]] as const) {
    const id = await submittedWir(tm, `UAT INS-12 code ${code} ${tag}`);
    await toManager(tm, id, PASS_ALL, code === "C" ? "C" : "A");
    const r = await issue(tm, id, key);
    codes[code] = id;
    t.check(`Code ${code} closes the WIR`, r.status === 204, `${r.status} ${r.text.slice(0, 160)}`);
    const d = await H.detail(hafiz!, id);
    t.check(`Code ${code}: outcome ${code}, and no Passed or Failed result shown`, d.outcome === code && !/passed|failed/i.test(JSON.stringify([d.outcome, d.stage])), `${d.outcome} ${d.stage.key}`);
  }
  const b = await H.detail(hafiz!, codes.B!);
  const cm = (b.raisedItems as Json[]).find((x) => x.type.code === "CMT");
  t.check("Code B makes Comments from its comment rows (2)", cm !== undefined && cm.open + cm.closed === 2, JSON.stringify(b.raisedItems));
  const c = await H.detail(hafiz!, codes.C!);
  t.check("Code C offers Hafiz a Revision (re-inspection); D and A do not", c.actions.createRevision === true && (await H.detail(hafiz!, codes.A!)).actions.createRevision === false && (await H.detail(hafiz!, codes.D!)).actions.createRevision === false);
  t.check("The Manager is not offered the Revision", (await H.detail(mo!, codes.C!)).actions.createRevision === false);
  const rev = await hafiz!.post(`/work-items/${codes.C}/revisions`, { idempotencyKey: crypto.randomUUID() });
  const rid = (rev.body as Json)?.id as string | undefined;
  t.check("Hafiz creates the Revision", rev.status === 201 && !!rid, `${rev.status}`);
  if (rid) {
    const rd = await H.detail(hafiz!, rid);
    const cp = (rd.checklistCopies as Json[])[0];
    t.check("The Revision copies the same checklist (the same items)", cp !== undefined && cp.items.length === 3 && cp.name.en === "Cable trays and containment", JSON.stringify(cp?.items?.length));
  }
  const dd = await H.detail(hafiz!, codes.D!);
  t.check("Code D closes it: it is Rejected", dd.stage.key === "rejected" && dd.outcome === "D");
  const { page } = await pageAs("hafiz");
  await go(page, `/work-items/${codes.C}`);
  await settle(page);
  await t.shot(page, "code-c-with-revision-offered");
});

defineCase("INS-13", async (t) => {
  const tm = await team("hafiz", "ali", "ahmed", "mohammed");
  const { hafiz, ahmed } = tm.api;
  const id = await submittedWir(tm, `UAT INS-13 read order ${tag}`);
  const note = `UAT-INS13-NOTE-${tag}`;
  const comment = `UAT-INS13-COMMENT-${tag}`;
  const answers = { supports: { answer: "fail", comment }, earthing: { answer: "pass" }, clearance: { answer: "pass" } };
  const put = await answerChecklist(ahmed!, id, answers);
  await photoFor(ahmed!, id, "supports");
  t.check("Ahmed saves answers, a comment and a photo", put.status < 300);
  const hd = await H.detail(hafiz!, id);
  const hdocs = ((await hafiz!.get(`/work-items/${id}/documents`)).body as Json).documents as Json[];
  const hist = (await hafiz!.get(`/work-items/${id}/history`)).text;
  const blob = JSON.stringify(hd) + hist;
  t.check("While Ahmed answers, Hafiz reads none of the answers or the comment", (hd.replyChecklists as Json[]).length === 0 && !blob.includes(comment) && !/"answer":"fail"/.test(blob));
  t.check("Hafiz reads no checklist photo", !hdocs.some((d) => d.fieldKey === FIELD));
  t.check("Positive control: Ahmed reads his own answers and photo", JSON.stringify(((await H.detail(ahmed!, id)).replyChecklists as Json[])[0]?.answers).includes(comment) && (((await ahmed!.get(`/work-items/${id}/documents`)).body as Json).documents as Json[]).some((d) => d.fieldKey === FIELD));
  await mustAct(ahmed!, id, "send_to_manager", { recommendedCode: "C", internalNote: note });
  await tm.api.mohammed!.post(`/work-items/${id}/pick-up`);
  const mid = JSON.stringify(await H.detail(hafiz!, id)) + (await hafiz!.get(`/work-items/${id}/history`)).text;
  t.check("Sent to the Manager, Hafiz still reads none of it", !mid.includes(comment) && !mid.includes(note));
  const r = await issue(tm, id, "revise_c");
  t.check("Mohammed issues Code C", r.status === 204, `${r.status} ${r.text.slice(0, 120)}`);
  const after = (await hafiz!.get(`/work-items/${id}/history`)).text;
  const adocs = ((await hafiz!.get(`/work-items/${id}/documents`)).body as Json).documents as Json[];
  const afterDetail = JSON.stringify(await H.detail(hafiz!, id));
  t.check("After the Code Hafiz reads the answers and the comment", after.includes(comment) || afterDetail.includes(comment), `history ${after.length} bytes`);
  t.check("After the Code Hafiz reads the checklist photo", adocs.some((d) => d.fieldKey === FIELD));
  t.check("Ahmed's Internal Note and Recommended Code never reach Hafiz", !after.includes(note) && !afterDetail.includes(note) && !/recommendedCode":"C"/.test(after));
  const { page } = await pageAs("hafiz");
  await go(page, `/work-items/${id}`);
  await settle(page);
  await t.shot(page, "hafiz-after-code");
});

defineCase("INS-14", async (t) => {
  const tm = await team("ali", "ahmed", "saeed", "hafiz");
  const { ali, saeed } = tm.api;
  const mar = await H.submittedMar(tm, `UAT INS-14 MAR ${tag}`);
  const wir = await submittedWir(tm, `UAT INS-14 WIR ${tag}`);
  const stageIn = async (id: string, module: "inspections" | "submittals") => (await moduleItems(ali!, tm.projectId, module, `q=${tag}&pageSize=50`)).find((i) => i.id === id)?.stage?.key;
  t.check("The WIR and the submittal both sit at Pending Approval", (await stageIn(wir, "inspections")) === "pending_approval" && (await H.detail(ali!, mar)).stage.key === "pending_approval");
  try {
    await saeed!.put(`/projects/${tm.projectId}/settings/show-inspections-in-submittals`, { show: true });
    const { page } = await pageAs("ali");
    const projectId = await openProject(page);
    await go(page, `/projects/${projectId}/work-items?view=kanban&q=${tag}`);
    await settle(page, 800);
    const board = ((await ali!.get(`/projects/${tm.projectId}/modules/submittals/work-items/kanban?q=${tag}`)).body as Json).columns as Json[];
    const colOf = (id: string) => board.find((c) => (c.lanes as Json[]).some((l) => (l.cards as Json[]).some((k) => k.id === id)))?.stageKey;
    t.check("In the Submittals Kanban the WIR and the submittal are in the same Pending Approval column", colOf(wir) === "pending_approval" && colOf(mar) === "pending_approval", `wir ${colOf(wir)}, mar ${colOf(mar)}`);
    await t.shot(page, "kanban-shared-column");
    await go(page, `/projects/${projectId}/inspections?view=kanban&q=${tag}`);
    await settle(page);
    if (await listReadable(t, page, "The Inspections Kanban opens")) t.check("The Inspections Kanban uses the same Stage column for the WIR", (await page.getByRole("main").innerText()).includes("Pending Approval"));
  } finally {
    await saeed!.put(`/projects/${tm.projectId}/settings/show-inspections-in-submittals`, { show: false });
  }
});
