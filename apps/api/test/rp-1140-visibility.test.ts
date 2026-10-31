// Seam 1 for scenario RP-1140-1 (visibility.md V5, V14): K1 moves C1's Submittal inside K1 (Send to
// Manager) and closes it with a Code from there. Through the api, which names no Step by its id, C1
// reads K1's close (its Code and its Company) but never the Step it left, Consultant approval: the item's
// history names an event's Steps to the actor's own Participant only. K1 reads it. Every "hidden" is
// proved with expectHiddenFrom, a reader who may see it reading it first. Seam 2:
// packages/db/test/rp-1140-visibility-rls.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { bilingual, buildTower, ok, projectMember, take, type Tower } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = `RW${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const schema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

let at: Tower;
let k1Engineer: Caller;
let item = "";
const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";
/** The item's Workflow Version's Steps: by key, and by their name as the history gives it. */
const steps = new Map<string, string>();
const stepByName = new Map<string, string>();
/** A Step's name as a key, whichever order its languages come in. */
const nameKey = (name: unknown) => {
  const { en, ar } = name as { en: string; ar: string };
  return `${en}|${ar}`;
};

type HistoryEvent = WorkItemHistory["events"][number];
const history = async (by: Caller): Promise<HistoryEvent[]> => (await readById<WorkItemHistory>(`/v1/work-items/${item}/history`)(by)).flatMap((h) => h.events);
/** The Steps the history names to `by`, as the ids of the Steps they name. */
const historySteps = async (by: Caller) =>
  (await history(by)).flatMap((e) => [e.fromStep, e.toStep].flatMap((s) => (s === null ? [] : [{ id: stepByName.get(nameKey(s)) ?? nameKey(s) }])));

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, bilingual("Later Step (RP-1140)"), schema);
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RLT");
  k1Engineer = await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  for (const [by, name] of [[at.c1Engineer, "C1 engineer"], [at.c1Pm, "C1 PM"], [k1Engineer, "K1 engineer"], [at.k1Manager, "K1 manager"]] as const) names.set(by, name);

  item = (await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: TYPE, title: "Fixtures", answers: { model: "CT-1", trade: at.electrical, location: at.buildingA } }), 201)).json().id as string;
  await take(at.c1Engineer, item, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${item}/pick-up`));
  await take(at.c1Pm, item, "submit");
  // K1's engineer sends it to K1's manager: a move inside K1 (V5), to Consultant approval.
  await ok(k1Engineer.post(`/v1/work-items/${item}/pick-up`));
  await take(k1Engineer, item, "send_to_manager");
  await ok(at.k1Manager.post(`/v1/work-items/${item}/pick-up`));

  const { rows } = await sql<{ key: string; id: string; name: unknown }>`
    select s.key, s.id, s.name from work_item w join workflow_step s on s.workflow_version_id = w.workflow_version_id where w.id = ${item}::uuid`.execute(migrator);
  for (const r of rows) {
    steps.set(r.key, r.id);
    stepByName.set(nameKey(r.name), r.id);
  }
});

describe("scenario RP-1140-1: K1 moves C1's Submittal inside K1 and closes it from there", () => {
  const c1 = () => [at.c1Engineer, at.c1Pm];
  const k1 = () => [k1Engineer, at.k1Manager];

  it("at Consultant approval, the history names K1's Step to K1 only", async () => {
    await expectHiddenFrom({ read: historySteps, target: steps.get("consultant_approval")!, seenBy: k1(), hiddenFrom: c1(), name: named, label: "K1's Consultant approval" });
  });

  it("closed from Consultant approval: C1 reads K1's close and its Code C, never the Step it left; K1 does", async () => {
    await take(at.k1Manager, item, "revise_c");
    await expectHiddenFrom({ read: historySteps, target: steps.get("consultant_approval")!, seenBy: k1(), hiddenFrom: c1(), name: named, label: "the Step K1's close left" });
    for (const by of c1()) {
      const close = (await history(by)).filter((e) => e.outcome === "C");
      expect(close, named(by)).toEqual([expect.objectContaining({ audience: "shared", fromStep: null })]);
    }
    for (const by of k1()) {
      const close = (await history(by)).filter((e) => e.outcome === "C");
      expect(close.map((e) => (e.fromStep === null ? null : stepByName.get(nameKey(e.fromStep)))), named(by)).toEqual([steps.get("consultant_approval")]);
    }
  });
});
