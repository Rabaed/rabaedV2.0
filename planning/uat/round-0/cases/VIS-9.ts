/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { defineCase } from "../harness/case.ts";
import { pageAs, webUrl } from "../harness/browser.ts";
import { Api } from "../harness/helpers.ts";
import {
  Crew, MADE_UP, ahmedSendsToManager, aliSubmit, closedMar, createMar, detail, historyOf, leakProbe, leakSummary, leaked, listAll, listOf, mailsWith, must, pageIsNotFound, pickUp, rawGet, searchRows, sendForReview,
  sleep, submittedMar, takeKind, takeOk, transitionsOf, expectNotFoundPage,
} from "../harness/helpers-vis.ts";

// VIS-53 .. VIS-64: Snags on itself, templates, imports, feed, direct URLs, errors, Defaults, derived values, other Projects.

const bi = (en: string) => ({ en, ar: `${en} (ع)` });
const tagOf = () => String(Date.now()).slice(-5);

defineCase("VIS-53", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const subject = `UAT VIS-53 own Snag ${tagOf()}`;
  const ali = await crew.as("ali");
  const created = must<{ id: string }>(
    await ali.post(`/projects/${pid}/work-items`, { type: "SNG", title: subject, answers: { description: "UAT own snag", trade: crew.dims.trade.EL, location: crew.dims.location.T1F01 } }),
    "create own Snag",
  );
  const id = created.id;
  const yousef = await crew.as("yousef");
  const mohammed = await crew.as("mohammed");
  const yHidden = async (when: string) => {
    const p = await leakProbe(yousef, pid, id, subject);
    const inList = (await listAll(yousef, pid, `q=${encodeURIComponent(subject)}`, "snag_list")).length;
    return t.check(`Yousef sees nothing of it ${when}: not by id, history or Workflow map, no row`, leaked(p).length === 0 && inList === 0, leakSummary(p));
  };
  const mStatus = async () => (await mohammed.get(`/work-items/${id}`)).status;
  t.check("Positive control: Ali (TMC) holds the Draft", ((await detail(ali, id)).body as any).stage.key === "draft");
  await yHidden("as a Draft");
  t.check("Mohammed (DCL) does not read the Draft", (await mStatus()) === 404);
  const names: string[] = [];
  must(await ali.transition(id, "raise"), "raise");
  names.push("raise");
  await yHidden("after the Raise");
  const informed = await mStatus();
  t.check("From the Raise Mohammed reads it as informed, read-only (docs/visibility.md RP-625-1; the Test Case text predates it)", informed === 200 && ((await detail(mohammed, id)).body as any).actions.transitions.length === 0, `${informed}`);
  for (const kind of [/^start/, /^resolve/, /^close/]) {
    let tr = (await transitionsOf(ali, id)).find((x) => kind.test(x.key));
    if (!tr) {
      await pickUp(ali, id);
      tr = (await transitionsOf(ali, id)).find((x) => kind.test(x.key));
    }
    if (!tr) throw new Error(`Ali has no ${kind} (has ${(await transitionsOf(ali, id)).map((x) => x.key).join(",")})`);
    const r = await ali.transition(id, tr.key, /resolve/.test(tr.key) ? { answers: { resolution_note: "UAT done" } } : {});
    t.check(`Ali takes ${tr.key}`, r.status < 300, `${r.status} ${r.text.slice(0, 100)}`);
    await sleep(200);
    await yHidden(`after ${tr.key}`);
  }
  t.check("It is Closed, held by TMC from Draft to Closed", ((await detail(ali, id)).body as any).stage.key === "closed");
  const h = await historyOf(mohammed, id);
  t.check("Mohammed's history holds only the shared moves (Raise, Resolve, Close), never In Progress", !h.events.some((e) => /Start work/i.test(e.transition?.en ?? "")), h.events.map((e) => e.transition?.en).join(", "));
  const { context, page } = await pageAs("yousef");
  try {
    const nf = await pageIsNotFound(page, `/work-items/${id}`);
    await t.shot(page, "yousef-own-snag-by-id");
    t.check("Yousef: the Snag by id is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
  t.note("The Test Case says the Consultant never sees a Contractor's Snag on itself; the later spec (RP-625-1, docs/visibility.md) informs the Consultant from the Raise, read-only. The product follows the spec, so this is checked against it: the Test Case needs a text fix.");
});

defineCase("VIS-54", async (t) => {
  t.blocked("Cannot be built on this seed through the api: the Snags 'raised from' a source Snag are linked by SQL in the test suite (no api route sets raised_from), and the Mechanical Snag needs a Contractor covering Mechanical (TMC and Beta Build cover Electrical only). Steps for a person once a Mechanical Contractor exists: 1) Mohammed raises a Snag on Tower 1 and two Snags are linked raised from it, one Electrical and one Mechanical. 2) The PM, an Electrical-only TMC engineer and Yousef read the source Snag's Snags line. 3) Mohammed raises a Snag at a Location only Yousef covers. Expected: PM counts 2 open; the Electrical-only engineer counts 1; Yousef counts only Snags he sees. The Comments line of a Code B (a raised-from count by Type) is shown by VIS-05 (2 open / 1 closed).");
});

defineCase("VIS-55", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const nasser = await crew.as("nasser");
  const tag = tagOf();
  const item = (key: string, en: string) => ({ key, text: bi(en), answers: "pass_fail_na", comment: "optional", photo: "off", on_negative: "create_snag" });
  const name = `UAT VIS-55 Template ${tag}`;
  const made = await saeed.post(`/projects/${pid}/checklist-templates`, { name: bi(name), tradeId: crew.dims.trade.EL, items: [item("one", "UAT first item"), item("two", "UAT second item")] });
  t.check("Saeed (Project Admin) creates a Checklist Template", made.status === 201, `${made.status} ${made.text.slice(0, 120)}`);
  const templateId = (made.body as any).id as string;
  const jcv = ((await nasser.get("/projects")).body as any).projects[0].id as string;
  const jdims = ((await nasser.get(`/projects/${jcv}/dimensions`)).body as any).trade as any[];
  const jName = `UAT VIS-55 JCV Template ${tag}`;
  const jmade = await nasser.post(`/projects/${jcv}/checklist-templates`, { name: bi(jName), tradeId: jdims[0].id, items: [item("one", "UAT jcv item")] });
  t.check("Nasser keeps a Template on JCV", jmade.status === 201, `${jmade.status} ${jmade.text.slice(0, 100)}`);
  const templatesOf = async (api: Api, p: string) => (await api.get(`/projects/${p}/checklist-templates`)).body as any;
  for (const who of ["saeed", "hafiz", "ahmed", "ali"]) {
    const r = await templatesOf(await crew.as(who), pid);
    t.check(`${who} reads Tower's templates (and never JCV's)`, r.templates.some((x: any) => x.name.en === name) && !JSON.stringify(r).includes(jName), `${r.templates.length}`);
    const keys = new Set<string>();
    r.templates.forEach((x: any) => Object.keys(x).forEach((k) => keys.add(k)));
    t.check(`${who} reads nothing of who wrote or retired a template, or when`, !/by|At|time|written|retired/i.test([...keys].filter((k) => k !== "status").join(",")), [...keys].join(","));
  }
  const yousef = await crew.as("yousef");
  const yRead = await yousef.get(`/projects/${pid}/checklist-templates`);
  t.check("Yousef (a Tower Member) reads the Tower templates too, no JCV one", yRead.status === 200 && !yRead.text.includes(jName), `${yRead.status}`);
  const nTower = await nasser.get(`/projects/${pid}/checklist-templates`);
  t.check("Nasser reads none of Tower's (404)", nTower.status === 404, `${nTower.status}`);
  const tmpl = (await templatesOf(saeed, pid)).templates.find((x: any) => x.id === templateId);
  for (const who of ["ali", "hafiz", "ahmed", "yousef", "nasser"]) {
    const api = await crew.as(who);
    const rs = [
      await api.post(`/projects/${pid}/checklist-templates`, { name: bi("UAT intruder"), tradeId: crew.dims.trade.EL, items: [item("a", "x")] }),
      await api.request("PUT", `/checklist-templates/${templateId}`, { name: bi("UAT intruder edit"), tradeId: crew.dims.trade.EL, items: [item("a", "x")] }),
      await api.post(`/checklist-templates/${templateId}/retire`),
    ];
    t.check(`${who} cannot create, edit or retire: all the plain 404`, rs.every((r) => r.status === 404), rs.map((r) => r.status).join());
  }
  // The WIR copy.
  const hafiz = await crew.as("hafiz");
  const wir = must<{ id: string }>(
    await hafiz.post(`/projects/${pid}/work-items`, { type: "WIR", title: `UAT VIS-55 WIR ${tag}`, answers: { description: "UAT", requested_for: "2026-11-02T08:00:00.000Z", trade: crew.dims.trade.EL, location: crew.dims.location.T1F02, checklist_template: tmpl.versionId } }),
    "create WIR",
  ).id;
  const edit = await saeed.request("PUT", `/checklist-templates/${templateId}`, { name: bi(name), tradeId: crew.dims.trade.EL, items: [item("one", "UAT first item EDITED"), item("two", "UAT second item"), item("three", "UAT third item")] });
  t.check("Saeed edits the template into Version 2 while the WIR is a Draft", edit.status === 204, `${edit.status}`);
  const dd = (await detail(hafiz, wir)).body as any;
  t.check("The Draft WIR's copy is read by TMC (Hafiz) and holds Version 1's 2 items", dd.checklistCopies?.[0]?.versionNo === 1 && dd.checklistCopies[0].items.length === 2, JSON.stringify(dd.checklistCopies?.map((c: any) => [c.versionNo, c.items.length])));
  t.check("Before the Submit DCL (Ahmed) and Yousef read the WIR nowhere", (await (await crew.as("ahmed")).get(`/work-items/${wir}`)).status === 404 && (await yousef.get(`/work-items/${wir}`)).status === 404);
  await sendForReview(crew, wir);
  await aliSubmit(crew, wir);
  const ad = (await detail(await crew.as("ahmed"), wir)).body as any;
  t.check("After the Submit DCL reads the same copy, still Version 1 with 2 items", ad.checklistCopies?.[0]?.versionNo === 1 && ad.checklistCopies[0].items.length === 2, JSON.stringify(ad.checklistCopies?.map((c: any) => [c.versionNo, c.items.length])));
  t.check("Yousef reads no row of the WIR or its copy (404)", (await yousef.get(`/work-items/${wir}`)).status === 404);
  await saeed.post(`/checklist-templates/${templateId}/retire`);
  const { context, page } = await pageAs("ali");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/settings/checklist-templates`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "ali-templates-read-only");
  } finally {
    await context.close();
  }
  t.note("The UAT template was retired at the end (UAT Part leftovers: its WIR keeps its copy).");
});

defineCase("VIS-56", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const tag = tagOf();
  const hafiz = await crew.as("hafiz");
  const csv = Buffer.from(`Subject,Type,Trade\nUAT VIS-56 import item 1 ${tag},MAR,Electrical Works\nUAT VIS-56 import item 2 ${tag},MAR,Electrical Works\n`, "utf8");
  const file = { fileName: `uat-vis-56-${tag}.csv`, content: csv.toString("base64") };
  const sheet = `uat-vis-56-${tag}`;
  const pv = await hafiz.post(`/projects/${pid}/register-imports`, { file, sheet, headerRow: 1, mapping: { subject: { column: 0 }, type: { column: 1 }, trade: { column: 2 } } });
  t.check("Hafiz uploads and previews a register", pv.status === 201 && (pv.body as any).rows?.length === 2, `${pv.status} ${pv.text.slice(0, 100)}`);
  const id = (pv.body as any).id as string;
  const ali = await crew.as("ali");
  const aliPreview = await ali.get(`/register-imports/${id}`);
  const madeUp = await ali.get(`/register-imports/${MADE_UP}`);
  t.check("Before the confirm Ali cannot read the preview (404, like a made-up id)", aliPreview.status === 404 && aliPreview.text === madeUp.text, `${aliPreview.status}`);
  t.check("Hafiz reads it", (await hafiz.get(`/register-imports/${id}`)).status === 200);
  const confirm = await hafiz.post(`/register-imports/${id}/confirm`);
  t.check("Hafiz confirms", confirm.status < 300, `${confirm.status} ${confirm.text.slice(0, 100)}`);
  const full = (await ali.get(`/register-imports/${id}`));
  const ai = full.body as any;
  t.check("After it every TMC Member reads the import: file name, mapping and rows", full.status === 200 && ai.fileName === file.fileName && !!ai.mapping && ai.rows?.length === 2, `${full.status}`);
  t.check("The import carries no import time in what Ali reads", !/importedAt|createdAt|at"/.test(JSON.stringify(Object.keys(ai))), Object.keys(ai).join(","));
  for (const who of ["yousef", "nasser", "ahmed", "mohammed", "faisal"]) {
    const api = await crew.as(who);
    const list = await api.get(`/projects/${pid}/register-imports`);
    const one = await api.get(`/register-imports/${id}`);
    const conf = await api.post(`/register-imports/${id}/confirm`);
    const orig = await api.get(`/register-imports/${id}/original`);
    const emptyOrNotFound = list.status === 404 || ((list.body as any)?.imports ?? []).length === 0;
    t.check(`${who}: an empty Imports page, 404 for the import, its confirm and its original`, emptyOrNotFound && one.status === 404 && conf.status === 404 && orig.status === 404, `${list.status} ${one.status} ${conf.status} ${orig.status}`);
    const drafts = (await searchRows(api, pid, `UAT VIS-56 import item 1 ${tag}`)).length;
    t.check(`${who} sees none of its Drafts`, drafts === 0, `${drafts}`);
  }
  const hRows = await searchRows(hafiz, pid, `UAT VIS-56 import item`);
  t.check("Hafiz reads the two imported Drafts (positive control)", hRows.filter((r) => r.title.endsWith(tag)).length === 2, `${hRows.length}`);
  const { context, page } = await pageAs("yousef");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/work-items/imports`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "yousef-imports-page");
    const nf = await pageIsNotFound(page, `/projects/${pid}/work-items/imports/${id}`);
    t.check("Yousef: the import's page is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
});

defineCase("VIS-57", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const subject = `UAT VIS-57 feed MAR ${tagOf()}`;
  const id = await submittedMar(crew, subject, { location: "T2F01" });
  await ahmedSendsToManager(crew, id, "C", "UAT-VIS57-ahmed-internal");
  const mohammed = await crew.as("mohammed");
  const ret = await takeKind(mohammed, id, "return", { reason: "UAT-VIS57-return" });
  t.check("Setup: Submit, Pick up, Send to Manager, a Return", ret.status < 300, `${ret.status} ${ret.text.slice(0, 80)}`);
  await pickUp(await crew.as("ahmed"), id);
  await (await crew.as("ahmed")).transition(id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true, verification_note: "UAT" }, recommendedCode: "C", internalNote: "UAT-VIS57-2" });
  await pickUp(mohammed, id);
  const code = await mohammed.transition(id, "revise_c", { answers: { sample_checked: true, matches_specification: true, verification_note: "UAT", remarks: "UAT remarks" } });
  t.check("A Code", code.status < 300, `${code.status}`);
  await sleep(500);
  const feed = async (who: string) => ((await (await crew.as(who)).get(`/projects/${pid}/activity?limit=100`)).body as any)?.entries as any[] ?? [];
  const mine = async (who: string) => (await feed(who)).filter((e) => e.workItem.id === id);
  const ali = await mine("ali");
  const ahmed = await mine("ahmed");
  t.check("Ali's feed shows TMC people by name and DCL by Company name only", ali.some((e) => e.by.memberName) && ali.filter((e) => e.by.companyName?.en === "Design Consultants LLC").every((e) => e.by.memberName === null || e.type === "issue_code"), JSON.stringify(ali.map((e) => [e.type, e.by.companyName?.en, e.by.memberName?.en])));
  t.check("Ahmed's feed shows DCL people by name and TMC by Company name only", ahmed.some((e) => e.by.memberName) && ahmed.filter((e) => e.by.companyName?.en === "TMC Constructions").every((e) => e.by.memberName === null), JSON.stringify(ahmed.map((e) => [e.type, e.by.companyName?.en, e.by.memberName?.en])));
  const bad = (entries: any[], own: string) => entries.filter((e) => e.by.companyName?.en !== own && (e.audience === "internal" || ["internal_note", "recommend_code", "internal_answers", "answers_changed", "document_uploaded", "returned", "assigned", "picked_up"].includes(e.type)));
  t.check("Ali sees no internal event, Internal Note, Recommended Code, answers_changed or Document upload of DCL", bad(ali, "TMC Constructions").length === 0, JSON.stringify(bad(ali, "TMC Constructions").map((e) => e.type)));
  t.check("Ahmed sees none of TMC's", bad(ahmed, "Design Consultants LLC").length === 0, JSON.stringify(bad(ahmed, "Design Consultants LLC").map((e) => e.type)));
  t.check("Positive control: Ahmed sees his own Recommended Code and Return events", ahmed.some((e) => e.type === "recommend_code") || ahmed.some((e) => e.audience === "internal"), JSON.stringify(ahmed.map((e) => e.type)));
  const yAll = await feed("yousef");
  const yIds = new Set((await listAll(await crew.as("yousef"), pid, "")).map((r) => r.id));
  const yMods = await Promise.all(["snag_list", "inspections"].map(async (m) => (await listAll(await crew.as("yousef"), pid, "", m)).map((r) => r.id)));
  yMods.flat().forEach((i) => yIds.add(i));
  t.check("Yousef's feed holds only Beta Build items (every entry is an item he sees); none of this one", yAll.every((e) => yIds.has(e.workItem.id)) && !JSON.stringify(yAll).includes(subject), `${yAll.length} entries`);
  t.check("No setup changes appear (every entry is an item event)", [...ali, ...ahmed].every((e) => !!e.workItem?.id));
  const dash = await (await crew.as("yousef")).get(`/projects/${pid}/dashboard`);
  t.check("Yousef's Dashboard holds nothing of it", !dash.text.includes(subject));
  const { context, page } = await pageAs("ali");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/activity`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "ali-activity-feed");
  } finally {
    await context.close();
  }
});

defineCase("VIS-58", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const subject = `UAT VIS-58 hidden MAR ${tagOf()}`;
  const id = await submittedMar(crew, subject, { location: "T2F01" });
  const bId = await closedMar(crew, `UAT VIS-58 Code B ${tagOf()}`, { location: "T1F01", code: "B" });
  await sleep(1000);
  const comment = (await listAll(await crew.as("hafiz"), pid, "", "snag_list")).find((c: any) => c.raisedFrom?.workItemId === bId)?.id as string;
  t.check("Setup: a TMC Submitted item and a TMC Comment exist", !!id && !!comment, `${comment}`);
  t.check("Ids are random: version 4 (no time, no order)", [id, bId, comment].every((u) => u[14] === "4"), [id, bId, comment].map((u) => u[14]).join(""));
  const nasser = await crew.as("nasser");
  const pairs: [string, string, string][] = [
    ["the Tower Project", `/projects/${pid}`, `/projects/${MADE_UP}`],
    ["the Tower Submittals list", `/projects/${pid}/work-items`, `/projects/${MADE_UP}/work-items`],
    ["a TMC item", `/work-items/${id}`, `/work-items/${MADE_UP}`],
  ];
  for (const [what, hidden, madeUp] of pairs) {
    const a = await nasser.get(hidden);
    const b = await nasser.get(madeUp);
    t.check(`Nasser: ${what} by api is a 404 byte-identical to a made-up id (never 403)`, a.status === 404 && a.text === b.text, `${a.status} ${a.text} / ${b.status} ${b.text}`);
  }
  const yousef = await crew.as("yousef");
  for (const [what, hid] of [["a TMC item id", id], ["a TMC Comment id", comment]] as const) {
    const a = await yousef.get(`/work-items/${hid}`);
    const b = await yousef.get(`/work-items/${MADE_UP}`);
    t.check(`Yousef: ${what} by api is byte-identical to a made-up id`, a.status === 404 && a.text === b.text, `${a.status}`);
  }
  const { context, page } = await pageAs("nasser");
  try {
    const seen: { what: string; status: number | undefined; text: string }[] = [];
    for (const [what, hidden, madeUp] of [["Tower Project", `/projects/${pid}`, `/projects/${MADE_UP}`], ["Tower Submittals", `/projects/${pid}/work-items`, `/projects/${MADE_UP}/work-items`], ["TMC item", `/work-items/${id}`, `/work-items/${MADE_UP}`]]) {
      const a = await pageIsNotFound(page, hidden);
      const b = await pageIsNotFound(page, madeUp);
      t.check(`Nasser: the ${what} page and a made-up id's page are identical (one heading, a Projects button)`, a.notFound && b.notFound && a.text === b.text && a.status === b.status, `${a.status}/${b.status} ${a.text.slice(0, 60)}`);
      seen.push({ what, status: a.status, text: a.text });
    }
    t.check("The wording is the plain 'We can't find this page' with no title, number or Company", seen.every((s) => /can.t find this page/i.test(s.text) && !/UAT|TWR|TMC/.test(s.text)), seen[0]!.text.slice(0, 120));
    await pageIsNotFound(page, `/work-items/${id}`);
    await t.shot(page, "nasser-tmc-item");
  } finally {
    await context.close();
  }
});

defineCase("VIS-59", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const tag = tagOf();
  const sTmc = `UAT VIS-59 TMC item ${tag}`;
  const tmc = await submittedMar(crew, sTmc, { location: "T2F01" });
  const tmcNumber = ((await detail(await crew.as("hafiz"), tmc)).body as any).documentNumber as string;
  const yousef = await crew.as("yousef");
  const draft = await createMar(crew, `UAT VIS-59 Yousef ${tag}`, { who: "yousef", location: "T2F01" });
  const leaksNames = (text: string) => [sTmc, tmcNumber, "TMC Constructions", "Hafiz", "Ali Sonour", tmc].filter((n) => text.includes(n));
  const link = await yousef.post(`/work-items/${draft}/links`, { workItemId: tmc });
  const linkFake = await yousef.post(`/work-items/${draft}/links`, { workItemId: MADE_UP });
  t.check("A link to a TMC id is refused uniformly (like a made-up id) and names nothing", link.status >= 400 && link.text === linkFake.text && leaksNames(link.text).length === 0, `${link.status} ${link.text}`);
  const d = (await detail(yousef, draft)).body as any;
  const save = await yousef.put(`/work-items/${draft}/answers`, { answers: { ...d.answers, related_submittals: [tmc] } });
  const saveFake = await yousef.put(`/work-items/${draft}/answers`, { answers: { ...d.answers, related_submittals: [MADE_UP] } });
  t.check("A Form saved with a hidden reference is refused like a made-up one, naming nothing", save.status >= 400 && save.status === saveFake.status && leaksNames(save.text).length === 0 && save.text.replaceAll(tmc, MADE_UP) === saveFake.text, `${save.status} ${save.text.slice(0, 200)} / ${saveFake.status} ${saveFake.text.slice(0, 200)}`);
  const choices = await yousef.get(`/projects/${pid}/form-choices`);
  const ch = choices.body as any;
  const partNames = (ch.participants ?? []).map((p: any) => p.name?.en ?? p.companyName?.en ?? p.legalName?.en ?? JSON.stringify(p));
  t.check("Yousef's Member choices are himself only; Participant choices only his own Company and the Host Company by name (V15)", (ch.members ?? []).length === 1 && partNames.every((n: string) => /Beta Build|TMC Constructions/.test(n)) && !/Hafiz|Ali Sonour|Omar|Saeed/.test(choices.text), `members ${(ch.members ?? []).length}; participants ${partNames.join(", ")}`);
  const hidMember = await yousef.put(`/work-items/${draft}/answers`, { answers: { ...d.answers, manufacturer: { member: "00000000-0000-4000-8000-000000000000" } } });
  t.check("A refusal of a bad answer names nothing of another item or Company", leaksNames(hidMember.text).length === 0, hidMember.text.slice(0, 160));
  const hafizLinks = ((await (await crew.as("hafiz")).get(`/work-items/${tmc}/links`)).body as any).links as any[];
  const foreignLink = await yousef.get(`/work-items/${draft}/links/${hafizLinks[0]?.id ?? MADE_UP}`);
  const foreignFake = await yousef.get(`/work-items/${draft}/links/${MADE_UP}`);
  t.check("A Link page opened by a TMC Link id is 404, like a made-up id", foreignLink.status === 404 && foreignLink.text === foreignFake.text, `${foreignLink.status}`);
  const tr = await yousef.transition(tmc, "send_for_review");
  const trFake = await yousef.transition(MADE_UP, "send_for_review");
  t.check("A Transition on a TMC item is 404 like a made-up id", tr.status === 404 && tr.text === trFake.text, `${tr.status} ${tr.text}`);
  const { context, page } = await pageAs("yousef");
  try {
    await page.goto(`${webUrl}/en/work-items/${draft}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "yousef-own-draft");
    t.check("Yousef's own Draft page holds no name of the TMC item", leaksNames(await page.locator("body").innerText()).length === 0);
  } finally {
    await context.close();
  }
});

defineCase("VIS-60", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const nasser = await crew.as("nasser");
  const jcv = ((await nasser.get("/projects")).body as any).projects[0].id as string;
  const hafiz = await crew.as("hafiz");
  const defaults = async (api: Api, project: string) => {
    const ws = (await api.get(`/projects/${project}/workflow-settings`)).body as any;
    const mar = ws.types.find((x: any) => x.code === "MAR");
    return { ws, list: mar.rabaedDefaults as { id: string; name: { en: string }; versionNo: number | null; bound: boolean; isTypeDefault: boolean }[] };
  };
  const h = await defaults(hafiz, pid);
  const n = await defaults(nasser, jcv);
  t.check("Both read the Rabaed Default Workflows for the MAR: eight, with names and Versions", h.list.length === 8 && n.list.length === 8, `${h.list.length} / ${n.list.length}`);
  t.check("The same eight for both (names and Versions)", JSON.stringify(h.list.map((x) => [x.name.en, x.versionNo])) === JSON.stringify(n.list.map((x) => [x.name.en, x.versionNo])), "");
  t.check("The one the Type runs is marked (isTypeDefault) in each", h.list.some((x) => x.isTypeDefault) && n.list.some((x) => x.isTypeDefault));
  const text = JSON.stringify(h.list) + JSON.stringify(n.list);
  t.check("They name no Project, Company or item", !/Riyadh|Jeddah|TMC|Beta|Design Consultants|Al Waha|UAT|TWR/.test(text), text.slice(0, 100));
  t.check("Tower's binding reaches Tower only: JCV's MAR runs its own Workflow, not Tower's project copy", n.ws.types.find((x: any) => x.code === "MAR").workflow.source === "rabaed_default", JSON.stringify(n.ws.types.find((x: any) => x.code === "MAR").workflow));
  const { context, page } = await pageAs("nasser");
  try {
    await page.goto(`${webUrl}/en/projects/${jcv}/settings/workflows`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "nasser-workflows");
  } finally {
    await context.close();
  }
});

defineCase("VIS-61", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const tag = tagOf();
  const draft = await createMar(crew, `UAT VIS-61 long draft ${tag}`, { location: "T2F01" });
  const sub = await submittedMar(crew, `UAT VIS-61 aged ${tag}`, { location: "T2F01" });
  const hafiz = await crew.as("hafiz");
  const dh = (await detail(hafiz, draft)).body as any;
  t.check("A Draft shows no Step Age to anyone: Hafiz's own Draft has none", dh.stepAgeWeeks === null && dh.stepEnteredAt === null, JSON.stringify([dh.stepAgeWeeks, dh.stepEnteredAt]));
  const dhRow = (await searchRows(hafiz, pid, `UAT VIS-61 long draft ${tag}`)).find((r) => r.id === draft);
  t.check("...and in his List row", dhRow?.stepAgeWeeks === null, JSON.stringify(dhRow?.stepAgeWeeks));
  for (const who of ["ahmed", "yousef"]) {
    const api = await crew.as(who);
    const seen: string[] = [];
    for (const q of ["sort=stepAge", "sort=stepAge&dir=desc", "sort=created", "sort=submissionDate", "stepAgeMin=1", "createdWithin=7", "createdWithin=30&sort=stepAge", "sort=stepAge&page=2", "sort=stepAge&pageSize=10"]) {
      const r = await listOf(api, pid, q);
      if (r.status === 200) seen.push(r.text);
    }
    const all = seen.join("\n");
    t.check(`${who}: no filter, sort key, cursor or row reveals the TMC Draft or when TMC started it`, !all.includes(draft) && !all.includes(`long draft ${tag}`) && !/"creationDate":"20/.test(all.replaceAll('"creationDate":null', "")), `${seen.length} reads`);
    const cursorRead = await api.get(`/projects/${pid}/work-items?pageSize=10`);
    const cur = (cursorRead.body as any)?.nextCursor as string | null;
    if (cur) {
      const decoded = Buffer.from(cur, "base64url").toString("utf8");
      t.check(`${who}: the paging cursor carries no TMC date or id`, !decoded.includes(dh.creationDate ?? "XXXX") && !decoded.includes(draft), decoded.slice(0, 80));
    }
  }
  const ad = (await detail(await crew.as("ahmed"), sub)).body as any;
  t.check("Ahmed's item detail holds no Creation Date and no Step Age earlier than the Submit", ad.creationDate === null && ad.stepEnteredAt === ad.submissionDate, JSON.stringify([ad.creationDate, ad.stepEnteredAt, ad.submissionDate]));
  const exp = await (await crew.as("ahmed")).get(`/projects/${pid}/work-items/export?pageSize=50`);
  t.check("Ahmed's export has no Creation Date", !/"creationDate":"2/.test(exp.text), "");
  const { context, page } = await pageAs("ahmed");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/work-items?stepAgeMin=1&sort=stepAge`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "ahmed-stepage-filter");
  } finally {
    await context.close();
  }
  t.note("The aged items of the Test Case (weeks old) need the AGE tool (RP-922); the checks use fresh items and prove no field carries the Draft's start.");
});

defineCase("VIS-62", async (t) => {
  t.notRun("not built: the Files Module, Drawings and Plan View (no Files route in apps/api, no page in apps/web; no ticket in the five epics). Steps for later: Mohammed and Yousef open Files and a shared floor plan with Pins. Expected: Work Item folders only for visible items; Pins only of visible items.");
});

defineCase("VIS-63", async (t) => {
  t.notRun("not built: Participant withdrawal, Project close and Signatory Access (RP-614) are not built (no route in apps/api). Steps for later: 1) Remove a signing engineer from the Project. 2) Withdraw DCL. 3) Close the Project. Expected (E2): the removed Member keeps the Project name and the records they signed; DCL's Authorized Person sees only the records DCL Members signed; open items of a withdrawn Participant are Cancelled; a closed Project is read-only with E2 records available.");
});

defineCase("VIS-64", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const subject = `UAT VIS-64 item ${tagOf()}`;
  const id = await submittedMar(crew, subject, { location: "T2F01" });
  const hafiz = await crew.as("hafiz");
  t.check("Positive control: Hafiz sees the Tower item and the Tower Project", (await detail(hafiz, id)).status === 200 && ((await hafiz.get("/projects")).body as any).projects.some((p: any) => p.id === pid));
  const nasser = await crew.as("nasser");
  const projects = ((await nasser.get("/projects")).body as any).projects as any[];
  const jcv = projects.find((p) => p.code === "JCV");
  t.check("Nasser's Projects page lists JCV only (not Tower)", projects.length === 1 && jcv && !projects.some((p) => p.id === pid), projects.map((p) => p.code).join());
  const home = await nasser.get("/home");
  t.check("Nasser's Home counts, activity and notifications hold nothing of Tower", !home.text.includes(subject) && !home.text.includes("Riyadh") && !((await nasser.get("/notifications")).text.includes("Riyadh")), "");
  const search = await listOf(nasser, jcv.id, `q=${encodeURIComponent("UAT VIS-64")}`);
  t.check("His search (JCV List) finds none of Tower's items", !search.text.includes(subject), "");
  const probes = await leakProbe(nasser, pid, id, subject);
  t.check("Tower's item and Project are 404 for him in every channel (never 403)", leaked(probes).length === 0 && (await nasser.get(`/projects/${pid}`)).status === 404, leakSummary(probes));
  // The other way: Hafiz is not on JCV.
  const hProjects = ((await hafiz.get("/projects")).body as any).projects as any[];
  t.check("Hafiz's Projects page lists Tower only (not JCV)", !hProjects.some((p) => p.id === jcv.id), hProjects.map((p) => p.code).join());
  const jItems = await listAll(nasser, jcv.id, "");
  const jId = jItems[0]?.id;
  const hJcv = await hafiz.get(`/projects/${jcv.id}`);
  const hJItem = jId ? await hafiz.get(`/work-items/${jId}`) : null;
  const hHome = await hafiz.get("/home");
  t.check("Hafiz gets 404 for the JCV Project and its item, and his Home holds nothing of JCV", hJcv.status === 404 && (!hJItem || hJItem.status === 404) && !hHome.text.includes("Jeddah") && !(await hafiz.get("/notifications")).text.includes("Jeddah"), `${hJcv.status} ${hJItem?.status}`);
  const { context, page } = await pageAs("nasser");
  try {
    const nf = await pageIsNotFound(page, `/work-items/${id}`);
    const nf2 = await pageIsNotFound(page, `/projects/${pid}`);
    await t.shot(page, "nasser-tower-project-url");
    t.check("Both URLs (item and Project) give the one not-found page", nf.notFound && nf2.notFound && nf.text === nf2.text, `${nf.status} ${nf2.status}`);
  } finally {
    await context.close();
  }
  const { context: c2, page: p2 } = await pageAs("hafiz");
  try {
    const nf = await pageIsNotFound(p2, `/projects/${jcv.id}`);
    t.check("Hafiz: the JCV Project URL is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await c2.close();
  }
  void [mailsWith, rawGet, takeOk, expectNotFoundPage, aliSubmit, sendForReview];
});
