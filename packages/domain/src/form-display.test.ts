import { describe, expect, it } from "vitest";
import { formatFormValue, fromProjectWallTime, toProjectWallTime } from "./form-display.ts";
import { answerFields, formSchema, type AnswerField } from "./form.ts";

const label = (en: string, ar = en) => ({ en, ar });

const fields = answerFields(
  formSchema.parse({
    sections: [
      {
        key: "s",
        title: label("S"),
        fields: [
          { key: "d", type: "date", label: label("Date") },
          { key: "dt", type: "datetime", label: label("Inspected at") },
          { key: "t", type: "time", label: label("Start") },
          { key: "yn", type: "yes_no", label: label("Sample") },
          {
            key: "finish",
            type: "select",
            label: label("Finish"),
            options: [{ value: "galvanised", label: label("Galvanised", "مجلفن") }],
          },
          {
            key: "certs",
            type: "multi_select",
            label: label("Certificates"),
            options: [
              { value: "iso_9001", label: label("ISO 9001") },
              { value: "saso", label: label("SASO", "ساسو") },
            ],
          },
        ],
      },
    ],
  }),
);
const field = (key: string) => fields.find((f) => f.key === key)!;
const [date, datetime, time, yesNo, select, multi] = ["d", "dt", "t", "yn", "finish", "certs"].map(field) as [
  AnswerField,
  AnswerField,
  AnswerField,
  AnswerField,
  AnswerField,
  AnswerField,
];

const noArabicIndic = /[٠-٩۰-۹]/;

describe("Project wall time for datetime fields (Asia/Riyadh, UTC+3)", () => {
  it("turns a stored UTC instant into what a datetime-local control shows", () => {
    expect(toProjectWallTime("2026-10-03T06:30:00.000Z")).toBe("2026-10-03T09:30");
    expect(toProjectWallTime("2026-10-03T22:15:00Z")).toBe("2026-10-04T01:15");
  });

  it("turns what the filler picked back into a UTC instant", () => {
    expect(fromProjectWallTime("2026-10-03T09:30")).toBe("2026-10-03T06:30:00.000Z");
    expect(fromProjectWallTime("2026-10-04T01:15")).toBe("2026-10-03T22:15:00.000Z");
  });

  it("gives nothing for a value it can't read", () => {
    expect(toProjectWallTime("not a date")).toBe("");
    expect(fromProjectWallTime("")).toBe("");
    expect(fromProjectWallTime("2026-02-30T09:30")).toBe("");
  });
});

describe("formatFormValue", () => {
  it("shows dates and times in the viewer's language, with Latin digits", () => {
    expect(formatFormValue(date, "2026-10-03", "en")).toBe("Oct 3, 2026");
    expect(formatFormValue(time, "07:30", "en")).toBe("7:30 AM");
    // The instant in the Project's time zone: 06:30 UTC is 09:30 in Riyadh.
    expect(formatFormValue(datetime, "2026-10-03T06:30:00.000Z", "en")).toBe("Oct 3, 2026, 9:30 AM");
    for (const [field, value] of [
      [date, "2026-10-03"],
      [time, "07:30"],
      [datetime, "2026-10-03T06:30:00.000Z"],
    ] as const) {
      const ar = formatFormValue(field, value, "ar");
      expect(ar).not.toMatch(noArabicIndic);
      expect(ar).toMatch(/\d/);
    }
    expect(formatFormValue(date, "2026-10-03", "ar")).toContain("2026");
  });

  it("keeps a date on its own day, whatever the time zone", () => {
    expect(formatFormValue(date, "2026-01-01", "en")).toBe("Jan 1, 2026");
    expect(formatFormValue(date, "2026-12-31", "en")).toBe("Dec 31, 2026");
  });

  it("shows Yes/No and option labels in the viewer's language", () => {
    expect(formatFormValue(yesNo, true, "en")).toBe("Yes");
    expect(formatFormValue(yesNo, false, "ar")).toBe("لا");
    expect(formatFormValue(select, "galvanised", "ar")).toBe("مجلفن");
    expect(formatFormValue(multi, ["saso", "iso_9001"], "en")).toBe("SASO, ISO 9001");
    expect(formatFormValue(multi, ["saso", "iso_9001"], "ar")).toBe("ساسو، ISO 9001");
  });

  it("shows text exactly as typed, and a value it can't read as it is", () => {
    expect(formatFormValue(date, "soon", "en")).toBe("soon");
    expect(formatFormValue(select, "retired_option", "en")).toBe("retired_option");
  });
});

describe("formatFormValue for member and participant answers (V14)", () => {
  const [member, participant] = answerFields(
    formSchema.parse({
      sections: [
        {
          key: "s",
          title: label("S"),
          fields: [
            { key: "m", type: "member", label: label("Site engineer") },
            { key: "p", type: "participant", label: label("Supplier") },
          ],
        },
      ],
    }),
  ) as [AnswerField, AnswerField];
  const c1 = label("C1 Contracting", "سي ون للمقاولات");
  const ahmed = label("Ahmed Ali", "أحمد علي");
  const id = "0199a3b0-0000-7000-8000-000000000001";

  it("names a Member of the viewer's own Company", () => {
    expect(formatFormValue(member, id, "en", { companyName: c1, memberName: ahmed })).toBe("Ahmed Ali");
    expect(formatFormValue(member, id, "ar", { companyName: c1, memberName: ahmed })).toBe("أحمد علي");
  });

  it("shows another Company's Member as that Company's name only, even with no id to read", () => {
    expect(formatFormValue(member, undefined, "en", { companyName: c1, memberName: null })).toBe("C1 Contracting");
    expect(formatFormValue(member, undefined, "ar", { companyName: c1, memberName: null })).toBe("سي ون للمقاولات");
  });

  it("shows a Participant as its Company's name", () => {
    expect(formatFormValue(participant, id, "ar", { companyName: c1, memberName: null })).toBe("سي ون للمقاولات");
  });

  it("names nobody it may not, and never shows the stored id", () => {
    const hidden = { companyName: null, memberName: null };
    expect(formatFormValue(member, id, "en", hidden)).toBe("Another Company");
    expect(formatFormValue(participant, id, "ar", hidden)).toBe("شركة أخرى");
    expect(formatFormValue(member, id, "en")).toBe("Another Company");
  });
});
