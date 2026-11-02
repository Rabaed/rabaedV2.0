import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exitCodeOf, lineAndColumn, runChecks, type DoctorEnv } from "./doctor.ts";

// RP-1173: on 2026-10-31 the owner's ~/.claude/settings.json was invalid JSON (a missing comma) for
// days. Claude Code ignored the whole file, so every allow rule and enabledPlugins was lost, and the
// mattpocock skills went missing. `pnpm check:doctor` names the file and the place instead.

const HOME = join("C:", "owner");
const PROJECT = join("C:", "repo");
const userSettings = join(HOME, ".claude", "settings.json");
const projectSettings = join(PROJECT, ".claude", "settings.json");
const projectLocal = join(PROJECT, ".claude", "settings.local.json");

const enabled = JSON.stringify({ enabledPlugins: { "mattpocock-skills@mattpocock": true } });

const allTools: Record<string, string> = {
  "gh --version": "gh version 2.60.0 (2026-10-01)",
  "node --version": "v24.1.0",
  "docker --version": "Docker version 27.0.0, build abc",
  "gh auth status": "Logged in to github.com as someone",
};

/** A DoctorEnv whose files and commands are the given maps; a command missing from `commands` fails. */
function fakeEnv(files: Record<string, string>, commands: Record<string, string> = allTools): DoctorEnv {
  return {
    homeDir: HOME,
    cwd: PROJECT,
    readFile: (path) => files[path],
    run: (file, args) => commands[[file, ...args].join(" ")],
  };
}

describe("runChecks", () => {
  it("passes every check for valid settings with the plugin on and the tools present", () => {
    const checks = runChecks(fakeEnv({ [userSettings]: enabled }));

    expect(checks.every((c) => c.ok)).toBe(true);
    expect(exitCodeOf(checks)).toBe(0);
  });

  it("names the file, line and column of invalid JSON, and never prints its contents", () => {
    // The trailing comma on line 2 makes the parser fail at the closing brace on line 3.
    const secret = "not-a-real-secret-value";
    const broken = `{\n  "apiKey": "${secret}",\n}`;
    const checks = runChecks(fakeEnv({ [userSettings]: enabled, [projectLocal]: broken }));

    const bad = checks.find((c) => c.name === projectLocal);
    expect(bad?.ok).toBe(false);
    expect(bad?.message).toContain(projectLocal);
    expect(bad?.message).toContain("line 3, column 1");
    expect(checks.map((c) => c.message).join("\n")).not.toContain(secret);
    expect(exitCodeOf(checks)).toBe(1);
  });

  it("skips a settings file that is not present, without failing it", () => {
    const checks = runChecks(fakeEnv({ [userSettings]: enabled }));

    expect(checks.find((c) => c.name === projectSettings)?.ok).toBe(true);
    expect(checks.find((c) => c.name === projectLocal)?.ok).toBe(true);
  });

  it("fails the plugin check when no readable settings file enables mattpocock-skills", () => {
    const off = JSON.stringify({ enabledPlugins: { "mattpocock-skills@mattpocock": false, other: true } });
    const checks = runChecks(fakeEnv({ [userSettings]: off }));

    const plugin = checks.find((c) => c.name === "plugin");
    expect(plugin?.ok).toBe(false);
    expect(exitCodeOf(checks)).toBe(1);
  });

  it("names the project file that enables the plugin", () => {
    const checks = runChecks(fakeEnv({ [projectSettings]: enabled }));

    const plugin = checks.find((c) => c.name === "plugin");
    expect(plugin?.ok).toBe(true);
    expect(plugin?.message).toContain(projectSettings);
  });

  it("fails the plugin check when the only settings file that could enable it is invalid", () => {
    const truncated = `{ "enabledPlugins": { "mattpocock-skills@mattpocock": true } `;
    const checks = runChecks(fakeEnv({ [userSettings]: truncated }));

    expect(checks.find((c) => c.name === userSettings)?.ok).toBe(false);
    expect(checks.find((c) => c.name === "plugin")?.ok).toBe(false);
  });

  it("reports the end of an empty file, where the parser gives no position", () => {
    // Running out of text names no position, so the error is taken to be at the end of the text.
    const checks = runChecks(fakeEnv({ [userSettings]: "" }));

    const bad = checks.find((c) => c.name === userSettings);
    expect(bad?.ok).toBe(false);
    expect(bad?.message).toContain("at line 1, column 1 (end of text)");
  });

  it("reports the line and column the parser gives for a file cut off mid-object", () => {
    const truncated = `{\n  "a": 1`;
    const checks = runChecks(fakeEnv({ [userSettings]: truncated }));

    expect(checks.find((c) => c.name === userSettings)?.message).toContain("at line 2, column 9.");
  });

  it("says the parser gave no position when the error has none and the text does not end early", () => {
    // A bare token fails with a message that names no position.
    const checks = runChecks(fakeEnv({ [userSettings]: "x" }));

    const bad = checks.find((c) => c.name === userSettings);
    expect(bad?.ok).toBe(false);
    expect(bad?.message).toContain("(no position reported)");
  });

  it("reports each tool's version", () => {
    const checks = runChecks(fakeEnv({ [userSettings]: enabled }));

    expect(checks.find((c) => c.name === "node")?.message).toContain("v24.1.0");
    expect(checks.find((c) => c.name === "gh")?.message).toContain("2.60.0");
  });

  it("reports a missing tool as missing and fails the run", () => {
    const commands = { ...allTools };
    delete commands["docker --version"];
    const checks = runChecks(fakeEnv({ [userSettings]: enabled }, commands));

    const docker = checks.find((c) => c.name === "docker");
    expect(docker?.ok).toBe(false);
    expect(docker?.message).toContain("missing");
    expect(exitCodeOf(checks)).toBe(1);
  });

  it("fails the gh auth check when gh is not logged in, without printing a token", () => {
    const commands = { ...allTools };
    delete commands["gh auth status"];
    const checks = runChecks(fakeEnv({ [userSettings]: enabled }, commands));

    const auth = checks.find((c) => c.name === "gh login");
    expect(auth?.ok).toBe(false);
    expect(auth?.message).toContain("gh auth login");
  });

  it("only reads: it never calls a command other than the version and auth checks", () => {
    const calls: string[] = [];
    const env: DoctorEnv = {
      homeDir: HOME,
      cwd: PROJECT,
      readFile: (path) => (path === userSettings ? enabled : undefined),
      run: (file, args) => {
        calls.push([file, ...args].join(" "));
        return allTools[[file, ...args].join(" ")];
      },
    };
    runChecks(env);

    expect(calls.sort()).toEqual(["docker --version", "gh --version", "gh auth status", "node --version"]);
  });
});

describe("runChecks docker daemon (RP-1197)", () => {
  const withProbe = (dockerProbe: DoctorEnv["dockerProbe"]) => runChecks({ ...fakeEnv({ [userSettings]: enabled }), dockerProbe });

  it("has no daemon check when the env has no probe", () => {
    expect(runChecks(fakeEnv({ [userSettings]: enabled })).some((c) => c.name === "docker daemon")).toBe(false);
  });

  it("passes when the daemon answers", () => {
    const check = withProbe(() => ({ ok: true })).find((c) => c.name === "docker daemon");
    expect(check?.ok).toBe(true);
  });

  it("fails with the wait-don't-restart message when Docker hangs", () => {
    const checks = withProbe(() => ({ ok: false, kind: "hang", message: "Docker not answering: wait, don't restart it (RP-1099)" }));
    const check = checks.find((c) => c.name === "docker daemon");
    expect(check).toMatchObject({ ok: false, message: "Docker not answering: wait, don't restart it (RP-1099)" });
    expect(exitCodeOf(checks)).toBe(1);
  });

  it("fails with the start-Docker message when Docker is not running", () => {
    const checks = withProbe(() => ({ ok: false, kind: "down", message: "Docker is not running: start Docker Desktop, then run this again" }));
    expect(checks.find((c) => c.name === "docker daemon")).toMatchObject({ ok: false, message: "Docker is not running: start Docker Desktop, then run this again" });
    expect(exitCodeOf(checks)).toBe(1);
  });
});

describe("lineAndColumn", () => {
  it("counts lines from a character position, columns from 1", () => {
    expect(lineAndColumn("ab\ncd\nef", 0)).toEqual({ line: 1, column: 1 });
    expect(lineAndColumn("ab\ncd\nef", 4)).toEqual({ line: 2, column: 2 });
    expect(lineAndColumn("ab\ncd\nef", 6)).toEqual({ line: 3, column: 1 });
  });
});
