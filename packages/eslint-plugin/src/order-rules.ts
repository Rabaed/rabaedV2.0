import type { Rule } from "eslint";
import type { CallExpression, Expression, Node, SpreadElement } from "estree";

/** A timestamp column, maybe qualified: `at`, `created_at`, `l.updated_at` (RP-1105). */
export const timestampColumn = /^(?:\w+\.)?(?:at|\w+_at)$/i;

const calls = (node: Node, name: string): node is CallExpression =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.property.type === "Identifier" &&
  node.callee.property.name === name;

/** The column a Kysely sort key names, when it is a plain string (`"a.at"`, or the older `"a.at desc"`); else null. */
function columnOf(key: Expression | SpreadElement | undefined): string | null {
  if (key?.type !== "Literal" || typeof key.value !== "string") return null;
  return key.value.trim().split(/\s+/)[0] ?? null;
}

/** The last column the `.orderBy(…)` call sorts by, when the rule can read it. */
function lastKey(call: CallExpression): { column: string; node: Node } | null {
  const [first] = call.arguments;
  if (first?.type === "ArrayExpression") {
    const last = first.elements.at(-1);
    const column = last ? columnOf(last) : null;
    return column && last ? { column, node: last } : null;
  }
  const column = columnOf(first);
  return column && first ? { column, node: first } : null;
}

/** Whether a later call in the same chain (`….orderBy("at").limit(5).orderBy("id")`) sorts again. */
function sortedAgainLater(call: CallExpression & Rule.NodeParentExtension): boolean {
  let node: Node & Rule.NodeParentExtension = call;
  for (;;) {
    const member: Rule.Node | null = node.parent;
    if (member?.type !== "MemberExpression" || member.object !== node) return false;
    const next: Rule.Node | null = member.parent;
    if (next?.type !== "CallExpression" || next.callee !== member) return false;
    if (calls(next, "orderBy")) return true;
    node = next;
  }
}

/**
 * A timestamp is never the last sort key (RP-1105). Two rows can share one (every row a transaction writes gets
 * the same `now()`), and the host's clock and the database's differ, so rows sorted by `at` alone came back in
 * either order: Main 5 lost about 2.5 hours to it. End the sort with a unique column, such as `id`, or a `seq`
 * when the order rows were written in matters (ids are random, ADR 0015). Kysely's `.orderBy(…)` only; SQL in
 * migrations is checked by scripts/check-sort-tiebreakers.test.ts.
 */
export const orderByTiebreaker: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "A Kysely sort may not end on a timestamp column: add a tiebreaker, such as .orderBy(\"id\")." },
    messages: {
      untied:
        "Sorting by {{key}} alone leaves rows that share a time in either order, and host and database clocks differ (RP-1105). End the sort with a unique column: .orderBy(\"id\") (ids are random, so a seq column when the order rows were written in matters).",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: CallExpression & Rule.NodeParentExtension) {
        if (!calls(node, "orderBy")) return;
        const key = lastKey(node);
        if (!key || !timestampColumn.test(key.column) || sortedAgainLater(node)) return;
        context.report({ node: key.node, messageId: "untied", data: { key: key.column } });
      },
    };
  },
};
