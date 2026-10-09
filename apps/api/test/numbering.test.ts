// Seam 1 for the Numbering page (RP-313, spec RP-311; workflow-engine.md Â§8
// "Settled 2026-10-05 (Document numbering)"; visibility.md, Document Numbers,
// scenarios 53 and 54): the Project Admin saves the Project's Numbering Pattern
// and per-Type overrides, every Project Member reads them, anyone else gets a
// 404 that names nothing; and items first leaving Draft are numbered under the
// pattern in effect then.
import { randomUUID } from "node:crypto";
import type { NumberingSettings, SaveNumberingPatternRequest, SaveNumberingRequest } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller, type TestApi } from "./support/harness.ts";
import { all, bilingual, buildTower, ok, projectMember, type Company, type Tower } from "./support/tower.ts";

let api: TestApi;
let c1: Company;
let c2: Company;
let k1: Company;
let outsider: Company;

beforeAll(async () => {
  api = await createTestApi({ files: true });
  c1 = await api.projectCreator();
  c2 = await api.authorizedPerson();
  k1 = await api.authorizedPerson();
  outsider = await api.projectCreator();
});

afterAll(async () => {
  await api?.close();
});

const project = { kind: "project" } as const;
const type = { kind: "type" } as const;
const trade = { kind: "trade" } as const;
const participantCode = { kind: "participant" } as const;

/** Tower with a second Contractor, C2, and its engineer; a Zone Z1 holding Building B1. */
async function tower(code: string) {
  const t = await buildTower(api, { c1, k1 }, code);
  const c2ParticipantId = await api.addParticipant(c1.caller, t.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  const c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  // C2's internal review needs someone to hold it.
  await projectMember(api, c2, c2ParticipantId, ["project_manager"]);
  const location = async (locationCode: string, parentId: string | null) =>
    (await c1.caller.post(`/v1/projects/${t.projectId}/locations`, { code: locationCode, name: bilingual(locationCode), parentId })).json()
      .id as string;
  const zone = await location("Z1", null);
  const building = await location("B1", zone);
  return { ...t, c2Engineer, zone, building };
}

const settingsOf = (by: Caller, at: Tower) => by.get(`/v1/projects/${at.projectId}/numbering`);
const save = (by: Caller, at: Tower, body: Partial<SaveNumberingRequest> & Pick<SaveNumberingRequest, "pattern">) =>
  by.request("PUT", `/v1/projects/${at.projectId}/numbering`, { workItemTypeId: null, sharedCounterAccepted: false, ...body });
const pattern = (p: { segments: object[]; countedBy: number[]; separator?: string; seqDigits?: number }) =>
  ({ separator: "-", seqDigits: 4, ...p }) as SaveNumberingPatternRequest["pattern"];

/** `engineer` raises a MAR (at `location`, Building A by default) and sends it for review; returns its Document Number. */
async function numbered(at: Tower, engineer: Caller, location = at.buildingA): Promise<string> {
  const res = await engineer.post(`/v1/projects/${at.projectId}/work-items`, {
    type: "MAR",
    title: "Cable trays",
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: at.electrical, location },
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().id as string;
  await attachDatasheet(engineer, id);
  await ok(engineer.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", confirmed: true, idempotencyKey: randomUUID() }));
  return (await engineer.get(`/v1/work-items/${id}`)).json().documentNumber as string;
}

describe("the Numbering page's settings", () => {
  it("start as the Rabaed Default, with the MAR following it and an example from the Project", async () => {
    const t = await tower("NDF");
    const s = (await ok(settingsOf(c1.caller, t), 200)).json() as NumberingSettings;
    expect(s.canEdit).toBe(true);
    expect(s.project).toBeNull();
    expect(s.types.find((x) => x.code === "MAR")).toMatchObject({ override: null, name: { en: expect.any(String) } });
    expect(s.example).toEqual({ projectCode: "NDF", tradeCode: "EL", participant: { code: null, ordinal: 1 }, locationPath: ["BA"] });
  });

  it("give the example the reader's own Participant Code once it is set", async () => {
    const t = await tower("NPC");
    await ok(c1.caller.request("PUT", `/v1/participants/${t.c1ParticipantId}/code`, { code: "CCM" }));
    const s = (await ok(settingsOf(t.c1Engineer, t), 200)).json() as NumberingSettings;
    expect(s.example.participant).toEqual({ code: "CCM", ordinal: 1 });
    expect(((await ok(settingsOf(t.c2Engineer, t), 200)).json() as NumberingSettings).example.participant).toEqual({
      code: null,
      ordinal: 3,
    });
  });

  it("are saved by the Project Admin, Project pattern and per-Type override, and read by every other Project Member", async () => {
    const t = await tower("NSV");
    const mar = ((await settingsOf(c1.caller, t)).json() as NumberingSettings).types.find((x) => x.code === "MAR")!.id;
    const projectPattern = pattern({ segments: [project, type, trade, participantCode], countedBy: [0, 1, 2, 3], separator: "/" });
    const marPattern = pattern({ segments: [type, participantCode], countedBy: [0, 1], seqDigits: 5 });
    await ok(save(c1.caller, t, { pattern: projectPattern }));
    await ok(save(c1.caller, t, { workItemTypeId: mar, pattern: marPattern }));

    for (const [who, canEdit] of [
      [c1.caller, true],
      [t.c1Engineer, false],
      [t.c2Engineer, false],
      [t.k1Manager, false],
    ] as const) {
      const s = (await ok(settingsOf(who, t), 200)).json() as NumberingSettings;
      expect(s.canEdit).toBe(canEdit);
      expect(s.project).toMatchObject({ pattern: projectPattern, sharedCounterAcceptedAt: null });
      expect(s.types.find((x) => x.id === mar)!.override).toMatchObject({ pattern: marPattern });
    }
  });

  it("answer anyone outside the Project, and any change by someone not its Project Admin, with a 404 naming nothing", async () => {
    const t = await tower("NHD");
    await ok(save(c1.caller, t, { pattern: pattern({ segments: [project, participantCode], countedBy: [0, 1] }) }));
    const theirs = await api.createProject(outsider.caller, { code: "OTH" });
    await expectHidden(settingsOf(outsider.caller, t), "outsider");
    await expectHidden(settingsOf(k1.caller, t), "K1's Authorized Person, not a Project Member");
    await expectHidden(outsider.caller.get(`/v1/projects/${randomUUID()}/numbering`), "made-up id");
    await expectHidden(outsider.caller.get(`/v1/projects/not-a-uuid/numbering`), "malformed id");
    await expectHidden(c1.caller.get(`/v1/projects/${theirs.id}/numbering`), "another Project");

    const change = { pattern: pattern({ segments: [type, participantCode], countedBy: [0, 1] }) };
    for (const [label, who] of [
      ["C1 engineer", t.c1Engineer],
      ["C2 engineer", t.c2Engineer],
      ["C2 Authorized Person", c2.caller],
      ["K1 manager", t.k1Manager],
      ["outsider", outsider.caller],
    ] as const) {
      await expectHidden(save(who, t, change), label);
    }
    await expectHidden(c1.caller.request("PUT", `/v1/projects/${randomUUID()}/numbering`, { workItemTypeId: null, ...change }));
    expect(((await settingsOf(c1.caller, t)).json() as NumberingSettings).project!.pattern.segments).toEqual([project, participantCode]);
  });

  it("are refused for more than 6 segments, an unknown segment, or digits outside 3â€“7", async () => {
    const t = await tower("NRF");
    for (const p of [
      pattern({ segments: [project, type, trade, participantCode, project, type, trade], countedBy: [3] }),
      pattern({ segments: [project, { kind: "building" }, participantCode], countedBy: [2] }),
      pattern({ segments: [project, participantCode], countedBy: [1], seqDigits: 2 }),
      pattern({ segments: [project, participantCode], countedBy: [1], seqDigits: 8 }),
      pattern({ segments: [project, participantCode], countedBy: [4] }),
    ]) {
      const res = await save(c1.caller, t, { pattern: p });
      expect(res.statusCode, JSON.stringify(p)).toBe(400);
    }
    const unknownType = await save(c1.caller, t, { workItemTypeId: randomUUID(), pattern: pattern({ segments: [project, participantCode], countedBy: [0, 1] }) });
    expect([unknownType.statusCode, unknownType.json().error]).toEqual([422, "type_not_found"]);
    expect(((await settingsOf(c1.caller, t)).json() as NumberingSettings).project).toBeNull();
  });
});

describe("numbers issued under the pattern in effect", () => {
  it("print the Trade, the Location at a level (or the item's own above it), '/', and 5 digits", async () => {
    const t = await tower("NTL");
    await ok(
      save(c1.caller, t, {
        pattern: pattern({
          segments: [project, trade, { kind: "location", level: 2 }, participantCode],
          countedBy: [0, 1, 2, 3],
          separator: "/",
          seqDigits: 5,
        }),
      }),
    );
    expect(await numbered(t, t.c1Engineer, t.building)).toBe("NTL/EL/B1/01/00001");
    expect(await numbered(t, t.c1Engineer, t.building)).toBe("NTL/EL/B1/01/00002");
    // At the Zone, above the Building level: the item's own Location, on its own count.
    expect(await numbered(t, t.c1Engineer, t.zone)).toBe("NTL/EL/Z1/01/00001");
  });

  it("apply a change only to items numbered after it; issued numbers never change", async () => {
    const t = await tower("NCH");
    const before = await numbered(t, t.c1Engineer);
    expect(before).toBe("NCH-MAR-01-0001");
    const res = await t.c1Engineer.post(`/v1/projects/${t.projectId}/work-items`, {
      type: "MAR",
      title: "Still a Draft",
      answers: { manufacturer: "ACME Cables", description: "Galvanised", trade: t.electrical, location: t.buildingA },
    });
    const draftId = res.json().id as string;

    await ok(save(c1.caller, t, { pattern: pattern({ segments: [project, { kind: "text", text: "SUB" }, participantCode], countedBy: [0, 2] }) }));
    expect(await numbered(t, t.c1Engineer)).toBe("NCH-SUB-01-0001");
    const items = (await t.c1Engineer.get(`/v1/projects/${t.projectId}/work-items`)).json().items as { documentNumber: string | null; id: string }[];
    expect(items.map((i) => i.documentNumber).sort()).toEqual([null, "NCH-MAR-01-0001", "NCH-SUB-01-0001"].sort());
    expect(items.find((i) => i.id === draftId)!.documentNumber).toBeNull();
  });

  it("skip a number the Project already used, so a pattern change never refuses a Transition (RP-311 review)", async () => {
    const t = await tower("NDP");
    expect(await numbered(t, t.c1Engineer)).toBe("NDP-MAR-01-0001");
    // The same segments, no longer counted by the Participant: a new counter, whose 1 is taken.
    const shared = pattern({ segments: [project, type, participantCode], countedBy: [0, 1] });
    await ok(save(c1.caller, t, { pattern: shared, sharedCounterAccepted: true }));
    expect(await numbered(t, t.c1Engineer)).toBe("NDP-MAR-01-0002");
    expect(await numbered(t, t.c2Engineer)).toBe("NDP-MAR-03-0003");
    expect(await numbered(t, t.c1Engineer)).toBe("NDP-MAR-01-0004");
  });

  it("use a Work Item Type's override over the Project's pattern", async () => {
    const t = await tower("NOV");
    const mar = ((await settingsOf(c1.caller, t)).json() as NumberingSettings).types.find((x) => x.code === "MAR")!.id;
    await ok(save(c1.caller, t, { pattern: pattern({ segments: [project, participantCode], countedBy: [0, 1] }) }));
    await ok(save(c1.caller, t, { workItemTypeId: mar, pattern: pattern({ segments: [type, project, participantCode], countedBy: [0, 1, 2] }) }));
    expect(await numbered(t, t.c1Engineer)).toBe("MAR-NOV-01-0001");
  });
});

describe("visibility.md, Document Numbers", () => {
  it("53: under the Rabaed Default, C1's MAR numbers run with no gaps from C2's", async () => {
    const t = await tower("NFT");
    const mine = [await numbered(t, t.c1Engineer), await numbered(t, t.c2Engineer), await numbered(t, t.c1Engineer)];
    await numbered(t, t.c2Engineer);
    mine.push(await numbered(t, t.c1Engineer));
    expect(mine).toEqual(["NFT-MAR-01-0001", "NFT-MAR-03-0001", "NFT-MAR-01-0002", "NFT-MAR-01-0003"]);
  });

  it("54: a pattern leaving out the Participant Code is refused until the warning is accepted; then C1 and C2 share one count", async () => {
    const t = await tower("NFF");
    const shared = pattern({ segments: [project, type, participantCode], countedBy: [0, 1] });
    const refused = await save(c1.caller, t, { pattern: shared });
    expect([refused.statusCode, refused.json()]).toEqual([422, { error: "shared_counter_not_accepted" }]);
    expect(((await settingsOf(c1.caller, t)).json() as NumberingSettings).project).toBeNull();

    await ok(save(c1.caller, t, { pattern: shared, sharedCounterAccepted: true }));
    const s = (await settingsOf(t.c2Engineer, t)).json() as NumberingSettings;
    expect(s.project!.sharedCounterAcceptedAt).toEqual(expect.any(String));
    expect([await numbered(t, t.c1Engineer), await numbered(t, t.c2Engineer), await numbered(t, t.c1Engineer)]).toEqual([
      "NFF-MAR-01-0001",
      "NFF-MAR-03-0002",
      "NFF-MAR-01-0003",
    ]);
  });

  it("RP-412-1: every Project Member reads the versions of the patterns, the saver's Company by name, the saver only within it", async () => {
    const t = await tower("NVR");
    const mar = ((await settingsOf(c1.caller, t)).json() as NumberingSettings).types.find((x) => x.code === "MAR")!.id;
    const first = pattern({ segments: [project, type, participantCode], countedBy: [0, 1, 2] });
    const second = pattern({ segments: [project, trade, type, participantCode], countedBy: [0, 1, 2, 3], separator: "/" });
    const custom = pattern({ segments: [type, participantCode], countedBy: [0, 1], seqDigits: 5 });
    await ok(save(c1.caller, t, { pattern: first }));
    await ok(save(c1.caller, t, { pattern: second }));
    await ok(save(c1.caller, t, { workItemTypeId: mar, pattern: custom }));
    await ok(save(c1.caller, t, { workItemTypeId: mar, pattern: null }));

    const c1Company = { en: "Test Constructions", ar: expect.any(String) };
    for (const [who, own] of [
      [c1.caller, true],
      [t.c1Engineer, true],
      [t.c2Engineer, false],
      [t.k1Manager, false],
    ] as const) {
      const res = await ok(settingsOf(who, t), 200);
      const s = res.json() as NumberingSettings;
      const savedBy = { rabaed: false, company: c1Company, member: own ? { en: "Test Person", ar: expect.any(String) } : null };
      expect(s.versions.filter((v) => v.workItemTypeId === null)).toEqual([
        { workItemTypeId: null, version: 2, effectiveFrom: expect.any(String), pattern: second, savedBy },
        { workItemTypeId: null, version: 1, effectiveFrom: expect.any(String), pattern: first, savedBy },
      ]);
      expect(s.versions.filter((v) => v.workItemTypeId === mar).map((v) => [v.version, v.pattern])).toEqual([
        [2, null],
        [1, custom],
      ]);
      // Another Company never gets the saver's name or id (V14).
      if (!own) expect(res.body).not.toContain(c1.company.authorizedPerson.id);
      // The Custom pattern is gone: MAR uses the Project pattern again.
      expect(s.types.find((x) => x.id === mar)!.override).toBeNull();
    }
    expect(await numbered(t, t.c1Engineer)).toBe("NVR/EL/MAR/01/0001");
  });

  it("RP-412-2: the page's examples reach a Member who isn't a Project Admin without any counter value", async () => {
    const t = await tower("NEX");
    await numbered(t, t.c1Engineer);
    await numbered(t, t.c1Engineer);
    for (const [label, who] of [
      ["C1 engineer", t.c1Engineer],
      ["C2 engineer", t.c2Engineer],
      ["K1 manager", t.k1Manager],
    ] as const) {
      const res = await ok(settingsOf(who, t), 200);
      expect(Object.keys(res.json()).sort(), label).toEqual(["canEdit", "example", "project", "types", "versions"]);
      expect(res.body, label).not.toMatch(/lastValue|counterKey|0002/);
      await expectHidden(who.get(`/v1/projects/${t.projectId}/numbering/counters`), label);
      await expectHidden(who.get(`/v1/projects/${t.projectId}/numbering/counter?workItemType=MAR`), label);
    }
    const counters = (await ok(c1.caller.get(`/v1/projects/${t.projectId}/numbering/counters`), 200)).json();
    expect(counters.counters).toEqual([expect.objectContaining({ counterKey: "NEX-MAR-01", lastValue: 2 })]);
  });

  it("a Project's own pattern can't be set to 'use the Project pattern'", async () => {
    const t = await tower("NUP");
    const res = await save(c1.caller, t, { pattern: null });
    expect([res.statusCode, res.json()]).toEqual([422, { error: "invalid_pattern" }]);
  });
});
