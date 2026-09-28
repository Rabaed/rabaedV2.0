import type { CSSRuleDefinition } from "@eslint/css";
import { arbitraryColourClasses, colourLiterals, logicalProperty, logicalValue, namedColour, physicalClasses } from "./matchers.ts";

// Tailwind's `@apply` takes a class list, so the class-list checks apply to it too.
const isApply = (name: string) => name.toLowerCase() === "apply";

export const cssNoHardcodedColour: CSSRuleDefinition<{ MessageIds: "colour" | "arbitraryColour" }> = {
  meta: {
    type: "problem",
    docs: { description: "Use design tokens (var(--role)), not hard-coded colours or the base palette." },
    messages: {
      colour: "Hard-coded colour '{{found}}'. Use a semantic token such as var(--primary).",
      arbitraryColour: "Arbitrary colour class '{{found}}'. Use a semantic token class such as text-muted.",
    },
    schema: [],
  },
  create(context) {
    return {
      Declaration(node) {
        const value = context.sourceCode.getText(node.value as never);
        const found = [...colourLiterals(value, { css: true }), namedColour(node.property, value)].filter((f) => f !== null);
        for (const colour of found) context.report({ loc: node.loc!, messageId: "colour", data: { found: colour } });
      },
      Atrule(node) {
        if (!isApply(node.name) || !node.prelude) return;
        for (const found of arbitraryColourClasses(context.sourceCode.getText(node.prelude as never))) {
          context.report({ loc: node.loc!, messageId: "arbitraryColour", data: { found } });
        }
      },
    };
  },
};

export const cssNoPhysicalDirection: CSSRuleDefinition<{ MessageIds: "property" | "value" | "class" }> = {
  meta: {
    type: "problem",
    docs: { description: "Use logical properties, not physical left/right, so layouts mirror in Arabic." },
    messages: {
      property: "'{{found}}' does not mirror in RTL. Use '{{logical}}'.",
      value: "'{{found}}' does not mirror in RTL. Use '{{logical}}'.",
      class: "Physical class '{{found}}' does not mirror in RTL. Use '{{logical}}'.",
    },
    schema: [],
  },
  create(context) {
    return {
      Declaration(node) {
        const property = node.property.toLowerCase();
        const logical = logicalProperty(property);
        if (logical) context.report({ loc: node.loc!, messageId: "property", data: { found: property, logical } });

        const value = context.sourceCode.getText(node.value as never).trim();
        const logicalVal = logicalValue(property, value);
        if (logicalVal) context.report({ loc: node.loc!, messageId: "value", data: { found: value, logical: logicalVal } });
      },
      Atrule(node) {
        if (!isApply(node.name) || !node.prelude) return;
        for (const data of physicalClasses(context.sourceCode.getText(node.prelude as never))) {
          context.report({ loc: node.loc!, messageId: "class", data });
        }
      },
    };
  },
};
