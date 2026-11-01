import { describe, expect, it } from "vitest";
import { findNonPlainImports, formatChain, runtimeImports } from "./import-graph.ts";

describe("runtimeImports", () => {
  it.each([
    ['import { a } from "x";', ["x"]],
    ['import a from "x";', ["x"]],
    ['import * as a from "x";', ["x"]],
    ['import "x";', ["x"]],
    ["import { a } from 'x';", ["x"]],
    ['import {\n  a,\n  b,\n} from "x";', ["x"]],
    ['export { a } from "x";', ["x"]],
    ['export * from "x";', ["x"]],
    ['const m = await import("x");', ["x"]],
    ['const m = await import( "x" );', ["x"]],
    ['import a, { b } from "x";\nimport c from "y";', ["x", "y"]],
  ])("finds the module %j loads at runtime", (source, expected) => {
    expect(runtimeImports(source)).toEqual(expected);
  });

  it("counts an import whose specifiers are all inline types, which still loads the module", () => {
    expect(runtimeImports('import { type A, type B } from "x";')).toEqual(["x"]);
  });

  it.each([
    ['import type { A } from "x";'],
    ['import type A from "x";'],
    ['export type { A } from "x";'],
    ['export type * from "x";'],
  ])("skips %j, which is erased", (source) => {
    expect(runtimeImports(source)).toEqual([]);
  });

  it("skips imports in comments and in the text of strings", () => {
    const source = [
      '// import a from "line-comment";',
      '/* import b from "block-comment"; */',
      "/**",
      ' * export { c } from "doc-comment";',
      " */",
      'const url = "https://example.com/import";',
      'import d from "real";',
    ].join("\n");
    expect(runtimeImports(source)).toEqual(["real"]);
  });

  it("does not read import.meta as an import", () => {
    expect(runtimeImports("const here = import.meta.dirname;")).toEqual([]);
  });

  it("reports a dynamic import with a computed specifier, which cannot be followed", () => {
    expect(runtimeImports("const m = await import(name);")).toEqual(["<computed import()>"]);
  });
});

describe("findNonPlainImports", () => {
  const graph = (files: Record<string, string>) => (path: string) => files[path];

  it("passes a graph of node: builtins, bare builtin names and relative .ts scripts", () => {
    const read = graph({
      "scripts/a.ts": 'import { x } from "node:fs";\nimport { y } from "path";\nimport { z } from "./b.ts";',
      "scripts/b.ts": 'import { spawn } from "node:child_process";\nexport * from "./c.ts";',
      "scripts/c.ts": 'import { readFile } from "fs/promises";',
    });
    expect(findNonPlainImports(["scripts/a.ts"], read)).toEqual([]);
  });

  it("fails an npm import with the chain that reaches it", () => {
    const read = graph({
      "scripts/lanes-prune.ts": 'import { a } from "./verapdf-containers.ts";',
      "scripts/verapdf-containers.ts": 'import { b } from "./test-stories-linux.ts";',
      "scripts/test-stories-linux.ts": 'import { parseDocument } from "yaml";',
    });
    const found = findNonPlainImports(["scripts/lanes-prune.ts"], read);
    expect(found.map(formatChain)).toEqual(["lanes-prune.ts → verapdf-containers.ts → test-stories-linux.ts → yaml"]);
  });

  it("reports the shortest chain once per file and package", () => {
    const read = graph({
      "scripts/a.ts": 'import "./b.ts";\nimport "./c.ts";',
      "scripts/b.ts": 'import "./c.ts";',
      "scripts/c.ts": 'import "yaml";',
    });
    expect(findNonPlainImports(["scripts/a.ts"], read).map(formatChain)).toEqual(["a.ts → c.ts → yaml"]);
  });

  it("walks every entry point and survives an import cycle", () => {
    const read = graph({
      "scripts/a.ts": 'import "./b.ts";',
      "scripts/b.ts": 'import "./a.ts";\nimport "left-pad";',
      "scripts/d.ts": 'import "yaml";',
    });
    expect(findNonPlainImports(["scripts/a.ts", "scripts/d.ts"], read).map(formatChain)).toEqual(["a.ts → b.ts → left-pad", "d.ts → yaml"]);
  });

  it("fails an npm package under a scope, a computed import() and a relative import that is not a .ts script", () => {
    const read = graph({
      "scripts/a.ts": 'import "@rabaed/db";\nimport "./data.json";\nconst m = await import(name);',
    });
    expect(findNonPlainImports(["scripts/a.ts"], read).map(formatChain)).toEqual([
      "a.ts → @rabaed/db",
      "a.ts → ./data.json",
      "a.ts → <computed import()>",
    ]);
  });

  it("fails a relative import of a file that does not exist", () => {
    const read = graph({ "scripts/a.ts": 'import "./gone.ts";' });
    expect(findNonPlainImports(["scripts/a.ts"], read).map(formatChain)).toEqual(["a.ts → gone.ts (missing)"]);
  });

  it("follows ../ imports from a nested folder", () => {
    const read = graph({
      "scripts/sub/a.ts": 'import "../b.ts";',
      "scripts/b.ts": 'import "yaml";',
    });
    expect(findNonPlainImports(["scripts/sub/a.ts"], read).map(formatChain)).toEqual(["a.ts → b.ts → yaml"]);
  });
});
