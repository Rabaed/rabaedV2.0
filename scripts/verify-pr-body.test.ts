import { describe, expect, it } from "vitest";
import type { spawnSync } from "node:child_process";
import { prHeadRefusal, realPrBodySeam, writeVerifyLine, type PrBodySeam } from "./verify-pr-body.ts";
import { verifyGate } from "./verify-gate.ts";
import { finalLine } from "./verify-steps.ts";

const HEAD = "a".repeat(40);
const SHORT = "aaaaaaa";
const line = finalLine({ sha: SHORT, dirty: false, steps: ["lint", "typecheck"] });
const stale = finalLine({ sha: "bbbbbbb", dirty: false, steps: ["lint"] });

function fakeSeam(body: string, prHead = HEAD) {
  const written: string[] = [];
  const seam: PrBodySeam = {
    pullHead: () => prHead,
    body: () => body,
    setBody: (_pr, text) => void written.push(text),
  };
  return { seam, written };
}

describe("realPrBodySeam", () => {
  it("reads the head and body with gh pr view, and sets the body from a file, never on the command line", () => {
    const calls: { args: string[]; file?: string }[] = [];
    const spawn = ((command: string, args: string[]) => {
      const file = args.includes("--body-file") ? args[args.indexOf("--body-file") + 1] : undefined;
      calls.push({ args: [command, ...args], ...(file ? { file } : {}) });
      const out = args.includes("headRefOid") ? '{"headRefOid":"abc"}' : args.includes("body") ? '{"body":null}' : "";
      return { status: 0, stdout: out, stderr: "" };
    }) as unknown as typeof spawnSync;
    const seam = realPrBodySeam("/repo", spawn);
    expect(seam.pullHead(9)).toBe("abc");
    expect(seam.body(9)).toBe("");
    seam.setBody(9, "the body\nwith a line");
    expect(calls[2]?.args.slice(0, 4)).toEqual(["gh", "pr", "edit", "9"]);
    expect(calls[2]?.args.join(" ")).not.toContain("the body");
    expect(calls[2]?.file).toBeDefined();
  });

  it("throws gh's output when gh fails", () => {
    const spawn = (() => ({ status: 1, stdout: "", stderr: "HTTP 401" })) as unknown as typeof spawnSync;
    expect(() => realPrBodySeam("/repo", spawn).pullHead(1)).toThrow("HTTP 401");
  });
});

describe("prHeadRefusal", () => {
  it("passes when HEAD is the PR's head", () => {
    expect(prHeadRefusal(5, HEAD, HEAD)).toBeUndefined();
  });

  it("refuses when HEAD is another commit, naming both and the fix", () => {
    const refusal = prHeadRefusal(5, HEAD, "c".repeat(40));
    expect(refusal).toContain("PR #5");
    expect(refusal).toContain(HEAD.slice(0, 9));
    expect(refusal).toContain("c".repeat(9));
    expect(refusal).toContain("git push");
  });
});

describe("writeVerifyLine", () => {
  it("appends the line to a body that has none, after a blank line", () => {
    const { seam, written } = fakeSeam("## Summary\n\nDid a thing.");
    expect(writeVerifyLine(5, line, HEAD, seam)).toEqual({ ok: true, replaced: false });
    expect(written).toEqual([`## Summary\n\nDid a thing.\n\n${line}\n`]);
  });

  it("writes the line alone into an empty body", () => {
    const { seam, written } = fakeSeam("");
    expect(writeVerifyLine(5, line, HEAD, seam).ok).toBe(true);
    expect(written).toEqual([`${line}\n`]);
  });

  it("replaces a stale line in place, leaving the text around it", () => {
    const { seam, written } = fakeSeam(`Intro\n\n- ${stale}\n\nOutro`);
    expect(writeVerifyLine(5, line, HEAD, seam)).toEqual({ ok: true, replaced: true });
    expect(written).toEqual([`Intro\n\n- ${line}\n\nOutro`]);
  });

  it("replaces a stale line that sits in a code span, and keeps the code span", () => {
    const { seam, written } = fakeSeam(`Verify: \`${stale}\` done`);
    expect(writeVerifyLine(5, line, HEAD, seam).ok).toBe(true);
    expect(written).toEqual([`Verify: \`${line}\` done`]);
  });

  it("leaves one line when the body had several, dropping the lines that held only a stale one", () => {
    const { seam, written } = fakeSeam(`${stale}\nmiddle\n${stale}\n`);
    expect(writeVerifyLine(5, line, HEAD, seam).ok).toBe(true);
    expect(written).toEqual([`${line}\nmiddle\n`]);
  });

  it("writes a line that the verify gate then accepts for the head", () => {
    const { seam, written } = fakeSeam("x");
    writeVerifyLine(5, line, HEAD, seam);
    const git = { parents: () => [], onMain: () => false, tree: () => "", mergedTree: () => "" };
    expect(verifyGate(written[0] ?? "", HEAD, git as never).ok).toBe(true);
  });

  it("refuses a line without a valid stamp (a dirty or resumed run), writing nothing", () => {
    const { seam, written } = fakeSeam("x");
    const dirty = finalLine({ sha: SHORT, dirty: true, steps: ["lint"] });
    const result = writeVerifyLine(5, dirty, HEAD, seam);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("stamp");
    expect(written).toEqual([]);
  });

  it("refuses when the line names a commit that is not HEAD", () => {
    const { seam, written } = fakeSeam("x");
    const result = writeVerifyLine(5, stale, HEAD, seam);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("bbbbbbb");
    expect(written).toEqual([]);
  });

  it("refuses when the PR's head moved since the run began, writing nothing", () => {
    const { seam, written } = fakeSeam("x", "d".repeat(40));
    const result = writeVerifyLine(5, line, HEAD, seam);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("PR #5");
    expect(written).toEqual([]);
  });

  it("says so, with the error, when GitHub refuses the edit", () => {
    const { seam } = fakeSeam("x");
    seam.setBody = () => {
      throw new Error("gh: HTTP 502");
    };
    const result = writeVerifyLine(5, line, HEAD, seam);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("HTTP 502");
  });
});
