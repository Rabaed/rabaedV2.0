import type { DocumentSummary, FormSchema, WorkItemHistory } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { beforePhotos, snagResponse } from "./snag-response";

type Event = WorkItemHistory["events"][number];
const b = (en: string) => ({ en, ar: en });
let seq = 0;
const event = (over: Partial<Event>): Event => ({
  seq: ++seq,
  type: "transition",
  at: "2026-10-19T08:00:00.000Z",
  audience: "shared",
  by: { companyName: b("TMC"), memberName: null },
  transition: b("Move"),
  fromStep: null,
  toStep: null,
  reason: null,
  remarks: null,
  documentNumber: null,
  outcome: null,
  internalNote: null,
  recommendedCode: null,
  changes: null,
  handover: null,
  answers: null,
  ...over,
});
const doc = (id: string, over: Partial<DocumentSummary> = {}): DocumentSummary =>
  ({ id, fileName: `${id}.jpg`, contentType: "image/jpeg", fieldKey: "photos", itemKey: null, annotatedFromId: null, ...over }) as DocumentSummary;

const raise = event({ transition: b("Raise") });
const resolve = (done: string, files: string[] = []) => event({ transition: b("Resolve"), answers: { resolution_note: done }, files });

describe("snagResponse", () => {
  it("is what the latest Resolve says was done, and the after photos it took", () => {
    const docs = [doc("a1", { fieldKey: "after_photos", reply: { taken: true } }), doc("b1")];
    expect(snagResponse([raise, resolve("Bonded", ["a1"])], docs, { closed: false })).toEqual({
      resolution: "Bonded",
      by: b("TMC"),
      after: [docs[0]],
    });
  });

  it("is none before any Resolve", () => {
    expect(snagResponse([raise], [], { closed: false })).toBeNull();
  });

  it("is none once the raiser returned it to Open: that round stays in the history", () => {
    const back = event({ transition: b("Return to Open"), answers: { reason: "Not earthed" } });
    expect(snagResponse([raise, resolve("Bonded"), back], [], { closed: false })).toBeNull();
  });

  it("is the round after a return, with only that round's photos, and stays once closed", () => {
    const docs = [doc("a1", { fieldKey: "after_photos", reply: { taken: true } }), doc("a2", { fieldKey: "after_photos", reply: { taken: true } })];
    const back = event({ transition: b("Return to Open"), answers: { reason: "Not earthed" } });
    const close = event({ transition: b("Close"), outcome: null });
    expect(snagResponse([raise, resolve("Bonded", ["a1"]), back, resolve("Earthed too", ["a2"]), close], docs, { closed: true })).toEqual({
      resolution: "Earthed too",
      by: b("TMC"),
      after: [docs[1]],
    });
  });

  it("leaves out an internal event's answers", () => {
    expect(snagResponse([raise, event({ type: "internal_answers", audience: "internal", answers: { resolution_note: "draft" } })], [], { closed: false })).toBeNull();
  });
});

describe("beforePhotos", () => {
  const schema: FormSchema = {
    sections: [
      {
        key: "details",
        title: b("Details"),
        fields: [
          { key: "description", type: "textarea", label: b("Description") },
          { key: "photos", type: "photos", label: b("Photos") },
        ],
      },
    ],
  } as FormSchema;

  it("are the Form's photos fields' images, never a reply file, an annotated copy or another field's file", () => {
    const docs = [
      doc("b1"),
      doc("a1", { fieldKey: "after_photos", reply: { taken: true } }),
      doc("c1", { annotatedFromId: "b1" }),
      doc("f1", { fieldKey: null }),
      doc("b2"),
    ];
    expect(beforePhotos(schema, docs).map((d) => d.id)).toEqual(["b1", "b2"]);
  });
});
