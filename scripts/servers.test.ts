import { describe, expect, it } from "vitest";
import { lsofToPortLines, parseListeningPorts, parseProcesses, serversOf, stopCommand, type ServerProcess } from "./servers.ts";

const main = "G:\\Rabaed Contech";
const lane = `${main}\\.claude\\worktrees\\RP-441-x`;
const other = `${main}\\.claude\\worktrees\\RP-442-y`;
const worktrees = [main, lane, other];

const proc = (pid: number, commandLine: string, name = "node.exe"): ServerProcess => ({ pid, name, commandLine });

describe("serversOf (RP-568)", () => {
  const processes = [
    proc(10, `"C:\\Program Files\\nodejs\\node.exe" "${lane}\\node_modules\\.pnpm\\next@15\\node_modules\\next\\dist\\bin\\next" dev --port 3800`),
    proc(11, `node "${lane}\\apps\\api\\node_modules\\tsx\\dist\\cli.mjs" watch src/main.ts`),
    proc(12, `node "${other}\\node_modules\\storybook\\bin\\index.cjs" dev --port 6006`),
    proc(13, `node "${main}\\node_modules\\vite\\bin\\vite.js"`),
    proc(14, `"C:\\Program Files\\nodejs\\node.exe" scripts/servers-stop.ts`),
    proc(15, `"C:\\Program Files\\Docker\\Docker\\resources\\com.docker.backend.exe" ${lane}\\node_modules\\x`, "com.docker.backend.exe"),
    proc(16, `node "${lane}\\scripts\\verify.ts"`),
  ];

  it("takes the node processes running from the worktree's node_modules, also a package's own (Windows paths, any case)", () => {
    expect(serversOf(processes, lane.toUpperCase(), worktrees, "win32").map((p) => p.pid)).toEqual([10, 11]);
  });

  it("never takes another worktree's processes, though the main folder's path contains every worktree under .claude/worktrees", () => {
    expect(serversOf(processes, main, worktrees, "win32").map((p) => p.pid)).toEqual([13]);
    expect(serversOf(processes, other, worktrees, "win32").map((p) => p.pid)).toEqual([12]);
  });

  it("never takes a process that is not node (Docker), or one that does not run from node_modules", () => {
    const pids = serversOf(processes, lane, worktrees, "win32").map((p) => p.pid);
    expect(pids).not.toContain(15);
    expect(pids).not.toContain(16);
  });

  it("matches POSIX paths exactly, and not a folder whose name only starts with the worktree's", () => {
    const posix = ["/home/u/rabaed", "/home/u/rabaed/.claude/worktrees/RP-1"];
    const ps = [
      proc(20, "node /home/u/rabaed/.claude/worktrees/RP-1/node_modules/next/dist/bin/next dev", "node"),
      proc(21, "node /home/u/rabaed/.claude/worktrees/RP-10/node_modules/next/dist/bin/next dev", "node"),
      proc(22, "node /home/u/rabaed/.claude/worktrees/rp-1/node_modules/next/dist/bin/next dev", "node"),
    ];
    expect(serversOf(ps, posix[1]!, posix, "linux").map((p) => p.pid)).toEqual([20]);
  });

  it("gives the main folder nothing under .claude/worktrees/, also from a removed worktree's leftover folder that git no longer lists", () => {
    const gone = proc(17, `node "${main}\\.claude\\worktrees\\RP-400-gone\\node_modules\\next\\dist\\bin\\next" dev`);
    expect(serversOf([gone], main, worktrees, "win32")).toEqual([]);
  });

  it("leaves out the given pids (this command and its ancestors)", () => {
    expect(serversOf(processes, lane, worktrees, "win32", new Set([10])).map((p) => p.pid)).toEqual([11]);
  });
});

describe("parseProcesses", () => {
  it("reads pid, name and command line separated by tabs, keeping tabs and spaces inside the command line", () => {
    expect(parseProcesses("10\tnode.exe\tnode a\tb\r\n\r\nbad\r\n11\tnode\t\r\n")).toEqual([
      { pid: 10, name: "node.exe", commandLine: "node a\tb" },
      { pid: 11, name: "node", commandLine: "" },
    ]);
  });
});

describe("parseListeningPorts", () => {
  it("reads `port pid` lines into ports per pid, sorted and without duplicates", () => {
    const ports = parseListeningPorts("3800 10\r\n3800 10\r\n4800 11\r\n 9229 10 \r\nnope\r\n");
    expect(ports.get(10)).toEqual([3800, 9229]);
    expect(ports.get(11)).toEqual([4800]);
    expect(ports.get(12)).toBeUndefined();
  });
});

describe("lsofToPortLines", () => {
  it("turns lsof -F pn output into port and pid lines", () => {
    expect(lsofToPortLines("p10\nf20\nn*:3800\nn127.0.0.1:9229\np11\nn[::1]:4800\n")).toBe("3800 10\n9229 10\n4800 11");
  });
});

describe("stopCommand", () => {
  it("stops the whole tree forcefully on Windows (a windowless node refuses a plain taskkill), and its children then it with SIGTERM elsewhere", () => {
    expect(stopCommand(10, "win32")).toEqual(["taskkill", ["/pid", "10", "/t", "/f"]]);
    expect(stopCommand(10, "linux")).toEqual(["sh", ["-c", "pkill -TERM -P 10; kill 10"]]);
  });
});
