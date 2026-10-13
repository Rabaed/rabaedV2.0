import { screenProblems, type BilingualText, type FormSchema } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { addField, changeField, hasNamed, moveField, newField, removeField, withInternal, fieldKinds } from "./screen-editor.ts";

const words = (en: string) => ({ label: { en, ar: en }, option: { en: `${en} option`, ar: `${en} option` }, column: { en: "Subject", ar: "Subject" } }) as {
  label: BilingualText;
  option: BilingualText;
  column: BilingualText;
};
const empty: FormSchema = { sections: [{ key: "reply", title: { en: "Reply", ar: "Reply" }, fields: [] }] };

describe("the Screens editor's edits", () => {
  it("every kind it adds is a field a Screen can publish, once its labels are in both languages", () => {
    // Derived from the list of kinds, so a new kind can't be left unchecked.
    for (const kind of fieldKinds) {
      const schema = addField(empty, "reply", newField(empty, kind, words(kind)));
      expect(screenProblems(schema, []), kind).toEqual([]);
    }
  });

  it("gives each new field a key no other has, and the named ones their fixed keys, once", () => {
    let schema = addField(empty, "reply", newField(empty, "text", words("Text")));
    schema = addField(schema, "reply", newField(schema, "text", words("Text")));
    schema = addField(schema, "reply", newField(schema, "remarks", words("Remarks")));
    expect(schema.sections[0]!.fields.map((f) => f.key)).toEqual(["text", "text_2", "remarks"]);
    expect(hasNamed(schema, "remarks")).toBe(true);
    expect(hasNamed(schema, "cover_note")).toBe(false);
  });

  it("moves a field within its section, never past the ends", () => {
    let schema = empty;
    for (const kind of ["text", "date", "number"] as const) schema = addField(schema, "reply", newField(schema, kind, words(kind)));
    const order = (s: FormSchema) => s.sections[0]!.fields.map((f) => f.key);
    expect(order(moveField(schema, "number", -1))).toEqual(["text", "number", "date"]);
    expect(order(moveField(schema, "text", -1))).toEqual(["text", "date", "number"]);
    expect(order(moveField(schema, "number", 1))).toEqual(["text", "date", "number"]);
  });

  it("marks a field internal and keeps only the keys the schema still has", () => {
    let schema = addField(empty, "reply", newField(empty, "text", words("Text")));
    schema = addField(schema, "reply", newField(schema, "date", words("Date")));
    const internal = withInternal(schema, [], "date", true);
    expect(internal).toEqual(["date"]);
    expect(withInternal(schema, internal, "date", false)).toEqual([]);
    // A removed field's key goes with it, so the Screen never names a field it doesn't have.
    expect(withInternal(removeField(schema, "date"), internal, "text", true)).toEqual(["text"]);
  });

  it("changes one field and leaves the rest", () => {
    let schema = addField(empty, "reply", newField(empty, "text", words("Text")));
    schema = addField(schema, "reply", newField(schema, "date", words("Date")));
    const changed = changeField(schema, "date", (f) => ({ ...f, required: true }));
    expect(changed.sections[0]!.fields.map((f) => ("required" in f ? f.required : null))).toEqual([false, true]);
  });
});
