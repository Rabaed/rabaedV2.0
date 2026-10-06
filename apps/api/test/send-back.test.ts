// Seam 1 for the Send Back, the Submission Date and the Creation Date (RP-334;
// ADR 0014; workflow-engine.md §1 publish checks 4 and 8; data-model.md
// work_item; visibility.md "Creation Date" and scenario 61). A Send Back takes a
// Submitted item back to its raiser's Participant, the same item with the same
// Document Number. The Submission Date is set at the first Submit and kept after
// a Send Back; the Creation Date (when it got its number) is the raiser's only;
// when the Draft was started reaches nobody.
//
// The Type is test-only, on the test Workflow with a Send Back (addSendBackType).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workflowKindProblems, type PublishedTransition } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, DEFAULT_PASSWORD, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, detail, memberOnProject, ok, take, type Company } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "SNDBK";
const DAY = 24 * 3_600_000;
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

let c1: Company;
let engineer: Caller; // C1 engineer: raises the items.
let pm: Caller; // C1 PM: Submits.
let k1Engineer: Caller; // Holds Consultant review.
let orEngineer: Caller; // Owner Representative (oversight).
let projectId = "";
let electrical = "";
let buildingA = "";

const dates = async (by: Caller, id: string) => {
  const d = await detail(by, id);
  return { creationDate: d.creationDate, submissionDate: d.submissionDate };
};
/** What the database recorded for the item, for the test to compare with (the migrator reads every column). */
const recorded = async (id: string) => {
  const { rows } = await sql<{ created_at: Date; numbered_at: Date | null; submitted_at: Date | null }>`
    select created_at, numbered_at, submitted_at from work_item where id = ${id}::uuid
  `.execute(migrator);
  const row = rows[0]!;
  return {
    createdAt: row.created_at.toISOString(),
    numberedAt: row.numbered_at?.toISOString() ?? null,
    submittedAt: row.submitted_at?.toISOString() ?? null,
  };
};

const emails = new Map<Caller, string>();

/** A signed-in Member of `company` on the Project, with `positions` and all of its Visibility, signed in again by later(). */
async function projectMember(company: Company, participantId: string, positions: string[]): Promise<Caller> {
  const { caller, email } = await memberOnProject(api, company, participantId, positions);
  emails.set(caller, email);
  return caller;
}

/** Moves the clock on, and signs every Member in again: moving it ends their sessions. */
async function later(ms: number) {
  api.advanceClock(ms);
  for (const [caller, email] of emails) caller.useSessionToken((await api.signIn(email, DEFAULT_PASSWORD)).sessionToken);
}

async function newDraft(model: string): Promise<string> {
  const res = await ok(
    engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA } }),
    201,
  );
  return res.json().id as string;
}

async function submit(id: string) {
  await ok(pm.post(`/v1/work-items/${id}/claim`));
  await take(pm, id, "submit");
}

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Send Back submittal", ar: "اعتماد بالإرجاع" }, schema);
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(c1, own, ["engineer"]);
  pm = await projectMember(c1, own, ["project_manager"]);
  const participant = async (role: "consultant" | "owner_representative") => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return projectMember(company, participantId, ["engineer"]);
  };
  k1Engineer = await participant("consultant");
  orEngineer = await participant("owner_representative");
});

describe("publish checks 4 and 8", () => {
  it("pass every published Workflow Version: Returns stay inside a Participant, and only a Send Back loops across", async () => {
    const { rows } = await sql<{ version: string; key: string; from: string; to: string; kind: PublishedTransition["kind"]; outcome: string | null }>`
      select v.id as version, tr.key, f.key as "from", s.key as "to", tr.kind, tr.outcome
      from workflow_transition tr
      join workflow_version v on v.id = tr.workflow_version_id
      join workflow_step f on f.id = tr.from_step_id
      join workflow_step s on s.id = tr.to_step_id
      where v.status = 'published'
      order by v.id, tr.sort
    `.execute(migrator);
    const steps = await sql<{ version: string; key: string; role: string | null }>`
      select s.workflow_version_id as version, s.key, s.actor_rule ->> 'base_role' as role
      from workflow_step s join workflow_version v on v.id = s.workflow_version_id
      where v.status = 'published'
    `.execute(migrator);
    const versions = [...new Set(rows.map((r) => r.version))];
    // The test Workflow with a Send Back is among them.
    expect(rows.some((r) => r.kind === "send_back")).toBe(true);
    const problems = versions.flatMap((version) =>
      workflowKindProblems(
        steps.rows.filter((s) => s.version === version),
        rows.filter((r) => r.version === version),
      ).map((p) => ({ version, ...p })),
    );
    expect(problems).toEqual([]);
  });

  it("is backed by the database: a Send Back never sets an outcome", async () => {
    const sendBack = await migrator
      .selectFrom("workflow_transition")
      .select(["id"])
      .where("kind", "=", "send_back")
      .executeTakeFirstOrThrow();
    await expect(migrator.updateTable("workflow_transition").set({ outcome: "C" }).where("id", "=", sendBack.id).execute()).rejects.toThrow(
      /workflow_transition_send_back_no_outcome/,
    );
  });
});

describe("a Send Back", () => {
  let id = "";
  let number: string | null = null;
  beforeAll(async () => {
    id = await newDraft("SB-1");
    await take(engineer, id, "send_for_review");
    await submit(id);
    number = (await detail(pm, id)).documentNumber;
    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    await take(k1Engineer, id, "send_back");
  });

  it("takes the same item, with its Document Number, back to the Contractor's review", async () => {
    const back = await detail(pm, id);
    expect(back).toMatchObject({ documentNumber: number, step: { key: "internal_review" }, outcome: null });
    expect(number).not.toBeNull();
  });

  it("can take it back to the raiser's Draft, where it keeps its number", async () => {
    const other = await newDraft("SB-2");
    await take(engineer, other, "send_for_review");
    await submit(other);
    const issued = (await detail(pm, other)).documentNumber;
    await ok(k1Engineer.post(`/v1/work-items/${other}/claim`));
    await take(k1Engineer, other, "send_back_to_draft");
    expect(await detail(engineer, other)).toMatchObject({ documentNumber: issued, step: { key: "draft" } });
  });
});

describe("the Submission Date", () => {
  it("is set at the first Submit, and kept after a Send Back and a second Submit", async () => {
    const id = await newDraft("SD-1");
    await take(engineer, id, "send_for_review");
    expect(await dates(pm, id)).toMatchObject({ submissionDate: null });
    await later(DAY);
    await submit(id);
    const first = (await recorded(id)).submittedAt;
    expect(first).not.toBeNull();
    for (const viewer of [engineer, pm, k1Engineer, orEngineer]) expect((await dates(viewer, id)).submissionDate).toBe(first);

    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    await take(k1Engineer, id, "send_back");
    await later(3 * DAY);
    await submit(id);
    expect((await recorded(id)).submittedAt).toBe(first);
    for (const viewer of [engineer, pm, k1Engineer, orEngineer]) expect((await dates(viewer, id)).submissionDate).toBe(first);
  });
});

/** Every answer time `by` is given for the item, as a number. */
const answerTimes = async (by: Caller, id: string) => Object.values((await detail(by, id)).fieldTimes).map((t) => Date.parse(t.at));

describe("answer times never earlier than the Creation Date once numbered (RP-392-1)", () => {
  let id = "";
  let draftSaved = 0;
  beforeAll(async () => {
    id = await newDraft("RP-392");
    draftSaved = Math.min(...(await answerTimes(engineer, id)));
    await later(2 * DAY);
    await take(engineer, id, "send_for_review");
  });

  it("gives co-editors the real times while it is still a Draft", async () => {
    const draft = await newDraft("RP-392 draft");
    const started = Math.min(...(await answerTimes(engineer, draft)));
    await later(DAY);
    // Not numbered: the times are as stamped, not raised to anything.
    expect(await recorded(draft)).toMatchObject({ numberedAt: null });
    expect(await answerTimes(engineer, draft)).toContain(started);
  });

  it("reads no time earlier than the Creation Date for the PM at Internal Review", async () => {
    const { numberedAt } = await recorded(id);
    expect(Date.parse(numberedAt!) - draftSaved).toBeGreaterThanOrEqual(2 * DAY);
    const times = await answerTimes(pm, id);
    expect(times.length).toBeGreaterThan(0);
    for (const t of times) expect(t).toBeGreaterThanOrEqual(Date.parse(numberedAt!));
  });

  it("reads none for the raiser after a Send Back either", async () => {
    await later(DAY);
    await submit(id);
    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    await take(k1Engineer, id, "send_back_to_draft");
    const { numberedAt } = await recorded(id);
    expect(await detail(engineer, id)).toMatchObject({ step: { key: "draft" } });
    const times = await answerTimes(engineer, id);
    expect(times.length).toBeGreaterThan(0);
    for (const t of times) expect(t).toBeGreaterThanOrEqual(Date.parse(numberedAt!));
  });

  it("still autosaves after the Send Back, on the times it read", async () => {
    const before = (await detail(engineer, id)).fieldTimes;
    const basedOn = Object.fromEntries(Object.entries(before).map(([key, t]) => [key, t.at]));
    const res = await ok(
      engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers: { model: "RP-392 edited", trade: electrical, location: buildingA }, basedOn }),
      200,
    );
    expect(res.json().keptFromOthers).toEqual([]);
    expect((await detail(engineer, id)).answers).toMatchObject({ model: "RP-392 edited" });
    const { numberedAt } = await recorded(id);
    for (const t of await answerTimes(engineer, id)) expect(t).toBeGreaterThanOrEqual(Date.parse(numberedAt!));
  });

  it("keeps the stored times for audit", async () => {
    const { rows } = await sql<{ field_times: Record<string, { at: string }> }>`select field_times from work_item where id = ${id}::uuid`.execute(migrator);
    const { numberedAt } = await recorded(id);
    expect(Math.min(...Object.values(rows[0]!.field_times).map((t) => Date.parse(t.at)))).toBeLessThan(Date.parse(numberedAt!));
  });
});

describe("C1 starts a Draft, sends it for review two days later, and Submits it 17 days after that (scenario 61)", () => {
  let id = "";
  beforeAll(async () => {
    id = await newDraft("SC-61");
    await later(2 * DAY);
    await take(engineer, id, "send_for_review");
    await later(17 * DAY);
    await submit(id);
  });

  it("shows C1 the Creation Date (sent for review) and the Submission Date", async () => {
    const { numberedAt, submittedAt, createdAt } = await recorded(id);
    for (const c1Member of [engineer, pm]) {
      expect(await dates(c1Member, id)).toEqual({ creationDate: numberedAt, submissionDate: submittedAt });
    }
    // Two days after the Draft was started, and 17 before the Submit.
    expect(Date.parse(numberedAt!) - Date.parse(createdAt)).toBeGreaterThanOrEqual(2 * DAY);
    expect(Date.parse(submittedAt!) - Date.parse(numberedAt!)).toBeGreaterThanOrEqual(17 * DAY);
  });

  it("shows K1 and OR only the Submission Date", async () => {
    const { submittedAt } = await recorded(id);
    for (const other of [k1Engineer, orEngineer]) {
      expect(await dates(other, id)).toEqual({ creationDate: null, submissionDate: submittedAt });
    }
  });

  it("gives nobody the time the Draft was started, through any read of the item", async () => {
    const { createdAt } = await recorded(id);
    for (const viewer of [engineer, pm, k1Engineer, orEngineer]) {
      for (const url of [`/v1/work-items/${id}`, `/v1/work-items/${id}/history`, `/v1/projects/${projectId}/work-items`]) {
        const body = (await ok(viewer.get(url), 200)).body;
        expect(body, url).not.toContain(createdAt);
        expect(body, url).not.toContain('"createdAt"');
      }
    }
  });

  it("shows C1 neither date while the item is still a Draft", async () => {
    const draft = await newDraft("SC-61 draft");
    expect(await dates(engineer, draft)).toEqual({ creationDate: null, submissionDate: null });
  });
});
