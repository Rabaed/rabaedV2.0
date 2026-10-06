import type { Rule } from "eslint";
import type { Node } from "estree";
import {
  arbitraryColourClasses,
  camelCase,
  colourLiterals,
  awsIdentifierIn,
  deadlineWord,
  kebabCase,
  logicalProperty,
  logicalValue,
  namedColour,
  physicalClasses,
} from "./matchers.ts";

export type StringNode = Extract<Node, { type: "Literal" | "TemplateElement" }>;
export type ParentedNode = Node & { parent?: ParentedNode };

export function stringValue(node: StringNode): string | null {
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
export function isClassString(node: ParentedNode): boolean {
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
export const declaringParents = new Set([
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
    return onDeclaredNames(report);
  },
};

/**
 * Visits the names code declares: variables, functions, props, fields, types, parameters, JSX attribute
 * names, and the message keys passed to next-intl's t("…"), t.rich("…"), t.markup("…")… Shared by
 * no-deadline-words and no-avoid-terms, so both rules read the same names.
 */
export function onDeclaredNames(report: (node: Node, name: string) => void): Rule.RuleListener {
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
    "CallExpression:matches([callee.name='t'], [callee.object.name='t']) > Literal"(node: Rule.Node) {
      if (node.type === "Literal" && typeof node.value === "string") report(node, node.value);
    },
  };
}

const logLevels = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);
const errorName = /^(e|err|error|\w+Error)$/;

type AnyNode = { type: string; [key: string]: unknown };

/** `log.error(…)`, `logger.warn(…)`, `request.log.info(…)`, `app.log.…`. Not `console`, which only the local CLIs use. */
export function isLogCall(node: Node): boolean {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return false;
  const { property } = node.callee;
  let object = node.callee.object;
  // log.child({ … }).error(…)
  while (object.type === "CallExpression" && object.callee.type === "MemberExpression" && object.callee.property.type === "Identifier" && object.callee.property.name === "child") object = object.callee.object;
  if (property.type !== "Identifier" || !logLevels.has(property.name)) return false;
  if (object.type === "Identifier") return object.name === "log" || object.name === "logger";
  return object.type === "MemberExpression" && object.property.type === "Identifier" && object.property.name === "log";
}

/** `error`, `err`, `e`, `dbError`…, also as `(error as Error)` or `error!`. */
function isErrorValue(node: AnyNode): boolean {
  if (node.type === "TSAsExpression" || node.type === "TSNonNullExpression") return isErrorValue(node.expression as AnyNode);
  return node.type === "Identifier" && errorName.test(String(node.name));
}

export const noRawErrorLogging: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Log an error by class and code, never its message: PostgreSQL messages and details can quote customer content (RP-238).",
    },
    messages: {
      message:
        "Do not log an error's message: it can quote customer content. Log the error as `{ err: error }` (the logger's serializer keeps class and code, as failureOf does), or by class and code.",
      wholeError: "Do not log a whole error under '{{key}}': only `err` goes through the logger's serializer. Use `{ err: error }`, or the class and code.",
    },
    schema: [],
  },
  create(context) {
    const keys = context.sourceCode.visitorKeys;
    const scan = (node: AnyNode): void => {
      if (node.type === "MemberExpression" && !node.computed) {
        const property = node.property as AnyNode;
        if (property.type === "Identifier" && property.name === "message" && isErrorValue(node.object as AnyNode)) {
          context.report({ node: node as unknown as Node, messageId: "message" });
        }
      }
      if (node.type === "TemplateLiteral") {
        for (const expression of node.expressions as AnyNode[]) {
          if (isErrorValue(expression)) context.report({ node: expression as unknown as Node, messageId: "message" });
        }
      }
      if (node.type === "Property" && !node.computed && isErrorValue(node.value as AnyNode)) {
        const key = node.key as AnyNode;
        const name = key.type === "Identifier" ? String(key.name) : String(key.value);
        if (name !== "err") context.report({ node: node as unknown as Node, messageId: "wholeError", data: { key: name } });
      }
      for (const key of keys[node.type] ?? []) {
        const child = node[key] as AnyNode | AnyNode[] | null | undefined;
        for (const item of Array.isArray(child) ? child : [child]) if (item) scan(item);
      }
    };
    return {
      CallExpression(node) {
        if (isLogCall(node)) for (const argument of node.arguments) scan(argument as unknown as AnyNode);
      },
    };
  },
};

const localeMethods = new Set(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]);

/** `intlLocaleOf(locale)`: the one place that says Latin digits, the Gregorian calendar and Saudi regional formats. */
function isIntlLocaleOfCall(node: Node | undefined): boolean {
  if (node?.type !== "CallExpression") return false;
  const { callee } = node;
  if (callee.type === "Identifier") return callee.name === "intlLocaleOf";
  return callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "intlLocaleOf";
}

export const localeThroughHelpers: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Format dates and numbers through the domain locale helpers: Latin digits in Arabic only come from intlLocaleOf (RP-330)." },
    messages: {
      intl: "Intl.{{name}} outside the locale module: use formatDate or formatNumber from @rabaed/domain, or pass intlLocaleOf(locale) as its locale, so Arabic keeps Latin digits.",
      method: "{{name}} outside the locale module: use formatDate or formatNumber from @rabaed/domain, or pass intlLocaleOf(locale) as its locale, so Arabic keeps Latin digits.",
    },
    schema: [],
  },
  create(context) {
    return {
      // new Intl.NumberFormat(…), Intl.DateTimeFormat(…)
      "NewExpression, CallExpression"(node: Rule.Node) {
        if (node.type !== "NewExpression" && node.type !== "CallExpression") return;
        const { callee } = node;
        if (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" && callee.object.name === "Intl" && callee.property.type === "Identifier" && /^[A-Z]/.test(callee.property.name)) {
          if (!isIntlLocaleOfCall(node.arguments[0] as Node | undefined)) context.report({ node, messageId: "intl", data: { name: callee.property.name } });
          return;
        }
        if (node.type === "CallExpression" && callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && localeMethods.has(callee.property.name)) {
          if (!isIntlLocaleOfCall(node.arguments[0] as Node | undefined)) context.report({ node, messageId: "method", data: { name: callee.property.name } });
        }
      },
    };
  },
};

const consoleLevels = new Set(["log", "info", "warn", "error", "debug", "trace"]);

/** `console.error(…)`, which the local CLIs and scripts use. */
export function isConsoleCall(node: Node): boolean {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "console" &&
    node.callee.property.type === "Identifier" &&
    consoleLevels.has(node.callee.property.name)
  );
}

/** `Error`, `TypeError`, `SecretError`…: a name ending in Error. */
export const isErrorConstructor = (callee: Node) => callee.type === "Identifier" && /Error$/.test(callee.name);

export const noAwsIdsInErrors: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Errors and logs name a resource, never its AWS ARN or account id (RP-329)." },
    messages: {
      aws: "'{{found}}': an AWS ARN or account id must not appear in an error or log message. Name the resource (the secret, the bucket), not its ARN or account.",
    },
    schema: [],
  },
  create(context) {
    const keys = context.sourceCode.visitorKeys;
    const reported = new Set<string>();
    const scan = (node: AnyNode): void => {
      if (node.type === "Literal" || node.type === "TemplateElement") {
        const text = stringValue(node as unknown as StringNode);
        const found = text && awsIdentifierIn(text);
        const key = String((node as unknown as Node).range);
        if (found && !reported.has(key)) {
          reported.add(key);
          context.report({ node: node as unknown as Node, messageId: "aws", data: { found } });
        }
      }
      for (const key of keys[node.type] ?? []) {
        const child = node[key] as AnyNode | AnyNode[] | null | undefined;
        for (const item of Array.isArray(child) ? child : [child]) if (item) scan(item);
      }
    };
    return {
      ThrowStatement: (node) => scan(node.argument as unknown as AnyNode),
      // new Error(…), new SecretError(…), and the same called without `new`, which builds the same error.
      NewExpression(node) {
        if (isErrorConstructor(node.callee)) for (const argument of node.arguments) scan(argument as unknown as AnyNode);
      },
      CallExpression(node) {
        if (isLogCall(node) || isConsoleCall(node) || isErrorConstructor(node.callee)) for (const argument of node.arguments) scan(argument as unknown as AnyNode);
      },
    };
  },
};
