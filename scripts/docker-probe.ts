import { spawnSync } from "node:child_process";

// Is Docker answering? RP-1197 (item 2), after RP-1099: when Docker Desktop jams, every `docker` call
// hangs, so `pnpm lane:env` sat on its container listing and `pnpm verify` found out only at its
// stack check, after other work. This probes before either does anything: `docker version` (the
// daemon answers) and `docker volume ls` (the part that jams first), each with a timeout, and
// reports one message. Read-only: it starts, stops and removes nothing, and never restarts Docker.
//
// Each call gets 12 s: a healthy Docker answers either in well under a second, and a jammed one is
// reported in at most 2 x 12 = 24 s, inside the 30 s the spec allows (a 20 s timeout each would
// take 40 s). Used by `check:doctor` (doctor.ts), `lane:env` and `pnpm verify`.
//
// node scripts/docker-probe.ts
// Exit code 0 when Docker answers, 1 when it does not (the message says what to do).

/** How long each of the probe's docker calls may take. Two calls: 24 s at most in total. */
export const DOCKER_PROBE_TIMEOUT_MS = 12_000;

/** What to tell whoever finds Docker not answering. Lanes never restart Docker Desktop (RP-1099). */
export const DOCKER_NOT_ANSWERING = "Docker not answering: wait, don't restart it (RP-1099)";

/** What to tell whoever finds Docker missing or not running: the fix is to start it, not to wait. */
export const DOCKER_NOT_RUNNING = "Docker is not running: start Docker Desktop, then run this again";

/** One docker call: its output, or why it failed. "timeout" is a hang; "missing" is no docker on PATH. */
export type DockerRun = (args: string[], timeoutMs: number) => { ok: true; output: string } | { ok: false; reason: "timeout" | "missing" | "failed"; detail: string };

export type DockerProbe = { ok: true } | { ok: false; kind: "hang" | "down"; message: string };

/** The docker CLI, run without a shell. A call that outlives its timeout is killed and reported as "timeout". */
export const realDockerRun: DockerRun = (args, timeoutMs) => {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  const code = (result.error as { code?: string } | undefined)?.code;
  if (code === "ETIMEDOUT" || (result.error === undefined && result.status === null && result.signal !== null)) {
    return { ok: false, reason: "timeout", detail: `no answer in ${timeoutMs / 1000} s` };
  }
  if (code === "ENOENT") return { ok: false, reason: "missing", detail: "docker is not on PATH" };
  if (result.error !== undefined) return { ok: false, reason: "failed", detail: result.error.message };
  if (result.status !== 0) return { ok: false, reason: "failed", detail: (result.stderr ?? "").trim().split("\n")[0] ?? "" };
  return { ok: true, output: result.stdout ?? "" };
};

/**
 * Runs `docker version` then `docker volume ls`, each with `timeoutMs`, and stops at the first that
 * fails. A hang (no answer in time, kind "hang") gets DOCKER_NOT_ANSWERING: wait, never restart. A Docker
 * that answered with an error or is not installed (kind "down") gets DOCKER_NOT_RUNNING: start it.
 */
export function probeDocker(run: DockerRun = realDockerRun, timeoutMs: number = DOCKER_PROBE_TIMEOUT_MS): DockerProbe {
  for (const args of [["version"], ["volume", "ls", "-q"]]) {
    const result = run(args, timeoutMs);
    if (!result.ok) const hang = result.reason === "timeout";
    return { ok: false, kind: hang ? "hang" : "down", message: hang ? DOCKER_NOT_ANSWERING : DOCKER_NOT_RUNNING };
  }
  return { ok: true };
}

/**
 * The message to stop with, or undefined to go on. "hang" mode stops only on a hang (a down Docker is
 * handled by the caller, as before the probe); "any" mode stops on both.
 */
export function dockerStop(probe: DockerProbe, mode: "hang" | "any"): string | undefined {
  if (probe.ok) return undefined;
  return probe.kind === "hang" || mode === "any" ? probe.message : undefined;
}

if (import.meta.main) {
  const probe = probeDocker();
  console.log(probe.ok ? "Docker answers." : probe.message);
  process.exitCode = probe.ok ? 0 : 1;
}
