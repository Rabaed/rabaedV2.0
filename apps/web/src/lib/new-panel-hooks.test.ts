import type { NewItemRoutePreview } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { draftRoute, pickedDocuments, saveThenUpload, snagListLanding, startAnswers } from "./new-panel-hooks.ts";
import { givenLocation } from "./submittal-panel-url.ts";

// RP-1222: the create panel's hooks for the New Snag's short form, apart from React. The gap
// table's rows are named on each test.

const choices = {
  trades: [{ id: "trade-el", label: "Electrical (EL)", code: "EL" }],
  locations: [
    { id: "loc-t2", label: "Tower 2 (T2)" },
    { id: "loc-l3", label: "— Level 3 (L3)" },
  ],
  scopes: [],
};

describe("who sees the Draft, with the route preview off (row 12; V1)", () => {
  const route = (draftsVisibleTo: "author" | "company") => ({ definition: { steps: [] }, stages: [], draftsVisibleTo }) as unknown as NewItemRoutePreview;

  it("follows the Draft Step's setting from the same read: the author only, never the whole Company", () => {
    expect(draftRoute({ routePreview: false, read: route("author") })).toEqual({ preview: null, draftsVisibleTo: "author" });
    expect(draftRoute({ routePreview: false, read: route("company") })).toEqual({ preview: null, draftsVisibleTo: "company" });
  });

  it("shows the route where it is previewed, as the Submittals do", () => {
    const read = route("author");
    expect(draftRoute({ routePreview: true, read })).toEqual({ preview: read, draftsVisibleTo: "author" });
  });

  it("knows nobody until the read has answered", () => {
    expect(draftRoute({ routePreview: false, read: null })).toEqual({ preview: null, draftsVisibleTo: null });
  });
});

describe("photos picked before Save Draft (row 25)", () => {
  const photo = (name: string) => new File(["x"], name, { type: "image/jpeg" });
  const picked = [
    { id: "p1", fieldKey: "photos", file: photo("a.jpg") },
    { id: "p2", fieldKey: "photos", file: photo("b.jpg") },
    { id: "p3", fieldKey: "photos", file: photo("c.jpg") },
  ];
  const uploads = (fail?: string) => {
    const calls: [string, string, string | undefined][] = [];
    const upload = async (workItemId: string, file: File, { fieldKey }: { fieldKey?: string }) => {
      calls.push([workItemId, file.name, fieldKey]);
      return file.name === fail ? { ok: false as const, refused: "unavailable" } : { ok: true as const };
    };
    return { calls, upload };
  };

  it("uploads each photo, in order, to the new Draft alone, then the Snag is saved", async () => {
    const { calls, upload } = uploads();
    const result = await saveThenUpload({ picked, create: async () => ({ ok: true, id: "draft-1" }), upload });
    expect(result).toEqual({ kind: "saved", id: "draft-1" });
    expect(calls).toEqual([
      ["draft-1", "a.jpg", "photos"],
      ["draft-1", "b.jpg", "photos"],
      ["draft-1", "c.jpg", "photos"],
    ]);
  });

  it("stops at a failed upload: the Draft exists, the photos not uploaded stay picked, and it says why", async () => {
    const { calls, upload } = uploads("b.jpg");
    const result = await saveThenUpload({ picked, create: async () => ({ ok: true, id: "draft-1" }), upload });
    expect(result).toEqual({ kind: "photosFailed", id: "draft-1", picked: [picked[1], picked[2]], refused: "unavailable" });
    // Nothing goes anywhere but the new Draft, and nothing after the failure is tried.
    expect(calls).toEqual([
      ["draft-1", "a.jpg", "photos"],
      ["draft-1", "b.jpg", "photos"],
    ]);
  });

  it("shows each picked photo in its own field, as the viewer's own Company's and not yet frozen", () => {
    const company = { en: "Tamimi Consultants", ar: "التميمي للاستشارات" };
    const shown = pickedDocuments([picked[0]!], { at: "2026-11-03T10:42:00.000Z", company });
    expect(shown).toEqual([
      expect.objectContaining({ id: "p1", fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 1, fieldKey: "photos", itemKey: null, frozen: false, annotatedFromId: null, uploadedBy: { companyName: company, memberName: null } }),
    ]);
  });

  it("keeps every photo picked when the create is refused, and uploads none", async () => {
    const { calls, upload } = uploads();
    for (const error of ["invalid_answers", "form_version_not_latest"]) {
      const result = await saveThenUpload({ picked, create: async () => ({ ok: false, error }), upload });
      expect(result).toEqual({ kind: "refused", error, picked });
    }
    expect(calls).toEqual([]);
  });
});

describe("the New Snag's place in the URL (rows 5, 23)", () => {
  const id = "0b9e3c1a-2f4d-4e6a-9b1c-3d5e7f9a1b2c";

  it("reads the Location given on opening, only an id a Location can have", () => {
    expect(givenLocation(new URLSearchParams(`new=SNG&location=${id}`))).toBe(id);
    expect(givenLocation(new URLSearchParams("new=SNG&location=Tower%202"))).toBeNull();
    expect(givenLocation(new URLSearchParams("new=SNG"))).toBeNull();
  });

  it("lands a direct link on the Snag List with the panel at Normal", () => {
    expect(snagListLanding("p1", "SNG")).toBe("/projects/p1/snag-list?new=SNG&size=normal");
    expect(snagListLanding("p1", undefined)).toBe("/projects/p1/snag-list?new=1&size=normal");
    expect(snagListLanding("p1", "not a code")).toBe("/projects/p1/snag-list?new=1&size=normal");
  });

  it("keeps the Location a direct link gives (a Floor plan's way in), only an id a Location can have", () => {
    expect(snagListLanding("p1", "SNG", id)).toBe(`/projects/p1/snag-list?new=SNG&size=normal&location=${id}`);
    expect(snagListLanding("p1", "SNG", "Tower 2")).toBe("/projects/p1/snag-list?new=SNG&size=normal");
  });
});

describe("the Location the panel opens with (row 23, the Floor plan's way in)", () => {
  it("fills a Location the Member's Visibility covers, beside the Form's first Trade", () => {
    expect(startAnswers({ tradeId: "trade-el", given: { location: "loc-l3" }, choices })).toEqual({ trade: "trade-el", location: "loc-l3" });
  });

  it("leaves the Location blank, saying nothing, when the Member's Visibility doesn't cover it", () => {
    expect(startAnswers({ tradeId: "trade-el", given: { location: "loc-not-covered" }, choices })).toEqual({ trade: "trade-el" });
  });

  it("starts with the Trade alone when no Location is given, as the Submittals do", () => {
    expect(startAnswers({ tradeId: "trade-el", given: undefined, choices })).toEqual({ trade: "trade-el" });
    expect(startAnswers({ tradeId: undefined, given: undefined, choices })).toEqual({});
  });
});
