import { describe, expect, it } from "vitest";
import { BOT, BOT_EMAIL, buildComment, findFlipFlops, COMMENT_TAG, parseLog } from "./screenshot-flip-flop.ts";

// RP-561: on PR #180 the update-screenshots bot committed one Arabic baseline
// three times (78083, 78008, 78083 bytes) and the merge queue dropped the PR
// twice before anyone saw the pattern. The commit job now warns when it is
// about to change a PNG that its own earlier commit on the PR already changed.

const arabic = "packages/ui/test/__screenshots__/PublishBlocked.ar.png";
const english = "packages/ui/test/__screenshots__/PublishBlocked.en.png";

const bot = (files: string[]) => ({ author: BOT, email: BOT_EMAIL, files });
const person = (files: string[]) => ({ author: "Mohamed", email: "m@example.com", files });

describe("findFlipFlops", () => {
  it("names a baseline the bot already changed on this PR", () => {
    const commits = [person(["packages/ui/src/publish.tsx", arabic]), bot([arabic, english])];
    expect(findFlipFlops(commits, [arabic])).toEqual([arabic]);
  });

  it("ignores a baseline only a person changed", () => {
    expect(findFlipFlops([person([arabic])], [arabic])).toEqual([]);
  });

  it("ignores a commit with the bot's name but not its email", () => {
    expect(findFlipFlops([{ author: BOT, email: "someone@example.com", files: [arabic] }], [arabic])).toEqual([]);
  });

  it("names only a baseline the bot changed, not another file about to change", () => {
    expect(findFlipFlops([bot([arabic, english])], [english])).toEqual([english]);
    expect(findFlipFlops([bot([arabic])], [english])).toEqual([]);
  });

  it("lists each file once, in the order about to be committed, after several bot commits", () => {
    const commits = [bot([english, arabic]), bot([arabic])];
    expect(findFlipFlops(commits, [arabic, english])).toEqual([arabic, english]);
  });

  it("finds nothing on a PR with no commits by the bot", () => {
    expect(findFlipFlops([], [arabic])).toEqual([]);
  });
});

describe("parseLog", () => {
  it("reads author, email and files from git log --format=%x00%H%x00%an%x00%ae --name-only output", () => {
    const log = [
      `\0abc123\0${BOT}\0${BOT_EMAIL}`,
      "",
      arabic,
      english,
      "",
      "\0def456\0Mohamed Alhalees\0m@example.com",
      "",
      "README.md",
      "",
    ].join("\n");
    expect(parseLog(log)).toEqual([
      bot([arabic, english]),
      { author: "Mohamed Alhalees", email: "m@example.com", files: ["README.md"] },
    ]);
  });

  it("keeps a commit that changed no files (a merge)", () => {
    expect(parseLog("\0abc\0Mohamed\0m@example.com\n")).toEqual([{ author: "Mohamed", email: "m@example.com", files: [] }]);
  });

  it("reads a file whose path starts with @@ as a file, not a commit", () => {
    expect(parseLog(`\0abc\0${BOT}\0${BOT_EMAIL}\n\n@@odd.png\n`)).toEqual([bot(["@@odd.png"])]);
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
