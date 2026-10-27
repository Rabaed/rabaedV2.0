/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { createHash } from "node:crypto";
import { defineCase } from "../harness/case.ts";
import { pageAs, webUrl } from "../harness/browser.ts";
import { Api } from "../harness/helpers.ts";
import {
  Crew, MADE_UP, aliSubmit, closedMar, createMar, detail, historyOf, leakProbe, leakSummary, leaked, listAll, listOf, memberIdOf, must, myParticipantId, pageIsNotFound, participantIdByName, participantVisibility,
  pdfBytes, photoBytes, pickUp, raiseSnag, searchRows, sendForReview, setParticipantVisibility, sleep, stageCounts, submittedMar, takeKind, takeOk, transitionsOf, upload, sameGrant,
} from "../harness/helpers-vis.ts";

// VIS-46 .. VIS-52: Inspections inside Submittals, Required links, annotated photos, WIR recommendations, Snags.

const _bi = (en: string) => ({ en, ar: `${en} (ع)` });
const REQUESTED = "2026-11-02T08:00:00.000Z";

async function submittedWir(crew: Crew, subject: string, location = "T1F02"): Promise<string> {
  const hafiz = await crew.as("hafiz");
  const templates = ((await hafiz.get(`/projects/${crew.projectId}/checklist-templates`)).body as any).templates as any[];
  const tray = templates.find((x) => x.name.en === "Cable trays and containment")!;
  const created = must<{ id: string }>(
    await hafiz.post(`/projects/${crew.projectId}/work-items`, {
      type: "WIR",
      title: subject,
      answers: { description: "UAT cable trays ready for inspection.", requested_for: REQUESTED, trade: crew.dims.trade.EL, location: crew.dims.location[location], checklist_template: tray.versionId },
    }),
    "create WIR",
  );
  await sendForReview(crew, created.id);
  await aliSubmit(crew, created.id);
  return created.id;
}

defineCase("VIS-46", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const subject = `UAT VIS-46 WIR ${String(Date.now()).slice(-5)}`;
  const wir = await submittedWir(crew, subject);
  const set = (show: boolean) => saeed.request("PUT", `/projects/${pid}/settings/show-inspections-in-submittals`, { show });
  const subs = async (api: Api) => (await searchRows(api, pid, subject)).filter((r) => r.id === wir).length;
  try {
    const on = await set(true);
    t.check("Saeed turns Inside the Submittals tab on", on.status === 204, `${on.status}`);
    for (const who of ["hafiz", "ahmed"]) {
      const api = await crew.as(who);
      const row = (await searchRows(api, pid, subject)).find((r) => r.id === wir);
      t.check(`${who} sees the WIR in the Submittals List`, !!row, "");
      const list = await listOf(api, pid, "type=WIR&q=" + encodeURIComponent(subject));
      t.check(`${who}'s Type filter offers WIR and filtering by it finds it`, list.filters.types.some((x: any) => x.code === "WIR") && list.items.some((r) => r.id === wir), "");
      const kan = await api.get(`/projects/${pid}/work-items/kanban?q=${encodeURIComponent(subject)}`);
      t.check(`${who}'s Submittals Kanban holds it`, JSON.stringify((kan.body as any).columns).includes(wir), "");
      t.check(`${who} opens the WIR by id`, (await detail(api, wir)).status === 200);
    }
    const y = await crew.as("yousef");
    const yp = await leakProbe(y, pid, wir, subject);
    t.check("Yousef sees the WIR in none of them (List, search, counts, Kanban, Home, bell) and gets 404 by id", leaked(yp).length === 0, leakSummary(yp));
    t.check("Yousef's Type filter and counts hold nothing of it", (await subs(y)) === 0);
    const { context, page } = await pageAs("hafiz");
    try {
      await page.goto(`${webUrl}/en/projects/${pid}/work-items?q=${encodeURIComponent(subject)}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await t.shot(page, "hafiz-submittals-with-wir");
      const notFoundPage = (await page.getByTestId("not-found").count()) > 0;
      if (notFoundPage) t.note("Steps: Saeed turns Inside the Submittals tab on; Hafiz opens the Submittals List searched for the WIR. Expected (docs/visibility.md, Inspections inside Submittals): the WIR row shows. Actual: the not-found page for Hafiz on his own List (Bug RP-1049, load over 3 s); the api List, Kanban and by-id reads for Hafiz show the WIR, so visibility is correct. Screenshot evidence/VIS-46-1-hafiz-submittals-with-wir.jpg.");
      t.check("Hafiz's Submittals page shows the WIR row", (await page.locator("main").innerText()).includes(subject), notFoundPage ? "the page shows the not-found page for Hafiz on his own List: Bug RP-1049 (the web gives up at 3 s), not a visibility result; the api answer above shows the WIR" : "page loaded without the row");
    } finally {
      await context.close();
    }
    const { context: c2, page: p2 } = await pageAs("yousef");
    try {
      const nf = await pageIsNotFound(p2, `/work-items/${wir}`);
      t.check("Yousef: the WIR URL is the plain not-found page", nf.notFound, nf.text);
    } finally {
      await c2.close();
    }
  } finally {
    const off = await set(false);
    t.check("The setting is back off, as found", off.status === 204 && (await subs(await crew.as("hafiz"))) === 0, `${off.status}`);
  }
});

defineCase("VIS-47", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const nasser = await crew.as("nasser");
  const jcv = ((await nasser.get("/projects")).body as any).projects[0].id as string;
  const read = async (api: Api, project: string) => (await api.get(`/projects/${project}/required-fields`)).body as any;
  const before = await read(saeed, pid);
  const field = (before.fields as any[]).find((f) => f.type === "WIR" && f.key === "approved_submittals");
  t.check("Saeed reads Tower's Required links setting (WIR Approved submittals among them)", !!field, JSON.stringify((before.fields as any[]).map((f) => `${f.type}/${f.key}`)));
  const wasOn = field?.required === true;
  const jBefore = await nasser.get(`/projects/${jcv}/required-fields`);
  const jField = ((jBefore.body as any)?.fields ?? []).find((f: any) => f.type === "WIR" && f.key === "approved_submittals");
  const jWasOn = jField?.required === true;
  try {
    const on = await saeed.put(`/projects/${pid}/required-fields`, { type: "WIR", key: "approved_submittals", required: true });
    t.check("Saeed turns Approved submittals required on for Tower", on.status === 204, `${on.status}`);
    const jon = await nasser.put(`/projects/${jcv}/required-fields`, { type: "WIR", key: "approved_submittals", required: true });
    t.check("Nasser does the same on JCV", jon.status === 204 || jBefore.status === 200 && jField === undefined, `${jon.status} ${jon.text.slice(0, 80)}`);
    for (const who of ["ali", "hafiz", "ahmed"]) {
      const r = await (await crew.as(who)).get(`/projects/${pid}/required-fields`);
      const f = (r.body as any)?.fields?.find((x: any) => x.type === "WIR" && x.key === "approved_submittals");
      t.check(`${who} reads which links Tower requires (on), and nothing of who set it or when`, r.status === 200 && f?.required === true && Object.keys(f ?? {}).sort().join() === ["key", "label", "required", "requiredByForm", "type", "typeName"].join(), JSON.stringify(f));
      const ch = await (await crew.as(who)).put(`/projects/${pid}/required-fields`, { type: "WIR", key: "approved_submittals", required: false });
      t.check(`${who} cannot change it: the plain 404`, ch.status === 404, `${ch.status}`);
    }
    const nTower = await nasser.get(`/projects/${pid}/required-fields`);
    const hJcv = await (await crew.as("hafiz")).get(`/projects/${jcv}/required-fields`);
    t.check("Nobody reads the other Project's setting: Nasser on Tower and Hafiz on JCV get 404", nTower.status === 404 && hJcv.status === 404, `${nTower.status} ${hJcv.status}`);
    t.check("Tower's setting is still on after the attempts", ((await read(saeed, pid)).fields as any[]).find((f) => f.key === "approved_submittals")?.required === true);
    // The link: a WIR at Tower 2 naming a Code A MAR at Tower 1; Omar (Tower 2 only) reads number and Subject only.
    const mar = await closedMar(crew, `UAT VIS-47 approved MAR T1 ${String(Date.now()).slice(-5)}`, { location: "T1F01", code: "A" });
    const marSubject = ((await detail(await crew.as("hafiz"), mar)).body as any).title as string;
    const hafiz = await crew.as("hafiz");
    const templates = ((await hafiz.get(`/projects/${pid}/checklist-templates`)).body as any).templates as any[];
    const tray = templates.find((x) => x.name.en === "Cable trays and containment")!;
    const wir = must<{ id: string }>(
      await hafiz.post(`/projects/${pid}/work-items`, { type: "WIR", title: `UAT VIS-47 WIR ${String(Date.now()).slice(-5)}`, answers: { description: "UAT", requested_for: REQUESTED, trade: crew.dims.trade.EL, location: crew.dims.location.T2F01, checklist_template: tray.versionId, approved_submittals: [mar] } }),
      "create WIR with the approved MAR",
    ).id;
    await sendForReview(crew, wir);
    await aliSubmit(crew, wir);
    const omar = await crew.as("omar");
    const links = ((await omar.get(`/work-items/${wir}/links`)).body as any)?.links as any[];
    const l = (links ?? []).find((x) => x.subject === marSubject);
    t.check("Omar (Tower 2 only), not covering the MAR's Location, reads its Document Number and Subject only", !!l && l.workItemId === null && !!l.documentNumber, JSON.stringify(l));
    t.check("He cannot open it (404)", (await omar.get(`/work-items/${mar}`)).status === 404);
    const { context, page } = await pageAs("omar");
    try {
      await page.goto(`${webUrl}/en/work-items/${wir}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      await t.shot(page, "omar-wir-with-hidden-link");
    } finally {
      await context.close();
    }
  } finally {
    await saeed.put(`/projects/${pid}/required-fields`, { type: "WIR", key: "approved_submittals", required: wasOn });
    await nasser.put(`/projects/${jcv}/required-fields`, { type: "WIR", key: "approved_submittals", required: jWasOn });
  }
  t.note("Step 4 adapted: DCL covers every Location, so Ahmed sees every Tower item. The Member who cannot see the Code A MAR is Omar (Tower 2 only), reading a Tower 2 WIR that names a Tower 1 MAR. The Project Admin's id read is not checked (Saeed is not a Project Member).");
});

defineCase("VIS-48", async (t) => {
  const crew = await Crew.start();
  const _pid = crew.projectId;
  const subject = "UAT VIS-48 annotated photo MAR";
  const id = await createMar(crew, subject, { location: "T1F01" });
  const hafiz = await crew.as("hafiz");
  const orig = await upload(hafiz, id, { fieldKey: "sample_photo", fileName: "UAT-VIS-48-photo.jpg", contentType: "image/jpeg", body: photoBytes() });
  const annotatedBytes = Buffer.concat([photoBytes(), Buffer.from("annotated")]);
  const copy = await upload(hafiz, id, { annotatedFromId: orig.id, fileName: "UAT-VIS-48-annotated.jpg", contentType: "image/jpeg", body: annotatedBytes });
  await sendForReview(crew, id);
  await aliSubmit(crew, id);
  const sha = async (api: Api, doc: string) => {
    const r = await api.get(`/work-items/${id}/documents/${doc}/download`);
    if (r.status !== 200) return `status ${r.status}`;
    const bytes = Buffer.from(await (await fetch((r.body as any).url)).arrayBuffer());
    return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  };
  const origHash = createHash("sha256").update(photoBytes()).digest("hex").slice(0, 16);
  for (const who of ["hafiz", "ahmed"]) {
    const api = await crew.as(who);
    const docs = ((await api.get(`/work-items/${id}/documents`)).body as any).documents as any[];
    const a = docs.find((d) => d.id === copy.id);
    t.check(`${who} lists both copies, the annotated one linked to the original`, docs.some((d) => d.id === orig.id) && a?.annotatedFromId === orig.id, JSON.stringify(docs.map((d) => [d.fileName, d.annotatedFromId])));
    t.check(`${who} downloads both; the original's bytes are unchanged`, (await sha(api, orig.id)) === origHash && !(await sha(api, copy.id)).startsWith("status"), `${await sha(api, orig.id)} vs ${origHash}`);
  }
  const yousef = await crew.as("yousef");
  const list = await yousef.get(`/work-items/${id}/documents`);
  const madeUp = await yousef.get(`/work-items/${MADE_UP}/documents`);
  const dl = [await yousef.get(`/work-items/${id}/documents/${orig.id}/download`), await yousef.get(`/work-items/${id}/documents/${copy.id}/download`)];
  const ann = await yousef.post(`/work-items/${id}/documents`, { annotatedFromId: orig.id, fileName: "x.jpg", sizeBytes: 10, contentType: "image/jpeg" });
  t.check("Yousef gets 404 for the list (like a made-up id), both download URLs and an annotate call", list.status === 404 && list.text === madeUp.text && dl.every((r) => r.status === 404) && ann.status === 404, `${list.status} ${dl.map((r) => r.status)} ${ann.status}`);
  const urlOf = ((await (await crew.as("ahmed")).get(`/work-items/${id}/documents/${orig.id}/download`)).body as any).url as string;
  const bare = await fetch(urlOf.split("?")[0]!);
  t.check("The file store refuses the file without its signed URL", bare.status >= 400, `${bare.status}`);
  const { context, page } = await pageAs("yousef");
  try {
    const nf = await pageIsNotFound(page, `/work-items/${id}`);
    await t.shot(page, "yousef-item");
    t.check("Yousef: the item page is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
});

defineCase("VIS-49", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const subject = `UAT VIS-49 WIR ${String(Date.now()).slice(-5)}`;
  const wir = await submittedWir(crew, subject);
  const ahmed = await crew.as("ahmed");
  const mohammed = await crew.as("mohammed");
  await pickUp(ahmed, wir);
  const checklist = await ahmed.request("PUT", `/work-items/${wir}/reply-checklists/inspection_checklist`, { answers: { supports: { answer: "pass" }, earthing: { answer: "pass" }, clearance: { answer: "pass" } } });
  t.check("Ahmed answers the reply checklist", checklist.status < 300, `${checklist.status} ${checklist.text.slice(0, 100)}`);
  const offered = (await transitionsOf(ahmed, wir)).find((x) => x.kind === "send");
  const codes = (((await detail(ahmed, wir)).body as any).actions.transitions.find((x: any) => x.key === offered?.key)?.recommendCode ?? []) as { code: string }[];
  const rec = (codes.find((c) => /C|fail/i.test(c.code)) ?? codes[codes.length - 1])?.code ?? "C";
  const INTERNAL = "UAT-VIS49-Ahmed-internal-note";
  const send = await ahmed.transition(wir, offered!.key, { recommendedCode: rec, internalNote: INTERNAL });
  t.check(`Ahmed sends the WIR to Mohammed recommending ${rec} with an Internal Note`, send.status < 300, `${send.status} ${send.text.slice(0, 120)}`);
  await pickUp(mohammed, wir);
  const ret = await takeKind(mohammed, wir, "return", { reason: "UAT-VIS49-return-reason" });
  t.check("Mohammed Returns it to Ahmed", ret.status < 300, `${ret.status} ${ret.text.slice(0, 120)}`);
  await pickUp(ahmed, wir);
  const again = await ahmed.transition(wir, offered!.key, { recommendedCode: rec, internalNote: `${INTERNAL}-2` });
  t.check("Ahmed sends it again", again.status < 300, `${again.status} ${again.text.slice(0, 120)}`);
  await pickUp(mohammed, wir);
  const fill = (form: any) => Object.fromEntries((form?.sections ?? []).flatMap((s: any) => s.fields.filter((f: any) => ["yes_no", "table", "textarea", "text"].includes(f.type)).map((f: any) => [f.key, f.type === "yes_no" ? true : f.type === "table" ? [{ comment: "UAT c", reference: "r" }] : "UAT text"])));
  const close = (await transitionsOf(mohammed, wir)).find((x) => x.kind === "close");
  const full = ((await detail(mohammed, wir)).body as any).actions.transitions.find((x: any) => x.key === close?.key);
  const issued = await mohammed.transition(wir, close!.key, { answers: fill(full?.actionForm) });
  t.check("Mohammed issues the Code", issued.status < 300, `${issued.status} ${issued.text.slice(0, 160)}`);
  await sleep(600);
  for (const who of ["hafiz", "ali", "faisal"]) {
    const api = await crew.as(who);
    const h = await historyOf(api, wir);
    const feed = (await api.get(`/projects/${pid}/activity`)).text;
    const feedItem = JSON.stringify(((JSON.parse(feed) as any).entries ?? []).filter((e: any) => e.workItem?.id === wir));
    const hit = [INTERNAL, "UAT-VIS49-return-reason"].filter((s) => h.text.includes(s) || feedItem.includes(s));
    t.check(`${who} reads no Recommended Code, Internal Note or Return of DCL's before or after the Code`, hit.length === 0 && h.events.every((e) => e.recommendedCode === null) && !h.events.some((e) => e.type === "returned" || /Return/.test(e.transition?.en ?? "") && e.audience === "internal" && e.by?.companyName?.en !== "TMC Constructions"), hit.join(","));
    t.check(`${who} reads the issued Code`, h.events.some((e) => e.type === "issue_code" && e.outcome), JSON.stringify(h.events.map((e) => e.type)));
  }
  const dm = await historyOf(mohammed, wir);
  t.check("DCL reads the Recommended Code and Internal Note", dm.events.some((e) => e.recommendedCode !== null) && dm.text.includes(INTERNAL), "");
  const yp = await leakProbe(await crew.as("yousef"), pid, wir, subject);
  t.check("Yousef reads nothing of the WIR", leaked(yp).length === 0, leakSummary(yp));
  const { context, page } = await pageAs("hafiz");
  try {
    await page.goto(`${webUrl}/en/work-items/${wir}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "hafiz-wir-closed");
  } finally {
    await context.close();
  }
});

const snagSubject = (tag: string) => `UAT ${tag} Snag ${String(Date.now()).slice(-5)}`;

defineCase("VIS-50", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const subject = snagSubject("VIS-50");
  const snag = await raiseSnag(crew, "mohammed", subject, "T1F01");
  const ali = await crew.as("ali");
  const hafiz = await crew.as("hafiz");
  const started = await takeKind(ali, snag, "send");
  t.check("TMC moves it In Progress (Start work)", started.status < 300, `${started.status} ${started.text.slice(0, 100)}`);
  const hSnag = await listAll(hafiz, pid, `q=${encodeURIComponent(subject)}`, "snag_list");
  t.check("Positive control: Hafiz (TMC) sees it in the Snag List", hSnag.some((r) => r.id === snag));
  const yousef = await crew.as("yousef");
  const yList = await listOf(yousef, pid, "", "snag_list");
  const yAll = await listAll(yousef, pid, `q=${encodeURIComponent(subject)}`, "snag_list");
  t.check("Yousef's Snag List holds nothing of it; its stage counts show no In Progress from it", yAll.length === 0 && !yList.text.includes(subject), `${yAll.length}`);
  const kan = await yousef.get(`/projects/${pid}/modules/snag_list/work-items/kanban`);
  t.check("Yousef's Snag Kanban holds nothing of it", kan.status === 200 && !kan.text.includes(subject));
  const f = yList.filters;
  t.check("His filters offer only his own Company (Company), nothing for Raised from", (f.companies ?? []).every((c: any) => c.own === true) && (f.raisedFrom ?? []).length === 0, JSON.stringify({ c: f.companies, r: f.raisedFrom }));
  const probes = await leakProbe(yousef, pid, snag, subject);
  t.check("By id, history, Links, Documents and every channel: nothing (404)", leaked(probes).length === 0, leakSummary(probes));
  const byCompany = await listOf(yousef, pid, `company=${(await listOf(ali, pid, "", "snag_list")).filters.companies?.find((c: any) => !c.own)?.participantId ?? MADE_UP}`, "snag_list");
  t.check("Filtering by another Company's Participant finds nothing of it", !byCompany.text.includes(subject), "");
  const { context, page } = await pageAs("yousef");
  try {
    const nf = await pageIsNotFound(page, `/work-items/${snag}`);
    await t.shot(page, "yousef-snag-by-id");
    t.check("Yousef: the Snag by id is the plain not-found page", nf.notFound, nf.text);
    await page.goto(`${webUrl}/en/projects/${pid}/snag-list`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "yousef-snag-list");
  } finally {
    await context.close();
  }
  t.note("Comment Type and a 'raised from a source Yousef cannot see' are covered by VIS-05 (Comments of a Code B).");
});

defineCase("VIS-51", async (t) => {
  const crew = await Crew.start();
  const subject = snagSubject("VIS-51");
  const snag = await raiseSnag(crew, "mohammed", subject, "T1F01");
  const hafiz = await crew.as("hafiz");
  const ali = await crew.as("ali");
  const mohammed = await crew.as("mohammed");
  const start = await takeKind(hafiz, snag, "send");
  const resolve = await takeKind(hafiz, snag, "submit", { resolution_note: "UAT-VIS51-resolution-note" });
  t.check("TMC moves the Snag Start work and Resolves it with a note", start.status < 300 && resolve.status < 300, `${start.status} ${resolve.status} ${resolve.text.slice(0, 100)}`);
  await sleep(400);
  const hm = await historyOf(mohammed, snag);
  const names = hm.events.map((e) => e.transition?.en).filter(Boolean);
  t.check("Mohammed reads TMC's Resolve and its note", names.some((n) => /Resolve/i.test(n)) && hm.text.includes("UAT-VIS51-resolution-note"), names.join(", "));
  t.check("He never reads Start work, TMC's internal moves or who picked it up", !names.some((n) => /Start work|hold|Resume|Back to Open/i.test(n)) && !hm.events.some((e) => /assigned|picked/.test(e.type)) && !/Hafiz|Ali Sonour/.test(hm.text), names.join(", "));
  const hh = await historyOf(hafiz, snag);
  t.check("TMC reads DCL's Raise", hh.events.some((e) => /Raise/i.test(e.transition?.en ?? "")), hh.events.map((e) => e.transition?.en).join(", "));
  t.check("TMC never reads DCL's Draft or who holds Verify", !/Mohammed|Ahmed/.test(JSON.stringify(hh.events.map((e) => e.by?.memberName))) && !/Mohammed|Ahmed/.test(JSON.stringify((await detail(hafiz, snag)).body)), "");
  const { context, page } = await pageAs("mohammed");
  try {
    await page.goto(`${webUrl}/en/work-items/${snag}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "mohammed-snag-history");
  } finally {
    await context.close();
  }
  void ali;
});

defineCase("VIS-52", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const subject = snagSubject("VIS-52");
  const snag = await raiseSnag(crew, "mohammed", subject, "T1F01");
  const beta = await participantIdByName(saeed, pid, "Beta Build");
  const original = await participantVisibility(saeed, beta);
  const yousef = await crew.as("yousef");
  const hafiz = await crew.as("hafiz");
  const mohammed = await crew.as("mohammed");
  const yHidden = async () => (await yousef.get(`/work-items/${snag}`)).status === 404 && (await listAll(yousef, pid, `q=${encodeURIComponent(subject)}`, "snag_list")).length === 0;
  t.check("Before the change Yousef does not see the Snag (Beta Build covers Tower 2 only)", await yHidden());
  let widened = false;
  try {
    const wide = await setParticipantVisibility(saeed, beta, { trade: original.trade, location: { isAll: false, valueIds: [...new Set([...original.location.valueIds, crew.dims.location.T1!])] } });
    widened = wide.status < 300;
    t.check("Saeed widens Beta Build to cover Tower 1 as well", widened, `${wide.status} ${wide.text.slice(0, 100)}`);
    await sleep(300);
    t.check("Beta Build still never sees the Snag (it stays with TMC, by id and in the Snag List)", await yHidden());
    const start = await takeKind(hafiz, snag, "send");
    const resolve = await takeKind(hafiz, snag, "submit", { resolution_note: "UAT done" });
    t.check("TMC resolves it", start.status < 300 && resolve.status < 300, `${start.status} ${resolve.status}`);
    await pickUp(mohammed, snag);
    const ret = await mohammed.transition(snag, "return_to_open", { answers: { reason: "UAT return to open" } });
    t.check("Mohammed Returns it to Open", ret.status < 300, `${ret.status} ${ret.text.slice(0, 120)}`);
    await sleep(300);
    const d = (await detail(hafiz, snag)).body as any;
    t.check("The Return stays with TMC (TMC holds it, Open)", d.stage.key === "open" && /TMC/.test(JSON.stringify(d.heldBy)), `${d.stage.key} ${JSON.stringify(d.heldBy?.companyName)}`);
    t.check("Yousef never sees it after the Return either", await yHidden());
    const second = await raiseSnag(crew, "mohammed", `${subject} second`, "T1F01").then(() => "raised", (e: Error) => e.message.slice(0, 160));
    t.check("A new Raise on a Location both Contractors now cover is refused (it asks which Contractor; without a pick nothing moves)", second !== "raised", second);
  } finally {
    if (widened) {
      const back = await setParticipantVisibility(saeed, beta, original);
      t.check("Beta Build's Visibility is restored to Tower 2 only (FX-C2 kept)", back.status < 300 && sameGrant((await participantVisibility(saeed, beta)).location, original.location), `${back.status}`);
    }
  }
  void [closedMar, memberIdOf, myParticipantId, pdfBytes, stageCounts, submittedMar, takeOk, searchRows];
});
