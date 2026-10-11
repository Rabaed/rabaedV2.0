import { describe, expect, it } from "vitest";
import { numberingText } from "./numbering.ts";

// The stories read the app's own messages; a count message picks its ICU plural
// branch as next-intl does, Arabic's six forms included (RP-412 review).
describe("numberingText", () => {
  it("picks each Arabic plural form of the Custom patterns saved with a save", () => {
    const t = numberingText("ar");
    const saved = (n: number) => t("customsSaved", { count: n, n });
    expect(saved(1)).toBe("يُحفظ معه نمط مخصص واحد.");
    expect(saved(2)).toBe("يُحفظ معه نمطان مخصصان.");
    expect(saved(3)).toBe("يُحفظ معه 3 أنماط مخصصة.");
    expect(saved(11)).toBe("يُحفظ معه 11 نمطًا مخصصًا.");
    expect(saved(100)).toBe("يُحفظ معه 100 نمط مخصص.");
  });

  it("picks one or other in English", () => {
    const t = numberingText("en");
    expect(t("customsSaved", { count: 1, n: 1 })).toBe("1 Custom pattern is saved with it.");
    expect(t("customsSaved", { count: 4, n: 4 })).toBe("4 Custom patterns are saved with it.");
  });
});
