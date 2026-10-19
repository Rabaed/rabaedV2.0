import { describe, expect, it } from "vitest";
import { actionFormProblems } from "./action-form.ts";
import type { ChecklistCopy } from "./checklist-template.ts";
import { formSchema, validateAnswers, type FormSchema } from "./form.ts";
import { publishProblems } from "./form-publish.ts";
import { checklistOfRead, checklistsPropose, checkReplyChecklist, proposedCode, replyChecklistOf, snagsToRaise } from "./reply-checklist.ts";
import { screenProblems } from "./screen.ts";

// Pure domain: a checklist in a reply Screen (RP-86, INSP-4; ADR 0024 amended 2026-10-19,
// ADR 0025; form-engine.md §3.3). A `copied_checklist` field holds no items of its own: it
// answers the checklist the item copied from its Checklist Template (`copyOf` names the
// item's `checklist_template` field). Its answers are saved over time by the holding
// Participant and taken by the Transition, never given in the pop-up's answers. The
// Consultant Manager's code proposes C when any item failed, else A.

const label = (en: string) => ({ en, ar: `${en} ع` });
const field = { key: "inspection_checklist", type: "copied_checklist", copyOf: "checklist_template", label: label("Checklist"), required: true };
const remarks = { key: "remarks", type: "textarea", label: label("Remarks") };
const screen = (...fields: object[]) => ({ sections: [{ key: "reply", title: label("Reply"), fields }] });

const copy: ChecklistCopy = {
  fieldKey: "checklist_template",
  templateId: "00000000-0000-4000-8000-00000000000a",
  versionId: "00000000-0000-4000-8000-00000000000b",
  versionNo: 1,
  name: label("Concrete pour"),
  tradeId: "00000000-0000-4000-8000-00000000000c",
  items: [
    { key: "formwork", text: label("Formwork tight"), answers: "pass_fail_na", comment: "required_on_negative", photo: "required_on_negative", on_negative: "create_snag" },
    { key: "cover", text: label("Rebar cover"), answers: "pass_fail_na", comment: "optional", photo: "optional", on_negative: "none" },
    { key: "clean", text: label("Clean of debris"), answers: "yes_no_na", comment: "off", photo: "off", on_negative: "none" },
  ],
};
const checklist = replyChecklistOf(formSchema.parse(screen(field)).sections[0]!.fields[0]! as never, copy);
/** The checklist with every item's `on_negative` set to `onNegative`. */
const checklistOf = (onNegative: "none" | "create_snag") =>
  replyChecklistOf(formSchema.parse(screen(field)).sections[0]!.fields[0]! as never, { ...copy, items: copy.items.map((i) => ({ ...i, on_negative: onNegative })) });

describe("the Screen publish checks", () => {
  it("take a copied checklist in a Screen's Action Form, shared", () => {
    expect(screenProblems(screen(field, remarks), [])).toEqual([]);
  });

  it("refuse it marked internal: the code shares its answers and photos", () => {
    expect(screenProblems(screen(field, remarks), ["inspection_checklist"])).toEqual([{ key: "inspection_checklist", code: "internal_file_field" }]);
  });

  it("refuse it in a Transition's own Action Form, which holds no files", () => {
    expect(actionFormProblems(formSchema.parse(screen(field)))).toEqual([{ key: "inspection_checklist", code: "not_in_action_form" }]);
  });

  it("refuse it in a Form: the Form belongs to the raiser (ADR 0019)", () => {
    const form: FormSchema = formSchema.parse({
      sections: [
        { key: "general", title: label("General"), fields: [field] },
        { key: "classification", title: label("Classification"), fields: [{ key: "trade", type: "trade", label: label("Trade") }, { key: "location", type: "location", label: label("Location") }, { key: "scopes", type: "scopes", label: label("Scopes") }] },
      ],
    });
    expect(publishProblems(form)).toEqual([{ key: "inspection_checklist", code: "screen_only" }]);
  });

  it("refuse a condition that reads it: it holds no answer of the pop-up's", () => {
    const reads = { ...remarks, visible_if: { field: "inspection_checklist", op: "not_empty" } };
    expect(screenProblems(screen(field, reads), [])).toEqual([{ key: "remarks", code: "unknown_reference" }]);
  });
});

describe("the pop-up's answers", () => {
  it("never take it: its answers are saved beforehand and the Transition takes them", () => {
    const schema = formSchema.parse(screen(field, remarks));
    expect(validateAnswers(schema, { remarks: "Fine" }, "complete")).toEqual({ ok: true, answers: { remarks: "Fine" } });
    expect(validateAnswers(schema, { inspection_checklist: { formwork: { answer: "pass" } } }, "complete")).toEqual({
      ok: false,
      errors: [{ key: "inspection_checklist", code: "wrong_type" }],
    });
  });
});

describe("checkReplyChecklist", () => {
  it("is the copy's items under the Screen field's key, required as the field says", () => {
    expect(checklist).toMatchObject({ key: "inspection_checklist", type: "checklist", required: true, items: copy.items.map((i) => ({ key: i.key })) });
  });

  it("saves any answers so far, checked item by item, the blank ones dropped", () => {
    expect(checkReplyChecklist(checklist, { formwork: { answer: "fail" }, cover: { comment: " " } }, "draft", {})).toEqual({
      ok: true,
      answers: { formwork: { answer: "fail" } },
    });
    expect(checkReplyChecklist(checklist, { clean: { answer: "pass" }, extra: { answer: "pass" } }, "draft", {})).toEqual({
      ok: false,
      errors: [
        { key: "inspection_checklist", code: "unknown_field", item: "extra" },
        { key: "inspection_checklist", code: "unknown_option", item: "clean" },
      ],
    });
  });

  it("to leave the Step, wants every item answered, and a Fail's required comment and photo, naming the item", () => {
    const answers = { formwork: { answer: "fail" }, cover: { answer: "pass" } };
    expect(checkReplyChecklist(checklist, answers, "complete", {})).toEqual({
      ok: false,
      errors: [
        { key: "inspection_checklist", code: "comment_required", item: "formwork" },
        { key: "inspection_checklist", code: "photo_required", item: "formwork" },
        { key: "inspection_checklist", code: "required", item: "clean" },
      ],
    });
    const complete = { formwork: { answer: "fail", comment: "Gap at the joint" }, cover: { answer: "pass" }, clean: { answer: "na" } };
    expect(checkReplyChecklist(checklist, complete, "complete", { "inspection_checklist.formwork": 1 })).toEqual({ ok: true, answers: complete });
  });
});

describe("the \"Raise a Snag\" tick (RP-577)", () => {
  it("is kept only when unticked: ticked is the default, so a tick given is dropped", () => {
    const answers = { formwork: { answer: "fail", comment: "Gap", snag: false }, cover: { answer: "fail", snag: true } };
    expect(checkReplyChecklist(checklistOf("create_snag"), answers, "draft", {})).toEqual({
      ok: true,
      answers: { formwork: { answer: "fail", comment: "Gap", snag: false }, cover: { answer: "fail" } },
    });
  });

  it("is refused on an item that raises no Snag, and when it is not true or false", () => {
    expect(checkReplyChecklist(checklist, { cover: { answer: "fail", snag: false } }, "draft", {})).toEqual({
      ok: false,
      errors: [{ key: "inspection_checklist", code: "wrong_type", item: "cover" }],
    });
    expect(checkReplyChecklist(checklist, { formwork: { answer: "fail", snag: "no" } }, "draft", {})).toEqual({
      ok: false,
      errors: [{ key: "inspection_checklist", code: "wrong_type", item: "formwork" }],
    });
  });

  it("raises a Snag from an item answered Fail or No that raises one, unless unticked", () => {
    const items = checklistOf("create_snag").items;
    expect(snagsToRaise(items, { formwork: { answer: "fail" }, cover: { answer: "fail", snag: false }, clean: { answer: "no" } })).toEqual(["formwork", "clean"]);
    expect(snagsToRaise(items, { formwork: { answer: "pass" }, cover: { answer: "na" } })).toEqual([]);
    expect(snagsToRaise(checklist.items, { formwork: { answer: "fail" }, cover: { answer: "fail" } })).toEqual(["formwork"]);
  });
});

describe("a reply checklist as read", () => {
  const read = { fieldKey: "inspection_checklist", label: label("Checklist"), name: copy.name, items: copy.items, required: true, answers: {}, canChange: true };

  it("is drawn as the same checklist the api checks", () => {
    expect(checklistOfRead(read)).toEqual(checklist);
    expect(checklistOfRead({ ...read, required: false }).required).toBe(false);
  });

  it("proposes the code of all a Transition's checklists: C when any item of any failed, else A; none without checklists", () => {
    expect(checklistsPropose([])).toBeNull();
    expect(checklistsPropose([{ ...read, answers: { formwork: { answer: "pass" } } }])).toBe("A");
    expect(checklistsPropose([{ ...read, answers: { formwork: { answer: "pass" } } }, { ...read, answers: { clean: { answer: "no" } } }])).toBe("C");
  });
});

describe("proposedCode", () => {
  it("is C when any item failed, else A", () => {
    expect(proposedCode({ formwork: { answer: "fail" }, cover: { answer: "pass" } })).toBe("C");
    expect(proposedCode({ clean: { answer: "no" } })).toBe("C");
    expect(proposedCode({ formwork: { answer: "pass" }, cover: { answer: "na" }, clean: { answer: "yes" } })).toBe("A");
    expect(proposedCode({})).toBe("A");
  });
});
