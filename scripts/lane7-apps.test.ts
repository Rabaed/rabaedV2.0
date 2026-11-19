import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { servicesOf, parseAppsArgs, restartDelayMs, stateFiles, supervise, type Service } from "./lane7-apps.ts";

// RP-1183: lane 7's api and web ran from Main 7's session (`pnpm dev:apps`), so a session end took them down.

const root = join("C:", "work", "rabaed");

describe("servicesOf", () => {
  it("runs the api and web on the lane's ports, from the worktree's own node_modules", () => {
    const plan = servicesOf(7, root);
    expect(plan.map((a) => a.name)).toEqual(["lane7-api", "lane7-web"]);
    const [api, web] = plan;
    expect(api!.cwd).toBe(join(root, "apps", "api"));
    expect(api!.args).toEqual([join(root, "apps", "api", "node_modules", "tsx", "dist", "cli.mjs"), "src/server.ts"]);
    expect(api!.env).toEqual({ API_PORT: "4700" });
    expect(web!.cwd).toBe(join(root, "apps", "web"));
    expect(web!.args).toEqual([join(root, "apps", "web", "node_modules", "next", "dist", "bin", "next"), "dev", "--port", "3700"]);
    expect(web!.env).toEqual({ PORT: "3700" });
  });

  it("names another lane's ports and processes, so it can be tried on a lane of your own", () => {
    const [api, web] = servicesOf(54, root);
    expect(api!.name).toBe("lane54-api");
    expect(api!.env).toEqual({ API_PORT: "4540" });
    expect(web!.args.slice(-3)).toEqual(["dev", "--port", "3540"]);
  });
});

describe("parseAppsArgs", () => {
  it("takes start, stop, status or run, and lane 7 unless --lane says another", () => {
    expect(parseAppsArgs(["start"])).toEqual({ command: "start", lane: 7 });
    expect(parseAppsArgs([])).toEqual({ command: "start", lane: 7 });
    expect(parseAppsArgs(["status", "--lane", "54"])).toEqual({ command: "status", lane: 54 });
    expect(parseAppsArgs(["stop"])).toEqual({ command: "stop", lane: 7 });
    expect(parseAppsArgs(["run", "--lane", "54"])).toEqual({ command: "run", lane: 54 });
  });

  it("refuses an unknown command, a bad lane and an unknown flag", () => {
    expect(() => parseAppsArgs(["restart"])).toThrow(/Usage/);
    expect(() => parseAppsArgs(["start", "--lane", "60"])).toThrow(/not a lane/);
    expect(() => parseAppsArgs(["start", "--lane"])).toThrow(/--lane needs/);
    expect(() => parseAppsArgs(["start", "--force"])).toThrow(/Usage/);
  });
});

describe("restartDelayMs", () => {
  it("waits 2 s after a first quick crash, doubles for each next one, and stops growing at 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(restartDelayMs)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});

describe("supervise", () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
  });
  const folder = () => {
    const f = mkdtempSync(join(tmpdir(), "rp-1183-"));
    folders.push(f);
    return f;
  };
  /** An service that is `node -e code` (a stand-in for the api or web). */
  const service = (name: string, code: string, cwd: string): Service => ({ name, cwd, args: ["-e", code], env: {} });
  const until = async (done: () => boolean, ms = 8_000) => {
    const end = Date.now() + ms;
    while (!done()) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it("starts a service again after it crashes, and stops every service when the stop file appears", async () => {
    const dir = folder();
    const count = join(dir, "starts.txt");
    // Each start appends a line, then the service crashes the first two times and stays up the third.
    const code = `const fs=require('fs');fs.appendFileSync(${JSON.stringify(count)},'x');if(fs.readFileSync(${JSON.stringify(count)},'utf8').length<3)process.exit(1);setInterval(()=>{},1000)`;
    const stopFile = join(dir, "stop");
    const lines: string[] = [];
    const done = supervise([service("api", code, dir)], { stopFile, delayMs: () => 20, pollMs: 25, log: (l) => lines.push(l) });
    await until(() => existsSync(count) && readFileSync(count, "utf8").length >= 3);
    expect(lines.join("\n")).toMatch(/api exited with code 1; starting it again in 0\.02 s/);
    writeFileSync(stopFile, "");
    await done;
    expect(lines.at(-1)).toMatch(/stopped/);
  });
});

describe("stateFiles", () => {
  it("keeps one lane's pid, log and stop files in their own folder in the OS temp folder", () => {
    const files = stateFiles(54, "T");
    expect(files).toEqual({ dir: join("T", "rabaed-lane54-apps"), pid: join("T", "rabaed-lane54-apps", "supervisor.pid"), log: join("T", "rabaed-lane54-apps", "apps.log"), stop: join("T", "rabaed-lane54-apps", "stop") });
  });
});
