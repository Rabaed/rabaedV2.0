// Seam 1 for what the Submittal Panel's approval log and Internal Communication (RP-1067) draw from:
// the item's history read, `GET /v1/work-items/:id/history`, and the item read's `creationDate` and
// `raisedItems` (visibility.md V5, V14; scenarios RP-1067-1 to RP-1067-3). The panel makes no read of
// its own. C1 reads its own people by name, K1 by its Company name only but for the final Code's
// signer, and none of K1's internal events (its pick-ups, its move to its Manager, its Recommended
// Code, its Internal Note); K1 reads none of C1's. K1 reads no "Created": the Creation Date is the
// raiser's Participant's only. On the test Send Back Workflow (addTestWorkflow), which has the Send
// Back and the Recommended Code the scenario needs, its Return and Send Back given a reason and its
// Submit a Cover Note, as the MAR's.
// Seam 2: packages/db/test/rp-1067-visibility-rls.test.ts.
import { publishFormVersion } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { addTestWorkflow, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, detail, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "RLOG";
const C1_NAME = "Approval Log Contracting";
const K1_NAME = "Design Consultants LLC";
const SIGNER = "Rana Signer";
const schema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

let at: Tower;
let k1Engineer: Caller;
let signer: Caller; // K1's manager: issues the Code.
let id = "";
const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";

type HistoryEvent = WorkItemHistory["events"][number];
const history = async (by: Caller): Promise<HistoryEvent[]> => (await readById<WorkItemHistory>(`/v1/work-items/${id}/history`)(by)).flatMap((h) => h.events);
/** An event is known by its time, type and audience: `seq` counts only what the reader sees. */
const eventAt = (event: { at: string | Date; type: string; audience: string }) => `${new Date(event.at).toISOString()} ${event.type} ${event.audience}`;
/** The item's events as the migrator reads them, by actor Participant. */
const eventsOf = async (participantId: string) =>
  (
    await sql<{ at: Date; type: string; audience: string }>`
      select created_at as at, type, audience from work_item_event where work_item_id = ${id}::uuid and actor_participant_id = ${participantId}::uuid order by seq`.execute(migrator)
  ).rows;

/** A form of one optional textarea, `key`, for a Transition's pop-up. */
const textForm = (key: string, label: string) => ({ sections: [{ key, title: bilingual(label), fields: [{ key, type: "textarea", label: bilingual(label) }] }] });

/** Rabaed Type TYPE on the test Workflow with Code B and a Recommended Code; its Return and Send Back ask a reason, its Submit a Cover Note. */
async function addLogType(): Promise<void> {
  const formId = (
    await migrator
      .insertInto("form_definition")
      .values({ owner_kind: "rabaed", name: JSON.stringify(bilingual("Approval log (RP-1067, test)")) })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  const workflowId = await addTestWorkflow((text) => sql.raw(text).execute(migrator), { withApproveB: true, recommendCode: true, publish: false });
  const forms: [string, unknown][] = [
    ["return", textForm("reason", "Reason")],
    ["send_back", textForm("reason", "Reason")],
    ["submit", textForm("cover_note", "Cover Note")],
  ];
  for (const [key, form] of forms) {
    await sql`
      update workflow_transition tr set action_form = ${JSON.stringify(form)}::jsonb
      from workflow_version v where v.id = tr.workflow_version_id and v.workflow_definition_id = ${workflowId}::uuid and tr.key = ${key}
    `.execute(migrator);
  }
  await sql`update workflow_version set status = 'published', published_at = now() where workflow_definition_id = ${workflowId}::uuid`.execute(migrator);
  await migrator
    .insertInto("work_item_type")
    .values({
      owner_kind: "rabaed",
      module_key: "submittals",
      code: TYPE,
      name: JSON.stringify(bilingual("Approval log (RP-1067)")),
      workflow_definition_id: workflowId,
      outcome_kind: "review_code",
      form_definition_id: formId,
    })
    .execute();
  expect(await publishFormVersion(migrator, formId, schema)).toMatchObject({ ok: true });
}

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

beforeAll(async () => {
  await addLogType();
  const c1 = await onboard(C1_NAME);
  await ok(c1.caller.patch(`/v1/members/${c1.company.authorizedPerson.id}`, { canCreateProjects: true }), 200);
  const k1 = await onboard(K1_NAME);
  at = await buildTower(api, { c1, k1 }, "RLG");
  k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  signer = await projectMember(api, k1, at.k1ParticipantId!, ["manager"], { name: SIGNER });
  for (const [by, name] of [[at.c1Engineer, "C1 engineer"], [at.c1Pm, "C1 PM"], [k1Engineer, "K1 engineer"], [at.k1Manager, "K1 manager"], [signer, "K1 signer"]] as const) names.set(by, name);

  const answers = { model: "CT-1", trade: at.electrical, location: at.buildingA };
  id = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title: "Cable trays", answers }), 201)).json().id as string;
  // C1: sent for review, Returned once with a reason, sent again, Submitted with an Internal Note.
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "return", { reason: "Attach the datasheet" });
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit", { answers: { cover_note: "Trays for Level 2" }, internalNote: "C1: quantities checked" });
  // K1: its engineer recommends Code B with an Internal Note; its manager Returns it; it is Sent Back to C1 with a reason.
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Engineer, id, "send_to_manager", { recommendedCode: "B", internalNote: "K1: compared with the sample" });
  await ok(signer.post(`/v1/work-items/${id}/pick-up`));
  await take(signer, id, "return_to_engineer");
  await take(k1Engineer, id, "send_back", { reason: "Wrong tray finish" });
  // C1 Submits again; K1's engineer recommends B again and its manager issues Code B with Remarks, raising 3 Comments.
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Engineer, id, "send_to_manager", { recommendedCode: "B" });
  await ok(signer.post(`/v1/work-items/${id}/pick-up`));
  await take(signer, id, "approve_b", {
    answers: { remarks: "Approved with comments", items_to_create: [{ comment: "Seal the entries" }, { comment: "Earth the trays" }, { comment: "Label the runs" }] },
  });
});

describe("scenario RP-1067-1: C1's PM opens the approval log", () => {
  it("names C1's own people, and K1 by its Company name only but for the final Code's signer", async () => {
    const events = await history(at.c1Pm);
    expect(events.filter((e) => e.by.companyName?.en === C1_NAME).every((e) => e.by.memberName !== null)).toBe(true); // not hidden-from: C1's own events, each named
    // Each K1 turn one shared block: its Send Back, then its Code, with no person, no Step and no Position, the signer named.
    const k1 = events.filter((e) => e.by.companyName?.en === K1_NAME); // not hidden-from: picks K1's events to compare whole
    expect(k1.map((e) => [e.type, e.audience, e.by.memberName, e.by.positions, e.fromStep, e.toStep, e.reason, e.remarks, e.internalNote, e.recommendedCode, e.outcome])).toEqual([
      ["transition", "shared", null, [], null, null, "Wrong tray finish", null, null, null, null],
      ["issue_code", "shared", bilingual(SIGNER), [], null, null, null, "Approved with comments", null, null, "B"],
    ]);
  });

  it("reads as text the Cover Note, the Send Back's reason and the Remarks only of what C1 doesn't write itself", async () => {
    const shared = (await history(at.c1Pm)).filter((e) => e.audience === "shared");
    const texts = shared.flatMap((e) => [e.reason, e.remarks, e.internalNote, e.answers?.cover_note as string | undefined].filter((t) => typeof t === "string"));
    expect(texts).toEqual(["Trays for Level 2", "Wrong tray finish", "Approved with comments"]);
  });

  it("gives K1's internal moves, its Recommended Codes and its Internal Note to K1 only", async () => {
    const internal = (await eventsOf(at.k1ParticipantId!)).filter((e) => e.audience === "internal");
    // K1's pick-ups, its two moves to its Manager, its Return, its two Recommended Codes and its Internal Note.
    expect(internal.map((e) => e.type)).toEqual(expect.arrayContaining(["picked_up", "transition", "recommend_code", "internal_note"]));
    for (const event of internal) {
      await expectHiddenFrom({ read: history, target: eventAt(event), seenBy: [signer, k1Engineer], hiddenFrom: [at.c1Pm, at.c1Engineer], idOf: eventAt, name: named, label: `K1's ${event.type}` });
    }
  });

  it("counts on Code B's chip the 3 Comments C1 sees", async () => {
    expect((await detail(at.c1Pm, id)).raisedItems.map((r) => [r.type.code, r.open + r.closed])).toEqual([["CMT", 3]]);
  });
});

describe("scenario RP-1067-2: the log's start", () => {
  it("gives C1 the Creation Date and K1 none, so K1's log starts at C1's Submit", async () => {
    const created = (by: Caller) => readById(`/v1/work-items/${id}`)(by).then((read) => read.flatMap((d) => ((d as { creationDate: string | null }).creationDate ? [{ id }] : [])));
    await expectHiddenFrom({ read: created, target: id, seenBy: [at.c1Pm, at.c1Engineer], hiddenFrom: [at.k1Manager, k1Engineer, signer], name: named, label: "the Creation Date" });
    const k1Log = await history(signer);
    expect([k1Log[0]!.type, k1Log[0]!.transition?.en, k1Log[0]!.by.memberName]).toEqual(["transition", "Submit", null]);
  });
});

describe("scenario RP-1067-3: each Company's Internal Communication", () => {
  it("gives C1's Return with its reason and C1's Internal Note to C1 only", async () => {
    const c1 = await eventsOf(at.c1ParticipantId);
    // The `created` event is in nobody's history: C1 reads the Creation Date from the item read (RP-1067-2).
    const internal = c1.filter((e) => e.audience === "internal" && e.type !== "created");
    expect(internal.map((e) => e.type)).toEqual(expect.arrayContaining(["internal_note"]));
    for (const event of internal) {
      await expectHiddenFrom({ read: history, target: eventAt(event), seenBy: [at.c1Pm, at.c1Engineer], hiddenFrom: [signer, k1Engineer], idOf: eventAt, name: named, label: `C1's ${event.type}` });
    }
    const c1Pm = await history(at.c1Pm);
    expect(c1Pm.find((e) => e.reason === "Attach the datasheet")).toMatchObject({ type: "transition", audience: "internal", by: { memberName: expect.any(Object) } });
    expect(c1Pm.find((e) => e.type === "internal_note")).toMatchObject({ internalNote: "C1: quantities checked" });
  });

  it("gives K1 its own Internal Note and Recommended Codes, and no C1 internal entry nor a shared move but C1's Submits", async () => {
    const k1 = await history(signer);
    expect(k1.find((e) => e.type === "internal_note")).toMatchObject({ internalNote: "K1: compared with the sample", audience: "internal" });
    expect(k1.filter((e) => e.type === "recommend_code").map((e) => e.recommendedCode)).toEqual(["B", "B"]);
    expect(k1.filter((e) => e.by.companyName?.en === C1_NAME).map((e) => [e.type, e.audience, e.transition?.en])).toEqual([ // not hidden-from: C1's events K1 reads, compared whole
      ["transition", "shared", "Submit"],
      ["transition", "shared", "Submit"],
    ]);
  });
});
