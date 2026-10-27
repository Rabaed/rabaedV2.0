/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { defineCase } from "../harness/case.ts";
import { pageAs, webUrl } from "../harness/browser.ts";
import { Api } from "../harness/helpers.ts";
import {
  Crew, ahmedSendsToManager, aliSubmit, detail, emailOf, expectHidden, historyOf, listAll, listOf, mailsWith, memberIdOf, memberVisibility, mohammedCodes,
  must, myParticipantId, pdfBytes, pickUp, searchRows, sendForReview, setMemberVisibility, sameGrant, sleep, submittedMar, takeOk, upload,
} from "../harness/helpers-vis.ts";

// VIS-20 .. VIS-25: search, Watch, notifications and email, pool names, the Owner review, the workflow map.

const waitMail = async (address: string, needle: string, ms = 30000) => {
  const until = Date.now() + ms;
  for (;;) {
    const m = await mailsWith(address, needle);
    if (m.length > 0 || Date.now() > until) return m;
    await sleep(2000);
  }
};

defineCase("VIS-20", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const tag = String(Date.now()).slice(-6);
  const subject = `UAT VIS-20 search MAR ${tag}`;
  const id = await submittedMar(crew, subject, { location: "T2F01", answers: { description: "UAT VIS-20 description with the word zircon inside." } });
  await ahmedSendsToManager(crew, id, "C", "UAT VIS-20 internal zircon");
  const ali = await crew.as("ali");
  const mohammed = await crew.as("mohammed");
  // Pages until the item turns up (broad words such as Electrical match hundreds of rows); a miss reads every page.
  const found = async (api: Api, q: string, module = "") => {
    for (let page = 1; page <= 40; page++) {
      const path = module ? `/projects/${pid}/modules/${module}/work-items` : `/projects/${pid}/work-items`;
      const b = (await api.get(`${path}?pageSize=50&allRevisions=true&page=${page}&q=${encodeURIComponent(q)}`)).body as any;
      if ((b?.items ?? []).some((r: any) => r.id === id)) return true;
      if (!b?.page?.hasNext) return false;
    }
    return false;
  };
  const first = await Promise.all([found(ali, subject), found(mohammed, subject)]);
  t.check("Positive control: Ali finds the item by its Subject; Mohammed too", first[0] && first[1]);
  const issued = await mohammedCodes(crew, id, "revise_c", { verification_note: "UAT zircon verification.", remarks: "UAT remarks: the finish is zircon coated." });
  t.check("Mohammed issues a Code with Remarks containing the word zircon", issued.status < 300, `${issued.status} ${issued.text.slice(0, 120)}`);
  await sleep(500);
  await Promise.all(([["ali", ali], ["mohammed", mohammed]] as const).map(async ([who, api]) => {
    const rows = await searchRows(api, pid, "zircon");
    t.check(`${who}: searching zircon finds nothing in the List (Search never reads answers or replies)`, rows.length === 0, `${rows.length} rows`);
    const kan = await api.get(`/projects/${pid}/work-items/kanban?q=zircon`);
    const cards = JSON.stringify((kan.body as any)?.columns ?? []);
    t.check(`${who}: and nothing on the Kanban`, kan.status === 200 && !cards.includes(id), `${kan.status}`);
  }));
  const doc = (await detail(ali, id)).body as any;
  const number = doc.documentNumber as string;
  const searches = ([["Document Number", number], ["Subject", subject], ["Type", "Material Approval"], ["Trade", "Electrical"], ["Location", "Tower 2 Floor 01"], ["raiser Company", "TMC Constructions"]] as const).flatMap(([what, q]) =>
    ([["ali", ali], ["mohammed", mohammed]] as const).map(([who, api]) => ({ what, q, who, api })));
  const hits = await Promise.all(searches.map((x) => found(x.api, x.q)));
  searches.forEach((x, i) => t.check(`${x.who}: search by ${x.what} (${x.q}) finds the item`, hits[i]!));
  // Owner phrase: own Company people, other Company by name only.
  const own = await listOf(ali, pid, "q=" + encodeURIComponent("Ahmed"));
  t.check("Ali searching for a DCL person's name finds nothing (people of another Company are never searched)", own.items.filter((r) => /UAT VIS-20/.test(r.title)).length === 0, `${own.items.length} rows`);
  const byCompany = await found(mohammed, "TMC Constructions");
  t.check("Mohammed finds the TMC item by TMC's Company name (the other Company, by name only)", byCompany);
  const { context, page } = await pageAs("ali");
  try {
    await page.goto(`${webUrl}/en/projects/${pid}/work-items?q=zircon`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await t.shot(page, "ali-search-zircon");
    t.check("The Submittals page for q=zircon shows no row of the item", !(await page.locator("main").innerText()).includes(subject));
  } finally {
    await context.close();
  }
});

defineCase("VIS-21", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const subject = "UAT VIS-21 watched MAR";
  const id = await submittedMar(crew, subject, { location: "T1F01" });
  const watchers = ["ali", "ahmed", "faisal"];
  for (const w of watchers) {
    const api = await crew.as(w);
    const put = await api.put(`/work-items/${id}/watch`, {});
    t.check(`${w} watches the MAR`, put.status === 204, `${put.status} ${put.text.slice(0, 100)}`);
  }
  for (const w of watchers) {
    const r = await (await crew.as(w)).get(`/work-items/${id}/watch`);
    const keys = Object.keys((r.body as object) ?? {});
    t.check(`${w} reads only their own Watching (no list or count of watchers)`, r.status === 200 && (r.body as any)?.watching === true && keys.join() === "watching", r.text);
    const d = JSON.stringify((await detail(await crew.as(w), id)).body);
    t.check(`${w}'s item read has no watchers list or count`, !/watchers|watcherCount|watchCount/i.test(d), "");
  }
  // Hind narrows Faisal off the MAR's Trade (Electrical): none.
  const hind = await crew.as("hind");
  const pidA = await myParticipantId(hind, pid);
  const faisalId = await memberIdOf(hind, pidA, emailOf.faisal!);
  const original = await memberVisibility(hind, pidA, faisalId);
  try {
    const narrowed = await setMemberVisibility(hind, pidA, faisalId, { trade: { isAll: false, valueIds: [] }, location: original.location });
    t.check("Hind narrows Faisal off the MAR's Trade", narrowed.status < 300, `${narrowed.status} ${narrowed.text.slice(0, 160)}`);
    await sleep(300);
    const faisal = await crew.as("faisal");
    t.check("Faisal now gets 404 for the MAR", (await faisal.get(`/work-items/${id}`)).status === 404);
    const bellBefore = (((await faisal.get("/notifications")).body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id).length;
    await ahmedSendsToManager(crew, id, "A");
    const issued = await mohammedCodes(crew, id, "approve_a", { verification_note: "UAT" });
    t.check("Mohammed issues Code A", issued.status < 300, `${issued.status} ${issued.text.slice(0, 120)}`);
    await sleep(9000);
    const bellAfter = (((await faisal.get("/notifications")).body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id);
    t.check("Faisal gets no in-app notification of the Code", bellAfter.length === bellBefore && !bellAfter.some((n: any) => n.event?.outcome === "A"), `${bellBefore} -> ${bellAfter.length}`);
    const mails = await mailsWith(emailOf.faisal!, subject);
    const issuedMail = mails.filter((m) => /A\b/.test(m.subject) && /Approved|Code|A/.test(m.subject));
    t.check("Faisal gets no email of the Code", issuedMail.length === 0, mails.map((m) => m.subject).join(" | "));
    // Positive control: Ali (watcher, still sees it) is notified.
    const ali = await crew.as("ali");
    const aliBell = (((await ali.get("/notifications")).body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id && (n.event?.outcome === "A" || n.kind === "sent_back" || n.kind === "record_ready" || n.kind === "watched_event"));
    t.check("Positive control: Ali (raiser's Company, still sees it) has a notification for the item", aliBell.length > 0, `${aliBell.length}`);
  } finally {
    const back = await setMemberVisibility(hind, pidA, faisalId, original);
    t.check("Faisal's Visibility is restored (FX-OR kept)", back.status < 300 && sameGrant((await memberVisibility(hind, pidA, faisalId)).trade, original.trade), `${back.status}`);
  }
});

defineCase("VIS-22", async (t) => {
  const crew = await Crew.start();
  const _pid = crew.projectId;
  const subject = `UAT VIS-22 mail MAR ${String(Date.now()).slice(-5)}`;
  const hafizApi = await crew.as("hafiz");
  const settings = (await hafizApi.get("/notification-settings")).body as any;
  const original = { settings: settings.settings, emailPaused: settings.emailPaused, preferredLanguage: settings.preferredLanguage };
  try {
  await hafizApi.put("/notification-settings", { ...original, settings: { ...original.settings, watched: { ...original.settings.watched, email: "immediate" } } });
  const id = await submittedMar(crew, subject, { location: "T1F01" });
  await ahmedSendsToManager(crew, id, "B", "UAT VIS-22 Ahmed internal note");
  const issued = await mohammedCodes(crew, id, "approve_b", { verification_note: "UAT final", remarks: "UAT remarks", items_to_create: [{ comment: "UAT VIS-22 comment", reference: "r" }] }, { internalNote: "UAT VIS-22 Mohammed internal" });
  t.check("Mohammed issues Code B on the TMC MAR", issued.status < 300, `${issued.status} ${issued.text.slice(0, 120)}`);
  const number = ((await detail(await crew.as("hafiz"), id)).body as any).documentNumber as string;
  let mails = await waitMail(emailOf.hafiz!, subject);
  for (let i = 0; i < 12 && !mails.some((m) => !/Submit$|Record ready/.test(m.subject)); i++) {
    await sleep(2500);
    mails = await mailsWith(emailOf.hafiz!, subject);
  }
  t.check("A mail reaches Hafiz (positive control)", mails.length > 0, mails.map((m) => m.subject).join(" | "));
  const mail = mails.find((m) => !/Submit$|Record ready/.test(m.subject)) ?? mails[0];
  if (mail) {
    const full = (await (await fetch(`http://127.0.0.1:${process.env.MAILPIT_PORT ?? "8725"}/api/v1/message/${mail.id}`)).json()) as { Text?: string; HTML?: string; Subject: string };
    const body = `${full.Subject}\n${full.Text ?? ""}`;
    t.check("The mail's subject holds the Document Number, the Subject and Code B", full.Subject.includes(number) && full.Subject.includes(subject) && /\bB\b|Comments/.test(full.Subject), full.Subject);
    t.check("The mail names Design Consultants as a Company and the final signer as the one person", /Design Consultants/.test(body) && /Mohammed/.test(body), body.slice(0, 300).replace(/\s+/g, " "));
    t.check("The mail names no DCL internal step, Ahmed, Recommended Code or Internal Note", !/Ahmed|Recommended|Consultant Engineer|Consultant Manager|Pool|internal note/i.test(body) && !body.includes("UAT VIS-22 Ahmed") && !body.includes("UAT VIS-22 Mohammed internal"), body.slice(0, 300).replace(/\s+/g, " "));
  }
  for (const who of ["yousef", "sara"]) {
    const m = await mailsWith(emailOf[who]!, subject);
    t.check(`${who} gets no email about it`, m.length === 0, m.map((x) => x.subject).join(" | "));
    const bell = (((await (await crew.as(who)).get("/notifications")).body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id || (n.title ?? "").includes(subject));
    t.check(`${who} gets no bell entry about it`, bell.length === 0, `${bell.length}`);
    await expectHidden(t, crew, who, id, subject);
  }
  const hafizBell = (((await (await crew.as("hafiz")).get("/notifications")).body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id);
  t.check("Hafiz's bell holds the Code entry", hafizBell.length > 0 && !JSON.stringify(hafizBell).match(/Ahmed|Recommended/), JSON.stringify(hafizBell.map((n: any) => [n.kind, n.event?.outcome])));
  const { context, page } = await pageAs("hafiz");
  try {
    await page.goto(`${webUrl}/en/notifications`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "hafiz-notifications");
  } finally {
    await context.close();
  }
  } finally {
    await hafizApi.put("/notification-settings", original);
  }
  t.note("Hafiz's Items I watch email setting (default: daily digest) was set to immediate for this case and restored afterwards.");
});

defineCase("VIS-23", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const layla = await crew.as("layla");
  const pidD = await myParticipantId(layla, pid);
  const saraId = await memberIdOf(layla, pidD, emailOf.sara!);
  const original = await memberVisibility(layla, pidD, saraId);
  const subject = "UAT VIS-23 pool MAR";
  try {
    // A pool of two Engineers needs Sara to cover Electrical again (FX-K1M narrowed her): restored in finally.
    const granted = await setMemberVisibility(layla, pidD, saraId, { trade: { isAll: false, valueIds: [...new Set([...original.trade.valueIds, crew.dims.trade.EL!])] }, location: original.location });
    t.check("Setup: Sara covers Electrical for this case (restored afterwards)", granted.status < 300, `${granted.status}`);
    await sleep(300);
    const id = await submittedMar(crew, subject, { location: "T2F01" });
    const ali = await crew.as("ali");
    const hafiz = await crew.as("hafiz");
    const ahmed = await crew.as("ahmed");
    const sara = await crew.as("sara");
    const dAhmed = (await detail(ahmed, id)).body as any;
    const poolNames = (dAhmed.heldBy?.pool?.names ?? []).map((n: any) => n.en);
    t.check("DCL reads the pool names (Ahmed and Sara) while nobody has picked it up", poolNames.includes("Ahmed bin Said") && poolNames.some((n: string) => /Sara/.test(n)), JSON.stringify(dAhmed.heldBy));
    const mine = async (who: Api) => {
      const d = JSON.stringify((await detail(who, id)).body);
      const row = JSON.stringify((await searchRows(who, pid, subject)).filter((r) => r.id === id));
      const kan = JSON.stringify((((await who.get(`/projects/${pid}/work-items/kanban`)).body as any)?.columns ?? []).flatMap((c: any) => (c.lanes ?? []).flatMap((l: any) => (l.cards ?? []).filter((x: any) => x.id === id))));
      const hist = (await historyOf(who, id)).text;
      const feed = (await who.get(`/projects/${pid}/activity`)).text;
      return { d, row, kan, hist, feed };
    };
    const forAli = await mine(ali);
    const names = /Ahmed|Sara|Mohammed|Layla|picked_up|pick_up|Picked up/;
    t.check("Ali reads With Design Consultants LLC in the item, List and Kanban, never the pool names", /Design Consultants/.test(forAli.d) && !names.test(forAli.d) && !names.test(forAli.row) && !names.test(forAli.kan), `${(forAli.d.match(names) ?? [])[0]}`);
    const feedItem = JSON.stringify(((JSON.parse(forAli.feed) as any).entries ?? []).filter((e: any) => e.workItem?.id === id));
    t.check("Ali's history and Activity Feed hold no DCL person, Step or Pick up event", !names.test(forAli.hist) && !names.test(feedItem), "");
    const picked = await pickUp(ahmed, id);
    t.check("Ahmed picks it up", picked.status < 300, `${picked.status}`);
    await sleep(500);
    const dSara = (await detail(sara, id)).body as any;
    t.check("Sara (DCL) now reads Ahmed as the holder", /Ahmed/.test(JSON.stringify(dSara.heldBy)), JSON.stringify(dSara.heldBy));
    const after = await mine(ali);
    t.check("Ali reads the same after the Pick up: With Design Consultants, no holder, no Pick up event", /Design Consultants/.test(after.d) && !names.test(after.d) && !names.test(after.row) && !names.test((await historyOf(ali, id)).text), "");
    await sleep(5000);
    const bell = JSON.stringify((((await ali.get("/notifications")).body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id));
    const bellH = JSON.stringify((((await hafiz.get("/notifications")).body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id));
    t.check("Notifications of TMC name no DCL pool, holder or Pick up", !names.test(bell) && !names.test(bellH), "");
    // Code B: the Comments wait in TMC's pool; Mohammed reads TMC by name only.
    await takeOk(ahmed, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true, verification_note: "UAT" }, recommendedCode: "B" });
    await pickUp(await crew.as("mohammed"), id);
    const code = await mohammedCodes(crew, id, "approve_b", { verification_note: "UAT", remarks: "UAT", items_to_create: [{ comment: "UAT VIS-23 comment", reference: "r" }] });
    t.check("Mohammed issues Code B", code.status < 300, `${code.status} ${code.text.slice(0, 100)}`);
    await sleep(1000);
    const comments = (await listAll(await crew.as("mohammed"), pid, "", "snag_list")).filter((c: any) => c.raisedFrom?.workItemId === id);
    t.check("Mohammed finds the Comment", comments.length === 1, `${comments.length}`);
    if (comments[0]) {
      const dm = JSON.stringify((await detail(await crew.as("mohammed"), comments[0].id)).body);
      t.check("Mohammed reads TMC by name only for the Comment (no TMC pool names, no holder)", /TMC Constructions/.test(dm) && !/Ali Sonour|Hafiz Hamdan|Omar/.test(dm), dm.match(/"heldBy":\{[^}]*\}[^}]*\}/)?.[0] ?? "");
      const row = (await listAll(await crew.as("mohammed"), pid, "", "snag_list")).find((r) => r.id === comments[0]!.id);
      t.check("and the List row says only With TMC Constructions", row?.with?.kind === "company", JSON.stringify(row?.with));
    }
    const { context, page } = await pageAs("ali");
    try {
      await page.goto(`${webUrl}/en/work-items/${id}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      await t.shot(page, "ali-item-with-dcl");
    } finally {
      await context.close();
    }
  } finally {
    const back = await setMemberVisibility(layla, pidD, saraId, original);
    t.check("Sara's Visibility is restored to Mechanical only (FX-K1M kept)", back.status < 300 && sameGrant((await memberVisibility(layla, pidD, saraId)).trade, original.trade), `${back.status}`);
  }
});

const darAt = async (crew: Crew, subject: string) => {
  const hafiz = await crew.as("hafiz");
  const created = must<{ id: string }>(
    await hafiz.post(`/projects/${crew.projectId}/work-items`, {
      type: "DAR",
      title: subject,
      answers: { document_type: "calculation", document_title: subject, document_revision: "R0", specification_section: "26 05 19", trade: crew.dims.trade.EL, location: crew.dims.location.T2F01 },
    }),
    "create DAR",
  );
  await upload(hafiz, created.id, { fieldKey: "document", fileName: "UAT-DAR.pdf", contentType: "application/pdf", body: pdfBytes(subject) });
  await sendForReview(crew, created.id);
  await aliSubmit(crew, created.id);
  return created.id;
};

defineCase("VIS-24", async (t) => {
  const crew = await Crew.start();
  const pid = crew.projectId;
  const tag = String(Date.now()).slice(-5);
  const subject = `UAT VIS-24 DAR ${tag}`;
  const id = await darAt(crew, subject);
  const mohammed = await crew.as("mohammed");
  const noura = await crew.as("noura");
  const hafiz = await crew.as("hafiz");
  const ali = await crew.as("ali");
  await pickUp(mohammed, id);
  const rec = await mohammed.transition(id, "recommend_b", {
    answers: { sample_checked: true, matches_specification: true, verification_note: "UAT", remarks: "UAT VIS-24 recommend remarks", items_to_create: [{ comment: "UAT VIS-24 table comment 1", reference: "a" }, { comment: "UAT VIS-24 table comment 2", reference: "b" }] },
    internalNote: "UAT VIS-24 DCL internal",
  });
  t.check("Mohammed recommends Code B with a table of comments to the Owner", rec.status < 300, `${rec.status} ${rec.text.slice(0, 160)}`);
  await sleep(600);
  await pickUp(noura, id);
  for (const [who, api] of [["hafiz", hafiz], ["ali", ali]] as const) {
    const d = (await detail(api, id)).body as any;
    t.check(`${who}'s item reads With Owner review (no Company name) and no Code`, d.heldBy?.companyName?.en === "Owner review" && d.outcome === null && d.actions?.recommendedCode === undefined, JSON.stringify({ h: d.heldBy?.companyName, o: d.outcome }));
    const row = (await searchRows(api, pid, subject)).find((r) => r.id === id);
    t.check(`${who}'s List row reads With Owner review and no outcome`, row?.with?.kind === "company" && row.with.companyName.en === "Owner review" && row.outcome === null, JSON.stringify(row?.with));
    const kan = ((await api.get(`/projects/${pid}/work-items/kanban`)).body as any).columns.flatMap((c: any) => c.lanes.map((l: any) => ({ ...l, stage: c.stageKey })));
    const lane = kan.find((l: any) => l.cards?.some((c: any) => c.id === id));
    t.check(`${who}'s Kanban lane for it is Owner review`, lane?.kind === "company" && lane.companyName?.en === "Owner review", JSON.stringify([lane?.kind, lane?.companyName?.en]));
    const h = await historyOf(api, id);
    const feed = (await api.get(`/projects/${pid}/activity`)).text;
    const feedItem = JSON.stringify(((JSON.parse(feed) as any).entries ?? []).filter((e: any) => e.workItem?.id === id));
    t.check(`${who}: no Code anywhere (history, feed, record)`, h.events.every((e) => e.recommendedCode === null && e.outcome === null) && !/"outcome":"B"|recommendedCode":"B"/.test(feedItem) && !h.text.includes("UAT VIS-24 DCL internal") && !h.text.includes("recommend remarks"), "");
    const map = (await api.get(`/work-items/${id}/workflow`)).body as any;
    t.check(`${who}'s workflow map shows it With Owner review`, map?.position?.kind === "company" && /Owner review/.test(JSON.stringify(map.position)), JSON.stringify(map?.position));
  }
  await sleep(5000);
  for (const [who, api] of [["hafiz", hafiz], ["ali", ali]] as const) {
    const bell = JSON.stringify((((await api.get("/notifications")).body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id));
    t.check(`${who}'s bell shows no Code for it`, !/"outcome":"B"|issue_code|recommend/.test(bell), bell.slice(0, 200));
  }
  const _dm = (await detail(mohammed, id)).body as any;
  const dn = (await detail(noura, id)).body as any;
  t.check("Mohammed and Noura read the Recommended Code (B) in the history", (await historyOf(noura, id)).events.some((e) => e.recommendedCode === "B") && (await historyOf(mohammed, id)).events.some((e) => e.recommendedCode === "B"), "");
  t.check("Noura holds the review and may Confirm or Send Back", (dn.actions?.transitions ?? []).some((x: any) => x.key === "confirm_b") && (dn.actions?.transitions ?? []).some((x: any) => x.kind === "send_back"));
  // Noura sends back; Mohammed recommends C; Noura confirms C.
  const sb = await noura.transition(id, "owner_send_back", { answers: { reason: "UAT VIS-24 please reconsider" } });
  t.check("Noura Sends Back", sb.status < 300, `${sb.status} ${sb.text.slice(0, 120)}`);
  await sleep(500);
  await pickUp(mohammed, id);
  const rc = await mohammed.transition(id, "recommend_c", { answers: { sample_checked: true, matches_specification: false, verification_note: "UAT C", remarks: "UAT VIS-24 revise" } });
  t.check("Mohammed recommends C", rc.status < 300, `${rc.status} ${rc.text.slice(0, 120)}`);
  await pickUp(noura, id);
  const cc = await noura.transition(id, "confirm_c", {});
  t.check("Noura Confirms C", cc.status < 300, `${cc.status} ${cc.text.slice(0, 120)}`);
  await sleep(600);
  for (const [who, api] of [["hafiz", hafiz], ["ali", ali], ["mohammed", mohammed]] as const) {
    const d = (await detail(api, id)).body as any;
    t.check(`${who} reads the issued Code C after the Confirm`, d.outcome === "C", `${d.outcome}`);
  }
  t.check("Code C offers a Revision to Hafiz", ((await detail(hafiz, id)).body as any).actions?.createRevision === true);
  // A second DAR: Code B confirmed makes Comments from Mohammed's rows, held by TMC.
  const id2 = await darAt(crew, `${subject} second`);
  await pickUp(mohammed, id2);
  must(await mohammed.transition(id2, "recommend_b", { answers: { sample_checked: true, matches_specification: true, remarks: "r", items_to_create: [{ comment: "UAT VIS-24 owner comment", reference: "x" }] } }), "recommend_b second");
  await pickUp(noura, id2);
  must(await noura.transition(id2, "confirm_b", {}), "confirm_b");
  await sleep(1500);
  const comments = (await listAll(hafiz, pid, "", "snag_list")).filter((c: any) => c.raisedFrom?.workItemId === id2);
  t.check("After Confirm B the Comments come from Mohammed's rows and are held by TMC", comments.length === 1 && comments[0]!.with?.kind === "own", JSON.stringify(comments.map((c) => c.with?.kind)));
  const { context, page } = await pageAs("hafiz");
  try {
    await page.goto(`${webUrl}/en/work-items/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await t.shot(page, "hafiz-dar-after-confirm");
  } finally {
    await context.close();
  }
  t.note("The UAT Owner PM step (reads no Recommended Code until issued) is not covered: FX-OW is not applied. The weekly report is not run (needs the RP-922 job tool).");
});

defineCase("VIS-25", async (t) => {
  const crew = await Crew.start();
  const _pid = crew.projectId;
  const id = await submittedMar(crew, "UAT VIS-25 workflow map", { location: "T2F01" });
  const ali = await crew.as("ali");
  const ahmed = await crew.as("ahmed");
  const mohammed = await crew.as("mohammed");
  const map = async (api: Api) => (await api.get(`/work-items/${id}/workflow`)).body as any;
  const a1 = await map(ali);
  const stepKeys = (a1.definition?.steps ?? []).map((s: any) => s.key);
  t.check("Ali reads the whole Version with every Company's Steps (Contractor and Consultant Steps)", stepKeys.includes("consultant_engineer") && stepKeys.includes("consultant_manager") && stepKeys.includes("internal_review"), stepKeys.join(","));
  t.check("The item is With Design Consultants LLC over DCL's part: no DCL Step is marked", a1.position?.kind === "company" && /Design Consultants/.test(JSON.stringify(a1.position)) && !/consultant_/.test(JSON.stringify(a1.position)), JSON.stringify(a1.position));
  await pickUp(ahmed, id);
  await takeOk(ahmed, id, "send_to_manager", { answers: { sample_checked: true, matches_specification: true, verification_note: "UAT" }, recommendedCode: "A" });
  await pickUp(mohammed, id);
  const a2 = await map(ali);
  t.check("After Ahmed sends it to Mohammed, Ali's map position changes nothing", JSON.stringify(a1.position) === JSON.stringify(a2.position), JSON.stringify(a2.position));
  const m = await map(mohammed);
  t.check("DCL sees Mohammed's Step marked (consultant_manager)", m.position?.kind === "own" && m.position.stepKey === "consultant_manager", JSON.stringify(m.position));
  const _o = await map(await crew.as("faisal")).catch(() => null);
  t.check("The same Version is read whole by every Member (Mohammed reads the same steps)", JSON.stringify((m.definition?.steps ?? []).map((s: any) => s.key)) === JSON.stringify(stepKeys));
  const { context, page } = await pageAs("ali");
  try {
    await page.goto(`${webUrl}/en/work-items/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const btn = page.getByRole("button", { name: /view workflow/i }).or(page.getByRole("link", { name: /view workflow/i })).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(900);
    }
    await t.shot(page, "ali-workflow-drawer");
  } finally {
    await context.close();
  }
  t.note("The UAT Owner PM reader is not covered: FX-OW is not applied.");
});
