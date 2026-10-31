import { describe, expect, it } from "vitest";
import type { Container } from "./lanes.ts";
import { chooseStackStop, stopAfterEnqueue, stopQueuedStack, type StopInput } from "./queue-stack-stop.ts";

// RP-1170: once `pnpm queue` has queued a PR, the lane's stack is no longer needed; stopping it (its volumes
// stay) frees a Docker slot. On 2026-10-31 idle stacks held Docker at 8 of 8 while #539 waited.

const lane = "G:/r/.claude/worktrees/rp-1170";
const c = (x: Partial<Container> & Pick<Container, "name">): Container => ({ state: "running", project: "rabaed-lane41", workingDir: lane, ports: [], ...x });

const input = (over: Partial<StopInput> = {}): StopInput => ({
  pr: 590,
  branch: "RP-1170-queue-stop",
  worktrees: [
    { path: lane, branch: "RP-1170-queue-stop", project: "rabaed-lane41" },
    { path: "G:/r/.claude/worktrees/rp-900", branch: "RP-900-x", project: "rabaed-lane42" },
  ],
  containers: [c({ name: "rabaed-lane41-db-1" }), c({ name: "rabaed-lane41-files-1" }), c({ name: "rabaed-lane41-mailpit-1", state: "exited" }), c({ name: "rabaed-lane42-db-1", project: "rabaed-lane42" })],
  verifyIn: () => undefined,
  serversIn: () => [],
  ...over,
});

describe("chooseStackStop", () => {
  it("stops the running containers of the stack the PR's worktree has in its .env", () => {
    const decision = chooseStackStop(input());
    expect(decision.stop).toEqual({ project: "rabaed-lane41", containers: ["rabaed-lane41-db-1", "rabaed-lane41-files-1"], path: lane });
    expect(decision.lines).toEqual([]);
  });

  it("says nothing to stop when no worktree of this clone is on the PR's branch", () => {
    expect(chooseStackStop(input({ branch: "RP-1-elsewhere" }))).toEqual({ stop: undefined, lines: ["No worktree of this clone is on RP-1-elsewhere: no stack stopped."] });
  });

  it("leaves a stack another worktree's .env has running, naming each one (a subagent or the lane's next ticket)", () => {
    const worktrees = [
      ...input().worktrees,
      { path: "G:/r/.claude/worktrees/agent-a", branch: "RP-1171-part", project: "rabaed-lane41" },
      { path: "G:/r/.claude/worktrees/rp-1172", branch: undefined, project: "rabaed-lane41" },
    ];
    expect(chooseStackStop(input({ worktrees }))).toEqual({
      stop: undefined,
      lines: [
        "Stack rabaed-lane41 left running: the .env of G:/r/.claude/worktrees/agent-a (on RP-1171-part) has it too.",
        "Stack rabaed-lane41 left running: the .env of G:/r/.claude/worktrees/rp-1172 (on a detached HEAD) has it too.",
      ],
    });
  });

  it("leaves it running while a verify runs on it", () => {
    const verifyIn = (path: string) => (path === lane ? { pid: 7, started: new Date(2026, 9, 31, 22, 5), command: "pnpm verify" } : undefined);
    expect(chooseStackStop(input({ verifyIn })).lines).toEqual(["Stack rabaed-lane41 left running: a verify runs in G:/r/.claude/worktrees/rp-1170 (pid 7, started 22:05, `pnpm verify`)."]);
  });

  it("leaves it running while a dev server of the worktree uses it", () => {
    expect(chooseStackStop(input({ serversIn: () => ["node (pid 31) on port 3410"] })).lines).toEqual([
      "Stack rabaed-lane41 left running: G:/r/.claude/worktrees/rp-1170 runs a dev server (node (pid 31) on port 3410); `pnpm servers:stop --yes` there, then `docker compose stop`.",
    ]);
  });

  it("never stops lane 7, Main 7's harness", () => {
    const worktrees = [{ path: lane, branch: "RP-1170-queue-stop", project: "rabaed-lane7" }];
    expect(chooseStackStop(input({ worktrees })).lines[0]).toMatch(/^Stack rabaed-lane7 left running: lane 7 holds Main 7's UAT harness data/);
  });

  it("says so when the worktree's .env has no stack, or the stack is already stopped", () => {
    expect(chooseStackStop(input({ worktrees: [{ path: lane, branch: "RP-1170-queue-stop", project: undefined }] })).lines).toEqual([
      "G:/r/.claude/worktrees/rp-1170's .env has no stack: none stopped.",
    ]);
    expect(chooseStackStop(input({ containers: [c({ name: "rabaed-lane41-db-1", state: "exited" })] })).lines).toEqual(["Stack rabaed-lane41 is already stopped."]);
  });
});

describe("stopQueuedStack", () => {
  it("runs `docker stop` (never rm, so the volumes stay) and says how to start the stack again", () => {
    const calls: string[][] = [];
    const lines = stopQueuedStack(input(), (args) => {
      calls.push(args);
      return "";
    });
    expect(calls).toEqual([["stop", "rabaed-lane41-db-1", "rabaed-lane41-files-1"]]);
    expect(lines).toEqual([
      "Stopped rabaed-lane41's containers to free a Docker slot; its volumes stay. If the queue drops PR #590, start them again in G:/r/.claude/worktrees/rp-1170 with `docker compose up -d --wait db mailpit files`.",
    ]);
  });

  it("warns, and never throws, when Docker refuses", () => {
    const lines = stopQueuedStack(input(), () => {
      throw Object.assign(new Error("x"), { stderr: "Cannot connect to the Docker daemon" });
    });
    expect(lines).toEqual(["Warning: could not stop rabaed-lane41 (Cannot connect to the Docker daemon); the PR is queued all the same. Run `docker compose stop` in G:/r/.claude/worktrees/rp-1170."]);
  });
});

describe("review fixes (RP-1170 PR 3 /code-review)", () => {
  it("never stops the main checkout's stack, even when the PR's branch is checked out there", () => {
    const worktrees = [{ path: "G:/r", branch: "RP-1170-queue-stop", project: "rabaed-lane0", main: true }];
    expect(chooseStackStop(input({ worktrees, containers: [c({ name: "rabaed-lane0-db-1", project: "rabaed-lane0", workingDir: "G:/r" })] }))).toEqual({
      stop: undefined,
      lines: ["Stack rabaed-lane0 left running: G:/r is the main checkout."],
    });
  });

  it("stopAfterEnqueue stops only after a successful queue, not with --keep-stack, and turns a read that throws into a warning", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => (calls.push(args), "");
    expect(stopAfterEnqueue({ ok: false, args: [], read: () => input(), run })).toEqual([]);
    expect(stopAfterEnqueue({ ok: true, args: ["590", "--keep-stack"], read: () => input(), run })).toEqual([]);
    expect(calls).toEqual([]);
    expect(stopAfterEnqueue({ ok: true, args: ["590"], read: () => input(), run })[0]).toMatch(/^Stopped rabaed-lane41's containers/);
    expect(calls).toHaveLength(1);
    const warning = stopAfterEnqueue({
      ok: true,
      args: ["590"],
      read: () => {
        throw new Error("Docker did not answer\nmore");
      },
      run,
    });
    expect(warning).toEqual(["Warning: the lane's stack was not checked (Docker did not answer); the PR is queued all the same."]);
  });
});
