// Seam 5: a Rabaed Engineer sets a Project's numbering in Rabaed Admin (RP-317, spec
// RP-311; workflow-engine.md §8 "Who sets the pattern"). Same rules as the Project
// Admin's (RP-313, RP-314, RP-315), each edit with a reason written to admin_action;
// a refused edit logs nothing; a pattern with a shared counter records the Engineer
// as accepting it; Rabaed Admin reads the Project's counters.
import { randomInt, randomUUID } from "node:crypto";
import { createDb, withMember } from "@rabaed/db";
import { joinProject, testDatabaseUrls } from "@rabaed/db/test-support";
import type { AdminNumbering, NumberingPattern } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createTestAdmin, type Browser } from "./support/harness.ts";

const admin = await createTestAdmin();
const urls = testDatabaseUrls();
const adminDb = createDb(urls.admin, { max: 1 });
const appDb = createDb(urls.app, { max: 1 });
afterAll(async () => {
  await admin.close();
  await adminDb.destroy();
  await appDb.destroy();
});

const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const bi = (en: string) => JSON.stringify({ en, ar: en });

type Project = { id: string; adminMember: string; p1: string; p2: string; trade: string };

/** A Project of C1's (Participant 01) with C2 (02) as a Contractor, and a Trade EL. Set up as the customer app would. */
async function project(engineerId: string): Promise<Project> {
  const company = async (name: string) => {
    const cr = digits(10);
    const { rows } = await sql<{ id: string }>`
      insert into company (legal_name, cr_number, vat_number, onboarded_by)
      values (${bi(name)}::jsonb, ${cr}, ${`3${digits(13)}3`}, ${engineerId}::uuid) returning id`.execute(adminDb);
    const company_id = rows[0]!.id;
    const m = await sql<{ id: string }>`
      insert into member (company_id, email, full_name, status, can_create_projects)
      values (${company_id}::uuid, ${`ap-${randomUUID().slice(0, 8)}@rabaed.test`}, ${bi(name)}::jsonb, 'active', true) returning id`.execute(adminDb);
    await sql`update company set authorized_person_id = ${m.rows[0]!.id}::uuid where id = ${company_id}::uuid`.execute(adminDb);
    return { cr, ap: m.rows[0]!.id };
  };
  const c1 = await company("C1");
  const c2 = await company("C2");
  const code = `T${digits(4)}`;
  const created = await withMember(appDb, c1.ap, (trx) =>
    sql<{ project_id: string }>`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, ${code}, 'contractor')`.execute(trx),
  );
  const id = created.rows[0]!.project_id;
  const p1 = (await sql<{ id: string }>`select id from participant where project_id = ${id}::uuid`.execute(adminDb)).rows[0]!.id;
  const p2 = await joinProject(appDb, id, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap);
  const trade = await withMember(appDb, c1.ap, (trx) =>
    sql<{ value_id: string }>`select value_id from app.add_dimension_value(${id}::uuid, 'trade', null, 'EL', '{"en": "V", "ar": "ق"}'::jsonb)`.execute(trx),
  );
  return { id, adminMember: c1.ap, p1, p2, trade: trade.rows[0]!.value_id };
}

const segments = (...kinds: string[]) => kinds.map((kind) => (kind === "text" ? { kind, text: "SUB" } : { kind }));
const pattern = (kinds: string[], countedBy: number[], over: Partial<NumberingPattern> = {}) => ({
  segments: segments(...kinds),
  separator: "/",
  seqDigits: 5,
  countedBy,
  ...over,
});

const read = async (browser: Browser, projectId: string): Promise<AdminNumbering> => {
  const res = await browser.get(`/v1/projects/${projectId}/numbering?reason=Onboarding%20check`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

/** numbering_pattern rows of a Project, read on the admin connection (the table is not in the typed schema). */
const patternRows = <T extends object>(projectId: string, columns: string): Promise<T[]> =>
  sql<T>`select ${sql.raw(columns)} from numbering_pattern where project_id = ${projectId}::uuid order by effective_from`.execute(adminDb).then((r) => r.rows);

const actionsOn = (targetId: string) =>
  adminDb
    .selectFrom("admin_action")
    .select(["id", "engineer_id", "action", "target_kind", "reason", "before", "after"])
    .where("target_id", "=", targetId)
    .orderBy("at")
    .execute();

describe("the Numbering Pattern from Rabaed Admin", () => {
  it("is saved as a Rabaed Engineer, logged with its reason, and read back", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const body = { workItemTypeId: null, pattern: pattern(["project", "type", "participant"], [0, 1, 2]), reason: "Contract numbering clause 4.2" };
    const res = await browser.post(`/v1/projects/${p.id}/numbering-pattern`, body);
    expect(res.statusCode, res.body).toBe(204);

    const numbering = await read(browser, p.id);
    expect(numbering.project?.pattern).toEqual(body.pattern);
    expect(numbering.project?.sharedCounterAcceptedAt).toBeNull();
    // The pattern row names the action, not a Member.
    const [row] = await patternRows<{ set_by_member_id: string | null; admin_action_id: string }>(p.id, "set_by_member_id, admin_action_id");
    const [saved, read1] = await actionsOn(p.id);
    expect(row).toEqual({ set_by_member_id: null, admin_action_id: saved!.id });
    expect(saved).toMatchObject({ engineer_id: engineerId, action: "set_numbering_pattern", reason: "Contract numbering clause 4.2", before: null });
    expect(read1).toMatchObject({ action: "read_numbering", reason: "Onboarding check" });
  });

  it("applies the Project Admin's rules: a shared counter needs the warning accepted, and the Engineer is recorded accepting it", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const shared = { workItemTypeId: null, pattern: pattern(["project", "type", "text"], [0, 1]), reason: "Consultant wants one run of MARs" };

    const refused = await browser.post(`/v1/projects/${p.id}/numbering-pattern`, shared);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "shared_counter_not_accepted" });
    expect(await actionsOn(p.id)).toEqual([]);

    const accepted = await browser.post(`/v1/projects/${p.id}/numbering-pattern`, { ...shared, sharedCounterAccepted: true });
    expect(accepted.statusCode, accepted.body).toBe(204);
    const [action] = await actionsOn(p.id);
    expect(action).toMatchObject({ engineer_id: engineerId, action: "set_numbering_pattern", after: expect.objectContaining({ sharedCounterAccepted: true }) });
    const [row] = await patternRows<{ shared_counter_accepted_at: Date | null; admin_action_id: string }>(p.id, "shared_counter_accepted_at, admin_action_id");
    expect(row!.shared_counter_accepted_at).not.toBeNull();
    expect(row!.admin_action_id).toBe(action!.id);
  });

  it("refuses a pattern the Project Admin couldn't save, and a Project or Type that isn't there; nothing is logged", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const save = (projectId: string, patch: object) =>
      browser.post(`/v1/projects/${projectId}/numbering-pattern`, {
        workItemTypeId: null,
        pattern: pattern(["project", "type", "participant"], [0, 1, 2]),
        reason: "Try",
        ...patch,
      });

    // Rules the request schema checks (digits 3–7, up to 6 segments, a known segment).
    expect((await save(p.id, { pattern: pattern(["project", "type", "participant"], [0, 1, 2], { seqDigits: 8 }) })).statusCode).toBe(400);
    expect((await save(p.id, { pattern: pattern(["project", "type", "participant", "trade", "location", "text", "text"], [2]) })).statusCode).toBe(400);
    expect((await save(p.id, { pattern: pattern(["participant"], [0], { segments: [{ kind: "company" }] as never }) })).statusCode).toBe(400);
    // A reason is required.
    expect((await save(p.id, { reason: "  " })).statusCode).toBe(400);
    // Rules the database checks.
    expect((await save("00000000-0000-4000-8000-000000000000", {})).statusCode).toBe(404);
    const noType = await save(p.id, { workItemTypeId: "00000000-0000-4000-8000-000000000000" });
    expect([noType.statusCode, noType.json()]).toEqual([409, { error: "type_not_found" }]);
    const closedProject = await project(engineerId);
    await sql`update project set status = 'closed' where id = ${closedProject.id}::uuid`.execute(adminDb);
    const closed = await save(closedProject.id, {});
    expect([closed.statusCode, closed.json()]).toEqual([409, { error: "project_closed" }]);

    expect(await patternRows(p.id, "id")).toEqual([]);
    expect(await adminDb.selectFrom("admin_action").select("id").where("reason", "=", "Try").where("engineer_id", "=", engineerId).execute()).toEqual([]);
  });

  it("overrides the pattern for a Work Item Type, and logs the pattern it replaced", async () => {
    const { browser } = await admin.signedInEngineer();
    const { id: engineerId } = await admin.newEngineer();
    const p = await project(engineerId);
    const mar = (await read(browser, p.id)).types.find((t) => t.code === "MAR")!;
    const first = await browser.post(`/v1/projects/${p.id}/numbering-pattern`, {
      workItemTypeId: mar.id,
      pattern: pattern(["project", "type", "participant"], [0, 1, 2], { seqDigits: 5 }),
      reason: "MARs five digits",
    });
    expect(first.statusCode, first.body).toBe(204);
    const second = await browser.post(`/v1/projects/${p.id}/numbering-pattern`, {
      workItemTypeId: mar.id,
      pattern: pattern(["project", "type", "participant"], [0, 1, 2], { seqDigits: 6 }),
      reason: "Six after all",
    });
    expect(second.statusCode, second.body).toBe(204);

    const after = await read(browser, p.id);
    expect(after.project).toBeNull();
    expect(after.types.find((t) => t.code === "MAR")?.override?.pattern.seqDigits).toBe(6);
    const edits = (await actionsOn(p.id)).filter((a) => a.action === "set_numbering_pattern");
    expect(edits[1]).toMatchObject({ reason: "Six after all", before: { pattern: { seqDigits: 5 } } });
  });
});

describe("Participant Codes from Rabaed Admin", () => {
  it("sets a code, logged with its reason, and shows it with the Participants", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const res = await browser.post(`/v1/participants/${p.p2}/code`, { code: " ccm ", reason: "Contract abbreviation" });
    expect(res.statusCode, res.body).toBe(204);

    const numbering = await read(browser, p.id);
    expect(numbering.participants.map((x) => [x.ordinal, x.code, x.codeLocked])).toEqual([
      [1, null, false],
      [2, "CCM", false],
    ]);
    expect(await actionsOn(p.p2)).toEqual([
      expect.objectContaining({
        engineer_id: engineerId,
        action: "set_participant_code",
        target_kind: "participant",
        reason: "Contract abbreviation",
        before: { code: null },
        after: { projectId: p.id, code: "CCM" },
      }),
    ]);
  });

  it("applies the Project Admin's rules: duplicates, bad shapes and a code a number uses are refused, and logged as nothing", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const set = (participant: string, code: string) => browser.post(`/v1/participants/${participant}/code`, { code, reason: "Set code" });
    expect((await set(p.p1, "CCM")).statusCode).toBe(204);

    const dup = await set(p.p2, "ccm");
    expect([dup.statusCode, dup.json()]).toEqual([409, { error: "duplicate_code" }]);
    for (const bad of ["C", "1234", "TOOLONGX", "A-B"]) {
      expect(await set(p.p2, bad).then((r) => r.json())).toEqual({ error: "invalid_code" });
    }
    expect((await set("00000000-0000-4000-8000-000000000000", "ZZ")).statusCode).toBe(404);

    // A number has used the code: fixed.
    await sql`update participant set code_locked_at = now() where id = ${p.p1}::uuid`.execute(adminDb);
    const locked = await set(p.p1, "OTHER");
    expect([locked.statusCode, locked.json()]).toEqual([409, { error: "code_in_use" }]);
    expect((await read(browser, p.id)).participants[0]).toMatchObject({ code: "CCM", codeLocked: true });

    expect(await actionsOn(p.p2)).toEqual([]);
    expect((await actionsOn(p.p1)).map((a) => a.action)).toEqual(["set_participant_code"]);
  });
});

describe("starting numbers from Rabaed Admin", () => {
  it("sets a counter's starting number, logged with its reason, and reads the counters", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const res = await browser.post(`/v1/projects/${p.id}/numbering-counters/start`, {
      workItemType: "MAR",
      participantId: p.p2,
      startingNumber: 144,
      reason: "Register continues from paper",
    });
    expect(res.statusCode, res.body).toBe(200);
    const next = res.json() as { counterKey: string; nextNumber: string };
    expect(next.nextNumber).toMatch(/-MAR-02-0144$/);

    const numbering = await read(browser, p.id);
    expect(numbering.counters.counters).toEqual([{ counterKey: next.counterKey, lastValue: 143, startingNumber: 144, issued: false }]);
    expect(numbering.counters.workItemTypes.map((t) => t.code)).toContain("MAR");
    const edit = (await actionsOn(p.id)).find((a) => a.action === "set_numbering_counter_start");
    expect(edit).toMatchObject({ engineer_id: engineerId, reason: "Register continues from paper", after: { counterKey: next.counterKey, startingNumber: 144 } });
  });

  it("changes the starting number while the counter has issued nothing; locks it once used", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const start = (n: number) =>
      browser.post(`/v1/projects/${p.id}/numbering-counters/start`, { workItemType: "MAR", participantId: p.p1, startingNumber: n, reason: `Start ${n}` });
    expect((await start(10)).statusCode).toBe(200);
    expect((await start(20)).statusCode).toBe(200);
    // The counter issues its first number (as the Transition would: last_value moves up).
    await sql`update numbering_counter set last_value = last_value + 1 where project_id = ${p.id}::uuid`.execute(adminDb);
    const used = await start(30);
    expect([used.statusCode, used.json()]).toEqual([409, { error: "counter_used" }]);
    const [counter] = (await read(browser, p.id)).counters.counters;
    expect(counter).toMatchObject({ lastValue: 20, startingNumber: 20, issued: true });
    expect((await actionsOn(p.id)).filter((a) => a.action === "set_numbering_counter_start").map((a) => a.reason)).toEqual(["Start 10", "Start 20"]);
  });

  it("refuses values the pattern needs or the Project doesn't have; nothing is logged", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const start = (projectId: string, body: object) =>
      browser.post(`/v1/projects/${projectId}/numbering-counters/start`, { workItemType: "MAR", participantId: p.p1, startingNumber: 5, reason: "Refused start", ...body });
    expect((await start("00000000-0000-4000-8000-000000000000", {})).statusCode).toBe(404);
    expect((await start(p.id, { workItemType: "NOPE" })).json()).toEqual({ error: "type_not_found" });
    expect((await start(p.id, { participantId: null })).json()).toEqual({ error: "participant_required" });
    expect((await start(p.id, { participantId: randomUUID() })).json()).toEqual({ error: "value_not_found" });
    expect((await start(p.id, { startingNumber: 0 })).statusCode).toBe(400);
    expect((await start(p.id, { reason: "" })).statusCode).toBe(400);
    // A pattern that counts by Trade needs one.
    const byTrade = await browser.post(`/v1/projects/${p.id}/numbering-pattern`, {
      workItemTypeId: null,
      pattern: pattern(["project", "type", "trade", "participant"], [0, 1, 2, 3]),
      reason: "Trade in numbers",
    });
    expect(byTrade.statusCode, byTrade.body).toBe(204);
    expect((await start(p.id, {})).json()).toEqual({ error: "trade_required" });
    expect((await start(p.id, { tradeId: p.trade })).statusCode).toBe(200);

    expect(await adminDb.selectFrom("admin_action").select("action").where("reason", "=", "Refused start").where("engineer_id", "=", engineerId).execute()).toEqual([
      { action: "set_numbering_counter_start" },
    ]);
  });
});

describe("who can use it", () => {
  it("is for signed-in Rabaed Engineers only", async () => {
    const { id: engineerId } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const anon = admin.browser();
    expect((await anon.get(`/v1/projects/${p.id}/numbering?reason=x`)).statusCode).toBe(401);
    expect((await anon.post(`/v1/projects/${p.id}/numbering-pattern`, {})).statusCode).toBe(401);
    expect((await anon.post(`/v1/participants/${p.p1}/code`, {})).statusCode).toBe(401);
    expect((await anon.post(`/v1/projects/${p.id}/numbering-counters/start`, {})).statusCode).toBe(401);
  });

  it("asks for a reason to read a Project's counters", async () => {
    const { id: engineerId, browser } = await admin.signedInEngineer();
    const p = await project(engineerId);
    expect((await browser.get(`/v1/projects/${p.id}/numbering`)).statusCode).toBe(400);
    expect((await browser.get(`/v1/projects/00000000-0000-4000-8000-000000000000/numbering?reason=x`)).statusCode).toBe(404);
  });

  it("keeps the rules out of the customer app role's reach except through the Project Admin's functions", async () => {
    const { id: engineerId } = await admin.signedInEngineer();
    const p = await project(engineerId);
    const asApp = (query: ReturnType<typeof sql>) => withMember(appDb, p.adminMember, (trx) => query.execute(trx));
    await expect(asApp(sql`select app.assign_participant_code(${p.p1}::uuid, 'ZZ')`)).rejects.toThrow(/permission denied/);
    await expect(
      asApp(sql`select * from app.start_numbering_counter(${p.id}::uuid, 'MAR', ${p.p1}::uuid, null, null, 5, now())`),
    ).rejects.toThrow(/permission denied/);
    // The Project Admin's own function still works, with its checks.
    const { rows } = await asApp(sql`select app.set_participant_code(${p.p1}::uuid, 'ZZ') as outcome`);
    expect(rows).toEqual([{ outcome: "set" }]);
  });
});
