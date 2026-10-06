// Seam 2: a security definer function that takes a work-item id re-checks the
// caller's access with app.sees_work_item (RP-367; CODING_STANDARDS.md,
// Database). It runs past row-level security, so without the check a direct call
// tells the caller about an item they can't see: RP-334's app.item_row_seen gave
// away a hidden item's existence, closed state and arrival count. This reads the
// live catalog after every migration, so it covers past and future migrations.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.ts";
import { appDefinerFunctionsWithoutAccessCheck } from "../test-support/definer-access.ts";
import { rolledBack, testDatabaseUrls } from "../test-support/index.ts";

const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(() => migrator.destroy());

// Functions that check access without naming app.sees_work_item in their own
// body, as `app.name(argument types)`. Each entry says where the check is.
const CHECKS_ELSEWHERE: Record<string, string> = {
  "app.sees_work_item(uuid)": "It is the check.",
  "app.answers_autosave(uuid)": "False unless app.can_save_answers, which returns false first for an item the caller can't see.",
  "app.answers_sha256(uuid)": "Null unless app.can_save_answers, which returns false first for an item the caller can't see.",
  "app.can_change_documents(uuid)": "False unless app.can_change_draft_documents, which requires app.can_save_answers.",
  "app.can_change_links(uuid)": "False unless app.can_save_answers, and joins app.acting_project_member (empty for an unseen item).",
  "app.revision_document_copies(uuid)": "No rows unless app.can_change_documents, which requires app.can_save_answers.",
  "app.work_item_actions(uuid)":
    "Every branch joins app.acting_project_member, directly or through app.takeable_transitions; it is empty for an unseen item.",
  "app.form_participant_choices(uuid,uuid)":
    "Lists the Participants of a Project the caller is in; the item adds only app.work_item_companies, empty for an unseen item.",
};

describe("security definer functions in the app schema that take a work-item id", () => {
  it("call app.sees_work_item, outside the allow-list", async () => {
    const unchecked = await appDefinerFunctionsWithoutAccessCheck(migrator);
    expect(unchecked.filter((fn) => !(fn in CHECKS_ELSEWHERE))).toEqual([]);
  });

  it("have an allow-list naming only such functions", async () => {
    const unchecked = await appDefinerFunctionsWithoutAccessCheck(migrator);
    expect(Object.keys(CHECKS_ELSEWHERE).filter((fn) => !unchecked.includes(fn))).toEqual([]);
  });

  it("are caught when a new one doesn't check, but not when it checks or the app role can't run it", async () => {
    await rolledBack(migrator, async (trx) => {
      const definer = (name: string, body: string) =>
        sql
          .raw(
            `create function app.${name}(p_work_item_id uuid, p_now timestamptz) returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$ begin return ${body}; end $$`,
          )
          .execute(trx);
      const grant = async (name: string) => {
        await sql.raw(`revoke all on function app.${name}(uuid, timestamptz) from public`).execute(trx);
        await sql.raw(`grant execute on function app.${name}(uuid, timestamptz) to rabaed_app`).execute(trx);
      };
      await definer("unchecked_probe", "exists (select 1 from work_item w where w.id = p_work_item_id)");
      await grant("unchecked_probe");
      await definer("checked_probe", "app.sees_work_item(p_work_item_id)");
      await grant("checked_probe");
      await definer("internal_probe", "true");
      await sql.raw("revoke all on function app.internal_probe(uuid, timestamptz) from public").execute(trx);
      const found = await appDefinerFunctionsWithoutAccessCheck(trx);
      expect(found).toContain("app.unchecked_probe(uuid,timestamp with time zone)");
      expect(found).not.toContain("app.checked_probe(uuid,timestamp with time zone)");
      expect(found).not.toContain("app.internal_probe(uuid,timestamp with time zone)");
    });
  });

  it("are caught when the app role may run a new one through public", async () => {
    await rolledBack(migrator, async (trx) => {
      await sql
        .raw(
          "create function app.public_probe(p_closed_item_id uuid) returns int language plpgsql security definer set search_path = pg_catalog, public as $$ begin return 1; end $$",
        )
        .execute(trx);
      expect(await appDefinerFunctionsWithoutAccessCheck(trx)).toContain("app.public_probe(uuid)");
    });
  });
});
