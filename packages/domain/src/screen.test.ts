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
});

describe("createScreenRequest", () => {
  it("takes a Screen by a snake_case key, its English and Arabic name, its schema and its internal fields", () => {
    const body = { key: "code_reply", name: { en: "Code reply", ar: "رد الرمز" }, schema: codeReply, internalFields: ["verification_note"] };
    expect(createScreenRequest.parse(body)).toEqual(body);
    expect(createScreenRequest.safeParse({ ...body, key: "Code reply" }).success).toBe(false);
    expect(createScreenRequest.parse({ ...body, internalFields: undefined }).internalFields).toEqual([]);
  });
});
