import ts from "typescript";

// The describe(...) / it(...) / test(...) blocks of a vitest file, read from its syntax tree (RP-1134),
// so a check can ask which test a line is in, or which titles a file has, without a comment or a
// string elsewhere counting. Used by check-hidden-asserts.ts and check-scenario-seams.ts.

const testFunctions = new Set(["describe", "it", "test", "suite"]);

/** One block: its title as written (a template's `${…}` kept as text), and where it starts and ends. */
export type TestBlock = { title: string; start: number; end: number };

/** The name a call starts from: `it` for `it.each([...])(...)` and `describe.skip(...)`. */
function rootName(expression: ts.Expression): string | undefined {
  let current = expression;
  for (;;) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) current = current.expression;
    else return undefined;
  }
}

function titleOf(node: ts.Expression | undefined, source: ts.SourceFile): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(source).slice(1, -1);
  return undefined;
}

/** Every test block of `text`, outer blocks before the blocks inside them. */
export function testBlocks(file: string, text: string): TestBlock[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const blocks: TestBlock[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && testFunctions.has(rootName(node.expression) ?? "")) {
      const title = titleOf(node.arguments[0], source);
      if (title !== undefined) blocks.push({ title: title.replace(/\s+/g, " ").trim(), start: node.getStart(source), end: node.getEnd() });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return blocks;
}

/** The titles of the blocks around `offset`, outermost first. */
export function titlePathAt(blocks: TestBlock[], offset: number): string[] {
  return blocks.filter((block) => block.start <= offset && offset < block.end).map((block) => block.title);
}
