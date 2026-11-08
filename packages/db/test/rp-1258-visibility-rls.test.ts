// Seam 2 for RP-1258 (visibility.md V14: no other Company reads a Member's id). RP-1139 revoked every Member id
// column another Company could read, but default privileges grant each new table whole to the app role, so the
// next `*_member_id` column would be readable again with nothing failing (RP-1129 found
// work_item_event.actor_member_id only by reading). This reads the live catalog: every Member id column the app
// role may SELECT is on MEMBER_ID_ALLOW with its reason, and every entry still names one (the ratchet).
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.ts";
import { APP_ROLE } from "../src/config.ts";
import { MEMBER_ID_ALLOW, memberIdGrantProblems, readableMemberIdColumns, rolledBack, testDatabaseUrls } from "../test-support/index.ts";

const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(() => migrator.destroy());

describe("RP-1258-1: the app role reads a Member id column only where the allow list says why no other Company reaches it", () => {
  it("RP-1258-1: every Member id column the app role may SELECT is on the allow list, and every entry still names one", async () => {
    const readable = await readableMemberIdColumns(migrator, APP_ROLE);
    expect(memberIdGrantProblems(readable, MEMBER_ID_ALLOW)).toEqual([]); // not hidden-from: a list of ratchet problems
  });

  it("RP-1258-1: finds a Member id column by its name or by its foreign key to member(id)", async () => {
    await rolledBack(migrator, async (trx) => {
      await sql
        .raw(
          `create table public.rp1258_probe (id uuid primary key, reviewer_member_id uuid, signer uuid references member (id), note text);
           grant select on public.rp1258_probe to ${APP_ROLE};`,
        )
        .execute(trx);
      const readable = await readableMemberIdColumns(trx, APP_ROLE);
      expect(readable.filter((c) => c.table === "rp1258_probe")).toEqual([
        { table: "rp1258_probe", column: "reviewer_member_id" },
        { table: "rp1258_probe", column: "signer" },
      ]);
      expect(memberIdGrantProblems(readable, MEMBER_ID_ALLOW).filter((p) => p.includes("rp1258_"))).toEqual([
        "rp1258_probe.reviewer_member_id is a Member id column the app role may SELECT, and it is not on MEMBER_ID_ALLOW: revoke it from the app role, or add it to MEMBER_ID_ALLOW in packages/db/test-support/member-id-grants.ts with the reason no other Company reads it (visibility.md V14)",
        "rp1258_probe.signer is a Member id column the app role may SELECT, and it is not on MEMBER_ID_ALLOW: revoke it from the app role, or add it to MEMBER_ID_ALLOW in packages/db/test-support/member-id-grants.ts with the reason no other Company reads it (visibility.md V14)",
      ]);
    });
  });

  it("RP-1258-1: catches a new Member id column on a table the app role already reads, granted by column or whole", async () => {
    await rolledBack(migrator, async (trx) => {
      await sql.raw("alter table work_item add column rp1258_checker_member_id uuid").execute(trx);
      await sql.raw(`grant select (rp1258_checker_member_id) on work_item to ${APP_ROLE}`).execute(trx);
      // work_item_type is granted whole: a new column of it is readable the day it lands, with no grant of its own.
      await sql.raw("alter table work_item_type add column rp1258_approver_member_id uuid").execute(trx);
      const problems = memberIdGrantProblems(await readableMemberIdColumns(trx, APP_ROLE), MEMBER_ID_ALLOW);
      expect(problems.filter((p) => p.includes("rp1258_"))).toEqual([
        expect.stringMatching(/^work_item\.rp1258_checker_member_id is a Member id column the app role may SELECT/),
        expect.stringMatching(/^work_item_type\.rp1258_approver_member_id is a Member id column the app role may SELECT/),
      ]);
    });
  });

  it("RP-1258-1: catches a column added to an allowed view, whose pinned columns no longer match", async () => {
    await rolledBack(migrator, async (trx) => {
      await sql.raw("create view public.rp1258_probe_view as select id, project_id from work_item_type").execute(trx);
      await sql.raw(`grant select on public.rp1258_probe_view to ${APP_ROLE}`).execute(trx);
      const allow = [...MEMBER_ID_ALLOW, { column: "rp1258_probe_view", reason: "a view of a Type and its Project: no Member id", columns: ["id", "project_id"] }];
      expect(memberIdGrantProblems(await readableMemberIdColumns(trx, APP_ROLE), allow).filter((p) => p.includes("rp1258_"))).toEqual([]);
      // A view may gain columns at its end; the new one carries a Member id under a name that doesn't say so.
      await sql.raw("create or replace view public.rp1258_probe_view as select t.id, t.project_id, m.id as checker from work_item_type t cross join member m").execute(trx);
      expect(memberIdGrantProblems(await readableMemberIdColumns(trx, APP_ROLE), allow).filter((p) => p.includes("rp1258_"))).toEqual([
        "rp1258_probe_view's columns are now (id, project_id, checker), not the (id, project_id) MEMBER_ID_ALLOW pins: re-check the view for Member ids, then pin its columns again",
      ]);
    });
  });

  it("RP-1258-1: catches a new public view the app role may read, even when no column name says Member id", async () => {
    await rolledBack(migrator, async (trx) => {
      await sql.raw("create view public.rp1258_probe_view as select id as who from member").execute(trx);
      await sql.raw(`grant select on public.rp1258_probe_view to ${APP_ROLE}`).execute(trx);
      const problems = memberIdGrantProblems(await readableMemberIdColumns(trx, APP_ROLE), MEMBER_ID_ALLOW);
      expect(problems.filter((p) => p.includes("rp1258_"))).toEqual([
        "rp1258_probe_view is a view the app role may SELECT, and it is not on MEMBER_ID_ALLOW: a view's columns carry no foreign key, so a Member id in it can't be found by its name alone; revoke it, or add it to MEMBER_ID_ALLOW in packages/db/test-support/member-id-grants.ts naming its columns (visibility.md V14)",
      ]);
    });
  });
});
