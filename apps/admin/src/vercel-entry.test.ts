import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The Vercel Function runs the TypeScript sources with Node's own type handling
// (NODE_OPTIONS=--experimental-transform-types, docs/tech-stack.md › Dev and UAT), not
// through Vite or tsx, so the entry is loaded here the same way. A process that
// imports it must end by itself: no listen, no timer, no signal handler holds it open.
function loadEntry(entry: string): string {
  const script = `const m = await import(${JSON.stringify(entry)}); console.log(typeof m.default);`;
  return execFileSync(process.execPath, ["--experimental-transform-types", "--no-warnings", "--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    timeout: 60_000,
  }).trim();
}

describe("Rabaed Admin's Vercel entry", () => {
  it("loads under Node's own TypeScript handling, exports a handler and leaves nothing running", () => {
    expect(loadEntry(new URL("../api/index.ts", import.meta.url).href)).toBe("function");
  }, 90_000);
});
