// Seam 1 for the New Snag's short form (RP-1222 gap rows 12 and 25; visibility.md V1, V3;
// scenario RP-1222-1). The short form creates a Snag Draft, then uploads the photos picked before
// Save Draft to it straight after, then clears for the next Snag. The Draft and its photos stay
// inside the raising Participant, K1: its manager and, as the Draft Step leaves "Drafts visible
// to" at the whole Company, its engineer. C1's Members and a Member off the Project read neither.
import { expectHiddenFrom } from "@rabaed/db/test-support";
import { newItemRoutePreview, type DocumentList, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { buildTower, ok, projectMember, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let k1Engineer: Caller;
let outsider: Caller; // A C1 Member off the Project.
let snagId = "";
const photoIds: string[] = [];

type Viewer = { by: () => Caller; name: string };
const as = (name: string, by: () => Caller): Viewer => ({ by, name });

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SSF");
  k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  outsider = (await api.member(c1.caller)).caller;
  // The short form's Save Draft: the create, then each photo picked before it, uploaded to the new Draft.
  snagId = (
    await ok(
      at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, {
        type: "SNG",
        title: "Cable tray not bonded",
        answers: { trade: at.electrical, location: at.buildingA, description: "Level 3 riser, east side" },
      }),
      201,
    )
  ).json().id as string;
  for (const name of ["east.jpg", "close-up.jpg"]) {
    photoIds.push(await uploadDocument(at.k1Manager, snagId, { fieldKey: "photos", fileName: name, contentType: "image/jpeg", body: jpegWithExif() }));
  }
});

/** The Snag List rows `viewer` reads; none for a Member off the Project, whose read is the 404 that names nothing. */
const listed = async (viewer: Viewer) => {
  const res = await viewer.by().get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`);
  if (res.statusCode === 200) return (res.json() as WorkItemList).items;
  await expectHidden(res, viewer.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
  return [];
};
/** The Draft by its id: [it] when read, [] when it is the 404 that names nothing. */
const byId = async (viewer: Viewer) => {
  const res = await viewer.by().get(`/v1/work-items/${snagId}`);
  if (res.statusCode === 200) return [{ id: snagId }];
  await expectHidden(res, viewer.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
  return [];
};
/** The Draft's Documents `viewer` reads: its photos, or none behind the 404 that names nothing. */
const photos = async (viewer: Viewer) => {
  const res = await viewer.by().get(`/v1/work-items/${snagId}/documents`);
  if (res.statusCode === 200) return (res.json() as DocumentList).documents;
  await expectHidden(res, viewer.name); // not hidden-from: the 404's body, inside the read expectHiddenFrom proves
  return [];
};

const k1Side = [as("K1's manager, who raised it", () => at.k1Manager), as("K1's engineer", () => k1Engineer)];
const hidden = [as("C1's engineer", () => at.c1Engineer), as("C1's PM", () => at.c1Pm), as("a C1 Member off the Project", () => outsider)];

describe("scenario RP-1222-1: a Snag saved in the short form, with its photos, stays inside K1", () => {
  it("is in K1's Snag List and nobody else's", async () => {
    await expectHiddenFrom({ read: listed, target: snagId, seenBy: k1Side, hiddenFrom: hidden, name: (v: Viewer) => v.name, label: "the Snag List" });
  });

  it("is read by id inside K1, and is the 404 that names nothing to anyone else", async () => {
    await expectHiddenFrom({ read: byId, target: snagId, seenBy: k1Side, hiddenFrom: hidden, name: (v: Viewer) => v.name, label: "the Draft by id" });
  });

  it("holds the photos uploaded straight after the create, which nobody outside K1 reads through its Documents", async () => {
    for (const photo of photoIds) {
      await expectHiddenFrom({ read: photos, target: photo, seenBy: k1Side, hiddenFrom: hidden, name: (v: Viewer) => v.name, label: "the Draft's photos" });
    }
    expect((await photos(k1Side[0]!)).filter((d) => d.fieldKey === "photos").map((d) => d.id).sort()).toEqual([...photoIds].sort());
  });

  it("is a Draft the whole of K1 sees, as the route preview the short form reads says", async () => {
    const preview = newItemRoutePreview.parse((await ok(at.k1Manager.get(`/v1/projects/${at.projectId}/work-item-types/SNG/route-preview`), 200)).json());
    expect(preview.draftsVisibleTo).toBe("company");
  });
});
