import type { Rule } from "eslint";
import type { CallExpression, Node } from "estree";

// The few TypeScript checker calls the rule makes, typed here so the package needs no `typescript` dependency.
interface TsType {
  isUnionOrIntersection(): this is { types: TsType[] };
  isClassOrInterface(): boolean;
  getSymbol(): { getName(): string } | undefined;
}
interface TypeChecker {
  getTypeAtLocation(node: unknown): TsType;
  /** A type parameter's constraint (`T extends Buffer` gives Buffer); other types as they are. */
  getApparentType(type: TsType): TsType;
  getBaseTypes(type: TsType): TsType[];
}
interface TypeServices {
  program?: { getTypeChecker(): TypeChecker } | null;
  esTreeNodeToTSNodeMap?: { get(node: Node): unknown };
}

/**
 * A Buffer, or a type built on one: a union or intersection with one in it (`Buffer | undefined`, a branded
 * `Buffer & { tag: true }`), a type parameter constrained to one, or an interface or class extending it.
 */
function isBuffer(checker: TypeChecker, type: TsType, seen = new Set<TsType>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  const apparent = checker.getApparentType(type);
  if (apparent.isUnionOrIntersection()) return apparent.types.some((part) => isBuffer(checker, part, seen));
  if (apparent.getSymbol()?.getName() === "Buffer") return true;
  return apparent.isClassOrInterface() && checker.getBaseTypes(apparent).some((base) => isBuffer(checker, base, seen));
}

/**
 * On a Buffer, `.slice()` returns a view on the same memory, unlike Array#slice and Uint8Array#slice, which copy; a small
 * Buffer's memory is Node's shared pool. RP-635's spreadsheet reader passed one to fflate and every .xlsx test failed on
 * Linux CI while passing on Windows (RP-1025). It needs type information (`parserOptions.projectService`).
 */
export const noBufferSlice: Rule.RuleModule = {
  meta: {
    type: "problem",
    hasSuggestions: true,
    docs: { description: "No .slice() on a Buffer: it shares memory, unlike Array and Uint8Array. Write .subarray() for a view, or Buffer.from(….subarray()) for a copy." },
    messages: {
      slice:
        "On a Buffer, .slice() does not copy: it returns a view on the same memory (Node's shared pool for a small Buffer), unlike Array and Uint8Array (RP-1025). Write .subarray() when you mean a view, or Buffer.from(….subarray()) for a copy.",
      subarray: "Write .subarray(): a view on the same memory.",
      copy: "Write Buffer.from(….subarray()): a copy.",
    },
    schema: [],
  },
  create(context) {
    const services = context.sourceCode.parserServices as TypeServices | undefined;
    const program = services?.program;
    const map = services?.esTreeNodeToTSNodeMap;
    if (!program || !map) {
      throw new Error(`rabaed/no-buffer-slice needs type information: lint ${context.filename} with parserOptions.projectService (eslint.config.js).`);
    }
    const checker = program.getTypeChecker();

    return {
      CallExpression(node: CallExpression & Rule.NodeParentExtension) {
        const { callee } = node;
        if (callee.type !== "MemberExpression") return;
        const { property } = callee;
        const callsSlice = callee.computed ? property.type === "Literal" && property.value === "slice" : property.type === "Identifier" && property.name === "slice";
        if (!callsSlice || callee.object.type === "Super") return;
        if (!isBuffer(checker, checker.getTypeAtLocation(map.get(callee.object)))) return;

        const toSubarray = (fixer: Rule.RuleFixer) =>
          fixer.replaceText(property, callee.computed ? context.sourceCode.getText(property).replace("slice", "subarray") : "subarray");
        // `maybe?.slice()` can be undefined, which Buffer.from() would not take: offer only the view there.
        const optional = node.parent.type === "ChainExpression";
        const suggest: Rule.SuggestionReportDescriptor[] = [{ messageId: "subarray", fix: toSubarray }];
        if (!optional) {
          suggest.push({ messageId: "copy", fix: (fixer) => [fixer.insertTextBefore(node, "Buffer.from("), toSubarray(fixer), fixer.insertTextAfter(node, ")")] });
        }
        context.report({ node: property, messageId: "slice", suggest });
      },
    };
  },
};
