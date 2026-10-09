import { describe, expect, it } from "vitest";
import { marRows } from "../test/support/mar-workflow.ts";
import { addStageRequest, reorderStagesRequest, stageCopyProblems } from "./stage.ts";
import { definitionFromRows } from "./workflow-definition.ts";

// Pure domain: a Project's Stages (RP-428, WF-5). Copying a Workflow into a
// Project maps its Stages by key, and is refused, naming the Stage and the Step,
// in English and Arabic, when the Project's Module lacks one.

const mar = definitionFromRows(marRows(2));
const projectStages = (...keys: string[]) => keys.map((key) => ({ key, name: { en: key, ar: key } }));

describe("copying a Workflow into a Project", () => {
  it("maps every Stage by key when the Project's Module has them all", () => {
    expect(stageCopyProblems(mar, projectStages("draft", "internal_review", "pending_approval", "approved", "revise_resubmit", "extra"))).toEqual([]);
  });

  it("is refused for each Stage the Project's Module lacks, naming it and a Step in it", () => {
    const problems = stageCopyProblems(mar, projectStages("draft", "internal_review", "approved", "revise_resubmit"));
    expect(problems.map((p) => [p.code, p.stage])).toEqual([["stage_missing", "pending_approval"]]);
    expect(problems[0]!.step).toBe("consultant_review");
    expect(problems[0]!.message.en).toBe('This Project has no Stage "pending_approval" (used by Consultant review). Add it in the Project\'s Stages first.');
    expect(problems[0]!.message.ar).toContain("pending_approval");
  });
});

describe("the Stage commands' requests", () => {
  it("take a snake_case key, an English and Arabic name and a category", () => {
    expect(addStageRequest.safeParse({ key: "on_hold", name: { en: "On Hold", ar: "معلّق" }, category: "in_progress" }).success).toBe(true);
    expect(addStageRequest.safeParse({ key: "On Hold", name: { en: "On Hold", ar: "معلّق" }, category: "in_progress" }).success).toBe(false);
    expect(addStageRequest.safeParse({ key: "on_hold", name: { en: "On Hold", ar: "" }, category: "in_progress" }).success).toBe(false);
    expect(addStageRequest.safeParse({ key: "on_hold", name: { en: "On Hold", ar: "معلّق" }, category: "open" }).success).toBe(false);
  });

  it("reorder with the keys each once", () => {
    expect(reorderStagesRequest.safeParse({ keys: ["draft", "approved"] }).success).toBe(true);
    expect(reorderStagesRequest.safeParse({ keys: ["draft", "draft"] }).success).toBe(false);
  });
});
