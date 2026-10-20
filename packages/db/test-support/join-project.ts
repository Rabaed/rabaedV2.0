import { sql } from "kysely";
import { withMember, type Db } from "../src/client.ts";

/**
 * As the app role, the Project Admin `adminId` invites the Company with CR
 * number `crNumber` in `role`, and its Authorized Person `authorizedPersonId`
 * accepts (ADR 0009). Returns the Participant's id.
 */
export async function joinProject(
  app: Db,
  projectId: string,
  invite: { adminId: string; crNumber: string; role: string },
  authorizedPersonId: string,
): Promise<string> {
  const invited = await withMember(app, invite.adminId, (trx) =>
    sql<{ outcome: string }>`
      select app.add_participant(${projectId}::uuid, ${invite.crNumber}, ${invite.role}, now()) as outcome
    `.execute(trx),
  );
  if (invited.rows[0]!.outcome !== "invited") throw new Error(`invite: ${invited.rows[0]!.outcome}`);
  return withMember(app, authorizedPersonId, async (trx) => {
    // The newest pending invitation: the one just sent.
    const { rows } = await sql<{ participant_id: string }>`select participant_id from app.company_invitations()`.execute(trx);
    const id = rows[0]?.participant_id;
    if (!id) throw new Error("invite: no invitation for the Authorized Person");
    const accepted = await sql<{ outcome: string }>`
      select app.respond_to_invitation(${id}::uuid, true, now()) as outcome
    `.execute(trx);
    if (accepted.rows[0]!.outcome !== "accepted") throw new Error(`accept: ${accepted.rows[0]!.outcome}`);
    return id;
  });
}
