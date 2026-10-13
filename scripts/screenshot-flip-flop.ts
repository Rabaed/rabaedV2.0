import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Warns when update-screenshots is about to change a baseline its own earlier
// commit on the PR already changed (RP-561). Run by the commit job of
// .github/workflows/update-screenshots.yml, from main's copy of this file: that
// job holds a write token and never runs the PR's code.
//
// A story that renders a little differently each time makes the bot and CI
// disagree: on PR #180 the Arabic PublishBlocked baseline was committed three
// times and the merge queue dropped the PR twice. The commit is still made; the
// comment is what makes the pattern visible.
//
// Usage: node screenshot-flip-flop.ts <comment-file>
//   in the checkout of the PR branch, with the new baselines staged and
//   origin/main fetched. Writes the comment to <comment-file> only when there
//   is a flip-flop; the workflow posts it.

export const COMMENT_TAG = "<!-- screenshot-flip-flop -->";
export const BOT = "github-actions[bot]";

export interface CommitFiles {
  author: string;
  files: string[];
}

/** The files about to be committed that a commit by the bot on this PR already changed, in the given order. */
export function findFlipFlops(commits: CommitFiles[], changing: string[]): string[] {
  const set = new Set(commits.filter((commit) => commit.author === BOT).flatMap((commit) => commit.files));
  return [...new Set(changing)].filter((file) => set.has(file));
}

/** Parses `git log --format=@@%H%x09%an --name-only`. */
export function parseLog(log: string): CommitFiles[] {
  const commits: CommitFiles[] = [];
  for (const line of log.split("\n")) {
    if (line.startsWith("@@")) {
      commits.push({ author: line.split("\t")[1]?.trim() ?? "", files: [] });
    } else if (line.trim() !== "") {
      commits.at(-1)?.files.push(line.trim());
    }
  }
  return commits;
}

/** A file name from the PR's artifact is untrusted: one short line that cannot close the code span. */
const name = (file: string) => file.replace(/[`\r\n]/g, "'").slice(0, 300);

export function buildComment(files: string[]): string {
  return [
    COMMENT_TAG,
    `These baselines changed again after the bot set them on this PR — the story may render unstably: ${files.map((file) => `\`${name(file)}\``).join(", ")}. See RP-556 / docs/agents/ci-logs.md.`,
  ].join("\n");
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function main() {
  const out = process.argv[2];
  if (!out) throw new Error("Usage: node screenshot-flip-flop.ts <comment-file>");
  const commits = parseLog(git("log", "--format=@@%H%x09%an", "--name-only", "origin/main..HEAD"));
  const changing = git("diff", "--cached", "--name-only").split("\n").filter((line) => line.trim() !== "");
  const files = findFlipFlops(commits, changing);
  if (files.length === 0) {
    console.log("No baseline is changing again after the bot set it on this PR.");
    return;
  }
  writeFileSync(out, buildComment(files));
  console.log(`Flip-flop: ${files.join(", ")}`);
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  try {
    main();
  } catch (error) {
    // Only a warning: a failure here must not stop the baselines being committed.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
