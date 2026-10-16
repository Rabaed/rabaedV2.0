import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { samePath } from "./paths.ts";

// RP-608: worktrees:prune removed the worktree of an open Claude desktop session. The
// desktop app does not lock the worktrees it makes with git (only Claude Code's own
// "claude session" / "claude agent" locks show in `git worktree list`), so the scripts
// must ask the app's own records: <appDir>/git-worktrees.json names each worktree it
// made, by path, with the session leasing it, and <appDir>/claude-code-sessions/*/*/<id>.json
// says whether that session is archived. The match is by path only: the app keeps the
// branch it created (claude/<name>), not the one a session renamed it to.

/** The desktop app's data folder: %APPDATA%\Claude on Windows, ~/Library/Application Support/Claude on macOS, ~/.config/Claude elsewhere. */
export function desktopAppDir(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Claude");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Claude");
}

type AppWorktree = { path: string; leasedBy: string | null };
type SessionRecord = { title?: string; isArchived?: boolean };

/**
 * A lookup from a worktree path to the open desktop session holding it (`session "<title>"`),
 * or undefined when none does. A worktree leased by a session whose record is missing counts
 * as open. With no worktree list the app is not in use and nothing is held; when the list
 * cannot be read, every worktree is held, so nothing is removed on a guess.
 */
export function readDesktopSessions(appDir: string = desktopAppDir(), platform: NodeJS.Platform = process.platform): (path: string) => string | undefined {
  const file = join(appDir, "git-worktrees.json");
  if (!existsSync(file)) return () => undefined;
  let worktrees: AppWorktree[];
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as { worktrees?: Record<string, AppWorktree> };
    worktrees = Object.values(json.worktrees ?? {});
  } catch {
    return () => `unknown: Claude desktop's worktree list (${file}) could not be read`;
  }
  const sessions = new Map<string, SessionRecord | undefined>();
  const sessionOf = (id: string) => {
    if (!sessions.has(id)) sessions.set(id, readSession(appDir, id));
    return sessions.get(id);
  };
  return (path) => {
    const w = worktrees.find((x) => typeof x.path === "string" && samePath(x.path, path, platform));
    if (!w?.leasedBy) return undefined;
    const s = sessionOf(w.leasedBy);
    if (s?.isArchived === true) return undefined;
    return s?.title ? `session "${s.title}"` : `session ${w.leasedBy}`;
  };
}

/** The session's record from claude-code-sessions/<owner>/<org>/<id>.json, or undefined when none is found or readable. */
function readSession(appDir: string, id: string): SessionRecord | undefined {
  const root = join(appDir, "claude-code-sessions");
  const dirs = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name));
    } catch {
      return [];
    }
  };
  for (const owner of dirs(root)) {
    for (const org of dirs(owner)) {
      const file = join(org, `${id}.json`);
      if (!existsSync(file)) continue;
      try {
        return JSON.parse(readFileSync(file, "utf8")) as SessionRecord;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
