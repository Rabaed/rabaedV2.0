import { describe, expect, it } from "vitest";
import { counterNumber, counterStartRequest } from "./numbering-counter.ts";

describe("counterNumber", () => {
  it("is the prefix, the separator and the sequence padded to the pattern's digits", () => {
    expect(counterNumber({ prefix: "TWR-MAR-01", separator: "-", seqDigits: 4 }, 144)).toBe("TWR-MAR-01-0144");
    expect(counterNumber({ prefix: "TWR/EL/CCM", separator: "/", seqDigits: 5 }, 7)).toBe("TWR/EL/CCM/00007");
  });

  it("never cuts a sequence longer than the digits", () => {
    expect(counterNumber({ prefix: "TWR-MAR-01", separator: "-", seqDigits: 3 }, 12345)).toBe("TWR-MAR-01-12345");
  });
});

describe("counterStartRequest", () => {
  const values = { workItemType: "MAR", participantId: "00000000-0000-4000-8000-000000000001" };

  it("takes a whole starting number from 1 to 9,999,999", () => {
    for (const startingNumber of [1, 144, 9_999_999]) {
      expect(counterStartRequest.safeParse({ ...values, startingNumber }).success, String(startingNumber)).toBe(true);
    }
    for (const startingNumber of [0, -1, 1.5, 10_000_000]) {
      expect(counterStartRequest.safeParse({ ...values, startingNumber }).success, String(startingNumber)).toBe(false);
    }
  });

  it("leaves out the values a pattern doesn't count by", () => {
    expect(counterStartRequest.parse({ workItemType: "MAR", startingNumber: 1 })).toEqual({
      workItemType: "MAR",
      participantId: null,
      tradeId: null,
      locationId: null,
      startingNumber: 1,
    });
  });
});
