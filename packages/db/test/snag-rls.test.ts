// Seam 2 for the Snag (RP-90, SNAG-1; spec RP-619; workflow-engine.md §3, §10;
// visibility.md V3, V5, V14 and scenarios RP-90-1 to RP-90-3), as the app role. K1, the
// Consultant, raises a Snag (the Rabaed Default Snag Workflow) on C1, the one Contractor
// covering its Trade and Location; C1 moves it inside its own Company and resolves it, and
// K1 verifies it. C2, another Contractor of the same Trade covering another Location, never
// reads it; each Company reads the other's work only through the shared Transitions.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: works the Snag.
let k1: Company; // Consultant: raises and verifies it.
let c2: Company; // Another Contractor of the same Trade, covering Building B only (V3).
let k2: Company; // Another Consultant, covering Buildings B and C only (RP-625).
let c1Pm = "";
let participant: Record<"c1" | "k1" | "c2" | "k2", string>;
let projectId = "";
let electrical = "";
let buildingA = "";
let buildingB = ""; // Covered by C2, K2, C1 and K1.
let buildingC = ""; // Covered by C1 (all), K1 (all) and K2; not by C2.

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
    [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
  );
}

async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), cr, `3${digits(13)}3`, engineer],
  );
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);
const take = (as: string, id: string, transition: string, answers: object = {}) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);
const seen = async (as: string, id: string) => (await call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`)).map((r) => r.id);
/**
 * The events of item `id` that `as` reads: type, audience, the acting Participant and the Transition's label, as
 * app.event_transitions gives it to everyone who reads the event (the Transition itself is the actor's own, RP-1140).
 */
const events = (as: string, id: string) =>
  call<{ type: string; audience: string; actor_participant_id: string; transition: string | null }>(
    as,
    sql`select e.type, e.audience, e.actor_participant_id, t.label ->> 'en' as transition
        from work_item_event e
        left join app.event_transitions(array(select x.id from work_item_event x where x.work_item_id = ${id}::uuid)) t on t.event_id = e.id
        where e.work_item_id = ${id}::uuid order by e.seq`,
  );
const stepAsSeen = async (as: string, id: string) =>
  (await call<{ stage_key: string; entered_at: Date }>(as, sql`select stage_key, entered_at from app.step_as_seen(${id}::uuid)`))[0];

/** `as`, holding Draft `id`, uploads a photo to it; so a read of its Documents can fail (RP-1095). Returns its id. */
async function addPhoto(as: string, id: string): Promise<string> {
  const [started] = await call<{ outcome: string; document_id: string }>(
    as,
    sql`select outcome, document_id from app.start_document_upload(${id}::uuid, 'site.jpg', 10, 'image/jpeg', now(), 'photos')`,
  );
  expect(started!.outcome).toBe("started");
  const fingerprint = createHash("sha256").update("site.jpg", "utf8").digest();
  expect(
    await outcome(as, sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 10, 'image/jpeg', ${fingerprint}, now()) as outcome`),
  ).toBe("confirmed");
  return started!.document_id;
}
/** `as`, holding `from`, Links it to `to`; read by `as`'s Participant now, by others from its next shared move. */
async function addLink(from: string, to: string, as: string) {
  const [added] = await call<{ outcome: string }>(as, sql`select outcome from app.add_work_item_link(${from}::uuid, ${to}::uuid, now())`);
  expect(added!.outcome).toBe("added");
}

/** Every kind of row of item `id`, each by its id, as a read for expectHiddenFrom. */
const rowsOf = (id: string): Record<string, (as: string) => Promise<{ id: string }[]>> => ({
  item: (as) => call(as, sql<{ id: string }>`select id from work_item where id = ${id}::uuid`),
  events: (as) => call(as, sql<{ id: string }>`select id from work_item_event where work_item_id = ${id}::uuid`),
  steps: (as) => call(as, sql<{ id: string }>`select id from step_assignment where work_item_id = ${id}::uuid`),
  documents: (as) => call(as, sql<{ id: string }>`select id from document where work_item_id = ${id}::uuid`),
  links: (as) => call(as, sql<{ id: string }>`select id from app.work_item_links(${id}::uuid)`),
  stage: async (as) => ((await stepAsSeen(as, id)) ? [{ id }] : []),
});
/**
 * Each kind of row of item `id` (`kinds`, all when left out) that `seenBy` reads, it must read at least one of, and none
 * of them does any of `hiddenFrom` read (RP-1095): an empty read can't pass for a row that was never there.
 */
async function hiddenWhole(id: string, seenBy: string, hiddenFrom: string[], label: string, kinds?: string[]) {
  for (const [kind, read] of Object.entries(rowsOf(id))) {
    if (kinds && !kinds.includes(kind)) continue;
    const targets = (await read(seenBy)).map((r) => r.id);
    expect(targets.length, `${label}: ${kind} has a row ${seenBy} reads`).toBeGreaterThan(0);
    for (const target of targets) await expectHiddenFrom({ read, target, seenBy, hiddenFrom, label: `${label}, ${kind}` });
  }
}

/** K1's engineer's Snag, raised on C1: Open, in C1's Step Pool; with `photo` and `linkTo`, a photo and a Link K1 gave the Draft. */
async function raised(title: string, { photo = false, linkTo }: { photo?: boolean; linkTo?: string } = {}): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    k1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, 'SNG', ${title}, app.latest_form_version('SNG'), ${JSON.stringify({ description: title })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  if (photo) await addPhoto(k1.member, id);
  if (linkTo) await addLink(id, linkTo, k1.member);
  expect(await take(k1.member, id, "raise")).toBe("applied");
  return id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  k2 = await company(engineer, "K2");
  c1Pm = await member(c1.id, "pm");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'SGT', 'contractor')`,
  );
  projectId = created!.project_id;
  participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
    k2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k2.cr, role: "consultant" }, k2.ap),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  buildingB = await value("location", "BB");
  buildingC = await value("location", "BC");
  const locations: Partial<Record<string, string[]>> = { [participant.c2]: [buildingB], [participant.k2]: [buildingB, buildingC] };
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      const only = kind === "location" ? locations[p] : undefined;
      expect(
        await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, ${!only}, ${only ?? []}::uuid[], now()) as outcome`),
      ).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [c2, participant.c2, c2.member, ["engineer"]],
    [k2, participant.k2, k2.member, ["engineer"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a Consultant's Snag reaches exactly K1 and C1", () => {
  it("RP-90-1: C2, another Contractor of the same Trade, reads no item, Link, event, Document, Step or count of it", async () => {
    // With K1's photo, and below a Link to another of K1's Snags, so every kind of row exists.
    const id = await raised("Cable tray not bonded", { photo: true, linkTo: await raised("Cable tray not bonded, bay 2") });
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "start_work")).toBe("applied");

    expect(await seen(c1.member, id)).toEqual([id]);
    await hiddenWhole(id, k1.member, [c2.member], "RP-90-1 as K1");
    await hiddenWhole(id, c1.member, [c2.member], "RP-90-1 as C1");
  });

  it("RP-90-2: C1 never reads K1's internal events, nor K1 C1's: each reads the other's shared Transitions only", async () => {
    const id = await raised("Rubbish on floor 3");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "start_work")).toBe("applied");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "resolve_in_progress", { resolution_note: "Cleared" })).toBe("applied");
    // K1's engineer, the only one who can verify it, holds Verify at once: an internal event of K1's.

    const own = await events(k1.member, id);
    expect(own.some((e) => e.audience === "internal" && e.actor_participant_id === participant.k1)).toBe(true);
    // Each reads the other's events as the shared Transitions only: K1 C1's Resolve, never its moves or pick-ups.
    const other = async (who: string, of: string) => (await events(who, id)).filter((e) => e.actor_participant_id === of);
    expect(await other(k1.member, participant.c1)).toEqual([
      { type: "transition", audience: "shared", actor_participant_id: participant.c1, transition: "Resolve" },
    ]);
    expect(await other(c1.member, participant.k1)).toEqual([
      { type: "transition", audience: "shared", actor_participant_id: participant.k1, transition: "Raise" },
    ]);
  });

  it("RP-90-3: C1's Step Age restarts at each move inside C1; K1 counts it from the Raise and sees the Snag Open", async () => {
    const id = await raised("Slab level");
    const atRaise = (await stepAsSeen(k1.member, id))!;
    expect(atRaise.stage_key).toBe("open");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "start_work")).toBe("applied");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "put_on_hold_in_progress")).toBe("applied");

    const inside = (await stepAsSeen(c1.member, id))!;
    expect(inside.stage_key).toBe("on_hold");
    expect(inside.entered_at.getTime()).toBeGreaterThan(atRaise.entered_at.getTime());
    expect(await stepAsSeen(k1.member, id)).toEqual(atRaise);
  });
});

// RP-622 (SNAG-2): the Snag's Draft and Verify are held by the raiser. C1 raises a Snag on
// itself: Open is of its own role, so C1 holds every Step (workflow-engine.md §3.1).
describe("a Contractor's Snag on itself reaches no other Company (RP-622)", () => {
  /** C1's PM's Draft Snag on Building A. */
  async function drafted(title: string): Promise<string> {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1Pm,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'SNG', ${title}, app.latest_form_version('SNG'), ${JSON.stringify({ description: title })}::jsonb,
        ${electrical}::uuid, ${buildingA}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    return created!.work_item_id;
  }
  /** C1's PM takes `transition` and holds the Step it leads to. */
  async function move(id: string, transition: string, answers: object = {}) {
    expect(await take(c1Pm, id, transition, answers)).toBe("applied");
    await pickUp(c1Pm, id);
  }
  /** What `others` (K1 and C2) read of item `id`: none of its row, events, Steps, Documents, Links or raiser. */
  async function readByOthers(id: string, others = [k1.member, c2.member]) {
    const reads = [];
    for (const who of others) {
      reads.push(
        await seen(who, id),
        await events(who, id),
        await call(who, sql<{ id: string }>`select id from step_assignment where work_item_id = ${id}::uuid`),
        await call(who, sql<{ id: string }>`select id from document where work_item_id = ${id}::uuid`),
        await call(who, sql<{ to_id: string }>`select * from app.work_item_links(${id}::uuid)`),
        await stepAsSeen(who, id),
        (await call<{ role: string | null }>(who, sql`select app.work_item_raiser_role(${id}::uuid) as role`))[0]!.role,
      );
    }
    return reads;
  }
  const nothing = [[], [], [], [], [], undefined, null];

  it("RP-622-1: its Draft, Open, moves, Verify and Close are C1's alone: C2 reads none of it at any Step, K1 none of its Draft", async () => {
    const id = await drafted("Missing fire stopping");
    // A photo and a Link on the Draft, so a read of them can fail (RP-1095); a Draft has no events yet.
    await addPhoto(c1Pm, id);
    await addLink(id, await raised("Missing fire stopping, linked"), c1Pm);
    expect(await readByOthers(id)).toEqual([...nothing, ...nothing]);
    await hiddenWhole(id, c1Pm, [k1.member, c2.member], "RP-622-1 Draft", ["item", "steps", "documents", "links", "stage"]);
    // From the Raise the Consultant is informed (RP-625, below); C2 never reads it.
    await move(id, "raise");
    expect((await stepAsSeen(c1.member, id))!.stage_key).toBe("open");
    expect(await readByOthers(id, [c2.member])).toEqual(nothing);
    await hiddenWhole(id, c1Pm, [c2.member], "RP-622-1 Open");
    await move(id, "start_work");
    await move(id, "put_on_hold_in_progress");
    expect(await readByOthers(id, [c2.member])).toEqual(nothing);
    await hiddenWhole(id, c1Pm, [c2.member], "RP-622-1 On Hold");
    await move(id, "resolve_on_hold", { resolution_note: "Sealed" });
    expect((await stepAsSeen(c1.member, id))!.stage_key).toBe("resolved");
    expect(await readByOthers(id, [c2.member])).toEqual(nothing);
    await hiddenWhole(id, c1Pm, [c2.member], "RP-622-1 Verify");
    expect(await take(c1Pm, id, "close")).toBe("applied");
    expect(await readByOthers(id, [c2.member])).toEqual(nothing);
    await hiddenWhole(id, c1Pm, [c2.member], "RP-622-1 Closed");
    // C1 reads it whole, every event its own.
    expect(await seen(c1.member, id)).toEqual([id]);
    expect((await events(c1.member, id)).every((e) => e.actor_participant_id === participant.c1)).toBe(true);
  });

  it("RP-622-2: the raiser's role is read by those who see the item only: C1 of its own Snag, K1 and C1 of K1's", async () => {
    const own = await drafted("Raiser role of C1's Snag");
    const k1s = await raised("Raiser role of K1's Snag");
    const role = async (who: string, id: string) => (await call<{ role: string | null }>(who, sql`select app.work_item_raiser_role(${id}::uuid) as role`))[0]!.role;
    expect(await role(c1.member, own)).toBe("contractor");
    expect(await role(k1.member, own)).toBeNull(); // A Draft: K1 is informed only by its Raise (RP-625).
    expect(await role(k1.member, k1s)).toBe("consultant");
    expect(await role(c1.member, k1s)).toBe("consultant");
    expect(await role(c2.member, k1s)).toBeNull();
  });

  it("RP-622-3: K1's Snag Returned to Open from its Verify goes back to C1, which resolved it, and C2 still reads nothing", async () => {
    const id = await raised("Returned by K1");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "resolve", { resolution_note: "Done" })).toBe("applied");
    expect(await take(k1.member, id, "return_to_open", { reason: "Not done" })).toBe("applied");
    expect((await stepAsSeen(c1.member, id))!.stage_key).toBe("open");
    expect(await call(c1.member, sql<{ participant_id: string }>`select participant_id from step_assignment where work_item_id = ${id}::uuid and status <> 'done'`)).toEqual([
      { participant_id: participant.c1 },
    ]);
    expect(await seen(c2.member, id)).toEqual([]);
  });

  it("app.step_as_seen's holder_role at K1's Verify, a Step held by the raiser, is the raiser's role, and null once closed (RP-1203)", async () => {
    const id = await raised("Holder role at Verify");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "resolve", { resolution_note: "Done" })).toBe("applied");
    const holderRole = async (as: string) => (await call<{ holder_role: string | null }>(as, sql`select holder_role from app.step_as_seen(${id}::uuid)`))[0]!.holder_role;
    for (const as of [c1.member, c1Pm, k1.member]) expect(await holderRole(as), as).toBe("consultant");
    expect(await take(k1.member, id, "close")).toBe("applied");
    for (const as of [c1.member, c1Pm, k1.member]) expect(await holderRole(as), as).toBeNull();
  });
});

// RP-625 (SNAG-3): the Snag's Version 3 Raise informs the Consultant. Every active Consultant
// Participant covering the Snag gets `informed` access at the Raise and reads it as any
// Participant without the Step: its shared moves only, its Stage and Step Age from the Raise.
describe("a Contractor's raised Snag informs the covering Consultants (RP-625)", () => {
  /** C1's PM's Draft Snag on `location`. */
  async function drafted(title: string, location = buildingA): Promise<string> {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1Pm,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'SNG', ${title}, app.latest_form_version('SNG'), ${JSON.stringify({ description: title })}::jsonb,
        ${electrical}::uuid, ${location}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    return created!.work_item_id;
  }
  async function move(id: string, transition: string, answers: object = {}) {
    expect(await take(c1Pm, id, transition, answers)).toBe("applied");
    await pickUp(c1Pm, id);
  }
  const transitionLabels = async (who: string, id: string) => (await events(who, id)).map((e) => e.transition);

  it("RP-625-1: K1 reads nothing of C1's Draft; from the Raise, its shared moves only, Open until C1 resolves it, aged from the Raise", async () => {
    const id = await drafted("Exposed rebar");
    expect(await seen(k1.member, id)).toEqual([]);
    expect(await stepAsSeen(k1.member, id)).toBeUndefined();
    await hiddenWhole(id, c1Pm, [k1.member], "RP-625-1 Draft", ["item", "stage"]);

    await move(id, "raise");
    const atRaise = (await stepAsSeen(c1.member, id))!;
    expect(await seen(k1.member, id)).toEqual([id]);
    // Step Age from the Raise, never from when C1 started the Draft (V14, Creation Date).
    expect(await stepAsSeen(k1.member, id)).toEqual(atRaise);
    expect(atRaise.stage_key).toBe("open");
    expect(await transitionLabels(k1.member, id)).toEqual(["Raise"]);
    // Its answers, as they left C1.
    const [answers] = await call<{ a: { description?: string } }>(k1.member, sql`select app.work_item_answers(${id}::uuid) as a`);
    expect(answers!.a.description).toBe("Exposed rebar");

    // C1's moves inside it stay its own (V5): K1 still reads Open, aged from the Raise.
    await move(id, "start_work");
    await move(id, "put_on_hold_in_progress");
    expect((await stepAsSeen(c1.member, id))!.stage_key).toBe("on_hold");
    expect(await stepAsSeen(k1.member, id)).toEqual(atRaise);
    expect(await transitionLabels(k1.member, id)).toEqual(["Raise"]);
    // K1 holds no Step and can't move it: refused as a Transition it isn't offered.
    expect(await call(k1.member, sql<{ id: string }>`select id from step_assignment where work_item_id = ${id}::uuid`)).toEqual([]);
    expect(await take(k1.member, id, "resolve_on_hold", { resolution_note: "Not K1's" })).toBe("not_holder");

    // C1's Resolve is shared: K1 reads it, and the Snag Resolved from then.
    await move(id, "resolve_on_hold", { resolution_note: "Cut back and coated" });
    const resolved = (await stepAsSeen(k1.member, id))!;
    expect(resolved.stage_key).toBe("resolved");
    expect(resolved.entered_at.getTime()).toBeGreaterThan(atRaise.entered_at.getTime());
    expect(await transitionLabels(k1.member, id)).toEqual(["Raise", "Resolve"]);
    expect(await take(c1Pm, id, "close")).toBe("applied");
    expect(await transitionLabels(k1.member, id)).toEqual(["Raise", "Resolve", "Close"]);
    // C2 never reads it (V3).
    expect(await seen(c2.member, id)).toEqual([]);
    expect(await events(c2.member, id)).toEqual([]);
  });

  it("RP-625-1: K1 reads its Documents as they left C1 at the Raise: the Draft's photo, frozen, and nothing added after", async () => {
    const id = await drafted("Cracked tile");
    const [started] = await call<{ outcome: string; document_id: string }>(
      c1Pm,
      sql`select outcome, document_id from app.start_document_upload(${id}::uuid, 'before.jpg', 10, 'image/jpeg', now(), 'photos')`,
    );
    expect(started!.outcome).toBe("started");
    const fingerprint = createHash("sha256").update("before.jpg", "utf8").digest();
    expect(
      await outcome(c1Pm, sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 10, 'image/jpeg', ${fingerprint}, now()) as outcome`),
    ).toBe("confirmed");
    const documents = (who: string) => call<{ id: string; frozen: boolean }>(who, sql`select id, frozen_at is not null as frozen from document where work_item_id = ${id}::uuid`);
    expect(await documents(k1.member)).toEqual([]);

    await move(id, "raise");
    expect(await documents(k1.member)).toEqual([{ id: started!.document_id, frozen: true }]);
    // Nobody adds to them once they have reached another Company (ADR 0020).
    const [after] = await call<{ outcome: string }>(c1Pm, sql`select outcome from app.start_document_upload(${id}::uuid, 'after.jpg', 10, 'image/jpeg', now(), 'photos')`);
    expect(after!.outcome).not.toBe("started");
    expect(await documents(k1.member)).toEqual([{ id: started!.document_id, frozen: true }]);
  });

  it("RP-625-1: Need My Action never counts it for K1", async () => {
    const id = await drafted("Need My Action");
    await move(id, "raise");
    const [nma] = await call<{ state: string | null }>(k1.member, sql`select app.need_my_action(${id}::uuid) as state`);
    expect(nma!.state).toBeNull();
  });

  it("RP-625-2: only Consultants covering it are informed: K2 (Buildings B and C) not of a Snag on Building A, both K1 and K2 of one on Building C", async () => {
    const onA = await drafted("Loose cable on A");
    await move(onA, "raise");
    expect(await seen(k1.member, onA)).toEqual([onA]);
    expect(await seen(k2.member, onA)).toEqual([]);
    expect(await events(k2.member, onA)).toEqual([]);

    const onC = await drafted("Loose cable on C", buildingC);
    await move(onC, "raise");
    expect(await seen(k1.member, onC)).toEqual([onC]);
    expect(await seen(k2.member, onC)).toEqual([onC]);
    expect(await transitionLabels(k2.member, onC)).toEqual(["Raise"]);
  });

  it("RP-625-3: narrowing an informed Member's Visibility off the Snag hides it at once (layer 4)", async () => {
    const id = await drafted("Missing label", buildingC);
    await move(id, "raise");
    expect(await seen(k2.member, id)).toEqual([id]);
    // K2's engineer narrowed to Building B: the Snag on Building C is gone, as for oversight.
    expect(await outcome(k2.ap, sql`select app.set_member_visibility(${participant.k2}::uuid, ${k2.member}::uuid, 'location', false, ${[buildingB]}::uuid[], now()) as outcome`)).toBe("set");
    expect(await seen(k2.member, id)).toEqual([]);
    expect(await events(k2.member, id)).toEqual([]);
    expect(await stepAsSeen(k2.member, id)).toBeUndefined();
    expect(await seen(k1.member, id)).toEqual([id]);
    // Widened again, it reads it again: its access was never taken away.
    expect(await outcome(k2.ap, sql`select app.set_member_visibility(${participant.k2}::uuid, ${k2.member}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    expect(await seen(k2.member, id)).toEqual([id]);
  });

  it("RP-625-4: a Consultant's own raise informs no other Consultant (V3): K2, covering Building C, never reads K1's Snag there", async () => {
    const id = await raisedOn("K1's Snag on C", buildingC);
    expect(await seen(k1.member, id)).toEqual([id]);
    expect(await seen(c1.member, id)).toEqual([id]);
    expect(await seen(k2.member, id)).toEqual([]);
    expect(await seen(c2.member, id)).toEqual([]);
  });
});

describe("a Snag two Contractors cover: the raiser picks one (RP-658)", () => {
  /** K1's engineer takes the Raise of `id`, picking `pick` (none when null). */
  const raise = (id: string, pick: string | null) =>
    outcome(
      k1.member,
      sql`select app.take_transition(${id}::uuid, 'raise', '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now(),
        p_participant => ${pick}::uuid) as outcome`,
    );
  const offered = (as: string, id: string) =>
    call<{ participant_id: string; company_name: { en: string } }>(
      as,
      sql`select o.participant_id, o.company_name from app.participants_offered(${id}::uuid,
        (select tr.id from work_item w join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.key = 'raise'
         where w.id = ${id}::uuid)) o order by o.company_name ->> 'en'`,
    );
  async function drafted(title: string): Promise<string> {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      k1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'SNG', ${title}, app.latest_form_version('SNG'), ${JSON.stringify({ description: title })}::jsonb,
        ${electrical}::uuid, ${buildingB}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    return created!.work_item_id;
  }

  it("offers the raiser C1 and C2 by Company name only, and nobody else any", async () => {
    const id = await drafted("Two Contractors on B");
    expect(await offered(k1.member, id)).toEqual([
      { participant_id: participant.c1, company_name: { en: "C1", ar: "C1" } },
      { participant_id: participant.c2, company_name: { en: "C2", ar: "C2" } },
    ]);
    for (const other of [c1.member, c2.member, k2.member]) expect(await offered(other, id), other).toEqual([]);
  });

  it("refuses a Raise without a pick, and one picking K2 or a made-up id alike", async () => {
    const id = await drafted("No pick on B");
    expect(await raise(id, null)).toBe("participant_not_picked");
    for (const pick of [participant.k2, participant.k1, randomUUID()]) expect(await raise(id, pick), pick).toBe("participant_not_offered");
    // Still K1's Draft: K1 reads it, neither Contractor does.
    await expectHiddenFrom({ read: rowsOf(id).item!, target: id, seenBy: k1.member, hiddenFrom: [c1.member, c2.member], label: "unraised" });
  });

  it("RP-658-1: raised with a pick of C1, C2, covering it too, reads no item, event, Document, Step or Link of it", async () => {
    const other = await drafted("C1 picked on B, bay 2");
    expect(await raise(other, participant.c1)).toBe("applied");
    const id = await drafted("C1 picked on B");
    // A photo and a Link to another of the same Snags on the Draft, so every kind of row exists.
    await addPhoto(k1.member, id);
    await addLink(id, other, k1.member);
    expect(await raise(id, participant.c1)).toBe("applied");
    await hiddenWhole(id, c1.member, [c2.member], "RP-658-1");
    expect(await offered(c2.member, id)).toEqual([]);
  });
});

/** K1's engineer's Snag on `location`, raised on the one Contractor covering it. */
async function raisedOn(title: string, location: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    k1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, 'SNG', ${title}, app.latest_form_version('SNG'), ${JSON.stringify({ description: title })}::jsonb,
      ${electrical}::uuid, ${location}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  expect(await take(k1.member, created!.work_item_id, "raise")).toBe("applied");
  return created!.work_item_id;
}
