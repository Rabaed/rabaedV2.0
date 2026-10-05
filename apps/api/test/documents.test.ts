// Seam 1 for Documents, the Attachments System Field (RP-269, spec RP-261): the
// raiser uploads, lists, downloads and removes Documents in Draft through
// short-lived signed URLs to the local file store; the first Send freezes them;
// anyone who can't see the item gets a 404 for its Documents and their URLs; and
// a download URL stops working once it expires.
import { randomUUID } from "node:crypto";
import type { DocumentList, StartedDocumentUpload } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };

let c1: Company; // Contractor; its Authorized Person created the Project.
let engineer: Caller; // C1 Engineer: raises MARs, holds Attach.
let pm: Caller; // C1 Project Manager.
let viewer: Caller; // C1 Member on the Project with no Position: no Attach.
let c2Engineer: Caller; // Second Contractor.
let k1Engineer: Caller; // Consultant engineer.
let k1Manager: Caller; // Consultant manager: the pool a Submit goes to.
let outsider: Caller; // A C1 Member not on the Project.
let projectId = "";
let electrical = "";
let buildingA = "";

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };
const complete = { manufacturer: "ACME Cables", description: "Galvanised, 300 mm" };
const MINUTE = 60_000;

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

async function projectMember(company: Company, participantId: string, positions: string[]) {
  const { member, caller } = await api.member(company.caller);
  await api.addProjectMember(company.caller, participantId, member.id);
  await ok(
    company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/visibility`, { trade: all, location: all }),
  );
  if (positions.length) {
    await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/positions`, { positions }));
  }
  return caller;
}

async function otherParticipant(role: "contractor" | "consultant") {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return (positions: string[]) => projectMember(company, participantId, positions);
}

async function draft(answers: Record<string, unknown> = complete): Promise<string> {
  const res = await ok(
    // Trade and Location are Built-in Fields: answers like the rest (RP-270).
    engineer.post(`/v1/projects/${projectId}/work-items`, {
      type: "MAR",
      title: "Cable trays",
      answers: { trade: electrical, location: buildingA, ...answers },
    }),
    201,
  );
  return res.json().id;
}

const take = (by: Caller, id: string, transition: string, { reason, ...extra }: { reason?: string } = {}) =>
  by.post(`/v1/work-items/${id}/transitions`, { transition, idempotencyKey: randomUUID(), ...(reason === undefined ? {} : { answers: { reason } }), ...extra });

const documentsUrl = (itemId: string) => `/v1/work-items/${itemId}/documents`;
const documentUrl = (itemId: string, documentId: string) => `${documentsUrl(itemId)}/${documentId}`;

const start = (by: Caller, itemId: string, file: { fileName?: string; sizeBytes: number; contentType?: string }) =>
  by.post(documentsUrl(itemId), { fileName: "datasheet.pdf", contentType: "application/pdf", ...file });

/** PUTs `body` to a signed upload URL, as the browser does. */
const put = (upload: StartedDocumentUpload["upload"], body: string) =>
  fetch(upload.url, { method: upload.method, headers: upload.headers, body });

/** Steps 1–3: starts, uploads and confirms a file; returns the Document's id. */
async function uploaded(by: Caller, itemId: string, body = "%PDF-1.7 a datasheet", fileName = "datasheet.pdf"): Promise<string> {
  const started: StartedDocumentUpload = (await ok(start(by, itemId, { fileName, sizeBytes: body.length }), 201)).json();
  expect((await put(started.upload, body)).status).toBe(200);
  await ok(by.post(`${documentUrl(itemId, started.id)}/confirm`));
  return started.id;
}

async function list(by: Caller, itemId: string): Promise<DocumentList> {
  return (await ok(by.get(documentsUrl(itemId)), 200)).json();
}

const downloadUrl = async (by: Caller, itemId: string, documentId: string): Promise<string> =>
  (await ok(by.get(`${documentUrl(itemId, documentId)}/download`), 200)).json().url;

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(c1, own, ["engineer"]);
  pm = await projectMember(c1, own, ["project_manager"]);
  viewer = await projectMember(c1, own, []);
  c2Engineer = await (await otherParticipant("contractor"))(["engineer"]);
  const k1 = await otherParticipant("consultant");
  k1Engineer = await k1(["engineer"]);
  k1Manager = await k1(["manager"]);
  outsider = (await api.member(c1.caller)).caller;
});

describe("a Draft's Documents, for the raiser", () => {
  let itemId = "";
  let documentId = "";
  const body = "%PDF-1.7 cable tray datasheet";

  beforeAll(async () => {
    itemId = await draft();
  });

  it("start empty, and may be changed, within the configured limits", async () => {
    expect(await list(engineer, itemId)).toEqual({
      documents: [],
      canChange: true,
      limits: { maxBytes: 1024 * 1024, contentTypes: ["application/pdf", "image/jpeg", "image/png", "text/plain"] },
    });
  });

  it("upload in three steps: a signed URL, the file, then confirm", async () => {
    documentId = await uploaded(engineer, itemId, body, "Tray datasheet — rev 1.pdf");
    const { documents } = await list(engineer, itemId);
    expect(documents).toEqual([
      {
        id: documentId,
        fileName: "Tray datasheet — rev 1.pdf",
        sizeBytes: body.length,
        contentType: "application/pdf",
        uploadedAt: expect.any(String),
        uploadedBy: { companyName: expect.any(Object), memberName: { en: "Test Member", ar: "عضو الاختبار" } },
        frozen: false,
        // The Attachments System Field's: no Form field (RP-281).
        fieldKey: null,
        itemKey: null,
        // Not a photo: no time or place (RP-284).
        takenAt: null,
        takenWhere: null,
      },
    ]);
  });

  it("download through a short-lived signed URL, with their name and type", async () => {
    const res = await fetch(await downloadUrl(engineer, itemId, documentId));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''Tray%20datasheet%20%E2%80%94%20rev%201.pdf");
  });

  it("are listed and downloaded by the raiser's Company, and only changed with Attach", async () => {
    expect((await list(pm, itemId)).canChange).toBe(true);
    expect((await list(viewer, itemId)).canChange).toBe(false);
    expect((await start(viewer, itemId, { sizeBytes: 10 })).json()).toEqual({ error: "forbidden" });
    expect((await viewer.delete(documentUrl(itemId, documentId))).json()).toEqual({ error: "forbidden" });
    expect((await fetch(await downloadUrl(viewer, itemId, documentId))).status).toBe(200);
  });

  it("are not listed until confirmed, and not confirmed until the file is stored", async () => {
    const started: StartedDocumentUpload = (await ok(start(engineer, itemId, { sizeBytes: 12 }), 201)).json();
    expect((await list(engineer, itemId)).documents.map((d) => d.id)).toEqual([documentId]);
    const res = await engineer.post(`${documentUrl(itemId, started.id)}/confirm`);
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "not_uploaded" } });
    await expectHidden(engineer.get(`${documentUrl(itemId, started.id)}/download`));
  });

  it("refuse a file that isn't the one declared: the store checks the signature's size and type", async () => {
    const started: StartedDocumentUpload = (await ok(start(engineer, itemId, { sizeBytes: 12 }), 201)).json();
    expect((await put(started.upload, "a much longer file than declared")).status).toBe(403);
    const otherType = await fetch(started.upload.url, { method: "PUT", headers: { "content-type": "text/html" }, body: "<h1>12345</h1" });
    expect(otherType.status).toBe(403);
  });

  it("refuse a file over the size limit, or of a type that isn't allowed", async () => {
    expect((await start(engineer, itemId, { sizeBytes: 1024 * 1024 + 1 })).json()).toEqual({ error: "file_too_large" });
    const exe = await start(engineer, itemId, { fileName: "setup.exe", sizeBytes: 10, contentType: "application/x-msdownload" });
    expect({ status: exe.statusCode, body: exe.json() }).toEqual({ status: 422, body: { error: "content_type_not_allowed" } });
  });

  it("can be removed and replaced", async () => {
    const replacement = await uploaded(engineer, itemId, "%PDF-1.7 rev 2", "datasheet rev 2.pdf");
    await ok(engineer.delete(documentUrl(itemId, documentId)));
    expect((await list(engineer, itemId)).documents.map((d) => d.fileName)).toEqual(["datasheet rev 2.pdf"]);
    await expectHidden(engineer.get(`${documentUrl(itemId, documentId)}/download`));
    await expectHidden(engineer.delete(documentUrl(itemId, documentId)));
    documentId = replacement;
  });
});

describe("Documents once the item is sent", () => {
  let itemId = "";
  let documentId = "";
  let datasheetId = ""; // The MAR Form Version 2's Datasheet field, which it needs to leave Draft.

  beforeAll(async () => {
    itemId = await draft();
    documentId = await uploaded(engineer, itemId);
    datasheetId = await attachDatasheet(engineer, itemId);
    await ok(take(engineer, itemId, "send_for_review"));
  });

  it("are frozen: no removal, no replacement, no new upload", async () => {
    expect(await list(engineer, itemId)).toMatchObject({
      documents: [
        { id: documentId, frozen: true },
        { id: datasheetId, frozen: true },
      ],
      canChange: false,
    });
    const removed = await engineer.delete(documentUrl(itemId, documentId));
    expect({ status: removed.statusCode, body: removed.json() }).toEqual({ status: 409, body: { error: "document_frozen" } });
    for (const who of [engineer, pm]) {
      const res = await start(who, itemId, { sizeBytes: 10 });
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "not_editable" } });
    }
  });

  it("can still be downloaded", async () => {
    expect((await fetch(await downloadUrl(pm, itemId, documentId))).status).toBe(200);
  });

  it("stay frozen when the item is Returned to Draft, where new ones may be added", async () => {
    await ok(pm.post(`/v1/work-items/${itemId}/claim`));
    await ok(take(pm, itemId, "return", { reason: "Add the test certificate" }));
    expect((await engineer.delete(documentUrl(itemId, documentId))).json()).toEqual({ error: "document_frozen" });
    const certificate = await uploaded(engineer, itemId, "%PDF-1.7 certificate", "certificate.pdf");
    expect((await list(engineer, itemId)).documents.map((d) => [d.id, d.frozen])).toEqual([
      [documentId, true],
      [datasheetId, true],
      [certificate, false],
    ]);
    await ok(engineer.delete(documentUrl(itemId, certificate)));
  });

  it("go with the item to the Consultant once Submitted, who sees the Company, not the person", async () => {
    await ok(take(engineer, itemId, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${itemId}/claim`));
    await ok(take(pm, itemId, "submit"));
    const seen = await list(k1Engineer, itemId);
    expect(seen).toMatchObject({
      documents: [
        { id: documentId, frozen: true, uploadedBy: { memberName: null } },
        { id: datasheetId, frozen: true, uploadedBy: { memberName: null } },
      ],
      canChange: false,
    });
    expect((await fetch(await downloadUrl(k1Engineer, itemId, documentId))).status).toBe(200);
    await ok(k1Manager.post(`/v1/work-items/${itemId}/claim`));
    expect((await k1Manager.delete(documentUrl(itemId, documentId))).json()).toEqual({ error: "document_frozen" });
    expect((await start(k1Manager, itemId, { sizeBytes: 10 })).json()).toEqual({ error: "not_editable" });
  });
});

describe("a hidden item's Documents", () => {
  let itemId = "";
  let documentId = "";
  let pendingId = "";

  beforeAll(async () => {
    itemId = await draft();
    documentId = await uploaded(engineer, itemId);
    pendingId = (await ok(start(engineer, itemId, { sizeBytes: 10 }), 201)).json().id;
  });

  it("answer 404 to every other Company and to a Member off the Project, naming nothing", async () => {
    for (const who of [c2Engineer, k1Engineer, outsider]) {
      await expectHidden(who.get(documentsUrl(itemId)));
      await expectHidden(who.get(`${documentUrl(itemId, documentId)}/download`));
      await expectHidden(start(who, itemId, { sizeBytes: 10 }));
      await expectHidden(who.post(`${documentUrl(itemId, pendingId)}/confirm`));
      await expectHidden(who.delete(documentUrl(itemId, documentId)));
    }
  });

  it("answer 404 to another Member of the raiser's Company for an upload that isn't theirs to confirm", async () => {
    await expectHidden(pm.post(`${documentUrl(itemId, pendingId)}/confirm`));
  });

  it("answer 404 under another item, or for ids that aren't Documents", async () => {
    const otherItem = await draft();
    await expectHidden(engineer.get(`${documentUrl(otherItem, documentId)}/download`));
    await expectHidden(engineer.delete(documentUrl(otherItem, documentId)));
    await expectHidden(engineer.get(`${documentUrl(itemId, randomUUID())}/download`));
    await expectHidden(engineer.get(`${documentUrl(itemId, "not-a-uuid")}/download`));
    await expectHidden(engineer.get(documentsUrl(randomUUID())));
  });
});

describe("a download URL", () => {
  it("stops working once it expires", async () => {
    const itemId = await draft();
    const documentId = await uploaded(engineer, itemId);
    // Signed 20 minutes ago: it expired 15 minutes ago.
    api.advanceClock(-20 * MINUTE);
    try {
      const expired = await downloadUrl(engineer, itemId, documentId);
      expect((await fetch(expired)).status).toBe(403);
    } finally {
      api.advanceClock(20 * MINUTE);
    }
    expect((await fetch(await downloadUrl(engineer, itemId, documentId))).status).toBe(200);
  });
});
