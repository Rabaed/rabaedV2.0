// Seam 1: the UAT Projects (RP-1248), one per role, seeded with the demo (test/support/seed-demo.ts) as the
// sample Project is. This suite checks UAT 01, Hafiz's: it is on his Projects, every staged item has the
// Document Number the hand-run sheet names and waits where his case needs it, he reads none of the other
// Companies' work staged for his visibility cases (docs/visibility.md V1, V3 and V5, as rows RP-1217-1 to
// RP-1217-3 test them on the sample Project), and adding it again changes nothing.
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemHistory, WorkItemList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { demoMailbox } from "../src/demo/mailbox.ts";
import { addUatProjects } from "../src/demo/uat-projects.ts";
import { UAT_ROLES, uatRecords, type Staged } from "../src/demo/uat-projects-plan.ts";
import { createFileStore, fileStoreSettingsFromEnv } from "../src/documents/file-store.ts";
import { createTestApi, DEFAULT_PASSWORD, readById, testConfig, type Caller } from "./support/harness.ts";
import { detail } from "./support/tower.ts";

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
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
} as const;
type Who = keyof typeof demo;
const as = {} as Record<Who, Caller>;
const nameOf = (caller: Caller) => (Object.keys(as) as Who[]).find((who) => as[who] === caller) ?? "someone";

const role = UAT_ROLES.find((r) => r.n === "01")!;
const staged = role.staged();
let projectId = "";

beforeAll(async () => {
  for (const who of Object.keys(demo) as Who[]) as[who] = await api.signIn(demo[who], DEFAULT_PASSWORD);
  const { projects } = (await as.hafiz.get("/v1/projects")).json() as { projects: { id: string; code: string }[] };
  projectId = projects.find((p) => p.code === role.code)!.id; // not hidden-from: the Project Hafiz is on
});

/** The id of the item with this Subject on UAT 01, read as the migrator. */
async function idOf(title: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`select id from work_item where project_id = ${projectId}::uuid and title = ${title}`.execute(migrator);
  expect(rows, title).toHaveLength(1); // not hidden-from: the seed made it, read as the migrator
  return rows[0]!.id;
}

/** Who raised the staged item: TMC's Hafiz, Beta Build's Yousef or Design Consultants' Ahmed. */
const raiserOf = (s: Staged): Caller => {
  if (s.kind === "snag") return s.item.raisedBy === "ahmed" ? as.ahmed : as.hafiz;
  return s.item.owner === "beta" ? as.yousef : as.hafiz;
};

const MODULE = { submittal: "submittals", snag: "snag_list", inspection: "inspections" } as const;

describe("UAT 01, Hafiz's UAT Project (RP-1248)", () => {
  it("is on Hafiz's Projects, with the four Companies on it", async () => {
    const { projects } = (await as.hafiz.get("/v1/projects")).json() as { projects: { id: string; name: { en: string } }[] };
    expect(projects.find((p) => p.id === projectId)?.name.en).toBe(role.name.en); // not hidden-from: Hafiz's own Project, by id
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from participant where project_id = ${projectId}::uuid`.execute(migrator);
    expect(rows[0]!.n).toBe(4); // not hidden-from: the seed's four Companies, read as the migrator
  });

  it("gives every staged item the Document Number the sheet names, and leaves each Draft without one", async () => {
    for (const s of staged.filter((x) => !x.mustNotSee || x.number)) {
      const read = await detail(raiserOf(s), await idOf(s.item.title));
      expect(read.documentNumber, s.item.title).toBe(s.number ?? null);
    }
  });

  it("leaves each item one of Hafiz's cases acts on where the case needs it", async () => {
    const offered = async (title: string) => {
      const d = await detail(as.hafiz, await idOf(title));
      return { stage: d.stage.key, keys: d.actions.transitions.map((t) => t.key), kinds: d.actions.transitions.map((t) => t.kind), pickUp: Boolean(d.actions.pickUp) };
    };
    for (const s of staged.filter((x) => !x.mustNotSee)) {
      const at = await offered(s.item.title);
      const end = s.item.end;
      // A Draft's is send_for_review; a returned item's, send_for_review_again.
      if (s.kind === "submittal" && (end === "draft" || end === "returned")) expect(at.keys.some((k) => k.startsWith("send_for_review")), `${s.item.title}: ${at.keys.join(", ")}`).toBe(true);
      if ((end === "returned" || end === "draft") && s.cases.includes("WF-16")) expect(at.kinds, s.item.title).toContain("cancel");
      if (end === "with_consultant_engineer") expect(at.kinds, s.item.title).not.toContain("cancel"); // not hidden-from: Hafiz reads the item; Cancel is not offered after the Submit
      if (end === "cancelled") expect(at.stage, s.item.title).toBe("cancelled");
      if (end === "code_c") expect(at.stage, s.item.title).toBe("revise_resubmit");
      if (end === "code_d") expect(at.stage, s.item.title).toBe("rejected");
      if (end === "code_a") expect(at.stage, s.item.title).toBe("approved");
      if (s.kind === "snag" && (end === "open" || end === "returned_to_open")) expect(at.pickUp || at.keys.length > 0, s.item.title).toBe(true);
    }
  });

  it("holds none of the other Companies' work where Hafiz can read it: Beta Build's items and Design Consultants' Draft (V1, V3)", async () => {
    const theirs = staged.filter((x) => x.mustNotSee);
    expect(new Set(theirs.map((x) => raiserOf(x)))).toEqual(new Set([as.yousef, as.ahmed])); // not hidden-from: which demo people raised the targets
    for (const s of theirs) {
      const target = await idOf(s.item.title);
      await expectHiddenFrom({ read: readById(`/v1/work-items/${target}`), target, seenBy: raiserOf(s), hiddenFrom: as.hafiz, name: nameOf, label: `RP-1248 ${s.item.title}` });
      /** Every item `by` reads on the Module's List, page by page. */
      const listOf = async (by: Caller) => {
        const items: WorkItemList["items"] = [];
        let cursor: string | null = null;
        do {
          const res = await by.get(`/v1/projects/${projectId}/modules/${MODULE[s.kind]}/work-items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
          expect(res.statusCode, res.body).toBe(200);
          const page = res.json() as WorkItemList;
          items.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor);
        return items;
      };
      await expectHiddenFrom({ read: listOf, target, seenBy: raiserOf(s), hiddenFrom: as.hafiz, name: nameOf, label: `RP-1248 ${s.item.title} on the List` });
    }
  });

  it("keeps Design Consultants' Recommended Code, Internal Note and Engineer's review answers off VIS-04's item, and gives Hafiz the Code's Remarks (V5)", async () => {
    const item = await idOf(staged.find((x) => x.cases.includes("VIS-04"))!.item.title);
    /** The item, when `by`'s history of it holds a Recommended Code, an Internal Note or a reply's internal answers. */
    const internal = async (by: Caller) => {
      const res = await by.get(`/v1/work-items/${item}/history`);
      expect(res.statusCode, res.body).toBe(200);
      const held = (res.json() as WorkItemHistory).events.some((e) => e.type === "recommend_code" || e.type === "internal_note" || e.type === "internal_answers");
      return held ? [{ id: item }] : []; // not hidden-from: the read expectHiddenFrom calls below, no such event being no row
    };
    await expectHiddenFrom({ read: internal, target: item, seenBy: [as.ahmed, as.mohammed], hiddenFrom: [as.hafiz, as.ali], name: nameOf, label: "RP-1248 VIS-04" });
    // The Code's Remarks and final verification are shared with the Code (the Code C Screen): Hafiz reads them.
    expect((await as.hafiz.get(`/v1/work-items/${item}/history`)).body).toContain("Revise and resubmit with the specified finish");
  });
});

describe("adding the UAT Projects again", () => {
  it("changes nothing: no item, Participant or Member more, and every Document Number stays", async () => {
    const count = async () =>
      (
        await sql<{ items: number; participants: number; members: number }>`
          select (select count(*)::int from work_item where project_id = ${projectId}::uuid) as items,
                 (select count(*)::int from participant where project_id = ${projectId}::uuid) as participants,
                 (select count(*)::int from project_member pm join participant p on p.id = pm.participant_id where p.project_id = ${projectId}::uuid) as members
        `.execute(migrator)
      ).rows[0]!;
    const before = await count();
    const records = uatRecords(role);
    const planned = records.submittals.length + records.snags.length + records.inspections.length;
    const db = createDb(urls.app, { max: 2 });
    const app = await buildApp({ db, config: testConfig, logger: false, files: createFileStore(fileStoreSettingsFromEnv()), mailer: demoMailbox().mailer });
    try {
      const result = await addUatProjects(app, migrator, DEFAULT_PASSWORD, { roles: [role] });
      expect(result[role.code]).toEqual({ projectId, added: 0, present: planned, packages: { added: 0, present: 0 } });
    } finally {
      await app.close();
      await db.destroy();
    }
    expect(await count()).toEqual(before);
  });
});
