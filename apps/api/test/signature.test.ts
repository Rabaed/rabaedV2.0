// Seam 1: the Signature (RP-85, spec RP-632; ADR 0017, ADR 0023; workflow-engine.md §5.1
// check 6 and effect 2). Profile → Add Signature saves a drawn, typed or uploaded image as the
// Member's Signature, in force from then on. Without one a Member takes no Transition: the
// item read says so, so the pop-up shows before the Action Form, and taking it is refused
// `no_signature` with nothing written. Every Transition's event records the Signature in
// force; replacing it never changes an event already written (scenarios RP-85-1, RP-85-2).
import { createDb, withMember } from "@rabaed/db";
import { LEGACY_MAR, testDatabaseUrls } from "@rabaed/db/test-support";
import { SIGNATURE_MAX_BYTES, type MySignature } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoSignaturePng } from "../src/demo/demo-signature.ts";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { detail, memberOnProject, take, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
const appDb = createDb(testDatabaseUrls().app, { max: 1 });
afterAll(async () => {
  await migrator.destroy();
  await appDb.destroy();
  await api.close();
});

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };
const png = (seed = 1) => demoSignaturePng(seed);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

let projectId = "";
let electrical = "";
let buildingA = "";
let engineer: { id: string; caller: Caller };
let pm: { id: string; caller: Caller };
let otherCompany: Caller;

const save = (by: Caller, body: { method: string; contentType: string; data: string }) => by.request("PUT", "/v1/me/signature", body);
const saveImage = (by: Caller, bytes: Buffer, method = "drawn", contentType = "image/png") =>
  save(by, { method, contentType, data: bytes.toString("base64") });
const mine = async (by: Caller): Promise<MySignature> => {
  const res = await by.get("/v1/me/signature");
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

/** A complete Draft MAR of the Engineer's. */
async function createDraft(title = "Cable trays", { datasheet = true } = {}): Promise<string> {
  const res = await engineer.caller.post(`/v1/projects/${projectId}/work-items`, {
    type: LEGACY_MAR,
    title,
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: electrical, location: buildingA },
  });
  expect(res.statusCode, res.body).toBe(201);
  if (datasheet) await attachDatasheet(engineer.caller, res.json().id);
  return res.json().id;
}

/** The item's Transition events as the owner reads them (signature_id is not granted to the app role). */
const transitionEvents = async (id: string) =>
  (
    await sql<{ seq: number; actor_member_id: string; signature_id: string | null }>`
      select seq, actor_member_id, signature_id from work_item_event
      where work_item_id = ${id}::uuid and type in ('transition', 'issue_code') order by seq
    `.execute(migrator)
  ).rows;
/** The Project's outbox rows: what would notify anyone. */
const outboxCount = async () =>
  Number((await sql<{ n: string }>`select count(*) as n from outbox where project_id = ${projectId}::uuid`.execute(migrator)).rows[0]!.n);
const eventCount = async (id: string) =>
  Number((await sql<{ n: string }>`select count(*) as n from work_item_event where work_item_id = ${id}::uuid`.execute(migrator)).rows[0]!.n);

beforeAll(async () => {
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json()
    .id;
  const participantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  expect((await c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all })).statusCode).toBe(204);
  engineer = await memberOnProject(api, c1, participantId, ["engineer"]);
  pm = await memberOnProject(api, c1, participantId, ["project_manager"]);
  otherCompany = (await api.authorizedPerson()).caller;
});

describe("Add Signature", () => {
  let member: { id: string; caller: Caller };
  beforeAll(async () => {
    const company = await api.authorizedPerson();
    const invited = await api.inviteMember(company.caller);
    member = { id: invited.id, caller: await api.acceptInvitation(invited.invitationToken) };
    await api.withoutSignature(member.id);
  });

  it("is none until the Member adds one", async () => {
    expect(await mine(member.caller)).toEqual({ signature: null });
  });

  it("saves a drawn image as the Member's Signature, which they read back, image and all", async () => {
    const image = png(7);
    const res = await saveImage(member.caller, image);
    expect(res.statusCode, res.body).toBe(200);
    const { signature } = await mine(member.caller);
    expect(signature).toMatchObject({ method: "drawn", id: expect.any(String), activeFrom: expect.any(String) });
    // The save answers with the same Signature (its link signed a moment earlier).
    expect(res.json()).toMatchObject({ signature: { id: signature!.id, method: "drawn", activeFrom: signature!.activeFrom } });
    const stored = await fetch(signature!.image.url);
    expect(stored.status).toBe(200);
    expect(stored.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await stored.arrayBuffer()).equals(image)).toBe(true);
  });

  it("saves a typed one and an uploaded JPEG the same way, each replacing the one before", async () => {
    const before = (await mine(member.caller)).signature!.id;
    expect((await saveImage(member.caller, png(8), "typed")).statusCode).toBe(200);
    const typed = (await mine(member.caller)).signature!;
    expect(typed).toMatchObject({ method: "typed" });
    expect(typed.id).not.toBe(before);
    expect((await saveImage(member.caller, jpeg, "uploaded", "image/jpeg")).statusCode).toBe(200);
    expect((await mine(member.caller)).signature).toMatchObject({ method: "uploaded" });
  });

  it("refuses bytes that aren't the image they claim, and an image too large, keeping the one in force", async () => {
    const before = (await mine(member.caller)).signature!.id;
    for (const [bytes, type] of [
      [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png"],
      [png(1), "image/jpeg"],
      [Buffer.concat([png(1), Buffer.alloc(SIGNATURE_MAX_BYTES)]), "image/png"],
    ] as const) {
      const res = await saveImage(member.caller, bytes, "uploaded", type);
      expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    }
    expect((await saveImage(member.caller, Buffer.from("not an image"), "uploaded")).json()).toEqual({ error: "invalid_signature_image" });
    expect((await mine(member.caller)).signature!.id).toBe(before);
  });

  it("refuses an image type other than PNG or JPEG, and a way of making it other than the three", async () => {
    expect((await save(member.caller, { method: "drawn", contentType: "image/svg+xml", data: png().toString("base64") })).statusCode).toBe(400);
    expect((await save(member.caller, { method: "scanned", contentType: "image/png", data: png().toString("base64") })).statusCode).toBe(400);
  });

  it("is the signed-in Member's own: nobody else reads it, and anyone signed out gets 401", async () => {
    const own = (await mine(member.caller)).signature!.id;
    expect((await mine(otherCompany)).signature?.id).not.toBe(own);
    expect((await api.anonymous().get("/v1/me/signature")).statusCode).toBe(401);
    expect((await api.anonymous().request("PUT", "/v1/me/signature", { method: "drawn", contentType: "image/png", data: "" })).statusCode).toBe(401);
  });
});

describe("No Signature, no Transition (RP-85-1)", () => {
  let id = "";
  beforeAll(async () => {
    // Incomplete (no Datasheet): the Signature is asked for before anything the Form lacks.
    id = await createDraft("Without a Signature", { datasheet: false });
    await api.withoutSignature(engineer.id);
  });
  afterAll(async () => {
    expect((await saveImage(engineer.caller, png(2))).statusCode).toBe(200);
  });

  it("the item read says the holder may not act yet, still listing the Transition, so the pop-up shows before its Action Form", async () => {
    const d = await detail(engineer.caller, id);
    expect(d.actions.signatureRequired).toBe(true);
    expect(d.actions.transitions.map((t) => t.key)).toEqual(["send_for_review"]);
  });

  it("is refused no_signature, with nothing written and nobody notified", async () => {
    const before = await eventCount(id);
    const outbox = await outboxCount();
    const res = await tryTake(engineer.caller, id, "send_for_review");
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "no_signature" } });
    expect(await eventCount(id)).toBe(before);
    expect(await outboxCount()).toBe(outbox);
    expect(await detail(engineer.caller, id)).toMatchObject({ step: { key: "draft" }, documentNumber: null });
  });

  it("is refused in the database too, for an api that let it through", async () => {
    const outcome = await withMember(appDb, engineer.id, (trx) =>
      sql<{ outcome: string }>`
        select app.take_transition(${id}::uuid, 'send_for_review', '{}', '', null, gen_random_uuid(), now()) as outcome
      `
        .execute(trx)
        .then((r) => r.rows[0]!.outcome),
    );
    expect(outcome).toBe("no_signature");
  });

  it("is still the plain 404 for an item they can't see", async () => {
    await api.withoutSignature((await otherCompany.get("/v1/me")).json().member.id);
    await expectHidden(tryTake(otherCompany, id, "send_for_review"));
  });

  it("asks nothing of someone with no Transition to take", async () => {
    expect((await detail(pm.caller, id)).actions).toMatchObject({ signatureRequired: false, transitions: [] });
  });
});

describe("Every Transition records the Signature in force (RP-85-2)", () => {
  let id = "";
  let first = "";
  beforeAll(async () => {
    id = await createDraft("Signed");
    first = (await mine(engineer.caller)).signature!.id;
  });

  it("the Transition's event records the Signature the Member had when taking it", async () => {
    expect((await detail(engineer.caller, id)).actions.signatureRequired).toBe(false);
    await take(engineer.caller, id, "send_for_review");
    expect(await transitionEvents(id)).toEqual([expect.objectContaining({ actor_member_id: engineer.id, signature_id: first })]);
  });

  it("a replaced Signature leaves the earlier event's unchanged, and the next Transition records the new one", async () => {
    expect((await saveImage(engineer.caller, png(3), "typed")).statusCode).toBe(200);
    const second = (await mine(engineer.caller)).signature!.id;
    expect(second).not.toBe(first);
    const pmSignature = (await mine(pm.caller)).signature!.id;
    expect((await pm.caller.post(`/v1/work-items/${id}/pick-up`)).statusCode).toBe(204);
    await take(pm.caller, id, "return", { reason: "Wrong datasheet" });
    await take(engineer.caller, id, "send_for_review");
    expect(await transitionEvents(id)).toEqual([
      expect.objectContaining({ actor_member_id: engineer.id, signature_id: first }),
      expect.objectContaining({ actor_member_id: pm.id, signature_id: pmSignature }),
      expect.objectContaining({ actor_member_id: engineer.id, signature_id: second }),
    ]);
  });

  it("the event's Signature is not read through the app role", async () => {
    const res = await pm.caller.get(`/v1/work-items/${id}/history`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(first);
  });
});
