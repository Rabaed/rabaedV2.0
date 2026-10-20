import { describe, expect, it } from "vitest";
import { keysToClose } from "./jira-close-keys.ts";

describe("keysToClose", () => {
  it("takes the key from the head branch name", () => {
    expect(keysToClose({ branch: "RP-296-auto-screenshot-baselines", body: "" })).toEqual(["RP-296"]);
  });

  it("closes every key on a Closes line, comma or 'and' separated", () => {
    expect(keysToClose({ branch: "main-fix", body: "Closes RP-10, RP-11 and RP-12" })).toEqual(["RP-10", "RP-11", "RP-12"]);
  });

  it("reads Fixes and Resolves, in any case, with an optional colon", () => {
    expect(keysToClose({ branch: "x", body: "fixes: RP-1\nResolved RP-2\nCLOSED RP-3" })).toEqual(["RP-1", "RP-2", "RP-3"]);
  });

  it("leaves a key merely mentioned in passing alone", () => {
    expect(keysToClose({ branch: "RP-5-thing", body: "Closes RP-5\nSee RP-6 for context. Related: RP-7" })).toEqual(["RP-5"]);
  });

  it("stops the list at the first word that is not a key", () => {
    expect(keysToClose({ branch: "x", body: "Closes RP-1, see RP-2" })).toEqual(["RP-1"]);
  });

  it("keeps a key from the branch and the body once, branch first", () => {
    expect(keysToClose({ branch: "RP-289-form-part-2b", body: "Closes RP-290\nCloses RP-289" })).toEqual(["RP-289", "RP-290"]);
  });

  it("ignores other projects' keys and look-alikes", () => {
    expect(keysToClose({ branch: "ABC-12-thing", body: "Closes ABC-5, XRP-9\nFixes ARP-3" })).toEqual([]);
  });

  it("does not take a key after a Closes word in the middle of another word", () => {
    expect(keysToClose({ branch: "x", body: "Encloses RP-4" })).toEqual([]);
  });

  it("takes a lower-case key from an app-made branch, upper-cased (RP-986)", () => {
    expect(keysToClose({ branch: "claude/rp-627-site-observation-5b2be5", body: "" })).toEqual(["RP-627"]);
  });

  it("keeps the boundaries on a lower-case branch key", () => {
    expect(keysToClose({ branch: "claude/rp-12-x", body: "" })).toEqual(["RP-12"]);
    expect(keysToClose({ branch: "crp-5", body: "" })).toEqual([]);
  });

  it("closes a lower-case key on a Closes line, upper-cased", () => {
    expect(keysToClose({ branch: "x", body: "Closes rp-9" })).toEqual(["RP-9"]);
  });

  it("keeps a key once when the branch and the body differ in case", () => {
    expect(keysToClose({ branch: "claude/rp-14-x", body: "Closes RP-14, rp-15" })).toEqual(["RP-14", "RP-15"]);
  });

  it("copes with a missing body", () => {
    expect(keysToClose({ branch: "RP-8-x", body: null })).toEqual(["RP-8"]);
  });
});
