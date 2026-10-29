import { describe, expect, it } from "vitest";
import { participantInvitationMessage } from "./participant-invitation.ts";

describe("a Participant Invitation email", () => {
  it("goes to the Authorized Person in their language, linking to their invitations on the web", () => {
    const names = {
      projectName: { en: "Riyadh Gate Tower", ar: "برج بوابة الرياض" },
      hostCompanyName: { en: "Test Constructions", ar: "إنشاءات الاختبار" },
      roleName: { en: "Consultant", ar: "الاستشاري" },
    };
    const message = participantInvitationMessage({ to: "sara@rabaed.test", language: "ar", ...names }, "https://uat.rabaed.test");
    expect(message).toEqual({
      to: "sara@rabaed.test",
      template: "participant-invitation",
      locale: "ar",
      values: { ...names, link: "https://uat.rabaed.test/ar/participants" },
    });
  });
});
