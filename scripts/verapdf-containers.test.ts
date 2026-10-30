import { describe, expect, it } from "vitest";
import { chooseVeraPdfContainers, parseVeraPdfContainers, protectedHashes } from "./verapdf-containers.ts";
import { worktreeHash } from "./test-stories-linux.ts";

// `docker ps -a --filter label=rabaed.verapdf --format ...` as Docker prints it: name, label, state, age.
const ps = [
  "rabaed-verapdf-0a1b2c3d-4312-0\t0a1b2c3d\trunning\t2 hours ago",
  "rabaed-verapdf-0a1b2c3d-5100-1\t0a1b2c3d\trunning\t3 minutes ago",
  "rabaed-verapdf-9f8e7d6c-77-0\t9f8e7d6c\texited\t40 minutes ago",
  "someone-renamed-it\t0a1b2c3d\trunning\t1 hour ago",
  "",
].join("\n");

describe("parseVeraPdfContainers", () => {
  it("reads each container's worktree hash and the pid its name carries", () => {
    expect(parseVeraPdfContainers(ps)).toEqual([
      { name: "rabaed-verapdf-0a1b2c3d-4312-0", hash: "0a1b2c3d", pid: 4312, state: "running", age: "2 hours ago" },
      { name: "rabaed-verapdf-0a1b2c3d-5100-1", hash: "0a1b2c3d", pid: 5100, state: "running", age: "3 minutes ago" },
      { name: "rabaed-verapdf-9f8e7d6c-77-0", hash: "9f8e7d6c", pid: 77, state: "exited", age: "40 minutes ago" },
      { name: "someone-renamed-it", hash: "0a1b2c3d", pid: undefined, state: "running", age: "1 hour ago" },
    ]);
  });
});

describe("chooseVeraPdfContainers", () => {
  const containers = parseVeraPdfContainers(ps);

  it("removes a container whose test process is gone and keeps one whose process still runs", () => {
    const { remove, kept } = chooseVeraPdfContainers({ containers, alive: (pid) => pid === 5100, protectedHashes: new Map() });
    expect(remove.map((c) => c.name)).toEqual(["rabaed-verapdf-0a1b2c3d-4312-0", "rabaed-verapdf-9f8e7d6c-77-0"]);
    expect(kept).toEqual([
      { what: "rabaed-verapdf-0a1b2c3d-5100-1", reason: "its test process (pid 5100) still runs" },
      { what: "someone-renamed-it", reason: "no pid after rabaed-verapdf-<hash>- (renamed?), so whether its test still runs is not known" },
    ]);
  });

  it("never removes lane 7's, even with its process gone", () => {
    const { remove, kept } = chooseVeraPdfContainers({ containers, alive: () => false, protectedHashes: new Map([["9f8e7d6c", "lane 7: Main 7's harness data; ask Main 7"]]) });
    expect(remove.map((c) => c.name)).toEqual(["rabaed-verapdf-0a1b2c3d-4312-0", "rabaed-verapdf-0a1b2c3d-5100-1"]);
    expect(kept[0]).toEqual({ what: "rabaed-verapdf-9f8e7d6c-77-0", reason: "lane 7: Main 7's harness data; ask Main 7" });
  });
});

describe("protectedHashes", () => {
  it("names the hashes of the worktrees holding lane 7, in every spelling of their path", () => {
    const hashes = protectedHashes([{ path: "G:/Rabaed/.claude/worktrees/main-7", project: "rabaed-lane7" }, { path: "G:/Rabaed/.claude/worktrees/x", project: "rabaed-lane21" }], "win32");
    expect(hashes.get(worktreeHash("G:\\Rabaed\\.claude\\worktrees\\main-7"))).toMatch(/Main 7/);
    expect(hashes.has(worktreeHash("G:\\Rabaed\\.claude\\worktrees\\x"))).toBe(false);
  });
});
