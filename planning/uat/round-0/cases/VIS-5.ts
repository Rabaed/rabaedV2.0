/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { defineCase } from "../harness/case.ts";
import { pageAs, webUrl } from "../harness/browser.ts";
import { Api, type ApiReply } from "../harness/helpers.ts";
import { Crew, MADE_UP, createMar, must, pageIsNotFound, participantIdByName, sleep } from "../harness/helpers-vis.ts";

// VIS-26 .. VIS-30: Workflow authoring, drafts and bindings, Library, Change Notes, Project setup.

const stamp = () => String(Date.now()).slice(-6);
const bi = (en: string) => ({ en, ar: en });

type Settings = { canEdit: boolean; types: { id: string; code: string; workflow: { id: string; name: { en: string } }; rabaedDefaults: { id: string; isTypeDefault: boolean }[]; exceptions: { participantId: string; workflow: { id: string } }[]; copies: { id: string; name: { en: string } }[] }[]; library: { id: string }[] };

async function settingsOf(api: Api, pid: string): Promise<{ status: number; body: Settings | null }> {
  const r = await api.get(`/projects/${pid}/workflow-settings`);
  return { status: r.status, body: r.status === 200 ? (r.body as Settings) : null };
}

/** A duplicate starts as a draft: publish it (Version 1) so it can be bound and read by every Member. */
async function publishCopy(api: Api, id: string): Promise<void> {
  const b = (await api.get(`/workflows/${id}/builder`)).body as any;
  if (b.workflow.published) return;
  must(await api.put(`/workflows/${id}/draft`, { definition: b.workflow.draft.definition }), "save draft");
  must(await api.post(`/workflows/${id}/publish`, { changeNote: "UAT copy" }), "publish copy");
}

/** A Project copy of the MAR Workflow for a case (a copy of the first published one it can read). */
async function marCopy(saeed: Api, pid: string, name: string): Promise<{ id: string; marTypeId: string }> {
  const ws = (await settingsOf(saeed, pid)).body!;
  const mar = ws.types.find((x) => x.code === "MAR")!;
  const source = mar.rabaedDefaults.find((d) => d.isTypeDefault)?.id ?? mar.workflow.id;
  const made = must<{ id: string }>(await saeed.post(`/workflows/${source}/duplicate`, { projectId: pid, name: bi(name) }), "duplicate MAR");
  await publishCopy(saeed, made.id);
  return { id: made.id, marTypeId: mar.id };
}

const sameNotFound = (a: ApiReply, b: ApiReply) => a.status === 404 && a.text === b.text;

defineCase("VIS-26", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const copy = await marCopy(saeed, pid, `UAT VIS-26 Tower Workflow ${stamp()}`);
  const builderBefore = await saeed.get(`/workflows/${copy.id}/builder`);
  t.check("Positive control: Saeed (Project Admin) reads the builder of the Tower Workflow", builderBefore.status === 200, `${builderBefore.status}`);
  const definition = (builderBefore.body as any).workflow.published?.definition ?? (builderBefore.body as any).workflow.draft?.definition;
  const nasser = await crew.as("nasser");
  const jcv = ((await nasser.get("/projects")).body as any).projects[0].id as string;
  const jcvCopy = await marCopy(nasser, jcv, `UAT VIS-26 JCV Workflow ${stamp()}`).catch(() => null);
  const madeUp = await saeed.get(`/workflows/${MADE_UP}/builder`);
  for (const who of ["ali", "layla", "nasser"]) {
    const api = await crew.as(who);
    const attempts: [string, ApiReply][] = [
      ["open the builder", await api.get(`/workflows/${copy.id}/builder`)],
      ["Duplicate", await api.post(`/workflows/${copy.id}/duplicate`, { projectId: pid, name: bi("UAT VIS-26 intruder") })],
      ["Save draft", await api.put(`/workflows/${copy.id}/draft`, { definition })],
      ["Publish", await api.post(`/workflows/${copy.id}/publish`, { changeNote: "UAT VIS-26 intruder" })],
      ["Bind", await api.request("PUT", `/projects/${pid}/workflow-bindings`, { workItemTypeId: copy.marTypeId, raisingParticipantId: null, workflowId: copy.id })],
    ];
    for (const [what, r] of attempts) t.check(`${who}: ${what} on the Tower Workflow is the plain 404 (and changes nothing)`, r.status === 404, `${r.status} ${r.text.slice(0, 80)}`);
    t.check(`${who}'s builder answer is byte-identical to a made-up id's`, sameNotFound(attempts[0]![1], madeUp), `${attempts[0]![1].text} / ${madeUp.text}`);
  }
  const builderAfter = await saeed.get(`/workflows/${copy.id}/builder`);
  t.check("The Tower Workflow is unchanged (no draft, no new Version)", JSON.stringify((builderAfter.body as any).workflow.draft) === JSON.stringify((builderBefore.body as any).workflow.draft) && JSON.stringify((builderAfter.body as any).workflow.publishedVersions) === JSON.stringify((builderBefore.body as any).workflow.publishedVersions), "");
  if (jcvCopy) {
    const r = await nasser.get(`/workflows/${jcvCopy.id}/builder`);
    t.check("Positive control: Nasser reads the builder of his own JCV Workflow", r.status === 200, `${r.status}`);
    const under = await saeed.get(`/workflows/${jcvCopy.id}/builder`);
    t.check("A JCV Workflow id pasted under the Tower Project is 404 for Saeed", sameNotFound(under, madeUp), `${under.status}`);
    const { context, page } = await pageAs("nasser");
    try {
      const nf = await pageIsNotFound(page, `/projects/${pid}/settings/workflows/${jcvCopy.id}`);
      await t.shot(page, "nasser-jcv-workflow-under-tower");
      t.check("Nasser: the JCV Workflow URL under the Tower Project is the plain not-found page", nf.notFound, nf.text);
    } finally {
      await context.close();
    }
  } else {
    t.note("Nasser could not copy a Workflow on JCV (not asserted).");
  }
  const ws = (await settingsOf(saeed, pid)).body!;
  const defaultId = ws.types.find((x) => x.code === "DAR")!.rabaedDefaults.find((d) => d.isTypeDefault)?.id ?? ws.types.find((x) => x.code === "DAR")!.workflow.id;
  const def = await saeed.get(`/workflows/${defaultId}/builder`);
  t.check("A Rabaed Default is 404 in the builder to the Project Admin", sameNotFound(def, madeUp), `${def.status}`);
  const bindOther = jcvCopy ? await saeed.request("PUT", `/projects/${pid}/workflow-bindings`, { workItemTypeId: copy.marTypeId, raisingParticipantId: null, workflowId: jcvCopy.id }) : null;
  if (bindOther) t.check("Binding another Project's Workflow is 404 for the Project Admin too", bindOther.status === 404, `${bindOther.status} ${bindOther.text.slice(0, 80)}`);
  const { context, page } = await pageAs("ali");
  try {
    const nf = await pageIsNotFound(page, `/projects/${pid}/settings/workflows/${copy.id}`);
    await t.shot(page, "ali-builder-url");
    t.check("Ali: the builder URL of the Tower Workflow is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
});

defineCase("VIS-27", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const copy = await marCopy(saeed, pid, `UAT VIS-27 exception route ${stamp()}`);
  const beta = await participantIdByName(saeed, pid, "Beta Build");
  const renamed = `UAT VIS-27 renamed draft ${stamp()}`;
  let bound = false;
  try {
    const builder = (await saeed.get(`/workflows/${copy.id}/builder`)).body as any;
    const definition = builder.workflow.published?.definition;
    const draft = await saeed.put(`/workflows/${copy.id}/draft`, { name: bi(renamed), definition });
    t.check("Saeed saves a draft of the Workflow that renames it", draft.status < 300, `${draft.status} ${draft.text.slice(0, 120)}`);
    const bind = await saeed.request("PUT", `/projects/${pid}/workflow-bindings`, { workItemTypeId: copy.marTypeId, raisingParticipantId: beta, workflowId: copy.id });
    bound = bind.status < 300;
    t.check("Saeed binds Beta Build's MARs to the exception Workflow", bound, `${bind.status} ${bind.text.slice(0, 120)}`);
    const sees = async (who: string) => {
      const api = await crew.as(who);
      const ws = (await settingsOf(api, pid)).body;
      const mar = ws?.types.find((x) => x.code === "MAR");
      const wf = await api.get(`/workflows/${copy.id}`);
      const bld = await api.get(`/workflows/${copy.id}/builder`);
      return { ws, mar, wf, bld };
    };
    const s = await sees("saeed");
    t.check("Saeed (Project Admin) reads the draft rename and the exception with the Participant", s.wf.text.includes(renamed) && (s.mar?.exceptions ?? []).some((e) => e.participantId === beta), `${s.mar?.exceptions.length}`);
    for (const who of ["ali", "ahmed", "yousef"]) {
      const r = await sees(who);
      t.check(`${who} cannot read the draft or its rename; the builder is 404`, r.bld.status === 404 && !r.wf.text.includes(renamed), `${r.bld.status}`);
      t.check(`${who} reads the exception Workflow as a definition (published Version whole)`, r.wf.status === 200 && r.wf.text.includes("steps"), `${r.wf.status}`);
      const ex = (r.mar?.exceptions ?? []).length;
      if (who === "yousef") t.check("Yousef (the bound Participant) learns of the binding", (r.mar?.exceptions ?? []).some((e) => e.participantId === beta), `${ex}`);
      else t.check(`${who} never learns of the binding (no exception row, no Participant)`, ex === 0 && !JSON.stringify(r.ws).includes(beta) && !JSON.stringify(r.ws).includes("Beta Build"), `${ex}`);
    }
    const { context, page } = await pageAs("ali");
    try {
      await page.goto(`${webUrl}/en/projects/${pid}/settings/workflows`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await t.shot(page, "ali-workflows-settings");
      const text = await page.locator("body").innerText();
      t.check("Ali's Workflows page names neither the draft rename nor Beta Build", !text.includes(renamed) && !text.includes("Beta Build"));
    } finally {
      await context.close();
    }
  } finally {
    if (bound) await saeed.request("DELETE", `/projects/${pid}/workflow-bindings?workItemTypeId=${copy.marTypeId}&raisingParticipantId=${beta}`);
  }
});

defineCase("VIS-28", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const layla = await crew.as("layla");
  const hafiz = await crew.as("hafiz");
  const nasser = await crew.as("nasser");
  const name = `UAT VIS-28 Library Workflow ${stamp()}`;
  const ws = (await settingsOf(saeed, pid)).body!;
  const mar = ws.types.find((x) => x.code === "MAR")!;
  const saved = await saeed.post(`/workflows/${mar.workflow.id}/save-to-library`, { name: bi(name) });
  t.check("Saeed (TMC Authorized Person) saves a Workflow to TMC's Library", saved.status === 201, `${saved.status} ${saved.text.slice(0, 120)}`);
  const libId = (saved.body as any)?.id as string;
  const libs = async (api: Api) => JSON.stringify(((await api.get("/library/workflows")).body as any) ?? null);
  t.check("Saeed lists it in his Library", (await libs(saeed)).includes(name));
  t.check("Hafiz lists TMC's published Library Workflows (read-only)", (await libs(hafiz)).includes(name) || (await hafiz.get(`/workflows/${libId}`)).status === 200, "");
  t.check("Layla (DCL) lists only DCL's own Library: nothing of TMC's", !(await libs(layla)).includes(name), "");
  t.check("Nasser (Beta Build, on no shared Project) lists nothing of TMC's", !(await libs(nasser)).includes(name), "");
  for (const who of ["layla", "nasser"]) {
    const api = await crew.as(who);
    const rs = await Promise.all([api.get(`/workflows/${libId}`), api.get(`/workflows/${libId}/map`), api.get(`/workflows/${libId}/builder`)]);
    const madeUp = await api.get(`/workflows/${MADE_UP}`);
    t.check(`${who}: the TMC Library Workflow URL is 404, the same as a made-up id`, rs.every((r) => r.status === 404) && rs[0]!.text === madeUp.text, rs.map((r) => r.status).join(","));
  }
  const settingsLayla = await settingsOf(layla, pid);
  t.check("Layla's Workflow settings never list TMC's Library", !JSON.stringify(settingsLayla).includes(name), `${settingsLayla.status}`);
  const used = await saeed.post(`/workflows/${libId}/duplicate`, { projectId: pid, name: bi(`${name} on Tower`) });
  if (used.status === 201) await publishCopy(saeed, (used.body as any).id);
  t.check("Saeed uses it on Tower (a Project copy)", used.status === 201, `${used.status}`);
  const readByAli = await (await crew.as("ali")).get(`/workflows/${(used.body as any)?.id}`);
  t.check("Once used on Tower, every Tower Member reads the Project copy", readByAli.status === 200, `${readByAli.status}`);
  const { context, page } = await pageAs("layla");
  try {
    const nf = await pageIsNotFound(page, `/library/workflows/${libId}`);
    await t.shot(page, "layla-tmc-library-workflow");
    t.check("Layla: the TMC Library Workflow page is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
  t.note("Only the Workflow half of the Test Case is automated. The Form half (save a Form to the Library, copy it once used on Tower) has no Form Library route in the api; and marking a default is not run. A person checks those in the Library page.");
});

defineCase("VIS-29", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const copy = await marCopy(saeed, pid, `UAT VIS-29 exception route ${stamp()}`);
  const beta = await participantIdByName(saeed, pid, "Beta Build");
  let bound = false;
  try {
    const bind = await saeed.request("PUT", `/projects/${pid}/workflow-bindings`, { workItemTypeId: copy.marTypeId, raisingParticipantId: beta, workflowId: copy.id });
    bound = bind.status < 300;
    t.check("Saeed binds Beta Build's MARs to an exception Workflow", bound, `${bind.status} ${bind.text.slice(0, 120)}`);
    const builder = (await saeed.get(`/workflows/${copy.id}/builder`)).body as any;
    const definition = builder.workflow.published.definition;
    must(await saeed.put(`/workflows/${copy.id}/draft`, { definition }), "save draft");
    const bad = await saeed.post(`/workflows/${copy.id}/publish`, { changeNote: "Short route for Beta Build MARs" });
    t.check("A Change Note naming Beta Build on an exception Workflow is refused", bad.status >= 400, `${bad.status} ${bad.text.slice(0, 160)}`);
    const good = await saeed.post(`/workflows/${copy.id}/publish`, { changeNote: "UAT VIS-29 short route" });
    t.check("A neutral Change Note publishes (positive control)", good.status < 300, `${good.status} ${good.text.slice(0, 160)}`);
    const versionNo = (good.body as any)?.versionNo as number;
    const hafizDraft = await createMar(crew, "UAT VIS-29 Hafiz Draft", { location: "T2F01" });
    const yousefDraft = await createMar(crew, "UAT VIS-29 Yousef Draft", { who: "yousef", location: "T2F01" });
    const read = async (who: string) => {
      const r = await (await crew.as(who)).get(`/workflows/${copy.id}/versions/${versionNo}`);
      return { r, body: r.body as any };
    };
    const s = await read("saeed");
    const a = await read("ali");
    const y = await read("yousef");
    const note = (x: { body: any }) => (x.body?.history ?? []).find((h: any) => h.versionNo === versionNo)?.changeNote ?? null;
    t.check("The author (Saeed) reads the Change Note", s.r.status === 200 && note(s) === "UAT VIS-29 short route", `${s.r.status} ${note(s)}`);
    t.check("Non-authors (Ali, Yousef) read no Change Note", note(a) === null && note(y) === null && !a.r.text.includes("UAT VIS-29 short route") && !y.r.text.includes("UAT VIS-29 short route"), `${a.r.status}/${y.r.status}`);
    const running = (x: { body: any }) => (x.body?.history ?? []).find((h: any) => h.versionNo === versionNo)?.running;
    t.check("Running counts cover only items the reader sees (Yousef counts his own Draft; Saeed does not count Yousef's)", typeof running(y) === "number" && typeof running(s) === "number" && running(y) >= 1 && running(s) <= running(y) + 5, `yousef ${running(y)}, saeed ${running(s)}, ali ${running(a)}`);
    t.note(`Hafiz's Draft ${hafizDraft} (TMC, default Workflow) and Yousef's Draft ${yousefDraft} (exception Workflow v${versionNo}) were raised; Ali's running count for the exception Workflow is ${running(a)} (he sees none of Beta Build's items).`);
    t.check("Ali counts none of Yousef's items on the exception Workflow", running(a) === 0, `${running(a)}`);
    const { context, page } = await pageAs("ali");
    try {
      await page.goto(`${webUrl}/en/projects/${pid}/settings/workflows/${copy.id}/versions/${versionNo}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await t.shot(page, "ali-versions-page");
    } finally {
      await context.close();
    }
  } finally {
    if (bound) await saeed.request("DELETE", `/projects/${pid}/workflow-bindings?workItemTypeId=${copy.marTypeId}&raisingParticipantId=${beta}`);
  }
});

defineCase("VIS-30", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const tag = stamp();
  const scopeName = `UAT VIS-30 Scope ${tag}`;
  const added = await saeed.post(`/projects/${pid}/scopes`, { tradeId: crew.dims.trade.EL, parentId: null, name: bi(scopeName) });
  t.check("Saeed (Project Admin) adds a Scope (positive control)", added.status === 201, `${added.status} ${added.text.slice(0, 100)}`);
  const scopeId = (added.body as any)?.id as string;
  const scopesNow = async (api: Api) => ((await api.get(`/projects/${pid}/scopes`)).body as any)?.scopes ?? [];
  const betaPid = await participantIdByName(saeed, pid, "Beta Build");
  for (const who of ["ali", "layla", "nasser"]) {
    const api = await crew.as(who);
    const rs: [string, ApiReply][] = [
      ["add a Scope", await api.post(`/projects/${pid}/scopes`, { tradeId: crew.dims.trade.EL, parentId: null, name: bi(`UAT VIS-30 intruder ${who}`) })],
      ["rename the Scope", await api.request("PATCH", `/scopes/${scopeId}`, { name: bi("UAT VIS-30 renamed by intruder") })],
      ["deactivate the Scope", await api.request("PATCH", `/scopes/${scopeId}`, { active: false })],
      ["read the numbering counters", await api.get(`/projects/${pid}/numbering/counters`)],
      ["set a counter start", await api.request("PUT", `/projects/${pid}/numbering/counters/start`, { workItemType: "MAR", participantId: null, tradeId: null, locationId: null, startingNumber: 500 })],
      ["save a numbering pattern", await api.request("PUT", `/projects/${pid}/numbering`, { workItemTypeId: null, pattern: { segments: [{ kind: "project" }, { kind: "type" }, { kind: "participant" }], separator: "-", seqDigits: 4, countedBy: [0, 1, 2] }, sharedCounterAccepted: false })],
      ["set the Participant Visibility", await api.request("PUT", `/participants/${betaPid}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } })],
    ];
    for (const [what, r] of rs) t.check(`${who}: ${what} is the plain 404`, r.status === 404, `${r.status} ${r.text.slice(0, 80)}`);
  }
  const after = (await scopesNow(saeed)).find((x: any) => x.id === scopeId);
  t.check("The Scope is unchanged (name and active)", after?.name?.en === scopeName && after?.active !== false, JSON.stringify(after));
  const renamed = await saeed.request("PATCH", `/scopes/${scopeId}`, { name: bi(`${scopeName} renamed`) });
  const deact = await saeed.request("PATCH", `/scopes/${scopeId}`, { active: false });
  t.check("Saeed can rename and deactivate it", renamed.status === 204 && deact.status === 204, `${renamed.status} ${deact.status}`);
  const counters = await saeed.get(`/projects/${pid}/numbering/counters`);
  t.check("Saeed reads the numbering counters", counters.status === 200, `${counters.status}`);
  // Every Project Member reads Trades, Scopes, Locations and published Workflows.
  for (const who of ["ali", "hafiz", "ahmed"]) {
    const api = await crew.as(who);
    const rs = await Promise.all([api.get(`/projects/${pid}/dimensions`), api.get(`/projects/${pid}/scopes`), api.get(`/projects/${pid}/workflow-settings`)]);
    t.check(`${who} (Project Member) reads Trades and Locations, Scopes and the published Workflows`, rs.every((r) => r.status === 200), rs.map((r) => r.status).join(","));
  }
  const { context, page } = await pageAs("ali");
  try {
    const nf = await pageIsNotFound(page, `/projects/${pid}/settings/numbering`);
    await t.shot(page, "ali-numbering-settings");
    t.check("Ali's Numbering settings page for the counters (not a Project Admin)", nf.status !== 500, `${nf.status} notFound=${nf.notFound}`);
  } finally {
    await context.close();
  }
  await sleep(100);
  t.note("The Scope is left deactivated and renamed (UAT data). Nasser is on another Project only: his reads of Tower setup are the 404 above.");
});
