import { describe, expect, it } from "vitest";
import { packageStateTotals, packageSummary, packageTypeCounts, type PackageTypeCounts } from "./package.ts";

const b = (en: string, ar: string) => ({ en, ar });
const mar: PackageTypeCounts = { typeId: "0192e0a0-0000-7000-8000-000000000301", code: "MAR", name: b("Material Approval Request", "طلب اعتماد مواد"), total: 5, done: 2, revise: 1, replace: 1, open: 1 };
const sar: PackageTypeCounts = { typeId: "0192e0a0-0000-7000-8000-000000000302", code: "SAR", name: b("Supplier Approval Request", "طلب اعتماد مورد"), total: 3, done: 0, revise: 0, replace: 0, open: 3 };

describe("a Package's counts by Type (RP-1143, the kit's Type ledger)", () => {
  it("adds every Type's states into the Package's own", () => {
    expect(packageStateTotals([mar, sar])).toEqual({ total: 8, done: 2, revise: 1, replace: 1, open: 4, closed: 3 });
  });

  it("counts nothing when the viewer sees no submittal in it", () => {
    expect(packageStateTotals([])).toEqual({ total: 0, done: 0, revise: 0, replace: 0, open: 0, closed: 0 });
  });

  it("closed is every item that counts towards Done: Code A, B and D, never a Code C waiting for its Revision", () => {
    expect(packageStateTotals([mar]).closed).toBe(mar.done + mar.replace);
  });

  it("refuses a Type whose states don't add up to its total", () => {
    expect(packageTypeCounts.safeParse({ ...mar, total: 6 }).success).toBe(false);
  });

  it("a summary carries its Types and the viewer's waiting count", () => {
    const parsed = packageSummary.parse({
      id: "0192e0a0-0000-7000-8000-000000000001",
      projectId: "0192e0a0-0000-7000-8000-000000000100",
      number: "PKG-001",
      name: b("Lighting", "الإنارة"),
      status: "in_progress",
      owner: { participantId: "0192e0a0-0000-7000-8000-0000000000c1", companyName: b("Al Bina", "البناء") },
      trades: [],
      counts: { total: 8, open: 4, codes: { A: 2, C: 1, D: 1 } },
      byType: [mar, sar],
      waiting: 2,
    });
    expect(parsed.byType.map((t) => t.code)).toEqual(["MAR", "SAR"]);
    expect(parsed.waiting).toBe(2);
  });
});
