import { describe, expect, it } from "vitest";
import { submittalOwnerWorkflow as definition } from "../../storybook/submittal-route.ts";
import { workflowStages as stages } from "../../storybook/workflow.ts";
import { newItemRequired, newItemRouteRows, newItemTypeIcon } from "./new-item-model.ts";
import { submittalRoute } from "./route-model.ts";

// The route a Draft will take, as the create panel previews it (RP-1152 rows 34, 35): the caller
// computes the route with the Draft Step as the viewer's own position.
const draftRoute = submittalRoute({ definition, stages, position: { kind: "own", stepKey: "draft" } });

describe("the new item's route preview (RP-1152 rows 34, 35; V15)", () => {
  it("lists the viewer's own Steps by name, the Draft Step now, and every other role's stop as one private row", () => {
    expect(newItemRouteRows(draftRoute).map((row) => (row.kind === "step" ? `${row.kind}:${row.name.en}:${row.current}` : `${row.kind}:${row.role}`))).toEqual([
      "step:Draft:true",
      "step:Contractor PM:false",
      "step:Contractor Engineer:false",
      "private:consultant",
      "private:owner",
      "outcome:contractor",
    ]);
  });

  it("gives each own Step its role, so a later one reads by role and never by a person", () => {
    const own = newItemRouteRows(draftRoute).filter((row) => row.kind === "step");
    expect(own.map((row) => row.role)).toEqual(["contractor", "contractor", "contractor"]);
    expect(JSON.stringify(newItemRouteRows(draftRoute))).not.toMatch(/companyName|memberName|"name":\{"en":"(Design|Hafiz|Ali)/);
  });

  it("has no rows for an empty route", () => {
    expect(newItemRouteRows({ stops: [], steps: [] })).toEqual([]);
  });

  it("previews by role when nothing marks the viewer's Step: the first stop is the raiser's own", () => {
    const unmarked = submittalRoute({ definition, stages, position: null });
    expect(newItemRouteRows(unmarked).map((row) => row.kind)).toEqual(["step", "step", "step", "private", "private", "outcome"]);
    expect(newItemRouteRows(unmarked).some((row) => row.kind === "step" && row.current)).toBe(false);
  });
});

describe("the required checklist's count (RP-1152 rows 25, 33)", () => {
  it("counts the filled required fields of all of them", () => {
    expect(
      newItemRequired([
        { key: "subject", label: "Subject", done: true },
        { key: "trade", label: "Trade", done: false },
        { key: "location", label: "Location", done: true },
      ]),
    ).toEqual({ done: 2, total: 3 });
    expect(newItemRequired([])).toEqual({ done: 0, total: 0 });
  });
});

describe("the Type cards' icons (RP-1227)", () => {
  it("gives each Type its own icon, from its code", () => {
    expect(["MAR", "SAR", "DAR", "WIR"].map(newItemTypeIcon)).toEqual(["building-factory", "truck", "file-text", "clipboard-check"]);
  });

  it("falls back to a file for a Type it does not know", () => {
    expect(newItemTypeIcon("SNG")).toBe("file-text");
    expect(newItemTypeIcon("toString")).toBe("file-text");
  });
});
