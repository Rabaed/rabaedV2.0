import { describe, expect, it } from "vitest";
import { passwordResetMessage } from "./password-reset.ts";

describe("a password reset email", () => {
  it("goes to the Member in their language, linking to reset-password with the token in the fragment", () => {
    const message = passwordResetMessage({ to: "sara@rabaed.test", language: "ar", token: "abc_-123", validMinutes: 30 }, "https://uat.rabaed.test");
    expect(message).toEqual({
      to: "sara@rabaed.test",
      template: "password-reset",
      locale: "ar",
      // The fragment never reaches a server or a Referer header, so no web log holds the token.
      values: { link: "https://uat.rabaed.test/ar/reset-password#token=abc_-123", validMinutes: 30 },
    });
  });
});
