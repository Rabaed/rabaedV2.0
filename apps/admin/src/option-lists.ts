import type { Db } from "@rabaed/db";
import { buildOptionLists, type OptionList, type OptionRow } from "@rabaed/domain";
import { asEngineer } from "./admin-action.ts";
import { Refused, refusable, type Refusable } from "./refusals.ts";

// Option Lists (form-engine.md §10; RP-279): Rabaed Default data that Rabaed
// Engineers maintain here. Every edit is an Engineer action with a reason in
// admin_action (V9); an option is never deleted, only renamed or retired.

type Label = { en: string; ar: string };

/** Every list with its options nested, in the order they were added. Rabaed's own data, not a Company's: a read asks for no reason. */
export async function listOptionLists(adminDb: Db): Promise<OptionList[]> {
  const lists = await adminDb.selectFrom("option_list").select(["id", "name"]).orderBy("created_at").orderBy("id").execute();
  const rows = await adminDb
    .selectFrom("option")
    .select(["id", "option_list_id", "parent_id", "value", "label", "retired"])
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return buildOptionLists(lists as { id: string; name: Label }[], rows as OptionRow[]);
}

/** Why an edit was refused (the transaction is rolled back, so nothing is logged). */
type Refusal = "not_found" | "duplicate_value" | "too_deep";

export type EditResult<T> = Refusable<T, Refusal>;

/** The database's own refusals of an Option List edit. */
function optionListRefusal(error: unknown): Refusal | undefined {
  const code = (error as { code?: string }).code;
  if (code === "23505") return "duplicate_value";
  // The level trigger: a fourth level (other check violations are not this).
  if (code === "23514" && /at most three levels/.test((error as Error).message)) return "too_deep";
  return undefined;
}

export function createOptionList(adminDb: Db, engineerId: string, input: { name: Label; reason: string }): Promise<string> {
  return asEngineer(adminDb, { engineerId, action: "create_option_list", reason: input.reason }, async (trx) => {
    const list = await trx.insertInto("option_list").values({ name: JSON.stringify(input.name) }).returning("id").executeTakeFirstOrThrow();
    return { target: { kind: "option_list", id: list.id }, after: { name: input.name }, result: list.id };
  });
}

/** Adds an option under `parentId` (null: first level) of the list. At most three levels. */
export function addOption(
  adminDb: Db,
  engineerId: string,
  listId: string,
  input: { parentId: string | null; value: string; label: Label; reason: string },
): Promise<EditResult<string>> {
  return refusable(() =>
    asEngineer(adminDb, { engineerId, action: "add_option", reason: input.reason }, async (trx) => {
      const list = await trx.selectFrom("option_list").select("id").where("id", "=", listId).executeTakeFirst();
      if (!list) throw new Refused("not_found");
      if (input.parentId) {
        const parent = await trx
          .selectFrom("option")
          .select("id")
          .where("id", "=", input.parentId)
          .where("option_list_id", "=", listId)
          .executeTakeFirst();
        if (!parent) throw new Refused("not_found");
      }
      const option = await trx
        .insertInto("option")
        .values({ option_list_id: listId, parent_id: input.parentId, value: input.value, label: JSON.stringify(input.label) })
        .returning(["id", "level"])
        .executeTakeFirstOrThrow();
      return {
        target: { kind: "option", id: option.id },
        after: { listId, parentId: input.parentId, level: option.level, value: input.value, label: input.label },
        result: option.id,
      };
    }),
    optionListRefusal,
  );
}

export function renameOption(
  adminDb: Db,
  engineerId: string,
  optionId: string,
  input: { label: Label; reason: string },
): Promise<EditResult<void>> {
  return refusable(() =>
    asEngineer(adminDb, { engineerId, action: "rename_option", reason: input.reason }, async (trx) => {
      const before = await trx.selectFrom("option").select(["label", "value"]).where("id", "=", optionId).forUpdate().executeTakeFirst();
      if (!before) throw new Refused("not_found");
      await trx.updateTable("option").set({ label: JSON.stringify(input.label), updated_at: new Date() }).where("id", "=", optionId).execute();
      return {
        target: { kind: "option", id: optionId },
        before: { value: before.value, label: before.label },
        after: { value: before.value, label: input.label },
        result: undefined,
      };
    }),
    optionListRefusal,
  );
}

/** Retires an option (no longer offered for new answers) or restores it. The option itself stays. */
export function setOptionRetired(
  adminDb: Db,
  engineerId: string,
  optionId: string,
  retired: boolean,
  reason: string,
): Promise<EditResult<void>> {
  return refusable(() =>
    asEngineer(adminDb, { engineerId, action: retired ? "retire_option" : "restore_option", reason }, async (trx) => {
      const before = await trx.selectFrom("option").select(["retired", "value"]).where("id", "=", optionId).forUpdate().executeTakeFirst();
      if (!before) throw new Refused("not_found");
      await trx.updateTable("option").set({ retired, updated_at: new Date() }).where("id", "=", optionId).execute();
      return {
        target: { kind: "option", id: optionId },
        before: { value: before.value, retired: before.retired },
        after: { value: before.value, retired },
        result: undefined,
      };
    }),
    optionListRefusal,
  );
}
