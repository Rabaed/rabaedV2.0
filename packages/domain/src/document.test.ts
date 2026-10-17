import { describe, expect, it } from "vitest";
import { startDocumentUploadRequest, withAnnotatedCopies, type DocumentSummary } from "./document.ts";

const doc = (id: string, annotatedFromId: string | null = null): DocumentSummary => ({
  id,
  fileName: `${id}.jpg`,
  sizeBytes: 1,
  contentType: "image/jpeg",
  uploadedAt: "2026-10-17T10:00:00.000Z",
  uploadedBy: { companyName: { en: "C1", ar: "C1" }, memberName: null },
  frozen: false,
  fieldKey: "photos",
  itemKey: null,
  annotatedFromId,
  takenAt: null,
  takenWhere: null,
});

const id = (n: number) => `0199a3b0-0000-7000-8000-00000000000${n}`;

describe("withAnnotatedCopies", () => {
  it("lists each original once, in order, with its annotated copy beside it", () => {
    const [a, b, aCopy] = [doc(id(1)), doc(id(2)), doc(id(3), id(1))];
    expect(withAnnotatedCopies([a, aCopy, b])).toEqual([
      { original: a, annotated: aCopy },
      { original: b, annotated: null },
    ]);
  });

  it("leaves out a copy whose original isn't listed", () => {
    expect(withAnnotatedCopies([doc(id(3), id(1))])).toEqual([]);
  });
});

describe("an annotated copy's upload", () => {
  const file = { fileName: "facade-annotated.jpg", sizeBytes: 10, contentType: "image/jpeg" };

  it("names its original", () => {
    expect(startDocumentUploadRequest.parse({ ...file, annotatedFromId: id(1) })).toMatchObject({ annotatedFromId: id(1) });
  });

  it("names no field or checklist item: it goes where its original is", () => {
    expect(startDocumentUploadRequest.safeParse({ ...file, annotatedFromId: id(1), fieldKey: "photos" }).success).toBe(false);
  });
});
