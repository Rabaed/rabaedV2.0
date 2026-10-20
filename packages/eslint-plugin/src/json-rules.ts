import type { JSONRuleDefinition } from "@eslint/json";
import { deadlineWord, deadlineWordInCopy, hasPluralPound } from "./matchers.ts";

/** UI message catalogues (apps/web/messages/*.json): no deadline words in keys or copy. */
export const jsonNoDeadlineWords: JSONRuleDefinition<{ MessageIds: "key" | "value" }> = {
  meta: {
    type: "problem",
    docs: { description: "Rabaed shows Step Age only: no overdue, due date, deadline or SLA in message keys, and no due or late in message text either." },
    messages: {
      key: "Message key has '{{word}}': Rabaed shows Step Age only, never due dates, deadlines, SLAs or overdue.",
      value: "Message text has '{{word}}': Rabaed shows Step Age only, e.g. '4+ weeks at this step'.",
    },
    schema: [],
  },
  create(context) {
    return {
      Member(node) {
        const keyWord = deadlineWord(node.name.type === "String" ? node.name.value : node.name.name);
        if (keyWord) context.report({ loc: node.name.loc, messageId: "key", data: { word: keyWord } });
        if (node.value.type === "String") {
          const valueWord = deadlineWordInCopy(node.value.value);
          if (valueWord) context.report({ loc: node.value.loc, messageId: "value", data: { word: valueWord } });
        }
      },
    };
  },
};

/** UI message catalogues: a plural's `#` prints the count in Arabic-Indic digits in Arabic (RP-1022). */
export const jsonNoPluralPound: JSONRuleDefinition<{ MessageIds: "pound" }> = {
  meta: {
    type: "problem",
    docs: { description: "No # inside a plural or selectordinal in message files: Arabic keeps Latin digits only through formatNumber." },
    messages: {
      pound: "Message {{key}} prints a plural's #, which renders Arabic-Indic digits in Arabic. Write {n} and pass n: formatNumber(count, locale) beside count.",
    },
    schema: [],
  },
  create(context) {
    const path: string[] = [];
    return {
      Member(node) {
        path.push(node.name.type === "String" ? node.name.value : node.name.name);
        if (node.value.type === "String" && hasPluralPound(node.value.value)) {
          context.report({ loc: node.value.loc, messageId: "pound", data: { key: path.join(".") } });
        }
      },
      "Member:exit"() {
        path.pop();
      },
    };
  },
};
