import { describe, expect, it } from "vitest";
import { DOCKER_NOT_ANSWERING, DOCKER_PROBE_TIMEOUT_MS, probeDocker, realDockerRun, type DockerRun } from "./docker-probe.ts";

/** A runner that answers per command line, and records every call. */
const answering = (answers: Record<string, ReturnType<DockerRun>>) => {
  const calls: { args: string[]; timeoutMs: number }[] = [];
  const run: DockerRun = (args, timeoutMs) => {
    calls.push({ args, timeoutMs });
    return answers[args.join(" ")] ?? { ok: true, output: "" };
  };
  return { run, calls };
};

describe("probeDocker", () => {
  it("passes when docker version and docker volume ls both answer, in that order, with the timeout", () => {
    const { run, calls } = answering({});
    expect(probeDocker(run)).toEqual({ ok: true });
    expect(calls.map((c) => c.args[0])).toEqual(["version", "volume"]);
    expect(calls.every((c) => c.timeoutMs === DOCKER_PROBE_TIMEOUT_MS)).toBe(true);
  });

  it("keeps the whole probe inside 30 s: two calls at most", () => {
    expect(DOCKER_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(2 * DOCKER_PROBE_TIMEOUT_MS).toBeLessThan(30_000);
  });

  it("reports a docker version that hangs, without waiting for volume ls", () => {
    const { run, calls } = answering({ version: { ok: false, reason: "timeout", detail: "no answer" } });
    expect(probeDocker(run)).toEqual({ ok: false, kind: "hang", message: "Docker not answering: wait, don't restart it (RP-1099)" });
    expect(calls).toHaveLength(1);
  });

  it("reports a volume ls that hangs even though docker version answered (the half-jammed Docker)", () => {
    const { run } = answering({ "volume ls -q": { ok: false, reason: "timeout", detail: "no answer" } });
    expect(probeDocker(run)).toEqual({ ok: false, kind: "hang", message: DOCKER_NOT_ANSWERING });
  });

  it("gives the same message for an error or a missing docker, as kind down", () => {
    for (const reason of ["failed", "missing"] as const) {
      const { run } = answering({ version: { ok: false, reason, detail: "Cannot connect to the Docker daemon" } });
      expect(probeDocker(run)).toEqual({ ok: false, kind: "down", message: DOCKER_NOT_ANSWERING });
    }
  });
});

describe("realDockerRun", () => {
  it("reports a missing or failing command as not ok without throwing", () => {
    const result = realDockerRun(["no-such-subcommand-for-rp1197"], 5_000);
    expect(result.ok).toBe(false);
  });
});
