import type { Rule } from "eslint";
import type { CallExpression, Expression, Node, Super } from "estree";

/** The method a call is (`<object>.<name>(…)`), and the object it is called on; undefined for any other expression. */
function methodOf(node: Expression | Super): { name: string; call: CallExpression; object: Expression | Super } | undefined {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.property.type !== "Identifier") return undefined;
  return { name: node.callee.property.name, call: node, object: node.callee.object };
}

/** `.min(1, …)` or `.nonempty(…)`: what refuses an empty string. */
const refusesEmpty = ({ name, call }: { name: string; call: CallExpression }) => {
  const [first] = call.arguments;
  return name === "nonempty" || (name === "min" && first?.type === "Literal" && first.value === 1);
};

/**
 * `z.string(…)…min(1, …)….optional()` or `.nullish()`, any string methods (`.trim()`, `.toLowerCase()`) before or after
 * the `.min(1)`: the shape that refuses an empty `KEY=` line.
 */
function isOptionalNonEmptyString(node: CallExpression): boolean {
  const outer = methodOf(node);
  if (!outer || (outer.name !== "optional" && outer.name !== "nullish") || node.arguments.length > 0) return false;
  let nonEmpty = false;
  for (let current = methodOf(outer.object); current; current = methodOf(current.object)) {
    if (current.name === "string") return nonEmpty && current.object.type === "Identifier";
    if (refusesEmpty(current)) nonEmpty = true;
  }
  return false;
}

const fromEnvName = /FromEnv$/;

/**
 * In an env schema, an optional string is `optionalSecret` (@rabaed/domain), never `z.string().min(1).optional()`: a
 * `.env` holds an unset value as an empty line, which that refuses, so an empty `UAT_SEALING_AUTHORITY_KEY=` in
 * .env.example would have stopped the worker in every lane (#560, RP-1196). An env schema file is one that reads
 * `process.env` or declares a `*FromEnv` reader: the shape, not a list of paths, so a new reader is covered the day
 * it is written, while a domain schema (a Form's `{ ar, en }`) is not touched.
 */
export const envOptionalSecret: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "In an env schema, write an optional string as optionalSecret (@rabaed/domain), which takes an empty line as unset." },
    messages: {
      optionalSecret:
        "z.string().min(1).optional() (or .nullish(), .nonempty(), with .trim() and the like) refuses an empty `KEY=` line, which a .env holds for an unset value (RP-1196): write optionalSecret from @rabaed/domain, which takes empty as unset.",
    },
    schema: [],
  },
  create(context) {
    const found: Node[] = [];
    let readsEnv = false;
    const declares = (id: Node | null | undefined) => {
      if (id?.type === "Identifier" && fromEnvName.test(id.name)) readsEnv = true;
    };
    return {
      CallExpression(node) {
        if (isOptionalNonEmptyString(node)) found.push(node);
      },
      MemberExpression(node) {
        if (node.object.type === "Identifier" && node.object.name === "process" && !node.computed && node.property.type === "Identifier" && node.property.name === "env") readsEnv = true;
      },
      FunctionDeclaration(node) {
        declares(node.id);
      },
      VariableDeclarator(node) {
        declares(node.id);
      },
      "Program:exit"() {
        if (!readsEnv) return;
        for (const node of found) context.report({ node, messageId: "optionalSecret" });
      },
    };
  },
};
