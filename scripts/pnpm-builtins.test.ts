import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { shadowedScripts } from "./pnpm-builtins.ts";

// A root script named after a pnpm built-in never runs as `pnpm <name>`: `pnpm doctor`
// ran pnpm's own doctor, not ours (RP-1173), so the script became `check:doctor`.

const root = resolve(import.meta.dirname, "..");

describe("root scripts shadowed by a pnpm built-in", () => {
  it("names a script whose key is a pnpm command or alias", () => {
    expect(shadowedScripts({ doctor: "node scripts/doctor.ts" })).toEqual(["doctor"]);
    expect(shadowedScripts({ i: "x", ls: "x", up: "x", setup: "x", server: "x" })).toEqual(["i", "ls", "up", "setup", "server"]);
  });

  it("names a script whose key pnpm passes through to npm", () => {
    expect(shadowedScripts({ whoami: "x", search: "x" })).toEqual(["whoami", "search"]);
  });

  it("accepts a namespaced name, a name no built-in has, and the lifecycle names pnpm runs on purpose", () => {
    expect(shadowedScripts({ "check:doctor": "x", "lane:env": "x", verify: "x", lint: "x" })).toEqual([]);
    expect(shadowedScripts({ test: "x", start: "x", stop: "x", restart: "x", prepare: "x", postinstall: "x", install: "x", publish: "x", version: "x" })).toEqual([]);
  });

  it("the root package.json has no shadowed script", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(Object.keys(manifest.scripts ?? {})).toContain("check:doctor");
    expect(shadowedScripts(manifest.scripts ?? {})).toEqual([]);
  });
});
