import { join } from "node:path";
import { Linter, RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import rabaed from "./index.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// The rule reads types, so the tester runs the TypeScript project service. The fixture name sits outside the
// package's `src` include, so the service checks it as a default-project file with the package's tsconfig (Node's types).
const packageDir = join(import.meta.dirname, "..");
const typed = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { projectService: { allowDefaultProject: ["*.ts"], defaultProject: "tsconfig.json" }, tsconfigRootDir: packageDir },
  },
});
const filename = join(packageDir, "buffer-fixture.ts");
const at = (code: string) => ({ code, filename });

typed.run("no-buffer-slice", rabaed.rules["no-buffer-slice"], {
  valid: [
    at(`const list = [1, 2, 3]; list.slice(0, 1);`),
    at(`const text = "abc"; text.slice(1);`),
    at(`const bytes = new Uint8Array(4); bytes.slice(0, 2);`),
    at(`const buf = Buffer.from("x"); buf.subarray(0, 4);`),
    at(`const buf = Buffer.from("x"); buf.toString("hex").slice(0, 4);`),
    at(`declare const anything: any; anything.slice(0, 4);`),
    at(`declare const parts: Buffer[]; parts.slice(1);`),
  ],
  invalid: [
    {
      ...at(`const buf = Buffer.from("x"); buf.slice(0, 4);`),
      errors: [
        {
          messageId: "slice",
          suggestions: [
            { messageId: "subarray", output: `const buf = Buffer.from("x"); buf.subarray(0, 4);` },
            { messageId: "copy", output: `const buf = Buffer.from("x"); Buffer.from(buf.subarray(0, 4));` },
          ],
        },
      ],
    },
    {
      ...at(`declare function read(): Buffer; const head = read().slice();`),
      errors: [
        {
          messageId: "slice",
          suggestions: [
            { messageId: "subarray", output: `declare function read(): Buffer; const head = read().subarray();` },
            { messageId: "copy", output: `declare function read(): Buffer; const head = Buffer.from(read().subarray());` },
          ],
        },
      ],
    },
    {
      ...at(`declare const maybe: Buffer | undefined; maybe?.slice(1);`),
      errors: [{ messageId: "slice", suggestions: [{ messageId: "subarray", output: `declare const maybe: Buffer | undefined; maybe?.subarray(1);` }] }],
    },
    // Types that hide the Buffer: a brand, a type parameter, an interface built on it.
    ...[
      [`declare const branded: Buffer & { tag: true }; `, `branded.slice(1)`, `;`],
      [`function head<T extends Buffer>(bytes: T) { return `, `bytes.slice(0, 4)`, `; }`],
      [`interface Chunk extends Buffer { at0: number } declare const chunk: Chunk; `, `chunk.slice(1)`, `;`],
      [`import type { NonSharedBuffer } from "node:buffer"; declare const owned: NonSharedBuffer; `, `owned.slice(1)`, `;`],
    ].map(([before, call, after]) => {
      const view = call!.replace(".slice(", ".subarray(");
      return {
        ...at(`${before}${call}${after}`),
        errors: [
          {
            messageId: "slice",
            suggestions: [
              { messageId: "subarray", output: `${before}${view}${after}` },
              { messageId: "copy", output: `${before}Buffer.from(${view})${after}` },
            ],
          },
        ],
      };
    }),
    {
      ...at(`declare const buf: Buffer; buf["slice"](2);`),
      errors: [
        {
          messageId: "slice",
          suggestions: [
            { messageId: "subarray", output: `declare const buf: Buffer; buf["subarray"](2);` },
            { messageId: "copy", output: `declare const buf: Buffer; Buffer.from(buf["subarray"](2));` },
          ],
        },
      ],
    },
  ],
});

describe("no-buffer-slice without type information", () => {
  it("throws, naming the file, instead of passing every .slice() unseen", () => {
    const config = { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, plugins: { rabaed }, rules: { "rabaed/no-buffer-slice": "error" as const } };
    expect(() => new Linter().verify(`buf.slice(0, 4);`, config, "untyped.ts")).toThrow(/no-buffer-slice needs type information: lint .*untyped\.ts/);
  });
});
