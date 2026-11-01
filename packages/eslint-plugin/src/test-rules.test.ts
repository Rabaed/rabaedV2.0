import { ESLint, RuleTester } from "eslint";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import rabaed from "./index.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ts = new RuleTester({ languageOptions: { parser: tseslint.parser } });

const disabled = (code: string) => ({ code, errors: [{ messageId: "disabled" }] });
const envCondition = (code: string) => ({ code, errors: [{ messageId: "envCondition" }] });
const contextSkip = (code: string) => ({ code, errors: [{ messageId: "contextSkip" }] });
const focused = (code: string) => ({ code, errors: [{ messageId: "focused" }] });

ts.run("no-disabled-tests", rabaed.rules["no-disabled-tests"], {
  valid: [
    `it("runs", () => {});`,
    `describe("a group", () => { test("runs", () => {}); });`,
    `it.each([1, 2])("runs %s", () => {});`,
    `it.concurrent("runs", async () => {});`,
    // A runtime condition: the platform, a file that exists, a parsed workflow field.
    `it.skipIf(process.platform === "win32")("names the signal", () => {});`,
    `it.runIf(process.platform === "win32")("deletes a deep folder", () => {});`,
    `describe.skipIf(!existsSync(workflowPath))("reviewed-required.yml", () => {});`,
    `describe.skipIf(ci.jobs.changes === undefined)("ci.yml's docs-only gate", () => {});`,
    `it.skipIf(!types.some((type) => AUTO_MERGE_TYPES.includes(type)))("re-runs", () => {});`,
    // Text, not a call: the fixtures of scripts/check-scenario-seams.test.ts.
    "const lines = [`it.skip(\"${id}\", () => {});`, `it.todo(\"x\");`, `it.skipIf(true)(\"x\", () => {});`, 'xit(\"x\")'];",
    `const text = "describe.skip('hidden', () => {})";`,
    // Not a test function.
    `list.skip(3);`,
    `query.todo();`,
    // A local function of the same name.
    `function xit(name) { return name; } xit("a");`,
    // A renamed import or an alias that still runs.
    `import { it as spec } from "vitest"; spec("runs", () => {});`,
    `import * as v from "vitest"; v.it("runs", () => {}); v.describe.each([1])("runs %s", () => {});`,
    `const { each } = it; each([1])("runs %s", () => {});`,
    `const t = test; t.concurrent("runs", async () => {});`,
    `import { skip } from "list-tools"; skip(3);`,
    // A runtime condition that is no environment variable, even when a local object is called env.
    `const env = { platform: "linux" }; it.skipIf(env.platform === "win32")("runs", () => {});`,
    // The test's context, read and not skipped; a skip that is not the context's.
    `it("runs", (ctx) => { expect(ctx.task.name).toBe("runs"); });`,
    `it("runs", () => { list.skip(); });`,
    `describe("a group", (ctx) => { ctx.skip(); });`,
  ],
  invalid: [
    disabled(`it.skip("hidden", () => {});`),
    disabled(`test.skip("hidden", () => {});`),
    disabled(`describe.skip("hidden", () => { it("x", () => {}); });`),
    disabled(`suite.skip("hidden", () => {});`),
    disabled(`it.todo("later");`),
    disabled(`describe.todo("later");`),
    disabled(`it.skip.each([1])("hidden %s", () => {});`),
    disabled(`it.concurrent.skip("hidden", async () => {});`),
    disabled(`it["skip"]("hidden", () => {});`),
    disabled(`xit("hidden", () => {});`),
    disabled(`xtest("hidden", () => {});`),
    disabled(`xdescribe("hidden", () => {});`),
    // A constant condition skips for good.
    disabled(`it.skipIf(true)("hidden", () => {});`),
    disabled(`it.runIf(false)("hidden", () => {});`),
    disabled(`describe.skipIf(!0)("hidden", () => {});`),
    disabled(`it.skipIf(1)("hidden", () => {});`),
    disabled(`it.runIf(void 0)("hidden", () => {});`),
    disabled(`it.runIf(undefined)("hidden", () => {});`),
    disabled(`it.skipIf(1 === 1)("hidden", () => {});`),
    disabled(`it.skipIf(true || x)("hidden", () => {});`),
    disabled("it.skipIf(`yes`)(\"hidden\", () => {});"),
    disabled(`it.skipIf([])("hidden", () => {});`),
    disabled(`it.skipIf(() => true)("hidden", () => {});`),
    // An alias of a test function or a modifier (RP-1196 review).
    disabled(`const s = it.skip; s("hidden", () => {});`),
    disabled(`const { skip } = it; skip("hidden", () => {});`),
    disabled(`const { todo: later } = describe; later("hidden");`),
    disabled(`const t = it; t.skip("hidden", () => {});`),
    disabled(`const s = it.skipIf; s(true)("hidden", () => {});`),
    disabled(`const x = xit; x("hidden", () => {});`),
    // A renamed or namespace import of vitest.
    disabled(`import { test as t } from "vitest"; t.skip("hidden", () => {});`),
    disabled(`import { it as spec } from "vitest"; spec.todo("later");`),
    disabled(`import * as v from "vitest"; v.it.skip("hidden", () => {});`),
    disabled(`import * as v from "vitest"; const { describe: d } = v; d.skip("hidden", () => {});`),
    disabled(`import { describe as d } from "vitest"; d.skipIf(true)("hidden", () => {});`),
    // A condition on an environment variable: CI sets its own, so the test may never run there.
    envCondition(`it.skipIf(!process.env.DATABASE_URL)("hidden", () => {});`),
    envCondition(`it.runIf(process.env["CI"] === "true")("hidden", () => {});`),
    envCondition(`describe.skipIf(process.env.X === undefined)("hidden", () => {});`),
    envCondition(`const { CI } = process.env; it.skipIf(!!CI)("hidden", () => {});`),
    envCondition(`const env = process.env; it.runIf(env.X)("hidden", () => {});`),
    envCondition(`const reports = process.env.TEST_TIMING_REPORTS; describe.skipIf(!reports)("hidden", () => {});`),
    envCondition(`import { env } from "node:process"; it.skipIf(!env.X)("hidden", () => {});`),
    // The test's context skips it from inside.
    contextSkip(`it("hidden", (ctx) => { ctx.skip(); });`),
    contextSkip(`test("hidden", async (context) => { if (slow) context.skip(); });`),
    contextSkip(`it("hidden", ({ skip }) => { skip(); });`),
    contextSkip(`it("hidden", function (ctx) { ctx.skip(); });`),
    contextSkip(`it.concurrent("hidden", async ({ skip: off }) => { off(); });`),
  ],
});

ts.run("no-focused-tests", rabaed.rules["no-focused-tests"], {
  valid: [
    `it("runs", () => {});`,
    `describe("a group", () => { it("runs", () => {}); });`,
    "const text = `it.only(\"x\", () => {})`;",
    `promise.only();`,
    // A local function of the same name (workflow-canvas.tsx has one called fit).
    `const fit = () => zoom(1); fit();`,
    `import { it as spec } from "vitest"; spec("runs", () => {});`,
    `import { only } from "pick-tools"; only(1);`,
  ],
  invalid: [
    { code: `it.only("focused", () => {});`, errors: [{ messageId: "focused" }] },
    { code: `test.only("focused", () => {});`, errors: [{ messageId: "focused" }] },
    { code: `describe.only("focused", () => {});`, errors: [{ messageId: "focused" }] },
    { code: `it.only.each([1])("focused %s", () => {});`, errors: [{ messageId: "focused" }] },
    { code: `it.concurrent.only("focused", async () => {});`, errors: [{ messageId: "focused" }] },
    { code: `fit("focused", () => {});`, errors: [{ messageId: "focused" }] },
    { code: `fdescribe("focused", () => {});`, errors: [{ messageId: "focused" }] },
    // An alias, or a renamed or namespace import (RP-1196 review).
    focused(`const o = it.only; o("focused", () => {});`),
    focused(`const { only } = describe; only("focused", () => {});`),
    focused(`import { test as t } from "vitest"; t.only("focused", () => {});`),
    focused(`import * as v from "vitest"; v.describe.only("focused", () => {});`),
    focused(`const f = fit; f("focused", () => {});`),
  ],
});

// Through the repo's own eslint.config.js, as `pnpm lint` runs it: no comment in a test file turns the rules off.
describe("a test file under the repo's eslint config", () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL("../../..", import.meta.url)) });
  const errors = async (code: string, filePath = "scripts/rp-1196-fixture.test.ts") => {
    const [result] = await eslint.lintText(code, { filePath });
    return result!.messages.filter((m) => m.severity === 2).map((m) => `${m.line} ${m.ruleId} ${m.messageId}`);
  };

  it("fails a skipped or a focused test", async () => {
    expect(await errors(`import { it } from "vitest";\nit.skip("x", () => {});\nit.only("y", () => {});\n`)).toEqual([
      "2 rabaed/no-disabled-tests disabled",
      "3 rabaed/no-focused-tests focused",
    ]);
  });

  it("passes a test that runs, a runtime skipIf, and the rules' names in strings", async () => {
    const code = [
      `import { it } from "vitest";`,
      `it.skipIf(process.platform === "win32")("x", () => {});`,
      'const fixture = [`it.skip("a", () => {});`, "// eslint-disable-next-line rabaed/no-disabled-tests"];',
      `it("y", () => expect(fixture).toHaveLength(2));`,
      `// a comment may say eslint-disable rabaed/no-focused-tests in passing`,
      "",
    ].join("\n");
    expect(await errors(code)).toEqual([]);
  });

  it.each([
    ["the next line", `// eslint-disable-next-line rabaed/no-disabled-tests\nit.skip("x", () => {});`],
    ["the line", `it.skip("x", () => {}); // eslint-disable-line rabaed/no-disabled-tests -- flaky`],
    ["a block", `/* eslint-disable rabaed/no-disabled-tests */\nit.skip("x", () => {});`],
    ["a block naming both", `/* eslint-disable rabaed/no-focused-tests, rabaed/no-disabled-tests -- flaky */\nit.skip("x", () => {});`],
    ["every rule", `/* eslint-disable */\nit.skip("x", () => {});`],
    ["the next line, every rule", `// eslint-disable-next-line -- flaky\nit.skip("x", () => {});`],
  ])("refuses a disable of %s and still fails the skipped test", async (_form, code) => {
    const found = await errors(`import { it } from "vitest";\n${code}\n`);
    expect(found).toContain(`${code.startsWith("it.skip") ? 2 : 3} rabaed/no-disabled-tests disabled`);
    expect(found).toContain("2 rabaed/no-disabled-tests disableRefused");
  });

  it("refuses a disable of no-focused-tests and still fails the focused test", async () => {
    expect(await errors(`import { it } from "vitest";\n// eslint-disable-next-line rabaed/no-focused-tests\nit.only("x", () => {});\n`)).toEqual([
      "2 rabaed/no-focused-tests disableRefused",
      "3 rabaed/no-focused-tests focused",
    ]);
  });

  it("ignores a config comment turning the rule off", async () => {
    expect(await errors(`/* eslint rabaed/no-disabled-tests: "off" */\nimport { it } from "vitest";\nit.skip("x", () => {});\n`)).toContain(
      "3 rabaed/no-disabled-tests disabled",
    );
  });

  it("leaves code that isn't a test file alone", async () => {
    expect(await errors(`const fit = () => 1;\nfit();\n`, "scripts/rp-1196-fixture.ts")).toEqual([]);
  });
});

