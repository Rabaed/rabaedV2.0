import { describe, expect, it } from "vitest";
import type { AgeCandidate } from "../packages/db/dev-tools/index.ts";
import { parseSampleAgeArgs, sampleAgeTargets } from "./sample-project-age.ts";

const now = new Date("2026-11-02T09:00:00Z");
const WEEK = 7 * 24 * 3_600_000;

const candidate = (documentNumber: string | null, over: Partial<AgeCandidate> = {}): AgeCandidate => ({
  id: `id-${documentNumber}`,
  documentNumber,
  subject: `Subject of ${documentNumber}`,
  closed: false,
  stepEnteredAt: new Date(now.getTime() - 3_600_000),
  participantEnteredAt: new Date(now.getTime() - 3_600_000),
  ...over,
});

describe("sampleAgeTargets", () => {
  it("takes the sample Project's open, numbered items only", () => {
    const plan = sampleAgeTargets(
      [
        candidate("NKD-MAR-01-0002"),
        candidate("TWR-MAR-01-0002"),
        candidate(null, { subject: "NKD-MAR draft" }),
        candidate("NKD-MAR-01-0003", { closed: true }),
      ],
      now,
    );
    expect(plan.map((p) => p.documentNumber)).toEqual(["NKD-MAR-01-0002"]);
  });

  it("spreads Step Age over 1 to 4+ weeks by each item's own number, so a run always plans the same", () => {
    const items = Array.from({ length: 40 }, (_, i) => candidate(`NKD-MAR-01-${String(i + 1).padStart(4, "0")}`));
    const plan = sampleAgeTargets(items, now);
    const weeks = new Set(plan.map((p) => p.weeks));
    expect([...weeks].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6]);
    // Some stay at Step Age 1, as new items are.
    expect(plan.length).toBeLessThan(items.length);
    expect(plan.length).toBeGreaterThan(items.length / 2);
    expect(sampleAgeTargets(items, now)).toEqual(plan);
  });

  it("leaves an item that already reads its Step Age or more, so a second run changes nothing", () => {
    const items = Array.from({ length: 40 }, (_, i) => candidate(`NKD-SNG-01-${String(i + 1).padStart(4, "0")}`));
    const first = sampleAgeTargets(items, now);
    const aged = items.map((c) => {
      const p = first.find((x) => x.documentNumber === c.documentNumber);
      return p ? { ...c, stepEnteredAt: new Date(now.getTime() - (p.weeks - 1) * WEEK - 3_600_000) } : c;
    });
    expect(sampleAgeTargets(aged, now)).toEqual([]);
  });
});

describe("parseSampleAgeArgs", () => {
  it("takes a lane, --uat and --dry-run", () => {
    expect(parseSampleAgeArgs(["--lane", "23", "--dry-run"], {})).toEqual({ target: { kind: "lane", lane: 23 }, dryRun: true });
    expect(parseSampleAgeArgs(["--uat"], {})).toEqual({ target: { kind: "uat" }, dryRun: false });
    expect(parseSampleAgeArgs([], { COMPOSE_PROJECT_NAME: "rabaed-lane23" })).toEqual({ target: { kind: "lane", lane: 23 }, dryRun: false });
  });

  it("refuses anything else", () => {
    expect(parseSampleAgeArgs(["--item", "x"], {})).toEqual({ error: "unknown option --item" });
    expect(parseSampleAgeArgs([], {})).toHaveProperty("error");
  });
});
