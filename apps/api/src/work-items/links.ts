import { withMember, type Db } from "@rabaed/db";
import type { LinkKind, WorkItemLink, WorkItemLinks } from "@rabaed/domain";
import { sql } from "kysely";
import { checkedOutcome, commandResult } from "../outcomes.ts";

// Links between Work Items (RP-291; form-engine.md part 2b; visibility.md E1).
// The database decides everything: who may change an item's free Links and
// when (app.can_save_answers), which targets may be linked (those Link search
// could offer), and what a reader gets back. app.work_item_links gives each
// linked item's Document Number and Subject, and its id only to a reader who
// sees it, so a hidden item's id never reaches the API, let alone the browser.

/**
 * A visible item's Links, oldest first, and whether the Member may change its
 * free Links now; null when they can't see the item.
 */
export function getWorkItemLinks(db: Db, memberId: string, workItemId: string): Promise<WorkItemLinks | null> {
  return withMember(db, memberId, async (trx) => {
    const visible = await trx.selectFrom("work_item").select("id").where("id", "=", workItemId).executeTakeFirst();
    if (!visible) return null;
    const { rows } = await sql<{
      id: string;
      kind: LinkKind;
      field_key: string | null;
      document_number: string;
      subject: string;
      work_item_id: string | null;
    }>`
      select id, kind, field_key, document_number, subject, work_item_id from app.work_item_links(${workItemId}::uuid)
    `.execute(trx);
    const { rows: can } = await sql<{ can_change: boolean }>`
      select app.can_change_links(${workItemId}::uuid) as can_change
    `.execute(trx);
    return {
      links: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        fieldKey: r.field_key,
        documentNumber: r.document_number,
        subject: r.subject,
        workItemId: r.work_item_id,
      })),
      canChange: can[0]!.can_change,
    };
  });
}

/**
 * One Link of a visible item, by the Link's own id (RP-521): what the Links
 * read gives for it, so a hidden target is still its number and Subject only.
 * Null when they can't see the item or the Link isn't one of its own.
 */
export async function getWorkItemLink(db: Db, memberId: string, workItemId: string, linkId: string): Promise<WorkItemLink | null> {
  const all = await getWorkItemLinks(db, memberId, workItemId);
  return all?.links.find((l) => l.id === linkId) ?? null;
}

const addLinkRefusals =["not_found", "project_closed", "not_editable", "target_not_found", "already_linked"] as const;
export type AddLinkResult = { ok: true; id: string } | { ok: false; reason: (typeof addLinkRefusals)[number] };

/**
 * The raiser's Company adds a free Link, until Submit, to an item Link search
 * could have offered them; anything else is refused alike (scenarios 11, 80).
 */
export function addWorkItemLink(db: Db, memberId: string, workItemId: string, targetId: string, now: Date): Promise<AddLinkResult> {
  return withMember(db, memberId, async (trx): Promise<AddLinkResult> => {
    const { rows } = await sql<{ outcome: string; link_id: string | null }>`
      select outcome, link_id from app.add_work_item_link(${workItemId}::uuid, ${targetId}::uuid, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["added", ...addLinkRefusals]);
    return outcome === "added" ? { ok: true, id: rows[0]!.link_id! } : { ok: false, reason: outcome };
  });
}

const removeLinkRefusals = ["not_found", "project_closed", "not_editable"] as const;
export type RemoveLinkResult = { ok: true } | { ok: false; reason: (typeof removeLinkRefusals)[number] };

/** The raiser's Company removes a free Link, until Submit. */
export function removeWorkItemLink(db: Db, memberId: string, workItemId: string, linkId: string, now: Date): Promise<RemoveLinkResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.remove_work_item_link(${workItemId}::uuid, ${linkId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "removed", removeLinkRefusals);
  });
}
