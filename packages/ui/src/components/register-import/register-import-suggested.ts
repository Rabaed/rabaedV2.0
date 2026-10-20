import { registerFormFieldId, registerFormFieldKey, type RegisterImportMapping, type RegisterValues } from "@rabaed/domain";

// The suggestions pre-chosen on Map values that the importer hasn't confirmed or changed
// (RP-961): each marked Suggested, with its score, until then, and counted on Validate.
// Kept by field (`type`, `trade`, `location`, `scopes`, `field:<key>`), by the value's key.

/** The keys of each field's values still matched by an unconfirmed suggestion. */
export type Suggested = Record<string, string[]>;

/** After Map values reads the register: each field it shows holds the values it reads as suggested. */
export function suggestedOnLoad(was: Suggested, values: RegisterValues): Suggested {
  const next = { ...was };
  for (const f of values.fields) next[f.field] = f.values.filter((v) => v.how === "suggested" && v.match !== null).map((v) => v.key);
  return next;
}

/** The importer confirmed, or changed, a value's match: every row with that value at once. */
export function confirmSuggestion(was: Suggested, field: string, key: string): Suggested {
  if (!was[field]?.includes(key)) return was;
  return { ...was, [field]: was[field].filter((k) => k !== key) };
}

/** The mapping's `suggested`: of each field, the keys still matched (`matches`), never a Package's; undefined when none. */
export function suggestedMapping(suggested: Suggested, matches: Record<string, Record<string, string>>): RegisterImportMapping["suggested"] {
  const out: NonNullable<RegisterImportMapping["suggested"]> = {};
  for (const [field, keys] of Object.entries(suggested)) {
    const still = keys.filter((key) => matches[field]?.[key] !== undefined);
    if (still.length === 0) continue;
    const formKey = registerFormFieldKey(field);
    if (formKey !== null) out.fields = { ...out.fields, [formKey]: still };
    else if (field === "type" || field === "trade" || field === "location" || field === "scopes") out[field] = still;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A saved mapping's suggestions, by field, as the wizard keeps them. */
export function suggestedFromMapping(suggested: RegisterImportMapping["suggested"]): Suggested {
  if (!suggested) return {};
  const { fields, ...builtIn } = suggested;
  return {
    ...Object.fromEntries(Object.entries(builtIn).filter((entry): entry is [string, string[]] => entry[1] !== undefined)),
    ...Object.fromEntries(Object.entries(fields ?? {}).map(([key, keys]) => [registerFormFieldId(key), keys])),
  };
}
