// RP-1007: two `lane:env --free` runs two seconds apart both got lane 33 (2026-10-21). lane:env
// now holds one lock per clone from reading the lanes until its .env is written.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { envClaims, firstFreeLane, laneClashes, readWorktreeEnv } from "./lanes.ts";
import { acquireLaneLock, type LockDeps } from "./lanes-lock.ts";

let root: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rp-1007-lock-"));
  file = join(root, "rabaed-lane-env.lock");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A clock that only moves when the lock sleeps; onSleep runs on each sleep (another session working meanwhile). */
const deps = (pid: number, { alive = () => true, onSleep = () => {} }: { alive?: (pid: number) => boolean; onSleep?: () => void } = {}) => {
  let t = 0;
  const d: LockDeps & { slept: number } = {
    pid,
    now: () => t,
    alive,
    sleep: (ms) => {
      d.slept++;
      t += ms;
      onSleep();
    },
    slept: 0,
  };
  return d;
};

const held = (x: ReturnType<typeof acquireLaneLock>) => {
  if ("error" in x) throw new Error(x.error);
  return x;
};

describe("acquireLaneLock", () => {
  it("takes a free lock and removes it on release", () => {
    const lock = held(acquireLaneLock(file, deps(10)));
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ pid: 10 });
    lock.release();
    expect(existsSync(file)).toBe(false);
  });

  it("waits while another live run holds it, then gives up naming that run", () => {
    held(acquireLaneLock(file, deps(10)));
    const waiting = deps(11);
    const second = acquireLaneLock(file, waiting, { waitMs: 1000 });
    expect(second).toEqual({ error: `Another pnpm lane:env (pid 10) is choosing a lane in this clone; wait for it to finish and re-run. If it is gone, delete ${file}.` });
    expect(waiting.slept).toBeGreaterThan(1);
  });

  it("takes over a lock whose run is no longer running, or that is unreadable", () => {
    held(acquireLaneLock(file, deps(10)));
    expect("release" in acquireLaneLock(file, deps(11, { alive: (pid) => pid !== 10 }))).toBe(true);
    writeFileSync(file, "garbage");
    expect("release" in acquireLaneLock(file, deps(12))).toBe(true);
  });

  it("never removes a lock another run has taken since", () => {
    const lock = held(acquireLaneLock(file, deps(10)));
    writeFileSync(file, JSON.stringify({ pid: 11, at: 0 }));
    lock.release();
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ pid: 11 });
  });
});

describe("two lane:env --free runs at once (RP-1007)", () => {
  it("gives the second run another lane: it waits for the first's .env", () => {
    const a = join(root, "RP-1025-a");
    const b = join(root, "RP-1002-b");
    mkdirSync(a);
    mkdirSync(b);
    const worktrees = [
      { path: a, branch: "RP-1025-a" },
      { path: b, branch: "RP-1002-b" },
    ];
    // Lanes 31 and 32 are taken; both runs start from 31.
    const choose = (cwd: string) => {
      const input = { containers: [], takenPorts: new Set([5742, 5752]), cwd, claims: envClaims(worktrees, { cwd, readEnv: readWorktreeEnv }) };
      return firstFreeLane(31, (n) => laneClashes(n, input));
    };
    const first = held(acquireLaneLock(file, deps(1)));
    const lane = choose(a);
    let firstDone = false;
    // The second run starts before the first has written its .env; while it waits, the first finishes.
    const second = acquireLaneLock(
      file,
      deps(2, {
        onSleep: () => {
          if (firstDone) return;
          writeFileSync(join(a, ".env"), `COMPOSE_PROJECT_NAME=rabaed-lane${lane}\n`);
          first.release();
          firstDone = true;
        },
      }),
    );
    expect(lane).toBe(33);
    expect("release" in second).toBe(true);
    expect(choose(b)).toBe(34);
  });
});
