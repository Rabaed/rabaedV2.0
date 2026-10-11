import { formSchema, itemsToCreateKey, type BilingualText, type FormField, type FormSchema } from "@rabaed/domain";

// The Screens editor's edits on a Screen Version's content (RP-441; ADR 0019): an ordered
// list of fields in sections, each shared or internal to the acting Participant, each
// required or not. Pure functions on the schema, so the editor holds one value and the
// server's checks (screenProblems) stay the only judge of what may be published.

/** What an editor adds: a field of a type, or one of the Screen's named fields. */
export const fieldKinds = ["text", "textarea", "select", "date", "number", "checklist", "remarks", "cover_note", "items_to_create"] as const;
export type FieldKind = (typeof fieldKinds)[number];

/** The keys the named kinds always take, so an Action Form's answers read the same on every Screen. */
export const namedKeys = { remarks: "remarks", cover_note: "cover_note", items_to_create: itemsToCreateKey } as const;

/** A key under `base` that no field of the schema has: `base`, then `base_2`, `base_3`… */
export function uniqueKey(schema: FormSchema, base: string): string {
  const taken = new Set(schema.sections.flatMap((s) => s.fields.map((f) => f.key)));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** Whether the schema already has the named field `kind` stands for (those are added once). */
export function hasNamed(schema: FormSchema, kind: FieldKind): boolean {
  const key = namedKeys[kind as keyof typeof namedKeys];
  return key !== undefined && schema.sections.some((s) => s.fields.some((f) => f.key === key));
}

/** A new field of `kind` with `label`, `option` (a choice's or a checklist item's text) and `column` (the items table's column), all in both languages. */
export function newField(
  schema: FormSchema,
  kind: FieldKind,
  words: { label: BilingualText; option: BilingualText; column: BilingualText },
): FormField {
  const key = kind in namedKeys ? namedKeys[kind as keyof typeof namedKeys] : uniqueKey(schema, kind);
  const base = { key, label: words.label, required: false };
  switch (kind) {
    case "select":
      return { ...base, type: "select", options: [{ value: "option_1", label: words.option }] };
    case "checklist":
      return { ...base, type: "checklist", items: [{ key: "item_1", text: words.option, answers: "pass_fail_na", comment: "optional", photo: "off" }] };
    case "items_to_create":
      return { ...base, type: "table", columns: [{ key: "subject", type: "text", label: words.column, required: true }] };
    case "remarks":
    case "cover_note":
    case "textarea":
      return { ...base, type: "textarea" };
    default:
      return { ...base, type: kind };
  }
}

/** `schema` with `field` added at the end of section `sectionKey`. */
export function addField(schema: FormSchema, sectionKey: string, field: FormField): FormSchema {
  return { sections: schema.sections.map((s) => (s.key === sectionKey ? { ...s, fields: [...s.fields, field] } : s)) };
}

/** `schema` with field `key` replaced by what `change` makes of it. */
export function changeField(schema: FormSchema, key: string, change: (field: FormField) => FormField): FormSchema {
  return { sections: schema.sections.map((s) => ({ ...s, fields: s.fields.map((f) => (f.key === key ? change(f) : f)) })) };
}

/** `schema` without field `key`. */
export function removeField(schema: FormSchema, key: string): FormSchema {
  return { sections: schema.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== key) })) };
}

/** Field `key` one place up (`-1`) or down (`1`) within its section; where it can't move, `schema` as it was. */
export function moveField(schema: FormSchema, key: string, delta: -1 | 1): FormSchema {
  return {
    sections: schema.sections.map((s) => {
      const at = s.fields.findIndex((f) => f.key === key);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= s.fields.length) return s;
      const fields = [...s.fields];
      [fields[at], fields[to]] = [fields[to]!, fields[at]!];
      return { ...s, fields };
    }),
  };
}

/** The internal keys with `key` added or taken away, only the fields the schema still has, in the schema's order. */
export function withInternal(schema: FormSchema, internal: readonly string[], key: string, isInternal: boolean): string[] {
  const keys = new Set(internal.filter((k) => k !== key));
  if (isInternal) keys.add(key);
  return schema.sections.flatMap((s) => s.fields.map((f) => f.key)).filter((k) => keys.has(k));
}

/** The schema as the editor starts from a Screen's content, or a first one-field Screen when it has none. */
export function startingSchema(content: unknown, first: { section: BilingualText; field: BilingualText }): FormSchema {
  const parsed = formSchema.safeParse(content);
  if (parsed.success) return parsed.data;
  return {
    sections: [{ key: "reply", title: first.section, fields: [{ key: "remarks", type: "textarea", label: first.field, required: false }] }],
  };
}
