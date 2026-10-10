// Seam 1: every Transition is confirmed and recorded (RP-436; ADR 0017;
// workflow-engine.md §5.1 check 6 and §7; visibility.md V7, the Documental Record
// row and scenario RP-436-1). A Transition the client didn't confirm in its
// pop-up is refused; a confirmed one appends its event to the append-only audit
// trail with who took it, when, and a hash of the item's exact content then:
// its Subject, Form answers, Documents and outcome.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, detail, draft, memberOnProject, ok, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const CONSULTANT = "Test Consultants";
const SIGNER = "Huda Al-Harbi";

let c1: Company;
let k1: Company;
let at: Tower;
let k1ParticipantId = "";
let signer: { id: string; caller: Caller }; // The K1 manager who issues the Code.

/** One Transition's audit row, as the migrator reads the append-only trail. */
type AuditRow = {
  transition: string;
  actor_member_id: string;
  actor_participant_id: string;
  created_at: Date;
  content_sha256: string | null;
};

/** The item's Transitions in the audit trail, in order. */
async function auditTrail(id: string): Promise<AuditRow[]> {
  const { rows } = await sql<AuditRow>`
    select tr.key as transition, e.actor_member_id, e.actor_participant_id, e.created_at,
      encode(e.content_sha256, 'hex') as content_sha256
    from work_item_event e join workflow_transition tr on tr.id = e.transition_id
    where e.work_item_id = ${id}::uuid and e.type in ('transition', 'issue_code')
    order by e.seq
  `.execute(migrator);
  return rows;
}

/** The Draft's answers, with `model` set: the whole Form is saved, as the page saves it. */
const answers = (model: string) => ({
  manufacturer: "ACME Cables",
  description: "Galvanised, 300 mm",
  model,
  trade: at.electrical,
  location: at.buildingA,
});

/** A Transition as the pop-up sends it, without the confirmation. */
const unconfirmed = (by: Caller, id: string, transition: string, extra: Record<string, unknown> = {}) =>
  by.post(`/v1/work-items/${id}/transitions`, { transition, idempotencyKey: randomUUID(), ...extra });

beforeAll(async () => {
  c1 = await api.projectCreator();
  const onboarded = await api.onboardCompany({ legalName: bilingual(CONSULTANT) });
  k1 = { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  at = await buildTower(api, { c1, k1 }, "CNF");
  k1ParticipantId = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => !p.isOwnCompany).id;
  signer = await memberOnProject(api, k1, k1ParticipantId, ["manager"], { name: SIGNER });
});

describe("a Transition without confirmation", () => {
  it("is refused and changes nothing; confirmed, the same Transition is taken", async () => {
    const id = await draft(at, at.c1Engineer, "Unconfirmed");
    for (const confirmed of [undefined, false]) {
      const res = await unconfirmed(at.c1Engineer, id, "send_for_review", confirmed === undefined ? {} : { confirmed });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toEqual({ error: "not_confirmed" });
    }
    expect((await detail(at.c1Engineer, id)).stage.key).toBe("draft");
    expect(await auditTrail(id)).toEqual([]);
    await take(at.c1Engineer, id, "send_for_review");
    expect((await detail(at.c1Engineer, id)).stage.key).toBe("internal_review");
  });

  it("is answered 404 when the item is hidden, as for a made-up id", async () => {
    const id = await draft(at, at.c1Engineer, "Hidden, unconfirmed");
    const res = await unconfirmed(signer.caller, id, "send_for_review");
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the audit row of a confirmed Transition", () => {
  let id = "";
  let trail: AuditRow[] = [];

  beforeAll(async () => {
    id = await draft(at, at.c1Engineer, "Recorded");
    await take(at.c1Engineer, id, "send_for_review"); // 0
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "return", { reason: "Give the model" }); // 1: nothing changed
    await ok(at.c1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: answers("CT-300") }));
    await take(at.c1Engineer, id, "send_for_review"); // 2: an answer changed
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "return", { reason: "Attach the certificate" }); // 3
    await uploadDocument(at.c1Engineer, id, {
      fieldKey: "test_certificate",
      fileName: "certificate.pdf",
      contentType: "application/pdf",
      body: "%PDF-1.7 a certificate",
    });
    await take(at.c1Engineer, id, "send_for_review"); // 4: a Document added
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit"); // 5
    await ok(signer.caller.post(`/v1/work-items/${id}/pick-up`));
    // The Consultant fills its verification (MAR Form Version 4), then issues the Code.
    const filled = { ...(await detail(signer.caller, id)).answers, sample_checked: true, matches_specification: true };
    await ok(signer.caller.request("PUT", `/v1/work-items/${id}/answers`, { answers: filled }));
    await take(signer.caller, id, "approve_a"); // 6: the verification and the outcome set
    trail = await auditTrail(id);
  });

  it("names who took each Transition, from which Participant, and when", async () => {
    expect(trail.map((r) => r.transition)).toEqual([
      "send_for_review",
      "return",
      "send_for_review",
      "return",
      "send_for_review",
      "submit",
      "approve_a",
    ]);
    expect(trail.at(-1)).toMatchObject({ actor_member_id: signer.id, actor_participant_id: k1ParticipantId });
    expect(trail[5]!.actor_participant_id).toBe(at.c1ParticipantId);
    for (const row of trail) expect(row.created_at).toBeInstanceOf(Date);
  });

  it("holds a hash of the content, the same while nothing changed", () => {
    for (const row of trail) expect(row.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(trail[1]!.content_sha256).toBe(trail[0]!.content_sha256);
    expect(trail[5]!.content_sha256).toBe(trail[4]!.content_sha256);
  });

  it("changes the hash when an answer changes", () => {
    expect(trail[2]!.content_sha256).not.toBe(trail[1]!.content_sha256);
  });

  it("changes the hash when a Document is added", () => {
    expect(trail[4]!.content_sha256).not.toBe(trail[3]!.content_sha256);
  });

  it("changes the hash when the Code is issued on the verified answers", () => {
    expect(trail[6]!.content_sha256).not.toBe(trail[5]!.content_sha256);
  });

  // Scenario RP-436-1: the Documental Record names everyone who acted on the
  // path, whichever Company, from these rows (the PDF is RP-23's); the live
  // history keeps V14: another Company by name only, but the final Code's signer.
  it("records every Company's actors for the Documental Record, while the live history keeps V14 (scenario RP-436-1)", async () => {
    const actors = new Set(trail.map((r) => r.actor_participant_id));
    expect(actors).toEqual(new Set([at.c1ParticipantId, k1ParticipantId]));
    const res = await at.c1Pm.get(`/v1/work-items/${id}/history`);
    expect(res.statusCode, res.body).toBe(200);
    const events: WorkItemHistory["events"] = res.json().events;
    const k1Events = events.filter((e) => e.by?.companyName?.en === CONSULTANT);
    expect(k1Events.length).toBeGreaterThan(0);
    for (const e of k1Events) {
      if (e.type === "issue_code") expect(e.by?.memberName).toEqual(bilingual(SIGNER));
      else expect(e.by?.memberName).toBeNull();
    }
  });
});
