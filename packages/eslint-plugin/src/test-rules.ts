import type { Rule, Scope } from "eslint";
import type { CallExpression, Expression, Identifier, MemberExpression, Node } from "estree";

// A PR could turn a test off and stay green on CI (RP-1196): `it.skip`, `it.todo`, `xit`, `it.skipIf(true)`, a
// condition on an environment variable CI sets its own way, `ctx.skip()` in the test, or `it.only`, which turns every
// other test of the file off; through an alias (`const s = it.skip`) or a renamed import too. These rules run on the
// test files (eslint.config.js), where inline config is off, so no eslint-disable comment can switch them off either.
// Not followed: a skip passed through a helper function (`it("x", (ctx) => helper(ctx))`), `let` aliases.

const testFunctions = new Set(["it", "test", "describe", "suite"]);
const xPrefixed = new Set(["xit", "xtest", "xdescribe"]);
const fPrefixed = new Set(["fit", "ftest", "fdescribe"]);
/** Modifiers after which a block never runs (`scripts/test-titles.ts` keeps the same list for its checks). */
const neverRuns = new Set(["skip", "todo"]);
const conditional = new Set(["skipIf", "runIf"]);
/** The test functions whose callback gets the test's context as its first parameter (not `.each` or `.for`). */
const withContext = new Set(["it", "test"]);

// TypeScript wrappers that leave the value as it is: `x as boolean`, `x!`, `x satisfies boolean`.
const transparent = new Set(["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion"]);

const propertyName = (member: MemberExpression): string | undefined => {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.property.type === "Literal" && typeof member.property.value === "string") return member.property.value;
  return undefined;
};

/** The identifier a chain starts from and the names on the way: `it` and [`skip`, `each`] for `it.skip.each([…])(…)`. */
function callChain(callee: Node): { root?: Identifier; modifiers: string[] } {
  const modifiers: string[] = [];
  let current: Node = callee;
  for (;;) {
    if (transparent.has(current.type as string)) current = (current as unknown as { expression: Node }).expression;
    else if (current.type === "Identifier") return { root: current, modifiers: modifiers.reverse() };
    else if (current.type === "MemberExpression") {
      const name = propertyName(current);
      if (name === undefined) return { modifiers };
      modifiers.push(name);
      current = current.object;
    } else if (current.type === "CallExpression") current = current.callee;
    else return { modifiers };
  }
}

/** What a chain stands for: a global's name (`it`, `process`) and the names after it. A vitest namespace import is no root of its own. */
type Resolved = { root: string; modifiers: string[] };

/** The modules whose namespace import is the module itself (`v.it`, `p.env`), and the global each stands for. */
const namespaces: Record<string, string | undefined> = { vitest: "", process: "process", "node:process": "process" };

/** How far a chain of aliases is followed: `const a = it; const b = a; …`. */
const MAX_ALIASES = 8;

function findVariable(context: Rule.RuleContext, identifier: Identifier): Scope.Variable | undefined {
  for (let scope: Scope.Scope | null = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
  }
  return undefined;
}

/** The key `name` is bound to in an object pattern: `skip` for `const { skip } = it`, `todo` for `{ todo: later }`. */
function patternKey(pattern: Node, name: Identifier): string | undefined {
  if (pattern.type !== "ObjectPattern") return undefined;
  for (const property of pattern.properties) {
    if (property.type !== "Property") continue;
    const value = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
    if (value !== name) continue;
    if (!property.computed && property.key.type === "Identifier") return property.key.name;
    if (property.key.type === "Literal" && typeof property.key.value === "string") return property.key.value;
  }
  return undefined;
}

/**
 * What `expression` stands for, through the file's aliases (`const s = it.skip`, `const { skip } = it`) and imports
 * (`import { test as t } from "vitest"`, `import * as v from "vitest"`); undefined for the file's own functions,
 * parameters and anything else it cannot follow.
 */
function resolveChain(context: Rule.RuleContext, expression: Node): Resolved | undefined {
  const resolved = followChain(context, expression, 0);
  // A vitest namespace: its first member is the root (`v.it.skip` is `it.skip`).
  if (resolved?.root !== "") return resolved;
  const [first, ...rest] = resolved.modifiers;
  return first === undefined ? undefined : { root: first, modifiers: rest };
}

/** `resolveChain` before a vitest namespace (root "") is read through. */
function followChain(context: Rule.RuleContext, expression: Node, depth: number): Resolved | undefined {
  const { root, modifiers } = callChain(expression);
  if (!root || depth > MAX_ALIASES) return undefined;
  const base = resolveName(context, root, depth);
  return base && { root: base.root, modifiers: [...base.modifiers, ...modifiers] };
}

function resolveName(context: Rule.RuleContext, identifier: Identifier, depth: number): Resolved | undefined {
  const variable = findVariable(context, identifier);
  // A global: vitest's own (`it`, `describe`) or Node's (`process`).
  if (!variable || variable.defs.length === 0) return { root: identifier.name, modifiers: [] };
  const def = variable.defs[0]!;
  if (def.type === "ImportBinding") {
    const source = String((def.parent as { source: { value: unknown } }).source.value);
    const specifier = def.node as Node;
    if (specifier.type === "ImportNamespaceSpecifier" || (specifier.type === "ImportDefaultSpecifier" && source.endsWith("process"))) {
      const global = namespaces[source];
      return global === undefined ? undefined : { root: global, modifiers: [] };
    }
    if (specifier.type === "ImportSpecifier") {
      const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value);
      const global = namespaces[source];
      // `import { env } from "node:process"` is `process.env`; any other named import is read by its own name.
      return global ? { root: global, modifiers: [imported] } : { root: imported, modifiers: [] };
    }
    return { root: identifier.name, modifiers: [] };
  }
  if (def.type !== "Variable" || def.parent?.kind !== "const") return undefined;
  const declarator = def.node as Node & { id: Node; init?: Node | null };
  if (!declarator.init) return undefined;
  if (declarator.id.type === "Identifier") return followChain(context, declarator.init, depth + 1);
  const key = patternKey(declarator.id, def.name as Identifier);
  const object = key === undefined ? undefined : followChain(context, declarator.init, depth + 1);
  if (!object || key === undefined) return undefined;
  return { root: object.root, modifiers: [...object.modifiers, key] };
}

/** True when the condition reads an environment variable: `process.env.X`, `process.env["X"]`, a destructured env, or a const set from one. */
function readsEnv(context: Rule.RuleContext, node: Node, depth = 0): boolean {
  if (depth > MAX_ALIASES) return false;
  if (node.type === "Identifier" || node.type === "MemberExpression") {
    const resolved = resolveChain(context, node);
    if (resolved?.root === "process" && resolved.modifiers[0] === "env") return true;
  }
  if (node.type === "Identifier") {
    const def = findVariable(context, node)?.defs[0];
    const declarator = def?.type === "Variable" && def.parent?.kind === "const" ? (def.node as { id: Node; init?: Node | null }) : undefined;
    return declarator?.id.type === "Identifier" && declarator.init ? readsEnv(context, declarator.init, depth + 1) : false;
  }
  return childNodes(node).some((child) => readsEnv(context, child, depth));
}

/** A node's children that are expressions it reads: not a member's or a property's plain name. */
function childNodes(node: Node): Node[] {
  const children: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (node.type === "MemberExpression" && key === "property" && !node.computed) continue;
    if (node.type === "Property" && key === "key" && !node.computed) continue;
    for (const each of Array.isArray(value) ? value : [value]) {
      if (each && typeof each === "object" && typeof (each as { type?: unknown }).type === "string") children.push(each as Node);
    }
  }
  return children;
}

type Static = { value: unknown } | null;

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

/** The test call `node` is, if any: its root name and modifiers, through aliases and imports; undefined for the file's own function. */
const testCall = (context: Rule.RuleContext, node: CallExpression) => resolveChain(context, node.callee);

/** True when `fn` is the callback of a test (`it("x", fn)`), whose first parameter is the test's context. */
function isTestCallback(context: Rule.RuleContext, fn: Node): boolean {
  const parent = (fn as Rule.Node).parent;
  if (parent?.type !== "CallExpression" || !parent.arguments.includes(fn as Expression)) return false;
  const call = testCall(context, parent);
  return call !== undefined && withContext.has(call.root) && !call.modifiers.some((m) => m === "each" || m === "for");
}

/** True when `callee` is the test context's `skip`: `ctx.skip`, or `skip` destructured from the context parameter. */
function isContextSkip(context: Rule.RuleContext, callee: Node): boolean {
  const target = callee.type === "MemberExpression" && propertyName(callee) === "skip" ? callee.object : callee.type === "Identifier" ? callee : undefined;
  if (target?.type !== "Identifier") return false;
  const def = findVariable(context, target)?.defs[0];
  if (def?.type !== "Parameter") return false;
  const fn = def.node as Node & { params: Node[] };
  const [first] = fn.params;
  if (!first || !isTestCallback(context, fn)) return false;
  if (callee.type === "MemberExpression") return first === def.name;
  return patternKey(first, def.name as Identifier) === "skip";
}

export const noDisabledTests: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "No disabled test: .skip, .todo, an x-prefixed test, or .skipIf/.runIf with a constant condition (RP-1196)." },
    messages: {
      disabled:
        "This test never runs, and CI stays green without it (RP-1196). Delete it, or make it run. A test that can only run somewhere (a platform, a tool, a file) takes .skipIf/.runIf with that runtime condition.",
      envCondition:
        "This test's condition reads an environment variable (RP-1196). CI sets its own environment, so the test may never run there and CI stays green without it. Use a condition on the platform, a tool or a file, or make the test run everywhere.",
      contextSkip: "The test skips itself through its context (RP-1196), and CI stays green without it. Delete it, or make it run.",
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
        if (isContextSkip(context, node.callee)) {
          context.report({ node, messageId: "contextSkip" });
          return;
        }
        // The outermost call of a chain is the one checked: `it.skip.each([…])(…)` is reported once, at `it.skip.each([…])`.
        if (node.callee.type === "CallExpression") return;
        const call = testCall(context, node);
        if (!call) return;
        const skipped = testFunctions.has(call.root) && call.modifiers.some((m) => neverRuns.has(m));
        if (skipped || xPrefixed.has(call.root)) context.report({ node, messageId: "disabled" });
      },
      // `it.skipIf(<condition>)(…)`: the inner call holds the condition.
      "CallExpression > CallExpression.callee"(node: CallExpression) {
        const call = testCall(context, node);
        if (!call || !testFunctions.has(call.root) || !conditional.has(call.modifiers.at(-1) ?? "")) return;
        const [condition] = node.arguments;
        if (!condition || condition.type === "SpreadElement") return;
        if (constantTruth(condition) !== undefined) context.report({ node, messageId: "disabled" });
        else if (readsEnv(context, condition)) context.report({ node, messageId: "envCondition" });
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
        if (fPrefixed.has(call.root) || (testFunctions.has(call.root) && call.modifiers.includes("only"))) {
          context.report({ node, messageId: "focused" });
        }
      },
    };
  },
};
