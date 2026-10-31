import ts from "typescript";

// The describe(...) / it(...) / test(...) blocks of a vitest file, read from its syntax tree (RP-1134),
// so a check can ask which test a line is in, or which tests a file runs, without a comment or a
// string elsewhere counting. Used by check-hidden-asserts.ts and check-scenario-seams.ts.

const groupFunctions = new Set(["describe", "suite"]);
const testFunctions = new Set(["it", "test"]);
/** Modifiers after which a block may not run: `it.skip`, `it.todo`, `describe.skipIf(ci)`, `it.runIf(x)`. */
const notRunning = new Set(["skip", "todo", "skipIf", "runIf"]);

/**
 * One block: its title as written (a template's `${…}` kept as text, spaces collapsed), where it starts
 * and ends, whether it is a group (describe) or a test, and whether it runs: not skipped, and a test
 * with a body.
 */
export type TestBlock = { title: string; start: number; end: number; group: boolean; runs: boolean };

/** The name a call starts from and the modifiers on the way: `it` and [`each`] for `it.each([...])(...)`. */
function callChain(expression: ts.Expression): { root?: string; modifiers: string[] } {
  const modifiers: string[] = [];
  let current = expression;
  for (;;) {
    if (ts.isIdentifier(current)) return { root: current.text, modifiers };
    if (ts.isPropertyAccessExpression(current)) {
      modifiers.push(current.name.text);
      current = current.expression;
    } else if (ts.isCallExpression(current)) current = current.expression;
    else return { modifiers };
  }
}

function titleOf(node: ts.Expression | undefined, source: ts.SourceFile): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(source).slice(1, -1);
  return undefined;
}

const isFunction = (node: ts.Expression | undefined) => node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

/** Every test block of `text`, outer blocks before the blocks inside them. */
export function testBlocks(file: string, text: string): TestBlock[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const blocks: TestBlock[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const { root, modifiers } = callChain(node.expression);
      const group = groupFunctions.has(root ?? "");
      const title = group || testFunctions.has(root ?? "") ? titleOf(node.arguments[0], source) : undefined;
      if (title !== undefined) {
        const runs = !modifiers.some((m) => notRunning.has(m)) && (group || isFunction(node.arguments[1]));
        blocks.push({ title: title.replace(/\s+/g, " ").trim(), start: node.getStart(source), end: node.getEnd(), group, runs });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return blocks;
}

const around = (blocks: TestBlock[], offset: number) => blocks.filter((block) => block.start <= offset && offset < block.end);

/** The titles of the blocks around `offset`, outermost first. */
export function titlePathAt(blocks: TestBlock[], offset: number): string[] {
  return around(blocks, offset).map((block) => block.title);
}

/** The titles that name a test that runs: each running test's own title and its groups' titles. */
export function runningTestTitles(blocks: TestBlock[]): Set<string> {
  const titles = new Set<string>();
  for (const test of blocks) {
    if (test.group) continue;
    const path = around(blocks, test.start);
    if (path.every((block) => block.runs)) for (const block of path) titles.add(block.title);
  }
  return titles;
}
