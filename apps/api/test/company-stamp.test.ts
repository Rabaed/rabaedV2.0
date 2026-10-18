// Seam 1: the Company's logo and Stamp (RP-617, spec RP-632; ADR 0023; workflow-engine.md §5.1
// check 6). The Company's Authorized Person uploads, and replaces, its logo and Stamp in the
// Company profile; every Member of the Company sees them, nobody else. While the Company has no
// Stamp none of its Members takes a Transition: the item read says so, so the message shows
// before the Action Form, and taking it is refused `no_stamp`, with nothing written and nobody
// notified (scenario RP-23-5). The logo is optional and never blocks.
import { createDb, withMember } from "@rabaed/db";
import { LEGACY_MAR, testDatabaseUrls } from "@rabaed/db/test-support";
import { COMPANY_IMAGE_MAX_BYTES, type MyCompany } from "@rabaed/domain";
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

const upload = (by: Caller, companyId: string, kind: "logo" | "stamp", bytes: Buffer, contentType = "image/png") =>
  by.request("PUT", `/v1/companies/${companyId}/${kind}`, { contentType, data: bytes.toString("base64") });
const myCompany = async (by: Caller): Promise<MyCompany> => {
  const res = await by.get("/v1/me/company");
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

/** The Project's outbox rows: what would notify anyone. */
let projectId = "";
const outboxCount = async () =>
  Number((await sql<{ n: string }>`select count(*) as n from outbox where project_id = ${projectId}::uuid`.execute(migrator)).rows[0]!.n);
const eventCount = async (id: string) =>
  Number((await sql<{ n: string }>`select count(*) as n from work_item_event where work_item_id = ${id}::uuid`.execute(migrator)).rows[0]!.n);

describe("the Company profile's logo and Stamp", () => {
  let companyId = "";
  let ap: Caller;
  let colleague: Caller;
  let otherCompany: { companyId: string; caller: Caller };
  beforeAll(async () => {
    const company = await api.authorizedPerson();
    companyId = company.company.companyId;
    ap = company.caller;
    colleague = (await api.member(ap)).caller;
    await api.withoutStamp(companyId);
    const other = await api.authorizedPerson();
    otherCompany = { companyId: other.company.companyId, caller: other.caller };
  });

  it("has neither until the Authorized Person adds them, and says who may", async () => {
    expect(await myCompany(ap)).toMatchObject({ company: { id: companyId }, canManage: true, logo: null, stamp: null });
    expect(await myCompany(colleague)).toMatchObject({ company: { id: companyId }, canManage: false, logo: null, stamp: null });
  });

  it("saves the Stamp the Authorized Person uploads, which every Member of the Company reads back, image and all", async () => {
    const image = png(11);
    const res = await upload(ap, companyId, "stamp", image);
    expect(res.statusCode, res.body).toBe(200);
    const { stamp } = await myCompany(colleague);
    expect(stamp).toMatchObject({ id: expect.any(String), uploadedAt: expect.any(String) });
    expect(res.json()).toMatchObject({ stamp: { id: stamp!.id } });
    const stored = await fetch(stamp!.image.url);
    expect(stored.status).toBe(200);
    expect(stored.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await stored.arrayBuffer()).equals(image)).toBe(true);
  });

  it("saves the logo the same way, a JPEG too, and a new upload replaces the one before", async () => {
    expect((await upload(ap, companyId, "logo", png(12))).statusCode).toBe(200);
    const first = (await myCompany(ap)).logo!.id;
    expect((await upload(ap, companyId, "logo", jpeg, "image/jpeg")).statusCode).toBe(200);
    const { logo, stamp } = await myCompany(ap);
    expect(logo!.id).not.toBe(first);
    expect(stamp).not.toBeNull();
  });

  it("refuses another Member of the Company forbidden, keeping what is in force", async () => {
    const before = await myCompany(ap);
    for (const kind of ["logo", "stamp"] as const) {
      const res = await upload(colleague, companyId, kind, png(13));
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 403, body: { error: "forbidden" } });
    }
    expect(await myCompany(ap)).toMatchObject({ logo: { id: before.logo!.id }, stamp: { id: before.stamp!.id } });
  });

  it("is the plain 404 for another Company's Member, even its Authorized Person, as for a made-up id", async () => {
    const before = await myCompany(ap);
    for (const kind of ["logo", "stamp"] as const) {
      await expectHidden(upload(otherCompany.caller, companyId, kind, png(14)));
    }
    await expectHidden(upload(ap, "00000000-0000-4000-8000-000000000000", "stamp", png(14)));
    await expectHidden(upload(ap, "not-an-id", "stamp", png(14)));
    expect(await myCompany(ap)).toMatchObject({ logo: { id: before.logo!.id }, stamp: { id: before.stamp!.id } });
    expect(await myCompany(otherCompany.caller)).toMatchObject({ company: { id: otherCompany.companyId } });
    expect(JSON.stringify(await myCompany(otherCompany.caller))).not.toContain(before.stamp!.id);
  });

  it("refuses bytes that aren't the image they claim, and an image too large", async () => {
    const before = (await myCompany(ap)).stamp!.id;
    for (const [bytes, type] of [
      [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png"],
      [png(1), "image/jpeg"],
      [Buffer.concat([png(1), Buffer.alloc(COMPANY_IMAGE_MAX_BYTES)]), "image/png"],
    ] as const) {
      const res = await upload(ap, companyId, "stamp", bytes, type);
      expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    }
    expect((await upload(ap, companyId, "stamp", Buffer.from("not an image"))).json()).toEqual({ error: "invalid_company_image" });
    expect((await api.anonymous().request("PUT", `/v1/companies/${companyId}/stamp`, { contentType: "image/png", data: "" })).statusCode).toBe(401);
    expect((await api.anonymous().get("/v1/me/company")).statusCode).toBe(401);
    expect((await myCompany(ap)).stamp!.id).toBe(before);
  });
});

describe("No Stamp, no Transition (RP-23-5)", () => {
  let companyId = "";
  let creator: Caller;
  let electrical = "";
  let buildingA = "";
  let engineer: { id: string; caller: Caller };
  let pm: { id: string; caller: Caller };
  let otherCompany: Caller;
  let id = "";

  /** A Draft MAR of the Engineer's; incomplete without its Datasheet. */
  async function createDraft(title: string, { datasheet = true } = {}): Promise<string> {
    const res = await engineer.caller.post(`/v1/projects/${projectId}/work-items`, {
      type: LEGACY_MAR,
      title,
      answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: electrical, location: buildingA },
    });
    expect(res.statusCode, res.body).toBe(201);
    if (datasheet) await attachDatasheet(engineer.caller, res.json().id);
    return res.json().id;
  }

  beforeAll(async () => {
    const c1 = await api.projectCreator();
    companyId = c1.company.companyId;
    creator = c1.caller;
    projectId = (await api.createProject(creator)).id;
    electrical = (await creator.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
    buildingA = (await creator.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json()
      .id;
    const participantId = (await creator.get(`/v1/projects/${projectId}/participants`))
      .json()
      .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
    expect((await creator.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all })).statusCode).toBe(204);
    engineer = await memberOnProject(api, c1, participantId, ["engineer"]);
    pm = await memberOnProject(api, c1, participantId, ["project_manager"]);
    const other = await api.authorizedPerson();
    otherCompany = other.caller;
    await api.withoutStamp(other.company.companyId);
    // Incomplete (no Datasheet): the Stamp is asked for before anything the Form lacks.
    id = await createDraft("Without a Stamp", { datasheet: false });
    await api.withoutStamp(companyId);
  });

  it("the item read says the holder may not act yet, still listing the Transition, so the message shows before its Action Form", async () => {
    const d = await detail(engineer.caller, id);
    expect(d.actions).toMatchObject({ stampRequired: true, signatureRequired: false });
    expect(d.actions.transitions.map((t) => t.key)).toEqual(["send_for_review"]);
  });

  it("is refused no_stamp, with nothing written and nobody notified", async () => {
    const before = await eventCount(id);
    const outbox = await outboxCount();
    const res = await tryTake(engineer.caller, id, "send_for_review");
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "no_stamp" } });
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
    expect(outcome).toBe("no_stamp");
  });

  it("asks for the Signature first when the Member has neither", async () => {
    await api.withoutSignature(engineer.id);
    try {
      expect((await detail(engineer.caller, id)).actions).toMatchObject({ signatureRequired: true, stampRequired: true });
      expect((await tryTake(engineer.caller, id, "send_for_review")).json()).toEqual({ error: "no_signature" });
    } finally {
      expect((await engineer.caller.request("PUT", "/v1/me/signature", { method: "drawn", contentType: "image/png", data: png(5).toString("base64") })).statusCode).toBe(200);
    }
  });

  it("is still the plain 404 for an item they can't see", async () => {
    await expectHidden(tryTake(otherCompany, id, "send_for_review"));
  });

  it("asks nothing of someone with no Transition to take", async () => {
    expect((await detail(pm.caller, id)).actions).toMatchObject({ stampRequired: false, transitions: [] });
  });

  it("acts again once the Authorized Person adds the Stamp; no logo is needed", async () => {
    expect((await upload(creator, companyId, "stamp", png(21))).statusCode).toBe(200);
    expect((await myCompany(engineer.caller)).logo).toBeNull();
    const signed = await createDraft("With a Stamp");
    expect((await detail(engineer.caller, signed)).actions.stampRequired).toBe(false);
    await take(engineer.caller, signed, "send_for_review");
    expect(await detail(engineer.caller, signed)).toMatchObject({ documentNumber: expect.any(String) });
  });
});
