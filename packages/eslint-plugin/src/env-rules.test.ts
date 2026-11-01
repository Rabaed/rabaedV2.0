import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import rabaed from "./index.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ts = new RuleTester({ languageOptions: { parser: tseslint.parser } });

ts.run("env-optional-secret", rabaed.rules["env-optional-secret"], {
  valid: [
    // An env schema written with the helper.
    `export function keysFromEnv(source = process.env) { return z.object({ KEY: optionalSecret }).parse(source); }`,
    // Not an env schema: the file neither reads process.env nor declares a *FromEnv.
    `export const form = z.object({ ar: z.string().min(1).optional() });`,
    `const headerRow = z.int().min(1).optional();`,
    // In an env schema, but not an optional non-empty string.
    `export function portFromEnv(source = process.env) { return z.object({ PORT: z.coerce.number().min(1).optional(), NAME: z.string().min(3).optional(), ID: z.string().min(1) }).parse(source); }`,
  ],
  invalid: [
    {
      code: `export function keysFromEnv(source = process.env) { return z.object({ KEY: z.string().min(1).optional() }).parse(source); }`,
      errors: [{ messageId: "optionalSecret" }],
    },
    {
      // A module-level schema in a file whose reader is an arrow function.
      code: `const env = z.object({ A: z.string().min(1).optional(), B: z.string().min(1, "why").optional() });\nexport const pathsFromEnv = (source: NodeJS.ProcessEnv) => env.parse(source);`,
      errors: [{ messageId: "optionalSecret" }, { messageId: "optionalSecret" }],
    },
    {
      // A file that reads process.env directly.
      code: `const env = z.object({ CHROMIUM_PATH: z.string().min(1).optional() }).parse(process.env);`,
      errors: [{ messageId: "optionalSecret" }],
    },
  ],
});
