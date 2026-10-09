import { describe, expect, it } from "vitest";
import { validationMessage } from "./transition-rules.ts";

const datasheet = { en: "Datasheet", ar: "نشرة البيانات" };

describe("validationMessage: what a refused Validate rule says, in English and Arabic", () => {
  it("a condition says its own message", () => {
    const message = { en: "Write the Remarks for Code C.", ar: "اكتب ملاحظات الرمز C." };
    expect(validationMessage({ type: "condition", condition: { field: "remarks", op: "not_empty" }, message }, () => null)).toEqual(message);
  });

  it("the Form complete", () => {
    expect(validationMessage({ type: "form_complete" }, () => null)).toEqual({
      en: "Complete the Form before you take this step.",
      ar: "أكمل النموذج قبل اتخاذ هذه الخطوة.",
    });
  });

  it("a Document, on the item or in a named field", () => {
    expect(validationMessage({ type: "has_document" }, () => null)).toEqual({
      en: "Add at least one Document first.",
      ar: "أضف مستندًا واحدًا على الأقل أولًا.",
    });
    expect(validationMessage({ type: "has_document", field: "datasheet" }, (key) => (key === "datasheet" ? datasheet : null))).toEqual({
      en: "Add at least one Document to Datasheet first.",
      ar: "أضف مستندًا واحدًا على الأقل إلى نشرة البيانات أولًا.",
    });
  });
});
