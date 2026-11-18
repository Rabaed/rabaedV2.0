// Seam 1 for RP-1323 (owner's decision 2026-11-18, after RP-1309; visibility.md V15, V18, V20;
// scenarios RP-1323-1 to RP-1323-4): `POST /v1/workflows/:w/duplicate` and
// `POST /v1/workflows/:w/save-to-library` take as their source only a Workflow the Member reads
// through the Workflow's own reads (RP-1309's `readsWorkflowOffProject`): a source those reads
// answer with the 404 gets the same 404 here, the one a made-up id gets, before anything is
// copied. Every source a page offers still copies: the Project's Workflows settings, the
// Library's "Use on Project", and saving a Project's Workflow to the Library.
// The seam suites' global setup runs the demo seed, which publishes the eight submittal Defaults.
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkflowSettings, WorkflowSettingsType } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, ok, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const settings = async (by: Caller, projectId: string): Promise<WorkflowSettings> =>
  (await ok(by.get(`/v1/projects/${projectId}/workflow-settings`), 200)).json();
const marOf = (s: WorkflowSettings): WorkflowSettingsType => s.types.find((t) => t.code === "MAR")!;
const library = async (by: Caller): Promise<unknown> => (await ok(by.get("/v1/library/workflows"), 200)).json();

/** `by` copies `source` into Project `projectId` (null: into their Company's Library), as the Settings page and "Use on Project" do. */
const duplicate = (by: Caller, source: string, projectId: string | null, name = bilingual("A copy")) =>
  by.post(`/v1/workflows/${source}/duplicate`, { projectId, name });
/** `by` saves `source` to their Company's Library, as the Settings page does. */
const saveToLibrary = (by: Caller, source: string, name = bilingual("Saved")) => by.post(`/v1/workflows/${source}/save-to-library`, { name });

/** What a Member sees of what was copied: each Project's Settings and their Library. */
const copiesSeen = async (by: Caller, projectIds: string[]) => ({
  settings: await Promise.all(projectIds.map((id) => settings(by, id))),
  library: await library(by),
});

const callers = new Map<Caller, string>();
const who = (by: Caller) => callers.get(by) ?? "a caller";

/** A read for expectHiddenFrom: `send(by)` copies `source` ([{ id: source }], its 201) or answers the plain 404 ([]); anything else fails. */
const copies = (source: string, send: (by: Caller) => ReturnType<Caller["post"]>) => async (by: Caller) => {
  const res = await send(by);
  if (res.statusCode === 201) return [{ id: source }];
  await expectHidden(res, `${who(by)} copying ${source}`); // not hidden-from: the read expectHiddenFrom runs, its seenBy copying first
  return [];
};

let c1: Company;
let k1: Company;
let otherAdmin: Company;
let at: Tower;
let other: Tower;
let onNoProject: Caller;
/** The Rabaed Default MAR runs on both Towers, and one of the other seven, in use on neither. */
let running = "";
let unused = "";
/** A published copy of MAR's Workflow that no Type runs: on the Tower C1's Authorized Person administers, and on the second Tower, where they are only a Member. */
let ownUnused = "";
let theirUnused = "";

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "RIX");
  otherAdmin = await api.projectCreator();
  other = await buildTower(api, { c1: otherAdmin, k1: await api.authorizedPerson() }, "RIY");
  onNoProject = (await api.authorizedPerson()).caller;
  callers
    .set(c1.caller, "C1's Authorized Person, the Tower's Project Admin")
    .set(k1.caller, "K1's Authorized Person")
    .set(otherAdmin.caller, "the second Tower's Project Admin")
    .set(onNoProject, "an Authorized Person on no Project");

  const mar = marOf(await settings(c1.caller, at.projectId));
  running = mar.workflow.id;
  unused = mar.rabaedDefaults.find((d) => d.id !== running)!.id;

  // C1 joins the second Tower, and C1's Authorized Person, the Tower's Project Admin, is a Project Member there (not its Project Admin).
  const c1There = await api.addParticipant(otherAdmin.caller, other.projectId, c1.company, "contractor");
  await api.addProjectMember(c1.caller, c1There, c1.company.authorizedPerson.id);
  expect((await settings(c1.caller, other.projectId)).canEdit).toBe(false);

  const publishedCopy = async (admin: Caller, projectId: string, en: string) => {
    const id = (await ok(duplicate(admin, running, projectId, bilingual(en)), 201)).json().id as string;
    await ok(admin.post(`/v1/workflows/${id}/publish`), 200);
    return id;
  };
  ownUnused = await publishedCopy(c1.caller, at.projectId, "Tower MARs, unused");
  theirUnused = await publishedCopy(otherAdmin.caller, other.projectId, "Second Tower MARs, unused");
});

describe("scenario RP-1323-1: a Project Admin of one Project cannot copy the other Project's unused copy, where they are only a Member", () => {
  it("answers the duplicate into their Project, or into their Library, with the 404 of a made-up id, and copies nothing", async () => {
    const before = await copiesSeen(c1.caller, [at.projectId, other.projectId]);
    const madeUp = crypto.randomUUID();
    await expectHidden(duplicate(c1.caller, madeUp, at.projectId), "a made-up id"); // not hidden-from: the answer the hidden source must match
    // Each into a Project they administer: the second Tower's Project Admin copies it there, C1's gets the 404 into the Tower.
    const theirProject = (by: Caller) => (by === c1.caller ? at.projectId : other.projectId);
    const hidden = { target: theirUnused, seenBy: otherAdmin.caller, hiddenFrom: c1.caller, name: who };
    await expectHiddenFrom({ ...hidden, read: copies(theirUnused, (by) => duplicate(by, theirUnused, theirProject(by))), label: "the second Tower's unused copy, into a Project" });
    await expectHiddenFrom({ ...hidden, read: copies(theirUnused, (by) => duplicate(by, theirUnused, null)), label: "the second Tower's unused copy, into their Library" });
    expect(await copiesSeen(c1.caller, [at.projectId, other.projectId])).toEqual(before);
  });

  it("answers the 404 first, into a closed Project they administer too, so the later refusal never tells them the id exists", async () => {
    const closing = await buildTower(api, { c1, k1 }, "RIZ");
    await sql`update project set status = 'closed', closed_at = now() where id = ${closing.projectId}::uuid`.execute(migrator);
    await expectHidden(duplicate(c1.caller, crypto.randomUUID(), closing.projectId), "a made-up id, into the closed Project"); // not hidden-from: the answer the hidden source must match
    await expectHidden(duplicate(c1.caller, theirUnused, closing.projectId), "the second Tower's unused copy, into the closed Project"); // not hidden-from: nobody copies into a closed Project; the contrast is the made-up id above and the 409 below, and RP-1323-1's first case proves the source is copied by its own Project Admin
    const closed = await duplicate(c1.caller, running, closing.projectId);
    expect({ status: closed.statusCode, body: closed.json() }, "a source they read, into the closed Project").toEqual({ status: 409, body: { error: "project_closed" } });
  });
});

describe("scenario RP-1323-2: a Project Admin still copies every Workflow they read", () => {
  it("copies into their Project the Tower's unused copy, the Rabaed Default MAR runs, an unused Rabaed Default their Settings lists, and their Library's Workflow", async () => {
    for (const source of [ownUnused, running, unused]) await ok(duplicate(c1.caller, source, at.projectId), 201);
    const libraryCopy = (await ok(duplicate(c1.caller, running, null, bilingual("C1 MARs")), 201)).json().id as string;
    await ok(c1.caller.post(`/v1/workflows/${libraryCopy}/publish`), 200);
    await ok(duplicate(c1.caller, libraryCopy, at.projectId, bilingual("C1 MARs on the Tower")), 201); // the Library's "Use on Project"
  });

  it("copies the second Tower's unused copy for that Tower's own Project Admin", async () => {
    await ok(duplicate(otherAdmin.caller, theirUnused, other.projectId), 201);
  });
});

describe("scenario RP-1323-3: save to Library takes only a source the Authorized Person reads", () => {
  it("answers C1's Authorized Person the 404 of a made-up id for the second Tower's unused copy, and saves nothing", async () => {
    const before = await library(c1.caller);
    await expectHidden(saveToLibrary(c1.caller, crypto.randomUUID()), "a made-up id"); // not hidden-from: the answer the hidden source must match
    await expectHiddenFrom({ read: copies(theirUnused, (by) => saveToLibrary(by, theirUnused)), target: theirUnused, seenBy: otherAdmin.caller, hiddenFrom: c1.caller, name: who, label: "the second Tower's unused copy" });
    expect(await library(c1.caller)).toEqual(before);
  });

  it("saves the Tower's own unused copy and the Workflow MAR runs, as the Settings page offers", async () => {
    await ok(saveToLibrary(c1.caller, ownUnused), 201);
    await ok(saveToLibrary(c1.caller, running), 201);
  });
});

describe("scenario RP-1323-4: an Authorized Person who is not a Project Admin saves only what is in use on a Project they are on", () => {
  it("answers K1's Authorized Person, a Member of the Tower, the 404 for an unused Rabaed Default, and saves the one MAR runs", async () => {
    await api.addProjectMember(k1.caller, at.k1ParticipantId!, k1.company.authorizedPerson.id);
    expect((await settings(k1.caller, at.projectId)).canEdit).toBe(false);
    const before = await library(k1.caller);
    // The Tower's Project Admin, whose Settings lists it, saves it; K1's Authorized Person gets the 404.
    const hidden = { target: unused, seenBy: c1.caller, hiddenFrom: k1.caller, name: who };
    await expectHiddenFrom({ ...hidden, read: copies(unused, (by) => saveToLibrary(by, unused)), label: "an unused Rabaed Default" });
    await expectHiddenFrom({ ...hidden, read: copies(unused, (by) => duplicate(by, unused, null)), label: "an unused Rabaed Default, by duplicate into the Library" });
    expect(await library(k1.caller)).toEqual(before);
    await ok(saveToLibrary(k1.caller, running), 201);
  });

  it("answers an Authorized Person on no Project the 404 for every Rabaed Default", async () => {
    const before = await library(onNoProject);
    for (const source of [running, unused]) {
      const hidden = { target: source, seenBy: c1.caller, hiddenFrom: onNoProject, name: who };
      await expectHiddenFrom({ ...hidden, read: copies(source, (by) => saveToLibrary(by, source)), label: "a Rabaed Default, saved" });
      await expectHiddenFrom({ ...hidden, read: copies(source, (by) => duplicate(by, source, null)), label: "a Rabaed Default, by duplicate into the Library" });
    }
    expect(await library(onNoProject)).toEqual(before);
  });
});
