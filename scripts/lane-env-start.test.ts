import { describe, expect, it } from "vitest";
import { startCommand, startStack, type ComposeRun } from "./lane-env-start.ts";

const never = () => {
  throw new Error("docker must not run");
};
const answering = (run: ComposeRun) => {
  const calls: string[][] = [];
  return {
    calls,
    compose: (args: string[]) => {
      calls.push(args);
      return run;
    },
  };
};

describe("startStack", () => {
  it("runs docker compose -p <project> up -d --wait and says it started", () => {
    const docker = answering({ status: 0, output: "" });
    const result = startStack("rabaed-lane31", { dockerRunning: true, compose: docker.compose });
    expect(docker.calls).toEqual([["compose", "-p", "rabaed-lane31", "up", "-d", "--wait"]]);
    expect(result.started).toBe(true);
    expect(result.lines.join("\n")).toContain("Started the containers of rabaed-lane31");
  });

  it("says plainly that it didn't when Docker is down, with the exact command, and never calls docker", () => {
    const result = startStack("rabaed-lane31", { dockerRunning: false, compose: never });
    expect(result.started).toBe(false);
    expect(result.lines.join("\n")).toContain("NOT started: Docker is not running");
    expect(result.lines.join("\n")).toContain("docker compose -p rabaed-lane31 up -d --wait");
  });

  it("says why and the command when compose fails, with the end of its output", () => {
    const output = ["one", "two", "three", "four", "five", "six", "seven", "container rabaed-lane31-db-1 is unhealthy"].join("\n");
    const docker = answering({ status: 1, output });
    const result = startStack("rabaed-lane31", { dockerRunning: true, compose: docker.compose });
    const text = result.lines.join("\n");
    expect(result.started).toBe(false);
    expect(text).toContain("NOT started");
    expect(text).toContain("(exit 1)");
    expect(text).toContain("container rabaed-lane31-db-1 is unhealthy");
    expect(text).not.toContain("one\n");
    expect(text).toContain(`Fix that, then run: ${startCommand("rabaed-lane31")}`);
  });

  it("names the error when docker could not run at all", () => {
    const result = startStack("rabaed-lane31", { dockerRunning: true, compose: () => ({ status: null, output: "", error: "spawn docker ENOENT" }) });
    expect(result.started).toBe(false);
    expect(result.lines.join("\n")).toContain("spawn docker ENOENT");
    expect(result.lines.join("\n")).not.toContain("exit null");
  });

  it("skips with the caller's reason and prints the command, never calling docker", () => {
    const result = startStack("rabaed-lane31", { dockerRunning: true, compose: never }, "a --db worktree shares the lane's stack.");
    expect(result.started).toBe(false);
    expect(result.lines.join("\n")).toContain("a --db worktree shares the lane's stack. To start them: docker compose -p rabaed-lane31 up -d --wait");
  });
});
