import { describe, expect, it } from "vitest";
import { legalLinks, signInAppearance, signInFieldError } from "./sign-in-page.ts";

describe("the sign-in pages' theme (owner, 2026-10-30)", () => {
  it("is always Grey, as the design, keeping the last Member's light or dark mode", () => {
    expect(signInAppearance("warm.dark")).toEqual({ theme: "grey", mode: "dark" });
    expect(signInAppearance("warm.light")).toEqual({ theme: "grey", mode: "light" });
    expect(signInAppearance("grey.system")).toEqual({ theme: "grey", mode: "system" });
  });

  it("follows the device with no cookie", () => {
    expect(signInAppearance(undefined)).toEqual({ theme: "grey", mode: "system" });
  });
});

describe("the sign-in form's check before sending (owner's design)", () => {
  it("asks for a valid email first", () => {
    expect(signInFieldError({ email: "", password: "" })).toBe("email");
    expect(signInFieldError({ email: "hafiz", password: "secret" })).toBe("email");
    expect(signInFieldError({ email: "hafiz@tmc", password: "secret" })).toBe("email");
    expect(signInFieldError({ email: "hafiz @tmc.ae", password: "secret" })).toBe("email");
    expect(signInFieldError({ email: "hafiz@tmc.", password: "secret" })).toBe("email");
  });

  it("then asks for a password", () => {
    expect(signInFieldError({ email: "hafiz@tmc.ae", password: "" })).toBe("password");
  });

  it("sends anything else, whatever its length: only the api says whether it matches", () => {
    expect(signInFieldError({ email: "hafiz@tmc.ae", password: "x" })).toBeNull();
    expect(signInFieldError({ email: " hafiz@tmc.ae ", password: "secret" })).toBeNull();
  });
});

describe("the sign-in footer's links (owner, 2026-10-30)", () => {
  it("go to the marketing site's Privacy and Terms pages, Arabic at the root", () => {
    expect(legalLinks("ar")).toEqual([
      { key: "privacy", href: "https://rabaedapp.com/privacy" },
      { key: "terms", href: "https://rabaedapp.com/terms" },
    ]);
  });

  it("and English under /en", () => {
    expect(legalLinks("en")).toEqual([
      { key: "privacy", href: "https://rabaedapp.com/en/privacy" },
      { key: "terms", href: "https://rabaedapp.com/en/terms" },
    ]);
  });
});
