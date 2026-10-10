import { z } from "zod";

/**
 * A Member's Appearance (owner decision 2026-10-11): the Theme, Grey (#f6f7f9, dark navy) or
 * Warm (#fdf9f5, dark espresso), and the Mode, Light, Dark or System (the device's own). Each
 * Member chooses it in their menu; it is kept for them by the API and follows them across
 * devices. Nobody else reads it.
 */
export const appearanceThemes = ["grey", "warm"] as const;
export type AppearanceTheme = (typeof appearanceThemes)[number];
export const appearanceModes = ["light", "dark", "system"] as const;
export type AppearanceMode = (typeof appearanceModes)[number];

export const appearance = z.object({ theme: z.enum(appearanceThemes), mode: z.enum(appearanceModes) });
export type Appearance = z.infer<typeof appearance>;

/** A new Member's: Warm, following the device's light or dark setting. */
export const defaultAppearance: Appearance = { theme: "warm", mode: "system" };

/**
 * The cookie that mirrors the signed-in Member's Appearance in their browser, so a page that
 * reads no Member (signing in) is painted in it too, without a flash: "warm.system".
 */
export const appearanceCookie = "rabaed-appearance";

export const appearanceCookieValue = (a: Appearance) => `${a.theme}.${a.mode}`;

/** The Appearance a cookie holds, or the default for anything else. */
export function appearanceFromCookie(value: string | undefined): Appearance {
  const [theme, mode] = (value ?? "").split(".");
  const parsed = appearance.safeParse({ theme, mode });
  return parsed.success ? parsed.data : defaultAppearance;
}
