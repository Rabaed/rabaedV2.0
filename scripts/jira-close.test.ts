import { describe, expect, it } from "vitest";
import { closeIssues, type Jira } from "./jira-close.ts";

// A fake Jira: tickets by key with a status category; closing moves them to done.
function fakeJira(tickets: Record<string, "new" | "indeterminate" | "done">, failing: string[] = [], labelled: Record<string, string[]> = {}) {
  const comments: [string, string][] = [];
  const jira: Jira = {
    async labels(key) {
      return labelled[key] ?? [];
    },
    async statusCategory(key) {
      const category = tickets[key];
      if (!category) throw new Error(`${key} not found`);
      return category;
    },
    async closeWithComment(key, comment) {
      if (failing.includes(key)) throw new Error(`no Done transition for ${key}`);
      tickets[key] = "done";
      comments.push([key, comment]);
    },
  };
  return { jira, comments, tickets };
}

describe("closeIssues", () => {
  it("closes an open ticket with a comment naming the PR", async () => {
    const { jira, comments, tickets } = fakeJira({ "RP-1": "new" });
    const result = await closeIssues(["RP-1"], 110, jira);
    expect(tickets["RP-1"]).toBe("done");
    expect(comments).toEqual([["RP-1", "Closed by PR #110 (merged)"]]);
    expect(result).toEqual({ closed: ["RP-1"], alreadyDone: [], skippedSpecs: [], failed: [] });
  });

  it("leaves a spec issue open and names it, while a Closes ticket on the same PR still closes", async () => {
    const { jira, comments, tickets } = fakeJira({ "RP-448": "indeterminate", "RP-434": "new" }, [], { "RP-448": ["spec"] });
    const result = await closeIssues(["RP-448", "RP-434"], 159, jira);
    expect(tickets["RP-448"]).toBe("indeterminate");
    expect(tickets["RP-434"]).toBe("done");
    expect(comments).toEqual([["RP-434", "Closed by PR #159 (merged)"]]);
    expect(result).toEqual({ closed: ["RP-434"], alreadyDone: [], skippedSpecs: ["RP-448"], failed: [] });
  });

  it("does not skip a ticket with other labels", async () => {
    const { jira } = fakeJira({ "RP-5": "new" }, [], { "RP-5": ["retro", "lane:a"] });
    const result = await closeIssues(["RP-5"], 8, jira);
    expect(result.closed).toEqual(["RP-5"]);
    expect(result.skippedSpecs).toEqual([]);
  });

  it("skips a ticket that is already Done, without a comment", async () => {
    const { jira, comments } = fakeJira({ "RP-2": "done" });
    const result = await closeIssues(["RP-2"], 5, jira);
    expect(comments).toEqual([]);
    expect(result).toEqual({ closed: [], alreadyDone: ["RP-2"], skippedSpecs: [], failed: [] });
  });

  it("reports a failed transition and still closes the others", async () => {
    const { jira, tickets } = fakeJira({ "RP-3": "indeterminate", "RP-4": "new" }, ["RP-3"]);
    const result = await closeIssues(["RP-3", "RP-4"], 7, jira);
    expect(tickets["RP-4"]).toBe("done");
    expect(result.closed).toEqual(["RP-4"]);
    expect(result.failed).toEqual([{ key: "RP-3", reason: "no Done transition for RP-3" }]);
  });

  it("reports a missing ticket as failed", async () => {
    const { jira } = fakeJira({});
    const result = await closeIssues(["RP-99"], 7, jira);
    expect(result.failed).toEqual([{ key: "RP-99", reason: "RP-99 not found" }]);
  });
});
