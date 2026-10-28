import { withMember, type Db } from "@rabaed/db";
import type { BaseRole, BilingualText, WorkItemChat } from "@rabaed/domain";
import { sql } from "kysely";
import { checkedOutcome } from "../outcomes.ts";

// Chat on a Work Item (RP-1062; visibility.md V6 and the Chat row). The database decides everything, as the
// Member: app.work_item_chat gives the thread only to a Member who sees the item (app.sees_work_item, checked on
// every read), and names another Company's author by its name and Project Role only; app.post_chat_message refuses
// anyone who doesn't see the item, a closed Project and an item without a Submission Date.

/** Item `workItemId`'s Chat as the Member reads it, oldest first; null when they can't see the item. */
export function getWorkItemChat(db: Db, memberId: string, workItemId: string): Promise<WorkItemChat | null> {
  return withMember(db, memberId, async (trx) => {
    const visible = await trx.selectFrom("work_item").select("id").where("id", "=", workItemId).executeTakeFirst();
    if (!visible) return null;
    const { rows } = await sql<{
      id: string;
      author_kind: "own" | "other";
      member_name: BilingualText | null;
      company_name: BilingualText;
      role_base: BaseRole;
      role_name: BilingualText;
      mine: boolean;
      body: string;
      at: Date;
    }>`
      select id, author_kind, member_name, company_name, role_base, role_name, mine, body, at from app.work_item_chat(${workItemId}::uuid)
    `.execute(trx);
    const messages = rows.map((r) => {
      const projectRole = { baseRole: r.role_base, name: r.role_name };
      const author =
        r.author_kind === "own"
          ? { kind: "own" as const, memberName: r.member_name!, companyName: r.company_name, projectRole }
          : { kind: "other" as const, companyName: r.company_name, projectRole };
      return { id: r.id, author, mine: r.mine, body: r.body, at: r.at.toISOString() };
    });
    return { messages, count: messages.length };
  });
}

const postRefusals = ["not_found", "project_closed", "not_submitted", "invalid_body"] as const;
export type PostChatMessageResult = { ok: true; id: string } | { ok: false; reason: (typeof postRefusals)[number] };

/** The Member posts `body` on item `workItemId`, from its Submission Date on; a refusal writes nothing. */
export function postChatMessage(db: Db, memberId: string, workItemId: string, body: string, now: Date): Promise<PostChatMessageResult> {
  return withMember(db, memberId, async (trx): Promise<PostChatMessageResult> => {
    const { rows } = await sql<{ outcome: string; message_id: string | null }>`
      select outcome, message_id from app.post_chat_message(${workItemId}::uuid, ${body}, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["posted", ...postRefusals]);
    return outcome === "posted" ? { ok: true, id: rows[0]!.message_id! } : { ok: false, reason: outcome };
  });
}
