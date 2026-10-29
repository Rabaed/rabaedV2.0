// Seam 1: every Document's fingerprint (RP-618, spec RP-632; ADR 0017 and ADR 0023;
// workflow-engine.md §7; data-model.md, document). When the api confirms an upload
// it takes the SHA-256 of the stored file's bytes and keeps it on the Document; a
// Revision's and a Duplicate's copies carry their source's. Each Transition's
// content hash then covers what is inside every file, not only its name and size,
// so a file swapped in storage no longer matches the trail.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectedContentSha256, HASHED_DOCUMENT_COLUMNS, sha256Hex, testDatabaseUrls, type HashedDocument } from "@rabaed/db/test-support";
import type { DocumentList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { buildTower, draft, ok, take, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

/** The datasheet `draft` attaches (harness.ts, attachDatasheet). */
const DATASHEET = "%PDF-1.7 a datasheet (test)";
/** Two files of the same name and size, with different bytes. */
const FIRST = "%PDF-1.7 the signed letter, first";
const OTHER = "%PDF-1.7 the signed letter, other";

let at: Tower;

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "FPR");
});

/** A Document's fingerprint as stored, read by the migrator (the app role can't read it). */
async function storedFingerprint(documentId: string): Promise<string | null> {
  const { rows } = await sql<{ fingerprint: string | null }>`
    select encode(file_sha256, 'hex') as fingerprint from document where id = ${documentId}::uuid
  `.execute(migrator);
  return rows[0]!.fingerprint;
}

/** The content hash of the item's latest Transition event. */
async function lastContentHash(id: string): Promise<string> {
  const { rows } = await sql<{ hash: string }>`
    select encode(content_sha256, 'hex') as hash from work_item_event
    where work_item_id = ${id}::uuid and type in ('transition', 'issue_code') order by seq desc limit 1
  `.execute(migrator);
  return rows[0]!.hash;
}

/**
 * The content hash worked out from the item's inputs (workflow-engine.md §7): its
 * Subject and answers as stored, no outcome, and its Documents named as the hash
 * names them, each with the fingerprint of the bytes this test uploaded (`bodies`, by file name).
 */
async function expectedHash(id: string, bodies: Record<string, string>): Promise<string> {
  const { rows: items } = await sql<{ title: string; data: object }>`select title, data from work_item where id = ${id}::uuid`.execute(migrator);
  // The fingerprint is the one of the bytes this test uploaded, not the stored one the hash was taken from.
  const { rows: documents } = await sql<HashedDocument>`
    select ${sql.raw(HASHED_DOCUMENT_COLUMNS)} from document
    where work_item_id = ${id}::uuid and confirmed_at is not null and removed_at is null
  `.execute(migrator);
  return expectedContentSha256({
    title: items[0]!.title,
    data: items[0]!.data,
    outcome: null,
    documents: documents.map((d) => ({ ...d, file_sha256: sha256Hex(bodies[d.file_name]!) })),
  });
}

const letter = (by: Caller, id: string, body: string) =>
  uploadDocument(by, id, { fileName: "letter.pdf", contentType: "application/pdf", body });

describe("a confirmed upload", () => {
  it("keeps the SHA-256 of the file's bytes on its Document", async () => {
    const id = await draft(at, at.c1Engineer, "Fingerprinted");
    const documentId = await letter(at.c1Engineer, id, FIRST);
    expect(await storedFingerprint(documentId)).toBe(sha256Hex(FIRST));
  });
});

describe("two uploads with the same name and size but different bytes", () => {
  let first = "";
  let other = "";
  beforeAll(async () => {
    expect(Buffer.byteLength(FIRST)).toBe(Buffer.byteLength(OTHER));
    first = await draft(at, at.c1Engineer, "Same name and size");
    other = await draft(at, at.c1Engineer, "Same name and size");
    await letter(at.c1Engineer, first, FIRST);
    await letter(at.c1Engineer, other, OTHER);
    await take(at.c1Engineer, first, "send_for_review");
    await take(at.c1Engineer, other, "send_for_review");
  });

  it("give different content hashes at the next Transition", async () => {
    expect(await lastContentHash(first)).not.toBe(await lastContentHash(other));
  });

  it("each give the content hash worked out from the item's inputs, fingerprints included", async () => {
    expect(await lastContentHash(first)).toBe(await expectedHash(first, { "datasheet.pdf": DATASHEET, "letter.pdf": FIRST }));
    expect(await lastContentHash(other)).toBe(await expectedHash(other, { "datasheet.pdf": DATASHEET, "letter.pdf": OTHER }));
  });

  it("would not match the trail had the file's bytes been swapped", async () => {
    expect(await lastContentHash(first)).not.toBe(await expectedHash(first, { "datasheet.pdf": DATASHEET, "letter.pdf": OTHER }));
  });

  it("keep each item's chain intact", async () => {
    for (const id of [first, other]) {
      const { rows } = await sql<{ intact: boolean }>`select app.work_item_chain_intact(${id}::uuid) as intact`.execute(migrator);
      expect(rows[0]!.intact).toBe(true);
    }
  });
});

describe("copied Documents", () => {
  let closed = "";
  let source: Record<string, string | null> = {};
  beforeAll(async () => {
    closed = await draft(at, at.c1Engineer, "Copied");
    await letter(at.c1Engineer, closed, FIRST);
    await take(at.c1Engineer, closed, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${closed}/pick-up`));
    await take(at.c1Pm, closed, "submit");
    await ok(at.k1Manager.post(`/v1/work-items/${closed}/pick-up`));
    await take(at.k1Manager, closed, "revise_c", { remarks: "Resubmit" });
    source = await fingerprintsByName(closed);
    expect(source).toEqual({ "datasheet.pdf": sha256Hex(DATASHEET), "letter.pdf": sha256Hex(FIRST) });
  });

  async function fingerprintsByName(id: string): Promise<Record<string, string | null>> {
    const list: DocumentList = (await ok(at.c1Engineer.get(`/v1/work-items/${id}/documents`), 200)).json();
    return Object.fromEntries(await Promise.all(list.documents.map(async (d) => [d.fileName, await storedFingerprint(d.id)] as const)));
  }

  it("carry their source's fingerprint in a Revision", async () => {
    const revision = (await ok(at.c1Engineer.post(`/v1/work-items/${closed}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
    expect(await fingerprintsByName(revision)).toEqual(source);
  });

  it("carry their source's fingerprint in a Duplicate", async () => {
    const copy = (await ok(at.c1Engineer.post(`/v1/work-items/${closed}/duplicate`, { idempotencyKey: randomUUID() }), 201)).json().id;
    expect(await fingerprintsByName(copy)).toEqual(source);
  });
});

// A fingerprint confirms a guess at the file's bytes (CODING_STANDARDS, Side channels), so like the
// content hash it reaches nobody through the api: only the record job reads it.
describe("scenario RP-618-1: the api never gives a Document's fingerprint", () => {
  let id = "";
  beforeAll(async () => {
    id = await draft(at, at.c1Engineer, "Letter K1 reads");
    await letter(at.c1Engineer, id, FIRST);
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
  });

  it("not in the Documents list nor the item read, to C1 or to K1, who read the Document", async () => {
    const hidden = [sha256Hex(FIRST), sha256Hex(DATASHEET)];
    for (const reader of [at.c1Engineer, at.k1Manager]) {
      const list = await ok(reader.get(`/v1/work-items/${id}/documents`), 200);
      expect((list.json() as DocumentList).documents.map((d) => d.fileName).sort()).toEqual(["datasheet.pdf", "letter.pdf"]);
      const item = await ok(reader.get(`/v1/work-items/${id}`), 200);
      for (const body of [list.body, item.body]) {
        for (const fingerprint of hidden) expect(body).not.toContain(fingerprint);
        expect(body).not.toMatch(/fingerprint|file_?sha/i);
      }
    }
  });
});
