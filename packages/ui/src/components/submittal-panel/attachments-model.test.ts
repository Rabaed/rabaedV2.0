import type { DocumentSummary } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import {
  attachmentKind,
  attachmentLayerToClose,
  attachmentPageAt,
  attachmentZoom,
  submittalPanelAttachmentDocuments,
} from "./attachments-model.ts";

describe("what a file previews as (README §7)", () => {
  it("renders a PDF's pages, shows a photo, and offers nothing else a preview", () => {
    expect(attachmentKind("application/pdf")).toBe("pdf");
    expect(attachmentKind("image/jpeg")).toBe("image");
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("image/webp")).toBe("image");
    // A browser can't draw these: the card offers Download only.
    expect(attachmentKind("image/heic")).toBe("other");
    expect(attachmentKind("image/vnd.dwg")).toBe("other");
    expect(attachmentKind("application/zip")).toBe("other");
  });
});

describe("zoom", () => {
  it("steps by the given amount: 10% inline, 25% in Open large", () => {
    expect(attachmentZoom(100, 10)).toBe(110);
    expect(attachmentZoom(100, -25)).toBe(75);
  });

  it("stays between 50% and 300%", () => {
    expect(attachmentZoom(50, -10)).toBe(50);
    expect(attachmentZoom(60, -25)).toBe(50);
    expect(attachmentZoom(300, 10)).toBe(300);
    expect(attachmentZoom(290, 25)).toBe(300);
  });
});

describe("Esc closes the innermost layer first (README §1)", () => {
  it("closes Open large before the preview, and leaves the panel to close when neither is open", () => {
    expect(attachmentLayerToClose({ large: "a", preview: "b" })).toBe("large");
    expect(attachmentLayerToClose({ large: "a", preview: null })).toBe("large");
    expect(attachmentLayerToClose({ large: null, preview: "b" })).toBe("preview");
    expect(attachmentLayerToClose({ large: null, preview: null })).toBeNull();
  });
});

describe("the page shown", () => {
  // Pages whose tops sit at 0, 600 and 1200 in the scroll area.
  const tops = [0, 600, 1200];

  it("is the last page whose top has reached the top of the scroll area", () => {
    expect(attachmentPageAt(0, tops)).toBe(1);
    expect(attachmentPageAt(599, tops)).toBe(1);
    expect(attachmentPageAt(600, tops)).toBe(2);
    expect(attachmentPageAt(5000, tops)).toBe(3);
  });

  it("is page 1 of a file with no pages laid out yet", () => {
    expect(attachmentPageAt(100, [])).toBe(1);
  });
});

describe("the files the Attachments section lists", () => {
  const document = (id: string, change: Partial<DocumentSummary> = {}): DocumentSummary => ({
    id,
    fileName: `${id}.pdf`,
    sizeBytes: 1000,
    contentType: "application/pdf",
    uploadedAt: "2026-10-01T08:00:00.000Z",
    uploadedBy: { companyName: Object.fromEntries([["en", "TMC"], ["ar", "TMC"]]) as { en: string; ar: string }, memberName: null },
    frozen: true,
    fieldKey: null,
    itemKey: null,
    annotatedFromId: null,
    takenAt: null,
    takenWhere: null,
    ...change,
  });

  it("are every Document the viewer reads, in order, the Form's fields' files too", () => {
    const documents = [document("system"), document("datasheet", { fieldKey: "datasheet" }), document("evidence", { fieldKey: "checklist", itemKey: "c1" })];
    expect(submittalPanelAttachmentDocuments(documents).map((d) => d.id)).toEqual(["system", "datasheet", "evidence"]);
  });

  it("leave out a photo's annotated copy, which is shown beside its original, never as a file of its own", () => {
    const documents = [document("photo", { contentType: "image/jpeg" }), document("copy", { contentType: "image/jpeg", annotatedFromId: "photo" })];
    expect(submittalPanelAttachmentDocuments(documents).map((d) => d.id)).toEqual(["photo"]);
  });
});
