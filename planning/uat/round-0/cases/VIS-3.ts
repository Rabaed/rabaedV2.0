/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { defineCase } from "../harness/case.ts";
import { pageAs, webUrl } from "../harness/browser.ts";
import { Api } from "../harness/helpers.ts";
import { bindSendBack } from "../harness/fixtures-sb.ts";
import {
  Crew, ahmedSendsToManager, aliSubmit, closedMar, createMar, detail, expectVisible, historyOf, leakProbe, leakSummary, leaked, listOf, listAll, must, pageIsNotFound,
  photoBytes, pdfBytes, pickUp, searchRows, sendForReview, sleep, submittedMar, takeKind, takeOk, transitionsOf, upload,
} from "../harness/helpers-vis.ts";

// VIS-13 .. VIS-19: Revisions across Locations, Send Back, dates, Step Age, Dashboard, List and Kanban.

const marCard = async (api: Api, pid: string) => {
  const d = (await api.get(`/projects/${pid}/dashboard`)).body as any;
  const card = d.modules.find((m: any) => m.key === "submittals").cards.find((c: any) => c.type.code === "MAR");
  const bar = (b: string) => card.bars.find((x: any) => x.bucket === b)?.count ?? 0;
  return { pending: bar("pending"), inPrep: card.inPreparation?.count ?? 0, total: card.total.count, line: card.revisionLine ? { total: card.revisionLine.total.count, awaiting: card.revisionLine.awaitingRevision.count, split: card.revisionLine.split ? { none: card.revisionLine.split.noRevisionYet.count, inProgress: card.revisionLine.split.revisionInProgress.count } : null } : null };
};

defineCase("VIS-13", async (t) => {
  const crew = await Crew.start();
  const s = "UAT VIS-13 Tower 1 MAR";
  const orig = await closedMar(crew, s, { location: "T1F01", code: "C" });
  const hafiz = await crew.as("hafiz");
  const rev = must<{ id: string }>(await hafiz.post(`/work-items/${orig}/revisions`, { idempotencyKey: crypto.randomUUID() }), "create Revision").id;
  const d0 = (await detail(hafiz, rev)).body as any;
  const moved = await hafiz.put(`/work-items/${rev}/answers`, { answers: { ...d0.answers, location: crew.dims.location.T2F01, related_submittals: [orig] } });
  t.check("Hafiz moves Rev 1 to Tower 2 and names the original in the link question", moved.status < 300, `${moved.status} ${moved.text.slice(0, 200)}`);
  await sendForReview(crew, rev);
  await aliSubmit(crew, rev);
  const faisal = await crew.as("faisal");
  const noura = await crew.as("noura");
  const chain = async (api: Api, id: string) => ((await api.get(`/work-items/${id}/revisions`)).body as any)?.revisions ?? [];
  // Faisal (Tower 1): original yes, Rev 1 no.
  await expectVisible(t, crew, "faisal", orig, s, "(the original, Tower 1)");
  const fc = await chain(faisal, orig);
  t.check("Faisal's drop-down lists the original only", fc.length === 1 && fc[0].id === orig, JSON.stringify(fc));
  const fl = await faisal.get(`/work-items/${orig}/links`);
  const ff = await faisal.get(`/work-items/${orig}/linked-from`);
  t.check("Faisal: the original has no Link to Rev 1 and no Linked from naming it", !fl.text.includes(rev) && !ff.text.includes(rev) && !ff.text.includes("Rev 1"), `${fl.text.slice(0, 100)} ${ff.text.slice(0, 100)}`);
  t.check("Faisal gets 404 for Rev 1", (await faisal.get(`/work-items/${rev}`)).status === 404);
  // Noura (Tower 2): Rev 1 yes, the original no.
  await expectVisible(t, crew, "noura", rev, s, "(Rev 1, now Tower 2)");
  const nd = await noura.get(`/work-items/${rev}`);
  const nl = await noura.get(`/work-items/${rev}/links`);
  const nf = await noura.get(`/work-items/${rev}/linked-from`);
  const hasOriginal = (txt: string) => txt.includes(orig);
  t.check("Noura: Rev 1 shows no Link, no Linked from and no link answer naming the original (its id is nowhere; no Link entry)", !hasOriginal(nd.text) && !hasOriginal(nl.text) && !hasOriginal(nf.text) && ((nl.body as any)?.links ?? []).length === 0 && ((nf.body as any)?.items ?? []).length === 0, `${nd.status} links ${nl.text.slice(0, 80)} from ${nf.text.slice(0, 60)}`);
  const nc = await chain(noura, rev);
  t.check("Noura's drop-down lists Rev 1 only", nc.length === 1 && nc[0].id === rev, JSON.stringify(nc));
  t.check("Noura gets 404 for the original", (await noura.get(`/work-items/${orig}`)).status === 404);
  const probes = await leakProbe(noura, crew.projectId, orig, "NO-SUCH-SUBJECT-VIS13");
  t.check("Noura finds nothing of the original in any channel", leaked(probes).length === 0, leakSummary(probes));
  const probesF = await leakProbe(faisal, crew.projectId, rev, "NO-SUCH-SUBJECT", []);
  t.check("Faisal finds nothing of Rev 1 in any channel", leaked(probesF).length === 0, leakSummary(probesF));
  const { context, page } = await pageAs("noura");
  try {
    const r = await pageIsNotFound(page, `/work-items/${orig}`);
    await t.shot(page, "noura-original-by-id");
    t.check("Noura: the original's URL is the plain not-found page", r.notFound, r.text);
  } finally {
    await context.close();
  }
});

const sendBackBody = async (t: any, mode: "comment" | "edit_form") => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const tag = mode === "comment" ? "VIS-14" : "VIS-15";
  const sX = `UAT ${tag} linked item X`;
  const sY = `UAT ${tag} linked item Y`;
  const s = `UAT ${tag} Sent Back MAR`;
  const x = await submittedMar(crew, sX, { location: "T1F01" });
  const y = await submittedMar(crew, sY, { location: "T1F01" });
  const hafiz = await crew.as("hafiz");
  const id = await createMar(crew, s, { location: "T1F01" });
  must(await hafiz.post(`/work-items/${id}/links`, { workItemId: x }), "link X");
  await sendForReview(crew, id);
  await aliSubmit(crew, id);
  const mohammed = await crew.as("mohammed");
  const faisal = await crew.as("faisal");
  const noura = await crew.as("noura");
  // The Send Back.
  const ahmed = await crew.as("ahmed");
  const sent = await takeKind(ahmed, id, "send_back");
  t.check("Ahmed Sends the Submitted MAR Back", sent.status < 300, `${sent.status} ${sent.text.slice(0, 160)}`);
  await sleep(300);
  const snapshot = async (api: Api) => {
    const d = (await detail(api, id)).body as any;
    const docs = (await api.get(`/work-items/${id}/documents`)).body as any;
    const links = (await api.get(`/work-items/${id}/links`)).body as any;
    const h = await historyOf(api, id);
    return JSON.stringify({ title: d?.title, trade: d?.trade?.code, location: d?.location?.code, scopes: d?.scopes, answers: d?.answers, docs: (docs?.documents ?? []).map((x: any) => x.id), links: (links?.links ?? []).map((l: any) => l.subject), events: h.events.length });
  };
  const bell = async (api: Api) => JSON.stringify((((await api.get("/notifications")).body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id).map((n: any) => n.kind));
  await sleep(5000);
  const before: Record<string, string> = {};
  const bellBefore: Record<string, string> = {};
  for (const [who, api] of [["mohammed", mohammed], ["faisal", faisal]] as const) {
    before[who] = await snapshot(api);
    bellBefore[who] = await bell(api);
  }
  t.check("Mohammed and Faisal still see the sent-back item (positive control)", before.mohammed!.includes(`"title":"${s}"`) && before.faisal!.includes(`"title":"${s}"`));
  const dH = (await detail(hafiz, id)).body as any;
  t.check(`Hafiz's item says it is back with him${mode === "comment" ? " for comment (sentBackForComment)" : ""}`, mode === "comment" ? dH.sentBackForComment === true : dH.sentBackForComment === false, `sentBackForComment ${dH.sentBackForComment}; step ${dH.step?.key}`);
  const original = dH.answers;
  const newDocs: string[] = [];
  if (mode === "comment") {
    const put = await hafiz.put(`/work-items/${id}/answers`, { answers: { ...original, description: "UAT changed after the Send Back" } });
    t.check("Hafiz cannot change an answer (Sent back for comment)", put.status >= 400, `${put.status} ${put.text.slice(0, 120)}`);
    const up = await hafiz.post(`/work-items/${id}/documents`, { fieldKey: "test_certificate", fileName: "UAT-new.pdf", sizeBytes: 800, contentType: "application/pdf" });
    t.check("Hafiz cannot add a Document", up.status >= 400, `${up.status} ${up.text.slice(0, 120)}`);
    const lk = await hafiz.post(`/work-items/${id}/links`, { workItemId: y });
    t.check("Hafiz cannot add a Link", lk.status >= 400, `${lk.status} ${lk.text.slice(0, 120)}`);
  } else {
    const put = await hafiz.put(`/work-items/${id}/answers`, { answers: { ...original, description: "UAT changed after the Send Back", location: crew.dims.location.T2F01 } });
    t.check("Hafiz changes an answer and moves the item to Tower 2 (Edit the Form)", put.status < 300, `${put.status} ${put.text.slice(0, 160)}`);
    for (const [fieldKey, fileName, contentType, body] of [
      ["datasheet", "UAT-new-datasheet.pdf", "application/pdf", pdfBytes("new datasheet")],
      ["test_certificate", "UAT-new-cert.pdf", "application/pdf", pdfBytes("new certificate")],
      ["sample_photo", "UAT-new-photo.jpg", "image/jpeg", photoBytes()],
    ] as const) {
      const r = await upload(hafiz, id, { fieldKey, fileName, contentType, body }).then((d) => d.id, () => "");
      if (r) newDocs.push(r);
    }
    t.check("Hafiz adds a datasheet, a Document and a photo", newDocs.length === 3, `${newDocs.length} uploaded`);
    const del = await hafiz.request("DELETE", `/work-items/${id}/links/${(((await hafiz.get(`/work-items/${id}/links`)).body as any).links.find((l: any) => l.subject === sX) ?? {}).id}`);
    const add = await hafiz.post(`/work-items/${id}/links`, { workItemId: y });
    t.check("Hafiz swaps a Link from X to Y", del.status === 204 && add.status === 201, `${del.status} ${add.status}`);
  }
  await sleep(300);
  const during: Record<string, string> = {};
  for (const [who, api] of [["mohammed", mohammed], ["faisal", faisal]] as const) during[who] = await snapshot(api);
  for (const who of ["mohammed", "faisal"]) t.check(`${who} reads the item exactly as at the Send Back (answers, Documents, Links, Trade, Location, Scopes, history)`, before[who] === during[who], before[who] === during[who] ? "identical" : `before ${before[who]!.slice(0, 300)} | during ${during[who]!.slice(0, 300)}`);
  if (mode === "edit_form") {
    for (const doc of newDocs) {
      const r = await mohammed.get(`/work-items/${id}/documents/${doc}/download`);
      t.check("A new Document is 404 for Mohammed", r.status === 404, `${r.status}`);
    }
    await expectVisible(t, crew, "faisal", id, s, "(Tower 1 as at the Send Back)");
    t.check("Noura (Tower 2) does not see the item before the Submit", (await noura.get(`/work-items/${id}`)).status === 404);
  }
  // Observers still find it by search and in Link search, and in Linked from of what it links.
  const ls = await mohammed.get(`/projects/${pid}/work-items/link-search?q=${encodeURIComponent(s)}`);
  t.check("The sent-back item is still offered in Mohammed's Link search", (ls.body as any)?.links?.some((l: any) => l.id === id), ls.text.slice(0, 150));
  const lf = (await mohammed.get(`/work-items/${mode === "comment" ? x : x}/linked-from`)).body as any;
  t.check(`The sent-back item is still in Linked from of X, with the same number and Subject`, (lf?.items ?? []).some((i: any) => i.subject === s && !!i.documentNumber), JSON.stringify(lf).slice(0, 200));
  await sleep(5000);
  for (const [who, api] of [["mohammed", mohammed], ["faisal", faisal]] as const) t.check(`${who}'s bell shows no change of the item while it is with the raiser`, (await bell(api)) === bellBefore[who], `${bellBefore[who]} / ${await bell(api)}`);
  const { context, page } = await pageAs("mohammed");
  try {
    await page.goto(`${webUrl}/en/work-items/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await t.shot(page, "mohammed-item-while-sent-back");
  } finally {
    await context.close();
  }
  // Hafiz Submits again.
  const mine = await transitionsOf(hafiz, id);
  const go = mine.find((tr) => tr.kind === "submit") ?? mine.find((tr) => tr.kind === "send");
  t.check("Hafiz can send the item on again", !!go, mine.map((m) => m.key).join(","));
  if (go) {
    await takeOk(hafiz, id, go.key);
    if (go.kind === "send") await aliSubmit(crew, id);
  }
  await sleep(500);
  const after = await snapshot(mohammed);
  if (mode === "comment") {
    t.check("After the new Submit Mohammed reads the item and its new history entries", after.includes(`"title":"${s}"`) && JSON.parse(after).events > JSON.parse(before.mohammed!).events, after.slice(0, 200));
  } else {
    const a = JSON.parse(after);
    t.check("After the new Submit Mohammed reads the new values: Tower 2, the new answer, the three new Documents, Link Y", a.location === "T2F01" && a.answers.description === "UAT changed after the Send Back" && a.docs.length === JSON.parse(before.mohammed!).docs.length + 3 && a.links.includes(sY) && !a.links.includes(sX), JSON.stringify({ l: a.location, d: a.docs.length, links: a.links }));
    t.check("Faisal (Tower 1) loses the item after the Submit", (await faisal.get(`/work-items/${id}`)).status === 404);
    await expectVisible(t, crew, "noura", id, s, "(Tower 2 after the Submit)");
    for (const doc of newDocs) t.check("Mohammed now downloads the new Document", (await mohammed.get(`/work-items/${id}/documents/${doc}/download`)).status === 200);
  }
};

defineCase("VIS-14", async (t) => {
  await sendBackBody(t, "comment");
  t.note("UAT Owner PM observer not covered: FX-OW is not applied. Faisal covers Tower 1 only (FX-OR) and the item is at Tower 1.");
});

defineCase("VIS-15", async (t) => {
  const saeed = await Api.as("saeed");
  const crew = await Crew.start();
  await bindSendBack(saeed, crew.projectId, "edit_form");
  try {
    await sendBackBody(t, "edit_form");
  } finally {
    await bindSendBack(saeed, crew.projectId, "comment");
  }
  t.note("The MAR was bound to the Edit the Form Workflow copy for this case and switched back to Comment only afterwards. UAT Owner PM not covered: FX-OW is not applied. The checklist photo of the Test Case is a sample_photo here (the MAR Form has no checklist).");
});

defineCase("VIS-16", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const sa = "UAT VIS-16 a Draft";
  const sb = "UAT VIS-16 b Draft";
  const sc = "UAT VIS-16 c Submitted";
  const draftB = await createMar(crew, sb, { location: "T2F01" });
  const draftA = await createMar(crew, sa, { location: "T2F01" });
  const id = await submittedMar(crew, sc, { location: "T2F01" });
  const hafiz = await crew.as("hafiz");
  const ahmed = await crew.as("ahmed");
  const rowOf = async (api: Api, subject: string) => (await searchRows(api, pid, subject)).find((r) => r.id === id);
  const h = await rowOf(hafiz, sc);
  const a = await rowOf(ahmed, sc);
  t.check("TMC (Hafiz) sees the Creation Date and the Submission Date", !!h?.creationDate && !!h?.submissionDate, JSON.stringify({ c: h?.creationDate, s: h?.submissionDate }));
  t.check("DCL (Ahmed) sees only the Submission Date, no Creation Date in the List row", !!a?.submissionDate && a?.creationDate === null, JSON.stringify({ c: a?.creationDate, s: a?.submissionDate }));
  const dh = (await detail(hafiz, id)).body as any;
  const da = (await detail(ahmed, id)).body as any;
  t.check("On the item page TMC reads both dates; DCL reads no Creation Date", !!dh.creationDate && !!dh.submissionDate && da.creationDate === null && !!da.submissionDate, JSON.stringify({ h: dh.creationDate, a: da.creationDate }));
  const daText = JSON.stringify(da) + (await (await crew.as("ahmed")).get(`/work-items/${id}/history`)).text;
  t.check("No Creation Date of TMC anywhere in DCL's reads of the item", !daText.includes(dh.creationDate), "");
  const rows = await listAll(hafiz, pid, "");
  const first = rows.findIndex((r) => r.documentNumber === null);
  const tail = first === -1 ? [] : rows.slice(first);
  t.check("Un-numbered Drafts come last in Hafiz's List", first !== -1 && tail.every((r) => r.documentNumber === null), `${rows.length} rows, first Draft at ${first}`);
  const mine = tail.filter((r) => r.title === sa || r.title === sb).map((r) => r.title);
  const subjects = tail.map((r) => r.title);
  const sorted = [...subjects].sort();
  t.check("The un-numbered Drafts are ordered by Subject", JSON.stringify(subjects) === JSON.stringify(sorted) && mine.filter((x, i) => mine.indexOf(x) === i).join() === [sa, sb].join(), `${subjects.slice(0, 6).join(" | ")}`);
  const version = (u: string) => u[14];
  t.check("Ids carry no time: item ids are random (version 4), not time-ordered", [id, draftA, draftB].every((u) => version(u) === "4"), [id, draftA, draftB].map(version).join(","));
  const { context, page } = await pageAs("ahmed");
  try {
    await page.goto(`${webUrl}/en/work-items/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await t.shot(page, "ahmed-item-dates");
  } finally {
    await context.close();
  }
  if (t instanceof Object && (t as any).checks?.some((c: any) => !c.ok)) return;
  t.blocked("The checks above passed (dates by Company, no time in ids, Draft order). The rest needs the AGE fixture (RP-922, pnpm uat:age, not in this worktree): answer times and Saved read the Creation Date or later; a Revision follows its own Creation Date.");
});

defineCase("VIS-17", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const s = "UAT VIS-17 Step Age per Company";
  const id = await submittedMar(crew, s, { location: "T2F01" });
  const ali = await crew.as("ali");
  const ahmed = await crew.as("ahmed");
  const mohammed = await crew.as("mohammed");
  const rowOf = async (api: Api) => (await searchRows(api, pid, s)).find((r) => r.id === id)!;
  const aliAtSubmit = await rowOf(ali);
  t.check("Ali reads With Design Consultants LLC after the Submit", aliAtSubmit.with?.kind === "company" && /Design Consultants/.test(aliAtSubmit.with.companyName.en), JSON.stringify(aliAtSubmit.with));
  t.check("Ali's Step Age is week 1, counted from the Submit", aliAtSubmit.stepAgeWeeks === 1 && aliAtSubmit.stepEnteredAt === aliAtSubmit.submissionDate, `${aliAtSubmit.stepAgeWeeks} ${(aliAtSubmit as any).stepEnteredAt} ${aliAtSubmit.submissionDate}`);
  await pickUp(ahmed, id);
  await takeOk(ahmed, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true, verification_note: "UAT" }, recommendedCode: "A", internalNote: "UAT" });
  await pickUp(mohammed, id);
  const ret = await takeKind(mohammed, id, "return", { reason: "UAT return to Ahmed" });
  t.check("Ahmed sends to Manager and Mohammed Returns it to Ahmed", ret.status < 300, `${ret.status} ${ret.text.slice(0, 120)}`);
  await sleep(300);
  const aliAfter = await rowOf(ali);
  t.check("Ali still reads With Design Consultants LLC: no Step, no person, no internal move", aliAfter.with?.kind === "company" && !("step" in (aliAfter.with as object)) && !JSON.stringify(aliAfter.with).includes("Ahmed") && !JSON.stringify(aliAfter.with).includes("Mohammed"), JSON.stringify(aliAfter.with));
  t.check("Ali's Step Age is unchanged: no reset by DCL's internal moves", aliAfter.stepEnteredAt === aliAtSubmit.stepEnteredAt && aliAfter.stepAgeWeeks === aliAtSubmit.stepAgeWeeks, `${(aliAfter as any).stepEnteredAt} / ${(aliAtSubmit as any).stepEnteredAt}`);
  const _aliText = JSON.stringify(((await ali.get(`/work-items/${id}/workflow`)).body as any)) + (await historyOf(ali, id)).text;
  t.check("Neither the workflow map nor the history shows Ali a DCL Step or person", !/Ahmed|Mohammed|Consultant Engineer|Consultant Manager/.test(JSON.stringify(((await ali.get(`/work-items/${id}/workflow`)).body as any)?.current ?? "")) && !(await historyOf(ali, id)).text.match(/Ahmed|Mohammed/), "");
  const dcl = await rowOf(ahmed);
  t.check("DCL's Step Age runs from when the item reached DCL (week 1, Ahmed holds it again after the Return)", dcl.stepAgeWeeks === 1 && dcl.with?.kind === "own", JSON.stringify({ w: dcl.stepAgeWeeks, with: dcl.with?.kind }));
  const { context, page } = await pageAs("ali");
  try {
    await page.goto(`${webUrl}/en/work-items/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await t.shot(page, "ali-item-with-dcl");
  } finally {
    await context.close();
  }
  if ((t as any).checks?.some((c: any) => !c.ok)) return;
  t.blocked("The checks above passed (With by Company, no reset by DCL's internal moves, DCL week 1). The 5-weeks-inside-TMC and four-weeks-later parts need the AGE fixture (RP-922, pnpm uat:age), which is not in this worktree.");
});

defineCase("VIS-18", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const ali = await crew.as("ali");
  const ahmed = await crew.as("ahmed");
  const yousef = await crew.as("yousef");
  const base = { ali: await marCard(ali, pid), ahmed: await marCard(ahmed, pid), yousef: await marCard(yousef, pid) };
  t.check("Yousef's MAR card: no Pending, no TMC chain", base.yousef.pending === 0, JSON.stringify(base.yousef));
  t.check("Ahmed has no In preparation figure (never sees a Draft)", base.ahmed.inPrep === 0, JSON.stringify(base.ahmed));
  const tag = Date.now();
  await createMar(crew, `UAT VIS-18 Draft one ${tag}`, { location: "T2F01" });
  const two = await createMar(crew, `UAT VIS-18 Draft two ${tag}`, { location: "T2F01" });
  await sendForReview(crew, two);
  await sleep(500);
  const mid = { ali: await marCard(ali, pid), ahmed: await marCard(ahmed, pid), yousef: await marCard(yousef, pid) };
  const _mineIn = await listOf(ali, pid, "bucket=in_preparation&q=" + encodeURIComponent(`UAT VIS-18 Draft ${""}`) + "");
  const countOf = async (api: Api, bucket: string) => (await listOf(api, pid, `bucket=${bucket}&q=${encodeURIComponent("UAT VIS-18 Draft")}`, "", false)).items.filter((r) => r.title.endsWith(String(tag))).length;
  t.check("After two more Drafts and one sent for review: both count In preparation for Ali (and neither counts Pending)", (await countOf(ali, "in_preparation")) === 2 && (await countOf(ali, "pending")) === 0 && mid.ali.inPrep - base.ali.inPrep >= 2 && mid.ali.pending === base.ali.pending, `in_prep list ${await countOf(ali, "in_preparation")}, pending list ${await countOf(ali, "pending")}; card ${JSON.stringify(base.ali)} -> ${JSON.stringify(mid.ali)} (other UAT agents add items at the same time)`);
  t.check("Ahmed and Yousef see neither of the two in any bucket", (await countOf(ahmed, "in_preparation")) + (await countOf(ahmed, "pending")) + (await countOf(yousef, "in_preparation")) + (await countOf(yousef, "pending")) === 0);
  t.check("Ahmed's and Yousef's cards are unchanged by them", mid.ahmed.pending === base.ahmed.pending && mid.ahmed.inPrep === 0 && JSON.stringify(mid.yousef) === JSON.stringify(base.yousef), `${JSON.stringify(mid.ahmed)} ${JSON.stringify(mid.yousef)}`);
  // A Code C and the Revision line.
  const codeCTitle = `UAT VIS-18 Code C ${Date.now()}`;
  const orig = await closedMar(crew, codeCTitle, { location: "T2F01", code: "C" });
  const hafiz = await crew.as("hafiz");
  const preRev = { ali: await marCard(ali, pid), ahmed: await marCard(ahmed, pid), yousef: await marCard(yousef, pid) };
  const _rev = must<{ id: string }>(await hafiz.post(`/work-items/${orig}/revisions`, { idempotencyKey: crypto.randomUUID() }), "Revision").id;
  await sleep(500);
  const post = { ali: await marCard(ali, pid), ahmed: await marCard(ahmed, pid), yousef: await marCard(yousef, pid) };
  t.check("TMC's card splits awaiting revision into a Revision in progress; DCL's card shows awaiting revision with no split", (post.ali.line?.split?.inProgress ?? 0) - (preRev.ali.line?.split?.inProgress ?? 0) === 1 && post.ahmed.line !== null && post.ahmed.line.split === null, JSON.stringify({ ali: post.ali.line, ahmed: post.ahmed.line }));
  const chainRows = await listOf(ali, pid, "q=" + encodeURIComponent(codeCTitle), "", false);
  t.check("Each chain counts once: the Code C chain and its Revision Draft are one row in Ali's List and add no Pending", chainRows.items.length === 1 && post.ali.pending === preRev.ali.pending, `${chainRows.items.length} rows; pending ${preRev.ali.pending}->${post.ali.pending}`);
  t.check("Yousef's Revision line holds nothing of TMC", post.yousef.line === null, JSON.stringify(post.yousef.line));
  t.check("Yousef's card is exactly as before (his own Drafts only; nothing of TMC)", JSON.stringify(post.yousef) === JSON.stringify(base.yousef) && post.yousef.pending === 0, JSON.stringify(post.yousef));
  const { context, page } = await pageAs("yousef");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "yousef-dashboard");
  } finally {
    await context.close();
  }
  t.note("The Fresh-seed absolute figures of the Test Case (Ali Pending 2, In preparation 1) are not asserted: other UAT agents add items at the same time. The deltas are.");
});

defineCase("VIS-19", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const sSub = "UAT VIS-19 picked up by Mohammed";
  const sInt = "UAT VIS-19 in TMC internal review";
  const sub = await submittedMar(crew, sSub, { location: "T2F01" });
  await ahmedSendsToManager(crew, sub, "A");
  const internal = await createMar(crew, sInt, { location: "T2F01" });
  await sendForReview(crew, internal);
  const ali = await crew.as("ali");
  const ahmed = await crew.as("ahmed");
  const yousef = await crew.as("yousef");
  const al = await listOf(ali, pid, "");
  const ah = await listOf(ahmed, pid, "");
  const names = (l: any) => (l.filters.owners ?? []).map((o: any) => o.name.en);
  t.check("Ali's Owner filter offers TMC people and no DCL person", names(al).includes("Ali Sonour") && !names(al).some((n: string) => /Ahmed|Mohammed|Sara|Layla/.test(n)), names(al).join(", "));
  t.check("Ali's Owner filter names the other Company by name only (DCL)", (al.filters.with.companies ?? []).some((c: any) => /Design Consultants/.test(c.name.en)), JSON.stringify(al.filters.with.companies));
  t.check("Ahmed's Owner filter offers DCL people and no TMC person", names(ah).includes("Mohammed Al Shamsi") && !names(ah).some((n: string) => /Ali|Hafiz|Omar|Saeed/.test(n)), names(ah).join(", "));
  const dclPerson = (ah.filters.owners ?? []).find((o: any) => /Mohammed/.test(o.name.en));
  const mOwn = await listOf(ali, pid, `owner=${dclPerson?.memberId}`);
  t.check("Ali filtering by a DCL person finds nothing", mOwn.items.length === 0, `${mOwn.status} ${mOwn.items.length} rows`);
  const roleOf = (l: any) => (l.filters.with.steps ?? []).map((s: any) => s.key);
  t.check("Role offers only the viewer's own Steps: Ali sees no Consultant Step; Ahmed no Contractor Step", !roleOf(al).some((k: string) => k.startsWith("consultant")) && !roleOf(ah).some((k: string) => /contractor|internal_review|draft/.test(k)), `${roleOf(al)} | ${roleOf(ah)}`);
  const k = async (api: Api) => ((await api.get(`/projects/${pid}/work-items/kanban`)).body as any).columns as any[];
  const ac = await k(ali);
  const ic = ac.find((c) => c.stageKey === "internal_review");
  t.check("TMC's Internal Review column names its Steps with counts", ic.steps.length > 0 && ic.steps.every((x: any) => typeof x.count === "number" && x.name?.en), JSON.stringify(ic.steps));
  const dc = await k(ahmed);
  const dic = dc.find((c) => c.stageKey === "internal_review");
  t.check("DCL (Ahmed) sees no Step of TMC's Internal Review column", dic.steps.length === 0 && dic.shown === 0, JSON.stringify(dic));
  const pc = ac.find((c) => c.stageKey === "pending_approval");
  t.check("Ali's Pending Approval lane is DCL by name only (no Step, no person)", pc.steps.length === 0 && pc.lanes.every((l: any) => l.kind === "company" && l.cards.every((c: any) => c.with?.kind === "company" && !("step" in c.with) && !("holder" in c.with))), JSON.stringify(pc.lanes.map((l: any) => [l.kind, l.companyName?.en])));
  const adm = (await searchRows(ahmed, pid, sSub)).find((r) => r.id === sub);
  t.check("Created date for DCL is the Submission Date (no Creation Date in its rows)", ah.items.every((r) => r.creationDate === null) && !!adm?.submissionDate, "");
  const created = await listOf(ahmed, pid, "createdWithin=7&q=" + encodeURIComponent(sSub));
  t.check("DCL's Created date filter works on the Submission Date (the new Submitted item is found)", created.items.some((r) => r.id === sub), `${created.items.length} rows`);
  const yl = await listOf(yousef, pid, "");
  t.check("Yousef's List counts cover only Beta Build items (no TMC or DCL row)", yl.items.every((r) => (r as any).raiserCompanyName?.en === "Beta Build" || r.raiserCompanyName?.en === undefined) && !yl.text.includes("UAT VIS-19"), `${yl.items.length} rows`);
  const yk = (await yousef.get(`/projects/${pid}/work-items/kanban`)).text;
  t.check("Yousef's Kanban holds none of it, and no TMC or DCL Step names", !yk.includes("UAT VIS-19") && !/Contractor PM|Consultant Engineer|Consultant Manager/.test(yk), "");
  const { context, page } = await pageAs("ali");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/work-items?view=kanban`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await t.shot(page, "ali-kanban");
  } finally {
    await context.close();
  }
});
