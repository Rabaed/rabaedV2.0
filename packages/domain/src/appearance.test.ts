import { describe, expect, it } from "vitest";
import { appearanceCookieValue, appearanceFromCookie, defaultAppearance } from "./appearance.ts";

describe("a Member's Appearance", () => {
  it("is Warm, following the device, for a new Member", () => {
    expect(defaultAppearance).toEqual({ theme: "warm", mode: "system" });
  });

  it("round-trips through its cookie", () => {
    for (const theme of ["grey", "warm"] as const) {
      for (const mode of ["light", "dark", "system"] as const) {
        expect(appearanceFromCookie(appearanceCookieValue({ theme, mode }))).toEqual({ theme, mode });
      }
    }
  });

  it("falls back to the default for a missing or made-up cookie", () => {
    expect(appearanceFromCookie(undefined)).toEqual(defaultAppearance);
    expect(appearanceFromCookie("")).toEqual(defaultAppearance);
    expect(appearanceFromCookie("pink.dark")).toEqual(defaultAppearance);
    expect(appearanceFromCookie("grey.dusk")).toEqual(defaultAppearance);
    expect(appearanceFromCookie("grey")).toEqual(defaultAppearance);
  });
});
