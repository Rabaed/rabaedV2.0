// Seam 1 for a Document Number's segments in the item read (RP-1065, spec RP-1054 C4;
// GLOSSARY "Document Number", "Numbering Pattern", "Version"; visibility.md, Document
// Numbers, scenario RP-1065-1): `GET /v1/work-items/:id` gives `numberSegments`, the number
// part by part from the pattern Version it was numbered under, for the Submittal Panel's
// "How this number is built" card. A Draft has none; a Revision's suffix is no segment.
import { randomUUID } from "node:crypto";
import type { SaveNumberingPatternRequest, WorkItemDetail } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type TestApi } from "./support/harness.ts";
import { buildTower, detail, draft, ok, submitted, take, type Company, type Tower } from "./support/tower.ts";

let api: TestApi;
let c1: Company;
let k1: Company;
let outsider: Company;

beforeAll(async () => {
  api = await createTestApi({ files: true });
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  outsider = await api.projectCreator();
});

afterAll(async () => {
  await api?.close();
});

const savePattern = (at: Tower, pattern: SaveNumberingPatternRequest["pattern"], workItemTypeId: string | null = null) =>
  ok(c1.caller.request("PUT", `/v1/projects/${at.projectId}/numbering`, { workItemTypeId, sharedCounterAccepted: false, pattern }));

describe("the item read's numberSegments", () => {
  it("name each part of the number, the sequence last; a Draft has none", async () => {
    const t = await buildTower(api, { c1, k1 }, "SGA");
    const id = await submitted(t, t.c1Engineer, t.c1Pm, "Cable trays");
    const read = await detail(t.c1Engineer, id);
    expect(read.documentNumber).toBe("SGA-MARV-01-0001");
    expect(read.numberSegments).toEqual({
      separator: "-",
      segments: [
        { kind: "project", value: "SGA" },
        { kind: "type", value: "MARV" },
        { kind: "participant", value: "01" },
        { kind: "sequence", value: "0001" },
      ],
    });
    const drafted = await detail(t.c1Engineer, await draft(t, t.c1Engineer, "Still a Draft"));
    expect(drafted.documentNumber).toBeNull();
    expect(drafted.numberSegments).toBeUndefined();
  });

  it("stay those of the pattern the item was numbered under when the Project's pattern changes", async () => {
    const t = await buildTower(api, { c1, k1 }, "SGB");
    const before = await submitted(t, t.c1Engineer, t.c1Pm, "Before the change");
    const kept = (await detail(t.c1Engineer, before)).numberSegments;
    await savePattern(t, {
      segments: [{ kind: "project" }, { kind: "trade" }, { kind: "text", text: "SUB" }, { kind: "participant" }],
      separator: "/",
      seqDigits: 3,
      countedBy: [0, 1, 3],
    });
    const after = await detail(t.c1Engineer, await submitted(t, t.c1Engineer, t.c1Pm, "After the change"));
    expect(after.documentNumber).toBe("SGB/EL/SUB/01/001");
    expect(after.numberSegments?.segments.map((s) => s.kind)).toEqual(["project", "trade", "text", "participant", "sequence"]);

    expect((await detail(t.c1Engineer, before)).numberSegments).toEqual(kept);
    expect(kept?.segments.map((s) => s.kind)).toEqual(["project", "type", "participant", "sequence"]);
  });

  it("of a Revision are its first item's: the ' Rev n' suffix is no segment", async () => {
    const t = await buildTower(api, { c1, k1 }, "SGC");
    const first = await submitted(t, t.c1Engineer, t.c1Pm, "Luminaires");
    await ok(t.k1Manager.post(`/v1/work-items/${first}/pick-up`));
    await take(t.k1Manager, first, "revise_c", { remarks: "Resubmit with 110 lm/W luminaires" });
    const revision = (await ok(t.c1Engineer.post(`/v1/work-items/${first}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;
    await take(t.c1Engineer, revision, "send_for_review");

    const read = await detail(t.c1Engineer, revision);
    expect(read.documentNumber).toBe("SGC-MARV-01-0001 Rev 1");
    expect(read.numberSegments).toEqual((await detail(t.c1Engineer, first)).numberSegments);
    expect(read.numberSegments?.segments.at(-1)).toEqual({ kind: "sequence", value: "0001" });
  });
});

describe("visibility.md, Document Numbers", () => {
  it("RP-1065-1: another Company that sees the item reads the same segments, only what the number prints; anyone else gets the 404", async () => {
    const t = await buildTower(api, { c1, k1 }, "SGV");
    const id = await submitted(t, t.c1Engineer, t.c1Pm, "Cable trays");
    const own = await detail(t.c1Engineer, id);
    const theirs: WorkItemDetail = await detail(t.k1Manager, id);
    expect(theirs.numberSegments).toEqual(own.numberSegments);
    const { separator, segments } = theirs.numberSegments!;
    expect(segments.map((s) => s.value).join(separator)).toBe(theirs.documentNumber);
    // Each part is its kind and the text the number prints (a Location's level), nothing else: no counter.
    expect(segments.flatMap((s) => Object.keys(s)).every((key) => ["kind", "value", "level"].includes(key))).toBe(true);
    await expectHidden(outsider.caller.get(`/v1/work-items/${id}`), "a Company on no Project of these");
  });
});
