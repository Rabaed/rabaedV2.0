// Seam 2 for Chat on a Work Item (RP-1062, spec RP-1054 decision C1; visibility.md V6 and the Chat row,
// scenarios RP-1062-1 to RP-1062-5), as the app role. Chat is read by every Participant that currently has
// access to the item, through app.work_item_chat, and written through app.post_chat_message from the
// Submission Date on. Another Company's author is read as that Company's name and Project Role only. The
// chat_message table itself is neither read nor written by the app role, and nobody changes a message.
// Each test posts the messages it reads, so it holds alone.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
// The Tower (RP-980): C1 raises, K1 reviews (an Engineer and a Manager), OW oversees, and C2 is another
// Contractor of the same Trade, covering Building B only (V3). C2 gets a Project Manager here, so it can
// Submit an item of its own: the positive control beside each refusal to C2.
let tower: SeamTwoTower<{ k1Manager: true }>;
let c2Pm = "";

/** C1's WIRs: Submitted to K1, at Building A and at Building B; one still in C1's internal review; and C2's own. */
const item = { c1AtA: "", c1AtB: "", c1Internal: "", c2AtB: "" };

type ChatRow = {
  id: string;
  author_kind: "own" | "other";
  member_name: { en: string; ar: string } | null;
  company_name: { en: string; ar: string };
  role_base: string;
  role_name: { en: string; ar: string };
  mine: boolean;
  body: string;
  at: Date;
};

/** Item `id`'s Chat as Member `as` reads it, oldest first. */
const chat = (as: string, id: string) => tower.call<ChatRow>(as, sql`select * from app.work_item_chat(${id}::uuid)`);
/** The bodies of item `id`'s Chat as `as` reads it. */
const bodies = async (as: string, id: string) => (await chat(as, id)).map((m) => m.body);
/** `as` posts `body` on item `id`; the outcome and the new message's id. */
const post = async (as: string, id: string, body: string) =>
  (await tower.call<{ outcome: string; message_id: string | null }>(as, sql`select outcome, message_id from app.post_chat_message(${id}::uuid, ${body}, now())`))[0]!;
/** `as` posts `body` on item `id`, which must be accepted; returns the body. */
async function posted(as: string, id: string, body: string): Promise<string> {
  expect((await post(as, id, body)).outcome).toBe("posted");
  return body;
}
/** `as` posts `body` on item `id`, which must be accepted; returns the new message's id. */
async function postedId(as: string, id: string, body: string): Promise<string> {
  const result = await post(as, id, body);
  expect(result.outcome).toBe("posted");
  return result.message_id!;
}
/** Message `message` on item `id` is read by each of `seenBy` first, then by none of `hiddenFrom` (RP-1095). */
const messageHidden = (id: string, message: string, seenBy: string | string[], hiddenFrom: string | string[], label: string) =>
  expectHiddenFrom({ read: (as: string) => chat(as, id), target: message, seenBy, hiddenFrom, label });
/** One character that is two UTF-16 code units (a grinning face). */
const EMOJI = "\u{1F600}";
/** A body no other test posts. */
const unique = (text: string) => `${text} ${randomUUID().slice(0, 8)}`;

/** The error code `query` fails with as Member `as`, or null. */
async function failure(as: string, query: ReturnType<typeof sql<object>>): Promise<string | null> {
  try {
    await tower.call(as, query);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

/** The error code `text` fails with as the migrator (the table's owner), or null. */
async function migratorFailure(text: string, values: unknown[]): Promise<string | null> {
  try {
    await migrator.query(text, values);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

/** How many Chat messages item `id` holds, as the migrator counts them. */
const stored = async (id: string) =>
  Number((await migrator.query<{ n: string }>("select count(*) as n from chat_message where work_item_id = $1", [id])).rows[0]!.n);

/** `raiser`'s Engineer raises a WIR at `location` and sends it to its own review; returns its id. */
async function inInternalReview(raiser: string, location: string, title: string): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    raiser,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, 'WIR', ${title}, app.latest_form_version('WIR'), ${JSON.stringify({ checklist_template: tower.checklistVersionId })}::jsonb,
      ${tower.tradeId}::uuid, ${location}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await tower.outcome(raiser, sql`select app.sync_work_item_checklists(${id}::uuid, now()) as outcome`)).toBe("synced");
  expect(await tower.take(raiser, id, "send_for_review")).toBe("applied");
  return id;
}

/** As inInternalReview, then `pm` picks it up and Submits it to K1. */
async function submitted(raiser: string, pm: string, location: string, title: string): Promise<string> {
  const id = await inInternalReview(raiser, location, title);
  expect(await tower.pickUp(pm, id)).toBe("picked_up");
  expect(await tower.take(pm, id, "submit")).toBe("applied");
  return id;
}

/** Member `memberId` of the Participant `participantId` (administered by `admin`) covers `location` only, or (null) every Location. */
const coverLocation = (admin: string, participantId: string, memberId: string, location: string | null) =>
  tower.outcome(
    admin,
    sql`select app.set_member_visibility(${participantId}::uuid, ${memberId}::uuid, 'location', ${location === null}, ${location === null ? [] : [location]}::uuid[], now()) as outcome`,
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RCH", k1Manager: true });
  const { c1, c2 } = tower;

  // C2's Project Manager, covering what C2 covers.
  c2Pm = (
    await migrator.query("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      c2.id,
      `c2-pm-${digits(8)}@rabaed.test`,
      JSON.stringify(bilingual("C2 PM")),
    ])
  ).rows[0].id as string;
  await tower.call(c2.ap, sql<{ outcome: string }>`select app.add_project_member(${c2.participantId}::uuid, ${c2Pm}::uuid, now())`);
  for (const kind of ["trade", "location"]) {
    expect(await tower.outcome(c2.ap, sql`select app.set_member_visibility(${c2.participantId}::uuid, ${c2Pm}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
  expect(await tower.outcome(c2.ap, sql`select app.set_project_member_positions(${c2.participantId}::uuid, ${c2Pm}::uuid, ${["project_manager"]}::text[]) as outcome`)).toBe("set");

  item.c1AtA = await submitted(c1.members.engineer, c1.members.project_manager, tower.buildingA, "Slab pour");
  item.c1AtB = await submitted(c1.members.engineer, c1.members.project_manager, tower.buildingB, "Column pour");
  item.c1Internal = await inInternalReview(c1.members.engineer, tower.buildingA, "Wall pour");
  item.c2AtB = await submitted(c2.members.engineer, c2Pm, tower.buildingB, "Beam pour");

  // K1's Manager covers Building B only (layer 4).
  expect(await coverLocation(tower.k1.ap, tower.k1.participantId, tower.k1.members.manager, tower.buildingB)).toBe("set");
});

afterAll(async () => {
  await migrator.end();
  await app.destroy();
});

describe("the chat_message table", () => {
  it("is neither read nor written by the app role: only app.work_item_chat and app.post_chat_message are", async () => {
    const seer = tower.k1.members.engineer;
    expect(await failure(seer, sql<object>`select body from chat_message`)).toBe("42501");
    expect(
      await failure(
        seer,
        sql<object>`insert into chat_message (work_item_id, project_id, participant_id, author_member_id, body, created_at)
          values (${item.c1AtA}::uuid, ${tower.projectId}::uuid, ${tower.k1.participantId}::uuid, ${seer}::uuid, 'x', now())`,
      ),
    ).toBe("42501");
  });

  it("is insert-only: not even its owner updates, deletes or truncates a message", async () => {
    const body = await posted(tower.c1.members.engineer, item.c1AtA, unique("Kept as written."));
    expect(await migratorFailure("update chat_message set body = 'changed' where body = $1", [body])).toBe("42501");
    expect(await migratorFailure("delete from chat_message where body = $1", [body])).toBe("42501");
    expect(await migratorFailure("truncate chat_message", [])).toBe("42501");
    expect(await bodies(tower.c1.members.engineer, item.c1AtA)).toContain(body);
  });
});

describe("posting and reading", () => {
  it("is open to every Participant with access from the Submission Date: oldest first, each Company's own authors named", async () => {
    const { c1, k1, ow } = tower;
    const tag = randomUUID().slice(0, 8);
    const first = await post(c1.members.engineer, item.c1AtA, `  Datasheet attached ${tag}.  `);
    expect(first.outcome).toBe("posted");
    expect(first.message_id).toMatch(/^[0-9a-f-]{36}$/);
    await posted(k1.members.engineer, item.c1AtA, `Thanks, on it ${tag}.`);
    await posted(ow.members.representative, item.c1AtA, `Owner noted ${tag}.`);

    const asPm = (await chat(c1.members.project_manager, item.c1AtA)).filter((m) => m.body.includes(tag));
    expect(asPm.map((m) => m.body)).toEqual([`Datasheet attached ${tag}.`, `Thanks, on it ${tag}.`, `Owner noted ${tag}.`]);
    expect(asPm[0]).toMatchObject({
      id: first.message_id,
      author_kind: "own",
      member_name: bilingual("engineer"),
      company_name: bilingual("C1"),
      role_base: "contractor",
      mine: false,
    });
    expect((await chat(c1.members.engineer, item.c1AtA)).find((m) => m.id === first.message_id)!.mine).toBe(true);
    // The times run with the posts, never before the Submission Date.
    const at = asPm.map((m) => m.at.getTime());
    expect(at).toEqual([...at].sort((a, b) => a - b));
    const submittedAt = (await migrator.query<{ at: Date }>("select submitted_at as at from work_item where id = $1", [item.c1AtA])).rows[0]!.at;
    expect(at[0]).toBeGreaterThanOrEqual(submittedAt.getTime());
  });

  it("refuses a body that is empty or blank once trimmed, or longer than 4000 characters, and writes nothing", async () => {
    const engineer = tower.c1.members.engineer;
    const before = await stored(item.c1AtA);
    for (const body of ["", "   ", "\n\t \r\n", "x".repeat(4001), EMOJI.repeat(4001)]) {
      expect(await post(engineer, item.c1AtA, body), JSON.stringify(body.slice(0, 8))).toEqual({ outcome: "invalid_body", message_id: null });
    }
    expect(await stored(item.c1AtA)).toBe(before);
    // 4000 characters, counted as characters: an emoji is one.
    await posted(engineer, item.c1AtA, EMOJI.repeat(4000));
    const trimmed = unique("Trimmed");
    await posted(engineer, item.c1AtA, `\n\t ${trimmed} \r\n`);
    expect(await bodies(engineer, item.c1AtA)).toContain(trimmed);
  });
});

describe("scenario RP-1062-1: a competing Contractor (V3)", () => {
  it("neither reads nor posts on C1's item, and reads and posts on its own", async () => {
    const other = tower.c2.members.engineer;
    // C1's item in Building B, which C2 covers: only V3 keeps it from C2.
    const c1Message = await postedId(tower.c1.members.engineer, item.c1AtB, unique("Column datasheet attached."));
    await messageHidden(item.c1AtB, c1Message, tower.k1.members.engineer, other, "C1's item");
    expect(await chat(other, item.c1AtB)).toEqual([]);
    const before = await stored(item.c1AtB);
    expect(await post(other, item.c1AtB, "Hello?")).toEqual({ outcome: "not_found", message_id: null });
    expect(await post(other, randomUUID(), "Hello?")).toEqual({ outcome: "not_found", message_id: null });
    expect(await stored(item.c1AtB)).toBe(before);
    // Positive control: the same Member, on the item C2 raised; and C1, of the same Project Role, never reads C2's.
    const c2Message = await postedId(other, item.c2AtB, unique("Beam datasheet attached."));
    await messageHidden(item.c2AtB, c2Message, other, tower.c1.members.engineer, "C2's item");
  });
});

describe("scenario RP-1062-2: a Member outside the item's Location (layer 4)", () => {
  it("neither reads nor posts, and reads and posts on an item in the Location they cover", async () => {
    const manager = tower.k1.members.manager;
    const message = await postedId(tower.c1.members.engineer, item.c1AtA, unique("Slab datasheet attached."));
    // K1's Engineer covers Building A and reads it; the Manager, who covers Building B only, doesn't.
    await messageHidden(item.c1AtA, message, tower.k1.members.engineer, manager, "outside Building B");
    expect(await chat(manager, item.c1AtA)).toEqual([]);
    expect(await post(manager, item.c1AtA, "Seen.")).toEqual({ outcome: "not_found", message_id: null });
    // Positive control: K1's Manager on C1's item in Building B, which they cover.
    const atB = await posted(tower.c1.members.engineer, item.c1AtB, unique("Column datasheet attached."));
    expect(await bodies(manager, item.c1AtB)).toContain(atB);
    await posted(manager, item.c1AtB, unique("Seen."));
  });
});

describe("scenario RP-1062-3: before the Submission Date", () => {
  it("posting is refused, and nothing is written; the same Member posts once it is Submitted", async () => {
    const engineer = tower.c1.members.engineer;
    expect(await post(engineer, item.c1Internal, "Note to self.")).toEqual({ outcome: "not_submitted", message_id: null });
    expect(await stored(item.c1Internal)).toBe(0);
    expect(await chat(engineer, item.c1Internal)).toEqual([]);
    // Positive control: the same Member on a Submitted item.
    const body = await posted(engineer, item.c1AtA, unique("Following up."));
    expect(await bodies(engineer, item.c1AtA)).toContain(body);
  });
});

describe("scenario RP-1062-4: another Company's author", () => {
  it("is read as that Company's name and Project Role only, never its people", async () => {
    const { c1, k1, ow } = tower;
    const c1Body = await posted(c1.members.engineer, item.c1AtA, unique("Datasheet attached."));
    const k1Body = await posted(k1.members.engineer, item.c1AtA, unique("Thanks, on it."));
    const owBody = await posted(ow.members.representative, item.c1AtA, unique("Owner noted."));

    const asK1 = await chat(k1.members.engineer, item.c1AtA);
    const c1Message = asK1.find((m) => m.body === c1Body)!;
    expect(c1Message).toMatchObject({ author_kind: "other", member_name: null, company_name: bilingual("C1"), role_base: "contractor", mine: false });
    expect(c1Message.role_name.en).toBe("Contractor");
    // Nothing else names the author: no Member id, no Participant id.
    expect(Object.keys(c1Message).sort()).toEqual(["at", "author_kind", "body", "company_name", "id", "member_name", "mine", "role_base", "role_name"]);
    expect(asK1.find((m) => m.body === k1Body)).toMatchObject({
      author_kind: "own",
      member_name: bilingual("engineer"),
      company_name: bilingual("K1"),
      role_base: "consultant",
      mine: true,
    });

    // The other way round: C1 reads K1 and OW by Company and Project Role.
    const asC1 = await chat(c1.members.project_manager, item.c1AtA);
    expect(asC1.find((m) => m.body === k1Body)).toMatchObject({ author_kind: "other", member_name: null, company_name: bilingual("K1"), role_base: "consultant" });
    expect(asC1.find((m) => m.body === owBody)).toMatchObject({ author_kind: "other", member_name: null, company_name: bilingual("OW"), role_base: "owner" });
  });
});

describe("scenario RP-1062-5: a Member who loses access", () => {
  it("stops reading the Chat at once, and goes on reading where they still have access", async () => {
    const { ow } = tower;
    const representative = ow.members.representative;
    const atA = await postedId(tower.c1.members.engineer, item.c1AtA, unique("Slab poured."));
    const atB = await posted(tower.c1.members.engineer, item.c1AtB, unique("Column poured."));
    // Positive control: before, the Owner's Representative reads both C1 items.
    expect((await chat(representative, item.c1AtA)).map((m) => m.id)).toContain(atA);
    expect(await bodies(representative, item.c1AtB)).toContain(atB);
    expect(await coverLocation(ow.ap, ow.participantId, representative, tower.buildingB)).toBe("set");
    try {
      // Afterwards K1's Engineer still reads it, and the Representative doesn't.
      await messageHidden(item.c1AtA, atA, tower.k1.members.engineer, representative, "narrowed off Building A");
      expect(await chat(representative, item.c1AtA)).toEqual([]);
      expect(await post(representative, item.c1AtA, "Still here?")).toEqual({ outcome: "not_found", message_id: null });
      expect(await bodies(representative, item.c1AtB)).toContain(atB);
    } finally {
      expect(await coverLocation(ow.ap, ow.participantId, representative, null)).toBe("set");
    }
  });
});

describe("a closed Project", () => {
  it("keeps its Chat readable and refuses posting", async () => {
    const engineer = tower.c1.members.engineer;
    const body = await posted(engineer, item.c1AtA, unique("Before close."));
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [tower.projectId]);
    try {
      expect(await post(engineer, item.c1AtA, "After close.")).toEqual({ outcome: "project_closed", message_id: null });
      expect(await bodies(engineer, item.c1AtA)).toContain(body);
    } finally {
      await migrator.query("update project set status = 'active', closed_at = null where id = $1", [tower.projectId]);
    }
  });
});
