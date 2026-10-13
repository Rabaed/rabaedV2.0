import { describe, expect, it } from "vitest";
import { buildComment, findFlipFlops, COMMENT_TAG, parseLog } from "./screenshot-flip-flop.ts";

// RP-561: on PR #180 the update-screenshots bot committed one Arabic baseline
// three times (78083, 78008, 78083 bytes) and the merge queue dropped the PR
// twice before anyone saw the pattern. The commit job now warns when it is
// about to change a PNG that its own earlier commit on the PR already changed.

const BOT = "github-actions[bot]";
const arabic = "packages/ui/test/__screenshots__/PublishBlocked.ar.png";
const english = "packages/ui/test/__screenshots__/PublishBlocked.en.png";

describe("findFlipFlops", () => {
  it("names a baseline the bot already changed on this PR", () => {
    const commits = [
      { author: "Mohamed", files: ["packages/ui/src/publish.tsx", arabic] },
      { author: BOT, files: [arabic, english] },
    ];
    expect(findFlipFlops(commits, [arabic])).toEqual([arabic]);
  });

  it("ignores a baseline only a person changed", () => {
    expect(findFlipFlops([{ author: "Mohamed", files: [arabic] }], [arabic])).toEqual([]);
  });

  it("ignores a baseline the bot changed that is not about to change again", () => {
    expect(findFlipFlops([{ author: BOT, files: [arabic, english] }], [english])).toEqual([english]);
    expect(findFlipFlops([{ author: BOT, files: [arabic] }], [english])).toEqual([]);
  });

  it("lists each file once, in the order about to be committed, after several bot commits", () => {
    const commits = [
      { author: BOT, files: [english, arabic] },
      { author: BOT, files: [arabic] },
    ];
    expect(findFlipFlops(commits, [arabic, english])).toEqual([arabic, english]);
  });

  it("finds nothing on a PR with no commits by the bot", () => {
    expect(findFlipFlops([], [arabic])).toEqual([]);
  });
});

describe("parseLog", () => {
  it("reads author and files from git log --format=@@%H%x09%an --name-only output", () => {
    const log = ["@@abc123\tgithub-actions[bot]", "", `${arabic}`, `${english}`, "", "@@def456\tMohamed Alhalees", "", "README.md", ""].join("\n");
    expect(parseLog(log)).toEqual([
      { author: BOT, files: [arabic, english] },
      { author: "Mohamed Alhalees", files: ["README.md"] },
    ]);
  });

  it("keeps a commit that changed no files (a merge)", () => {
    expect(parseLog("@@abc\tMohamed\n")).toEqual([{ author: "Mohamed", files: [] }]);
  });
});

describe("buildComment", () => {
  it("carries the marker, the warning, the files and the pointers", () => {
    const body = buildComment([arabic, english]);
    expect(body.startsWith(COMMENT_TAG)).toBe(true);
    expect(body).toContain("These baselines changed again after the bot set them on this PR");
    expect(body).toContain(`\`${arabic}\``);
    expect(body).toContain(`\`${english}\``);
    expect(body).toContain("RP-556");
    expect(body).toContain("docs/agents/ci-logs.md");
  });

  it("cannot be broken out of by a file name", () => {
    const body = buildComment(["a`b\nc.png"]);
    expect(body).not.toContain("a`b");
    expect(body).not.toContain("b\nc");
  });
});
