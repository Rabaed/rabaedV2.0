import type { FormSchema } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { formBesideReplyChecklists } from "./checklist-once.ts";

// A WIR's checklist shows once on its page (RP-1071): the Participant answering it reads its
// answering cards, everyone else the Form's read-only Checklist Template field.

const text = (en: string) => ({ en, ar: en });

/** The WIR Form's shape: an inspection section, and a section holding only the Checklist Template pick. */
const wir: FormSchema = {
  sections: [
    {
      key: "inspection",
      title: text("Inspection"),
      fields: [{ key: "description", type: "textarea", label: text("Description"), required: true }],
    },
    {
      key: "checklist",
      title: text("Checklist"),
      fields: [{ key: "checklist_template", type: "checklist_template", label: text("Checklist Template"), required: false }],
    },
  ],
};

describe("the WIR's checklist on its page", () => {
  it("the Participant answering it reads its answering cards only: the Form leaves the template's section out", () => {
    const shown = formBesideReplyChecklists(wir, [{ copyOf: "checklist_template" }]);
    expect(shown.sections.map((s) => s.key)).toEqual(["inspection"]);
  });

  it("any other reader, who has no answering cards, reads the Form's read-only template once", () => {
    expect(formBesideReplyChecklists(wir, [])).toBe(wir);
  });

  it("keeps a section's other fields, and a template no answering card copies", () => {
    const mixed: FormSchema = {
      sections: [
        {
          key: "checklists",
          title: text("Checklists"),
          fields: [
            { key: "note", type: "text", label: text("Note"), required: false },
            { key: "slab", type: "checklist_template", label: text("Slab"), required: false },
            { key: "walls", type: "checklist_template", label: text("Walls"), required: false },
          ],
        },
      ],
    };
    const shown = formBesideReplyChecklists(mixed, [{ copyOf: "slab" }]);
    expect(shown.sections[0]!.fields.map((f) => f.key)).toEqual(["note", "walls"]);
  });
});
