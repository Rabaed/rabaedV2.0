import { describe, expect, it } from "vitest";
import { chipChosen, typeChipsOf } from "./snag-type-chips.ts";

// Story data only.
const t = (code: string) => ({ code, name: Object.fromEntries([["en", code], ["ar", code]]) as { en: string; ar: string } });

describe("typeChipsOf", () => {
  it("shows one Questions chip for QSN, QSC and QSO, where the first of them is, and its own chip for every other Type", () => {
    const chips = typeChipsOf([t("SNG"), t("QSN"), t("OBS"), t("QSC"), t("QSO"), t("WLK")], undefined);
    expect(chips.map((c) => c.key)).toEqual(["SNG", "questions", "OBS", "WLK"]);
    expect(chips[1]).toMatchObject({ kind: "questions", codes: ["QSN", "QSC", "QSO"] });
    expect(chips[0]).toMatchObject({ kind: "type", codes: ["SNG"], type: t("SNG") });
  });

  it("counts the Questions chip as the sum of the API's counts of its Types, which are only what the viewer sees", () => {
    const chips = typeChipsOf([t("SNG"), t("QSN"), t("QSC"), t("QSO")], [
      { code: "SNG", count: 4 },
      { code: "QSN", count: 2 },
      { code: "QSO", count: 1 },
    ]);
    // QSC has no count from the API: the viewer sees none of it.
    expect(chips.map((c) => c.count)).toEqual([4, 3]);
  });

  it("carries no number when the API gives no counts (under a search)", () => {
    expect(typeChipsOf([t("SNG"), t("QSN")], undefined).map((c) => c.count)).toEqual([undefined, undefined]);
  });

  it("filters to only the Question Types the Module has", () => {
    const chips = typeChipsOf([t("QSC"), t("CMT")], []);
    expect(chips[0]).toMatchObject({ kind: "questions", codes: ["QSC"], count: 0 });
  });

  it("has no Questions chip in a Module without Question Types", () => {
    expect(typeChipsOf([t("SNG"), t("CMT")], []).map((c) => c.kind)).toEqual(["type", "type"]);
  });
});

describe("chipChosen", () => {
  const [snag, questions] = typeChipsOf([t("SNG"), t("QSN"), t("QSC"), t("QSO")], []);

  it("is chosen when the query's Types are the chip's, in any order", () => {
    expect(chipChosen(questions!, ["QSO", "QSN", "QSC"])).toBe(true);
    expect(chipChosen(snag!, ["SNG"])).toBe(true);
  });

  it("is not chosen for part of the Questions, or more than them", () => {
    expect(chipChosen(questions!, ["QSN"])).toBe(false);
    expect(chipChosen(questions!, ["QSN", "QSC", "QSO", "SNG"])).toBe(false);
    expect(chipChosen(snag!, [])).toBe(false);
  });
});
