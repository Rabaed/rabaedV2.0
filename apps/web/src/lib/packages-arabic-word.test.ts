import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json" with { type: "json" };

/** Every string under `o`, flattened. */
function strings(o: unknown): string[] {
  if (typeof o === "string") return [o];
  return o && typeof o === "object" ? Object.values(o).flatMap(strings) : [];
}

describe("the Package page's Arabic word for Submittals (RP-1164, UX-23)", () => {
  it("is the Project tab's word, never a second one", () => {
    expect(ar.packages.back).toBe(ar.projectTabs.submittals);
    expect(ar.packages.submittals).toBe(ar.projectTabs.submittals);
    expect(strings(ar.packages).filter((s) => s.includes("الاعتماد"))).toEqual([]);
  });
});
