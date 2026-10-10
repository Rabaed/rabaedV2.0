import { withMember, type Db } from "@rabaed/db";
import {
  formSchema,
  screenProblems,
  type CreateScreenRequest,
  type SaveScreenDraftRequest,
  type ScreenList,
  type ScreenOwnerKind,
  type ScreenProblem,
  type ScreenRead,
  type ScreenVersionContent,
} from "@rabaed/domain";
import { sql } from "kysely";
import { checkedOutcome } from "../outcomes.ts";

// Screens (RP-516; ADR 0019; workflow-engine.md §5.7). Every Member of a Project reads
// its published Screens and the Rabaed Default ones (V20); a Project Admin creates,
// versions and publishes the Project's. Every write is an app.* command of the screens
// migration; a draft is checked (screenProblems) in the transaction that publishes it,
// on the draft app.screen_draft has locked. Anyone who may not author the Screen gets
// 'not_found', exactly like a made-up id.

type VersionRow = { version_no: number; schema: unknown; internal_fields: string[] };
const content = (row: VersionRow): ScreenVersionContent => ({
  versionNo: row.version_no,
  schema: formSchema.parse(row.schema),
  internalFields: row.internal_fields,
});

/** The Screens Project `projectId`'s Workflows may show, as the Member reads them; null when they aren't on it. */
export function listScreens(db: Db, memberId: string, projectId: string): Promise<ScreenList | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return null;
    const { rows } = await sql<{ id: string; key: string; name: { en: string; ar: string }; owner_kind: ScreenOwnerKind; latest: number | null }>`
      select s.id, s.key, s.name, s.owner_kind,
        (select max(v.version_no) from screen_version v where v.screen_id = s.id and v.status = 'published') as latest
      from screen s
      where s.owner_kind = 'rabaed' or (s.owner_kind = 'project' and s.project_id = ${projectId}::uuid)
      order by s.owner_kind = 'rabaed', s.key
    `.execute(trx);
    return { screens: rows.map((r) => ({ id: r.id, key: r.key, name: r.name, owner: r.owner_kind, latestVersionNo: r.latest })) };
  });
}

/** A Screen as the Member reads it (V18, V20), its draft for its authors only; null when they don't read it. */
export function readScreen(db: Db, memberId: string, screenId: string): Promise<ScreenRead | null> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ id: string; key: string; name: { en: string; ar: string }; owner_kind: ScreenOwnerKind; project_id: string | null; can_author: boolean }>`
      select s.id, s.key, s.name, s.owner_kind, s.project_id, app.can_author_screen(s.id) as can_author
      from screen s where s.id = ${screenId}::uuid
    `.execute(trx);
    const screen = rows[0];
    if (!screen) return null;
    const published = await sql<VersionRow>`
      select version_no, schema, internal_fields from screen_version
      where screen_id = ${screenId}::uuid and status = 'published' order by version_no
    `.execute(trx);
    const draft = screen.can_author
      ? (await sql<VersionRow>`select version_no, schema, internal_fields from app.screen_draft(${screenId}::uuid)`.execute(trx)).rows[0]
      : undefined;
    const latest = published.rows.at(-1);
    return {
      id: screen.id,
      key: screen.key,
      name: screen.name,
      owner: screen.owner_kind,
      projectId: screen.project_id,
      publishedVersions: published.rows.map((v) => v.version_no),
      published: latest ? content(latest) : null,
      draft: draft ? content(draft) : null,
      canAuthor: screen.can_author,
    };
  });
}

/** Problems with a draft's schema itself: it must be a Form schema to be saved; the rest waits for publish. */
const unparsable = (schema: unknown): ScreenProblem[] => screenProblems(schema, []).filter((p) => p.code === "invalid_schema");

const createRefusals = ["not_found", "project_closed", "invalid_name", "key_taken"] as const;
export type CreateScreenResult =
  | { ok: true; id: string }
  | { ok: false; reason: (typeof createRefusals)[number] }
  | { ok: false; reason: "invalid_screen"; problems: ScreenProblem[] };

/** A Project Admin creates a Screen on the Project, its first draft as given. */
export function createScreen(db: Db, memberId: string, projectId: string, input: CreateScreenRequest, now: Date): Promise<CreateScreenResult> {
  return withMember(db, memberId, async (trx): Promise<CreateScreenResult> => {
    const problems = unparsable(input.schema);
    if (problems.length > 0) {
      // Said to its Project Admins only: to anyone else the Project is the plain 404.
      const { rows } = await sql<{ authors: boolean }>`
        select ${projectId}::uuid in (select app.current_admin_project_ids()) as authors
      `.execute(trx);
      return rows[0]!.authors ? { ok: false, reason: "invalid_screen", problems } : { ok: false, reason: "not_found" };
    }
    const { rows } = await sql<{ outcome: string; screen_id: string | null }>`
      select outcome, screen_id from app.create_screen(
        ${projectId}::uuid, ${input.key}, ${JSON.stringify(input.name)}::jsonb, ${JSON.stringify(input.schema)}::jsonb,
        ${input.internalFields}::text[], ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["created", ...createRefusals]);
    return outcome === "created" ? { ok: true, id: rows[0]!.screen_id! } : { ok: false, reason: outcome };
  });
}

const saveRefusals = ["not_found", "project_closed"] as const;
export type SaveScreenDraftResult =
  | { ok: true; versionNo: number }
  | { ok: false; reason: (typeof saveRefusals)[number] }
  | { ok: false; reason: "invalid_screen"; problems: ScreenProblem[] };

/** Saves the draft of a Screen the Member authors: its next Version. */
export function saveScreenDraft(db: Db, memberId: string, screenId: string, input: SaveScreenDraftRequest, now: Date): Promise<SaveScreenDraftResult> {
  return withMember(db, memberId, async (trx): Promise<SaveScreenDraftResult> => {
    const { rows: authored } = await sql<{ can: boolean }>`select app.can_author_screen(${screenId}::uuid) as can`.execute(trx);
    if (!authored[0]!.can) return { ok: false, reason: "not_found" };
    const problems = unparsable(input.schema);
    if (problems.length > 0) return { ok: false, reason: "invalid_screen", problems };
    const { rows } = await sql<{ outcome: string; version_no: number | null }>`
      select outcome, version_no from app.save_screen_draft(
        ${screenId}::uuid, ${JSON.stringify(input.schema)}::jsonb, ${input.internalFields}::text[], ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["saved", ...saveRefusals]);
    return outcome === "saved" ? { ok: true, versionNo: rows[0]!.version_no! } : { ok: false, reason: outcome };
  });
}

const publishRefusals = ["not_found", "project_closed", "no_draft"] as const;
export type PublishScreenResult =
  | { ok: true; versionNo: number }
  | { ok: false; reason: (typeof publishRefusals)[number] }
  | { ok: false; reason: "screen_problems"; problems: ScreenProblem[] };

/** Publishes the draft of a Screen the Member authors, after every check: refused on any problem. */
export function publishScreen(db: Db, memberId: string, screenId: string, now: Date): Promise<PublishScreenResult> {
  return withMember(db, memberId, async (trx): Promise<PublishScreenResult> => {
    const { rows: authored } = await sql<{ can: boolean }>`select app.can_author_screen(${screenId}::uuid) as can`.execute(trx);
    if (!authored[0]!.can) return { ok: false, reason: "not_found" };
    // Locks the Screen: no save comes between these checks and the publish.
    const draft = (await sql<VersionRow>`select version_no, schema, internal_fields from app.screen_draft(${screenId}::uuid)`.execute(trx)).rows[0];
    if (draft) {
      const lists = await sql<{ id: string }>`select id from option_list`.execute(trx);
      const problems = screenProblems(draft.schema, draft.internal_fields, { optionListIds: new Set(lists.rows.map((l) => l.id)) });
      if (problems.length > 0) return { ok: false, reason: "screen_problems", problems };
    }
    const { rows } = await sql<{ outcome: string; version_no: number | null }>`
      select outcome, version_no from app.publish_screen(${screenId}::uuid, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["published", ...publishRefusals]);
    return outcome === "published" ? { ok: true, versionNo: rows[0]!.version_no! } : { ok: false, reason: outcome };
  });
}
