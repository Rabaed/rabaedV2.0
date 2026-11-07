// Seam 1: a PDF's page count on its Document (RP-1189; gap table v3 row 14, the Submittal Panel's file
// cards). When the api confirms an upload of a PDF it counts the pages in the stored file's bytes and
// keeps them; the file list (`GET /v1/work-items/:id/documents`) returns `pageCount`, null for any other
// file and for a PDF it can't read. A Revision's and a Duplicate's copies carry their source's.
// Seam 2: packages/db/test/document-page-count-rls.test.ts.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { buildTower, draft, ok, take, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

/** A well-formed PDF of `pages` blank A4 pages, with its cross-reference table. */
function pdfOfPages(pages: number): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"),
  ];
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

let at: Tower;

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "PGC");
});

const upload = (by: Caller, id: string, fileName: string, contentType: string, body: string | Uint8Array) => uploadDocument(by, id, { fileName, contentType, body });
/** Each Document's page count in item `id`'s file list, by file name, as `by` reads it. */
async function pagesByName(by: Caller, id: string): Promise<Record<string, number | null | "absent">> {
  const list: DocumentList = (await ok(by.get(`/v1/work-items/${id}/documents`), 200)).json();
  return Object.fromEntries(list.documents.map((d) => [d.fileName, d.pageCount === undefined ? "absent" : d.pageCount]));
}

/** A 1×1 PNG: an image has no pages. */
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

describe("a confirmed upload", () => {
  it("keeps a PDF's page count and returns it with the file list; none for an image or a PDF it can't read", async () => {
    const id = await draft(at, at.c1Engineer, "Counted");
    await upload(at.c1Engineer, id, "drawings.pdf", "application/pdf", pdfOfPages(12));
    await upload(at.c1Engineer, id, "letter.pdf", "application/pdf", pdfOfPages(1));
    await upload(at.c1Engineer, id, "broken.pdf", "application/pdf", "%PDF-1.7 not really a PDF");
    await upload(at.c1Engineer, id, "site.png", "image/png", PNG);
    expect(await pagesByName(at.c1Engineer, id)).toMatchObject({
      "drawings.pdf": 12,
      "letter.pdf": 1,
      "broken.pdf": null,
      "site.png": null,
    });
  });
});

describe("copied Documents", () => {
  let closed = "";
  let source: Record<string, number | null | "absent"> = {};
  beforeAll(async () => {
    closed = await draft(at, at.c1Engineer, "Copied with pages");
    await upload(at.c1Engineer, closed, "letter.pdf", "application/pdf", pdfOfPages(3));
    await take(at.c1Engineer, closed, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${closed}/pick-up`));
    await take(at.c1Pm, closed, "submit");
    await ok(at.k1Manager.post(`/v1/work-items/${closed}/pick-up`));
    await take(at.k1Manager, closed, "revise_c", { remarks: "Resubmit" });
    source = await pagesByName(at.c1Engineer, closed);
    expect(source["letter.pdf"]).toBe(3);
  });

  it("K1, who reads the Submitted item, reads its page counts too", async () => {
    expect(await pagesByName(at.k1Manager, closed)).toEqual(source);
  });

  it("carry their source's page count in a Revision", async () => {
    const revision = (await ok(at.c1Engineer.post(`/v1/work-items/${closed}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
    expect(await pagesByName(at.c1Engineer, revision)).toEqual(source);
  });

  it("carry their source's page count in a Duplicate", async () => {
    const copy = (await ok(at.c1Engineer.post(`/v1/work-items/${closed}/duplicate`, { idempotencyKey: randomUUID() }), 201)).json().id;
    expect(await pagesByName(at.c1Engineer, copy)).toEqual(source);
  });
});
