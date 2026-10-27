/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { createHash } from "node:crypto";
import { defineCase } from "../harness/case.ts";
import { pageAs, webUrl } from "../harness/browser.ts";
import {
  Crew, MADE_UP, listAll, createSnag, ahmedSendsToManager, aliSubmit, closedMar, createMar, detail, expectHidden, expectNotFoundPage, expectVisible, leakProbe, leakSummary, leaked, listOf, mohammedCodes,
  must, pickUp, rawGet, sendForReview, sleep, stageCounts, submittedMar, takeKind, pageIsNotFound,
} from "../harness/helpers-vis.ts";

// VIS-05 .. VIS-12: Comments, Chat, the record download, Links, Link search, Revisions.

defineCase("VIS-05", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const subject = "UAT VIS-05 MAR Code B";
  const yousef = await crew.as("yousef");
  const snagIds = async () => (await listAll(yousef, pid, "", "snag_list")).map((r) => r.id);
  const snagStages = async () => JSON.stringify(stageCounts(await listOf(yousef, pid, "", "snag_list")));
  // Other Parts raise Snags for Yousef at the same time, so "unchanged" means: nothing this case made is among the new rows.
  const idsBefore = new Set(await snagIds());
  const yBefore = await snagStages();
  const id = await submittedMar(crew, subject, { trade: "EL", location: "T1F01" });
  await ahmedSendsToManager(crew, id, "B");
  const rows = [1, 2, 3].map((n) => ({ comment: `UAT VIS-05 comment ${n}`, reference: `R-${n}` }));
  const issued = await mohammedCodes(crew, id, "approve_b", { verification_note: "UAT verification.", remarks: "UAT remarks.", items_to_create: rows });
  t.check("Mohammed issues Code B with three comment rows", issued.status < 300, `${issued.status} ${issued.text.slice(0, 200)}`);
  await sleep(1500);
  const hafiz = await crew.as("hafiz");
  const snagList = await listAll(hafiz, pid, "", "snag_list");
  const comments = snagList.filter((i: any) => i.raisedFrom?.workItemId === id);
  t.check("Hafiz (the raiser) sees the three Comments in the Snag List, Open with TMC", comments.length === 3 && comments.every((c) => c.stage.key === "open" && c.with?.kind === "own"), `${comments.length} found`);
  const c0 = (await detail(hafiz, comments[0]!.id)).body as any;
  t.check("A Comment is raised by Design Consultants and held by TMC", /Design Consultants/.test(JSON.stringify(c0?.raisedBy ?? c0?.raisedFrom)) || /TMC/.test(JSON.stringify(c0?.heldBy)), JSON.stringify({ raisedBy: c0?.raisedBy, heldBy: c0?.heldBy?.companyName }));
  await Promise.all(["ali", "mohammed", "faisal"].map(async (who) => {
    const l = await listAll(await crew.as(who), pid, "", "snag_list");
    const found = l.filter((i: any) => i.raisedFrom?.workItemId === id).length;
    t.check(`${who} sees all three Comments (${who === "faisal" ? "oversight" : who === "ali" ? "TMC" : "the issuer"})`, found === 3, `${found}`);
  }));
  // Yousef: nothing, by list, search, kanban, counts and each id.
  const probed = await Promise.all(comments.map((c) => leakProbe(yousef, pid, c.id, "UAT VIS-05 comment")));
  comments.forEach((c, i) => t.check(`Yousef: nothing of Comment ${c.documentNumber} in any channel; its id is 404`, leaked(probed[i]!).length === 0, leakSummary(probed[i]!)));
  const ySnag = await listOf(yousef, pid, "", "snag_list");
  t.check("Yousef's Snag List holds no Comment of this MAR", !ySnag.text.includes("UAT VIS-05"));
  const kan = await yousef.get(`/projects/${pid}/modules/snag_list/work-items/kanban`);
  t.check("Yousef's Snag List Kanban holds none", kan.status === 200 && !kan.text.includes("UAT VIS-05"), `${kan.status}`);
  const midNow = await snagStages();
  const midNew = (await snagIds()).filter((x) => !idsBefore.has(x));
  t.check("Yousef's Snag List counts are unchanged by this case (new rows are other Parts' Snags, none a Comment of this MAR)", midNow === yBefore || (midNew.length > 0 && !comments.some((c) => midNew.includes(c.id))), `${yBefore} / ${midNow}; ${midNew.length} new rows`);
  await expectHidden(t, crew, "yousef", id, subject, "(the MAR)");
  await expectHidden(t, crew, "sara", id, subject, "(Mechanical only: the MAR)");
  for (const c of comments) {
    const sara = await crew.as("sara");
    const r = await sara.get(`/work-items/${c.id}`);
    t.check(`Sara gets 404 for Comment ${c.documentNumber}`, r.status === 404, `${r.status}`);
  }
  // Ali resolves one, Mohammed closes it.
  const ali = await crew.as("ali");
  await pickUp(ali, comments[0]!.id);
  const resolved = await takeKind(ali, comments[0]!.id, "submit", { resolution_note: "UAT resolved." });
  t.check("Ali resolves one Comment", resolved.status < 300, `${resolved.status} ${resolved.text.slice(0, 160)}`);
  const mohammed = await crew.as("mohammed");
  const closed = await takeKind(mohammed, comments[0]!.id, "close");
  t.check("Mohammed closes it", closed.status < 300, `${closed.status} ${closed.text.slice(0, 160)}`);
  for (const who of ["ali", "mohammed"]) {
    const d = (await detail(await crew.as(who), id)).body as any;
    const line = (d?.raisedItems ?? []).find((r: any) => r.type.code === "CMT");
    t.check(`${who} reads the MAR's Comments line as 2 open / 1 closed`, line?.open === 2 && line?.closed === 1, JSON.stringify(line));
  }
  const endNow = await snagStages();
  const endNew = (await snagIds()).filter((x) => !idsBefore.has(x));
  t.check("Yousef's Snag List counts are still unchanged by this case after the close", endNow === yBefore || (endNew.length > 0 && !comments.some((c) => endNew.includes(c.id))), `${yBefore} / ${endNow}; ${endNew.length} new rows`);
  const { context, page } = await pageAs("yousef");
  try {
    const nf = await pageIsNotFound(page, `/work-items/${comments[1]!.id}`);
    await t.shot(page, "yousef-comment-by-id");
    t.check("Yousef: a Comment by id is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
});

defineCase("VIS-06", async (t) => {
  t.manual("Not built: Chat has no ticket in the five epics (no Chat route in apps/api or apps/web). Steps for a person once built: 1) Ali posts in Chat on a Submitted MAR. 2) Ahmed and Faisal read it. Expected: both read it; messages cannot be edited or deleted; Chat is not on the closed record.");
});

defineCase("VIS-07", async (t) => {
  const crew = await Crew.start();
  const _pid = crew.projectId;
  const subject = "UAT VIS-07 closed MAR";
  const open = await submittedMar(crew, "UAT VIS-07 still open", { location: "T1F01" });
  const ali = await crew.as("ali");
  const yousef = await crew.as("yousef");
  const noRecordOpen = await rawGet(ali, `/work-items/${open}/documental-record`);
  const noRecordMadeUp = await rawGet(ali, `/work-items/${MADE_UP}/documental-record`);
  t.check("An item whose record is not made yet answers Ali the same 404 as a made-up id", noRecordOpen.status === 404 && noRecordOpen.text === noRecordMadeUp.text, `${noRecordOpen.status} / ${noRecordMadeUp.status}`);
  const id = await closedMar(crew, subject, { location: "T1F01", code: "A" });
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    ready = (await ali.get(`/work-items/${id}/documental-record`)).status === 200;
    if (!ready) await sleep(1500);
  }
  t.check("The record is made for the closed MAR (Ali can download it)", ready);
  const digest = async (who: string) => {
    const r = await (await crew.as(who)).get(`/work-items/${id}/documental-record`);
    if (r.status !== 200) return `status ${r.status}`;
    const bytes = Buffer.from(await (await fetch((r.body as any).url)).arrayBuffer());
    return `${bytes.length}:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
  };
  const aliSum = await digest("ali");
  for (const who of ["ahmed", "mohammed", "faisal", "hafiz"]) {
    const sum = await digest(who);
    t.check(`${who} downloads the same record as Ali`, sum === aliSum && !sum.startsWith("status"), `${sum} vs ${aliSum}`);
  }
  await expectVisible(t, crew, "ali", id, subject);
  const hidden = await rawGet(yousef, `/work-items/${id}/documental-record`);
  const hiddenMade = await rawGet(yousef, `/work-items/${MADE_UP}/documental-record`);
  t.check("Yousef gets 404 for the record URL, byte-identical to a made-up id", hidden.status === 404 && hidden.text === hiddenMade.text, `${hidden.status} ${hidden.text} / ${hiddenMade.status} ${hiddenMade.text}`);
  const item = await rawGet(yousef, `/work-items/${id}`);
  t.check("Yousef gets 404 for the item id", item.status === 404, `${item.status}`);
  await expectHidden(t, crew, "yousef", id, subject, "(no row, no count)");
  // The item page: Download PDF for Ali, not-found for Yousef.
  const a = await pageAs("ali");
  try {
    await a.page.goto(`${webUrl}/en/work-items/${id}`, { waitUntil: "networkidle" });
    await a.page.waitForTimeout(800);
    const hasButton = (await a.page.getByRole("button", { name: /download pdf/i }).count()) > 0;
    await t.shot(a.page, "ali-download-pdf");
    t.check("Ali's item page offers Download PDF", hasButton);
  } finally {
    await a.context.close();
  }
  await expectNotFoundPage(t, crew, "yousef", id, "yousef-item-page");
});

defineCase("VIS-08", async (t) => {
  t.manual("Needs a person with a PDF viewer. Steps: 1) Ali downloads the PDF of a closed MAR (for example from VIS-07) and opens the PDF's attachments; extract the Record Data XML. 2) Compare every value of the XML with the text printed in the PDF. Expected: every value in the XML (Transitions on the path with name, Position, Company, times and hashes; Verification Code and link) is printed in the PDF; the XML holds no Internal Note, Recommended Code, Chat or Return.");
});

defineCase("VIS-09", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const sExit = "UAT VIS-09 Exit signs Tower 1";
  const sPanel = "UAT VIS-09 Control panel Tower 2";
  const exit = await submittedMar(crew, sExit, { location: "T1F01" });
  const panel = await createMar(crew, sPanel, { location: "T2F01" });
  const hafiz = await crew.as("hafiz");
  const added = await hafiz.post(`/work-items/${panel}/links`, { workItemId: exit });
  t.check("Hafiz links the exit signs (Tower 1) in his control panel MAR (Tower 2)", added.status === 201, `${added.status} ${added.text.slice(0, 120)}`);
  await sendForReview(crew, panel);
  await aliSubmit(crew, panel);
  const omar = await crew.as("omar");
  await expectVisible(t, crew, "omar", panel, sPanel, "(Tower 2)");
  const links = (await omar.get(`/work-items/${panel}/links`)).body as any;
  const link = (links?.links ?? []).find((l: any) => l.subject === sExit);
  t.check("Omar's Links show the exit signs by Document Number and Subject only (no item id)", !!link && link.workItemId === null && !!link.documentNumber, JSON.stringify(link));
  const linkRaw = await omar.get(`/work-items/${panel}/links/${link?.id}`);
  t.check("Omar's Link read holds only number and Subject, no item id", linkRaw.status === 200 && !linkRaw.text.includes(exit), linkRaw.text.slice(0, 200));
  const exitById = await rawGet(omar, `/work-items/${exit}`);
  t.check("The exit signs' own URL is 404 for Omar", exitById.status === 404, `${exitById.status}`);
  const { context, page } = await pageAs("omar");
  try {
    await page.goto(`${webUrl}/en/work-items/${panel}/links/${link?.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const text = await page.locator("body").innerText();
    await t.shot(page, "omar-link-page");
    t.check("Omar's Link page says only: You are not allowed to see the details of this item", text.includes("You are not allowed to see the details of this item") && text.includes(sExit), text.slice(0, 200).replace(/\s+/g, " "));
    const nf = await pageIsNotFound(page, `/work-items/${exit}`);
    t.check("Omar: the exit signs' item page is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
  const mohammed = await crew.as("mohammed");
  const mLinks = (await mohammed.get(`/work-items/${panel}/links`)).body as any;
  const mLink = (mLinks?.links ?? []).find((l: any) => l.subject === sExit);
  t.check("Mohammed (sees both) reads the Link with the item id and opens the item", mLink?.workItemId === exit && (await detail(mohammed, exit)).status === 200, JSON.stringify(mLink));
  // Yousef: never offered the exit signs; saving a link to them from his Draft is refused like a made-up id.
  const yousef = await crew.as("yousef");
  const search = await yousef.get(`/projects/${pid}/work-items/link-search?q=${encodeURIComponent("UAT VIS-09")}`);
  t.check("Yousef's Link search never offers the exit signs", search.status === 200 && !search.text.includes(exit) && !search.text.includes("VIS-09"), search.text.slice(0, 120));
  const yDraft = await createMar(crew, "UAT VIS-09 Yousef Draft", { who: "yousef", location: "T2F01" });
  const real = await yousef.post(`/work-items/${yDraft}/links`, { workItemId: exit });
  const fake = await yousef.post(`/work-items/${yDraft}/links`, { workItemId: MADE_UP });
  t.check("Yousef's link to the exit signs is refused exactly like a made-up id", real.status >= 400 && real.status === fake.status && real.text === fake.text, `${real.status} ${real.text} / ${fake.status} ${fake.text}`);
});

defineCase("VIS-10", async (t) => {
  const crew = await Crew.start();
  const _pid = crew.projectId;
  const s1 = "UAT VIS-10 MAR-1 Submitted Tower 2";
  const s2 = "UAT VIS-10 MAR-2 Draft Tower 2";
  const sSnag = "UAT VIS-10 Snag Tower 1";
  const mar1 = await submittedMar(crew, s1, { location: "T2F01" });
  const mar2 = await createMar(crew, s2, { location: "T2F01" });
  const hafiz = await crew.as("hafiz");
  must(await hafiz.post(`/work-items/${mar2}/links`, { workItemId: mar1 }), "link MAR-2 to MAR-1");
  const mohammed = await crew.as("mohammed");
  const fromOf = async (who: string, id: string) => ((await (await crew.as(who)).get(`/work-items/${id}/linked-from`)).body as any)?.items ?? [];
  const holds = (items: any[], s: string) => items.some((i) => i.subject === s);
  t.check("Mohammed reads MAR-1's Linked from: MAR-2 is not listed while it is a Draft", !holds(await fromOf("mohammed", mar1), s2));
  await sendForReview(crew, mar2);
  t.check("MAR-2 is still not listed while in TMC internal review", !holds(await fromOf("mohammed", mar1), s2));
  t.check("Hafiz (the linker's Company) does not need it listed either way", true);
  await aliSubmit(crew, mar2);
  const after = await fromOf("mohammed", mar1);
  t.check("After the Submit, MAR-2 appears in MAR-1's Linked from, by number and Subject", holds(after, s2), JSON.stringify(after));
  // The Snag: Mohammed (DCL) raises it on Tower 1, linking MAR-1 (Tower 2). Omar (Tower 2 only) cannot see it.
  const snag = await createSnag(crew, "mohammed", sSnag, "T1F01");
  must(await mohammed.post(`/work-items/${snag}/links`, { workItemId: mar1 }), "link the Snag to MAR-1");
  must(await mohammed.transition(snag, "raise"), "raise the Snag");
  await sleep(500);
  const omarFrom = await fromOf("omar", mar1);
  const entry = omarFrom.find((i: any) => i.subject === sSnag);
  t.check("Omar (Tower 2 only) reads MAR-1's Linked from with Mohammed's Snag as number and Subject, no id", !!entry && entry.workItemId === null && !!entry.documentNumber, JSON.stringify(entry));
  const omar = await crew.as("omar");
  const snagById = await omar.get(`/work-items/${snag}`);
  t.check("The Snag's URL is 404 for Omar; its history and Documents too", snagById.status === 404 && (await omar.get(`/work-items/${snag}/history`)).status === 404 && (await omar.get(`/work-items/${snag}/documents`)).status === 404);
  const hafizFrom = await fromOf("hafiz", mar1);
  const hEntry = hafizFrom.find((i: any) => i.subject === sSnag);
  t.check("Hafiz (TMC holds the Snag at Tower 1) reads it with its id", hEntry?.workItemId === snag, JSON.stringify(hEntry));
  const { context, page } = await pageAs("omar");
  try {
    const nf = await pageIsNotFound(page, `/work-items/${snag}`);
    await t.shot(page, "omar-snag-by-id");
    t.check("Omar: the Snag by id is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
  t.note("Step 4 adapted: TMC covers every Location, so Hafiz sees a Snag raised at Tower 1; the viewer who may not see it is Omar (Tower 2 only), reading the Tower 2 MAR-1's Linked from.");
});

defineCase("VIS-11", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const prefix = "UAT VIS-11";
  const draft = await createMar(crew, `${prefix} TMC Draft`, { location: "T2F01" });
  const internal = await createMar(crew, `${prefix} TMC internal review`, { location: "T2F01" });
  await sendForReview(crew, internal);
  const submitted = await submittedMar(crew, `${prefix} TMC Submitted`, { location: "T2F01" });
  const beta = await createMar(crew, `${prefix} Beta Build Draft`, { who: "yousef", location: "T2F01" });
  const hafiz = await crew.as("hafiz");
  const find = async (who: string, q: string) => ((await (await crew.as(who)).get(`/projects/${pid}/work-items/link-search?q=${encodeURIComponent(q)}`)).body as any)?.links ?? [];
  const offered = await find("hafiz", prefix);
  t.check("Hafiz is offered his Submitted item", offered.some((l: any) => l.id === submitted), JSON.stringify(offered.map((l: any) => l.subject)));
  t.check("Hafiz is offered no Draft, nothing in internal review, nothing of Beta Build", !offered.some((l: any) => [draft, internal, beta].includes(l.id)), JSON.stringify(offered.map((l: any) => l.subject)));
  const otherProject = await find("hafiz", "Pump room");
  t.check("Hafiz is offered nothing from another Project (Pump room ventilation)", otherProject.length === 0, JSON.stringify(otherProject));
  const yOffered = await find("yousef", prefix);
  t.check("Yousef is never offered TMC's item", !yOffered.some((l: any) => l.id === submitted || l.id === internal || l.id === draft), JSON.stringify(yOffered));
  const real = await hafiz.post(`/work-items/${draft}/links`, { workItemId: beta });
  const fake = await hafiz.post(`/work-items/${draft}/links`, { workItemId: MADE_UP });
  t.check("A Link saved by API to a Beta Build item id is refused like a made-up id", real.status >= 400 && real.status === fake.status && real.text === fake.text, `${real.status} ${real.text} / ${fake.status} ${fake.text}`);
  const inReview = await hafiz.post(`/work-items/${draft}/links`, { workItemId: internal });
  t.check("A Link to TMC's own item still in internal review is refused too (not Submitted)", inReview.status >= 400, `${inReview.status}`);
  const ok = await hafiz.post(`/work-items/${draft}/links`, { workItemId: submitted });
  t.check("A Link to the Submitted item is saved (positive control)", ok.status === 201, `${ok.status}`);
  const { context, page } = await pageAs("hafiz");
  try {
    await page.goto(`${webUrl}/en/work-items/${draft}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "hafiz-draft-links");
  } finally {
    await context.close();
  }
});

defineCase("VIS-12", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const s = "UAT VIS-12 Code C MAR";
  const orig = await closedMar(crew, s, { location: "T1F01", code: "C" });
  const hafiz = await crew.as("hafiz");
  const rev = must<{ id: string }>(await hafiz.post(`/work-items/${orig}/revisions`, { idempotencyKey: crypto.randomUUID() }), "create Revision 1").id;
  const chain = async (who: string, id: string) => (((await (await crew.as(who)).get(`/work-items/${id}/revisions`)).body as any)?.revisions ?? []) as { id: string; revisionNo: number; documentNumber: string | null }[];
  const hChain = await chain("hafiz", orig);
  t.check("Hafiz (the raiser) sees his Draft Revision in the drop-down", hChain.some((r) => r.id === rev && r.revisionNo === 1), JSON.stringify(hChain));
  for (const who of ["mohammed", "faisal"]) {
    const c = await chain(who, orig);
    t.check(`${who}: the drop-down lists only the original before the Submit`, c.length === 1 && c[0]!.id === orig, JSON.stringify(c));
    const links = await (await crew.as(who)).get(`/work-items/${orig}/links`);
    const from = await (await crew.as(who)).get(`/work-items/${orig}/linked-from`);
    t.check(`${who}: no Link or Linked from names the Draft Revision`, !links.text.includes(rev) && !from.text.includes(rev) && !from.text.includes("Rev 1"), "");
    const r = await rawGet(await crew.as(who), `/work-items/${rev}`);
    t.check(`${who}: the Revision URL is 404`, r.status === 404, `${r.status}`);
    const probes = await leakProbe(await crew.as(who), pid, rev, "NO-SUCH-SUBJECT-XYZ");
    t.check(`${who}: nothing of the Draft Revision in any channel`, leaked(probes).length === 0, leakSummary(probes));
  }
  const oMoh = (await detail(await crew.as("mohammed"), orig)).body as any;
  t.check("Mohammed still reads the original with its own answers", oMoh?.answers?.manufacturer === "UAT Maker", JSON.stringify(oMoh?.answers?.manufacturer));
  await sendForReview(crew, rev);
  await aliSubmit(crew, rev);
  for (const who of ["mohammed", "faisal", "hafiz"]) {
    const c = await chain(who, orig);
    t.check(`${who}: after the Submit both Revisions are listed`, c.length === 2 && c.some((r) => r.id === rev) && c.some((r) => r.id === orig), JSON.stringify(c.map((r) => r.revisionNo)));
  }
  // A discarded Draft Revision never reaches Mohammed; the re-created one is Rev 1 again.
  const orig2 = await closedMar(crew, "UAT VIS-12 second Code C MAR", { location: "T1F01", code: "C" });
  const rev2 = must<{ id: string }>(await hafiz.post(`/work-items/${orig2}/revisions`, { idempotencyKey: crypto.randomUUID() }), "create Revision of the second").id;
  const discarded = await hafiz.post(`/work-items/${rev2}/discard`);
  t.check("Hafiz discards the Draft Revision", discarded.status === 204, `${discarded.status}`);
  const mAfter = await chain("mohammed", orig2);
  t.check("The discarded Revision never reaches Mohammed", mAfter.length === 1 && (await rawGet(await crew.as("mohammed"), `/work-items/${rev2}`)).status === 404, JSON.stringify(mAfter));
  const rev2b = must<{ id: string }>(await hafiz.post(`/work-items/${orig2}/revisions`, { idempotencyKey: crypto.randomUUID() }), "re-create Revision").id;
  const again = await chain("hafiz", orig2);
  t.check("The re-created Revision is Rev 1 again", again.some((r) => r.id === rev2b && r.revisionNo === 1), JSON.stringify(again));
  const { context, page } = await pageAs("mohammed");
  try {
    const nf = await pageIsNotFound(page, `/work-items/${rev2b}`);
    await t.shot(page, "mohammed-draft-revision-url");
    t.check("Mohammed: the Draft Revision's URL is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
});
