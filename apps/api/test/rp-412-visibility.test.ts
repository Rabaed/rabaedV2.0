// Seam 1 of scenario RP-412-3 (docs/visibility/scenarios/RP-412.md): who reads which saver of a Numbering Pattern
// version on the Numbering page. A C2 Member who is also a Project Admin saves Tower's pattern, a Rabaed Engineer
// saves another through Rabaed Admin, then C1's Project Admin (the Host Company's) a third. A saver's Company is
// named to its own Members and to a Project Admin (V15), the saver only within their Company (V14). Seam 2 is
// packages/db/test/numbering-pattern-rls.test.ts; RP-412-1 and RP-412-2 are in numbering.test.ts.
import { saveNumberingPattern } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { NumberingSettings, SaveNumberingPatternRequest } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uniqueEmail, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, memberOnProject, ok, projectMember, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const adminDb = createDb(urls.admin, { max: 1 });
// No api appoints a second Project Admin yet: the test does it as the owner, as seam 2 does.
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await adminDb.destroy();
  await migrator.destroy();
});

const C1_NAME = "Numbering Host Contractor";
const C2_NAME = "Numbering Second Contractor";
const C1_ADMIN = "Hala Hostadmin";
const C2_SAVER = "Sami Secondsaver";

let c1: Company;
let c2: Company;
let tower: Tower;
let c2Saver: { id: string; caller: Caller };
let c2Engineer: Caller;
const patterns = { c2: {}, rabaed: {}, c1: {} } as Record<"c2" | "rabaed" | "c1", SaveNumberingPatternRequest["pattern"]>;

const onboard = async (name: string, person: string): Promise<Company> => {
  const authorizedPerson = { email: uniqueEmail("ap"), fullName: bilingual(person), locale: "en" as const };
  const onboarded = await api.onboardCompany({ legalName: bilingual(name), authorizedPerson }); // not hidden-from: the onboarding request's field
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};
const pattern = (segments: object[], countedBy: number[]) => ({ segments, countedBy, separator: "-", seqDigits: 4 }) as SaveNumberingPatternRequest["pattern"];
const save = (by: Caller, p: SaveNumberingPatternRequest["pattern"]) =>
  ok(by.request("PUT", `/v1/projects/${tower.projectId}/numbering`, { workItemTypeId: null, sharedCounterAccepted: false, pattern: p }));
/** The Numbering page's settings as `by` reads them, and the body as it came. */
const settings = async (by: Caller) => {
  const res = await ok(by.get(`/v1/projects/${tower.projectId}/numbering`), 200);
  return { s: res.json() as NumberingSettings, body: res.body };
};
const projectVersions = async (by: Caller) => (await settings(by)).s.versions.filter((v) => v.workItemTypeId === null).map((v) => [v.version, v.pattern, v.savedBy]);

/** An api answer as someone read it: the name a failure gives, and the body as it came. */
type Payload = { name: string; body: string };
/** For expectHiddenFrom over payloads: `[{ id: text }]` when the payload holds `text`. */
const mentions = (text: string) => async (p: Payload) => (p.body.includes(text) ? [{ id: text }] : []);
const name = (p: Payload) => p.name;

beforeAll(async () => {
  c1 = await onboard(C1_NAME, C1_ADMIN);
  await ok(c1.caller.patch(`/v1/members/${c1.company.authorizedPerson.id}`, { canCreateProjects: true }), 200);
  const k1 = await onboard("Numbering Consultant", "Kamal Consultant");
  c2 = await onboard(C2_NAME, "Second Authorized Person");
  tower = await buildTower(api, { c1, k1 }, "NRV");
  const c2ParticipantId = await api.addParticipant(c1.caller, tower.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Saver = await memberOnProject(api, c2, c2ParticipantId, ["engineer"], { name: C2_SAVER });
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);

  const project = { kind: "project" };
  const type = { kind: "type" };
  const participant = { kind: "participant" };
  patterns.c2 = pattern([project, participant], [0, 1]);
  patterns.rabaed = pattern([type, participant], [0, 1]);
  patterns.c1 = pattern([project, type, participant], [0, 1, 2]);

  // C2's Member, made a Project Admin too, saves the first version.
  await sql`insert into project_admin (project_id, member_id, appointed_by_member_id) values (${tower.projectId}::uuid, ${c2Saver.id}::uuid, ${c1.company.authorizedPerson.id}::uuid)`.execute(migrator);
  await save(c2Saver.caller, patterns.c2);
  // A Rabaed Engineer saves the second, through Rabaed Admin's service, with a reason.
  api.advanceClock(1000);
  const saved = await saveNumberingPattern(adminDb, await api.engineer(), tower.projectId, { workItemTypeId: null, pattern: patterns.rabaed, sharedCounterAccepted: false, reason: "Customer asked, RP-412-3" }, api.now());
  expect(saved).toMatchObject({ ok: true });
  // C1's Project Admin, the Host Company's, saves the third, once C2's Member is no longer a Project Admin.
  await sql`delete from project_admin where project_id = ${tower.projectId}::uuid and member_id = ${c2Saver.id}::uuid`.execute(migrator);
  api.advanceClock(1000);
  await save(c1.caller, patterns.c1);
});

const nobody = { rabaed: false, company: null, member: null };
const rabaed = { rabaed: true, company: null, member: null };

describe("scenario RP-412-3: a C2 Project Admin saves Tower's pattern, a Rabaed Engineer another, then C1's Project Admin", () => {
  it("C1's engineer (Host Company, not a Project Admin) reads C2's save with no Company and no person, and 'Rabaed' for the Engineer's", async () => {
    expect(await projectVersions(tower.c1Engineer)).toEqual([
      [3, patterns.c1, { rabaed: false, company: bilingual(C1_NAME), member: bilingual(C1_ADMIN) }],
      [2, patterns.rabaed, rabaed],
      [1, patterns.c2, nobody],
    ]);
  });

  it("C1's Project Admin reads C2 by name, without the person", async () => {
    expect(await projectVersions(c1.caller)).toEqual([
      [3, patterns.c1, { rabaed: false, company: bilingual(C1_NAME), member: bilingual(C1_ADMIN) }],
      [2, patterns.rabaed, rabaed],
      [1, patterns.c2, { rabaed: false, company: bilingual(C2_NAME), member: null }],
    ]);
  });

  it("C2 reads its own Member's name, and C1's Project Admin's later save with no Company: the Host Company is no exception", async () => {
    const own = { rabaed: false, company: bilingual(C2_NAME), member: bilingual(C2_SAVER) };
    expect(await projectVersions(c2Engineer)).toEqual([
      [3, patterns.c1, nobody],
      [2, patterns.rabaed, rabaed],
      [1, patterns.c2, own],
    ]);
    // The saver, no longer a Project Admin, reads as any C2 Member does.
    expect(await projectVersions(c2Saver.caller)).toEqual(await projectVersions(c2Engineer));
  });

  it("no payload carries a Company or a person it may not, though those who may read them do", async () => {
    const read = async (who: string, by: Caller): Promise<Payload> => ({ name: who, body: (await settings(by)).body });
    const [c1Engineer, c1Admin, c2Reader] = [await read("C1 engineer", tower.c1Engineer), await read("C1 Project Admin", c1.caller), await read("C2 engineer", c2Engineer)];
    await expectHiddenFrom({ read: mentions(C2_NAME), target: C2_NAME, seenBy: [c1Admin, c2Reader], hiddenFrom: c1Engineer, name, label: "C2's name (V15)" });
    await expectHiddenFrom({ read: mentions(C2_SAVER), target: C2_SAVER, seenBy: c2Reader, hiddenFrom: [c1Engineer, c1Admin], name, label: "C2's saver (V14)" });
    await expectHiddenFrom({ read: mentions(C1_NAME), target: C1_NAME, seenBy: [c1Engineer, c1Admin], hiddenFrom: c2Reader, name, label: "the Host Company's name (V15)" });
    await expectHiddenFrom({ read: mentions(C1_ADMIN), target: C1_ADMIN, seenBy: [c1Engineer, c1Admin], hiddenFrom: c2Reader, name, label: "C1's saver (V14)" });
    // A saver's id is in their own Company's Member list, and in no other Company's settings.
    const members = async (company: Company): Promise<Payload> => ({ name: "its Company's Member list", body: (await ok(company.caller.get("/v1/members"), 200)).body });
    await expectHiddenFrom({ read: mentions(c2Saver.id), target: c2Saver.id, seenBy: await members(c2), hiddenFrom: [c1Engineer, c1Admin], name, label: "C2's saver's id" });
    await expectHiddenFrom({ read: mentions(c1.company.authorizedPerson.id), target: c1.company.authorizedPerson.id, seenBy: await members(c1), hiddenFrom: c2Reader, name, label: "C1's saver's id" });
  });
});
