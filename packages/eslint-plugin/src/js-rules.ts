import type { Rule } from "eslint";
import type { Node } from "estree";
import {
  arbitraryColourClasses,
  camelCase,
  colourLiterals,
  deadlineWord,
  kebabCase,
  logicalProperty,
  logicalValue,
  namedColour,
  physicalClasses,
} from "./matchers.ts";

type StringNode = Extract<Node, { type: "Literal" | "TemplateElement" }>;
type ParentedNode = Node & { parent?: ParentedNode };

function stringValue(node: StringNode): string | null {
  if (node.type === "TemplateElement") return node.value.cooked ?? node.value.raw;
  return typeof node.value === "string" ? node.value : null;
}

/** Visits every string literal and template-literal chunk. */
function onStrings(check: (node: StringNode, text: string) => void): Rule.RuleListener {
  const visit = (node: StringNode) => {
    const text = stringValue(node);
    if (text) check(node, text);
  };
  return { Literal: visit, TemplateElement: visit };
}

// Functions whose string arguments are Tailwind class lists (plus any cva result named *Variants).
const classFunctions = new Set(["cn", "clsx", "cva", "twMerge"]);
const isClassFunction = (name: string) => classFunctions.has(name) || name.endsWith("Variants");

// JSX attributes whose values are links or ids, where "#abc" is a fragment, not a colour.
const linkAttributes = new Set(["href", "to", "id", "htmlFor", "aria-controls", "aria-labelledby", "aria-describedby"]);

function isLinkAttribute(node: ParentedNode): boolean {
  const parent = node.parent as { type: string; name?: { name?: unknown } } | undefined;
  return parent?.type === "JSXAttribute" && linkAttributes.has(String(parent.name?.name));
}

/** The properties of a JSX `style={{ … }}` object. */
const styleProperty = "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property";

/** True when the string is (part of) a Tailwind class list: a `className` value or an argument of cn(), cva()… */
function isClassString(node: ParentedNode): boolean {
  type AnyNode = { type: string; parent?: AnyNode; name?: { name?: unknown }; callee?: { type: string; name?: string } };
  for (let n = (node as unknown as AnyNode).parent; n; n = n.parent) {
    if (n.type === "JSXAttribute") return n.name?.name === "className" || n.name?.name === "class";
    if (n.type === "CallExpression") return n.callee?.type === "Identifier" && isClassFunction(n.callee.name!);
    if (/Function|Program|Statement|Declaration$/.test(n.type)) return false;
  }
  return false;
}

export const noHardcodedColour: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Use design tokens, not hard-coded colours or Tailwind arbitrary colour values." },
    messages: {
      colour: "Hard-coded colour '{{found}}'. Use a semantic token (a class such as bg-primary, or var(--primary)).",
      namedColour: "Named colour '{{found}}'. Use a semantic token such as var(--text).",
      arbitraryColour: "Arbitrary colour class '{{found}}'. Use a semantic token class such as text-muted.",
    },
    schema: [],
  },
  create: (context) => ({
    ...onStrings((node, text) => {
      if (isLinkAttribute(node)) return;
      for (const found of colourLiterals(text)) context.report({ node, messageId: "colour", data: { found } });
      for (const found of arbitraryColourClasses(text)) {
        if (colourLiterals(found).length === 0) context.report({ node, messageId: "arbitraryColour", data: { found } });
      }
    }),
    [styleProperty](node: Rule.Node) {
      if (node.type !== "Property" || node.key.type !== "Identifier") return;
      if (node.value.type !== "Literal" || typeof node.value.value !== "string") return;
      const found = namedColour(node.key.name, node.value.value);
      if (found) context.report({ node: node.value, messageId: "namedColour", data: { found } });
    },
  }),
};

export const noPhysicalDirection: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Use logical (start/end) CSS, not physical left/right, so layouts mirror in Arabic." },
    messages: {
      class: "Physical class '{{found}}' does not mirror in RTL. Use '{{logical}}'.",
      style: "Physical style '{{found}}' does not mirror in RTL. Use '{{logical}}'.",
      styleValue: "'{{found}}' does not mirror in RTL. Use '{{logical}}'.",
    },
    schema: [],
  },
  create: (context) => ({
    ...onStrings((node, text) => {
      if (!isClassString(node)) return;
      for (const data of physicalClasses(text)) context.report({ node, messageId: "class", data });
    }),
    [styleProperty](node: Rule.Node) {
      if (node.type !== "Property" || node.key.type !== "Identifier") return;
      const key = node.key.name;
      const logical = logicalProperty(kebabCase(key));
      if (logical) context.report({ node: node.key, messageId: "style", data: { found: key, logical: camelCase(logical) } });
      if (node.value.type === "Literal" && typeof node.value.value === "string") {
        const logicalVal = logicalValue(kebabCase(key), node.value.value);
        if (logicalVal) context.report({ node: node.value, messageId: "styleValue", data: { found: node.value.value, logical: logicalVal } });
      }
    },
  }),
};

// Names that declare something (a prop, variable, field or type), rather than just use it.
const declaringParents = new Set([
  "VariableDeclarator",
  "FunctionDeclaration",
  "Property",
  "PropertyDefinition",
  "MethodDefinition",
  "TSPropertySignature",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "ClassDeclaration",
  "AssignmentPattern",
]);

export const noDeadlineWords: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Rabaed shows Step Age only: no overdue, due date, deadline or SLA props, names or message keys." },
    messages: {
      word: "'{{word}}': Rabaed shows Step Age only, never due dates, deadlines, SLAs or overdue. Use weeks at step (Step Age).",
    },
    schema: [],
  },
  create(context) {
    const reported = new Set<string>();
    const report = (node: Node, name: string) => {
      const word = deadlineWord(name);
      const key = String(node.range);
      if (!word || reported.has(key)) return;
      reported.add(key);
      context.report({ node, messageId: "word", data: { word } });
    };
    return {
      Identifier(node) {
        const parent = (node as ParentedNode).parent;
        const isParam = parent && "params" in parent && (parent.params as Node[]).includes(node);
        if (parent && (declaringParents.has(parent.type) || isParam)) report(node, node.name);
      },
      JSXAttribute(node: Rule.Node) {
        const attribute = node as unknown as { name: Node & { type: string; name: unknown } };
        if (typeof attribute.name.name === "string") report(attribute.name, attribute.name.name);
      },
      // Message keys passed to next-intl's t("…"), t.rich("…"), t.markup("…")…
      "CallExpression:matches([callee.name='t'], [callee.object.name='t']) > Literal"(node: Rule.Node) {
        if (node.type === "Literal" && typeof node.value === "string") report(node, node.value);
      },
    };
  },
};
