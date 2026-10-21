// Seam 2 for the Snag List scenarios tested over HTTP only until RP-1002 (spec RP-619; visibility.md V3, V5,
// V14, V19, E1, "Lists and counts", and scenarios RP-90-4, RP-94-1, RP-624-1, RP-624-2, RP-629-1 and RP-630-1),
// as the app role, on the Tower (buildSeamTwoTower).
//
// C1 covers Building A only here, C2 Building B (V3), so each Snag goes to one Contractor; K1, the Consultant,
// raises them. C3 (RP-90-4) is a third Contractor of the same Trade, covering Building C until it is widened.
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, digits, joinProject, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower<{ otherProject: true }>;
let call: SeamTwoTower["call"];
let outcome: SeamTwoTower["outcome"];
let take: SeamTwoTower["take"];
let pickUp: SeamTwoTower["pickUp"];

let c1Pm = "";
let c1Engineer = "";
let k1 = ""; // K1's Engineer, its only Member: holds each of K1's Steps as it arrives.
let c2 = ""; // C2's Engineer.
let outsider = ""; // The Authorized Person of a Company on another Project only (layer 1).
let electrical = "";
let buildingA = "";
let buildingB = "";

const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;
const newMember = (companyId: string, who: string) =>
  one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [companyId, email(who), JSON.stringify(bilingual(who))]);
const set = (what: string, result: Promise<string>, wanted = "set") => result.then((got) => expect(got, what).toBe(wanted));
const dimensionValue = async (kind: string, code: string) =>
  (
    await call<{ value_id: string }>(
      tower.c1.ap,
      sql`select value_id from app.add_dimension_value(${tower.projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify(bilingual(code))}::jsonb)`,
    )
  )[0]!.value_id;
/** Participant `p`'s Visibility of `kind`: all, or only `values`; set by C1's Authorized Person, the Project's Admin. */
const participantCovers = (p: string, kind: string, values: string[] | "all") =>
  set(
    `${kind} of ${p}`,
    outcome(tower.c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, ${values === "all"}, ${values === "all" ? [] : values}::uuid[], now()) as outcome`),
  );
/** Puts Member `m` on Participant `p` (its Company's Admin `admin`), with `positions` and the Trades `trades` (all by default). */
async function onProject(admin: string, p: string, m: string, positions: string[], trades: string[] | "all" = "all") {
  await call(admin, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
  await set("trade", outcome(admin, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, 'trade', ${trades === "all"}, ${trades === "all" ? [] : trades}::uuid[], now()) as outcome`));
  await set("location", outcome(admin, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`));
  await set("positions", outcome(admin, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`));
}

const seen = async (as: string, id: string) => (await call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`)).map((r) => r.id);
const events = (as: string, id: string) =>
  call<{ type: string; audience: string; actor_participant_id: string }>(
    as,
    sql`select type, audience, actor_participant_id from work_item_event where work_item_id = ${id}::uuid order by seq`,
  );
const stepAsSeen = async (as: string, id: string) =>
  (await call<{ stage_key: string; entered_at: Date }>(as, sql`select stage_key, entered_at from app.step_as_seen(${id}::uuid)`))[0];
/** Everything `as` reads of item `id` through the tables and the List's functions: none of it, for an item it does not see. */
const readsOf = async (as: string, id: string) => ({
  row: await seen(as, id),
  events: await events(as, id),
  steps: await call(as, sql<{ id: string }>`select id from step_assignment where work_item_id = ${id}::uuid`),
  documents: await call(as, sql<{ id: string }>`select id from document where work_item_id = ${id}::uuid`),
  links: await call(as, sql<{ id: string }>`select id from app.work_item_links(${id}::uuid)`),
  companies: await call(as, sql<{ participant_id: string }>`select participant_id from app.work_item_companies(${id}::uuid)`),
  holder: await call(as, sql<{ participant_id: string }>`select participant_id from app.work_item_holder(${id}::uuid)`),
  photos: await call(as, sql<{ document_id: string }>`select document_id from app.document_times(${id}::uuid)`),
  counts: await call(as, sql<{ type_code: string }>`select type_code from app.work_item_raised_item_counts(${id}::uuid)`),
  stage: await stepAsSeen(as, id),
});
const nothing = { row: [], events: [], steps: [], documents: [], links: [], companies: [], holder: [], photos: [], counts: [], stage: undefined };
/** The Snag List's rows `as` reads on the Tower's Project: the List, the Kanban and the export read these alone. */
const listed = async (as: string) =>
  (await call<{ id: string }>(as, sql`select id from work_item where project_id = ${tower.projectId}::uuid order by id`)).map((r) => r.id);

/** K1's Draft Snag on `location` (Building A by default), of `trade` (Electrical by default). */
async function draft(title: string, { location = buildingA, trade = electrical } = {}): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    k1,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, 'SNG', ${title}, app.latest_form_version('SNG'), ${JSON.stringify({ description: title })}::jsonb,
      ${trade}::uuid, ${location}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

/** K1's Snag, raised on the one Contractor covering it. */
async function raised(title: string, options: { location?: string; trade?: string } = {}): Promise<string> {
  const id = await draft(title, options);
  expect(await take(k1, id, "raise")).toBe("applied");
  return id;
}

/** A confirmed photo K1 adds to its Draft `id`. */
async function photo(id: string): Promise<string> {
  const [started] = await call<{ outcome: string; document_id: string }>(
    k1,
    sql`select outcome, document_id from app.start_document_upload(${id}::uuid, 'before.jpg', 10, 'image/jpeg', now(), 'photos')`,
  );
  expect(started!.outcome).toBe("started");
  const fingerprint = createHash("sha256").update(`before-${id}`, "utf8").digest();
  expect(await outcome(k1, sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 10, 'image/jpeg', ${fingerprint}, now()) as outcome`)).toBe(
    "confirmed",
  );
  return started!.document_id;
}

/**
 * Links `from` to `source` as raised from it, as a Code B's Comment or a check item's Snag is: made with `from`
 * itself, in its Draft (arrival 0, at its creation). A Link added later, while a Participant holds the item, is
 * that Participant's alone until the item leaves it (V19).
 */
async function raiseFrom(from: string, source: string): Promise<void> {
  const { rows } = await migrator.query(
    `insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
     select s.project_id, f.id, s.id, 'raised_from', f.created_by_member_id, f.created_at
     from work_item s, work_item f where s.id = $2 and f.id = $1 returning id`,
    [from, source],
  );
  await migrator.query("update work_item_link set arrival = 0 where id = $1", [rows[0].id]);
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RSL", otherProject: true, checklistTemplate: false });
  ({ call, outcome, take, pickUp, tradeId: electrical, buildingA, buildingB } = tower);
  c1Pm = tower.c1.members.project_manager;
  c1Engineer = tower.c1.members.engineer;
  k1 = tower.k1.members.engineer;
  c2 = tower.c2.members.engineer;
  outsider = tower.other.ap;
  // C1 covers Building A only: each Snag has one Contractor to go to.
  await participantCovers(tower.c1.participantId, "location", [buildingA]);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a Snag raised on C1 stays with C1 when C3 is widened over it (scenario RP-90-4)", () => {
  let c3Participant = "";
  let c3 = ""; // C3's Engineer.
  let buildingC = "";

  beforeAll(async () => {
    buildingC = await dimensionValue("location", "BC");
    const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
    const cr = digits(10);
    const companyId = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
      JSON.stringify(bilingual("C3")),
      cr,
      `3${digits(13)}3`,
      engineer,
    ]);
    const ap = await newMember(companyId, "ap");
    await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, companyId]);
    c3Participant = await joinProject(app, tower.projectId, { adminId: tower.c1.ap, crNumber: cr, role: "contractor" }, ap);
    await participantCovers(c3Participant, "trade", "all");
    await participantCovers(c3Participant, "location", [buildingC]);
    c3 = await newMember(companyId, "engineer");
    await onProject(ap, c3Participant, c3, ["engineer"]);
  });

  it("RP-90-4: every move, the Resolve and K1's Return keep the Steps with C1; C3 reads no row, event, Step, Document, Link or Stage of it", async () => {
    const id = await raised("Overlap after the Raise");
    await participantCovers(c3Participant, "location", "all");
    try {
      const openSteps = () => call<{ participant_id: string }>(c1Pm, sql`select participant_id from step_assignment where work_item_id = ${id}::uuid and status <> 'done'`);
      expect(await pickUp(c1Pm, id)).toBe("picked_up");
      for (const transition of ["start_work", "put_on_hold_in_progress", "resume", "back_to_open"]) {
        expect(await take(c1Pm, id, transition), transition).toBe("applied");
        await pickUp(c1Pm, id);
        expect(await openSteps(), transition).toEqual([{ participant_id: tower.c1.participantId }]);
        expect(await readsOf(c3, id), transition).toEqual(nothing);
      }
      expect(await take(c1Pm, id, "resolve", { resolution_note: "Done" })).toBe("applied");
      expect(await readsOf(c3, id), "resolved").toEqual(nothing);
      expect(await take(k1, id, "return_to_open", { reason: "Not yet" })).toBe("applied");
      expect(await openSteps()).toEqual([{ participant_id: tower.c1.participantId }]);
      expect((await stepAsSeen(c1Pm, id))!.stage_key).toBe("open");
      expect(await readsOf(c3, id), "returned").toEqual(nothing);
      expect(await listed(c3)).not.toContain(id);
      // Positive control: C3 reads a Snag raised on it (Building C, which C1 does not cover).
      const onC = await raised("C3's own", { location: buildingC });
      expect(await seen(c3, onC)).toEqual([onC]);
    } finally {
      await participantCovers(c3Participant, "location", [buildingC]);
    }
  });
});

describe("C2's Snag List names and counts none of C1's items (scenario RP-94-1)", () => {
  let source = ""; // C1's source item.
  let sourceNumber = "";
  let comment = ""; // A C1 Snag raised from it.
  let photographed = ""; // A C1 Snag with a photo.
  let photoId = "";
  let c2Snag = "";

  beforeAll(async () => {
    source = await raised("Lighting fixtures");
    sourceNumber = (await migrator.query("select document_number from work_item where id = $1", [source])).rows[0].document_number as string;
    comment = await raised("Provide the IP65 certificate");
    await raiseFrom(comment, source);
    photographed = await draft("Cable tray not bonded");
    photoId = await photo(photographed);
    expect(await take(k1, photographed, "raise")).toBe("applied");
    c2Snag = await raised("Paint drips on skirting", { location: buildingB });
  });

  it("RP-94-1: C2's rows, type counts and Stage counts hold its own Snag only", async () => {
    const mine = [c2Snag];
    expect((await listed(c2)).filter((id) => [source, comment, photographed, c2Snag].includes(id))).toEqual(mine);
    const byType = await call<{ code: string; n: number }>(
      c2,
      sql`select t.code, count(*)::int as n from work_item w join work_item_type t on t.id = w.work_item_type_id
          where w.project_id = ${tower.projectId}::uuid group by t.code order by t.code`,
    );
    expect(byType).toEqual([{ code: "SNG", n: 1 }]);
    const byStage = await call<{ stage_key: string; n: number }>(
      c2,
      sql`select s.stage_key, count(*)::int as n from work_item w cross join lateral app.step_as_seen(w.id) s
          where w.project_id = ${tower.projectId}::uuid group by s.stage_key`,
    );
    expect(byStage).toEqual([{ stage_key: "open", n: 1 }]);
  });

  it("RP-94-1: no read names C1's items, their source's number or C1's Participant; Company and Raised from offer C1 nothing", async () => {
    for (const id of [source, comment, photographed]) expect(await readsOf(c2, id), id).toEqual(nothing);
    const companies = await call<{ participant_id: string }>(
      c2,
      sql`select distinct hc.participant_id from work_item w cross join lateral app.work_item_holder(w.id) h
          join lateral app.work_item_companies(w.id) hc on hc.participant_id = h.participant_id
          where w.project_id = ${tower.projectId}::uuid`,
    );
    expect(companies).toEqual([{ participant_id: tower.c2.participantId }]);
    const sources = await call<{ document_number: string }>(
      c2,
      sql`select l.document_number from work_item w cross join lateral app.work_item_links(w.id) l
          where w.project_id = ${tower.projectId}::uuid and l.kind = 'raised_from'`,
    );
    expect(sources).toEqual([]);
  });

  it("RP-94-1: filtering by C1's source, by C1 or by the photo finds nothing and counts nothing", async () => {
    const bySource = await call<{ id: string }>(
      c2,
      sql`select w.id from work_item w where w.project_id = ${tower.projectId}::uuid
          and exists (select 1 from app.work_item_links(w.id) l where l.kind = 'raised_from' and l.document_number = ${sourceNumber})`,
    );
    expect(bySource).toEqual([]);
    const byCompany = await call<{ id: string }>(
      c2,
      sql`select w.id from work_item w cross join lateral app.work_item_holder(w.id) h
          where w.project_id = ${tower.projectId}::uuid and h.participant_id = ${tower.c1.participantId}::uuid`,
    );
    expect(byCompany).toEqual([]);
    expect(await call(c2, sql<{ id: string }>`select id from document where id = ${photoId}::uuid`)).toEqual([]);
  });

  it("RP-94-1: the Raised from source is given by Document Number and Subject, and the thumbnail is the first photo, to those who see them (E1, V19)", async () => {
    for (const reader of [c1Pm, k1]) {
      const links = await call<{ kind: string; document_number: string; subject: string; work_item_id: string }>(
        reader,
        sql`select kind, document_number, subject, work_item_id from app.work_item_links(${comment}::uuid) where kind = 'raised_from'`,
      );
      expect(links, reader).toEqual([{ kind: "raised_from", document_number: sourceNumber, subject: "Lighting fixtures", work_item_id: source }]);
      const photos = await call<{ document_id: string }>(reader, sql`select t.document_id from app.document_times(${photographed}::uuid) t order by t.seq`);
      expect(photos.map((p) => p.document_id), reader).toEqual([photoId]);
    }
  });
});

describe("the raised-from counts follow what the viewer sees (scenarios RP-624-1, RP-624-2)", () => {
  const counts = (as: string, id: string) =>
    call<{ type_code: string; open_count: number; closed_count: number }>(as, sql`select type_code, open_count, closed_count from app.work_item_raised_item_counts(${id}::uuid)`);

  it("RP-624-1: C2 counts only the Snag it sees of the two raised from a source it sees; C1's is neither counted nor read", async () => {
    const source = await raised("Stair B", { location: buildingB });
    const forC1 = await raised("Stair B: C1's side");
    const forC2 = await raised("Stair B: C2's side", { location: buildingB });
    await raiseFrom(forC1, source);
    await raiseFrom(forC2, source);
    expect(await counts(c2, source)).toEqual([{ type_code: "SNG", open_count: 1, closed_count: 0 }]);
    expect(await readsOf(c2, forC1)).toEqual(nothing);
    // K1 raised and sees all three.
    expect(await counts(k1, source)).toEqual([{ type_code: "SNG", open_count: 2, closed_count: 0 }]);
    // C1 does not see the source itself: it counts nothing of it.
    expect(await counts(c1Pm, source)).toEqual([]);
  });

  it("RP-624-2: C1's PM counts both Snags raised from a source; an Electrical-only engineer counts the one it sees; a discarded Draft is never counted", async () => {
    const mechanical = await dimensionValue("trade", `ME${digits(3)}`);
    const electricalOnly = await newMember(tower.c1.id, "electrical-only");
    await onProject(tower.c1.ap, tower.c1.participantId, electricalOnly, ["engineer"], [electrical]);

    const source = await raised("Level 2");
    const sockets = await raised("Level 2: sockets");
    const ducts = await raised("Level 2: ducts", { trade: mechanical });
    await raiseFrom(sockets, source);
    await raiseFrom(ducts, source);
    expect(await counts(c1Pm, source)).toEqual([{ type_code: "SNG", open_count: 2, closed_count: 0 }]);
    expect(await counts(electricalOnly, source)).toEqual([{ type_code: "SNG", open_count: 1, closed_count: 0 }]);
    expect(await readsOf(electricalOnly, ducts)).toEqual(nothing);

    const discarded = await draft("Level 2: paint");
    await raiseFrom(discarded, source);
    expect(await counts(k1, source)).toEqual([{ type_code: "SNG", open_count: 3, closed_count: 0 }]); // K1's own Draft.
    expect(await outcome(k1, sql`select app.discard_draft(${discarded}::uuid, now()) as outcome`)).toBe("discarded");
    expect(await counts(k1, source)).toEqual([{ type_code: "SNG", open_count: 2, closed_count: 0 }]);
    expect(await counts(c1Pm, source)).toEqual([{ type_code: "SNG", open_count: 2, closed_count: 0 }]);
  });
});

describe("the Snag List's bulk actions and export (scenario RP-629-1)", () => {
  let first = "";
  let second = "";
  let c2Snag = "";
  const candidates = async (as: string, id: string) =>
    (await call<{ member_id: string }>(as, sql`select member_id from app.reassign_candidates(${id}::uuid)`)).map((r) => r.member_id);
  const reassign = (as: string, id: string, to: string) => outcome(as, sql`select app.reassign_step(${id}::uuid, ${to}::uuid, now()) as outcome`);
  const holder = (id: string) => call<{ assignee_member_id: string }>(c1Pm, sql`select assignee_member_id from app.work_item_holder(${id}::uuid)`);
  /** The Transitions `as` is offered on `id` and the Stage each leads to: what Move Stage takes. */
  const moves = (as: string, id: string) =>
    call<{ transition_key: string; stage_key: string }>(
      as,
      sql`select a.transition_key, ts.stage_key from app.work_item_actions(${id}::uuid) a
          join work_item w on w.id = ${id}::uuid
          join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.key = a.transition_key
          join workflow_step ts on ts.id = tr.to_step_id
          where a.action = 'transition' order by a.transition_key`,
    );

  beforeAll(async () => {
    first = await raised("Cable tray not bonded");
    second = await raised("Duct insulation torn");
    c2Snag = await raised("Paint drips on skirting", { location: buildingB });
    expect(await pickUp(c1Pm, first)).toBe("picked_up");
    expect(await pickUp(c1Pm, second)).toBe("picked_up");
  });

  it("RP-629-1: Reassign offers the holder's own Participant's Members only, and nobody to K1, C2 or an outsider", async () => {
    const offered = await candidates(c1Pm, first);
    expect(offered).toContain(c1Engineer);
    expect(offered).not.toContain(c2);
    expect(offered).not.toContain(k1);
    for (const other of [k1, c2, outsider]) expect(await candidates(other, first), other).toEqual([]);
    // C2 is offered its own Snag's pool, never C1's Members.
    expect(await candidates(c2, c2Snag)).not.toContain(c1Engineer);
  });

  it("RP-629-1: a pick of C2's engineer is refused whoever asks, an item the asker does not see is not_found, and nothing changes", async () => {
    expect(await reassign(c1Pm, first, c2)).toBe("not_offered");
    expect(await reassign(k1, first, c1Engineer)).not.toBe("reassigned");
    expect(await reassign(c2, first, c1Engineer)).toBe("not_found");
    expect(await reassign(outsider, first, c1Engineer)).toBe("not_found");
    expect(await holder(first)).toEqual([{ assignee_member_id: c1Pm }]);
  });

  it("RP-629-1: the reassign is an internal event of C1's: K1's history never shows it", async () => {
    expect(await reassign(c1Pm, second, c1Engineer)).toBe("reassigned");
    expect(await holder(second)).toEqual([{ assignee_member_id: c1Engineer }]);
    expect((await events(c1Pm, second)).filter((e) => e.type === "assigned")).toEqual([
      { type: "assigned", audience: "internal", actor_participant_id: tower.c1.participantId },
    ]);
    expect((await events(k1, second)).map((e) => e.type)).not.toContain("assigned");
    expect((await events(k1, second)).every((e) => e.audience === "shared")).toBe(true);
  });

  it("RP-629-1: Move Stage is offered only the holder's own Transitions, per Stage; K1, C2 and an outsider are offered none", async () => {
    expect((await moves(c1Pm, first)).map((m) => m.stage_key).sort()).toEqual(["in_progress", "on_hold", "resolved"]);
    for (const other of [k1, c1Engineer, c2, outsider]) expect(await moves(other, first), other).toEqual([]);
    expect(await call(c2, sql<{ action: string }>`select action from app.work_item_actions(${first}::uuid)`)).toEqual([]);
  });

  it("RP-629-1: the export, the List's own read, holds C2's Snag only for C2 and none of C2's for C1; an outsider reads nothing", async () => {
    const ours = [first, second, c2Snag];
    expect((await listed(c2)).filter((id) => ours.includes(id))).toEqual([c2Snag]);
    expect((await listed(c1Pm)).filter((id) => ours.includes(id)).sort()).toEqual([first, second].sort());
    expect((await listed(k1)).filter((id) => ours.includes(id)).sort()).toEqual(ours.sort());
    expect(await listed(outsider)).toEqual([]);
    // Positive control: the outsider reads its own Project.
    expect(await call(outsider, sql<{ id: string }>`select id from project where id = ${tower.other.projectId}::uuid`)).toEqual([{ id: tower.other.projectId }]);
  });
});

describe("the cards' swipe actions are the item's own Transitions (scenario RP-630-1)", () => {
  const offered = async (as: string, id: string) =>
    (await call<{ transition_key: string }>(as, sql`select transition_key from app.work_item_actions(${id}::uuid) where action = 'transition' order by transition_key`)).map(
      (r) => r.transition_key,
    );
  /** A Snag K1 raised on C1, picked up by C1's PM. */
  async function heldByPm(title: string): Promise<string> {
    const id = await raised(title);
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    return id;
  }

  it("RP-630-1: C1's PM, holding it, is offered Start work, Put on hold and Resolve, each taken without a refusal", async () => {
    const keys = await offered(c1Pm, await heldByPm("Missing cable labels"));
    expect(keys).toEqual(["put_on_hold", "resolve", "start_work"]);
    for (const key of keys) {
      const id = await heldByPm(`Swipe ${key}`);
      expect(await take(c1Pm, id, key, key === "resolve" ? { resolution_note: "Labelled" } : {}), key).toBe("applied");
    }
  });

  it("RP-630-1: C1's engineer (not holding it) and K1 (while C1 holds it) are offered none, and a Transition they try is refused", async () => {
    const id = await heldByPm("Ceiling tile cracked");
    expect(await offered(c1Engineer, id)).toEqual([]);
    expect(await offered(k1, id)).toEqual([]);
    expect(await take(c1Engineer, id, "start_work")).not.toBe("applied");
    expect(await take(k1, id, "close")).not.toBe("applied");
    expect((await stepAsSeen(c1Pm, id))!.stage_key).toBe("open");
  });
});
