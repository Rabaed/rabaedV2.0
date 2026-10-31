import { describe, expect, it } from "vitest";
import { createScreenRequest, screenProblems } from "./screen.ts";

// Pure domain: Screens (ADR 0019, RP-516; workflow-engine.md §5.7). A Screen Version is
// an Action Form schema whose fields are each shared or internal to the acting
// Participant: the schema passes the Action Form checks, and every field it marks
// internal is one of its answer fields.

const label = (en: string) => ({ en, ar: en });
const codeReply = {
  sections: [
    {
      key: "reply",
      title: label("Reply"),
      fields: [
        { key: "remarks", type: "textarea", label: label("Remarks") },
        { key: "verification_note", type: "textarea", label: label("Verification note") },
        { key: "guidance", type: "instructions", text: label("Fill in both") },
      ],
    },
  ],
};

describe("screenProblems", () => {
  it("passes an Action Form schema whose internal fields are its own answer fields", () => {
    expect(screenProblems(codeReply, ["verification_note"])).toEqual([]);
  });

  it("refuses an internal field the schema doesn't answer: a made-up key, or a layout element", () => {
    expect(screenProblems(codeReply, ["recommended", "guidance"])).toEqual([
      { key: "recommended", code: "unknown_internal_field" },
      { key: "guidance", code: "unknown_internal_field" },
    ]);
  });

  it("runs the Action Form checks, and says where a schema isn't a Form schema at all", () => {
    const withTrade = { sections: [{ ...codeReply.sections[0], fields: [{ key: "trade", type: "trade", label: label("Trade") }] }] };
    expect(screenProblems(withTrade, [])).toEqual([{ key: "trade", code: "not_in_action_form" }]);
    expect(screenProblems({ sections: [] }, [])).toEqual([{ key: "sections", code: "invalid_schema" }]);
  });

  // ADR 0024 (RP-623): a reply Screen may hold photos and attachments, always shared.
  const withFiles = {
    sections: [
      {
        ...codeReply.sections[0],
        fields: [
          ...codeReply.sections[0]!.fields,
          { key: "after_photos", type: "photos", label: label("After photos") },
          { key: "evidence", type: "attachments", label: label("Evidence") },
        ],
      },
    ],
  };

  it("takes photos and attachments fields, which are shared", () => {
    expect(screenProblems(withFiles, ["verification_note"])).toEqual([]);
  });

  it("refuses a file field marked internal: its files are shared once the Transition takes them", () => {
    expect(screenProblems(withFiles, ["after_photos", "evidence"])).toEqual([
      { key: "after_photos", code: "internal_file_field" },
      { key: "evidence", code: "internal_file_field" },
    ]);
  });

  it("still refuses a checklist whose items ask for photos", () => {
    const checklist = {
      key: "checks",
      type: "checklist",
      label: label("Checks"),
      items: [{ key: "level", text: label("Level"), photo: "optional" }],
    };
    const withChecklist = { sections: [{ ...codeReply.sections[0], fields: [checklist] }] };
    expect(screenProblems(withChecklist, [])).toEqual([{ key: "checks", code: "not_in_action_form" }]);
  });

  // form-engine.md §3.3 (RP-1088): only a close takes a reply checklist.
  describe("a reply checklist, while a Workflow shows the Screen on a Transition that doesn't close the item", () => {
    const withReplyChecklist = {
      sections: [
        {
          ...codeReply.sections[0],
          fields: [...codeReply.sections[0]!.fields, { key: "inspection_checklist", type: "copied_checklist", copyOf: "checklist_template", label: label("Checklist"), required: true }],
        },
      ],
    };

    it("is refused: the Workflow's next publish would show it there", () => {
      expect(screenProblems(withReplyChecklist, [], { shownOffClose: true })).toEqual([{ key: "inspection_checklist", code: "reply_checklist_not_on_close" }]);
    });

    it("is taken while every Transition showing the Screen closes the item, or none says", () => {
      expect(screenProblems(withReplyChecklist, [], { shownOffClose: false })).toEqual([]);
      expect(screenProblems(withReplyChecklist, [])).toEqual([]);
    });

    it("leaves a Screen with no reply checklist alone, wherever it is shown", () => {
      expect(screenProblems(codeReply, [], { shownOffClose: true })).toEqual([]);
    });
  });
});

describe("createScreenRequest", () => {
  it("takes a Screen by a snake_case key, its English and Arabic name, its schema and its internal fields", () => {
    const body = { key: "code_reply", name: { en: "Code reply", ar: "رد الرمز" }, schema: codeReply, internalFields: ["verification_note"] };
    // Created as a draft unless asked to publish it at once (a Rabaed Default Screen copied as it is).
    expect(createScreenRequest.parse(body)).toEqual({ ...body, publish: false });
    expect(createScreenRequest.parse({ ...body, publish: true }).publish).toBe(true);
    expect(createScreenRequest.safeParse({ ...body, key: "Code reply" }).success).toBe(false);
    expect(createScreenRequest.parse({ ...body, internalFields: undefined }).internalFields).toEqual([]);
  });
});
