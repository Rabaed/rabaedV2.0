import type { BilingualText } from "./company.ts";
import type { Validation } from "./workflow-definition.ts";

// What a Transition's Validate rule says when it refuses the move (WF-7;
// workflow-engine.md §5.1): the rule's own message for a condition, else a fixed
// one, in English and Arabic. It names only the item's own Form fields, which the
// Member taking the Transition reads.

/**
 * The message of Validate rule `rule`, refused. `fieldLabel` gives the label of
 * one of the item's Form (or the Transition's Action Form) fields; null when it
 * has none by that key.
 */
export function validationMessage(rule: Validation, fieldLabel: (key: string) => BilingualText | null): BilingualText {
  switch (rule.type) {
    case "condition":
      return rule.message;
    case "form_complete":
      return { en: "Complete the Form before you take this step.", ar: "أكمل النموذج قبل اتخاذ هذه الخطوة." };
    case "has_document": {
      const label = rule.field === undefined ? null : fieldLabel(rule.field);
      return label === null
        ? { en: "Add at least one Document first.", ar: "أضف مستندًا واحدًا على الأقل أولًا." }
        : { en: `Add at least one Document to ${label.en} first.`, ar: `أضف مستندًا واحدًا على الأقل إلى ${label.ar} أولًا.` };
    }
  }
}
