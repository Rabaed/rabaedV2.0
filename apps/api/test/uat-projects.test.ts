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
  saeed: "saeed.alqahtani@tmc.demo.rabaed.test",
  yousef: "yousef.karim@betabuild.demo.rabaed.test",
  ahmed: "ahmed.binsaid@designconsultants.demo.rabaed.test",
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
  // UAT 06–10's people (RP-1250).
  layla: "layla.mansour@designconsultants.demo.rabaed.test",
  noura: "noura.alharbi@alwaha.demo.rabaed.test",
  omar: "omar.alharbi@tmc.demo.rabaed.test",
  sara: "sara@designconsultants.demo.rabaed.test",
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

/** Who raised the staged item: TMC's Hafiz (a DAR's too), Beta Build's Yousef or Design Consultants' Ahmed. */
const raiserOf = (s: Staged): Caller => {
  if (s.kind === "snag") return s.item.raisedBy === "ahmed" ? as.ahmed : as.hafiz;
  if (s.kind === "dar") return as.hafiz;
  return s.item.owner === "beta" ? as.yousef : as.hafiz;
};

const MODULE = { submittal: "submittals", snag: "snag_list", inspection: "inspections", dar: "submittals" } as const;

/** Every item `by` reads on the Project's List of the Module a staged item of `kind` is in, page by page. */
const listOf = (project: string, kind: Staged["kind"]) => async (by: Caller) => {
  const items: WorkItemList["items"] = [];
  let cursor: string | null = null;
  do {
    const res = await by.get(`/v1/projects/${project}/modules/${MODULE[kind]}/work-items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as WorkItemList;
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
};

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
      await expectHiddenFrom({ read: listOf(projectId, s.kind), target, seenBy: raiserOf(s), hiddenFrom: as.hafiz, name: nameOf, label: `RP-1248 ${s.item.title} on the List` });
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

// UAT 02–05 (RP-1249), built as UAT 01 is: each on its person's Projects, each staged item with its planned Document
// Number and waiting at the Step its case needs, its Packages put together, and the role's must-not-see targets hidden
// from its person (V1, V3, V5). UAT 03's person, Saeed, is the Project Admin and on no Project's Steps: his are settings.
const later = UAT_ROLES.filter((r) => r.n !== "01");
const projectOf = async (code: string) => {
  const { rows } = await sql<{ id: string }>`select id from project where code = ${code}`.execute(migrator);
  expect(rows, code).toHaveLength(1); // not hidden-from: the seed made it, read as the migrator
  return rows[0]!.id;
};

/** The items with this Subject on the Project, oldest first: one, or a Code C and its Rev 1. */
async function idsOn(project: string, title: string): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`select id from work_item where project_id = ${project}::uuid and title = ${title} order by created_at, id`.execute(migrator);
  return rows.map((r) => r.id); // not hidden-from: the seed's items, read as the migrator
}

describe.each(later)("UAT $n, $name.en (RP-1249)", (r) => {
  const items = r.staged();
  const person = r.person as Who;
  let project = "";
  beforeAll(async () => {
    project = await projectOf(r.code);
  });
  const only = async (title: string) => {
    const ids = await idsOn(project, title);
    expect(ids, title).toHaveLength(1); // not hidden-from: the seed made exactly one
    return ids[0]!;
  };

  it("is on its person's Projects, with the four Companies on it", async () => {
    if (person === "layla") {
      // An Authorized Person, on no Project as a Member: her Company Projects list it (V15).
      const { participants } = (await as.layla.get("/v1/participants")).json() as { participants: { project: { id: string } }[] };
      expect(participants.map((p) => p.project.id)).toContain(project); // not hidden-from: Layla's own Company's Participant, by id
    } else {
      const { projects } = (await as[person].get("/v1/projects")).json() as { projects: { id: string; name: { en: string } }[] };
      expect(projects.find((p) => p.id === project)?.name.en).toBe(r.name.en); // not hidden-from: the person's own Project, by id
    }
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from participant where project_id = ${project}::uuid`.execute(migrator);
    expect(rows[0]!.n).toBe(4); // not hidden-from: the seed's four Companies, read as the migrator
  });

  it("gives every staged item the Document Number the sheet names, and leaves each Draft without one", async () => {
    for (const s of items) {
      const [id] = await idsOn(project, s.item.title);
      expect(id, s.item.title).toBeDefined();
      expect((await detail(raiserOf(s), id!)).documentNumber, s.item.title).toBe(s.number ?? null);
    }
  });

  // The Project Admin's cases are settings: UAT 03's one item only puts TMC's Participant Code in use, and Saeed holds no Step on it.
  // UAT 06's Layla, an Authorized Person, is on no Project's Steps either and UAT 06 holds no item (RP-1250).
  const actsOnItems = r.n !== "03" && r.n !== "06";
  it.runIf(actsOnItems)("leaves each item one of its person's cases acts on where the case needs it", async () => {
    for (const s of items.filter((x) => !x.mustNotSee)) {
      const end = s.item.end;
      const title = s.item.title;
      const d = await detail(as[person], await (s.kind === "submittal" && s.item.revision ? idsOn(project, title).then((ids) => ids[0]!) : only(title)));
      const keys = d.actions.transitions.map((t) => t.key);
      const atStep = Boolean(d.actions.pickUp) || keys.length > 0;
      if (end === "draft") expect(d.stage.key, title).toBe("draft");
      if (end === "with_pm") expect(keys, `${title}: ${keys.join(", ")}`).toContain("submit");
      // Sara shares the Engineers' pool on a Mechanical item (RP-1250).
      if (end === "with_consultant_engineer" && (person === "ahmed" || person === "sara")) expect(atStep, title).toBe(true);
      // Noura holds the Owner's review of a DAR (RP-1250): she picks it up, then Confirm or Send Back is hers.
      if (end === "with_owner") expect(Boolean(d.actions.pickUp) || keys.includes("confirm_a") || keys.includes("confirm_b"), `${title}: ${keys.join(", ")}`).toBe(true);
      // A Returned item goes back to Hafiz, who sent it, never to Omar, who covers it too (WF-12, RP-1250).
      if (end === "returned" && person === "omar") expect(atStep, `${title}: ${keys.join(", ")}`).toBe(false);
      // Omar and Noura read Submitted TMC or Beta Build items they hold no Step on: read-only.
      if (end === "with_consultant_engineer" && (person === "omar" || person === "noura")) expect(atStep, title).toBe(false);
      // Mohammed, the only Consultant Manager, holds it or picks it up first.
      if (end === "with_consultant_manager") expect(Boolean(d.actions.pickUp) || keys.includes("approve_a"), `${title}: ${keys.join(", ")}`).toBe(true);
      // Back at Design Consultants' Verify Step, in its pool: Ahmed picks it up, then Close is his.
      if (end === "resolved") expect(Boolean(d.actions.pickUp) || keys.includes("close"), `${title}: ${keys.join(", ")}`).toBe(true);
      if (end === "code_a") expect(d.stage.key, title).toBe("approved");
      if (end === "code_c") expect(d.stage.key, title).toBe("revise_resubmit");
      if (end === "code_d") expect(d.stage.key, title).toBe("rejected");
    }
  });

  it("holds none of the other Companies' work, nor TMC's before its Submit, where its person can read it (V1, V3)", async () => {
    for (const s of items.filter((x) => x.mustNotSee)) {
      const target = await only(s.item.title);
      const label = `RP-1249 UAT ${r.n} ${s.item.title}`;
      await expectHiddenFrom({ read: readById(`/v1/work-items/${target}`), target, seenBy: raiserOf(s), hiddenFrom: as[person], name: nameOf, label });
      await expectHiddenFrom({ read: listOf(project, s.kind), target, seenBy: raiserOf(s), hiddenFrom: as[person], name: nameOf, label: `${label} on the List` });
    }
  });

  it("puts its Packages together, TMC's, with the items the plan gives them", async () => {
    const planned = r.packages?.() ?? [];
    const { packages } = (await as.ali.get(`/v1/projects/${project}/packages`)).json() as { packages: { id: string; name: { en: string } }[] };
    expect(packages.map((p) => p.name.en).sort()).toEqual(planned.map((p) => p.package.name.en).sort()); // not hidden-from: TMC's own Packages, read by its PM
    for (const p of planned) {
      const found = packages.find((x) => x.name.en === p.package.name.en)!; // not hidden-from: finds TMC's own Package by its name, to read its items
      const { items: inIt } = (await as.ali.get(`/v1/packages/${found.id}`)).json() as { items: { title: string }[] };
      expect(inIt.map((i) => i.title).sort(), p.package.name.en).toEqual([...p.package.existing, ...p.package.drafts.map((d) => d.title)].sort()); // not hidden-from: the items TMC's PM put in, read by him
    }
  });
});

describe("UAT 02's and UAT 05's internal work at Design Consultants and inside TMC (RP-1249)", () => {
  it("keeps Ahmed's Recommended Code and Internal Note off VIS-20's Code C item for Ali (V5)", async () => {
    const r = later.find((x) => x.n === "02")!;
    const project = await projectOf(r.code);
    const [item] = await idsOn(project, r.staged().find((x) => x.cases.includes("VIS-20"))!.item.title);
    const internal = async (by: Caller) => {
      const res = await by.get(`/v1/work-items/${item}/history`);
      expect(res.statusCode, res.body).toBe(200);
      const held = (res.json() as WorkItemHistory).events.some((e) => e.type === "recommend_code" || e.type === "internal_note" || e.type === "internal_answers");
      return held ? [{ id: item! }] : []; // not hidden-from: the read expectHiddenFrom calls below, no such event being no row
    };
    await expectHiddenFrom({ read: internal, target: item!, seenBy: [as.ahmed, as.mohammed], hiddenFrom: as.ali, name: nameOf, label: "RP-1249 VIS-20" });
  });

  it("keeps VIS-12's Rev 1, still in TMC's Internal Review, from Mohammed while he reads its Code C (V1)", async () => {
    const r = later.find((x) => x.n === "05")!;
    const project = await projectOf(r.code);
    const ids = await idsOn(project, r.staged().find((x) => x.cases.includes("VIS-12") && !x.mustNotSee)!.item.title);
    expect(ids).toHaveLength(2); // not hidden-from: the Code C item and its Rev 1, read as the migrator
    expect((await detail(as.mohammed, ids[0]!)).stage.key).toBe("revise_resubmit");
    await expectHiddenFrom({ read: readById(`/v1/work-items/${ids[1]}`), target: ids[1]!, seenBy: [as.hafiz, as.ali], hiddenFrom: as.mohammed, name: nameOf, label: "RP-1249 VIS-12 Rev 1" });
  });
});

// UAT 06–10's own checks (RP-1250): who is on which UAT Project, as Layla's and Omar's cases need (V15, V4), and what
// Noura, Yousef and Sara must not read beyond the generic checks above (V3, V5).
describe("UAT 06–10's people and what they must not read (RP-1250)", () => {
  const roleOf = (n: string) => UAT_ROLES.find((r) => r.n === n)!;
  /** The Projects `by` reads on their Projects list, as rows with the Project's id. */
  const projectsOf = async (by: Caller) => ((await by.get("/v1/projects")).json() as { projects: { id: string }[] }).projects;

  it("lists all ten UAT Projects among Layla's Company Projects: an Authorized Person sees every Project of her Company (V15)", async () => {
    const { participants } = (await as.layla.get("/v1/participants")).json() as { participants: { project: { id: string } }[] };
    const mine = participants.map((p) => p.project.id);
    for (const r of UAT_ROLES) expect(mine, r.code).toContain(await projectOf(r.code)); // not hidden-from: Design Consultants' own Participants
  });

  it("keeps UAT 06 off Sara's and Mohammed's Projects, who are Members of every other UAT Project but not of it (V15)", async () => {
    const uat06 = await projectOf("UAT06");
    await expectHiddenFrom({ read: projectsOf, target: uat06, seenBy: as.ahmed, hiddenFrom: [as.sara, as.mohammed], name: nameOf, label: "RP-1250 UAT 06" });
    for (const who of [as.sara, as.mohammed]) expect((await projectsOf(who)).map((p) => p.id)).toContain(await projectOf("UAT10")); // not hidden-from: a UAT Project they are on
  });

  it("covers Electrical and Mechanical only for Design Consultants on UAT 06, and Electrical only for Ahmed, its one Member there (V4)", async () => {
    const uat06 = await projectOf("UAT06");
    const { participants } = (await as.layla.get("/v1/participants")).json() as { participants: { id: string; project: { id: string } }[] };
    const dcl = participants.find((p) => p.project.id === uat06)!.id; // not hidden-from: Design Consultants' own Participant on UAT 06
    const { trade } = (await as.saeed.get(`/v1/projects/${uat06}/dimensions`)).json() as { trade: { id: string; code: string }[] };
    const tradeId = (code: string) => trade.find((t) => t.code === code)!.id; // not hidden-from: the Project Admin reads his own Project's Trades
    const own = ((await as.layla.get(`/v1/participants/${dcl}/visibility`)).json() as { visibility: { trade: { isAll: boolean; valueIds: string[] } } }).visibility;
    expect(own.trade.isAll).toBe(false);
    expect([...own.trade.valueIds].sort()).toEqual([tradeId("EL"), tradeId("ME")].sort());
    const { members } = (await as.layla.get(`/v1/participants/${dcl}/members`)).json() as { members: { id: string; email?: string; name?: { en: string } }[] };
    expect(members).toHaveLength(1); // not hidden-from: Design Consultants' own Members on UAT 06, read by its Authorized Person
    const ahmed = ((await as.layla.get(`/v1/participants/${dcl}/members/${members[0]!.id}/visibility`)).json() as { visibility: { trade: { isAll: boolean; valueIds: string[] } } }).visibility;
    expect(ahmed.trade).toEqual({ isAll: false, valueIds: [tradeId("EL")] });
  });

  it("puts Omar on every UAT Project, TMC's, where he reads a Podium item and not a Tower A one (V4)", async () => {
    const mine = (await projectsOf(as.omar)).map((p) => p.id);
    for (const r of UAT_ROLES) expect(mine, r.code).toContain(await projectOf(r.code)); // not hidden-from: Omar's own Projects
    const uat09 = await projectOf("UAT09");
    const staged = roleOf("09").staged();
    const podium = staged.find((s) => s.cases.includes("VIS-09") && !s.mustNotSee)!.item.title;
    expect((await detail(as.omar, (await idsOn(uat09, podium))[0]!)).documentNumber).toBe("UAT09-MAR-01-0003");
    const [towerA] = await idsOn(uat09, "VIS-09 Exit signs – Tower A Level 02, Submitted");
    await expectHiddenFrom({ read: readById(`/v1/work-items/${towerA}`), target: towerA!, seenBy: as.hafiz, hiddenFrom: as.omar, name: nameOf, label: "RP-1250 VIS-09 Tower A item" });
  });

  it("keeps the Recommended Code on Noura's DARs from TMC while she holds the Owner's review (V5)", async () => {
    const uat07 = await projectOf("UAT07");
    for (const s of roleOf("07").staged().filter((x) => x.kind === "dar")) {
      const [item] = await idsOn(uat07, s.item.title);
      const recommended = async (by: Caller) => {
        const res = await by.get(`/v1/work-items/${item}/history`);
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as WorkItemHistory).events.some((e) => e.type === "recommend_code") ? [{ id: item! }] : []; // not hidden-from: the read expectHiddenFrom calls below
      };
      await expectHiddenFrom({ read: recommended, target: item!, seenBy: [as.mohammed, as.noura], hiddenFrom: [as.hafiz, as.ali], name: nameOf, label: `RP-1250 ${s.item.title}` });
    }
  });

  it("keeps TMC's Code B Comment off Yousef's Snag List and its id (V3)", async () => {
    const uat08 = await projectOf("UAT08");
    const [comment] = await idsOn(uat08, "Submit the factory test certificates before delivery: lighting control panel, UAT 08.");
    expect(comment).toBeDefined();
    await expectHiddenFrom({ read: readById(`/v1/work-items/${comment}`), target: comment!, seenBy: as.hafiz, hiddenFrom: as.yousef, name: nameOf, label: "RP-1250 VIS-05 Comment" });
    await expectHiddenFrom({ read: listOf(uat08, "snag"), target: comment!, seenBy: as.hafiz, hiddenFrom: as.yousef, name: nameOf, label: "RP-1250 VIS-05 Comment on the Snag List" });
  });

  it("shows Sara TMC's Submitted Package but never its Open one, which only TMC reads", async () => {
    const uat10 = await projectOf("UAT10");
    const packagesOf = async (by: Caller) => ((await by.get(`/v1/projects/${uat10}/packages`)).json() as { packages: { id: string; name: { en: string } }[] }).packages;
    const all = await packagesOf(as.ali);
    const open = all.find((p) => p.name.en === "PKG-12 Package of Drafts")!.id; // not hidden-from: TMC's own Package, found by its PM
    await expectHiddenFrom({ read: packagesOf, target: open, seenBy: as.ali, hiddenFrom: as.sara, name: nameOf, label: "RP-1250 PKG-12 Open Package" });
    expect((await packagesOf(as.sara)).map((p) => p.name.en)).toContain("PKG-12 Package of both Trades"); // not hidden-from: the Submitted Package Sara reads
  });
});

describe("adding the UAT Projects again", () => {
  it("changes nothing: no item, Participant, Member or Package more, and every Document Number stays", async () => {
    const ids = Object.fromEntries(await Promise.all(UAT_ROLES.map(async (r) => [r.code, r.n === "01" ? projectId : await projectOf(r.code)] as const)));
    const count = async (project: string) =>
      (
        await sql<{ items: number; participants: number; members: number; packages: number }>`
          select (select count(*)::int from work_item where project_id = ${project}::uuid) as items,
                 (select count(*)::int from participant where project_id = ${project}::uuid) as participants,
                 (select count(*)::int from project_member pm join participant p on p.id = pm.participant_id where p.project_id = ${project}::uuid) as members,
                 (select count(*)::int from package where project_id = ${project}::uuid) as packages
        `.execute(migrator)
      ).rows[0]!;
    const before = await Promise.all(UAT_ROLES.map((r) => count(ids[r.code]!)));
    const db = createDb(urls.app, { max: 2 });
    const app = await buildApp({ db, config: testConfig, logger: false, files: createFileStore(fileStoreSettingsFromEnv()), mailer: demoMailbox().mailer });
    try {
      const result = await addUatProjects(app, migrator, DEFAULT_PASSWORD);
      for (const r of UAT_ROLES) {
        const records = uatRecords(r);
        const planned = records.submittals.length + records.snags.length + records.inspections.length + (records.dars?.length ?? 0);
        expect(result[r.code], r.code).toEqual({ projectId: ids[r.code], added: 0, present: planned, packages: { added: 0, present: records.packages.length } });
      }
    } finally {
      await app.close();
      await db.destroy();
    }
    expect(await Promise.all(UAT_ROLES.map((r) => count(ids[r.code]!)))).toEqual(before);
  });

  it("prints how long each Project took, and the total, with no Subject or email (RP-1254: UAT's job log is public)", async () => {
    const lines: string[] = [];
    const db = createDb(urls.app, { max: 2 });
    const app = await buildApp({ db, config: testConfig, logger: false, files: createFileStore(fileStoreSettingsFromEnv()), mailer: demoMailbox().mailer });
    const signIns: string[] = [];
    const inject = app.inject.bind(app);
    app.inject = ((options: { method?: string; url?: string }) => {
      if (options.method === "POST" && options.url === "/v1/session") signIns.push(options.url);
      return inject(options as never);
    }) as typeof app.inject;
    try {
      await addUatProjects(app, migrator, DEFAULT_PASSWORD, { roles: UAT_ROLES.slice(0, 3), log: (line) => lines.push(line) });
    } finally {
      await app.close();
      await db.destroy();
    }
    const timed = lines.filter((l) => /^seeded /.test(l));
    expect(timed).toEqual([expect.stringMatching(/^seeded UAT 0[123] in \d+\.\d s$/), expect.stringMatching(/^seeded UAT 0[123] in \d+\.\d s$/), expect.stringMatching(/^seeded UAT 0[123] in \d+\.\d s$/), expect.stringMatching(/^seeded 3 UAT Project\(s\) in \d+\.\d s$/)]);
    expect(new Set(timed.slice(0, 3).map((l) => l.slice(0, 14)))).toEqual(new Set(["seeded UAT 01 ", "seeded UAT 02 ", "seeded UAT 03 "]));
    expect(lines.join("\n")).not.toMatch(/@|demo\.rabaed\.test/);
    // Each demo person signs in once for all of them, not once per Project.
    expect(signIns.length).toBeLessThanOrEqual(13);
  });
});
