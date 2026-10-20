import { describe, expect, it } from "vitest";
import { noRefusals, verdictLine } from "./check-migrations-verdict.ts";

// RP-990: `pnpm check:migrations` ends with one verdict line, so any tail shows the outcome.
describe("verdictLine", () => {
  it("says passed when nothing was refused", () => {
    expect(verdictLine(noRefusals, 0)).toBe("check:migrations: passed");
  });

  it("says FAILED and counts each kind of refusal found, in a fixed order", () => {
    expect(verdictLine({ ...noRefusals, sharedTimestamps: 1, sortBeforeMain: 2 }, 0)).toBe("check:migrations: FAILED (1 shared timestamp, 2 sort before main)");
  });

  it("names every kind, singular or plural by its count", () => {
    const every = { redefinedOnMain: 1, redefinedUnseen: 2, staleOverloads: 1, sharedTimestamps: 2, hiddenSortKeys: 1, existingChanged: 2, sortBeforeMain: 1, otherIssueDays: 2 };
    expect(verdictLine(every, 0)).toBe(
      "check:migrations: FAILED (1 redefined on main too, 2 redefined unseen on this branch, 1 stale overload, 2 shared timestamps, 1 hidden sort key, 2 already on main and changed, 1 sorts before main, 2 on another issue's day)",
    );
  });

  it("names a check that could not run before the counts", () => {
    expect(verdictLine(noRefusals, 0, ["git fetch origin main failed"])).toBe("check:migrations: FAILED (git fetch origin main failed)");
    expect(verdictLine({ ...noRefusals, sharedTimestamps: 1 }, 0, ["the days step stopped with an error"])).toBe("check:migrations: FAILED (the days step stopped with an error, 1 shared timestamp)");
  });

  it("adds the unreserved-day warning without failing", () => {
    expect(verdictLine(noRefusals, 2)).toBe("check:migrations: passed (warning: 2 on a day nobody reserved)");
    expect(verdictLine({ ...noRefusals, otherIssueDays: 1 }, 1)).toBe("check:migrations: FAILED (1 on another issue's day; warning: 1 on a day nobody reserved)");
  });
});
