import { describe, expect, it } from "vitest";
import {
  answerFields,
  formFields,
  formSchema,
  formVisibility,
  isRequired,
  offeredChoices,
  validateAnswers,
  type FormSchema,
} from "./form.ts";

const label = (en: string) => ({ en, ar: en });

const schema: FormSchema = formSchema.parse({
  sections: [
    {
      key: "material",
      title: label("Material"),
      fields: [
        { key: "manufacturer", type: "text", label: label("Manufacturer"), required: true },
        { key: "model", type: "text", label: label("Model"), maxLength: 10 },
      ],
    },
    {
      key: "notes",
      title: label("Notes"),
      fields: [{ key: "description", type: "textarea", label: label("Description"), required: true }],
    },
  ],
});

describe("validateAnswers in draft mode (types only)", () => {
  it("accepts a draft with required fields still empty", () => {
    expect(validateAnswers(schema, {}, "draft")).toEqual({ ok: true, answers: {} });
    expect(validateAnswers(schema, { model: "X1" }, "draft")).toEqual({ ok: true, answers: { model: "X1" } });
  });

  it("refuses a value of the wrong type, naming the field", () => {
    expect(validateAnswers(schema, { manufacturer: 42, description: ["a"] }, "draft")).toEqual({
      ok: false,
      errors: [
        { key: "manufacturer", code: "wrong_type" },
        { key: "description", code: "wrong_type" },
      ],
    });
  });

  it("refuses text longer than the field allows", () => {
    expect(validateAnswers(schema, { model: "12345678901" }, "draft")).toEqual({
      ok: false,
      errors: [{ key: "model", code: "too_long" }],
    });
    expect(validateAnswers(schema, { model: "1234567890" }, "draft").ok).toBe(true);
  });

  it("caps text and textarea fields without their own limit", () => {
    expect(validateAnswers(schema, { manufacturer: "x".repeat(501) }, "draft")).toMatchObject({ ok: false });
    expect(validateAnswers(schema, { manufacturer: "x".repeat(500) }, "draft").ok).toBe(true);
    expect(validateAnswers(schema, { description: "x".repeat(4001) }, "draft")).toMatchObject({ ok: false });
    expect(validateAnswers(schema, { description: "x".repeat(4000) }, "draft").ok).toBe(true);
  });

  it("refuses answers to fields the Form doesn't have", () => {
    expect(validateAnswers(schema, { colour: "red" }, "draft")).toEqual({
      ok: false,
      errors: [{ key: "colour", code: "unknown_field" }],
    });
  });

  it("keeps values exactly as typed, and drops empty ones", () => {
    const typed = "  Galvanised\n300 mm  ";
    expect(validateAnswers(schema, { description: typed, manufacturer: "", model: null }, "draft")).toEqual({
      ok: true,
      answers: { description: typed },
    });
  });

  it("refuses answers that aren't an object of fields", () => {
    for (const answers of [null, [], "text", 3]) {
      expect(validateAnswers(schema, answers, "draft")).toEqual({ ok: false, errors: [{ key: "", code: "wrong_type" }] });
    }
  });
});

describe("validateAnswers in complete mode (types and required)", () => {
  it("lists every required field still empty, in Form order", () => {
    expect(validateAnswers(schema, { model: "X1" }, "complete")).toEqual({
      ok: false,
      errors: [
        { key: "manufacturer", code: "required" },
        { key: "description", code: "required" },
      ],
    });
  });

  it("counts a value of only spaces as empty", () => {
    expect(validateAnswers(schema, { manufacturer: "   ", description: "ok" }, "complete")).toEqual({
      ok: false,
      errors: [{ key: "manufacturer", code: "required" }],
    });
  });

  it("reports type errors too, one per field", () => {
    expect(validateAnswers(schema, { manufacturer: 1 }, "complete")).toEqual({
      ok: false,
      errors: [
        { key: "manufacturer", code: "wrong_type" },
        { key: "description", code: "required" },
      ],
    });
  });

  it("accepts a complete Form", () => {
    const answers = { manufacturer: "ACME", description: "Cable trays" };
    expect(validateAnswers(schema, answers, "complete")).toEqual({ ok: true, answers });
  });
});

describe("formSchema", () => {
  it("refuses a field type it doesn't know", () => {
    expect(
      formSchema.safeParse({
        sections: [{ key: "a", title: label("A"), fields: [{ key: "x", type: "hologram", label: label("X") }] }],
      }).success,
    ).toBe(false);
  });

  it("refuses keys that aren't snake_case", () => {
    expect(
      formSchema.safeParse({
        sections: [{ key: "a", title: label("A"), fields: [{ key: "Model No", type: "text", label: label("X") }] }],
      }).success,
    ).toBe(false);
  });
});

// Dates, times and choices (RP-265; form-engine.md §2, §5).
const typed: FormSchema = formSchema.parse({
  sections: [
    {
      key: "delivery",
      title: label("Delivery"),
      fields: [
        { key: "delivery_date", type: "date", label: label("Delivery date"), required: true },
        { key: "inspected_at", type: "datetime", label: label("Inspected at") },
        { key: "start_time", type: "time", label: label("Start time") },
        { key: "sample_provided", type: "yes_no", label: label("Sample provided"), required: true },
        {
          key: "finish",
          type: "select",
          label: label("Finish"),
          options: [
            { value: "galvanised", label: label("Galvanised") },
            { value: "powder_coated", label: label("Powder coated") },
          ],
        },
        {
          key: "certificates",
          type: "multi_select",
          label: label("Certificates"),
          required: true,
          options: [
            { value: "iso_9001", label: label("ISO 9001") },
            { value: "saso", label: label("SASO") },
            { value: "ce", label: label("CE") },
          ],
        },
      ],
    },
  ],
});

const errorsOf = (answers: unknown, mode: "draft" | "complete" = "draft") => {
  const result = validateAnswers(typed, answers, mode);
  return result.ok ? [] : result.errors;
};

describe("date, datetime and time fields", () => {
  it("take ISO values: a calendar date, a UTC instant, a time of day", () => {
    const answers = { delivery_date: "2026-10-03", inspected_at: "2026-10-03T06:30:00.000Z", start_time: "07:30" };
    expect(validateAnswers(typed, answers, "draft")).toEqual({ ok: true, answers });
    expect(errorsOf({ inspected_at: "2026-10-03T06:30Z", start_time: "23:59:59" })).toEqual([]);
  });

  it("refuse values that aren't ISO, or aren't real dates and times", () => {
    for (const delivery_date of ["03/10/2026", "2026-10-3", "2026-02-30", "2026-13-01", "2026-10-03T00:00:00Z", "tomorrow"]) {
      expect(errorsOf({ delivery_date }), delivery_date).toEqual([{ key: "delivery_date", code: "invalid_format" }]);
    }
    // An instant must say it is UTC, so it can't be read in the wrong time zone.
    for (const inspected_at of ["2026-10-03T09:30:00", "2026-10-03T09:30:00+03:00", "2026-10-03", "2026-10-03T24:00:00Z"]) {
      expect(errorsOf({ inspected_at }), inspected_at).toEqual([{ key: "inspected_at", code: "invalid_format" }]);
    }
    for (const start_time of ["7:30", "24:00", "07:60", "07:30 PM", "0730"]) {
      expect(errorsOf({ start_time }), start_time).toEqual([{ key: "start_time", code: "invalid_format" }]);
    }
  });

  it("refuse a value that isn't text", () => {
    expect(errorsOf({ delivery_date: 20261003, inspected_at: Date.now() })).toEqual([
      { key: "delivery_date", code: "wrong_type" },
      { key: "inspected_at", code: "wrong_type" },
    ]);
  });
});

describe("yes/no fields", () => {
  it("take true or false; No is an answer, not an empty field", () => {
    expect(validateAnswers(typed, { sample_provided: false }, "draft")).toEqual({ ok: true, answers: { sample_provided: false } });
    expect(errorsOf({ sample_provided: false, delivery_date: "2026-10-03", certificates: ["saso"] }, "complete")).toEqual([]);
  });

  it("refuse anything else", () => {
    for (const sample_provided of ["yes", "false", 1, 0, ["true"]]) {
      expect(errorsOf({ sample_provided }), String(sample_provided)).toEqual([{ key: "sample_provided", code: "wrong_type" }]);
    }
  });
});

describe("select fields", () => {
  it("take one of the field's option values", () => {
    expect(validateAnswers(typed, { finish: "powder_coated" }, "draft")).toEqual({ ok: true, answers: { finish: "powder_coated" } });
  });

  it("refuse an option the field doesn't have, or a label instead of a value", () => {
    for (const finish of ["painted", "Galvanised", "GALVANISED"]) {
      expect(errorsOf({ finish }), finish).toEqual([{ key: "finish", code: "unknown_option" }]);
    }
    expect(errorsOf({ finish: ["galvanised"] })).toEqual([{ key: "finish", code: "wrong_type" }]);
  });
});

describe("multi-select fields", () => {
  it("take a list of the field's option values, in the order chosen", () => {
    const answers = { certificates: ["saso", "iso_9001"] };
    expect(validateAnswers(typed, answers, "draft")).toEqual({ ok: true, answers });
  });

  it("refuse an option the field doesn't have", () => {
    expect(errorsOf({ certificates: ["saso", "ul"] })).toEqual([{ key: "certificates", code: "unknown_option" }]);
  });

  it("refuse a value that isn't a list of option values, or names one twice", () => {
    for (const certificates of ["saso", [1], ["saso", "saso"]]) {
      expect(errorsOf({ certificates }), JSON.stringify(certificates)).toEqual([{ key: "certificates", code: "wrong_type" }]);
    }
  });

  it("count an empty list as unanswered: dropped in a draft, required when complete", () => {
    expect(validateAnswers(typed, { certificates: [] }, "draft")).toEqual({ ok: true, answers: {} });
    expect(errorsOf({ certificates: [], delivery_date: "2026-10-03", sample_provided: true }, "complete")).toEqual([
      { key: "certificates", code: "required" },
    ]);
  });
});

describe("draft vs complete with the new types", () => {
  it("a draft skips required, but still refuses a bad value", () => {
    expect(errorsOf({})).toEqual([]);
    expect(errorsOf({ finish: "painted" })).toEqual([{ key: "finish", code: "unknown_option" }]);
  });

  it("complete lists each required field still empty, in Form order", () => {
    expect(errorsOf({ finish: "galvanised" }, "complete")).toEqual([
      { key: "delivery_date", code: "required" },
      { key: "sample_provided", code: "required" },
      { key: "certificates", code: "required" },
    ]);
  });
});

describe("formSchema for choice fields", () => {
  const choice = (options: unknown) => ({
    sections: [{ key: "a", title: label("A"), fields: [{ key: "x", type: "select", label: label("X"), options }] }],
  });

  it("needs options, each with a snake_case value and labels in both languages", () => {
    expect(formSchema.safeParse(choice([{ value: "a", label: label("A") }])).success).toBe(true);
    expect(formSchema.safeParse(choice([])).success).toBe(false);
    expect(formSchema.safeParse(choice([{ value: "Option A", label: label("A") }])).success).toBe(false);
    expect(formSchema.safeParse(choice([{ value: "a", label: { en: "A" } }])).success).toBe(false);
  });

  it("refuses the same option value twice", () => {
    expect(
      formSchema.safeParse(
        choice([
          { value: "a", label: label("A") },
          { value: "a", label: label("Also A") },
        ]),
      ).success,
    ).toBe(false);
  });
});

describe("member and participant fields (RP-266)", () => {
  const people: FormSchema = formSchema.parse({
    sections: [
      {
        key: "people",
        title: label("People"),
        fields: [
          { key: "site_engineer", type: "member", label: label("Site engineer"), required: true },
          { key: "supplier", type: "participant", label: label("Supplier") },
        ],
      },
    ],
  });
  const ownMember = "0199a3b0-0000-7000-8000-000000000001";
  const ownParticipant = "0199a3b0-0000-7000-8000-000000000002";
  const otherMember = "0199a3b0-0000-7000-8000-000000000003";
  const offered = { members: new Set([ownMember]), participants: new Set([ownParticipant]) };

  it("take the id of a Member or Participant the filler was offered", () => {
    const answers = { site_engineer: ownMember, supplier: ownParticipant };
    expect(validateAnswers(people, answers, "complete", { offered })).toEqual({ ok: true, answers });
  });

  it("refuse an id the filler wasn't offered exactly like a made-up one", () => {
    const refused = (value: string) =>
      validateAnswers(people, { site_engineer: value, supplier: value }, "draft", { offered });
    const expected = {
      ok: false,
      errors: [
        { key: "site_engineer", code: "unknown_option" },
        { key: "supplier", code: "unknown_option" },
      ],
    };
    expect(refused(otherMember)).toEqual(expected);
    expect(refused("0199a3b0-0000-7000-8000-00000000dead")).toEqual(expected);
    // A Member's id is not a Participant's, and the other way round.
    expect(validateAnswers(people, { site_engineer: ownParticipant, supplier: ownMember }, "draft", { offered })).toEqual(expected);
  });

  it("without the offered ids (no I/O in the browser), take any id but nothing else", () => {
    expect(validateAnswers(people, { site_engineer: otherMember }, "draft")).toEqual({
      ok: true,
      answers: { site_engineer: otherMember },
    });
    expect(validateAnswers(people, { site_engineer: "Ahmed", supplier: 7 }, "draft")).toEqual({
      ok: false,
      errors: [
        { key: "site_engineer", code: "unknown_option" },
        { key: "supplier", code: "wrong_type" },
      ],
    });
  });

  it("keep an id already saved, even once it is no longer offered, but take no other new one", () => {
    const choices = { members: [], participants: [{ id: ownParticipant, name: label("C1") }] };
    const offered = offeredChoices(choices, people, { site_engineer: otherMember, note: ownMember });
    expect(validateAnswers(people, { site_engineer: otherMember }, "draft", { offered }).ok).toBe(true);
    expect(validateAnswers(people, { site_engineer: ownMember }, "draft", { offered })).toEqual({
      ok: false,
      errors: [{ key: "site_engineer", code: "unknown_option" }],
    });
  });

  it("are unanswered when empty: dropped in a draft, required when complete", () => {
    expect(validateAnswers(people, { site_engineer: "" }, "draft", { offered })).toEqual({ ok: true, answers: {} });
    expect(validateAnswers(people, {}, "complete", { offered })).toEqual({
      ok: false,
      errors: [{ key: "site_engineer", code: "required" }],
    });
  });

  it("take no options in the schema: a Form never lists people or Companies itself", () => {
    const withOptions = {
      sections: [
        {
          key: "people",
          title: label("People"),
          fields: [{ key: "who", type: "member", label: label("Who"), options: [{ value: "x", label: label("X") }] }],
        },
      ],
    };
    expect(formSchema.parse(withOptions).sections[0]!.fields[0]).toEqual({
      key: "who",
      type: "member",
      label: label("Who"),
      required: false,
    });
  });
});

// Layout fields and conditions (RP-267; form-engine.md §1).
const conditional: FormSchema = formSchema.parse({
  sections: [
    {
      key: "sample",
      title: label("Sample"),
      fields: [
        { key: "sample_heading", type: "heading", text: label("About the sample") },
        { key: "sample_note", type: "instructions", text: label("Send the sample to site before the review.") },
        { key: "sample_provided", type: "yes_no", label: label("Sample provided"), required: true },
        {
          key: "sample_reference",
          type: "text",
          label: label("Sample reference"),
          required: true,
          visible_if: { field: "sample_provided", op: "=", value: true },
        },
        { key: "sample_divider", type: "divider" },
        {
          key: "finish",
          type: "select",
          label: label("Finish"),
          options: [
            { value: "galvanised", label: label("Galvanised") },
            { value: "other", label: label("Other") },
          ],
        },
        // Shown always, required only for "Other".
        { key: "finish_details", type: "text", label: label("Finish details"), required: { field: "finish", op: "=", value: "other" } },
      ],
    },
    {
      key: "lab",
      title: label("Lab test"),
      // The whole section, only with a sample.
      visible_if: { field: "sample_provided", op: "=", value: true },
      fields: [
        { key: "lab_name", type: "text", label: label("Lab"), required: true },
        // Hidden in turn when the lab is hidden: a chain.
        { key: "lab_contact", type: "text", label: label("Lab contact"), visible_if: { field: "lab_name", op: "not_empty" } },
      ],
    },
  ],
});

describe("layout fields", () => {
  it("are part of the Form but take no answer", () => {
    expect(answerFields(conditional).map((f) => f.key)).not.toContain("sample_heading");
    expect(formFields(conditional).map((f) => f.key)).toContain("sample_divider");
    expect(validateAnswers(conditional, { sample_heading: "x" }, "draft")).toEqual({
      ok: false,
      errors: [{ key: "sample_heading", code: "unknown_field" }],
    });
  });

  it("need their text in both languages, except a divider", () => {
    const layout = (field: unknown) => formSchema.safeParse({ sections: [{ key: "a", title: label("A"), fields: [field] }] }).success;
    expect(layout({ key: "h", type: "heading", text: label("H") })).toBe(true);
    expect(layout({ key: "h", type: "heading" })).toBe(false);
    expect(layout({ key: "i", type: "instructions", text: { en: "Only English" } })).toBe(false);
    expect(layout({ key: "d", type: "divider" })).toBe(true);
  });
});

describe("conditions in a Form", () => {
  it("can't read item attributes yet: the Form has none to give them (Built-in Fields, RP-270)", () => {
    const withRule = (visible_if: unknown) =>
      formSchema.safeParse({
        sections: [{ key: "a", title: label("A"), fields: [{ key: "x", type: "text", label: label("X"), visible_if }] }],
      }).success;
    expect(withRule({ field: "y", op: "empty" })).toBe(true);
    expect(withRule({ attr: "trade", op: "in", value: ["EL"] })).toBe(false);
    expect(withRule({ all: [{ field: "y", op: "empty" }, { not: { attr: "trade", op: "empty" } }] })).toBe(false);
  });
});

describe("formVisibility", () => {
  it("shows a field or section only while its condition holds", () => {
    const hidden = formVisibility(conditional, { sample_provided: false });
    expect(hidden.fields.has("sample_reference")).toBe(false);
    expect(hidden.sections.has("lab")).toBe(false);
    expect(hidden.fields.has("lab_name")).toBe(false);
    const shown = formVisibility(conditional, { sample_provided: true });
    expect(shown.fields.has("sample_reference")).toBe(true);
    expect(shown.sections.has("lab")).toBe(true);
  });

  it("reads a hidden field as cleared, so what depends on it hides too", () => {
    // lab_name has a value, but its section is hidden: lab_contact hides with it.
    const vis = formVisibility(conditional, { sample_provided: false, lab_name: "SGS" });
    expect(vis.fields.has("lab_contact")).toBe(false);
    expect(formVisibility(conditional, { sample_provided: true, lab_name: "SGS" }).fields.has("lab_contact")).toBe(true);
  });

  it("answers with only the shown fields' answers", () => {
    expect(formVisibility(conditional, { sample_provided: false, sample_reference: "S-1", lab_name: "SGS" }).answers).toEqual({
      sample_provided: false,
    });
  });
});

describe("validateAnswers with conditions", () => {
  it("doesn't check a hidden field, and clears its answer", () => {
    expect(validateAnswers(conditional, { sample_provided: false, sample_reference: ["not text"], lab_name: "SGS" }, "draft")).toEqual({
      ok: true,
      answers: { sample_provided: false },
    });
  });

  it("checks a shown field as usual", () => {
    expect(validateAnswers(conditional, { sample_provided: true, sample_reference: ["not text"] }, "draft")).toEqual({
      ok: false,
      errors: [{ key: "sample_reference", code: "wrong_type" }],
    });
  });

  it("requires a field only while it is shown", () => {
    expect(validateAnswers(conditional, { sample_provided: false }, "complete")).toEqual({ ok: true, answers: { sample_provided: false } });
    expect(validateAnswers(conditional, { sample_provided: true }, "complete")).toEqual({
      ok: false,
      errors: [
        { key: "sample_reference", code: "required" },
        { key: "lab_name", code: "required" },
      ],
    });
  });

  it("requires a field when its required condition holds", () => {
    expect(validateAnswers(conditional, { sample_provided: false, finish: "galvanised" }, "complete").ok).toBe(true);
    expect(validateAnswers(conditional, { sample_provided: false, finish: "other" }, "complete")).toEqual({
      ok: false,
      errors: [{ key: "finish_details", code: "required" }],
    });
    // A draft still skips it.
    expect(validateAnswers(conditional, { finish: "other" }, "draft").ok).toBe(true);
  });

  it("isRequired evaluates a required condition against the answers", () => {
    const details = formFields(conditional).find((f) => f.key === "finish_details")!;
    expect(isRequired(details, { finish: "other" })).toBe(true);
    expect(isRequired(details, {})).toBe(false);
  });
});
