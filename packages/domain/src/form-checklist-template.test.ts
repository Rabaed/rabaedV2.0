import { describe, expect, it } from "vitest";
import { notInActionForm } from "./action-form.ts";
import { checklistCopy, checklistTemplateChoices, checklistTemplateRequest, type ChecklistTemplate } from "./checklist-template.ts";
import { formatFormValue } from "./form-display.ts";
import { changedChecklistTemplates, formSchema, validateAnswers, type FormSchema, type ValidationContext } from "./form.ts";
import { publishProblems } from "./form-publish.ts";

// Seam 3: Checklist Templates and the `checklist_template` field (RP-651, spec RP-649;
// form-engine.md §3.2). The answer is the id of a template's Version. A new choice is
// the latest Version of an active template of the item's Trade; one the item already
// holds stays, edited or retired since, until the Trade changes, which clears it.

const label = (en: string) => ({ en, ar: `${en} ع` });
const schema: FormSchema = formSchema.parse({
  sections: [
    { key: "checklist", title: label("Checklist"), fields: [{ key: "checklist_template", type: "checklist_template", label: label("Checklist"), required: true }] },
    {
      key: "classification",
      title: label("Classification"),
      fields: [
        { key: "trade", type: "trade", label: label("Trade") },
        { key: "location", type: "location", label: label("Location") },
        { key: "scopes", type: "scopes", label: label("Scopes") },
      ],
    },
  ],
});

const civil = "00000000-0000-4000-8000-0000000000c1";
const electrical = "00000000-0000-4000-8000-0000000000e1";
const location = "00000000-0000-4000-8000-000000000002";
const pourV1 = "00000000-0000-4000-8000-0000000000a1";
const pourV2 = "00000000-0000-4000-8000-0000000000a2";
const blockwork = "00000000-0000-4000-8000-0000000000a3";
const trays = "00000000-0000-4000-8000-0000000000a4";
const items = [{ key: "rebar_cover", text: label("Rebar cover as per drawing") }];
const parsedItems = checklistTemplateRequest.shape.items.parse(items);

const template = (over: Partial<ChecklistTemplate>): ChecklistTemplate => ({
  id: "00000000-0000-4000-8000-0000000000f1",
  versionId: pourV2,
  versionNo: 2,
  name: label("Concrete pour"),
  tradeId: civil,
  status: "active",
  items: parsedItems,
  ...over,
});
const templates: ValidationContext["checklistTemplates"] = checklistTemplateChoices(
  [
    template({}),
    template({ id: "00000000-0000-4000-8000-0000000000f2", versionId: blockwork, versionNo: 1, name: label("Blockwork"), status: "retired" }),
    template({ id: "00000000-0000-4000-8000-0000000000f3", versionId: trays, versionNo: 1, name: label("Cable trays"), tradeId: electrical }),
  ],
  [checklistCopy.parse({ fieldKey: "checklist_template", templateId: "00000000-0000-4000-8000-0000000000f1", versionId: pourV1, versionNo: 1, name: label("Concrete pour"), tradeId: civil, items: parsedItems })],
);

const check = (answers: Record<string, unknown>, context: ValidationContext = {}, mode: "draft" | "complete" = "draft") =>
  validateAnswers(schema, { trade: civil, location, ...answers }, mode, { checklistTemplates: templates, ...context });

describe("a Checklist Template's items", () => {
  it("are checklist items whose negative answer raises a Snag unless they say none", () => {
    expect(parsedItems).toEqual([
      { key: "rebar_cover", text: label("Rebar cover as per drawing"), answers: "pass_fail_na", comment: "optional", photo: "off", on_negative: "create_snag" },
    ]);
    const none = checklistTemplateRequest.shape.items.parse([{ ...items[0], on_negative: "none" }]);
    expect(none[0]!.on_negative).toBe("none");
  });

  it("are 1 to 100, each key once, and a template has both names", () => {
    const request = (over: Record<string, unknown>) => checklistTemplateRequest.safeParse({ name: label("Concrete pour"), tradeId: civil, items, ...over }).success;
    expect(request({})).toBe(true);
    expect(request({ items: [] })).toBe(false);
    expect(request({ items: [...items, ...items] })).toBe(false);
    expect(request({ items: Array.from({ length: 101 }, (_, i) => ({ key: `item_${i}`, text: label(`Check ${i}`) })) })).toBe(false);
    expect(request({ name: { en: "Concrete pour", ar: "  " } })).toBe(false);
    expect(request({ items: [{ ...items[0], on_negative: "raise" }] })).toBe(false);
  });
});

describe("the checklist_template field", () => {
  it("passes the publish checks, and an Action Form can't hold it", () => {
    expect(publishProblems(schema)).toEqual([]);
    expect(notInActionForm).toContain("checklist_template");
  });

  it("takes the latest Version of an active template of the item's Trade", () => {
    expect(check({ checklist_template: pourV2 })).toEqual({ ok: true, answers: { trade: civil, location, checklist_template: pourV2 } });
  });

  it("refuses another Trade's template, a retired one, an earlier Version and a made-up id as unknown_option", () => {
    for (const value of [trays, blockwork, pourV1, "00000000-0000-4000-8000-0000000000ff"]) {
      expect(check({ checklist_template: value })).toEqual({ ok: false, errors: [{ key: "checklist_template", code: "unknown_option" }] });
    }
    expect(check({ checklist_template: 7 })).toEqual({ ok: false, errors: [{ key: "checklist_template", code: "wrong_type" }] });
  });

  it("keeps the Version the item already holds, edited since, also leaving Draft", () => {
    expect(check({ checklist_template: pourV1 }, { held: { checklist_template: pourV1 } }, "complete")).toMatchObject({ ok: true });
  });

  it("is required to leave Draft, per field", () => {
    expect(check({}, {}, "complete")).toEqual({ ok: false, errors: [{ key: "checklist_template", code: "required" }] });
    expect(check({})).toMatchObject({ ok: true });
  });

  it("clears the held template when the Trade changes to another's, and refuses a new one of the old Trade", () => {
    const moved = validateAnswers(schema, { trade: electrical, location, checklist_template: pourV1 }, "draft", { checklistTemplates: templates, held: { checklist_template: pourV1 } });
    expect(moved).toEqual({ ok: true, answers: { trade: electrical, location } });
    const fresh = validateAnswers(schema, { trade: electrical, location, checklist_template: pourV2 }, "draft", { checklistTemplates: templates });
    expect(fresh).toEqual({ ok: false, errors: [{ key: "checklist_template", code: "unknown_option" }] });
  });

  it("says which picks an answer changes, for the item's first Submit to fix them", () => {
    expect(changedChecklistTemplates(schema, { checklist_template: pourV1 }, { checklist_template: pourV1, trade: electrical })).toEqual([]);
    expect(changedChecklistTemplates(schema, { checklist_template: pourV1 }, { checklist_template: pourV2 })).toEqual(["checklist_template"]);
    expect(changedChecklistTemplates(schema, { checklist_template: pourV1 }, {})).toEqual(["checklist_template"]);
    expect(changedChecklistTemplates(schema, {}, {})).toEqual([]);
  });

  it("reads as the template's name, in either language", () => {
    const field = schema.sections[0]!.fields[0]!;
    if (field.type !== "checklist_template") throw new Error("not the field");
    expect(formatFormValue(field, pourV1, "ar", undefined, [], {}, [], templates)).toBe("Concrete pour ع");
    expect(formatFormValue(field, pourV1, "en", undefined, [], {}, [], templates)).toBe("Concrete pour");
    expect(formatFormValue(field, "00000000-0000-4000-8000-0000000000ff", "en", undefined, [], {}, [], templates)).toBe("");
  });
});
