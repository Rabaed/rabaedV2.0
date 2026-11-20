// Seam 1 for RP-1319 (ADR 0030; visibility.md V1, the Working Copy, Documental Record and Verification
// page rows; docs/visibility/scenarios/RP-1319.md): before its first Submit an item has no Document
// Number. Its Working Copy and Documental Record are named by its Type and Subject, for the Members who
// see it only; Rabaed Admin finds it by its id on its Project, never as a Draft; and a Record that never
// got a number is verified by its code alone, with the same printed face a numbered Record shows. The
// worker is stood in for: the app role with no Member saves the Working Copy, and the migrator writes
// the Record and its face as the record job does (packages/db/test/rp-1319-visibility-rls.test.ts has
// the database's side).
import { createHash, randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller, type TestApi } from "./support/harness.ts";
import { all, buildTower, detail, draft, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 1 });
// Rabaed Admin's connection.
const adminDb = createDb(urls.admin, { max: 1 });
const migrator = createDb(urls.migrator, { max: 1 });
let api: TestApi;
let at: Tower;
let c2Engineer: Caller;
let orEngineer: Caller;

beforeAll(async () => {
  api = await createTestApi({ files: true });
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  const or = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "NNY");
  await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  const orParticipant = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipant}/visibility`, { trade: all, location: all }));
  orEngineer = await projectMember(api, or, orParticipant, ["engineer"]);
}, 240_000);

afterAll(async () => {
  await api?.close();
  await Promise.all([worker.destroy(), adminDb.destroy(), migrator.destroy()]);
});

const MAR = { type: "MAR" } as const;
const inReview = async (title: string) => {
  const id = await draft(at, at.c1Engineer, title, MAR);
  await take(at.c1Engineer, id, "send_for_review");
  return id;
};
const whoIs = (by: Caller) =>
  by === at.c1Engineer ? "C1 engineer" : by === at.c1Pm ? "C1 PM" : by === at.k1Manager ? "K1" : by === orEngineer ? "OR" : by === c2Engineer ? "C2" : "someone";
const sha = (s: string) => createHash("sha256").update(s).digest();

/** The file name a signed download link (an S3 link with its response-content-disposition) gives the browser. */
const fileNameOf = (url: string) => {
  const disposition = new URL(url).searchParams.get("response-content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  return encoded ? decodeURIComponent(encoded) : null;
};

/** Item `id`'s Working Copy as `by` asks for it: the worker stand-in saves a queued one, then the link's file name. */
async function workingCopyName(by: Caller, id: string): Promise<string | null> {
  const ask = () => by.post(`/v1/work-items/${id}/working-copy`);
  const first = await ok(ask(), 200);
  if (first.json().status === "preparing") {
    const { rows } = await sql<{ id: string }>`
      select o.id from outbox o join working_copy c on c.outbox_id = o.id where o.kind = 'working_copy' and c.work_item_id = ${id}::uuid and c.made_at is null
    `.execute(migrator);
    for (const job of rows) {
      await sql`select app.save_working_copy(${job.id}::uuid, ${`projects/${at.projectId}/work-items/${id}/working-copy/${job.id}.pdf`})`.execute(worker);
    }
  }
  const answer = (await ok(ask(), 200)).json();
  expect(answer.status).toBe("ready");
  return fileNameOf(answer.url);
}

/** Item `id`'s Working Copy for expectHiddenFrom: `[{ id }]` when `by` is answered, `[]` for the plain 404. */
const copyOf = (id: string) => async (by: Caller) => {
  const res = await by.post(`/v1/work-items/${id}/working-copy`);
  if (res.statusCode === 200) return [{ id }];
  await expectHidden(res, `working copy of ${id}`);
  return [];
};
/** Item `id`'s Documental Record link for expectHiddenFrom. */
const recordOf = (id: string) => async (by: Caller) => {
  const res = await by.get(`/v1/work-items/${id}/documental-record`);
  if (res.statusCode === 200) return [{ id, name: fileNameOf(res.json().url) }];
  await expectHidden(res, `documental record of ${id}`);
  return [];
};

/** A published Documental Record of item `id`, as the record job writes it with its printed face; its Verification Code. */
async function publishRecord(id: string, code: string, faceNumber: string | null, subject: string): Promise<void> {
  const { rows } = await sql<{ project_id: string }>`select project_id from work_item where id = ${id}::uuid`.execute(migrator);
  const projectId = rows[0]!.project_id;
  const key = `projects/${projectId}/work-items/${id}/documental-record/rp1319`;
  const file = async (name: string, mime: string) =>
    (
      await sql<{ id: string }>`insert into stored_file (storage_key, sha256, size, mime) values (${`${key}/${name}`}, ${sha(`${id} ${name}`)}, 10, ${mime}) returning id`.execute(
        migrator,
      )
    ).rows[0]!.id;
  await sql`
    insert into documental_record (project_id, work_item_id, pdf_file_id, record_data_file_id, layout_version, language, outcome,
      pdf_sha256, sealed_at, verification_token_hash, verification_code, status)
    values (${projectId}::uuid, ${id}::uuid, ${await file("record.pdf", "application/pdf")}::uuid, ${await file("record-data.xml", "application/xml")}::uuid,
      '2', 'bilingual', 'cancelled', ${sha(`pdf ${id}`)}, now(), ${sha(randomUUID())}, ${code}, 'published')
  `.execute(migrator);
  await sql`
    insert into documental_record_face (documental_record_id, language, document_number, subject, project, outcome, signers)
    select r.id, 'en', ${faceNumber}, ${subject}, '{"en": "Printed Project"}', '{"code": null, "name": {"en": "Cancelled"}}', '[]'
    from documental_record r where r.work_item_id = ${id}::uuid
  `.execute(migrator);
}

describe("RP-1319-1: the Working Copy of an item with no number yet", () => {
  it("RP-1319-1: C1 downloads it as \"MAR - <Subject> - Working Copy.pdf\"; K1, the Owner Representative and C2 get the plain 404", async () => {
    const id = await inReview("Cable trays: Level 2/3");
    expect((await detail(at.c1Engineer, id)).documentNumber).toBeNull();
    await expectHiddenFrom({ read: copyOf(id), target: id, seenBy: [at.c1Engineer, at.c1Pm], hiddenFrom: [at.k1Manager, orEngineer, c2Engineer], name: whoIs, label: "the Working Copy" });
    // A "/" or ":" can't be in a file name; it becomes "_".
    expect(await workingCopyName(at.c1Pm, id)).toBe("MAR - Cable trays_ Level 2_3 - Working Copy.pdf");
    await expectHiddenFrom({ read: copyOf(id), target: id, seenBy: at.c1Engineer, hiddenFrom: [at.k1Manager, orEngineer, c2Engineer], name: whoIs, label: "after it was printed" });
  });

  it("RP-1319-1: once Submitted, its Working Copy is named by its Document Number, as before", async () => {
    const id = await inReview("Busbar trunking");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
    const number = (await detail(at.c1Pm, id)).documentNumber!;
    expect(number).toMatch(/^NNY-MAR-/);
    expect(await workingCopyName(at.k1Manager, id)).toBe(`${number} - Working Copy.pdf`);
  });
});

describe("RP-1319-2: the Documental Record of an item cancelled before its first Submit", () => {
  let cancelled = "";

  beforeAll(async () => {
    cancelled = await inReview("Fire dampers");
    await ok(at.c1Pm.post(`/v1/work-items/${cancelled}/pick-up`));
    await take(at.c1Pm, cancelled, "cancel_review");
    expect((await detail(at.c1Engineer, cancelled)).documentNumber).toBeNull();
    await publishRecord(cancelled, "RP13-19A1", null, "Fire dampers");
  });

  it("RP-1319-2: C1 downloads it as \"MAR - <Subject>.pdf\", never the bare \"MAR.pdf\"; K1, the Owner Representative and C2 get the plain 404", async () => {
    const [seen] = await recordOf(cancelled)(at.c1Engineer);
    expect(seen!.name).toBe("MAR - Fire dampers.pdf");
    await expectHiddenFrom({ read: recordOf(cancelled), target: cancelled, seenBy: [at.c1Engineer, at.c1Pm], hiddenFrom: [at.k1Manager, orEngineer, c2Engineer], name: whoIs, label: "the Record" });
  });
});

describe("RP-1319-3: Rabaed Admin finds an item in Internal Review by its id", () => {
  type Found = { work_item_id: string; document_number: string | null; title: string; participant_id: string | null; draft_step: boolean };
  const lookUp = async (projectId: string, lookup: string) =>
    (await sql<Found>`select * from app.work_item_step_for_engineer(${projectId}::uuid, ${lookup})`.execute(adminDb)).rows;

  it("RP-1319-3: finds it by its id on its Project, with C1's Step; not on another Project, and not by a Subject", async () => {
    const id = await inReview("Lighting control panels");
    expect(await lookUp(at.projectId, id)).toEqual([expect.objectContaining({ work_item_id: id, document_number: null, participant_id: at.c1ParticipantId, draft_step: false })]);
    expect(await lookUp(at.projectId, ` ${id.toUpperCase()} `)).toHaveLength(1);
    expect(await lookUp(randomUUID(), id)).toEqual([]); // not hidden-from: the item's id on a Project that has no such item
    expect(await lookUp(at.projectId, "Lighting control panels")).toEqual([]); // not hidden-from: there is no Subject search (owner, 2026-11-17)
  });

  it("RP-1319-3: never finds a Draft by its id: a Draft is its author's alone", async () => {
    const id = await draft(at, at.c1Engineer, "Draft lighting", MAR);
    expect(await lookUp(at.projectId, id)).toEqual([]); // not hidden-from: Rabaed Admin's lookup; the test above finds an item that left Draft
  });

  it("RP-1319-3: the lookup reads nothing for the app role, and K1, the Owner Representative and C2 still don't see the item", async () => {
    const id = await inReview("Earthing pits");
    await expect(sql`select * from app.work_item_step_for_engineer(${at.projectId}::uuid, ${id})`.execute(worker)).rejects.toThrow(/permission denied/);
    await expectHiddenFrom({
      read: async (by: Caller) => {
        const res = await by.get(`/v1/work-items/${id}`);
        if (res.statusCode === 200) return [{ id }];
        await expectHidden(res, "the item");
        return [];
      },
      target: id,
      seenBy: at.c1Engineer,
      hiddenFrom: [at.k1Manager, orEngineer, c2Engineer],
      name: whoIs,
      label: "the item Rabaed Admin looked up",
    });
  });
});

describe("RP-1319-4: verifying a Documental Record that never got a number", () => {
  let cancelled = "";
  let numbered = "";
  let number = "";
  const verify = (code: string, documentNumber: string) => api.anonymous().post("/v1/verification/code", { code, documentNumber });

  beforeAll(async () => {
    cancelled = await inReview("Smoke detectors");
    await ok(at.c1Pm.post(`/v1/work-items/${cancelled}/pick-up`));
    await take(at.c1Pm, cancelled, "cancel_review");
    await publishRecord(cancelled, "RP13-19B2", null, "Smoke detectors");
    numbered = await inReview("Sprinkler heads");
    await ok(at.c1Pm.post(`/v1/work-items/${numbered}/pick-up`));
    await take(at.c1Pm, numbered, "submit");
    number = (await detail(at.c1Pm, numbered)).documentNumber!;
    await publishRecord(numbered, "RP13-19C3", number, "Sprinkler heads");
  });

  it("RP-1319-4: its code alone finds it, whatever the number field holds, with no number and the same fields a numbered Record shows", async () => {
    for (const typed of ["", "No number yet", "anything"]) {
      const res = await verify("RP13-19B2", typed);
      expect(res.statusCode, typed).toBe(200);
      expect(res.json()).toMatchObject({ documentNumber: null, subject: "Smoke detectors", status: "genuine" });
    }
    const unnumbered = (await verify("rp13 19b2", "")).json();
    const withNumber = (await ok(verify("RP13-19C3", number), 200)).json();
    expect(Object.keys(unnumbered).sort()).toEqual(Object.keys(withNumber).sort());
  });

  it("RP-1319-4: a numbered Record still needs its number with the code: the code alone, or a wrong number, is the plain 404", async () => {
    for (const typed of ["", "No number yet", "NNY-MAR-99-9999"]) {
      const res = await verify("RP13-19C3", typed);
      expect(res.statusCode, typed).toBe(404);
      expect(res.json()).toEqual({ error: "not_found" });
    }
    expect((await verify("ZZZZ-ZZZZ", "")).statusCode).toBe(404);
  });
});
