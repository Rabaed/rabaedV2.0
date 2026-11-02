// Seam 1: the sample Project (RP-1217), Al Nakheel District – Block A. The seam suites' global setup
// seeds it with the demo (test/support/seed-demo.ts). This suite checks the owner's counts as the
// Contractor reads them, what each other Company may see of the same records (docs/visibility.md,
// scenarios RP-1217-1 to RP-1217-5), and that adding it again changes nothing.
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemHistory, WorkItemList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { demoMailbox } from "../src/demo/mailbox.ts";
import { SAMPLE_PROJECT, sampleSubmittals, type SampleSubmittal } from "../src/demo/sample-project-plan.ts";
import { addSampleProject } from "../src/demo/sample-project.ts";
import { createFileStore, fileStoreSettingsFromEnv } from "../src/documents/file-store.ts";
import { createTestApi, DEFAULT_PASSWORD, expectHidden, readById, testConfig, type Caller } from "./support/harness.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const demo = {
  hafiz: "hafiz.hamdan@tmc.demo.rabaed.test",
  ali: "ali.sonour@tmc.demo.rabaed.test",
  yousef: "yousef.karim@betabuild.demo.rabaed.test",
  ahmed: "ahmed.binsaid@designconsultants.demo.rabaed.test",
  sara: "sara@designconsultants.demo.rabaed.test",
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
  faisal: "faisal.alotaibi@alwaha.demo.rabaed.test",
  nasser: "nasser.aldosari@betabuild.demo.rabaed.test",
} as const;
type Who = keyof typeof demo;
const as = {} as Record<Who, Caller>;
const nameOf = (caller: Caller) => (Object.keys(as) as Who[]).find((who) => as[who] === caller) ?? "someone";
let projectId = "";

beforeAll(async () => {
  for (const who of Object.keys(demo) as Who[]) as[who] = await api.signIn(demo[who], DEFAULT_PASSWORD);
  const { projects } = (await as.ali.get("/v1/projects")).json() as { projects: { id: string; code: string }[] };
  projectId = projects.find((p) => p.code === SAMPLE_PROJECT.code)!.id; // not hidden-from: the Project Ali is on
});

/** The Submittals' Stage counts as `by` reads them on the List (`stages`), Stages with none left out. */
async function stageCounts(by: Caller, module = "submittals"): Promise<Record<string, number>> {
  const res = await by.get(`/v1/projects/${projectId}/modules/${module}/work-items`);
  expect(res.statusCode, res.body).toBe(200);
  const list = res.json() as WorkItemList;
  return Object.fromEntries(list.stages.filter((s) => s.count > 0).map((s) => [s.key, s.count]));
}

/** Every item `by` reads on the Module's List, page by page. */
async function listed(by: Caller, module: string): Promise<WorkItemList["items"]> {
  const items: WorkItemList["items"] = [];
  let cursor: string | null = null;
  do {
    const res = await by.get(`/v1/projects/${projectId}/modules/${module}/work-items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as WorkItemList;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const plan = sampleSubmittals();
const submitted = (s: SampleSubmittal) => s.end !== "with_pm" && s.end !== "returned";
/** The Stage counts the plan gives the items `include` keeps, with each Revision in Internal Review. */
function planned(include: (s: SampleSubmittal) => boolean, { revisions }: { revisions: boolean }) {
  const stage: Record<SampleSubmittal["end"], string> = {
    with_pm: "internal_review",
    returned: "internal_review",
    with_consultant_engineer: "pending_approval",
    with_consultant_manager: "pending_approval",
    code_a: "approved",
    code_b: "approved",
    code_c: "revise_resubmit",
    code_d: "rejected",
  };
  const counts: Record<string, number> = {};
  for (const s of plan.filter(include)) {
    counts[stage[s.end]] = (counts[stage[s.end]] ?? 0) + 1;
    if (revisions && s.revision) counts.internal_review = (counts.internal_review ?? 0) + 1;
  }
  return counts;
}

describe("the sample Project, as its Contractor reads it", () => {
  it("has the owner's counts: 12 Internal Review, 50 Pending Approval, 26 Code A or B, 10 Revise and Resubmit, 5 Rejected", async () => {
    expect(await stageCounts(as.ali)).toEqual({ internal_review: 12, pending_approval: 50, approved: 26, revise_resubmit: 10, rejected: 5 });
  });

  it("numbers every Submittal through the Project's own Document Numbering", async () => {
    // One row a chain: the 4 revised Code C items read as their Rev 1.
    const items = await listed(as.ali, "submittals");
    expect(items.length).toBe(103);
    expect(items.filter((i) => i.documentNumber?.endsWith(" Rev 1")).length).toBe(4);
    expect(items.every((i) => /^NKD-(MAR|SAR)-\d{2}-\d{4}( Rev 1)?$/.test(i.documentNumber ?? ""))).toBe(true);
  });

  it("fills the Snag List: Snags at every Stage, Site Observations and Code B's Comments", async () => {
    const counts = await stageCounts(as.ali, "snag_list");
    for (const stage of ["open", "in_progress", "on_hold", "resolved", "closed"]) expect(counts[stage], stage).toBeGreaterThan(0);
    const types = new Set((await listed(as.ali, "snag_list")).map((i) => i.type.code));
    expect(types).toEqual(new Set(["SNG", "OBS", "CMT"]));
  });
});

describe("what each Company sees of it (docs/visibility.md)", () => {
  it("RP-1217-1: the Consultant reads every Submitted Submittal, none of the 12 still in the Contractor's Internal Review", async () => {
    const expected = planned(submitted, { revisions: false });
    expect(await stageCounts(as.ahmed)).toEqual(expected);
    expect(await stageCounts(as.mohammed)).toEqual(expected);
    // By id too, each first read by TMC: the Consultant and the Owner Representative read none of the 12.
    const internal = (await listed(as.ali, "submittals")).filter((i) => i.stage.key === "internal_review");
    expect(internal.length).toBe(12);
    for (const { id: target } of internal) {
      await expectHiddenFrom({ read: readById(`/v1/work-items/${target}`), target, seenBy: as.ali, hiddenFrom: [as.ahmed, as.mohammed, as.faisal], name: nameOf, label: "RP-1217-1" });
    }
  });

  it("RP-1217-2: Beta Build, the second Contractor, reads none of TMC's Submittals or Snags, though it reads the Project", async () => {
    // It is on the Project: the reads work for it.
    expect((await as.yousef.get(`/v1/projects/${projectId}`)).statusCode).toBe(200);
    const submittal = (await listed(as.hafiz, "submittals"))[0]!;
    const snag = (await listed(as.hafiz, "snag_list")).find((i) => i.type.code === "SNG")!;
    for (const [target, module] of [[submittal.id, "submittals"], [snag.id, "snag_list"]] as const) {
      await expectHiddenFrom({ read: readById(`/v1/work-items/${target}`), target, seenBy: as.hafiz, hiddenFrom: as.yousef, name: nameOf, label: "RP-1217-2" });
      // On its List either.
      await expectHiddenFrom({ read: (by: Caller) => listed(by, module), target, seenBy: as.hafiz, hiddenFrom: as.yousef, name: nameOf, label: "RP-1217-2" });
    }
  });

  it("RP-1217-3: the Consultant Engineer's Recommended Code and Internal Note stay inside Design Consultants", async () => {
    const atManager = plan.find((s) => s.end === "with_consultant_manager")!;
    const [item] = (await sql<{ id: string }>`select id from work_item where project_id = ${projectId}::uuid and title = ${atManager.title}`.execute(migrator)).rows;
    /** The item, when `by` reads a Recommended Code or Internal Note event in its history; none when they read no such event, or not the item. */
    const internalOf = async (by: Caller): Promise<{ id: string }[]> => {
      const res = await by.get(`/v1/work-items/${item!.id}/history`);
      if (res.statusCode === 404) return []; // not hidden-from: the read expectHiddenFrom calls below, the plain 404 being no row
      expect(res.statusCode, res.body).toBe(200);
      const events = (res.json() as WorkItemHistory).events.filter((e) => e.type === "recommend_code" || e.type === "internal_note");
      return events.length > 0 ? [{ id: item!.id }] : []; // not hidden-from: the same read, no such event being no row
    };
    await expectHiddenFrom({ read: internalOf, target: item!.id, seenBy: [as.mohammed, as.ahmed], hiddenFrom: [as.ali, as.hafiz, as.faisal], name: nameOf, label: "RP-1217-3" });
  });

  it("RP-1217-4: the Mechanical-only Consultant Engineer reads only the Mechanical Submittals", async () => {
    const mechanical = new Set(plan.filter((s) => s.trade === "ME").map((s) => s.title));
    const seen = await listed(as.sara, "submittals");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((i) => mechanical.has(i.title)), seen.map((i) => i.title).join(", ")).toBe(true);
    expect(await stageCounts(as.sara)).toEqual(planned((s) => submitted(s) && s.trade === "ME", { revisions: false }));
  });

  it("RP-1217-5: Nasser, who is not on it, can't tell it exists", async () => {
    const { projects } = (await as.nasser.get("/v1/projects")).json() as { projects: { code: string }[] };
    expect(projects.map((p) => p.code)).toEqual(["JCV"]);
    // The Project page and its List: read by Ali and Yousef (who are on it), the plain 404 for Nasser.
    await expectHiddenFrom({ read: readById(`/v1/projects/${projectId}`), target: projectId, seenBy: [as.ali, as.yousef], hiddenFrom: as.nasser, name: nameOf, label: "RP-1217-5" });
    const listOf = async (by: Caller) => {
      const res = await by.get(`/v1/projects/${projectId}/modules/submittals/work-items`);
      if (res.statusCode === 200) return [{ id: projectId }];
      await expectHidden(res); // not hidden-from: inside the read expectHiddenFrom calls below, as readById does
      return [];
    };
    await expectHiddenFrom({ read: listOf, target: projectId, seenBy: as.ali, hiddenFrom: as.nasser, name: nameOf, label: "RP-1217-5" });
  });
});

describe("adding it again", () => {
  it("changes nothing: no item, Participant or Member more", async () => {
    const count = async () =>
      (
        await sql<{ items: number; participants: number; members: number }>`
          select (select count(*)::int from work_item where project_id = ${projectId}::uuid) as items,
                 (select count(*)::int from participant where project_id = ${projectId}::uuid) as participants,
                 (select count(*)::int from project_member pm join participant p on p.id = pm.participant_id where p.project_id = ${projectId}::uuid) as members
        `.execute(migrator)
      ).rows[0]!;
    const before = await count();
    const db = createDb(urls.app, { max: 4 });
    const app = await buildApp({ db, config: testConfig, logger: false, files: createFileStore(fileStoreSettingsFromEnv()), mailer: demoMailbox().mailer });
    try {
      const result = await addSampleProject(app, migrator, DEFAULT_PASSWORD);
      expect(result).toEqual({ projectId, added: 0, present: 129 });
    } finally {
      await app.close();
      await db.destroy();
    }
    expect(await count()).toEqual(before);
  });
});
