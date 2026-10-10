// Seam 1 for the List's row menu Delete (RP-409, owner decision 2026-10-10;
// workflow-engine.md §5.4 "Discard"; visibility.md scenario RP-409-3): Delete
// discards the viewer's own Draft, every Draft, an original too, while it has no
// Document Number. Only the raiser's Participant may; afterwards nobody sees it,
// the raiser included. An item that was numbered is never discarded.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden } from "./support/harness.ts";
import { buildTower, detail, ok, take, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let draft = "";
let numbered = "";

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "DSC");
  const create = async (title: string) =>
    (
      await ok(
        at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
          type: "MAR",
          title,
          answers: { manufacturer: "ABB", description: "Busbar", trade: at.electrical, location: at.buildingA },
        }),
        201,
      )
    ).json().id as string;
  draft = await create("Spare gaskets");
  numbered = await create("Numbered");
  await attachDatasheet(at.c1Engineer, numbered);
  await take(at.c1Engineer, numbered, "send_for_review");
});

describe("scenario RP-409-3: Delete discards C1's own original Draft", () => {
  it("is offered to the raiser's Participant for a Draft with no number, never once numbered", async () => {
    expect((await detail(at.c1Engineer, draft)).actions.discardDraft).toBe(true);
    expect((await detail(at.c1Pm, draft)).actions.discardDraft).toBe(true);
    expect((await detail(at.c1Engineer, numbered)).actions.discardDraft).toBe(false);
  });

  it("refuses an item that was numbered", async () => {
    const res = await at.c1Engineer.post(`/v1/work-items/${numbered}/discard-draft`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "not_discardable" });
  });

  it("is the plain 404 for anyone who can't see the Draft", async () => {
    await expectHidden(at.k1Manager.post(`/v1/work-items/${draft}/discard-draft`));
  });

  it("discards it: nobody sees it again, C1 included, and it leaves the List", async () => {
    await ok(at.c1Engineer.post(`/v1/work-items/${draft}/discard-draft`), 204);
    for (const who of [at.c1Engineer, at.c1Pm, at.k1Manager]) await expectHidden(who.get(`/v1/work-items/${draft}`));
    const list = (await ok(at.c1Engineer.get(`/v1/projects/${at.projectId}/work-items?page=1`), 200)).json();
    expect(list.items.map((i: { id: string }) => i.id)).not.toContain(draft);
  });
});
