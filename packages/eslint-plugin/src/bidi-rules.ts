import type { Rule } from "eslint";
import type { JSONRuleDefinition } from "@eslint/json";
import { bidiControls } from "./matchers.ts";

const messages = {
  raw: "Raw bidi control character {{escape}} ({{name}}) is invisible in review. Write it as the escape {{escape}}.",
};

/** JS, TS and TSX: a raw bidi character in a string, template, regex or comment is rewritten as an escape. */
export const noRawBidi: Rule.RuleModule = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: { description: "Write bidi control characters (isolates, marks, embeddings) as \\u escapes, never as raw characters." },
    messages,
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        const comments = sourceCode.getAllComments();
        for (const { index, escape, name } of bidiControls(sourceCode.text)) {
          const node = sourceCode.getNodeByRangeIndex(index) as unknown as { type: string; parent?: { type: string } } | null;
          const inComment = comments.some((c) => c.range![0] <= index && index < c.range![1]);
          // An escape is valid in a string, template, regex or comment, but not in JSX text or a JSX attribute string.
          const inJsx = node?.type === "JSXText" || (node?.type === "Literal" && node.parent?.type === "JSXAttribute");
          const escapable = inComment || (!inJsx && (node?.type === "Literal" || node?.type === "TemplateElement"));
          context.report({
            loc: { start: sourceCode.getLocFromIndex(index), end: sourceCode.getLocFromIndex(index + 1) },
            messageId: "raw",
            data: { escape, name },
            fix: escapable ? (fixer) => fixer.replaceTextRange([index, index + 1], escape) : null,
          });
        }
      },
    };
  },
};

/** The web's messages/*.json: every raw bidi character is inside a string, where the escape is valid. */
export const jsonNoRawBidi: JSONRuleDefinition<{ MessageIds: "raw" }> = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: { description: "Write bidi control characters as \\u escapes in message files, never as raw characters." },
    messages,
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Document() {
        for (const { index, escape, name } of bidiControls(sourceCode.text)) {
          context.report({
            loc: { start: sourceCode.getLocFromIndex(index), end: sourceCode.getLocFromIndex(index + 1) },
            messageId: "raw",
            data: { escape, name },
            fix: (fixer) => fixer.replaceTextRange([index, index + 1], escape),
          });
        }
      },
    };
  },
};
