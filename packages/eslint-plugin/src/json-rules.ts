import type { JSONRuleDefinition } from "@eslint/json";
import { deadlineWord, deadlineWordInCopy } from "./matchers.ts";

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
