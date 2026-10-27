/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { defineCase } from "../harness/case.ts";
import { pageAs, webUrl } from "../harness/browser.ts";
import { Api } from "../harness/helpers.ts";
import {
  Crew, MADE_UP, aliSubmit, createMar, detail, emailOf, memberIdOf, memberVisibility, pageIsNotFound, participantIdByName, participantVisibility,
  photoBytes, rawGet, sameGrant, sendForReview, setMemberVisibility, setParticipantVisibility, submittedMar, tryStartUpload, upload, ahmedSendsToManager, takeOk,
} from "../harness/helpers-vis.ts";

// VIS-31 .. VIS-38: Participants, invitations, Member Visibility, Documents.

const bodyText = async (page: import("playwright").Page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const OTHERS = /Beta Build|Design Consultants|Al Waha/;

defineCase("VIS-31", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const parts = async (who: string) => (await (await crew.as(who)).get(`/projects/${pid}/participants`)).body as any;
  const h = await parts("hafiz");
  t.check("Hafiz reads TMC's own Participant and the Host Company name only", h.participants.length === 1 && h.participants[0].isOwnCompany && h.participants[0].company.legalName.en === "TMC Constructions" && h.hostCompany.legalName.en === "TMC Constructions", JSON.stringify(h.participants.map((p: any) => p.company.legalName.en)));
  const a = await parts("ahmed");
  t.check("Ahmed reads DCL's own Participant with Host Company TMC; neither lists the others", a.participants.length === 1 && a.participants[0].company.legalName.en === "Design Consultants LLC" && a.hostCompany.legalName.en === "TMC Constructions", JSON.stringify(a.participants.map((p: any) => p.company.legalName.en)));
  t.check("Hafiz and Ahmed read no order number of a Participant", h.participants[0].ordinal === null && a.participants[0].ordinal === null);
  const s = await parts("saeed");
  t.check("Saeed (Project Admin) reads every Participant, with their order numbers", s.participants.length >= 4 && s.participants.every((p: any) => typeof p.ordinal === "number"), `${s.participants.length}`);
  for (const who of ["hafiz", "ahmed"]) {
    const api = await crew.as(who);
    const cp = await api.get(`/participants`);
    t.check(`${who}'s Company Projects read is refused as a non-Authorized Person (and lists no other Participant)`, cp.status === 403 || !OTHERS.test(cp.text), `${cp.status}`);
    const num = (await api.get(`/projects/${pid}/numbering`)).text;
    t.check(`${who}'s Numbering read names no other Company`, !/Beta Build|Al Waha/.test(num) && (who === "ahmed" ? !/TMC Constructions/.test(num) : true), "");
    const counters = await api.get(`/projects/${pid}/numbering/counters`);
    t.check(`${who}: the counters are 404`, counters.status === 404, `${counters.status}`);
  }
  const sNum = await (await crew.as("saeed")).get(`/projects/${pid}/numbering/counters`);
  t.check("The Project Admin reads the counters (positive control)", sNum.status === 200);
  for (const who of ["hafiz", "ahmed"]) {
    const { context, page } = await pageAs(who);
    try {
      await page.goto(`${webUrl}/en/projects/${pid}/settings/numbering`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const text = await bodyText(page);
      await t.shot(page, `${who}-numbering`);
      t.check(`${who}'s Numbering page names no other Company and shows no order number`, !OTHERS.test((who === "ahmed" ? text.replaceAll("Design Consultants", "") : text)) , text.slice(0, 160));
      t.check(`${who}'s Numbering page shows No code yet for the own Participant`, /No code yet/i.test(text), "");
    } finally {
      await context.close();
    }
  }
});

defineCase("VIS-32", async (t) => {
  const crew = await Crew.start();
  const nasser = await crew.as("nasser");
  const layla = await crew.as("layla");
  const hafiz = await crew.as("hafiz");
  const jcv = ((await nasser.get("/projects")).body as any).projects[0].id as string;
  const jcvName = ((await nasser.get("/projects")).body as any).projects[0].name.en as string;
  t.note("The UAT Project of the Test Case is Beta Build's own JCV (Nasser is its Project Admin), so no Project is created on TMC's side; DCL is invited to it and the invitations are withdrawn again.");
  const real = await nasser.post(`/projects/${jcv}/participants`, { crNumber: "9999000003", role: "consultant" });
  const fake = await nasser.post(`/projects/${jcv}/participants`, { crNumber: "9999000099", role: "consultant" });
  t.check("Both invitations answer alike (202, no body)", real.status === 202 && fake.status === 202 && real.text === fake.text, `${real.status} ${real.text} / ${fake.status} ${fake.text}`);
  const list = ((await nasser.get(`/projects/${jcv}/invitations`)).body as any).invitations as any[];
  const a = list.find((i) => i.crNumber === "9999000003");
  const b = list.find((i) => i.crNumber === "9999000099");
  t.check("Both show in Nasser's list by CR number only, and read the same (same fields, no Company name)", !!a && !!b && Object.keys(a).sort().join() === Object.keys(b).sort().join() && !JSON.stringify(list).includes("Design Consultants"), JSON.stringify(list));
  const inv = ((await layla.get(`/participant-invitations`)).body as any).invitations as any[];
  const mine = inv.find((i) => i.project.name.en === jcvName);
  t.check("Layla sees only the invitation: Project name, Host Company, offered role", !!mine && Object.keys(mine).sort().join() === ["hostCompany", "id", "invitedAt", "project", "projectRole"].sort().join() && mine.hostCompany.legalName.en === "Beta Build", JSON.stringify(mine));
  const hafizSees = JSON.stringify(((await hafiz.get(`/projects`)).body as any)) + (await hafiz.get(`/participant-invitations`)).text + (await hafiz.get(`/home`)).text;
  t.check("Hafiz (TMC) sees the invitation, its Project and the CR numbers nowhere (DCL is on the Tower Project, where it shows by name only)", !/Jeddah|9999000003|9999000099/.test(hafizSees), "");
  const out: any[] = [];
  for (const i of [a, b]) out.push(await nasser.post(`/projects/${jcv}/invitations/${i.id}/withdraw`));
  t.check("Nasser withdraws both, in exactly the same way (204, no body)", out.every((r) => r.status === 204) && out[0].text === out[1].text, out.map((r) => r.status).join());
  const after = ((await nasser.get(`/projects/${jcv}/invitations`)).body as any).invitations as any[];
  t.check("Both leave Nasser's list", !after.some((i) => i.crNumber === "9999000003" || i.crNumber === "9999000099"), JSON.stringify(after));
  const lAfter = ((await layla.get(`/participant-invitations`)).body as any).invitations as any[];
  t.check("The invitation leaves Layla's list", !lAfter.some((i) => i.project.name.en === jcvName), `${lAfter.length}`);
  const { context, page } = await pageAs("layla");
  try {
    await page.goto(`${webUrl}/en/participants`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "layla-company-projects");
  } finally {
    await context.close();
  }
});

defineCase("VIS-33", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const layla = await crew.as("layla");
  const dcl = await participantIdByName(saeed, pid, "Design Consultants");
  const ahmedId = await memberIdOf(layla, dcl, emailOf.ahmed!);
  const visUrl = `/participants/${dcl}/members/${ahmedId}/visibility`;
  t.check("Positive control: Layla (DCL Authorized Person) reads Ahmed's Visibility", (await layla.get(visUrl)).status === 200);
  for (const who of ["hafiz", "saeed"]) {
    const api = await crew.as(who);
    const r = await api.get(visUrl);
    const madeUp = await api.get(`/participants/${dcl}/members/${MADE_UP}/visibility`);
    t.check(`${who}: DCL's Member Visibility by API is 404, like a made-up Member`, r.status === 404 && r.text === madeUp.text, `${r.status}`);
    const { context, page } = await pageAs(who);
    try {
      const nf = await pageIsNotFound(page, visUrl);
      if (who === "hafiz") await t.shot(page, "hafiz-dcl-member-visibility");
      t.check(`${who}: the Member Visibility page of DCL is the plain not-found page`, nf.notFound, nf.text);
      if (who === "hafiz") {
        const p = await pageIsNotFound(page, `/participants/${dcl}`);
        t.check("Hafiz: the DCL Participant page is the plain not-found page", p.notFound, p.text);
      }
    } finally {
      await context.close();
    }
  }
  const sg = await saeed.get(`/participants/${dcl}/visibility`);
  t.check("Saeed (Project Admin) does see DCL's Participant grant", sg.status === 200 && JSON.stringify(sg.body).includes("trade"), `${sg.status}`);
  const lv = await layla.get(`/participants/${dcl}/visibility`);
  const ls = await layla.get(`/participants/${dcl}/scopes`);
  t.check("Layla (not a Project Member) reads her Participant's Trades and Locations and its Scopes", lv.status === 200 && ls.status === 200, `${lv.status} ${ls.status}`);
  const lw = await layla.get(`/projects/${pid}/work-items`);
  const lp = await layla.get(`/projects/${pid}`);
  const lWorkflows = await layla.get(`/projects/${pid}/workflow-settings`);
  t.check("Layla sees nothing else of the Project (no items, no Project read, no Workflow settings)", lw.status === 404 && lp.status === 404 && lWorkflows.status === 404, `${lw.status} ${lp.status} ${lWorkflows.status}`);
  const { context, page } = await pageAs("layla");
  try {
    await page.goto(`${webUrl}/en/participants/${dcl}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "layla-own-participant");
  } finally {
    await context.close();
  }
});

/** Snapshot of DCL's Participant and Member grants, to restore if a step that must be refused is not. */
async function snapshotDcl(layla: Api, dcl: string) {
  const members = (await layla.get(`/participants/${dcl}/members`)).body as any;
  const rows = [];
  for (const m of members.members as any[]) rows.push({ id: m.id, vis: await memberVisibility(layla, dcl, m.id) });
  return { participant: await participantVisibility(layla, dcl), members: rows };
}

defineCase("VIS-34", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const saeed = await crew.as("saeed");
  const layla = await crew.as("layla");
  const dcl = await participantIdByName(saeed, pid, "Design Consultants");
  const ahmedId = await memberIdOf(layla, dcl, emailOf.ahmed!);
  const ahmedVis = await memberVisibility(layla, dcl, ahmedId);
  const snap = await snapshotDcl(layla, dcl);
  const civil = crew.dims.trade.CV!;
  const over = await setMemberVisibility(layla, dcl, ahmedId, { trade: { isAll: false, valueIds: [civil] }, location: ahmedVis.location });
  t.check("Step 1: Layla gives Ahmed a Trade DCL does not have: rejected (a Member never covers more than the Participant)", over.status >= 400, `${over.status} ${over.text.slice(0, 160)}`);
  t.check("and Ahmed's grant is unchanged", sameGrant((await memberVisibility(layla, dcl, ahmedId)).trade, ahmedVis.trade));
  // Step 2: Mohammed holds an Electrical MAR at DCL review; Saeed narrows DCL off Electrical.
  const subject = "UAT VIS-34 Electrical MAR at DCL";
  const id = await submittedMar(crew, subject, { location: "T1F01" });
  await ahmedSendsToManager(crew, id, "A");
  const before = await participantVisibility(saeed, dcl);
  const names = ["Ahmed", "Mohammed", "Sara", subject, id, "TWR-MAR"];
  try {
    const narrow = await setParticipantVisibility(saeed, dcl, { trade: { isAll: false, valueIds: before.trade.valueIds.filter((x) => x !== crew.dims.trade.EL) }, location: before.location });
    t.check("Step 2: Saeed narrowing DCL off Electrical while Mohammed holds an Electrical MAR is refused (a Handover is needed first)", narrow.status === 409, `${narrow.status} ${narrow.text.slice(0, 200)}`);
    t.check("The refusal names no Step, item, Member or Document Number of DCL", !names.some((n) => narrow.text.includes(n)), narrow.text.slice(0, 200));
    t.check("The answer gives a count only (like: 1 Step of DCL needs a new holder first)", /\d/.test(narrow.text), narrow.text.slice(0, 200));
    t.check("Nothing changed (DCL still covers Electrical)", sameGrant((await participantVisibility(saeed, dcl)).trade, before.trade));
    const narrowLoc = await setParticipantVisibility(saeed, dcl, { trade: before.trade, location: { isAll: false, valueIds: [crew.dims.location.T1!] } });
    t.check("Step 3 (the narrowing half): narrowing DCL's Locations to Tower 1 while DCL holds Tower 2 Steps is refused too, with no name", narrowLoc.status === 409 && !names.some((n) => narrowLoc.text.includes(n)), `${narrowLoc.status} ${narrowLoc.text.slice(0, 200)}`);
  } finally {
    const now = await participantVisibility(saeed, dcl);
    if (!sameGrant(now.trade, before.trade) || !sameGrant(now.location, before.location)) {
      await setParticipantVisibility(saeed, dcl, before);
      for (const m of snap.members) await setMemberVisibility(layla, dcl, m.id, m.vis);
      t.check("A narrowing that must have been refused went through: DCL's grants restored by hand", false, "the refusal did not hold");
    }
  }
  await takeOk(await crew.as("mohammed"), id, "approve_a", { answers: { sample_checked: true, matches_specification: true, verification_note: "UAT" } }).catch(() => undefined);
  t.manual("Step 3 second half not run: narrowing DCL's Locations from all to Tower 1 and widening back needs DCL to hold no Tower 2 Step, which other UAT cases keep open, and widening would leave every DCL engineer narrowed for the other Parts. The refusal above is proven. A person checks on a clean seed: 1) Saeed narrows DCL to Tower 1 only, then widens DCL back to all. 2) Open Ahmed's Visibility. Expected: after narrowing, DCL engineers cover Tower 1 only; widening the Participant again does not widen them.");
});

defineCase("VIS-35", async (t) => {
  t.notRun("not built: the Visibility Gap warning is not in the Visibility pages or the api (no 'gap' text in apps/web or apps/api). Steps for later: DCL covers Mechanical but no DCL Member is granted it; Saeed opens Settings > Visibility (no gap, nothing of DCL's split); Layla opens her warnings (warned that no DCL Project Member covers Mechanical).");
});

defineCase("VIS-36", async (t) => {
  t.manual("Needs Project setups this run must not change for the other Parts: (a) no Consultant covers Electrical (DCL cannot be narrowed off Electrical while it holds Steps), (b) a second Consultant on the Project (no second Consultant Company is seeded), (c) the covering Consultant with nobody holding the Position. Steps for a person on a clean Project: set each up in Settings > Visibility and Positions; as Ali (TMC PM) take Submit on an Electrical MAR in each case. Expected: Submit is not offered and taking it gives the same answer in all three: 'This cannot be handed over yet: the next step has nobody to take it. Ask a Project Admin.' Nothing names a Consultant or says which case it is.");
});

defineCase("VIS-37", async (t) => {
  const crew = await Crew.start();
  const _pid = crew.projectId;
  const subject = "UAT VIS-37 documents MAR";
  const id = await createMar(crew, subject, { location: "T1F01" });
  const hafiz = await crew.as("hafiz");
  const photo = await upload(hafiz, id, { fieldKey: "sample_photo", fileName: "UAT-VIS-37-photo.jpg", contentType: "image/jpeg", body: photoBytes() });
  const docs = ((await hafiz.get(`/work-items/${id}/documents`)).body as any).documents as any[];
  t.check("Hafiz lists his datasheet and photo on the Draft (positive control)", docs.length >= 2 && docs.some((d) => d.id === photo.id), `${docs.length}`);
  const madeUp = await rawGet(hafiz, `/work-items/${MADE_UP}/documents`);
  const hiddenWho = ["yousef", "ahmed", "saeed"];
  const hidden = async (stage: string, who: string[]) => {
    for (const w of who) {
      const api = await crew.as(w);
      const list = await rawGet(api, `/work-items/${id}/documents`);
      const dl = await rawGet(api, `/work-items/${id}/documents/${photo.id}/download`);
      const up = await tryStartUpload(api, id);
      const rm = (await api.request("DELETE", `/work-items/${id}/documents/${photo.id}`)).status;
      t.check(`${w} ${stage}: Documents list, download URL, upload and remove are all 404, the list exactly like a made-up id`, list.status === 404 && list.text === madeUp.text && dl.status === 404 && up === 404 && rm === 404, `${list.status} ${dl.status} ${up} ${rm}`);
    }
  };
  await hidden("before the Submit", hiddenWho);
  await sendForReview(crew, id);
  await aliSubmit(crew, id);
  const ahmed = await crew.as("ahmed");
  const aDocs = ((await ahmed.get(`/work-items/${id}/documents`)).body as any).documents as any[];
  const aPhoto = aDocs.find((d) => d.id === photo.id);
  t.check("After the Submit Ahmed lists both Documents", aDocs.length >= 2 && !!aPhoto, `${aDocs.length}`);
  t.check("Ahmed reads the photo's time and place", !!aPhoto?.takenAt && !!aPhoto?.takenWhere, JSON.stringify([aPhoto?.takenAt, aPhoto?.takenWhere]));
  t.check("The uploader is TMC as a Company, not the engineer", aPhoto?.uploadedBy?.companyName?.en === "TMC Constructions" && aPhoto?.uploadedBy?.memberName === null, JSON.stringify(aPhoto?.uploadedBy));
  const dl = await ahmed.get(`/work-items/${id}/documents/${photo.id}/download`);
  const bytes = dl.status === 200 ? await (await fetch((dl.body as any).url)).arrayBuffer() : null;
  t.check("Ahmed downloads the photo", dl.status === 200 && !!bytes && bytes.byteLength > 0, `${dl.status}`);
  await hidden("after the Submit", ["yousef"]);
  const { context, page } = await pageAs("yousef");
  try {
    const nf = await pageIsNotFound(page, `/work-items/${id}`);
    await t.shot(page, "yousef-item-after-submit");
    t.check("Yousef: the item page is the plain not-found page", nf.notFound, nf.text);
  } finally {
    await context.close();
  }
  t.note("The TMC Member off the Project of the Test Case is Saeed (TMC Authorized Person, not a Project Member in the seed).");
});

defineCase("VIS-38", async (t) => {
  const crew = await Crew.start();
  const subject = "UAT VIS-38 Submitted MAR";
  const id = await submittedMar(crew, subject, { location: "T1F01" });
  const hafiz = await crew.as("hafiz");
  const ali = await crew.as("ali");
  const ahmed = await crew.as("ahmed");
  const other = await submittedMar(crew, "UAT VIS-38 link target", { location: "T1F01" });
  const before = JSON.stringify(((await detail(hafiz, id)).body as any).answers);
  for (const [who, api] of [["hafiz", hafiz], ["ali", ali], ["ahmed", ahmed]] as const) {
    const d = (await detail(api, id)).body as any;
    const put = await api.put(`/work-items/${id}/answers`, { answers: { ...d.answers, description: "UAT changed after Submit" } });
    t.check(`${who} cannot save an answer after the Submit`, put.status >= 400, `${put.status} ${put.text.slice(0, 100)}`);
    if (who !== "ahmed") {
      const up = await tryStartUpload(api, id);
      t.check(`${who} cannot add a Document`, up >= 400, `${up}`);
      const lk = await api.post(`/work-items/${id}/links`, { workItemId: other });
      t.check(`${who} cannot add or edit a Link`, lk.status >= 400, `${lk.status}`);
    }
  }
  t.check("Nothing changed: the answers are as Hafiz saved them", JSON.stringify(((await detail(hafiz, id)).body as any).answers) === before);
  const dh = (await detail(hafiz, id)).body as any;
  t.check("The Form is read-only to the raiser too (saveAnswers false); the Consultant has a Send to Manager reply Screen instead", dh.actions.saveAnswers === false && (await detail(ahmed, id).then((r) => (r.body as any).actions.transitions)).some((x: any) => x.key === "send_to_manager"), "");
  const { context, page } = await pageAs("hafiz");
  try {
    await page.goto(`${webUrl}/en/work-items/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "hafiz-readonly-item");
  } finally {
    await context.close();
  }
});

