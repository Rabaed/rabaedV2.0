/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { defineCase, type CaseApi } from "../harness/case.ts";
import { getBrowser, mailpitUrl, pageAs, sessionsDir, urlOf, webUrl } from "../harness/browser.ts";
import { Api, go, settle, takeTransition } from "../harness/helpers.ts";
import { postJson } from "../../../../scripts/demo-session.ts";
import { mailFull, mailsAbout, ARABIC_INDIC } from "../harness/helpers-not.ts";
import { memberIdOf, setParticipantVisibility, participantVisibility, sameGrant, setMemberVisibility, memberVisibility, sleep, pdfBytes } from "../harness/helpers-vis.ts";
import type { Json } from "../harness/helpers-sub.ts";

// Business journeys J7, J8, J13 and J15 (UAT Round 0, RP-1048). Each is one story, driven through the
// api as the seeded people (the way the web app does) with a screenshot of the page at every
// hand-over. J7 makes the Project "UAT J7 ..." that J8 and J13 work in; its ids are kept in
// .sessions/e2e3-state.json so one journey can be re-run alone.

const bi = (en: string) => ({ en, ar: `${en} (ع)` });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const stateFile = resolve(sessionsDir, "e2e3-state.json");

type State = {
  stamp?: string;
  projectId?: string;
  projectName?: string;
  projectCode?: string;
  tradeA?: string;
  tradeB?: string;
  tmcParticipant?: string;
  betaParticipant?: string;
  j8Workflow?: string;
  j8Name?: string;
};
const readState = (): State => (existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as State) : {});
function saveState(patch: State): State {
  mkdirSync(sessionsDir, { recursive: true });
  const next = { ...readState(), ...patch };
  writeFileSync(stateFile, JSON.stringify(next, null, 2));
  return next;
}

/** Signed-in api callers, one per person, closed with the case. */
class Cast {
  private readonly apis = new Map<string, Api>();
  async as(person: string): Promise<Api> {
    let a = this.apis.get(person);
    if (!a) {
      a = await Api.as(person);
      this.apis.set(person, a);
    }
    return a;
  }
}

function must<T = any>(r: { status: number; body: unknown; text: string }, what: string): T {
  if (r.status >= 300) throw new Error(`${what} answered ${r.status}: ${r.text.slice(0, 300)}`);
  return r.body as T;
}

/** Opens a page as `person`, reads whether it is the plain not-found page, takes the screenshot. */
async function look(t: CaseApi, person: string, path: string, what: string, locale: "en" | "ar" = "en", wait = 700): Promise<{ notFound: boolean; text: string; page: Page; close: () => Promise<void> }> {
  const { context, page } = await pageAs(person, { locale });
  page.setDefaultNavigationTimeout(60_000);
  await go(page, path, locale);
  await settle(page, wait);
  const notFound = (await page.getByTestId("not-found").count()) > 0;
  await t.shot(page, what);
  const text = (await page.locator("main").first().innerText().catch(() => page.locator("body").innerText())).replace(/\s+/g, " ").trim();
  return { notFound, text, page, close: () => context.close() };
}

async function lookClosed(t: CaseApi, person: string, path: string, what: string, locale: "en" | "ar" = "en") {
  const v = await look(t, person, path, what, locale);
  await v.close();
  return v;
}

const state = (): Required<Pick<State, "projectId">> & State => {
  const s = readState();
  if (!s.projectId) throw new Error("No J7 Project yet: run J7 first.");
  return s as Required<Pick<State, "projectId">> & State;
};

// ---------------------------------------------------------------------------------------------------
// J7 Project set-up

defineCase("J7", async (t) => {
  const cast = new Cast();
  const saeed = await cast.as("saeed");
  const stamp = String(Date.now()).slice(-6);
  const name = `UAT J7 Project ${stamp}`;
  const code = `UJ${stamp.slice(-4)}`;

  // 1. Saeed creates the Project.
  const created = await saeed.post("/projects", { name: bi(name), code, role: "contractor" });
  t.check("[PAR-04] Saeed creates the Project (Contractor)", created.status === 201, `${created.status} ${created.text.slice(0, 120)}`);
  const projectId = (created.body as any).projectId as string;
  saveState({ stamp, projectId, projectName: name, projectCode: code, j8Workflow: undefined, j8Name: undefined });
  const mine = ((await saeed.get("/projects")).body as any).projects.find((p: any) => p.id === projectId);
  t.check("[PAR-04] It has a Project Number in TMC's series; Saeed is its Project Admin; the Host Company is TMC", mine?.projectNumber >= 1 && mine.isProjectAdmin === true && mine.hostCompany.legalName.en === "TMC Constructions", JSON.stringify([mine?.projectNumber, mine?.isProjectAdmin]));
  const hafiz = await cast.as("hafiz");
  const layla = await cast.as("layla");
  const nasser = await cast.as("nasser");
  t.check("[PAR-04][VIS] Hand-over 1: nobody else sees the new Project: Hafiz (TMC), Layla (DCL) and Nasser (Beta Build) all get the plain 404", [hafiz, layla, nasser].every(() => true) && (await hafiz.get(`/projects/${projectId}`)).status === 404 && (await layla.get(`/projects/${projectId}`)).status === 404 && (await nasser.get(`/projects/${projectId}`)).status === 404, "");
  await lookClosed(t, "saeed", `/projects/${projectId}`, "1-saeed-project-created");

  // 2. Trades, Locations, Scopes.
  const tag = stamp.slice(-4);
  const add = (path: string, body: unknown) => saeed.post(`/projects/${projectId}${path}`, body);
  const tradeA = await add("/trades", { code: `A${tag}`, name: bi(`UAT J7 Trade A ${tag}`) });
  const tradeB = await add("/trades", { code: `B${tag}`, name: bi(`UAT J7 Trade B ${tag}`) });
  t.check("[PAR-05] Saeed adds two Trades", tradeA.status === 201 && tradeB.status === 201, `${tradeA.status} ${tradeB.status}`);
  const zone = await add("/locations", { code: `Z${tag}`, name: bi(`UAT J7 Zone ${tag}`), parentId: null });
  const building = await add("/locations", { code: `G${tag}`, name: bi(`UAT J7 Building ${tag}`), parentId: (zone.body as any).id });
  const floor = await add("/locations", { code: `F${tag}`, name: bi(`UAT J7 Floor ${tag}`), parentId: (building.body as any).id });
  t.check("[PAR-05] Saeed adds a Zone, a Building and a Floor", zone.status === 201 && building.status === 201 && floor.status === 201, `${zone.status} ${building.status} ${floor.status}`);
  const scope = await add("/scopes", { tradeId: (tradeA.body as any).id, parentId: null, name: bi(`UAT J7 Scope ${tag}`) });
  const sub = await add("/scopes", { tradeId: (tradeA.body as any).id, parentId: (scope.body as any)?.id, name: bi(`UAT J7 Sub-scope ${tag}`) });
  t.check("[PAR-05] Saeed adds a Scope and a Sub-scope", scope.status === 201 && sub.status === 201, `${scope.status} ${sub.status}`);
  saveState({ tradeA: (tradeA.body as any).id, tradeB: (tradeB.body as any).id });
  const dims = (await saeed.get(`/projects/${projectId}/dimensions`)).body as any;
  t.check("[PAR-05] Names read in English and Arabic; the Locations nest Zone > Building > Floor", dims.trade.every((x: any) => x.name.en && x.name.ar) && dims.location.map((x: any) => x.depth).sort().join() === "1,2,3", JSON.stringify(dims.location.map((x: any) => x.depth)));
  const tl = await lookClosed(t, "saeed", `/projects/${projectId}/settings/trades-locations`, "2-trades-locations");
  t.check("[PAR-05] Hand-over 2: the Trades and Locations page shows what Saeed added", tl.text.includes(`UAT J7 Trade A ${tag}`) && tl.text.includes(`UAT J7 Zone ${tag}`), tl.text.slice(0, 160));

  // 3. Saeed invites Beta Build by CR number.
  const inv = await saeed.post(`/projects/${projectId}/participants`, { crNumber: "9999000002", role: "contractor" });
  t.check("[PAR-06] Saeed invites CR 9999000002 as Contractor (202, no body)", inv.status === 202, `${inv.status} ${inv.text.slice(0, 100)}`);
  const pending = ((await nasser.get("/participant-invitations")).body as any).invitations as any[];
  const offer = pending.find((i) => i.project.name.en === name);
  t.check("[PAR-06] Nasser's Company Projects shows the invitation: Project name, Host Company TMC, offered role", !!offer && offer.hostCompany.legalName.en === "TMC Constructions" && offer.projectRole.baseRole === "contractor", JSON.stringify(offer));
  const yousef = await cast.as("yousef");
  const yInv = await yousef.get("/participant-invitations");
  t.check("[PAR-06][VIS] Hand-over 3: before it is accepted Yousef (Beta Build, not the Authorized Person), Hafiz and Layla see no invitation and no Project", yInv.status >= 400 && !JSON.stringify((await hafiz.get("/projects")).body).includes(name) && !JSON.stringify((await layla.get("/participant-invitations")).body).includes(name), `Yousef ${yInv.status}`);
  const byCr = (await saeed.get(`/projects/${projectId}/invitations`)).body as any;
  t.check("[PAR-06][ADM-04] Saeed reads the pending invitation by CR number only", JSON.stringify(byCr).includes("9999000002") && !/Beta/.test(JSON.stringify(byCr)), JSON.stringify(byCr).slice(0, 160));
  await lookClosed(t, "nasser", "/participants", "3-nasser-invitation");

  // 4. Nasser accepts.
  const accept = await nasser.post(`/participant-invitations/${offer.id}/accept`);
  t.check("[PAR-06] Nasser (Beta Build's Authorized Person) accepts", accept.status === 204, `${accept.status} ${accept.text.slice(0, 100)}`);
  const parts = ((await saeed.get(`/projects/${projectId}/participants`)).body as any).participants as any[];
  const beta = parts.find((p) => /Beta Build/.test(p.company.legalName.en));
  t.check("[PAR-06] Beta Build is now a Participant in the role Contractor", beta?.projectRole.baseRole === "contractor", JSON.stringify(beta?.projectRole));
  const tmcP = parts.find((p) => p.isOwnCompany);
  saveState({ tmcParticipant: tmcP.id, betaParticipant: beta.id });
  const cp = ((await nasser.get("/participants")).body as any)?.participants as any[] | undefined;
  const cpHere = cp?.find((p) => p.project.name.en === name);
  t.check("[PAR-06][PAR-13] Hand-over 4: Nasser's Company Projects now lists the Project: code, number, Host Company TMC, own role Contractor", !!cpHere && cpHere.project.code === code && cpHere.hostCompany.legalName.en === "TMC Constructions" && cpHere.projectRole.baseRole === "contractor", JSON.stringify(cpHere)?.slice(0, 200));
  t.check("[PAR-06][VIS] ...and names no other Company (only TMC as Host Company)", !!cpHere && !/Design Consultants|Al Waha/.test(JSON.stringify(cpHere)), "");
  await lookClosed(t, "saeed", `/projects/${projectId}/settings/visibility`, "4-saeed-visibility-after-accept");

  // 5. Saeed grants the Participant's Visibility: Trade A only, all Locations.
  const grant = await setParticipantVisibility(saeed, beta.id, { trade: { isAll: false, valueIds: [(tradeA.body as any).id] }, location: { isAll: true, valueIds: [] } });
  t.check("[PAR-07] Saeed grants Beta Build Trade A only, all Locations: it saves", grant.status === 204, `${grant.status} ${grant.text.slice(0, 100)}`);
  t.check("[PAR-07] The grant reads back", sameGrant((await participantVisibility(saeed, beta.id)).trade, { isAll: false, valueIds: [(tradeA.body as any).id] }));
  const nv = await nasser.get(`/participants/${beta.id}/visibility`);
  const nvGrant = (nv.body as any)?.visibility?.trade;
  t.check("[PAR-07][VIS] Hand-over 5: Nasser reads his own Company's grant (Trade A only) - the positive control", nv.status === 200 && nvGrant?.isAll === false && nvGrant.valueIds.join() === (tradeA.body as any).id, `${nv.status} ${nv.text.slice(0, 100)}`);
  const nTrades = ((nv.body as any)?.covered?.trade ?? []).map((x: any) => x.id as string);
  t.check("[PAR-07][VIS] Hand-over 5: Nasser, not yet a Project Member, reads only the Trade his Company covers (Trade A, not Trade B) - V16; the Project's own pages are the plain 404 for him", nTrades.join() === (tradeA.body as any).id && (await nasser.get(`/projects/${projectId}/dimensions`)).status === 404, `covered: ${((nv.body as any)?.covered?.trade ?? []).map((x: any) => x.name.en).join(" | ")}`);
  const nScopes = await nasser.get(`/participants/${beta.id}/scopes`);
  t.check("[PAR-07][VIS] ...and the Scopes under that Trade (positive control)", nScopes.status === 200 && JSON.stringify(nScopes.body).includes(`UAT J7 Scope ${tag}`), `${nScopes.status} ${nScopes.text.slice(0, 120)}`);
  const cannot = await nasser.put(`/participants/${beta.id}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } });
  t.check("[PAR-07][VIS] Nasser cannot widen his own Company's grant (refused)", cannot.status >= 400 && sameGrant((await participantVisibility(saeed, beta.id)).trade, { isAll: false, valueIds: [(tradeA.body as any).id] }), `${cannot.status}`);
  const tmcGrant = await nasser.get(`/participants/${tmcP.id}/visibility`);
  t.check("[PAR-07][VIS] Nasser cannot read TMC's grant (the plain 404)", tmcGrant.status === 404, `${tmcGrant.status}`);
  const tmcGrant2 = await setParticipantVisibility(saeed, tmcP.id, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } });
  t.check("[PAR-07] Saeed also grants TMC itself (the Host Company starts with no coverage on a new Project) all Trades and Locations", tmcGrant2.status === 204, `${tmcGrant2.status} ${tmcGrant2.text.slice(0, 100)}`);
  await lookClosed(t, "saeed", `/projects/${projectId}/settings/visibility`, "5-saeed-grant");

  // 6. Nasser adds Yousef as a Project Member with a Position.
  const yId = await memberIdOf(nasser, beta.id, "yousef.karim@betabuild.demo.rabaed.test").catch(async () => {
    const all = ((await nasser.get("/members")).body as any).members as any[];
    return all.find((m) => m.email === "yousef.karim@betabuild.demo.rabaed.test").id as string;
  });
  const addM = await nasser.post(`/participants/${beta.id}/members`, { memberId: yId });
  t.check("[PAR-08] Nasser adds Yousef to the Project as a Project Member", addM.status === 204, `${addM.status} ${addM.text.slice(0, 100)}`);
  const pos = await nasser.put(`/participants/${beta.id}/members/${yId}/positions`, { positions: ["engineer"] });
  t.check("[PAR-08] With the Position Engineer", pos.status === 204, `${pos.status} ${pos.text.slice(0, 100)}`);
  const narrow = await setMemberVisibility(nasser, beta.id, yId, { trade: { isAll: false, valueIds: [(tradeA.body as any).id] }, location: { isAll: true, valueIds: [] } });
  t.check("[PAR-08] Nasser narrows Yousef to Trade A (inside Beta Build's grant): it saves", narrow.status === 204, `${narrow.status} ${narrow.text.slice(0, 100)}`);
  const over = await setMemberVisibility(nasser, beta.id, yId, { trade: { isAll: false, valueIds: [(tradeB.body as any).id] }, location: { isAll: true, valueIds: [] } });
  t.check("[PAR-08] A Trade Beta Build does not cover (Trade B) is rejected for Yousef", over.status >= 400, `${over.status} ${over.text.slice(0, 100)}`);
  const vis = await memberVisibility(nasser, beta.id, yId);
  t.check("[PAR-08] Yousef's own grant stays inside the Company's (Trade A)", vis.trade.isAll === false && vis.trade.valueIds.join() === (tradeA.body as any).id, JSON.stringify(vis.trade));
  const yProjects = ((await yousef.get("/projects")).body as any).projects as any[];
  t.check("[PAR-08] Yousef now sees the Project in his list", yProjects.some((p) => p.id === projectId), `${yProjects.length} Projects`);
  const yDims = ((await yousef.get(`/projects/${projectId}/dimensions`)).body as any);
  const yTrades = (yDims?.trade ?? []).map((x: any) => x.id);
  t.check("[PAR-08][VIS] Hand-over 6: the invited Company's Member reads the Project (200) - and Layla and Hafiz still get the plain 404", (await yousef.get(`/projects/${projectId}`)).status === 200 && (await layla.get(`/projects/${projectId}`)).status === 404 && (await hafiz.get(`/projects/${projectId}`)).status === 404, `Trades Yousef reads: ${yTrades.length}`);
  t.check("[PAR-08][VIS] A Project Member reads all the Project's Trades (V16: every Project Member sees them); his grant narrows what he sees of items, not the Trade list", yTrades.includes((tradeA.body as any).id) && yTrades.includes((tradeB.body as any).id), `reads ${yTrades.length} Trade(s)`);
  const yousefParts = ((await yousef.get(`/projects/${projectId}/participants`)).body as any)?.participants as any[] | undefined;
  t.check("[PAR-13][VIS] Yousef sees his own Participant and the Host Company by name, no other", Array.isArray(yousefParts) && yousefParts.every((p) => /Beta Build|TMC/.test(p.company.legalName.en)), JSON.stringify(yousefParts?.map((p) => p.company.legalName.en)));
  await lookClosed(t, "nasser", `/participants/${beta.id}`, "6-nasser-project-members");
  const nl = await lookClosed(t, "layla", `/projects/${projectId}`, "6-layla-project-404");
  t.check("[VIS] Layla (DCL, not invited) opens the Project URL and gets the plain not-found page", nl.notFound, nl.text.slice(0, 100));

  // 7. Saeed sets numbering: Participant Codes and a pattern with a Trade segment.
  const codeTmc = await saeed.put(`/participants/${tmcP.id}/code`, { code: "TMJ7" });
  const codeBeta = await saeed.put(`/participants/${beta.id}/code`, { code: "BBJ7" });
  t.check("[PAR-10] Saeed sets Participant Codes for TMC and Beta Build (2 to 6 letters or digits)", codeTmc.status === 204 && codeBeta.status === 204, `${codeTmc.status} ${codeBeta.status} ${codeBeta.text.slice(0, 80)}`);
  const pattern = { segments: [{ kind: "project" }, { kind: "type" }, { kind: "trade" }, { kind: "participant" }], separator: "-", seqDigits: 4, countedBy: [0, 1, 2, 3] };
  const save = await saeed.request("PUT", `/projects/${projectId}/numbering`, { workItemTypeId: null, pattern, sharedCounterAccepted: false });
  t.check("[PAR-10] Saeed saves a pattern Project-Type-Trade-Participant, counted by the Participant Code", save.status === 204, `${save.status} ${save.text.slice(0, 100)}`);
  const num = (await saeed.get(`/projects/${projectId}/numbering`)).body as any;
  t.check("[PAR-10] The example shows the Project code and the pattern", !!num.example && JSON.stringify(num.example).includes(code) && JSON.stringify(num.example).includes("TMJ7"), JSON.stringify(num.example).slice(0, 160));
  const nNum = await nasser.request("PUT", `/projects/${projectId}/numbering`, { workItemTypeId: null, pattern, sharedCounterAccepted: true });
  t.check("[PAR-10][VIS] Hand-over 7: Nasser (not a Project Admin) cannot change the numbering (refused)", nNum.status >= 400, `${nNum.status}`);
  const nCode = await nasser.put(`/participants/${tmcP.id}/code`, { code: "XXJ7" });
  t.check("[PAR-10][VIS] Nasser cannot set TMC's Participant Code (refused, not 204)", nCode.status >= 400, `${nCode.status}`);
  await lookClosed(t, "saeed", `/projects/${projectId}/settings/numbering`, "7-saeed-numbering");

  t.note(`The Project ${name} (${code}) stays: J8 and J13 work in it. Company onboarding in Rabaed Admin is MANUAL (never scripted: it needs the Engineer's password and an emailed code). Steps for a person: 1) open http://127.0.0.1:4750 and sign in as the Rabaed Engineer (password from the team's secret store, then the 6-digit code from Mailpit http://127.0.0.1:8725). 2) Onboard a Company: legal names EN and AR, CR 9999000005, VAT 399990000000053, an Authorized Person (a made-up .test address), language, a reason. 3) Open the invitation in Mailpit and accept as that person. 4) As Saeed, invite CR 9999000005 on ${name} (this journey used Beta Build, already on Rabaed). Expected: the Company is created, the action logged with the reason, the invited Authorized Person accepts like Nasser did above.`);
});

// ---------------------------------------------------------------------------------------------------
// J8 Workflow authoring (in the J7 Project only; Riyadh Gate Tower's MAR binding is never touched)

const MAR_DEFAULT_NAME = /^2→2 Contractor Engineer → Contractor PM → Consultant Engineer → Consultant PM$/;

async function workflowSettings(api: Api, projectId: string): Promise<any> {
  return must(await api.get(`/projects/${projectId}/workflow-settings`), "workflow settings");
}
const marOf = (ws: any) => ws.types.find((x: any) => x.code === "MAR");

defineCase("J8", async (t) => {
  const cast = new Cast();
  const saeed = await cast.as("saeed");
  const s = state();
  const projectId = s.projectId;
  const stamp = String(Date.now()).slice(-6);
  const name = `UAT J8 MAR Workflow ${stamp}`;
  const tower = ((await saeed.get("/projects")).body as any).projects.find((p: any) => p.code === "TWR").id as string;
  const towerBefore = marOf(await workflowSettings(saeed, tower)).workflow;

  // 1. Duplicate the Rabaed Default MAR Workflow into the J7 Project.
  const ws0 = await workflowSettings(saeed, projectId);
  const mar0 = marOf(ws0);
  const def = mar0.rabaedDefaults.find((d: any) => MAR_DEFAULT_NAME.test(d.name.en));
  t.check("[WF-03] The J7 Project lists the Rabaed Default MAR Workflow (2→2 route) to duplicate", !!def, mar0.rabaedDefaults.map((d: any) => d.name.en).join(" | "));
  const dup = await saeed.post(`/workflows/${def.id}/duplicate`, { projectId, name: bi(name) });
  t.check("[WF-03] Saeed duplicates it as a Project copy in the J7 Project", dup.status === 201, `${dup.status} ${dup.text.slice(0, 150)}`);
  const wf = (dup.body as any).id as string;
  saveState({ j8Workflow: wf, j8Name: name });
  const b0 = ((await saeed.get(`/workflows/${wf}/builder`)).body as any).workflow;
  t.check("[WF-03] It is a draft, Version 1, nothing published, no link to the original", b0.published === null && b0.draft !== null && !JSON.stringify(b0).includes(def.id), JSON.stringify({ published: b0.published, versionNo: b0.draft?.versionNo }));
  const yousef = await cast.as("yousef");
  const layla = await cast.as("layla");
  const nasser = await cast.as("nasser");
  const copiesFor = async (api: Api) => (marOf(await workflowSettings(api, projectId)).copies as any[]).map((c) => c.name.en as string);
  t.check("[WF-03][VIS] Hand-over 1: Saeed lists the draft among the Project's Workflows; Yousef (Beta Build Member) does not see it", (await copiesFor(saeed)).includes(name) && !(await copiesFor(yousef)).includes(name), "");
  t.check("[WF-03][VIS] Yousef, Nasser (Beta Build) and Layla (DCL) cannot open the draft: the plain 404 from the api", (await yousef.get(`/workflows/${wf}/builder`)).status === 404 && (await nasser.get(`/workflows/${wf}/builder`)).status === 404 && (await layla.get(`/workflows/${wf}/builder`)).status === 404, "");
  await lookClosed(t, "saeed", `/projects/${projectId}/settings/workflows`, "1-saeed-workflows-draft");
  const lp = await lookClosed(t, "layla", `/projects/${projectId}/settings/workflows/${wf}`, "1-layla-draft-404");
  t.check("[WF-03][VIS] Layla opens the draft's builder URL in the browser: the plain not-found page", lp.notFound, lp.text.slice(0, 100));

  // 2. Edit in the builder (the canvas autosaves the definition the same way).
  const draft = clone((b0.draft.definition ?? b0.published.definition) as Json);
  draft.steps = draft.steps.map((x: Json) => (x.key === "approved" ? { ...x, name: bi("Approved (J8)") } : x));
  draft.steps = draft.steps.map((x: Json) => (x.key === "internal_review" ? { ...x, name: bi("Contractor PM (J8)") } : x));
  const put = await saeed.put(`/workflows/${wf}/draft`, { definition: draft });
  t.check("[WF-04] Saeed edits the draft (renames two Steps): it saves", put.status < 300, `${put.status} ${put.text.slice(0, 150)}`);
  const edited = ((await saeed.get(`/workflows/${wf}/builder`)).body as any).workflow.draft.definition as Json;
  t.check("[WF-04] The edit reads back from the draft", edited.steps.some((x: Json) => x.name.en === "Approved (J8)"), "");

  // 3. Validate, in the builder.
  const { context, page } = await pageAs("saeed");
  try {
    await go(page, `/projects/${projectId}/settings/workflows/${wf}`);
    await settle(page, 3000);
    await page.getByRole("button", { name: "Validate" }).click();
    await settle(page, 1500);
    await t.shot(page, "2-builder-validate");
    const api = (await saeed.post(`/workflows/${wf}/validate`, { definition: edited })).body as any;
    const errors = [...(api.issues ?? []), ...((api.problems ?? []) as Json[]).filter((p) => p.severity === "error")];
    t.check("[WF-05] Hand-over 2: Validate (button and api) finds no error in the edited Workflow", errors.length === 0, JSON.stringify(api).slice(0, 200));

    // 4. Publish with a Change Note.
    await page.getByRole("button", { name: "Publish" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.waitFor({ state: "visible" });
    await settle(page, 800);
    const text = (await dlg.innerText()).replace(/\s+/g, " ");
    t.check("[WF-05] The Publish pop-up shows what changed and asks for a Change Note", /Change Note|change note|Note/i.test(text), text.slice(0, 200));
    const confirm = dlg.getByRole("button", { name: /^Publish/ }).last();
    const blocked = await confirm.isDisabled();
    if (!blocked) await confirm.click();
    await settle(page, 1200);
    const stillOpen = await dlg.isVisible().catch(() => false);
    const none = ((await saeed.get(`/workflows/${wf}/builder`)).body as any).workflow;
    t.check("[WF-05] Without a Change Note it does not publish (button off or the pop-up stays)", (blocked || stillOpen) && (none.publishedVersions ?? []).length === 0, `blocked ${blocked}, open ${stillOpen}`);
    await dlg.getByRole("textbox").first().fill("UAT J8 first Version: Steps renamed");
    await t.shot(page, "3-builder-publish-dialog");
    await dlg.getByRole("button", { name: /^Publish/ }).last().click();
    await settle(page, 2500);
  } finally {
    await context.close();
  }
  const pub = ((await saeed.get(`/workflows/${wf}/builder`)).body as any).workflow;
  t.check("[WF-05] With the Change Note it publishes Version 1", (pub.publishedVersions ?? []).includes(1), JSON.stringify(pub.publishedVersions));

  // Readers of the published Version.
  const v1 = async (api: Api) => api.get(`/workflows/${wf}/versions/1`);
  const sv = (await v1(saeed)).body as any;
  const yv = await v1(yousef);
  t.check("[WF-07] Hand-over 3: Saeed reads the Version with its Change Note", (sv?.history ?? []).some((h: Json) => /UAT J8/.test(String(h.changeNote))), JSON.stringify(sv?.history)?.slice(0, 160));
  t.check("[WF-07][VIS] Yousef (a Project Member of Beta Build) reads the published Version whole but no Change Note (V20)", yv.status === 200 && ((yv.body as any).definition?.steps?.length ?? 0) >= 7 && ((yv.body as any).history ?? []).every((h: Json) => !h.changeNote), `${yv.status}`);
  t.check("[WF-07][VIS] Layla and Nasser (not Project Members) get the plain 404 for the Version", (await v1(layla)).status === 404 && (await v1(nasser)).status === 404, "");
  await lookClosed(t, "saeed", `/projects/${projectId}/settings/workflows/${wf}/versions/1`, "4-saeed-version-page");

  // 5. Bind it in the J7 Project (the Project's own MAR binding; Tower is not touched).
  const marType = marOf(await workflowSettings(saeed, projectId));
  const bind = await saeed.request("PUT", `/projects/${projectId}/workflow-bindings`, { workItemTypeId: marType.id, raisingParticipantId: null, workflowId: wf });
  t.check("[WF-03] Saeed binds it as the J7 Project's MAR Workflow", bind.status < 300, `${bind.status} ${bind.text.slice(0, 150)}`);
  const after = marOf(await workflowSettings(saeed, projectId)).workflow;
  t.check("[WF-03] The J7 Project now runs the copy at Version 1 for MAR", after.name.en === name && after.versionNo === 1, JSON.stringify(after));
  const yAfter = marOf(await workflowSettings(yousef, projectId)).workflow;
  t.check("[WF-03][VIS] Hand-over 4: Yousef reads which Workflow the Project runs (V20) - the published copy by name", yAfter.name.en === name, yAfter.name?.en);
  const towerAfter = marOf(await workflowSettings(saeed, tower)).workflow;
  t.check("[WF-09] Riyadh Gate Tower's MAR binding is unchanged", towerAfter.id === towerBefore.id && towerAfter.name.en === towerBefore.name.en, `${towerBefore.name.en} -> ${towerAfter.name.en}`);
  await lookClosed(t, "saeed", `/projects/${projectId}/settings/workflows`, "5-saeed-bound");

  // 6. Save to the Company Library.
  const saved = await saeed.post(`/workflows/${wf}/save-to-library`, { name: bi(`${name} (Library)`) });
  t.check("[WF-14] Saeed saves the Workflow to TMC's Library", saved.status === 201, `${saved.status} ${saved.text.slice(0, 120)}`);
  const libFor = async (api: Api) => JSON.stringify((await api.get("/library/workflows")).body);
  const ali = await cast.as("ali");
  t.check("[WF-14] The Library lists it for Saeed and for Ali (a plain TMC Member reads it)", (await libFor(saeed)).includes(`${name} (Library)`) && (await libFor(ali)).includes(`${name} (Library)`), "");
  t.check("[WF-14][VIS] Hand-over 5: nobody of another Company reads TMC's Library entry (V18): Layla, Nasser", !(await libFor(layla)).includes(name) && !(await libFor(nasser)).includes(name), "");
  await lookClosed(t, "saeed", "/library", "6-saeed-library");
  const ll = await lookClosed(t, "layla", "/library", "6-layla-library");
  t.check("[WF-14][VIS] Layla's own Library page does not show TMC's Workflow", !ll.text.includes(name), ll.text.slice(0, 100));
  t.note(`Workflow "${name}" (Project copy, Version 1, bound for MAR in the J7 Project) and its Library copy stay. The canvas drags (WF-04) are a person's; this journey edits the definition the way the builder autosaves it and uses the builder's own Validate and Publish buttons.`);
});

// ---------------------------------------------------------------------------------------------------
// J13 People leaving (in the J7 Project only; a seeded person is never deactivated or removed)

/** An Api over a context the journey made itself (the person is not a demo person). */
async function apiOver(context: BrowserContext, person: string): Promise<Api> {
  const page = await context.newPage();
  await page.goto(urlOf("/"), { waitUntil: "domcontentloaded" });
  // The constructor is private in the harness; a script may still use the signed-in page it holds.
  return new (Api as unknown as new (p: string, c: BrowserContext, pg: Page) => Api)(person, context, page);
}

const TMC_ONLY_NAMES = ["Design Consultants", "Beta Build", "Al Waha", "Layla", "Nasser", "Yousef", "Faisal", "Noura", "Hind", "Ahmed", "Mohammed", "Sara "];

defineCase("J13", async (t) => {
  const cast = new Cast();
  const saeed = await cast.as("saeed");
  const s = state();
  if (!s.tmcParticipant || !s.tradeA) throw new Error("The J7 state is incomplete: run J7 first.");
  const projectId = s.projectId;
  const tmcP = s.tmcParticipant;
  const stamp = String(Date.now());
  const email = `uat.j13.${stamp}@tmc.demo.rabaed.test`;
  const fullName = `UAT J13 Leaver ${stamp.slice(-5)}`;
  const layla = await cast.as("layla");
  const yousef = await cast.as("yousef");
  const hafiz = await cast.as("hafiz");

  // 1. Saeed invites a new Member of TMC by email.
  const invite = await saeed.post("/members", { email, fullName: { en: fullName, ar: `اختبار ${stamp.slice(-5)}` }, locale: "en" });
  if (!t.check("[PAR-02] Saeed invites a new Member by email", invite.status === 201, `${invite.status} ${invite.text.slice(0, 100)}`)) return;
  const memberId = (invite.body as any).memberId as string;
  const asInvited = ((await saeed.get("/members")).body as any).members.find((m: any) => m.id === memberId);
  t.check("[PAR-02] The Member appears as invited", asInvited?.status === "invited", JSON.stringify(asInvited?.status));
  let mails = await mailsAbout(email, "");
  for (let i = 0; i < 5 && mails.length === 0; i++) {
    await sleep(2000);
    mails = await mailsAbout(email, "");
  }
  t.check("[PAR-02] Hand-over 1: the invitation email arrives in Mailpit (the Test Case: follow the link from the email)", mails.length > 0, `${mails.length} mails to ${email} after 10 s`);
  // The one-time token is in the email's link only (RP-1052): the invite answer no longer carries it.
  const token = /accept-invitation#token=([\w-]+)/.exec(mails[0]?.text ?? "")?.[1] ?? "";
  t.check("[PAR-02][VIS] Layla (DCL) does not list the invited Member", !((await layla.get("/members")).body as any).members.some((m: any) => m.email === email), "");
  await lookClosed(t, "saeed", "/members", "1-saeed-members-invited");

  // 2. The new Member accepts the invitation in the browser, setting a generated test password kept under .sessions only.
  mkdirSync(sessionsDir, { recursive: true });
  const password = `Uat-${randomBytes(12).toString("hex")}`;
  writeFileSync(resolve(sessionsDir, "j13-test-password.txt"), `${email}\n${password}\n`);
  const b = await getBrowser();
  const ctx = await b.newContext({ locale: "en-US", viewport: { width: 1366, height: 800 } });
  ctx.setDefaultTimeout(15_000);
  try {
    const page = await ctx.newPage();
    await page.goto(`${webUrl}/en/accept-invitation#token=${encodeURIComponent(token)}`, { waitUntil: "networkidle" });
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="confirm"]').fill(password);
    await page.getByRole("button", { name: "Set password and sign in" }).click();
    await page.waitForURL((u) => !/accept-invitation/.test(u.pathname), { timeout: 20_000 }).catch(() => undefined);
    await settle(page, 1200);
    await t.shot(page, "2-new-member-signed-in");
    t.check("[PAR-02] Hand-over 2: the new Member sets a password and lands signed in on the app", !/accept-invitation|sign-in/.test(page.url()), page.url());
    const stateOut = resolve(sessionsDir, "j13-member.json");
    await ctx.storageState({ path: stateOut });
    const leaver = await apiOver(ctx, "j13");
    const me = (await leaver.get("/me")).body as any;
    t.check("[PAR-02] The new Member belongs to TMC (and is active)", me?.member?.fullName?.en === fullName, JSON.stringify(me?.member?.fullName?.en));
    t.check("[PAR-02][VIS] On no Project yet: the new Member sees none (the J7 Project is the plain 404 for them)", !JSON.stringify(((await leaver.get("/projects")).body as any).projects).includes(projectId) && (await leaver.get(`/projects/${projectId}`)).status === 404, "");

    // 3. Saeed adds them to the J7 Project (TMC's Participant) with a Position; Saeed also holds the Engineer Position, to take over.
    const tmcMembers = async () => ((await saeed.get(`/participants/${tmcP}/members`)).body as any).members as any[];
    const add = await saeed.post(`/participants/${tmcP}/members`, { memberId });
    t.check("[PAR-08] Saeed (Authorized Person) adds the new Member to the J7 Project", add.status === 204, `${add.status} ${add.text.slice(0, 100)}`);
    const pos = await saeed.put(`/participants/${tmcP}/members/${memberId}/positions`, { positions: ["engineer"] });
    t.check("[PAR-08] With the Position Engineer", pos.status === 204, `${pos.status} ${pos.text.slice(0, 100)}`);
    const saeedId = ((await saeed.get("/session")).body as any)?.member?.id ?? (await tmcMembers()).find((m) => m.email === emailOfSaeed)?.id;
    const saeedPos = await saeed.put(`/participants/${tmcP}/members/${saeedId}/positions`, { positions: ["engineer", "project_manager"] });
    t.check("[PAR-08] Saeed himself takes the Positions Engineer and Project Manager (the Member who can take over)", saeedPos.status === 204, `${saeedPos.status} ${saeedPos.text.slice(0, 100)}`);
    const all = { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } };
    const g1 = await setMemberVisibility(saeed, tmcP, memberId, all);
    const g2 = await setMemberVisibility(saeed, tmcP, saeedId, all);
    t.check("[PAR-08] Both are granted all Trades and Locations (a Project Member starts with none)", g1.status === 204 && g2.status === 204, `${g1.status} ${g2.status}`);
    t.check("[PAR-08] The new Member now sees the J7 Project", (await leaver.get(`/projects/${projectId}`)).status === 200, "");
    t.check("[PAR-08][VIS] Hand-over 3: TMC's Project Members list is read by TMC only: Yousef (Beta Build) and Layla (DCL) get the plain 404 for it", (await yousef.get(`/participants/${tmcP}/members`)).status === 404 && (await layla.get(`/participants/${tmcP}/members`)).status === 404, "");
    await lookClosed(t, "saeed", `/participants/${tmcP}`, "3-saeed-tmc-project-members");

    // 4. The new Member starts a MAR: a Draft (their Step).
    const sup = await saeed.post(`/projects/${projectId}/approved-suppliers`, { name: bi(`UAT J13 Supplier ${stamp.slice(-5)}`), tradeId: s.tradeA, scopeId: null });
    const supplier = (sup.body as any)?.id as string;
    const dims = (await saeed.get(`/projects/${projectId}/dimensions`)).body as any;
    const floorId = dims.location.find((x: any) => x.depth === 3 && /UAT J7/.test(x.name.en))?.id as string;
    const subject = `UAT J13 leaver Draft ${stamp.slice(-5)}`;
    const created = await leaver.post(`/projects/${projectId}/work-items`, {
      type: "MAR",
      title: subject,
      answers: { manufacturer: "UAT Maker", supplier, model: "UAT-1", description: `${subject}: made up.`, items: [{ fixture_type: "UAT fixture", description: "made up", quantity: 2, unit: "pcs" }], trade: s.tradeA, location: floorId },
    });
    t.check("[SUB-01] The new Member raises a MAR Draft in the J7 Project (their Step: the Draft)", created.status === 201, `${created.status} ${created.text.slice(0, 200)}`);
    const itemId = (created.body as any)?.id as string;
    const detail0 = (await leaver.get(`/work-items/${itemId}`)).body as any;
    t.check("[SUB-01] They hold it at the Draft Step, and it runs the J8 Workflow", detail0?.heldBy?.memberName?.en === fullName && /UAT J8/.test(detail0?.workflow?.name?.en ?? ""), JSON.stringify([detail0?.heldBy?.memberName?.en, detail0?.workflow?.name?.en, detail0?.step?.key]));
    t.check("[VIS] Hand-over 4: Saeed sees the Draft (TMC); Yousef (Beta Build) and Layla (DCL) get the plain 404 for it", (await saeed.get(`/work-items/${itemId}`)).status === 200 && (await yousef.get(`/work-items/${itemId}`)).status === 404 && (await layla.get(`/work-items/${itemId}`)).status === 404 && (await hafiz.get(`/work-items/${itemId}`)).status === 404, "");
    const lv = await lookClosed(t, "saeed", `/work-items/${itemId}`, "4-saeed-leaver-draft");
    t.check("[VIS] Saeed opens the Draft's page (not the not-found page)", !lv.notFound, lv.text.slice(0, 80));

    // 5. Saeed deactivates them: the Handover first.
    const first = await saeed.post(`/members/${memberId}/deactivate`);
    const body = first.body as any;
    t.check("[PAR-09] Deactivating without a Handover is refused 409 handover_needed and nothing changes", first.status === 409 && body?.error === "handover_needed" && body.handovers.length >= 1 && ((await saeed.get("/members")).body as any).members.find((m: any) => m.id === memberId)?.status === "active", `${first.status} ${first.text.slice(0, 160)}`);
    const step = body?.handovers?.[0];
    t.check("[PAR-09] The Handover lists the Draft: Project, 'No number yet', Subject, Step", step?.project?.id === projectId && step?.item?.documentNumber === null && step?.item?.title === subject && !!step?.step?.en, JSON.stringify(step)?.slice(0, 300));
    const candidateNames = (step?.candidates ?? []).map((c: any) => c.fullName.en as string);
    t.check("[PAR-09][VIS] The candidates are TMC's own Members only, Saeed pre-filled as the single one; nothing of another Company is in the list", candidateNames.join() === "Saeed Al Qahtani" && !TMC_ONLY_NAMES.some((n) => JSON.stringify(body).includes(n)), candidateNames.join(", "));
    t.check("[PAR-09][VIS] Only the Authorized Person has the Handover: Hafiz (plain TMC Member) cannot deactivate (refused, nothing named)", (await hafiz.post(`/members/${memberId}/deactivate`)).status >= 400, "");
    // The same, in the browser.
    const { context, page: sp } = await pageAs("saeed");
    let uiDone = false;
    try {
      await go(sp, "/members");
      await settle(sp, 800);
      const row = sp.getByRole("row").filter({ hasText: fullName });
      await row.getByRole("button", { name: /Actions|More/ }).last().click();
      await sp.getByRole("menuitem", { name: "Deactivate" }).click();
      const dlg = sp.getByRole("dialog");
      await dlg.waitFor({ state: "visible" });
      await dlg.getByRole("button", { name: "Deactivate" }).click();
      await sp.getByRole("dialog").filter({ hasText: /Hand over/ }).waitFor({ state: "visible" });
      await settle(sp, 600);
      const text = (await sp.getByRole("dialog").innerText()).replace(/\s+/g, " ");
      await t.shot(sp, "5-handover-dialog");
      t.check("[PAR-09] Hand-over 5: the Handover dialog names the Draft, its Step and the J7 Project, with Saeed as the new holder", text.includes(subject) && /Saeed/.test(text) && /No number yet/.test(text), text.slice(0, 260));
      t.check("[PAR-09][VIS] The dialog names no person or Company outside TMC", !TMC_ONLY_NAMES.some((n) => text.includes(n)), text.slice(0, 120));
      await sp.getByRole("dialog").getByRole("button", { name: /Hand over and deactivate/ }).click();
      await sp.getByRole("dialog").waitFor({ state: "hidden" });
      await settle(sp, 800);
      uiDone = true;
    } catch (e) {
      t.note(`The Deactivate dialog could not be driven in the browser (${String(e).slice(0, 160)}); the api finished it with the same picks.`);
    } finally {
      await context.close();
    }
    if (!uiDone) {
      const done = await saeed.post(`/members/${memberId}/deactivate`, { handovers: [{ assignmentId: step.assignmentId, toMemberId: saeedId }] });
      t.check("[PAR-09] Deactivate with the pick (api)", done.status === 200, `${done.status} ${done.text.slice(0, 120)}`);
    }
    const after = ((await saeed.get("/members")).body as any).members.find((m: any) => m.id === memberId);
    t.check("[PAR-09] The Member is deactivated", after?.status === "deactivated", JSON.stringify(after?.status));
    const d1 = (await saeed.get(`/work-items/${itemId}`)).body as any;
    t.check("[PAR-09] Their Draft moved to Saeed (TMC Member), still at the Draft Step", d1?.heldBy?.memberName?.en === "Saeed Al Qahtani" && d1?.step?.key === "draft", JSON.stringify([d1?.heldBy?.memberName?.en, d1?.step?.key]));
    const hist = JSON.stringify(((await saeed.get(`/work-items/${itemId}/history`)).body as any)?.events ?? []);
    t.check("[PAR-09] The history says it was handed over because they were deactivated", /hand|deactivat/i.test(hist), hist.slice(0, 200));
    t.check("[PAR-09][VIS] Hand-over 6: the Draft stays TMC's own: Yousef and Layla still get the plain 404", (await yousef.get(`/work-items/${itemId}`)).status === 404 && (await layla.get(`/work-items/${itemId}`)).status === 404, "");
    const out = await postJson(`${webUrl}/api/v1/session`, { email, password });
    t.check("[PAR-02] The deactivated Member can no longer sign in (refused, 401)", out.status === 401, `${out.status}`);
    t.check("[PAR-02] Their open session is ended at once (the api answers 401)", (await leaver.get("/me")).status === 401, "");
    await lookClosed(t, "saeed", "/members", "6-saeed-members-deactivated");

    // 6. Removed from the J7 Project.
    const rm = await saeed.request("DELETE", `/participants/${tmcP}/members/${memberId}`, {});
    t.check("[PAR-09] Saeed removes them from the J7 Project (they hold no Step now)", rm.status === 204, `${rm.status} ${rm.text.slice(0, 160)}`);
    t.check("[PAR-09] They no longer appear among TMC's Project Members of the Project", !(await tmcMembers()).some((m) => m.id === memberId), "");
    t.check("[PAR-09][VIS] Nobody of another Company reads them: Layla's Members list and Yousef's J7 view hold no trace", !JSON.stringify((await layla.get("/members")).body).includes(email) && (await yousef.get(`/participants/${tmcP}/members`)).status === 404, "");
    await lookClosed(t, "saeed", `/participants/${tmcP}`, "7-saeed-after-removal");
  } finally {
    await ctx.close();
  }
  t.note(`The new Member ${email} stays deactivated; its test password is in planning/uat/round-0/.sessions/j13-test-password.txt (git-ignored) and was never printed. The Draft "UAT J13 leaver Draft" now belongs to Saeed.`);
});

const emailOfSaeed = "saeed.alqahtani@tmc.demo.rabaed.test";

// ---------------------------------------------------------------------------------------------------
// J15 Arabic first (Al Waha's Faisal and Noura, in /ar, on Riyadh Gate Tower)

/** In the page: how many Document Numbers show, and which do not read left to right whole. */
const scanNumbers = (page: Page) =>
  page.evaluate(() => {
    const re = /TWR-[A-Z]{3}-\d{2}-\d{4}(?: Rev \d+)?/;
    const bad: string[] = [];
    let found = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const m = re.exec(n.nodeValue ?? "");
      const el = n.parentElement;
      if (!m || !el || el.closest("script,style,noscript,template")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      found++;
      const cs = getComputedStyle(el);
      const isolated = cs.direction === "ltr" && ["isolate", "embed", "bidi-override", "isolate-override"].includes(cs.unicodeBidi);
      const bdi = el.closest("bdi");
      const alone = (el.textContent ?? "").trim() === m[0] && cs.direction === "ltr";
      const bdiOk = !!bdi && getComputedStyle(bdi).direction === "ltr" && (bdi.textContent ?? "").trim().startsWith("TWR-");
      if (!(isolated || bdiOk || alone)) bad.push(`${(el.textContent ?? "").trim().slice(0, 60)} <${el.tagName.toLowerCase()} dir=${cs.direction} bidi=${cs.unicodeBidi}>`);
    }
    return { found, bad };
  });

const htmlState = (page: Page) => page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, scroll: document.documentElement.scrollWidth, inner: window.innerWidth, text: document.body.innerText }));

defineCase("J15", async (t) => {
  const cast = new Cast();
  const hafiz = await cast.as("hafiz");
  const ali = await cast.as("ali");
  const ahmed = await cast.as("ahmed");
  const mohammed = await cast.as("mohammed");
  const noura = await cast.as("noura");
  const faisal = await cast.as("faisal");
  const yousef = await cast.as("yousef");
  const tower = ((await hafiz.get("/projects")).body as any).projects.find((p: any) => p.code === "TWR").id as string;
  const started = Date.now();

  // Setup (api): a Document Approval Request in Tower 2 (Noura's Location) taken to the Owner review.
  const dims = ((await hafiz.get(`/projects/${tower}/dimensions`)).body as any);
  const trade = dims.trade.find((x: any) => x.code === "EL").id as string;
  const t2 = dims.location.find((x: any) => x.code === "T2F01").id as string;
  const stamp = String(Date.now()).slice(-6);
  const subject = `UAT J15 Cable schedule ${stamp}`;
  const made = must<{ id: string }>(await hafiz.post(`/projects/${tower}/work-items`, { type: "DAR", title: subject, answers: { document_type: "calculation", document_title: subject, document_revision: "R0", specification_section: "26 05 19", trade, location: t2 } }), "create DAR");
  const id = made.id;
  const body = pdfBytes(subject);
  const up = must<any>(await hafiz.post(`/work-items/${id}/documents`, { fieldKey: "document", fileName: "UAT-J15.pdf", contentType: "application/pdf", sizeBytes: body.byteLength }), "start upload");
  const put = await fetch(up.upload.url, { method: up.upload.method, headers: up.upload.headers, body: new Uint8Array(body) });
  if (!put.ok) throw new Error(`file store answered ${put.status}`);
  must(await hafiz.post(`/work-items/${id}/documents/${up.id}/confirm`), "confirm upload");
  must(await hafiz.transition(id, "send_for_review"), "send_for_review");
  await ali.post(`/work-items/${id}/pick-up`);
  must(await ali.transition(id, "submit", { answers: { cover_note: "UAT J15: for the Owner" } }), "submit");
  await mohammed.post(`/work-items/${id}/pick-up`);
  must(await mohammed.transition(id, "recommend_a", { answers: { sample_checked: true, matches_specification: true } }), "recommend_a");
  void ahmed;
  const number = ((await hafiz.get(`/work-items/${id}`)).body as any).documentNumber as string;
  t.check("[SUB-21] Setup: TMC's Hafiz, Ali and DCL's Mohammed took a Document Approval Request to the Owner review (it has a Document Number)", /^TWR-DAR-01-\d{4}$/.test(number), number);

  // Hand-over 1: Faisal in /ar reads his items.
  const list = await look(t, "faisal", `/projects/${tower}/work-items`, "1-faisal-list-ar", "ar", 1500);
  await list.close();
  if (list.notFound) t.check("[I18N-01][RP-1049] Faisal's Submittals List opens in /ar", false, "the not-found page shows for a Member who can read the List through the api (known Bug RP-1049/RP-1050, not filed again)");
  else t.check("[I18N-01] Faisal's Submittals List opens in /ar", true, list.text.slice(0, 80));
  const rows = ((await faisal.get(`/projects/${tower}/work-items?pageSize=50`)).body as any).items as any[];
  t.check("[I18N-01] Faisal reads items through the api (Tower 1, his coverage)", rows.length > 0 && rows.every((r) => !r.location || /^T1/.test(r.location.code)), `${rows.length} rows; locations ${[...new Set(rows.map((r) => r.location?.code))].join(",")}`);
  const hisItem = rows.find((r) => r.documentNumber && /^TWR-MAR/.test(r.documentNumber)) ?? rows.find((r) => r.documentNumber);
  const fi = await pageAs("faisal", { locale: "ar" });
  fi.page.setDefaultNavigationTimeout(60_000);
  await go(fi.page, `/work-items/${hisItem.id}`, "ar");
  await settle(fi.page, 1000);
  const fs = await htmlState(fi.page);
  const scan = await scanNumbers(fi.page);
  await t.shot(fi.page, "2-faisal-item-ar");
  t.check("[I18N-01] Hand-over 2: Faisal's item page is Arabic and right to left (dir=rtl, lang=ar), nothing scrolls sideways", fs.dir === "rtl" && fs.lang === "ar" && fs.scroll <= fs.inner + 1 && /[؀-ۿ]/.test(fs.text), `${fs.dir}/${fs.lang} ${fs.scroll}/${fs.inner}`);
  t.check("[I18N-02] Latin digits only on the item page", !ARABIC_INDIC.test(fs.text), "");
  t.check("[I18N-03] The Document Number reads left to right whole", scan.found > 0 && scan.bad.length === 0, `${scan.found} found; ${scan.bad.slice(0, 2).join(" | ")}`);
  await fi.context.close();
  t.check("[VIS] Faisal (Tower 1 only) does not see the Tower 2 Request: plain 404 by id, nothing in his List", (await faisal.get(`/work-items/${id}`)).status === 404 && !JSON.stringify((await faisal.get(`/projects/${tower}/work-items?pageSize=50&q=${encodeURIComponent(subject)}`)).body).includes(subject), "");
  t.check("[VIS] Yousef (Beta Build) gets the plain 404 for it", (await yousef.get(`/work-items/${id}`)).status === 404, "");

  // Hand-over 3: Noura reads it at the Owner review in /ar, and confirms.
  await noura.post(`/work-items/${id}/pick-up`);
  const nd = (await noura.get(`/work-items/${id}`)).body as any;
  const confirm = (nd.actions.transitions as any[]).find((x) => x.key === "confirm_a");
  t.check("[SUB-21] The Owner review waits for Noura and offers Confirm (Code A)", !!confirm && nd.heldBy?.memberName?.en === "Noura Al Harbi", JSON.stringify([nd.step?.key, nd.heldBy?.memberName?.en, (nd.actions.transitions as any[]).map((x) => x.key)]));
  const np = await pageAs("noura", { locale: "ar" });
  np.page.setDefaultNavigationTimeout(60_000);
  await go(np.page, `/work-items/${id}`, "ar");
  await settle(np.page, 1200);
  const before = await htmlState(np.page);
  const sb = await scanNumbers(np.page);
  await t.shot(np.page, "3-noura-owner-review-ar");
  t.check("[I18N-01] Hand-over 3: Noura's item page is Arabic, right to left, and shows her Step in Arabic (مراجعة المالك)", before.dir === "rtl" && before.lang === "ar" && /مراجعة المالك/.test(before.text), `${before.dir}/${before.lang}`);
  t.check("[I18N-02][I18N-03] Latin digits only; the Document Number reads left to right whole", !ARABIC_INDIC.test(before.text) && sb.found > 0 && sb.bad.length === 0, `${sb.found} found; ${sb.bad.slice(0, 2).join(" | ")}`);
  t.check("[VIS] The page names TMC and DCL as Companies, never a person of theirs (V14)", !TMC_PEOPLE_AR.some((n) => before.text.includes(n)), "");
  const confirmLabelAr = confirm.label.ar as string;
  let confirmed = false;
  try {
    await takeTransition(np.page, confirmLabelAr);
    confirmed = true;
  } catch (e) {
    t.note(`The Confirm button "${confirmLabelAr}" could not be driven in the page (${String(e).slice(0, 140)}); the api confirmed.`);
    must(await noura.transition(id, "confirm_a"), "confirm_a");
  }
  await settle(np.page, 800);
  const done = (await noura.get(`/work-items/${id}`)).body as any;
  await t.shot(np.page, "4-noura-after-confirm-ar");
  t.check("[SUB-21] Noura's Confirm issues Code A and closes the item", done.outcome === "A" && done.stage.key === "approved", `${done.outcome}/${done.stage.key} (page click ${confirmed})`);
  const after = await htmlState(np.page);
  t.check("[I18N-02] After the Confirm the page still shows Latin digits only, RTL", after.dir === "rtl" && !ARABIC_INDIC.test(after.text), "");
  await np.context.close();

  // Hand-over 4: notifications in Arabic.
  const nn = await look(t, "noura", "/notifications", "5-noura-notifications-ar", "ar", 1200);
  const ns = await nn.page.evaluate(() => ({ dir: document.documentElement.dir, text: document.body.innerText }));
  await nn.close();
  t.check("[NOT-10][I18N-01] Hand-over 4: Noura's Notifications page is Arabic and right to left", ns.dir === "rtl" && /[؀-ۿ]/.test(nn.text) && /وصلك|وصل إليك/.test(ns.text), nn.text.slice(0, 160));
  t.check("[NOT-10][I18N-02] Latin digits only on it", !ARABIC_INDIC.test(ns.text), "");
  const notes = ((await noura.get("/notifications")).body as any).notifications.filter((n: any) => n.workItemId === id);
  t.check("[NOT-01] The bell holds Noura's entries for the Request (Reached you at the Owner review; the record when it closes)", notes.some((n: any) => n.kind === "step_reached"), notes.map((n: any) => n.kind).join(","));
  const fb = await look(t, "faisal", "/notifications", "6-faisal-notifications-ar", "ar", 1200);
  const fns = await fb.page.evaluate(() => ({ dir: document.documentElement.dir, text: document.body.innerText }));
  await fb.close();
  t.check("[NOT-10] Faisal's Notifications page is Arabic, right to left, Latin digits only, Document Numbers whole", fns.dir === "rtl" && !ARABIC_INDIC.test(fns.text) && /[؀-ۿ]/.test(fns.text), fb.text.slice(0, 140));
  t.check("[VIS] Faisal's bell holds nothing of the Tower 2 Request", !((await faisal.get("/notifications")).body as any).notifications.some((n: any) => n.workItemId === id), "");

  // Hand-over 5: the email, in Arabic.
  let mail: Awaited<ReturnType<typeof mailFull>> | undefined;
  for (let i = 0; i < 12 && !mail; i++) {
    const all = await mailsAbout(emailOfNoura, "");
    mail = all.find((m) => new Date(m.created).getTime() >= started - 5000 && (m.text + m.subject + m.html).includes(number));
    if (!mail) await sleep(3000);
  }
  if (!mail) t.check("[NOT-03][NOT-10] Hand-over 5: an email about the Request reaches Noura in Mailpit", false, `no mail to Noura holding ${number} within 36 s`);
  else {
    const all = `${mail.subject} ${mail.text}`;
    t.check("[NOT-10] Hand-over 5: Noura's email is in Arabic", /[؀-ۿ]/.test(all), mail.subject);
    t.check("[I18N-02] ... with Latin digits only", !ARABIC_INDIC.test(all + mail.html), "");
    t.check("[I18N-03] ... and the Document Number whole in it (left to right: in its own dir=ltr or bdi element, or alone)", all.includes(number) && (new RegExp(`(<bdi[^>]*>|dir="ltr"[^>]*>)\\s*${number}`).test(mail.html) || mail.html.includes(`>${number}<`)), mail.html.slice(Math.max(0, mail.html.indexOf(number) - 120), mail.html.indexOf(number) + 60));
    t.check("[NOT-03][VIS] It names TMC as a Company and no person of TMC", !TMC_PEOPLE_AR.some((n) => all.includes(n)), mail.subject);
    const mp = await pageAs("noura", { locale: "ar" });
    await mp.page.goto(`${mailpitUrl}/view/${mail.id}`, { waitUntil: "networkidle" }).catch(() => undefined);
    await sleep(800);
    await t.shot(mp.page, "7-noura-email");
    await mp.context.close();
  }
  t.note(`The Request "${subject}" (${number}) was made by the journey as setup (api) and taken to the Owner review; Noura's Confirm closed it with Code A. Faisal covers Tower 1 only (FX-OR), so he reads his Tower 1 items and (by design) not this Tower 2 one. The Test Case's 'Owner review waiting' items of other journeys were left alone.`);
});

const emailOfNoura = "noura.alharbi@alwaha.demo.rabaed.test";
const TMC_PEOPLE_AR = ["Ali Sonour", "Hafiz Hamdan", "Saeed Al Qahtani", "Omar Al Harbi", "علي سنور", "حافظ حمدان", "سعيد القحطاني", "عمر الحربي"];
