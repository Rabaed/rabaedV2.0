/* eslint-disable rabaed/no-avoid-terms -- the verify gate's check and gh's flags and fields, by their own names, as in verify-gate.ts */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceVerifyLines, verifiedCommits } from "./verify-gate.ts";

// `pnpm verify --pr <n>` (RP-1171): after a full, clean run it writes the stamped last line into PR n's body
// itself, replacing the stale line a push left, so the line is never pasted late, in a comment, or wrong
// (retro 2026-10-31: `pnpm queue 521` refused a line posted as a comment; #528 and #496 carried a stale one).
// It refuses unless HEAD is the PR's head, before the run starts (a 20-minute run on the wrong commit) and
// again before the write (the PR was pushed to meanwhile). The gate's own rule reads the result
// (scripts/verify-gate.ts `replaceVerifyLines`, the same pattern). The gh calls sit behind PrBodySeam.

export interface PrBodySeam {
  /** The PR's head commit now (`gh pr view <pr> --json headRefOid`). */
  pullHead(pr: number): string;
  /** The PR's body now; "" when it has none. */
  body(pr: number): string;
  /** Replaces the PR's body (`gh pr edit <pr> --body-file`). */
  setBody(pr: number, body: string): void;
}

const short = (sha: string) => sha.slice(0, 9);

/** Why a run on `head` may not write PR `pr`'s body: the PR's head is `prHead`. Undefined when they are the same commit. */
export function prHeadRefusal(pr: number, head: string, prHead: string): string | undefined {
  if (head === prHead) return undefined;
  return `pnpm verify --pr ${pr}: HEAD is ${short(head)}, but PR #${pr}'s head is ${short(prHead)}. A line for any other commit would not pass the verify gate. Check out the PR's branch and \`git push\` it (or pull), then run \`pnpm verify --pr ${pr}\` again.`;
}

export type WriteResult = { ok: true; replaced: boolean } | { ok: false; message: string };

/** Puts `line` (a stamped last line of a full run on `head`) in PR `pr`'s body: in place of the verify line there, else at the end. */
export function writeVerifyLine(pr: number, line: string, head: string, seam: PrBodySeam): WriteResult {
  const stamped = verifiedCommits(line);
  if (stamped.length !== 1) {
    return { ok: false, message: `pnpm verify --pr ${pr}: the last line has no valid stamp (a dirty tree or a resumed run), so it would not count; the PR body is unchanged. Commit your changes and run \`pnpm verify --pr ${pr}\` again.` };
  }
  if (!head.startsWith(stamped[0] ?? "")) {
    return { ok: false, message: `pnpm verify --pr ${pr}: the line names ${stamped[0]}, not HEAD ${short(head)}; the PR body is unchanged.` };
  }
  try {
    const refusal = prHeadRefusal(pr, head, seam.pullHead(pr));
    if (refusal) return { ok: false, message: `${refusal} The PR body is unchanged.` };
    const { body, replaced } = replaceVerifyLines(seam.body(pr), line);
    seam.setBody(pr, replaced ? body : `${body.replace(/\s+$/, "")}${body.trim() === "" ? "" : "\n\n"}${line}\n`);
    return { ok: true, replaced };
  } catch (error) {
    return { ok: false, message: `pnpm verify --pr ${pr}: could not update the PR body: ${error instanceof Error ? error.message.trim() : String(error)}. Paste the line in by hand: \`gh pr edit ${pr} --body-file <file>\`.` };
  }
}

/** The real gh calls. No shell is involved; the body goes through a temp file, so it needs no quoting. */
export function realPrBodySeam(cwd: string = process.cwd(), spawn: typeof spawnSync = spawnSync): PrBodySeam {
  const gh = (args: string[]) => {
    const done = spawn("gh", args, { cwd, encoding: "utf8" });
    if (done.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
    return done.stdout ?? "";
  };
  return {
    pullHead: (pr) => (JSON.parse(gh(["pr", "view", String(pr), "--json", "headRefOid"])) as { headRefOid: string }).headRefOid,
    body: (pr) => (JSON.parse(gh(["pr", "view", String(pr), "--json", "body"])) as { body: string | null }).body ?? "",
    setBody: (pr, body) => {
      const dir = mkdtempSync(join(tmpdir(), "verify-pr-"));
      try {
        const file = join(dir, "body.md");
        writeFileSync(file, body);
        gh(["pr", "edit", String(pr), "--body-file", file]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
