/* eslint-disable @typescript-eslint/no-explicit-any -- UAT scripts read api answers as loose JSON */
import { defineCase } from "../harness/case.ts";
import { pageAs } from "../harness/browser.ts";
import {
  Crew, createMar, detail, expectHidden, expectNotFoundPage, expectVisible, historyOf, listOf, memberIdOf, memberVisibility, mohammedCodes,
  myParticipantId, pickUp, searchRows, sendForReview, setMemberVisibility, sleep, stageCounts, submittedMar, takeOk, emailOf, sameGrant,
} from "../harness/helpers-vis.ts";

// VIS-01 .. VIS-05: Drafts, the Submit, Code visibility, Code B Comments. See planning/uat/round-0/test-cases.json.

const homeCounts = async (crew: Crew, who: string) => JSON.stringify(((await (await crew.as(who)).get("/home")).body as any)?.counts ?? null);
const stable = async <T,>(f: () => Promise<T>): Promise<T> => {
  let prev = JSON.stringify(await f());
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    const cur = await f();
    if (JSON.stringify(cur) === prev) return cur;
    prev = JSON.stringify(cur);
  }
  return JSON.parse(prev) as T;
};
const stagesOf = async (crew: Crew, who: string) => JSON.stringify(stageCounts(await listOf(await crew.as(who), crew.projectId)));

defineCase("VIS-01", async (t) => {
  const crew = await Crew.start();
  const subject = "UAT VIS-01 Draft";
  const observers = ["yousef", "ahmed", "sara", "mohammed", "faisal", "noura"];
  const yBefore = { stages: await stagesOf(crew, "yousef"), home: await homeCounts(crew, "yousef") };
  const id = await createMar(crew, subject, { trade: "EL", location: "T1F01" });
  await expectVisible(t, crew, "hafiz", id, subject, "(his Draft)");
  for (const o of observers) await expectHidden(t, crew, o, id, subject, "as a Draft");
  const yMid = { stages: await stagesOf(crew, "yousef"), home: await homeCounts(crew, "yousef") };
  t.check("Yousef's List stage counts and Home counts are unchanged by the Draft", yBefore.stages === yMid.stages && yBefore.home === yMid.home, `${yBefore.stages} / ${yMid.stages}; ${yBefore.home} / ${yMid.home}`);
  await sendForReview(crew, id);
  await expectVisible(t, crew, "hafiz", id, subject, "(sent for review)");
  await expectVisible(t, crew, "ali", id, subject, "(he holds it in internal review)");
  for (const o of observers) await expectHidden(t, crew, o, id, subject, "in TMC internal review");
  const yAfter = { stages: await stagesOf(crew, "yousef"), home: await homeCounts(crew, "yousef") };
  t.check("Yousef's counts are still unchanged after the send for review", yBefore.stages === yAfter.stages && yBefore.home === yAfter.home, `${yBefore.stages} / ${yAfter.stages}`);
  const { context, page } = await pageAs("yousef");
  try {
    await page.goto(`${(await import("../harness/browser.ts")).webUrl}/en/projects/${crew.projectId}/work-items`, { waitUntil: "networkidle" });
    await page.getByRole("main").getByRole("searchbox").or(page.getByRole("main").getByPlaceholder(/search/i)).first().fill(subject).catch(() => undefined);
    await page.waitForTimeout(900);
    const body = await page.locator("main").innerText();
    t.check("Yousef's Submittals page, searched for the Subject, shows no row of it", !body.includes(subject));
    await t.shot(page, "yousef-search");
  } finally {
    await context.close();
  }
  await expectNotFoundPage(t, crew, "yousef", id, "yousef-item-url");
  t.note("The UAT Owner PM observer of this Test Case is not covered: FX-OW (UAT Owner Co) is not applied.");
});

defineCase("VIS-02", async (t) => {
  const crew = await Crew.start();
  const s1 = "UAT VIS-02 Electrical Tower 1";
  const s2 = "UAT VIS-02 Electrical Tower 2";
  const id1 = await submittedMar(crew, s1, { trade: "EL", location: "T1F01" });
  const id2 = await submittedMar(crew, s2, { trade: "EL", location: "T2F01" });
  const ahmed = await crew.as("ahmed");
  for (const [id, s] of [[id1, s1], [id2, s2]] as const) {
    await expectVisible(t, crew, "ahmed", id, s);
    const d = (await detail(ahmed, id)).body as any;
    t.check(`Ahmed has ${s.slice(-7)} at his Consultant Step (in the pool to pick up, or already his as the only Electrical Engineer after FX-K1M)`, d?.actions?.pickUp === true || /Ahmed/.test(JSON.stringify(d?.heldBy)) || (d?.actions?.transitions ?? []).length > 0, JSON.stringify({ pickUp: d?.actions?.pickUp, heldBy: d?.heldBy?.memberName?.en }));
    await expectVisible(t, crew, "mohammed", id, s);
  }
  // FX-OR: Faisal is Tower 1 only, Noura Tower 2 only: each oversight Member sees the item in their Location, read-only.
  await expectVisible(t, crew, "faisal", id1, s1, "(Tower 1, oversight)");
  await expectVisible(t, crew, "noura", id2, s2, "(Tower 2, oversight)");
  for (const [who, id] of [["faisal", id1], ["noura", id2]] as const) {
    const d = (await detail(await crew.as(who), id)).body as any;
    t.check(`${who} reads it read-only (no Transition, no pick up, no save)`, (d?.actions?.transitions ?? []).length === 0 && !d?.actions?.pickUp && !d?.actions?.saveAnswers, JSON.stringify(d?.actions));
  }
  await expectHidden(t, crew, "faisal", id2, s2, "(Tower 2 is outside his Visibility)");
  await expectHidden(t, crew, "noura", id1, s1, "(Tower 1 is outside her Visibility)");
  for (const [id, s] of [[id1, s1], [id2, s2]] as const) {
    await expectHidden(t, crew, "sara", id, s, "(Mechanical only, FX-K1M)");
    await expectHidden(t, crew, "yousef", id, s, "(same Trade, other Contractor, V3)");
  }
  await expectNotFoundPage(t, crew, "sara", id1, "sara-item-url");
  await expectNotFoundPage(t, crew, "yousef", id2, "yousef-item-url");
  t.note("Faisal covers Tower 1 only and Noura Tower 2 only (FX-OR), so each oversight Member is checked on the item in their Location. The UAT Owner PM is not covered: FX-OW is not applied.");
});

defineCase("VIS-03", async (t) => {
  const crew = await Crew.start();
  const subject = "UAT VIS-03 Electrical MAR";
  const id = await submittedMar(crew, subject, { trade: "EL", location: "T2F01" });
  const layla = await crew.as("layla");
  const pid = await myParticipantId(layla, crew.projectId);
  const sara = await memberIdOf(layla, pid, emailOf.sara!);
  const original = await memberVisibility(layla, pid, sara);
  const electrical = crew.dims.trade.EL!;
  try {
    await expectHidden(t, crew, "sara", id, subject, "(Mechanical only, before the grant)");
    const granted = await setMemberVisibility(layla, pid, sara, { trade: { isAll: false, valueIds: [...new Set([...original.trade.valueIds, electrical])] }, location: original.location });
    t.check("Layla gives Sara Electrical again without a Handover", granted.status < 300, `${granted.status} ${granted.text.slice(0, 120)}`);
    await sleep(300);
    await expectVisible(t, crew, "sara", id, subject, "(the grant is read now, the Submit was earlier)");
    const earlier = await searchRows(await crew.as("sara"), crew.projectId, "UAT VIS-03");
    t.check("Sara reads the earlier item as well", earlier.some((r) => r.id === id), `${earlier.length} rows`);
  } finally {
    const back = await setMemberVisibility(layla, pid, sara, original);
    t.check("Layla removes Electrical again (the fixture is restored)", back.status < 300 && sameGrant((await memberVisibility(layla, pid, sara)).trade, original.trade), `${back.status}`);
  }
  await sleep(300);
  await expectHidden(t, crew, "sara", id, subject, "(after the removal)");
  await expectNotFoundPage(t, crew, "sara", id, "sara-after-removal");
});

defineCase("VIS-04", async (t) => {
  const crew = await Crew.start();
  const subject = "UAT VIS-04 Internal channels";
  const NOTE_ALI = "UAT-VIS04-note-Ali-TMC";
  const NOTE_AHMED = "UAT-VIS04-note-Ahmed-DCL";
  const NOTE_MOHAMMED = "UAT-VIS04-note-Mohammed-DCL";
  const VERIFY_AHMED = "UAT-VIS04-verification-Ahmed";
  const VERIFY_FINAL = "UAT-VIS04-verification-Mohammed-final";
  const REMARKS = "UAT-VIS04-remarks-for-everyone";
  const id = await submittedMar(crew, subject, { trade: "EL", location: "T1F01", internalNote: NOTE_ALI });
  const viewers = ["hafiz", "ali", "faisal"];
  const snapshot = async () => {
    const out: Record<string, string> = {};
    for (const v of viewers) {
      const api = await crew.as(v);
      const h = await historyOf(api, id);
      const feed = await api.get(`/projects/${crew.projectId}/activity`);
      const bell = await api.get(`/notifications`);
      const feedForItem = JSON.stringify(((feed.body as any)?.entries ?? []).filter((e: any) => e.workItem?.id === id));
      const bellForItem = JSON.stringify(((bell.body as any)?.notifications ?? []).filter((n: any) => n.workItemId === id).map((n: any) => ({ k: n.kind, e: n.event })));
      out[v] = JSON.stringify({ history: h.events.map((e) => ({ s: e.seq, t: e.type, a: e.audience })), feed: feedForItem, bell: bellForItem });
    }
    return out;
  };
  await sleep(5000); // the worker delivers bell entries a few seconds late
  const before = await stable(snapshot);
  const ahmed = await crew.as("ahmed");
  await pickUp(ahmed, id);
  await takeOk(ahmed, id, "send_to_manager", {
    answers: { sample_checked: true, matches_specification: true, verification_note: VERIFY_AHMED },
    recommendedCode: "A",
    internalNote: NOTE_AHMED,
  });
  await pickUp(await crew.as("mohammed"), id);
  await sleep(5000);
  const after = await stable(snapshot);
  for (const v of viewers) t.check(`${v}: history, Activity Feed and bell show no change at all before the Code`, before[v] === after[v], before[v] === after[v] ? "identical" : `before ${before[v]!.slice(0, 200)} after ${after[v]!.slice(0, 200)}`);
  const issued = await mohammedCodes(crew, id, "revise_c", { verification_note: VERIFY_FINAL, remarks: REMARKS }, { internalNote: NOTE_MOHAMMED });
  t.check("Mohammed issues Code C with Remarks, a verification note and an Internal Note", issued.status < 300, `${issued.status} ${issued.text.slice(0, 200)}`);
  await sleep(800);
  for (const v of viewers) {
    const h = await historyOf(await crew.as(v), id);
    const txt = h.text;
    const code = h.events.find((e) => e.type === "issue_code");
    t.check(`${v} reads the Code, Remarks and that Mohammed issued it`, code?.outcome === "C" && txt.includes(REMARKS) && /Mohammed/.test(JSON.stringify(code?.by)), JSON.stringify(code?.by));
    t.check(`${v} reads the final verification`, txt.includes(VERIFY_FINAL));
    const forbidden = [VERIFY_AHMED, NOTE_AHMED, NOTE_MOHAMMED].filter((s) => txt.includes(s));
    const kinds = h.events.filter((e) => e.type === "internal_answers" || e.recommendedCode !== null || (e.internalNote && /DCL|Ahmed|Mohammed/.test(e.internalNote)));
    t.check(`${v} never reads Ahmed's reply, a Recommended Code, an internal_answers entry or a DCL Internal Note`, forbidden.length === 0 && kinds.length === 0, `leaked: ${forbidden.join(",")} ${kinds.map((k) => k.type).join(",")}`);
    t.check(`${v}'s history numbering has no gap`, h.events.every((e, i) => e.seq === i + 1), h.events.map((e) => e.seq).join(","));
  }
  const faisalTxt = (await historyOf(await crew.as("faisal"), id)).text;
  t.check("Faisal (K1's Submit is shared) never reads TMC's Internal Note", !faisalTxt.includes(NOTE_ALI));
  for (const v of ["ahmed", "mohammed"]) {
    const h = await historyOf(await crew.as(v), id);
    t.check(`${v} (DCL) sees the Submit but never TMC's Internal Note`, h.events.some((e) => e.type === "transition" && /Submit/.test(e.transition?.en ?? "")) && !h.text.includes(NOTE_ALI), "");
    t.check(`${v} (DCL) reads all of its own: Ahmed's reply, Recommended Code and Internal Notes`, h.text.includes(NOTE_AHMED) && h.text.includes(NOTE_MOHAMMED) && h.events.some((e) => e.recommendedCode === "A"), "");
  }
  const { context, page } = await pageAs("hafiz");
  try {
    await page.goto(`${(await import("../harness/browser.ts")).webUrl}/en/work-items/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const text = await page.locator("body").innerText();
    t.check("Hafiz's item page holds none of DCL's internal text", ![VERIFY_AHMED, NOTE_AHMED, NOTE_MOHAMMED].some((s) => text.includes(s)));
    await t.shot(page, "hafiz-item-after-code");
  } finally {
    await context.close();
  }
});
