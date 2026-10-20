import { describe, expect, it } from "vitest";
import type { Holders } from "./claude-sessions.ts";
import { openedSinceListed, resolveTarget, type TargetGit } from "./worktrees-clean.ts";

describe("openedSinceListed", () => {
  const agent = "G:/Rabaed Contech/.claude/worktrees/agent-a1";
  const none: Holders = { runningSession: () => undefined, desktopSession: () => undefined };

  it("lets a worktree go that no session holds", () => {
    expect(openedSinceListed(agent, none)).toBeUndefined();
  });

  it("keeps and names one a desktop session opened after the prompt (RP-608)", () => {
    const holders: Holders = { ...none, desktopSession: (path) => (path === agent ? { kind: "open", session: 'session "RP-9"' } : undefined) };
    expect(openedSinceListed(agent, holders)).toBe('its Claude desktop session is open (session "RP-9")');
    expect(openedSinceListed("G:/Rabaed Contech/.claude/worktrees/agent-b2", holders)).toBeUndefined();
  });

  it("keeps and names one a running Claude session moved into after the prompt, before a desktop session (RP-956)", () => {
    const holders: Holders = {
      runningSession: (path) => (path === agent ? 'a running Claude session is in it: session "Main 9" (pid 9)' : undefined),
      desktopSession: () => ({ kind: "open", session: 'session "RP-9"' }),
    };
    expect(openedSinceListed(agent, holders)).toBe('a running Claude session is in it: session "Main 9" (pid 9)');
  });

  it("keeps one when the app's records or the running sessions can no longer be read", () => {
    expect(openedSinceListed(agent, { ...none, desktopSession: () => ({ kind: "unknown", reason: "list unreadable" }) })).toBe("a Claude desktop session may hold it: list unreadable");
    expect(openedSinceListed(agent, { ...none, runningSession: () => "running Claude sessions could not be checked: x" })).toBe("running Claude sessions could not be checked: x");
  });
});

/** A fake git with the given refs; `ancestors` lists "a<b" pairs where a is an ancestor of b. */
const fakeGit = (refs: string[], { ancestors = [] as string[], fetchFails = false } = {}) => {
  const calls: string[] = [];
  const git: TargetGit = {
    fetch: () => {
      calls.push("fetch");
      if (fetchFails) throw Object.assign(new Error("Command failed"), { stderr: "could not resolve host\n" });
    },
    exists: (ref) => {
      calls.push(`exists ${ref}`);
      return refs.includes(ref);
    },
    isAncestor: (a, b) => a === b || ancestors.includes(`${a}<${b}`),
  };
  return { git, calls };
};

describe("resolveTarget", () => {
  it("resolves --into main to origin/main when it exists, fetching first, and names the ref", () => {
    const { git, calls } = fakeGit(["main", "origin/main"], { ancestors: ["main<origin/main"] });
    const result = resolveTarget("main", git);
    expect(result).toEqual({ ref: "origin/main", lines: ["Checking against origin/main."] });
    expect(calls[0]).toBe("fetch");
  });

  it("keeps a local-only branch working", () => {
    const { git } = fakeGit(["RP-560-local-only"]);
    expect(resolveTarget("RP-560-local-only", git)).toEqual({ ref: "RP-560-local-only", lines: ["Checking against RP-560-local-only (no origin/RP-560-local-only)."] });
  });

  it("uses the local branch when it is ahead of origin (merged but not pushed yet)", () => {
    const { git } = fakeGit(["RP-560-spec", "origin/RP-560-spec"], { ancestors: ["origin/RP-560-spec<RP-560-spec"] });
    expect(resolveTarget("RP-560-spec", git)).toEqual({ ref: "RP-560-spec", lines: ["Checking against RP-560-spec (ahead of origin/RP-560-spec)."] });
  });

  it("takes an origin/ ref as given", () => {
    const { git } = fakeGit(["origin/main"]);
    expect(resolveTarget("origin/main", git)).toEqual({ ref: "origin/main", lines: ["Checking against origin/main."] });
  });

  it("goes on with the refs it has when the fetch fails, and says so", () => {
    const { git } = fakeGit(["main", "origin/main"], { fetchFails: true });
    expect(resolveTarget("main", git)).toEqual({
      ref: "origin/main",
      lines: ["git fetch origin failed (could not resolve host); origin/main may be behind.", "Checking against origin/main."],
    });
  });

  it("returns no ref when neither the branch nor origin's has it", () => {
    const { git } = fakeGit([]);
    expect(resolveTarget("RP-999-none", git).ref).toBeUndefined();
  });
});
