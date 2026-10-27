/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { defineCase } from "../harness/case.ts";
import { pageAs, webUrl } from "../harness/browser.ts";
import { Api } from "../harness/helpers.ts";
import {
  Crew, MADE_UP, aliSubmit, closedMar, createMar, detail, listAll, listOf, mohammedCodes, must, pageIsNotFound, rawGet, searchRows, sendForReview, sleep, submittedMar, take, takeOk, leakProbe, leaked, leakSummary,
} from "../harness/helpers-vis.ts";

// VIS-39 .. VIS-45: Document Numbers, Code D, Handover, Home, Export, Members, the Approved Supplier List.

const numberOf = async (api: Api, id: string) => ((await detail(api, id)).body as any).documentNumber as string | null;
const seqOf = (n: string | null) => (n ? Number(/-(\d+)(?: Rev \d+)?$/.exec(n)?.[1]) : NaN);
const seriesOf = (n: string | null) => (n ? n.replace(/-\d+(?: Rev \d+)?$/, "") : "");

defineCase("VIS-39", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const hafiz = await crew.as("hafiz");
  const yousef = await crew.as("yousef");
  const tag = String(Date.now()).slice(-5);
  const hNums: (string | null)[] = [];
  for (let i = 1; i <= 3; i++) {
    const id = await createMar(crew, `UAT VIS-39 Hafiz ${i} ${tag}`, { location: "T2F01" });
    await sendForReview(crew, id);
    hNums.push(await numberOf(hafiz, id));
  }
  t.check("Hafiz's three MARs are numbered in TMC's series, one after another", hNums.every((n) => !!n) && seqOf(hNums[1]) > seqOf(hNums[0]) && seqOf(hNums[2]) > seqOf(hNums[1]) && new Set(hNums.map(seriesOf)).size === 1, hNums.join(", "));
  const yNums: (string | null)[] = [];
  let yousefBlocked = "";
  for (let i = 1; i <= 3; i++) {
    const id = await createMar(crew, `UAT VIS-39 Yousef ${i} ${tag}`, { who: "yousef", location: "T2F01" });
    const r = await yousef.transition(id, "send_for_review");
    if (r.status >= 300) {
      yousefBlocked = `${r.status} ${r.text.slice(0, 120)}`;
      break;
    }
    yNums.push(await numberOf(yousef, id));
  }
  if (yousefBlocked) {
    t.note(`Yousef's send for review was refused (${yousefBlocked}): Beta Build has no Project Manager to hold the next Step, so Beta Build cannot number items on this Project; the independent counters are compared through Beta Build's Participant series and the Project Admin's counters.`);
  } else {
    t.check("Yousef's three MARs are numbered in Beta Build's own series, a different series from TMC's", yNums.every((n) => !!n) && seriesOf(yNums[0]) !== seriesOf(hNums[0]) && seqOf(yNums[1]) > seqOf(yNums[0]), yNums.join(", "));
    t.check("Beta Build's numbers do not carry TMC's volume (its sequence is far from TMC's)", Math.abs(seqOf(yNums[0]) - seqOf(hNums[0])) > 0 || seriesOf(yNums[0]) !== seriesOf(hNums[0]), `${yNums[0]} vs ${hNums[0]}`);
  }
  // Numbering pages: examples built from their own Participant; counters 404; version history by Company.
  const num = async (who: string) => (await (await crew.as(who)).get(`/projects/${pid}/numbering`)).body as any;
  for (const who of ["hafiz", "yousef", "ahmed"]) {
    const n = await num(who);
    const counters = await (await crew.as(who)).get(`/projects/${pid}/numbering/counters`);
    t.check(`${who}: the example is built from their own Participant with no code and no order number; the counters are 404`, n.example.participant.code === null && n.example.participant.ordinal === null && counters.status === 404, `${JSON.stringify(n.example.participant)} ${counters.status}`);
  }
  const saeed = await crew.as("saeed");
  const sc = await saeed.get(`/projects/${pid}/numbering/counters`);
  t.check("The Project Admin reads the counters (TMC's MAR counter is there; Beta Build has issued none, see the note)", sc.status === 200 && JSON.stringify(sc.body).includes("TWR-MAR-01"), sc.text.slice(0, 160));
  const sv = ((await saeed.get(`/projects/${pid}/numbering`)).body as any).versions;
  const hv = ((await hafiz.get(`/projects/${pid}/numbering`)).body as any).versions;
  t.check("Version history names its saver only to the Project Admin; others read 'A Project Admin'", sv.every((v: any) => !v.savedBy.company || true) && hv.every((v: any) => !JSON.stringify(v.savedBy).match(/TMC|Beta|Design/)), JSON.stringify(hv.map((v: any) => v.savedBy)));
  const refused = await saeed.request("PUT", `/projects/${pid}/numbering`, { workItemTypeId: null, pattern: { segments: [{ kind: "project" }, { kind: "type" }], separator: "-", seqDigits: 4, countedBy: [0, 1] }, sharedCounterAccepted: false });
  t.check("A pattern without the Participant Code is refused until the shared-counter warning is accepted", refused.status >= 400, `${refused.status} ${refused.text.slice(0, 160)}`);
  const after = ((await saeed.get(`/projects/${pid}/numbering`)).body as any).versions.length;
  t.check("The refusal saved nothing", after === sv.length, `${sv.length} -> ${after}`);
  const { context, page } = await pageAs("yousef");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/settings/numbering`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "yousef-numbering");
  } finally {
    await context.close();
  }
  t.manual("The part that accepts the shared-counter warning (both Companies then share one count) is not run: it would change the Project's numbering pattern for every other Part running on the same Project. Steps for a person on a clean seed: 1) Saeed saves a pattern without the Participant Code and accepts the warning. 2) Hafiz and Yousef each raise a MAR. Expected: both draw from one count (gaps in each Company's numbers). The refusal, the independent counters, the examples and the 404 counters were proven above.");
});

defineCase("VIS-40", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const subject = `UAT VIS-40 rejected MAR ${String(Date.now()).slice(-5)}`;
  const rejected = await closedMar(crew, subject, { location: "T1F01", code: "D" });
  const hafiz = await crew.as("hafiz");
  const repl = must<{ id: string }>(await hafiz.post(`/work-items/${rejected}/replacements`, { idempotencyKey: crypto.randomUUID() }), "create replacement").id;
  t.check("Hafiz creates the replacement and keeps it Draft", ((await detail(hafiz, repl)).body as any).documentNumber === null);
  for (const who of ["mohammed", "faisal"]) {
    const api = await crew.as(who);
    const links = await api.get(`/work-items/${rejected}/links`);
    const from = await api.get(`/work-items/${rejected}/linked-from`);
    t.check(`${who}: the rejected MAR's Links and Linked from do not name the Draft replacement`, !links.text.includes(repl) && !from.text.includes(repl) && ((from.body as any)?.items ?? []).length === 0, `${from.text.slice(0, 100)}`);
    const probes = await leakProbe(api, pid, repl, "NO-SUCH-SUBJECT");
    t.check(`${who}: nothing of the Draft replacement in any channel; its URL is 404`, leaked(probes).length === 0, leakSummary(probes));
    const hist = await api.get(`/work-items/${rejected}/history`);
    t.check(`${who}: the rejected MAR's history shows no replacement`, !/replace/i.test(hist.text), "");
  }
  await sendForReview(crew, repl);
  const replNumber = await numberOf(hafiz, repl);
  await aliSubmit(crew, repl);
  t.check("The replacement takes a new Document Number at its first send (no Rev)", !!replNumber && !/Rev/.test(replNumber) && replNumber !== (await numberOf(hafiz, rejected)), `${replNumber} vs ${await numberOf(hafiz, rejected)}`);
  const mohammed = await crew.as("mohammed");
  const from = ((await mohammed.get(`/work-items/${rejected}/linked-from`)).body as any).items as any[];
  t.check("Once Submitted it appears in the rejected MAR's Linked from by number and Subject", from.some((i) => i.documentNumber === replNumber), JSON.stringify(from));
  const links = ((await mohammed.get(`/work-items/${repl}/links`)).body as any).links as any[];
  t.check("The replacement lists the rejected MAR under Links", links.some((l) => l.subject === subject), JSON.stringify(links));
  const { context, page } = await pageAs("mohammed");
  try {
    await page.goto(`${webUrl}/en/work-items/${rejected}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "mohammed-rejected-linked-from");
  } finally {
    await context.close();
  }
  t.note("The UAT Owner PM observer is not covered: FX-OW is not applied.");
});

defineCase("VIS-41", async (t) => {
  t.manual("Not run by script: the Handover list is read by taking Deactivate on a Member, and a refusal that went through would deactivate a seeded Member (Hafiz or Mohammed) for every other Part. Steps for a person on a clean seed: 1) Hafiz holds two Tower 2 MARs at Contractor Engineer; Mohammed holds one at DCL review. 2) Saeed (TMC Authorized Person, not a Project Member) opens Members and Deactivates Hafiz and reads the Handover list. 3) Saeed picks Omar. 4) Saeed tries to Deactivate Mohammed. 5) Layla Deactivates Mohammed. Expected: Saeed lists only TMC Steps and Members; as he sees none of these items, each is 'An item at <Step> on <Project>' with no Subject, Document Number or item id; Omar is the candidate; after the pick Omar sees and edits both. Deactivating Mohammed is 404 for Saeed. For Layla the refusal (Mohammed is the only Manager) names only DCL's own Step and the Project.");
});

defineCase("VIS-42", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const home = async (who: string) => (await (await crew.as(who)).get("/home")).body as any;
  const subject = `UAT VIS-42 TMC item ${String(Date.now()).slice(-5)}`;
  const id = await submittedMar(crew, subject, { location: "T2F01" });
  await createMar(crew, `UAT VIS-42 TMC Draft ${String(Date.now()).slice(-5)}`, { location: "T2F01" });
  await sleep(500);
  const y = await home("yousef");
  const yAll = new Set((await listAll(await crew.as("yousef"), pid, "")).map((r) => r.id));
  const yMods = await Promise.all(["snag_list", "inspections"].map(async (m) => (await listAll(await crew.as("yousef"), pid, "", m)).map((r) => r.id)));
  yMods.flat().forEach((i) => yAll.add(i));
  t.check("Yousef's Home shows 0 of 4+ weeks and 0 waiting with others", y.counts.longAtStep === 0 && y.counts.waitingWithOthers === 0, JSON.stringify(y.counts));
  t.check("Yousef's Home has no row and no activity of TMC (every row is an item he sees)", [...y.needsMyAction, ...y.activity].every((r: any) => yAll.has(r.workItem?.id ?? r.id)) && !JSON.stringify(y).includes(subject), `${y.needsMyAction.length} rows, ${y.activity.length} activity`);
  t.check("TMC appears for Yousef only as the Host Company on the Project card", y.projects.length === 1 && y.projects[0].hostCompany.legalName.en === "TMC Constructions", JSON.stringify(y.projects.map((p: any) => p.hostCompany.legalName.en)));
  t.check("Yousef's Project card Need My Action equals his Home count", y.projects[0].needMyAction === y.counts.needMyAction, `${y.projects[0].needMyAction} / ${y.counts.needMyAction}`);
  const h = await home("hafiz");
  t.check("Hafiz's Drafts never appear in Need My Action", h.needsMyAction.every((r: any) => r.stage?.key !== "draft"), h.needsMyAction.filter((r: any) => r.stage?.key === "draft").length + " drafts");
  t.check("Hafiz's Project card equals his Home count", h.projects[0].needMyAction === h.counts.needMyAction, `${h.projects[0].needMyAction} / ${h.counts.needMyAction}`);
  const hafiz = await crew.as("hafiz");
  const waiting = async () => {
    let n = 0;
    for (const m of ["", "snag_list", "inspections"]) n += (await listAll(hafiz, pid, "raisedByMe=true&heldBy=others", m)).filter((r) => r.stage.key !== "draft").length;
    return n;
  };
  const w = await waiting();
  t.check("Hafiz's 'Waiting with others' counts his own items others hold (not Drafts, closed or Sent Back)", Math.abs(w - h.counts.waitingWithOthers) <= 3 && h.counts.waitingWithOthers > 0, `home ${h.counts.waitingWithOthers}, lists ${w}`);
  for (const who of ["mohammed", "faisal"]) {
    const x = await home(who);
    const api = await crew.as(who);
    let n = 0;
    for (const m of ["", "snag_list", "inspections"]) n += (await listAll(api, pid, "raisedByMe=true&heldBy=others", m)).filter((r) => r.stage.key !== "draft").length;
    const subs = (await listAll(api, pid, "raisedByMe=true&heldBy=others")).length;
    t.check(`${who}: no Submittal of theirs waits with others; Home's count equals their own lists across Modules (DCL's own Snags and Comments held by TMC count for DCL)`, subs === 0 && Math.abs(n - x.counts.waitingWithOthers) <= 3, `home ${x.counts.waitingWithOthers}, lists ${n}, submittals ${subs}`);
  }
  const m = await home("mohammed");
  t.check("DCL's card count equals its Home count", m.projects[0].needMyAction === m.counts.needMyAction, `${m.projects[0].needMyAction} / ${m.counts.needMyAction}`);
  const { context, page } = await pageAs("yousef");
  try {
    await page.goto(`${webUrl}/en`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "yousef-home");
  } finally {
    await context.close();
  }
  t.note(`The Test Case's every-state set-up is whatever the other UAT Parts left; the checks compare Home with the same Members' Lists, not with fixed numbers. The 4+ weeks column needs the AGE tool (RP-922).`);
  void id;
});

defineCase("VIS-43", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const tag = String(Date.now()).slice(-5);
  const s = `UAT VIS-43 exported ${tag}`;
  const sub = await submittedMar(crew, s, { location: "T2F01" });
  await createMar(crew, `UAT VIS-43 draft ${tag}`, { location: "T2F01" });
  await ahmedSendsTo(crew, sub);
  const hafiz = await crew.as("hafiz");
  const mohammed = await crew.as("mohammed");
  const exp = async (api: Api, q: string) => (await api.get(`/projects/${pid}/work-items/export?pageSize=50&q=${encodeURIComponent(q)}`)).body as any;
  const eh = await exp(hafiz, `UAT VIS-43`);
  const em = await exp(mohammed, `UAT VIS-43`);
  const titlesH = eh.items.map((r: any) => r.title);
  const titlesM = em.items.map((r: any) => r.title);
  t.check("Hafiz's export (with a search) holds his Draft and the Submitted item", titlesH.includes(s) && titlesH.includes(`UAT VIS-43 draft ${tag}`), titlesH.join(" | "));
  t.check("Mohammed's export holds the Submitted item and never TMC's Draft", titlesM.includes(s) && !titlesM.includes(`UAT VIS-43 draft ${tag}`), titlesM.join(" | "));
  t.check("Creation Date is in TMC's numbered rows only (an un-numbered Draft has none); DCL's rows hold none", eh.items.filter((r: any) => r.documentNumber).every((r: any) => r.creationDate) && em.items.every((r: any) => r.creationDate === null), "");
  const rowH = eh.items.find((r: any) => r.id === sub);
  const rowM = em.items.find((r: any) => r.id === sub);
  t.check("The owner is DCL by name to TMC, and Mohammed to DCL", rowH.with.kind === "company" && /Design Consultants/.test(JSON.stringify(rowH.with)) && !/Mohammed|Ahmed/.test(JSON.stringify(rowH.with)) && rowM.with.kind === "own" && /Mohammed/.test(JSON.stringify(rowM.with)), JSON.stringify([rowH.with, rowM.with?.holder]));
  const ali = await crew.as("ali");
  const dA = (await ali.get(`/work-items/${sub}/shared`)).body as any;
  const dM = (await mohammed.get(`/work-items/${sub}/shared`)).body as any;
  t.check("Download gives Ali and Mohammed the same shared content", dA && dM && JSON.stringify(dA) === JSON.stringify(dM), `${JSON.stringify(dA).length} / ${JSON.stringify(dM).length}`);
  t.check("The Download names no Step, person or Internal Note", !/Ahmed|Mohammed|Hafiz|Ali Sonour|internalNote|recommended/i.test(JSON.stringify(dA).replace(/"title":"[^"]*"/, "")), "");
  const dup = await mohammed.post(`/work-items/${sub}/duplicate`, { idempotencyKey: crypto.randomUUID() });
  t.check("Duplicate is refused for Mohammed (one word, no reason)", dup.status >= 400 && dup.status !== 403, `${dup.status} ${dup.text}`);
  const draftOnly = await mohammed.post(`/work-items/${MADE_UP}/duplicate`, { idempotencyKey: crypto.randomUUID() });
  for (const who of ["yousef", "nasser"]) {
    const api = await crew.as(who);
    const dl = await api.get(`/work-items/${sub}/shared`);
    const du = await api.post(`/work-items/${sub}/duplicate`, { idempotencyKey: crypto.randomUUID() });
    const made = await api.get(`/work-items/${MADE_UP}/shared`);
    t.check(`${who}: Download and Duplicate by id are 404, the Download like a made-up id`, dl.status === 404 && du.status === 404 && dl.text === made.text, `${dl.status} ${du.status}`);
  }
  void draftOnly;
  const ok = await hafiz.post(`/work-items/${sub}/duplicate`, { idempotencyKey: crypto.randomUUID() });
  t.check("Positive control: Hafiz duplicates his own item (a new Draft)", ok.status === 201, `${ok.status}`);
  const { context, page } = await pageAs("mohammed");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/work-items?q=UAT%20VIS-43`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "mohammed-list-vis-43");
  } finally {
    await context.close();
  }
});

async function ahmedSendsTo(crew: Crew, id: string): Promise<void> {
  const ahmed = await crew.as("ahmed");
  await ahmed.post(`/work-items/${id}/pick-up`);
  await ahmed.transition(id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true, verification_note: "UAT" }, recommendedCode: "A" });
  await (await crew.as("mohammed")).post(`/work-items/${id}/pick-up`);
}

defineCase("VIS-44", async (t) => {
  const crew = await Crew.start();
  const members = async (who: string) => ((await (await crew.as(who)).get("/members")).body as any).members as any[];
  const s = await members("saeed");
  const h = await members("hafiz");
  const l = await members("layla");
  t.check("Saeed's Members page lists TMC people only, each with a Projects count", s.length >= 4 && s.every((m) => /@tmc\./.test(m.email) && typeof m.projectCount === "number"), s.map((m) => m.email).join(", "));
  t.check("Hafiz (a plain Member) reads the same list, the same counts", JSON.stringify(h.map((m) => [m.email, m.projectCount])) === JSON.stringify(s.map((m) => [m.email, m.projectCount])), "");
  t.check("The Projects column counts only: no Project name or id in the answer", s.every((m) => Object.keys(m).sort().join() === ["canCreateProjects", "email", "fullName", "id", "isAuthorizedPerson", "locale", "projectCount", "status"].join()) && !JSON.stringify(s).match(/Riyadh|Jeddah|projectId/), "");
  t.check("Layla's list holds DCL people only; no TMC person", l.length >= 4 && l.every((m) => /designconsultants\./.test(m.email)), l.map((m) => m.email).join(", "));
  t.check("A plain Member sees no Authorized Person-only fields beyond the count (no invitation token)", !JSON.stringify(h).match(/token|invitation/i), "");
  const { context, page } = await pageAs("hafiz");
  try {
    await page.goto(`${webUrl}/en/members`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "hafiz-members");
    const text = await page.locator("main").innerText();
    t.check("Hafiz's Members page names no DCL, Beta Build or Al Waha person", !/designconsultants|betabuild|alwaha|Ahmed|Mohammed|Layla|Yousef/.test(text), "");
  } finally {
    await context.close();
  }
});

defineCase("VIS-45", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const el = crew.dims.trade.EL!;
  const read = async (who: string, q = "") => (await (await crew.as(who)).get(`/projects/${pid}/approved-suppliers${q}`)) as any;
  const aKeys = new Set<string>();
  for (const who of ["yousef", "ahmed", "saeed"]) {
    const r = await read(who);
    t.check(`${who} reads the Approved Supplier List (name, Trade, Scope, status)`, r.status === 200 && r.body.suppliers.length > 0 && r.body.suppliers.every((x: any) => x.name && x.tradeId && "scopeId" in x && x.status), `${r.status} ${r.body?.suppliers?.length}`);
    for (const x of r.body.suppliers ?? []) Object.keys(x).forEach((k) => aKeys.add(k));
  }
  t.check("Every entry holds only id, name, Trade, Scope and status: never the SAR, its person, its time or its source", [...aKeys].sort().join() === ["id", "name", "scopeId", "status", "tradeId"].join(), [...aKeys].join());
  const tabuk = (await read("yousef", `?tradeId=${el}`)).body.suppliers.find((x: any) => /Tabuk/.test(x.name.en));
  t.check("The Tabuk Cable Industries entry (a closed SAR at Code A) is on the list", !!tabuk, "");
  const yMar = await createMar(crew, `UAT VIS-45 Yousef MAR`, { who: "yousef", location: "T2F01", answers: { supplier: tabuk?.id } });
  const yd = (await detail(await crew.as("yousef"), yMar)).body as any;
  t.check("Yousef raises a MAR choosing the supplier (the answer holds the supplier)", yd.answers.supplier === tabuk?.id, JSON.stringify(yd.answers.supplier));
  { const pg = await pageAs("yousef"); try { await pg.page.goto(`${webUrl}/en/work-items/${yMar}`, { waitUntil: "networkidle" }); await pg.page.waitForTimeout(700); const tx = await pg.page.locator("body").innerText(); await t.shot(pg.page, "yousef-mar-supplier"); t.check("His MAR page reads the supplier name", tx.includes("Tabuk Cable Industries"), ""); } finally { await pg.context.close(); } }
  const layla = await crew.as("layla");
  const nasser = await crew.as("nasser");
  const before = JSON.stringify((await read("saeed")).body);
  for (const [who, api] of [["layla", layla], ["nasser", nasser]] as const) {
    const rs = [
      await api.get(`/projects/${pid}/approved-suppliers`),
      await api.post(`/projects/${pid}/approved-suppliers`, { name: { en: "UAT VIS-45 intruder", ar: "UAT" }, tradeId: el, scopeId: null }),
      await api.post(`/approved-suppliers/${tabuk?.id}/withdraw`),
    ];
    t.check(`${who}: read, add and withdraw on the Tower list are all 404`, rs.every((r) => r.status === 404), rs.map((r) => r.status).join());
  }
  t.check("Nothing changed on the list", JSON.stringify((await read("saeed")).body) === before);
  const { context, page } = await pageAs("yousef");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/settings/approved-suppliers`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "yousef-approved-suppliers");
    const text = await page.locator("main").innerText();
    t.check("Yousef's page shows suppliers and no SAR number, person or time", /Tabuk/.test(text) && !/SAR|Supplier Approval Request|TWR-SAR/.test(text), text.slice(0, 120).replace(/\s+/g, " "));
  } finally {
    await context.close();
  }
  void [searchRows, rawGet, take, takeOk, mohammedCodes, listOf, pageIsNotFound];
});
