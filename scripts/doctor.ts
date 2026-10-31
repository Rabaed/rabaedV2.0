import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Is this machine set up for the lane workflow? Read-only: it prints one line per check and never
// writes or edits a file. RP-1173: on 2026-10-31 the owner's ~/.claude/settings.json was invalid JSON
// (a missing comma), so Claude Code ignored every allow rule and enabledPlugins, and the mattpocock
// skills went missing ("Unknown skill"). Nobody noticed for days. A settings file's contents are never
// printed, since they may hold secrets: only its path and where it fails to parse.
//
// node scripts/doctor.ts
// Exit code 0 when every check passes, 1 when one fails.

/** Everything the checks read or run. The real one touches the disk and PATH; the unit test passes a fake. */
export type DoctorEnv = {
  homeDir: string;
  cwd: string;
  /** A file's text, or undefined when the file does not exist. */
  readFile: (path: string) => string | undefined;
  /** The command's standard output when it exits 0, undefined when it fails or is not on PATH. */
  run: (file: string, args: string[]) => string | undefined;
};

export type Check = { name: string; ok: boolean; message: string };

const TOOLS = ["gh", "node", "docker"];
const PLUGIN_PREFIX = "mattpocock-skills";

/** The 1-based line and column of a character position in `text`. */
export function lineAndColumn(text: string, position: number): { line: number; column: number } {
  const lines = text.slice(0, position).split("\n");
  const last = lines[lines.length - 1] ?? "";
  return { line: lines.length, column: last.length + 1 };
}

type Parsed = { ok: true; value: unknown } | { ok: false; where: string };

/** Parses a settings file. On failure, `where` is the line and column of the error, from the parser's position. */
export function parseSettings(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    // The parser's message is not printed: it can quote the file. Only its position is used.
    const message = (error as Error).message;
    // Running out of text (a truncated file) has no position: the error is at the end of the text.
    if (/^Unexpected end of JSON input/.test(message)) {
      const { line, column } = lineAndColumn(text, text.length);
      return { ok: false, where: `at line ${line}, column ${column} (end of text)` };
    }
    const found = /position (\d+)/.exec(message);
    if (!found) return { ok: false, where: "(no position reported)" };
    const { line, column } = lineAndColumn(text, Number(found[1]));
    return { ok: false, where: `at line ${line}, column ${column}` };
  }
}

/** Whether a parsed settings object turns the mattpocock skills plugin on. */
function enablesPlugin(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const plugins = (value as { enabledPlugins?: unknown }).enabledPlugins;
  if (typeof plugins !== "object" || plugins === null || Array.isArray(plugins)) return false;
  return Object.entries(plugins).some(([key, on]) => key.startsWith(PLUGIN_PREFIX) && on === true);
}

/** Runs every check, in the order it prints them. */
export function runChecks(env: DoctorEnv): Check[] {
  const checks: Check[] = [];
  const homeSettingsPath = join(env.homeDir, ".claude", "settings.json");
  const settingsFiles = [homeSettingsPath, join(env.cwd, ".claude", "settings.json"), join(env.cwd, ".claude", "settings.local.json")];
  const enabledIn: string[] = [];

  for (const path of settingsFiles) {
    let text: string | undefined;
    try {
      text = env.readFile(path);
    } catch (error) {
      const code = (error as { code?: string }).code ?? "unknown error";
      checks.push({ name: path, ok: false, message: `${path} cannot be read (${code}). Fix its permissions.` });
      continue;
    }
    if (text === undefined) {
      checks.push({ name: path, ok: true, message: `${path} is not present, so it is skipped.` });
      continue;
    }
    const parsed = parseSettings(text);
    if (!parsed.ok) {
      checks.push({
        name: path,
        ok: false,
        message: `${path} is not valid JSON ${parsed.where}. Claude Code ignores all of it until it parses: fix the syntax there (a missing or extra comma is the usual cause).`,
      });
      continue;
    }
    checks.push({ name: path, ok: true, message: `${path} parses.` });
    if (enablesPlugin(parsed.value)) enabledIn.push(path);
  }

  checks.push(
    enabledIn.length > 0
      ? { name: "plugin", ok: true, message: `mattpocock-skills is enabled in ${enabledIn[0]}.` }
      : {
          name: "plugin",
          ok: false,
          message: `mattpocock-skills is not enabled: no readable settings enables enabledPlugins "${PLUGIN_PREFIX}…" to true. Turn it on in ${homeSettingsPath}, or fix the parse error above first.`,
        },
  );

  let ghInstalled = false;
  for (const tool of TOOLS) {
    const version = env.run(tool, ["--version"]);
    if (tool === "gh") ghInstalled = version !== undefined;
    checks.push(
      version === undefined
        ? { name: tool, ok: false, message: `${tool}: missing (not on PATH). Install it, then open a new shell.` }
        : { name: tool, ok: true, message: `${tool}: ${version.split("\n")[0] || "version not printed"}` },
    );
  }

  if (!ghInstalled) {
    checks.push({ name: "gh login", ok: false, message: "gh login: cannot test, gh is missing." });
  } else if (env.run("gh", ["auth", "status"]) === undefined) {
    checks.push({ name: "gh login", ok: false, message: "gh is not logged in: run gh auth login." });
  } else {
    checks.push({ name: "gh login", ok: true, message: "gh is logged in to GitHub." });
  }

  return checks;
}

export function exitCodeOf(checks: Check[]): number {
  return checks.every((c) => c.ok) ? 0 : 1;
}

const realEnv: DoctorEnv = {
  homeDir: homedir(),
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  readFile: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return undefined;
      throw error;
    }
  },
  run: (file, args) => {
    const result = spawnSync(file, args, { encoding: "utf8", windowsHide: true, timeout: 20_000 });
    return result.status === 0 ? result.stdout.trim() : undefined;
  },
};

function main(): void {
  const checks = runChecks(realEnv);
  for (const check of checks) console.log(`${check.ok ? "OK     " : "PROBLEM"} ${check.message}`);
  process.exitCode = exitCodeOf(checks);
}

if (import.meta.main) main();
