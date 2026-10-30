// Seam 1 for the Snag List's one "Questions" chip (RP-1109; decision RP-1004; spec RP-619 story 30;
// visibility.md V1, V3 and scenario RP-1109-1).
//
// The chip adds up the API's type counts of the three Question Types (QSN, QSC, QSO) and filters
// to all three. Those counts are of the items the viewer sees, so a Question hidden from it adds
// nothing: the chip's number is the number of Question rows the viewer reads, List and Kanban.
//
// The Project: C1 (Contractor, all of it), K1 (Consultant, all of it) and C2 (another Contractor
// of the same Trade, Building B only).
import type { WorkItemBoard, WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, ok, only, projectMember, take, type Tower } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

const questionTypes = ["QSN", "QSC", "QSO"];

let at: Tower;
let buildingB = "";
let c2Engineer: Caller; // Another Contractor of the same Trade, Building B only (V3).

const path = () => `/v1/projects/${at.projectId}/modules/snag_list/work-items`;
const questionsQuery = `?type=${questionTypes.join(",")}`;
const list = async (by: Caller, query = ""): Promise<WorkItemList> => (await ok(by.get(`${path()}${query}`), 200)).json();
const board = async (by: Caller, query = ""): Promise<WorkItemBoard> => (await ok(by.get(`${path()}/kanban${query}`), 200)).json();
/** The Questions chip's number: the API's counts of the Question Types, added up as the chip does. */
const chip = (counts: WorkItemList["typeCounts"]) => (counts ?? []).filter((c) => questionTypes.includes(c.code)).reduce((sum, c) => sum + c.count, 0);
/** The Questions the viewer reads in the List, filtered as the chip filters, by id. */
const questionIds = async (by: Caller) => (await list(by, questionsQuery)).items.map((i) => i.id).sort();

/** `asker`'s Question of `type` on Electrical at `location`, asked. */
async function asked(asker: Caller, type: string, title: string, location: string): Promise<string> {
  const answers = { question: `${title}?`, trade: at.electrical, location };
  const id = (await ok(asker.post(`/v1/projects/${at.projectId}/work-items`, { type, title, answers }), 201)).json().id as string;
  await take(asker, id, "ask");
  return id;
}

let c1Qso = ""; // C1 asks the Owner side, Building A.
let k1Qsc = ""; // K1 asks C1, Building A.
let c2Qsn = ""; // C2 asks K1, Building B.

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "QCH");
  buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  const join = async (role: "owner" | "contractor", location = all) => {
    const company = await api.authorizedPerson();
    const participant = await api.addParticipant(c1.caller, at.projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participant}/visibility`, { trade: all, location }));
    return { company, participant };
  };
  await join("owner");
  const c2 = await join("contractor", only(buildingB));
  c2Engineer = await projectMember(api, c2.company, c2.participant, ["engineer"]);
  c1Qso = await asked(at.c1Engineer, "QSO", "Which façade lighting colour", at.buildingA);
  k1Qsc = await asked(at.k1Manager, "QSC", "Confirm cable tray route", at.buildingA);
  c2Qsn = await asked(c2Engineer, "QSN", "Clarify socket height", buildingB);
});

describe("the Questions chip counts only the Questions the viewer sees (seam 1, scenario RP-1109-1)", () => {
  it("RP-1109-1: C2's chip counts its own Question only, never C1's or K1's; C1's never C2's; List and Kanban alike", async () => {
    // C2 reads its own QSN, and neither C1's QSO nor K1's QSC to C1 (V3): compared by id.
    expect(await questionIds(c2Engineer)).toEqual([c2Qsn]);
    expect(chip((await list(c2Engineer)).typeCounts)).toBe(1);
    expect(chip((await board(c2Engineer)).typeCounts)).toBe(1);
    // C1 reads its QSO and K1's QSC to it, never C2's QSN to K1.
    expect(await questionIds(at.c1Engineer)).toEqual([c1Qso, k1Qsc].sort());
    expect(chip((await list(at.c1Engineer)).typeCounts)).toBe(2);
    expect(chip((await board(at.c1Engineer)).typeCounts)).toBe(2);
    // K1 reads all three: asked by it, asked of it, and informed of C1's QSO.
    expect(await questionIds(at.k1Manager)).toEqual([c1Qso, k1Qsc, c2Qsn].sort());
    expect(chip((await list(at.k1Manager)).typeCounts)).toBe(3);
    expect(chip((await board(at.k1Manager)).typeCounts)).toBe(3);
  });

  it("the chip's filter, all three Question Types at once, lists exactly what the chip counts", async () => {
    for (const by of [c2Engineer, at.c1Engineer, at.k1Manager]) {
      const filtered = await list(by, questionsQuery);
      expect(filtered.items.length).toBe(chip((await list(by)).typeCounts));
      expect(filtered.items.every((i) => questionTypes.includes(i.type.code))).toBe(true);
    }
  });
});
