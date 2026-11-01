import type { Rule } from "eslint";
import type { CallExpression, Expression, Identifier, MemberExpression, Node, Super } from "estree";

// A PR could turn a test off and stay green on CI (RP-1196): `it.skip`, `it.todo`, `xit`, `it.skipIf(true)`, or
// `it.only`, which turns every other test of the file off. These rules run on the test files (eslint.config.js),
// where inline config is off, so no eslint-disable comment can switch them off either.

const testFunctions = new Set(["it", "test", "describe", "suite"]);
const xPrefixed = new Set(["xit", "xtest", "xdescribe"]);
const fPrefixed = new Set(["fit", "ftest", "fdescribe"]);
/** Modifiers after which a block never runs (`scripts/test-titles.ts` keeps the same list for its checks). */
const neverRuns = new Set(["skip", "todo"]);
const conditional = new Set(["skipIf", "runIf"]);

const propertyName = (member: MemberExpression): string | undefined => {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.property.type === "Literal" && typeof member.property.value === "string") return member.property.value;
  return undefined;
};

/** The identifier a test call starts from and the modifiers on the way: `it` and [`skip`, `each`] for `it.skip.each([…])(…)`. */
function callChain(callee: Expression | Super): { root?: Identifier; modifiers: { name: string; member: MemberExpression }[] } {
  const modifiers: { name: string; member: MemberExpression }[] = [];
  let current: Node = callee;
  for (;;) {
    if (current.type === "Identifier") return { root: current, modifiers: modifiers.reverse() };
    if (current.type === "MemberExpression") {
      const name = propertyName(current);
      if (name === undefined) return { modifiers };
      modifiers.push({ name, member: current });
      current = current.object;
    } else if (current.type === "CallExpression") current = current.callee;
    else return { modifiers };
  }
}

/** Whether `name` is the file's own function (`function xit() {}`), not vitest's global or import. */
function declaredLocally(context: Rule.RuleContext, node: Node, name: string): boolean {
  for (let scope: ReturnType<typeof context.sourceCode.getScope> | null = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable && variable.defs.length > 0) return variable.defs.every((def) => def.type !== "ImportBinding");
  }
  return false;
}

type Static = { value: unknown } | null;

// TypeScript wrappers that leave the value as it is: `x as boolean`, `x!`, `x satisfies boolean`.
const transparent = new Set(["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion"]);

/** The value of an expression made only of constants, or null when it depends on anything at runtime. */
function staticValue(node: Node): Static {
  if (transparent.has(node.type as string)) return staticValue((node as unknown as { expression: Node }).expression);
  switch (node.type) {
    case "Literal":
      return { value: node.value };
    case "TemplateLiteral":
      return node.expressions.length === 0 ? { value: node.quasis.map((q) => q.value.cooked).join("") } : null;
    case "Identifier":
      if (node.name === "undefined") return { value: undefined };
      if (node.name === "NaN") return { value: NaN };
      if (node.name === "Infinity") return { value: Infinity };
      return null;
    case "UnaryExpression": {
      if (node.operator === "void") return { value: undefined };
      const argument = staticValue(node.argument);
      if (!argument) return null;
      const v = argument.value as number;
      if (node.operator === "!") return { value: !v };
      if (node.operator === "-") return { value: -v };
      if (node.operator === "+") return { value: +v };
      if (node.operator === "typeof") return { value: typeof v };
      return null;
    }
    case "BinaryExpression": {
      if (node.left.type === "PrivateIdentifier") return null;
      const left = staticValue(node.left);
      const right = staticValue(node.right);
      if (!left || !right) return null;
      const [a, b] = [left.value as number, right.value as number];
      const operations: Record<string, () => unknown> = {
        "===": () => a === b,
        "!==": () => a !== b,
        "==": () => a == b,
        "!=": () => a != b,
        "<": () => a < b,
        ">": () => a > b,
        "<=": () => a <= b,
        ">=": () => a >= b,
        "+": () => a + b,
        "-": () => a - b,
        "*": () => a * b,
        "/": () => a / b,
        "%": () => a % b,
      };
      const operation = operations[node.operator];
      return operation ? { value: operation() } : null;
    }
    default:
      return null;
  }
}

/** Whether the expression is always truthy (true), always falsy (false), or decided at runtime (undefined). */
function constantTruth(node: Node): boolean | undefined {
  if (transparent.has(node.type as string)) return constantTruth((node as unknown as { expression: Node }).expression);
  const known = staticValue(node);
  if (known) return Boolean(known.value);
  switch (node.type) {
    case "ArrayExpression":
    case "ObjectExpression":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "ClassExpression":
    case "NewExpression":
      return true;
    case "TemplateLiteral":
      return node.quasis.some((q) => q.value.cooked) ? true : undefined;
    case "UnaryExpression": {
      if (node.operator !== "!") return undefined;
      const inner = constantTruth(node.argument);
      return inner === undefined ? undefined : !inner;
    }
    case "LogicalExpression": {
      const left = constantTruth(node.left);
      const right = constantTruth(node.right);
      if (node.operator === "||") return left === true ? true : left === false ? right : right === true ? true : undefined;
      if (node.operator === "&&") return left === false ? false : left === true ? right : right === false ? false : undefined;
      return undefined;
    }
    case "ConditionalExpression": {
      const test = constantTruth(node.test);
      if (test !== undefined) return constantTruth(test ? node.consequent : node.alternate);
      const [a, b] = [constantTruth(node.consequent), constantTruth(node.alternate)];
      return a === b ? a : undefined;
    }
    case "SequenceExpression":
      return constantTruth(node.expressions.at(-1)!);
    default:
      return undefined;
  }
}

const directive = /^(eslint-disable(?:-next-line|-line)?|eslint)(?:\s|$)/u;

/**
 * Reports each comment that would switch `rule` off: an `eslint-disable` in any form naming it, or naming no rule
 * (which disables them all), and an `eslint` config comment setting it. Inline config is off in the test files
 * (eslint.config.js), so the comment has no effect there; this says so as an error rather than a warning.
 */
function refuseDisables(context: Rule.RuleContext, rule: string) {
  const named = new RegExp(`(?<![\\w/-])${rule.replace("/", "\\/")}(?![\\w/-])`, "u");
  for (const comment of context.sourceCode.getAllComments()) {
    // The reason after ` -- ` is no part of the directive, as ESLint reads it.
    const [text = ""] = comment.value.trim().split(/\s-{2,}\s/u);
    const match = directive.exec(text);
    if (!match) continue;
    const list = text.slice(match[0].length);
    const disablesAll = match[1] !== "eslint" && list.trim() === "";
    if (disablesAll || named.test(list)) context.report({ loc: comment.loc!, messageId: "disableRefused", data: { rule } });
  }
}

const disableRefused =
  "A test file can't switch {{rule}} off (RP-1196): make the test run, or delete it. Inline config is off in test files, so this comment changes nothing.";

/** The test call `node` is, if any: its root name and modifiers, unless the root is the file's own function. */
function testCall(context: Rule.RuleContext, node: CallExpression) {
  const { root, modifiers } = callChain(node.callee);
  if (!root || declaredLocally(context, node, root.name)) return undefined;
  return { root: root.name, modifiers };
}

export const noDisabledTests: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "No disabled test: .skip, .todo, an x-prefixed test, or .skipIf/.runIf with a constant condition (RP-1196)." },
    messages: {
      disabled:
        "This test never runs, and CI stays green without it (RP-1196). Delete it, or make it run. A test that can only run somewhere (a platform, a tool, a file) takes .skipIf/.runIf with that runtime condition.",
      disableRefused,
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        refuseDisables(context, "rabaed/no-disabled-tests");
      },
      CallExpression(node: CallExpression) {
        // The outermost call of a chain is the one checked: `it.skip.each([…])(…)` is reported once, at `it.skip.each([…])`.
        if (node.callee.type === "CallExpression") return;
        const call = testCall(context, node);
        if (!call) return;
        const skipped = testFunctions.has(call.root) && call.modifiers.some((m) => neverRuns.has(m.name));
        if (skipped || xPrefixed.has(call.root)) context.report({ node, messageId: "disabled" });
      },
      // `it.skipIf(<condition>)(…)`: the inner call holds the condition.
      "CallExpression > CallExpression.callee"(node: CallExpression) {
        if (node.callee.type !== "MemberExpression") return;
        const name = propertyName(node.callee);
        if (!name || !conditional.has(name)) return;
        const call = testCall(context, node);
        if (!call || !testFunctions.has(call.root)) return;
        const [condition] = node.arguments;
        if (condition && condition.type !== "SpreadElement" && constantTruth(condition) !== undefined) context.report({ node, messageId: "disabled" });
      },
    };
  },
};

export const noFocusedTests: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "No focused test: .only, fit or fdescribe, which turn every other test of the file off (RP-1196)." },
    messages: {
      focused: "A focused test turns every other test of its file off, and CI stays green without them (RP-1196). Remove the .only.",
      disableRefused,
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        refuseDisables(context, "rabaed/no-focused-tests");
      },
      CallExpression(node: CallExpression) {
        if (node.callee.type === "CallExpression") return;
        const call = testCall(context, node);
        if (!call) return;
        if (fPrefixed.has(call.root) || (testFunctions.has(call.root) && call.modifiers.some((m) => m.name === "only"))) {
          context.report({ node, messageId: "focused" });
        }
      },
    };
  },
};
