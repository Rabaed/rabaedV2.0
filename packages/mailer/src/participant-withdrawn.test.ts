import { describe, expect, it } from "vitest";
import { participantWithdrawnMessage } from "./participant-withdrawn.ts";

describe("a Participant withdrawn email (RP-952)", () => {
  it("goes to the Member in their language, linking to their Company's Projects on the web", () => {
    const names = {
      projectName: { en: "Riyadh Gate Tower", ar: "برج بوابة الرياض" },
      hostCompanyName: { en: "Test Constructions", ar: "إنشاءات الاختبار" },
    };
    const message = participantWithdrawnMessage({ to: "sara@rabaed.test", language: "ar", ...names }, "https://uat.rabaed.test");
    expect(message).toEqual({
      to: "sara@rabaed.test",
      template: "participant-withdrawn",
      locale: "ar",
      values: { ...names, link: "https://uat.rabaed.test/ar/participants" },
    });
  });
});
