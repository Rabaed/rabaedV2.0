import { z } from "zod";
import { bilingualText, engineerReason } from "./company.ts";

// Option Lists (form-engine.md §10; RP-279): Rabaed Default lists of choices
// with up to three levels. Rabaed Engineers edit them in Rabaed Admin; every
// Member reads them. An option's `value` is stable (Work Items store it); only
// its label and retired flag change, and an option is never deleted.

export const OPTION_LIST_MAX_LEVELS = 3;

/** An option's stable value: lower-case letters, digits, `_` and `-`. */
export const optionValue = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "lower-case letters, digits, _ and -");

export interface OptionNode {
  id: string;
  value: string;
  label: { en: string; ar: string };
  /** A retired option isn't offered for new answers, but stays where it was chosen. */
  retired: boolean;
  /** Its sub-options, in the order they were added. */
  options: OptionNode[];
}

const optionNode: z.ZodType<OptionNode> = z.lazy(() =>
  z.object({ id: z.uuid(), value: optionValue, label: bilingualText, retired: z.boolean(), options: z.array(optionNode) }),
);

export const optionList = z.object({ id: z.uuid(), name: bilingualText, options: z.array(optionNode) });
export type OptionList = z.infer<typeof optionList>;
export const optionLists = z.object({ optionLists: z.array(optionList) });

// Rabaed Admin's requests: every edit carries the Engineer's reason (V9).
export const createOptionListRequest = z.object({ name: bilingualText, reason: engineerReason });
export const addOptionRequest = z.object({
  /** Null for a first-level option of the list. */
  parentId: z.uuid().nullable().default(null),
  value: optionValue,
  label: bilingualText,
  reason: engineerReason,
});
export const renameOptionRequest = z.object({ label: bilingualText, reason: engineerReason });
export const optionReasonRequest = z.object({ reason: engineerReason });

export interface OptionRow {
  id: string;
  option_list_id: string;
  parent_id: string | null;
  value: string;
  label: { en: string; ar: string };
  retired: boolean;
}

/**
 * Nests flat rows into their lists. `lists` and `rows` come in the order
 * they were added, which is the order options are shown in.
 */
export function buildOptionLists(lists: { id: string; name: { en: string; ar: string } }[], rows: OptionRow[]): OptionList[] {
  const nodes = new Map<string, OptionNode>(
    rows.map((r) => [r.id, { id: r.id, value: r.value, label: r.label, retired: r.retired, options: [] }]),
  );
  const roots = new Map<string, OptionNode[]>(lists.map((l) => [l.id, []]));
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    (r.parent_id ? nodes.get(r.parent_id)?.options : roots.get(r.option_list_id))?.push(node);
  }
  return lists.map((l) => ({ id: l.id, name: l.name, options: roots.get(l.id)! }));
}
