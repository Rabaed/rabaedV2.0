// Seam 2 for notification settings (RP-355, spec RP-344 "Notification
// settings"), as the app role: a Member reads and writes only their own
// settings, preference and mutes; another Member can neither read nor change
// them. A mute is set only through app.set_project_mute, for a Project the
// Member is on. And the routing rule delivery applies (app.notification_route)
// is @rabaed/domain's routeNotification, on every combination.
import { randomInt, randomUUID } from "node:crypto";
import {
  defaultNotificationSettings,
  notificationEmailChoices,
  notificationGroupOf,
  notificationKinds,
  routeNotification,
  watchOutcomes,
  type NotificationSettings,
} from "@rabaed/domain";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let a = { member: "", projectId: "" };
let b = { member: "", projectId: "" };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

const rowsAs = <T = Record<string, unknown>>(memberId: string, query: RawBuilder<unknown>) =>
  withMember(app, memberId, (trx) => query.execute(trx)).then((r) => r.rows as T[]);

/** A Company whose Authorized Person creates a Project, as the app role. */
async function side(engineer: string, name: string, code: string) {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  const member = await one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', true) returning id",
    [companyId, email("creator"), JSON.stringify({ en: name, ar: name })],
  );
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [member, companyId]);
  const [project] = await rowsAs<{ project_id: string }>(
    member,
    sql`select project_id from app.create_project('{"en": "P", "ar": "م"}'::jsonb, ${code}, 'contractor')`,
  );
  return { member, projectId: project!.project_id };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  a = await side(engineer, "Company A", "NSA");
  b = await side(engineer, "Company B", "NSB");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("notification_setting and member_notification_preference", () => {
  beforeAll(async () => {
    await rowsAs(a.member, sql`insert into notification_setting (member_id, notification_group, email) values (${a.member}::uuid, 'sent_back', 'off')`);
    await rowsAs(a.member, sql`insert into member_notification_preference (member_id, email_paused, preferred_language) values (${a.member}::uuid, true, 'ar')`);
  });

  it("are read by their own Member", async () => {
    expect(await rowsAs(a.member, sql`select notification_group, email from notification_setting`)).toEqual([
      { notification_group: "sent_back", email: "off" },
    ]);
    expect(await rowsAs(a.member, sql`select email_paused, preferred_language from member_notification_preference`)).toEqual([
      { email_paused: true, preferred_language: "ar" },
    ]);
  });

  it("are unreadable to any other Member, and with no Member set", async () => {
    for (const table of ["notification_setting", "member_notification_preference"]) {
      expect(await rowsAs(b.member, sql`select * from ${sql.table(table)}`), table).toEqual([]);
      const none = await app.transaction().execute((trx) => sql`select * from ${sql.table(table)}`.execute(trx));
      expect(none.rows, table).toEqual([]);
    }
  });

  it("can't be written by another Member", async () => {
    await rowsAs(b.member, sql`update notification_setting set email = 'immediate'`);
    await rowsAs(b.member, sql`update member_notification_preference set email_paused = false`);
    await rowsAs(b.member, sql`delete from notification_setting`);
    await expect(
      rowsAs(b.member, sql`insert into notification_setting (member_id, notification_group, email) values (${a.member}::uuid, 'step_reached', 'off')`),
    ).rejects.toThrow(/row-level security/);
    await expect(
      rowsAs(b.member, sql`insert into member_notification_preference (member_id, email_paused) values (${a.member}::uuid, false)`),
    ).rejects.toThrow(/row-level security/);
    expect((await migrator.query("select email from notification_setting where member_id = $1", [a.member])).rows).toEqual([{ email: "off" }]);
    expect((await migrator.query("select email_paused from member_notification_preference where member_id = $1", [a.member])).rows).toEqual([
      { email_paused: true },
    ]);
  });
});

describe("project_mute", () => {
  const mute = (member: string, projectId: string, muted: boolean) =>
    rowsAs<{ outcome: string }>(member, sql`select app.set_project_mute(${projectId}::uuid, ${muted}) as outcome`).then((r) => r[0]!.outcome);

  it("is set and cleared through app.set_project_mute, for a Project the Member is on", async () => {
    expect(await mute(a.member, a.projectId, true)).toBe("set");
    expect(await mute(a.member, a.projectId, true)).toBe("set");
    expect(await rowsAs(a.member, sql`select member_id, project_id from project_mute`)).toEqual([{ member_id: a.member, project_id: a.projectId }]);
    expect(await mute(a.member, a.projectId, false)).toBe("set");
    expect(await rowsAs(a.member, sql`select * from project_mute`)).toEqual([]);
    await mute(a.member, a.projectId, true);
  });

  it("refuses another Project like a made-up one", async () => {
    for (const projectId of [b.projectId, randomUUID()]) expect(await mute(a.member, projectId, true)).toBe("not_found");
    expect((await migrator.query("select 1 from project_mute where member_id = $1 and project_id = $2", [a.member, b.projectId])).rows).toEqual([]);
  });

  it("is unreadable to any other Member, and never written directly", async () => {
    expect(await rowsAs(b.member, sql`select * from project_mute`)).toEqual([]);
    await expect(rowsAs(a.member, sql`delete from project_mute`)).rejects.toThrow(/permission denied/);
    await expect(
      rowsAs(b.member, sql`insert into project_mute (member_id, project_id) values (${b.member}::uuid, ${a.projectId}::uuid)`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("the routing rule in the database", () => {
  it("is never run by the app role", async () => {
    await expect(rowsAs(a.member, sql`select * from app.member_notification_route(${a.member}::uuid, ${a.projectId}::uuid, 'step_reached', null)`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("agrees with routeNotification on every kind, outcome, setting, tick set, mute and pause", async () => {
    const outcomes = [null, ...watchOutcomes, "closed"];
    const tickSets = [[...watchOutcomes], [], ["A", "B"]];
    const cases = notificationKinds.flatMap((kind) =>
      outcomes.flatMap((outcome) =>
        notificationEmailChoices.flatMap((email) =>
          tickSets.flatMap((ticks) =>
            [true, false].flatMap((muted) => [true, false].map((emailPaused) => ({ kind, outcome, email, ticks, muted, emailPaused }))),
          ),
        ),
      ),
    );
    const { rows } = await migrator.query<{ in_app: boolean; email: string }>(
      `select r.in_app, r.email
       from jsonb_array_elements($1::jsonb) with ordinality c(v, n)
       cross join lateral app.notification_route(
         c.v ->> 'kind', c.v ->> 'outcome', c.v ->> 'email',
         array(select jsonb_array_elements_text(c.v -> 'ticks')), (c.v ->> 'muted')::boolean, (c.v ->> 'emailPaused')::boolean) r
       order by c.n`,
      [JSON.stringify(cases)],
    );
    const expected = cases.map((c) => {
      const group = notificationGroupOf(c.kind);
      const settings = {
        ...defaultNotificationSettings,
        [group]: { email: c.email, outcomes: c.ticks },
      } as NotificationSettings;
      const route = routeNotification({ kind: c.kind, outcome: c.outcome, settings, muted: c.muted, emailPaused: c.emailPaused });
      return { in_app: route.inApp, email: route.email };
    });
    expect(rows).toHaveLength(cases.length);
    expect(rows).toEqual(expected);
  });

  it("reads a Member's settings, defaults where they set none, their mute and their pause", async () => {
    const route = async (member: string, projectId: string, kind: string, outcome: string | null) => {
      const { rows } = await migrator.query<{ in_app: boolean; email: string }>(
        "select in_app, email from app.member_notification_route($1, $2, $3, $4)",
        [member, projectId, kind, outcome],
      );
      return { inApp: rows[0]!.in_app, email: rows[0]!.email };
    };
    // B set nothing: the defaults.
    for (const kind of notificationKinds) {
      expect(await route(b.member, b.projectId, kind, null), kind).toEqual(
        routeNotification({ kind, outcome: null, settings: defaultNotificationSettings, muted: false, emailPaused: false }),
      );
    }
    // A turned Sent Back's email off, paused email, and muted their Project.
    expect(await route(a.member, a.projectId, "step_reached", null)).toEqual({ inApp: false, email: "none" });
    await rowsAs(a.member, sql`select app.set_project_mute(${a.projectId}::uuid, false)`);
    expect(await route(a.member, a.projectId, "step_reached", null)).toEqual({ inApp: true, email: "none" });
    // In-app is always sent, even for a group whose email they turned off.
    expect(await route(a.member, a.projectId, "sent_back", null)).toEqual({ inApp: true, email: "none" });
    await rowsAs(
      a.member,
      sql`insert into notification_setting (member_id, notification_group, email, outcomes) values (${a.member}::uuid, 'watched', 'immediate', '{A,B}')`,
    );
    await rowsAs(a.member, sql`update member_notification_preference set email_paused = false`);
    expect(await route(a.member, a.projectId, "watched_event", "B")).toEqual({ inApp: true, email: "immediate" });
    expect(await route(a.member, a.projectId, "watched_event", "C")).toEqual({ inApp: false, email: "none" });
  });
});
