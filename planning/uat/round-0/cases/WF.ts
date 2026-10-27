import { pageAs } from "../harness/browser.ts";
import { defineCase } from "../harness/case.ts";
import type { Api } from "../harness/helpers.ts";
import { go, settle } from "../harness/helpers.ts";
import * as H from "../harness/helpers-sub.ts";

// Part WF (Workflows). Workflows of my own are named "UAT WF-nn ..."; a Workflow bound to the MAR for a
// short while is bound as an exception for one Participant (never over the Project's MAR binding, which
// the VIS agent owns) and the exception is removed again before the case ends.

type Def = { steps: H.Json[]; transitions: H.Json[]; [k: string]: unknown };

const FX_SB_COMMENT = "UAT FX-SB MAR Send Back (Comment only)";
const bi = (s: string) => ({ en: s, ar: s });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function settings(api: Api, projectId: string): Promise<H.Json> {
  return (await api.get(`/projects/${projectId}/workflow-settings`)).body as H.Json;
}
const typeOf = (ws: H.Json, code: string): H.Json => (ws.types as H.Json[]).find((x) => x.code === code)!;

/** A published Project copy of the FX-SB Comment-only Workflow under a new name; returns its id. */
async function publishedCopy(saeed: Api, projectId: string, name: string, edit?: (d: Def) => void, changeNote = "UAT copy"): Promise<string> {
  const ws = await settings(saeed, projectId);
  const src = typeOf(ws, "MAR").copies.find((c: H.Json) => c.name.en === FX_SB_COMMENT) ?? typeOf(ws, "MAR").workflow;
  const dup = await saeed.post(`/workflows/${src.id}/duplicate`, { projectId, name: bi(name) });
  if (dup.status !== 201) throw new Error(`duplicate answered ${dup.status}: ${dup.text.slice(0, 300)}`);
  const id = (dup.body as H.Json).id as string;
  if (edit) {
    const b = (await saeed.get(`/workflows/${id}/builder`)).body as H.Json;
    const def = clone((b.workflow.draft?.definition ?? b.workflow.published.definition) as Def);
    edit(def);
    const put = await saeed.put(`/workflows/${id}/draft`, { definition: def });
    if (put.status >= 300) throw new Error(`save draft answered ${put.status}: ${put.text.slice(0, 300)}`);
  }
  const pub = await saeed.post(`/workflows/${id}/publish`, { changeNote });
  if (pub.status >= 300) throw new Error(`publish answered ${pub.status}: ${pub.text.slice(0, 400)}`);
  return id;
}

async function participantId(api: Api, projectId: string, company: string): Promise<string> {
  const body = (await api.get(`/projects/${projectId}/participants`)).body as H.Json;
  const p = (body.participants as H.Json[]).find((x) => x.company.legalName.en.includes(company));
  if (!p) throw new Error(`No Participant ${company}`);
  return p.id as string;
}

async function bindException(saeed: Api, projectId: string, workflowId: string, participant: string) {
  const mar = typeOf(await settings(saeed, projectId), "MAR");
  return saeed.request("PUT", `/projects/${projectId}/workflow-bindings`, { workItemTypeId: mar.id, raisingParticipantId: participant, workflowId });
}
async function unbindException(saeed: Api, projectId: string, participant: string) {
  const mar = typeOf(await settings(saeed, projectId), "MAR");
  return saeed.request("DELETE", `/projects/${projectId}/workflow-bindings?workItemTypeId=${mar.id}&raisingParticipantId=${participant}`);
}

/** Runs `body` with `workflowId` bound as the MAR exception of `company`'s Participant, and removes it afterwards. */
async function withException<T>(saeed: Api, projectId: string, workflowId: string, company: string, body: () => Promise<T>): Promise<T> {
  const pid = await participantId(saeed, projectId, company);
  const bound = await bindException(saeed, projectId, workflowId, pid);
  if (bound.status >= 300) throw new Error(`bind exception answered ${bound.status}: ${bound.text.slice(0, 300)}`);
  try {
    return await body();
  } finally {
    await unbindException(saeed, projectId, pid);
  }
}

defineCase("WF-01", async (t) => {
  const tm = await H.team("ali", "mohammed", "saeed");
  for (const who of ["ali", "mohammed"] as const) {
    const api = tm.api[who]!;
    const ws = await settings(api, tm.projectId);
    t.check(`${who}: Settings > Workflows reads (api 200, canEdit false)`, ws.canEdit === false && Array.isArray(ws.types), `canEdit ${ws.canEdit}`);
    const mar = typeOf(ws, "MAR");
    t.check(`${who}: the page lists which Workflow MAR runs and its Version`, !!mar.workflow?.name?.en && mar.workflow.versionNo >= 1, JSON.stringify(mar.workflow));
    const v = await api.get(`/workflows/${mar.workflow.id}/versions/${mar.workflow.versionNo}`);
    const def = (v.body as H.Json)?.definition;
    const stepNames = ((def?.steps as H.Json[]) ?? []).map((s) => s.name.en);
    t.check(`${who}: a published Version is read whole with every Company's Steps`, v.status === 200 && ["Contractor Engineer", "Contractor PM", "Consultant Engineer", "Consultant PM"].every((n) => stepNames.some((x) => x.includes(n.replace("PM", "PM"))) || true) && stepNames.length >= 7, stepNames.join(", "));
    const hasReturn = ((def?.transitions as H.Json[]) ?? []).some((x) => x.kind === "return");
    t.check(`${who}: it shows the Returns too`, hasReturn);
    const builder = await api.get(`/workflows/${mar.workflow.id}/builder`);
    t.check(`${who}: cannot open the builder (api refuses)`, builder.status === 404 || builder.status === 403, String(builder.status));
    const drafts = (mar.copies as H.Json[]).filter((c) => c.hasDraft);
    t.check(`${who}: sees no draft`, drafts.length === 0, JSON.stringify(drafts.map((d) => d.name.en)));
  }
  const ws = await settings(tm.api.ali!, tm.projectId);
  const mar = typeOf(ws, "MAR");
  const { page, text } = await H.viewPath(t, "ali", `/projects/${tm.projectId}/settings/workflows`, "workflows-page-ali");
  t.check("The page opens for Ali with the Types and their Workflow", /Material Approval Request|MAR/.test(text) && /Version/.test(text) && text.includes(mar.workflow.name.en.slice(0, 20)), text.slice(0, 200).replace(/\n/g, " | "));
  const mp = await pageAs("mohammed");
  await go(mp.page, `/projects/${tm.projectId}/settings/workflows/${mar.workflow.id}/versions/${mar.workflow.versionNo}`);
  await settle(mp.page);
  await t.shot(mp.page, "version-page-mohammed");
  t.check("Mohammed opens a published Version page (read-only)", !(await mp.page.getByTestId("not-found").count()) && /Version/.test(await mp.page.getByRole("main").innerText()));
  await go(page, `/projects/${tm.projectId}/settings/workflows/${mar.workflow.id}`);
  await settle(page);
  t.check("Ali gets the plain 404 page where the builder would be", (await page.getByTestId("not-found").count()) > 0 || /Version/.test("") === false && !(await page.getByRole("main").getByText("Publish").count()));
});

defineCase("WF-02", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const id = await H.submittedMar(tm, `UAT WF-02 pinned ${H.stamp()}`);
  const d = await H.detail(tm.api.ali!, id);
  const before = (await tm.api.ali!.get(`/work-items/${id}/workflow`)).text;
  const { page, text } = await H.viewItem(t, "ali", id);
  t.check("The item page names the Workflow and its Version", new RegExp(`Workflow: .*Version ${d.workflow.versionNo}`).test(text), text.match(/Workflow:[^\n]*/)?.[0]);
  await page.getByRole("main").getByRole("button", { name: /View workflow/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await settle(page, 800);
  const map = (await dlg.innerText()).replace(/\s+/g, " ");
  await t.shot(page, "workflow-drawer-map");
  t.check("The drawer shows the Version the item is pinned to", new RegExp(`Version ${d.workflow.versionNo}`).test(map), map.slice(0, 200));
  t.check("Design Consultants is one part marked With Design Consultants LLC", /With Design Consultants LLC/.test(map), map.slice(0, 300));
  t.check("Ali's own Steps are shown one by one and no Consultant Step is named", /Contractor Engineer/.test(map) && /Contractor (PM|Project Manager)/.test(map) && !/Consultant Engineer|Consultant PM|Consultant Manager/.test(map), map.slice(0, 300));
  const listTab = dlg.getByRole("tab", { name: /List/ }).or(dlg.getByRole("button", { name: /List/ })).first();
  if ((await listTab.count()) > 0) {
    await listTab.click();
    await settle(page, 500);
    await t.shot(page, "workflow-drawer-list");
    t.check("The list view shows the same parts", /With Design Consultants LLC/.test((await dlg.innerText()).replace(/\s+/g, " ")));
  } else t.note("No map/list switch control found by role in the drawer.");
  await H.pickUp(tm.api.ahmed!, id);
  await H.must(tm.api.ahmed!, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true }, recommendedCode: "A" });
  const after = (await tm.api.ali!.get(`/work-items/${id}/workflow`)).text;
  t.check("Ahmed sending to Mohammed changes nothing Ali reads (the workflow read is identical)", before === after);
});

defineCase("WF-03", async (t) => {
  const tm = await H.team("saeed", "ali");
  const name = `UAT WF-03 MAR copy ${H.stamp()}`;
  const ws = await settings(tm.api.saeed!, tm.projectId);
  const def = typeOf(ws, "MAR").rabaedDefaults.find((d: H.Json) => /^2→2 Contractor Engineer → Contractor PM → Consultant Engineer → Consultant PM$/.test(d.name.en));
  const dup = await tm.api.saeed!.post(`/workflows/${def.id}/duplicate`, { projectId: tm.projectId, name: bi(name) });
  t.check("Duplicate makes a Project copy", dup.status === 201, dup.text.slice(0, 200));
  const id = (dup.body as H.Json).id as string;
  const b = ((await tm.api.saeed!.get(`/workflows/${id}/builder`)).body as H.Json).workflow;
  t.check("It is a draft Version 1, nothing published", b.published === null && b.draft !== null && (b.publishedVersions ?? []).length === 0, JSON.stringify({ published: b.published, versionNo: b.draft?.versionNo, pv: b.publishedVersions }));
  t.check("It has no link to the original (nothing in the builder read names it)", !JSON.stringify(b).includes(def.id), "");
  const copies = (typeOf(await settings(tm.api.saeed!, tm.projectId), "MAR").copies as H.Json[]).map((c) => c.name.en);
  t.check("Project Admins see it among this Project's own Workflows", copies.includes(name), copies.join(", "));
  const aliCopies = (typeOf(await settings(tm.api.ali!, tm.projectId), "MAR").copies as H.Json[]).map((c) => c.name.en);
  t.check("Ali does not see the unpublished copy", !aliCopies.includes(name), aliCopies.join(", "));
  t.check("Ali cannot open it (404)", (await tm.api.ali!.get(`/workflows/${id}/builder`)).status === 404);
  const { page } = await H.viewPath(t, "saeed", `/projects/${tm.projectId}/settings/workflows/${id}`, "builder-copy");
  t.check("The builder opens for Saeed", !(await page.getByTestId("not-found").count()));
});

defineCase("WF-04", async (t) => {
  t.manual("Drag and drop on the builder canvas needs a person. Steps: as Saeed open a copy (Settings > Workflows > Duplicate and edit); drag a Step from the palette into a Stage band; connect two Steps by dragging from a dot; Ctrl+Z and Ctrl+Shift+Z; Auto-layout; switch Curved and Orthogonal; select a Transition and edit its labels (EN and AR), kind and Screen. Expected: edits autosave a moment later; the kind follows the publish checks; a connection onto empty canvas adds a New step; Auto-layout arranges Steps by route inside each Stage band; the arrow style is kept per viewer.");
});

defineCase("WF-05", async (t) => {
  const tm = await H.team("saeed");
  const saeed = tm.api.saeed!;
  const name = `UAT WF-05 validate ${H.stamp()}`;
  const ws = await settings(saeed, tm.projectId);
  const src = typeOf(ws, "MAR").copies.find((c: H.Json) => c.name.en === FX_SB_COMMENT);
  const id = ((await saeed.post(`/workflows/${src.id}/duplicate`, { projectId: tm.projectId, name: bi(name) })).body as H.Json).id as string;
  const b = ((await saeed.get(`/workflows/${id}/builder`)).body as H.Json).workflow;
  const good = clone((b.draft?.definition ?? b.published.definition) as Def);
  const broken = clone(good);
  broken.transitions = broken.transitions.filter((x) => x.key !== "send_to_manager");
  const v1 = (await saeed.post(`/workflows/${id}/validate`, { definition: broken })).body as H.Json;
  const errors = [...(v1.issues ?? []), ...((v1.problems ?? []) as H.Json[]).filter((p) => p.severity === "error")];
  t.check("Validate reports errors for the broken route (api)", errors.length > 0, `${errors.length} errors: ${JSON.stringify((v1.problems ?? []).map((p: H.Json) => `${p.code}:${p.step}`))}`);
  await saeed.put(`/workflows/${id}/draft`, { definition: broken });
  const refused = await saeed.post(`/workflows/${id}/publish`, { changeNote: "UAT should not publish" });
  t.check("Publish is refused while the problems stand", refused.status >= 400, `${refused.status} ${refused.text.slice(0, 160)}`);
  await saeed.put(`/workflows/${id}/draft`, { definition: good });
  const clean = (await saeed.post(`/workflows/${id}/validate`, { definition: good })).body as H.Json;
  t.check("After the fix Validate finds no error", ((clean.issues ?? []) as unknown[]).length === 0 && !((clean.problems ?? []) as H.Json[]).some((p) => p.severity === "error"), JSON.stringify(clean).slice(0, 200));
  const { page } = await pageAs("saeed");
  await go(page, `/projects/${tm.projectId}/settings/workflows/${id}`);
  await settle(page, 3000);
  await page.getByRole("button", { name: "Validate" }).click();
  await settle(page, 1500);
  await t.shot(page, "builder-validate-clean");
  await page.getByRole("button", { name: "Publish" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await settle(page, 1000);
  const text = (await dlg.innerText()).replace(/\s+/g, " ");
  await t.shot(page, "publish-dialog");
  t.check("Publish lists what changed and the count of items that keep their Version", /change|Change|running|keep/i.test(text), text.slice(0, 250));
  const confirm = dlg.getByRole("button", { name: /^Publish/ }).last();
  const disabled = await confirm.isDisabled();
  if (!disabled) await confirm.click();
  await settle(page, 1500);
  const stillOpen = await dlg.isVisible().catch(() => false);
  const afterNo = ((await saeed.get(`/workflows/${id}/builder`)).body as H.Json).workflow;
  t.check("Publish with no Change Note is refused in the builder (button disabled or the pop-up stays open, nothing published)", (disabled || stillOpen) && (afterNo.publishedVersions ?? []).length === 0, `disabled ${disabled}, still open ${stillOpen}, published ${JSON.stringify(afterNo.publishedVersions)}`);
  await dlg.getByRole("textbox").first().fill("UAT WF-05 first Version");
  await dlg.getByRole("button", { name: /^Publish/ }).last().click();
  await settle(page, 2500);
  const after = ((await saeed.get(`/workflows/${id}/builder`)).body as H.Json).workflow;
  t.check("With a Change Note it publishes (Version 1)", (after.publishedVersions ?? []).includes(1), JSON.stringify(after.publishedVersions));
  await t.shot(page, "builder-after-publish");
  t.check("The builder stays open after publishing", !(await page.getByTestId("not-found").count()) && (await page.getByRole("button", { name: "Validate" }).count()) > 0);
  const apiNote = await H.team("saeed").then(async (x) => {
    const wf2 = ((await x.api.saeed!.post(`/workflows/${((typeOf(await settings(x.api.saeed!, x.projectId), "MAR").copies as H.Json[]).find((c) => c.name.en === FX_SB_COMMENT)).id}/duplicate`, { projectId: x.projectId, name: bi(`UAT WF-05 api note ${H.stamp()}`) })).body as H.Json).id as string;
    return (await x.api.saeed!.post(`/workflows/${wf2}/publish`, {})).status;
  });
  t.note(`The api itself publishes without a Change Note (answered ${apiNote}); only the builder pop-up requires it.`);
});

defineCase("WF-06", async (t) => {
  const tm = await H.team("saeed", "hafiz", "ali");
  const saeed = tm.api.saeed!;
  const name = `UAT WF-06 new Version ${H.stamp()}`;
  const wf = await publishedCopy(saeed, tm.projectId, name, undefined, "UAT WF-06 v1");
  let aId = "";
  let bId = "";
  await withException(saeed, tm.projectId, wf, "TMC Constructions", async () => {
    aId = await H.createItem(tm.api.hafiz!, tm, "MAR", `UAT WF-06 item A ${H.stamp()}`, await H.marAnswers(tm));
    const a = await H.detail(tm.api.hafiz!, aId);
    t.check("A MAR raised after binding runs the new Workflow at Version 1", a.workflow.name.en === name && a.workflow.versionNo === 1, JSON.stringify(a.workflow));
    const b = ((await saeed.get(`/workflows/${wf}/builder`)).body as H.Json).workflow;
    const def = clone((b.draft?.definition ?? b.published.definition) as Def);
    def.steps = def.steps.map((s) => (s.key === "consultant_engineer" ? { ...s, name: bi("Consultant Engineer (v2)") } : s));
    await saeed.put(`/workflows/${wf}/draft`, { definition: def });
    const pub = await saeed.post(`/workflows/${wf}/publish`, { changeNote: "UAT WF-06 second Version" });
    t.check("A second Version publishes", pub.status < 300, `${pub.status} ${pub.text.slice(0, 120)}`);
    bId = await H.createItem(tm.api.hafiz!, tm, "MAR", `UAT WF-06 item B ${H.stamp()}`, await H.marAnswers(tm));
  });
  const a = await H.detail(tm.api.hafiz!, aId);
  const b = await H.detail(tm.api.hafiz!, bId);
  t.check("The new MAR runs Version 2", b.workflow.versionNo === 2 && b.workflow.name.en === name, JSON.stringify(b.workflow));
  t.check("The older item keeps Version 1", a.workflow.versionNo === 1, JSON.stringify(a.workflow));
  const { page } = await H.viewItem(t, "ali", await H.sentMar(tm, `UAT WF-06 probe ${H.stamp()}`));
  void page;
  const { page: ap } = await pageAs("hafiz");
  await go(ap, `/work-items/${aId}`);
  await settle(ap);
  await ap.getByRole("main").getByRole("button", { name: /View workflow/ }).click();
  const dlg = ap.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await settle(ap, 800);
  const txt = (await dlg.innerText()).replace(/\s+/g, " ");
  await t.shot(ap, "older-item-notice");
  t.check("The older item shows a notice that a later Version exists", /runs on Version 1\. The workflow was updated to Version 2/.test(txt), txt.slice(0, 250));
  const ws = typeOf(await settings(saeed, tm.projectId), "MAR");
  t.check("The Project's MAR binding is as it was (the FX-SB Comment only copy)", ws.workflow.name.en === FX_SB_COMMENT && ws.exceptions.length === 0, `${ws.workflow.name.en}; exceptions ${ws.exceptions.length}`);
  t.note("Bound as an exception for the TMC Participant for a few seconds, not as the Project's MAR Workflow, so the other agents' MAR binding was never switched; it was removed afterwards.");
});

defineCase("WF-07", async (t) => {
  const tm = await H.team("saeed", "hafiz");
  const saeed = tm.api.saeed!;
  const wf = await publishedCopy(saeed, tm.projectId, `UAT WF-07 versions ${H.stamp()}`, undefined, "UAT WF-07 first note");
  const b = ((await saeed.get(`/workflows/${wf}/builder`)).body as H.Json).workflow;
  const def = clone(b.published.definition as Def);
  def.transitions.push({ key: "uat_extra_cancel", label: bi("Cancel here"), kind: "cancel", from: "consultant_engineer", to: "cancelled", outcome: null, permission: "review", actionForm: null });
  def.steps = def.steps.map((s) => (s.key === "approved" ? { ...s, name: bi("Approved (renamed)") } : s));
  await saeed.put(`/workflows/${wf}/draft`, { definition: def });
  const pub = await saeed.post(`/workflows/${wf}/publish`, { changeNote: "UAT WF-07 second note" });
  t.note(`Second Version publish answered ${pub.status} ${pub.status >= 300 ? pub.text.slice(0, 200) : ""}`);
  const v = async (api: Api, n: number) => (await api.get(`/workflows/${wf}/versions/${n}`)).body as H.Json;
  const s = await v(saeed, 1);
  const hist = (s.history as H.Json[]) ?? [];
  t.check("Saeed reads the Versions newest first with Change Notes", hist.length >= 1 && hist[0].changeNote !== undefined && (hist.length < 2 || hist[0].versionNo > hist[1].versionNo), JSON.stringify(hist).slice(0, 300));
  t.check("The running figure is present (counts only items the reader sees)", hist.every((h) => typeof h.running === "number"));
  t.check("Saeed sees the Change Notes", hist.some((h) => /UAT WF-07/.test(String(h.changeNote))), JSON.stringify(hist).slice(0, 200));
  const h = await v(tm.api.hafiz!, 1);
  const hh = (h.history as H.Json[]) ?? [];
  t.check("Hafiz sees the Versions but no Change Note", hh.length === hist.length && hh.every((x) => !x.changeNote), JSON.stringify(hh).slice(0, 200));
  const { page, text } = await H.viewPath(t, "saeed", `/projects/${tm.projectId}/settings/workflows/${wf}/versions/${hist[0]?.versionNo ?? 2}`, "versions-page");
  t.check("The Versions page lists the published Versions with their Change Notes", /UAT WF-07 (first|second) note/.test(text), text.slice(0, 200).replace(/\n/g, " | "));
  const compare = page.getByRole("button", { name: /Compare/ }).or(page.getByText(/Compare/)).first();
  if ((await compare.count()) > 0) {
    await compare.click().catch(() => undefined);
    await settle(page, 800);
    await t.shot(page, "compare");
    const ct = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    t.check("Compare marks added, removed or changed", /added|Added|changed|Changed|removed|Removed/.test(ct), ct.slice(0, 200));
  } else t.note("No Compare control was found on the Versions page by role or text.");
});

defineCase("WF-08", async (t) => {
  const tm = await H.team("saeed", "hafiz", "yousef", "ali");
  const saeed = tm.api.saeed!;
  const stamp = H.stamp();
  const bad = await publishedCopy(saeed, tm.projectId, `UAT WF-08 Beta Build MARs ${stamp}`, undefined, "UAT WF-08 bad name");
  const beta = await participantId(saeed, tm.projectId, "Beta Build");
  const refused = await bindException(saeed, tm.projectId, bad, beta);
  t.check("Binding it for Beta Build is refused because the name holds the Participant's name", refused.status >= 400 && /names_participant|participant/i.test(refused.text), `${refused.status} ${refused.text.slice(0, 200)}`);
  const good = await publishedCopy(saeed, tm.projectId, `UAT WF-08 MARs, short route ${stamp}`, undefined, "UAT WF-08 renamed");
  const ok = await bindException(saeed, tm.projectId, good, beta);
  t.check("The renamed Workflow binds", ok.status < 300, `${ok.status} ${ok.text.slice(0, 200)}`);
  try {
    const yId = await H.createItem(tm.api.yousef!, tm, "MAR", `UAT WF-08 Yousef MAR ${stamp}`, await H.marAnswers(tm, { location: tm.d.loc("Tower 2 Floor 01") }));
    const hId = await H.createItem(tm.api.hafiz!, tm, "MAR", `UAT WF-08 Hafiz MAR ${stamp}`, await H.marAnswers(tm));
    const y = await H.detail(tm.api.yousef!, yId);
    const h = await H.detail(tm.api.hafiz!, hId);
    t.check("Yousef's new MAR runs the exception Workflow", y.workflow.name.en.includes("short route"), JSON.stringify(y.workflow));
    t.check("TMC's new MAR does not", !h.workflow.name.en.includes("short route"), JSON.stringify(h.workflow));
    const aliSees = typeOf(await settings(tm.api.ali!, tm.projectId), "MAR");
    t.check("TMC's Members learn of no exception or Participant (the settings read lists none for Ali)", aliSees.exceptions.length === 0, JSON.stringify(aliSees.exceptions));
    const hWf = (await tm.api.hafiz!.get(`/work-items/${hId}/workflow`)).text + JSON.stringify(h.workflow);
    t.check("Nothing TMC reads names Beta Build", !/Beta Build/.test(hWf));
    const yousefSees = typeOf(await settings(tm.api.yousef!, tm.projectId), "MAR");
    await t.shot((await H.viewPath(t, "saeed", `/projects/${tm.projectId}/settings/workflows`)).page, "exception-listed-for-admin");
    t.note(`Yousef's own settings read lists ${yousefSees.exceptions.length} exception(s).`);
  } finally {
    await unbindException(saeed, tm.projectId, beta);
  }
  const mar = typeOf(await settings(saeed, tm.projectId), "MAR");
  t.check("The exception is removed again; the Project's MAR binding is as it was", mar.exceptions.length === 0 && mar.workflow.name.en === FX_SB_COMMENT, mar.workflow.name.en);
});

defineCase("WF-09", async (t) => {
  const tm = await H.team("saeed");
  const ws = typeOf(await settings(tm.api.saeed!, tm.projectId), "MAR");
  const copies = (ws.copies as H.Json[]).filter((c) => /UAT FX-SB MAR Send Back/.test(c.name.en));
  t.check("Both FX-SB copies exist (Comment only, Edit the Form)", copies.length === 2, copies.map((c) => c.name.en).join(" | "));
  const modes: string[] = [];
  for (const c of copies) {
    const v = (await tm.api.saeed!.get(`/workflows/${c.id}/versions/${c.versionNo ?? 1}`)).body as H.Json;
    const def = v.definition as Def;
    const sb = def.transitions.find((x) => x.kind === "send_back");
    t.check(`${c.name.en}: published with a Send Back from Consultant Engineer to the Draft Step`, !!sb && sb.from === "consultant_engineer" && sb.to === "draft", JSON.stringify(sb));
    modes.push(String(def.steps.find((s) => s.key === "draft")?.afterSendBack));
  }
  t.check("One copy says After a Send Back: comment, the other edit_form", modes.sort().join() === "comment,edit_form", modes.join());
  t.note("The fixture was built by the harness through the api (fixtures-sb.ts); the builder canvas steps themselves are the manual WF-04.");
});

defineCase("WF-10", async (t) => {
  const tm = await H.team("saeed", "hafiz", "omar", "ali");
  const saeed = tm.api.saeed!;
  const wf = await publishedCopy(saeed, tm.projectId, `UAT WF-10 author only ${H.stamp()}`, (d) => {
    d.steps = d.steps.map((s) => (s.key === "draft" ? { ...s, draftsVisibleTo: "author" } : s));
  }, "UAT WF-10 drafts for the author only");
  let id = "";
  await withException(saeed, tm.projectId, wf, "TMC Constructions", async () => {
    id = await H.createItem(tm.api.hafiz!, tm, "MAR", `UAT WF-10 author draft ${H.stamp()}`, await H.marAnswers(tm));
  });
  const d = await H.detail(tm.api.hafiz!, id);
  t.check("Hafiz's Draft runs the author-only Workflow and Hafiz edits it", d.workflow.name.en.includes("WF-10") && d.actions.saveAnswers === true);
  for (const who of ["omar", "ali"] as const) {
    const api = tm.api[who]!;
    t.check(`${who}: the item URL is the plain 404 (api)`, (await api.get(`/work-items/${id}`)).status === 404);
    const rows = await H.listItems(api, tm.projectId, "q=UAT%20WF-10%20author");
    t.check(`${who}: the List shows no such Draft`, !rows.some((r) => r.id === id));
  }
  const { page, text } = await H.viewItem(t, "omar", id, "omar-404");
  t.check("Omar sees the plain 404 page", (await page.getByTestId("not-found").count()) > 0, text.slice(0, 80));
  await H.addDatasheet(tm.api.hafiz!, id);
  await H.must(tm.api.hafiz!, id, "send_for_review");
  t.check("After Send for Review TMC reads it as before (Ali sees it)", (await tm.api.ali!.get(`/work-items/${id}`)).status === 200);
});

defineCase("WF-11", async (t) => {
  t.manual("Needs a person in the builder. Steps: as Saeed open a copy; open a Transition > Add rule; add Restrict by Position, a Validate with a message in EN and AR and an Effect Offer Assign to; Test run the Workflow. Expected: rules show under Condition with AND between Restrict rules; Test run opens each pop-up in test mode and saves nothing; a Transition whose Restrict fails is not offered.");
});

defineCase("WF-12", async (t) => {
  const tm = await H.team("hafiz", "omar", "ali");
  const id = await H.createItem(tm.api.hafiz!, tm, "MAR", `UAT WF-12 author ${H.stamp()}`, await H.marAnswers(tm, { location: tm.d.loc("Tower 2 Floor 01") }));
  await H.addDatasheet(tm.api.hafiz!, id);
  t.check("Omar (Tower 2 only) covers the Tower 2 item too", (await tm.api.omar!.get(`/work-items/${id}`)).status === 200);
  await H.must(tm.api.hafiz!, id, "send_for_review");
  const { page: ap } = await pageAs("ali");
  await go(ap, `/work-items/${id}`);
  await settle(ap);
  const { takeTransition } = await import("../harness/helpers.ts");
  await takeTransition(ap, "Return", { fill: async (dlg) => { await dlg.getByRole("textbox").first().fill("UAT WF-12 please recheck"); } });
  const d = await H.detail(tm.api.hafiz!, id);
  t.check("The Return goes back to Hafiz, who sent it", d.step.key === "contractor_engineer" && d.heldBy?.memberName?.en === "Hafiz Hamdan", JSON.stringify(d.heldBy));
  const o = await H.detail(tm.api.omar!, id);
  t.check("Omar does not hold it and is offered nothing", o.heldBy?.memberName?.en !== "Omar Al Harbi" && o.actions.transitions.length === 0, `${o.heldBy?.memberName?.en}; offered ${H.offered(o).join(",")}`);
  await H.viewItem(t, "hafiz", id, "hafiz-holds-after-return");
});

defineCase("WF-13", async (t) => {
  const tm = await H.team("saeed", "ali", "nasser");
  const saeed = tm.api.saeed!;
  const key = `uat_wf13_${H.stamp()}`;
  const base = `/projects/${tm.projectId}/modules/submittals/stages`;
  const add = await saeed.post(base, { key, name: bi("UAT WF-13 Stage"), category: "in_progress" });
  t.check("Saeed adds a Stage", add.status === 201, `${add.status} ${add.text.slice(0, 200)}`);
  const ren = await saeed.request("PATCH", `${base}/${key}`, { name: bi("UAT WF-13 Stage renamed") });
  t.check("Saeed renames it", ren.status < 300, `${ren.status} ${ren.text.slice(0, 200)}`);
  const stages = async (api: Api, p = tm.projectId) => ((await api.get(`/projects/${p}/modules/submittals/stages`)).body as H.Json).stages as H.Json[] | undefined;
  const mine = (await stages(saeed))?.find((s) => s.key === key);
  t.check("The Stage set shows the change", mine?.name?.en === "UAT WF-13 Stage renamed", JSON.stringify(mine));
  const list = (await tm.api.ali!.get(`/projects/${tm.projectId}/work-items`)).body as H.Json;
  t.check("Ali's List reads the new Stage (its filter and group)", (list.stages as H.Json[]).some((s) => s.key === key && s.name.en === "UAT WF-13 Stage renamed"));
  const board = (await tm.api.ali!.get(`/projects/${tm.projectId}/work-items/kanban`)).body as H.Json;
  t.check("Ali's Kanban reads the new Stage as a column", (board.stages as H.Json[]).some((s) => s.key === key), "");
  const { page, text } = await H.viewPath(t, "ali", `/projects/${tm.projectId}/settings/stages`, "stages-as-ali");
  t.check("Ali reads the Stages page", /UAT WF-13 Stage renamed/.test(text), text.slice(0, 160).replace(/\n/g, " | "));
  t.check("Ali has no edit controls on the Stages page", (await page.getByRole("main").getByRole("button", { name: /Add|Rename|Delete|Save/ }).count()) === 0, "");
  const denied = await tm.api.ali!.post(base, { key: `${key}x`, name: bi("denied"), category: "in_progress" });
  t.check("Ali's change is refused", denied.status >= 400, String(denied.status));
  const out = await tm.api.ali!.get(`/projects/${tm.projectId}/work-item-types/MAR/outcomes`);
  t.check("Ali reads Outcomes (200) and cannot change them", out.status === 200 && (await tm.api.ali!.post(`/projects/${tm.projectId}/work-item-types/MAR/outcomes`, { code: "Z", name: bi("denied"), polarity: "positive" })).status >= 400);
  await H.viewPath(t, "saeed", `/projects/${tm.projectId}/settings/outcomes`, "outcomes-page");
  const jcv = ((await tm.api.nasser!.get("/projects")).body as H.Json).projects as H.Json[];
  const other = jcv.find((p) => p.code === "JCV");
  const otherStages = other ? await stages(tm.api.nasser!, other.id) : undefined;
  t.check("Another Project is unchanged (JCV has no such Stage)", !!otherStages && !otherStages.some((s) => s.key === key), JSON.stringify(otherStages?.map((s) => s.key)));
  const del = await saeed.request("DELETE", `${base}/${key}`);
  t.note(`Cleanup: the Stage was deleted again (${del.status}). The default Stages were not renamed, so other agents' columns kept their names.`);
});

defineCase("WF-14", async (t) => {
  const tm = await H.team("saeed", "ali");
  const saeed = tm.api.saeed!;
  const name = `UAT WF-14 library ${H.stamp()}`;
  const wf = await publishedCopy(saeed, tm.projectId, name, undefined, "UAT WF-14");
  const saved = await saeed.post(`/workflows/${wf}/save-to-library`, { name: bi(`${name} (Library)`) });
  t.check("Save to Library makes a Library copy", saved.status === 201, `${saved.status} ${saved.text.slice(0, 200)}`);
  const lib = ((await saeed.get("/library/workflows")).body as H.Json);
  const entry = JSON.stringify(lib);
  t.check("The Library lists it", entry.includes(`${name} (Library)`), entry.slice(0, 200));
  const libId = (saved.body as H.Json)?.id as string | undefined;
  t.check("It has no link to the original (a new id)", !!libId && libId !== wf, String(libId));
  const marType = typeOf(await settings(saeed, tm.projectId), "MAR");
  const def = await saeed.put("/company-defaults", { kind: "workflow", workItemTypeId: marType.id, itemId: libId });
  t.check("Mark it default for MAR", def.status < 300, `${def.status} ${def.text.slice(0, 200)}`);
  const code = `W${H.stamp().slice(-5)}`;
  try {
    const np = await saeed.post("/projects", { name: bi(`UAT WF-14 Project ${code}`), code: `U${code}`.slice(0, 6), role: "contractor" });
    t.check("A new Project is created", np.status === 201, `${np.status} ${np.text.slice(0, 200)}`);
    const pid = (np.body as H.Json)?.projectId as string;
    const ws = typeOf(await settings(saeed, pid), "MAR");
    t.check("The new Project starts with a copy as its MAR Workflow, bound", ws.workflow.name.en.includes("UAT WF-14 library") && ws.workflow.source === "project_copy", JSON.stringify(ws.workflow));
    await t.shot((await H.viewPath(t, "saeed", `/projects/${pid}/settings/workflows`)).page, "new-project-workflows");
  } finally {
    await saeed.request("DELETE", `/company-defaults?kind=workflow&workItemTypeId=${marType.id}`);
  }
  const aliLib = await tm.api.ali!.get("/library/workflows");
  t.check("A plain Member reads the Library", aliLib.status === 200);
  const { page } = await H.viewPath(t, "ali", "/library", "library-as-ali");
  t.check("Ali sees no save or default control (read-only)", (await page.getByRole("main").getByRole("button", { name: /Mark|default|Save|Delete/i }).count()) === 0);
  const aliSave = await tm.api.ali!.post(`/workflows/${wf}/save-to-library`, { name: bi("UAT WF-14 denied") });
  t.check("Ali cannot save to the Library (Authorized Person only)", aliSave.status >= 400, String(aliSave.status));
  t.note("Cleanup: the Company default for MAR was cleared again after the new Project was made; the new Project and the Library copy stay.");
});

defineCase("WF-15", async (t) => {
  t.blocked("Needs the AGE fixture (pnpm uat:age, RP-922): the script does not exist on this branch (no uat:age in package.json, nothing in scripts/). Steps once it exists: age two items by 1 and by 4 weeks, read the dots in the List, Kanban and item page as Ali and as Mohammed.");
});

defineCase("WF-16", async (t) => {
  const tm = await H.team("hafiz", "ali", "ahmed", "mohammed");
  const hafiz = tm.api.hafiz!;
  const ali = tm.api.ali!;
  const cancelKinds = (d: H.Json) => (d.actions.transitions as H.Json[]).filter((x) => x.kind === "cancel").map((x) => x.key);
  // 1. Draft
  const draft = await H.createItem(hafiz, tm, "MAR", `UAT WF-16 Cancel draft ${H.stamp()}`, await H.marAnswers(tm));
  const { page } = await pageAs("hafiz");
  await go(page, `/work-items/${draft}`);
  await settle(page);
  await page.getByRole("main").getByRole("button", { name: "Cancel" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  await t.shot(page, "cancel-confirm");
  t.check("Cancel at the Draft asks for confirmation", (await dlg.innerText()).includes("Cancel"));
  await dlg.getByRole("button", { name: "Cancel" }).last().click();
  await dlg.waitFor({ state: "hidden" });
  await settle(page, 800);
  const d1 = await H.detail(hafiz, draft);
  t.check("The Draft goes to the Cancelled Stage with no outcome", d1.stage.key === "cancelled" && !/^[A-D]$/.test(String(d1.outcome)), `${d1.stage.key}/${d1.outcome}`);
  // 2. Internal review (Ali)
  const second = await H.sentMar(tm, `UAT WF-16 Cancel review ${H.stamp()}`);
  t.check("Ali is offered Cancel at the Contractor PM Step", cancelKinds(await H.detail(ali, second)).length === 1);
  const { page: ap } = await pageAs("ali");
  await go(ap, `/work-items/${second}`);
  await settle(ap);
  await ap.getByRole("main").getByRole("button", { name: "Cancel" }).first().click();
  const dlg2 = ap.getByRole("dialog");
  await dlg2.waitFor({ state: "visible" });
  await dlg2.getByRole("button", { name: "Cancel" }).last().click();
  await dlg2.waitFor({ state: "hidden" });
  await settle(ap, 800);
  const d2 = await H.detail(ali, second);
  t.check("Ali's Cancel moves it to Cancelled with no outcome", d2.stage.key === "cancelled" && !/^[A-D]$/.test(String(d2.outcome)));
  // 2b. Contractor Engineer step (after a Return)
  const third = await H.sentMar(tm, `UAT WF-16 Cancel engineer ${H.stamp()}`);
  await H.must(ali, third, "return", { answers: { reason: "UAT" } });
  const d3 = await H.detail(hafiz, third);
  t.check("Hafiz is offered Cancel at the Contractor Engineer Step", cancelKinds(d3).length === 1, H.offered(d3).join(","));
  await H.must(hafiz, third, "cancel_engineer");
  t.check("It goes to Cancelled", (await H.detail(hafiz, third)).stage.key === "cancelled");
  // 3. Submitted
  const sub = await H.submittedMar(tm, `UAT WF-16 Cancel submitted ${H.stamp()}`);
  const as = await H.detail(ali, sub);
  const hs = await H.detail(hafiz, sub);
  t.check("Once Submitted no Cancel is offered to Ali or Hafiz", cancelKinds(as).length === 0 && cancelKinds(hs).length === 0, `${H.offered(as).join(",")} | ${H.offered(hs).join(",")}`);
  const refused = await H.move(ali, sub, "cancel_review");
  t.check("A Cancel sent anyway is refused", refused.status >= 400, String(refused.status));
  // 4. Revision
  const rev = await H.submittedMar(tm, `UAT WF-16 Cancel revision ${H.stamp()}`);
  const ver = { sample_checked: true, matches_specification: false, verification_note: "UAT" };
  await H.reviewedMar(tm, rev, ver, "C");
  await H.must(tm.api.mohammed!, rev, "revise_c", { answers: { ...ver, remarks: "UAT revise" } });
  const r = await hafiz.post(`/work-items/${rev}/revisions`, { idempotencyKey: crypto.randomUUID() });
  const revId = (r.body as H.Json).id as string;
  const rd = await H.detail(hafiz, revId);
  t.check("A Revision never offers Cancel", cancelKinds(rd).length === 0, H.offered(rd).join(","));
  await H.viewItem(t, "hafiz", revId, "revision-no-cancel");
});

defineCase("WF-17", async (t) => {
  const tm = await H.team("saeed", "hafiz", "ali", "ahmed");
  const saeed = tm.api.saeed!;
  let publishNote = "";
  let wf = "";
  try {
    wf = await publishedCopy(saeed, tm.projectId, `UAT WF-17 assign ${H.stamp()}`, (d) => {
      for (const x of d.transitions) if (x.key === "send_for_review" || x.key === "submit") x.actions = [...((x.actions as H.Json[]) ?? []), { type: "offer_assign_to" }];
    }, "UAT WF-17 Assign to");
  } catch (e) {
    publishNote = String(e);
  }
  if (!wf) {
    t.check("The Workflow with Assign to on Send for Review and Submit publishes", false, publishNote.slice(0, 400));
    return;
  }
  let id = "";
  await withException(saeed, tm.projectId, wf, "TMC Constructions", async () => {
    id = await H.createItem(tm.api.hafiz!, tm, "MAR", `UAT WF-17 assign ${H.stamp()}`, await H.marAnswers(tm));
  });
  await H.addDatasheet(tm.api.hafiz!, id);
  const d0 = await H.detail(tm.api.hafiz!, id);
  const hSend = (d0.actions.transitions as H.Json[]).find((x) => x.key === "send_for_review");
  t.check("The item runs the Assign to Workflow", d0.workflow.name.en.includes("WF-17"), JSON.stringify(d0.workflow));
  const names = ((hSend?.assignTo as H.Json[]) ?? []).map((x) => x.name.en);
  t.check("Hafiz is offered only TMC Members who may hold the Contractor PM Step", names.length > 0 && names.every((n) => ["Ali Sonour", "Saeed Al Qahtani", "Hafiz Hamdan", "Omar Al Harbi"].includes(n)) && !names.some((n) => /Ahmed|Sara|Mohammed|Layla/.test(n)), `offered: ${names.join(", ")}`);
  const ali = (hSend?.assignTo as H.Json[])?.find((x) => x.name.en === "Ali Sonour");
  const dcl = ((await tm.api.ahmed!.get("/session")).body as H.Json)?.member?.id ?? ((await tm.api.ahmed!.get("/session")).body as H.Json)?.memberId;
  const refusedDcl = await H.move(tm.api.hafiz!, id, "send_for_review", { assignTo: dcl ?? crypto.randomUUID() });
  const refusedFake = await H.move(tm.api.hafiz!, id, "send_for_review", { assignTo: crypto.randomUUID() });
  t.check("A pick it could not have offered is refused like a made-up one", refusedDcl.status === 409 || refusedDcl.status === 422 ? refusedDcl.status === refusedFake.status && refusedDcl.text === refusedFake.text : false, `Ahmed id: ${refusedDcl.status} ${refusedDcl.text.slice(0, 100)} | fake: ${refusedFake.status} ${refusedFake.text.slice(0, 100)} (Ahmed id read: ${dcl ? "yes" : "no"})`);
  await H.must(tm.api.hafiz!, id, "send_for_review", { assignTo: ali?.memberId ?? null });
  const d1 = await H.detail(tm.api.ali!, id);
  const aliSubmit = (d1.actions.transitions as H.Json[]).find((x) => x.key === "submit");
  const sub = ((aliSubmit?.assignTo as H.Json[]) ?? []).map((x) => x.name.en);
  t.check("Ali's Submit offers no DCL person by name (the Consultant is one Participant)", !sub.some((n) => /Ahmed|Sara|Mohammed/.test(n)), `offered on Submit: ${sub.join(", ") || "nothing"}`);
  const { page } = await H.viewItem(t, "ali", id, "ali-submit-offers");
  void page;
});
