import { appearanceFromCookie, type Appearance, type Locale } from "@rabaed/domain";

// The sign-in pages (sign-in, forgot and reset password) as the owner's design (RP-1107).

/**
 * The sign-in pages' Appearance: always the Grey theme, as the owner's design (owner, 2026-10-30), in the
 * light or dark Mode the browser's appearance cookie mirrors from the last Member, else the device's.
 */
export function signInAppearance(cookie: string | undefined): Appearance {
  return { theme: "grey", mode: appearanceFromCookie(cookie).mode };
}

/** A sign-in field the form can flag before sending. */
export type SignInField = "email" | "password";

/**
 * The field the sign-in form flags before sending (owner's design): a malformed email first, then an
 * empty password. It never judges the password itself, so it says nothing about whether an account exists.
 */
export function signInFieldError({ email, password }: { email: string; password: string }): SignInField | null {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "email";
  if (password === "") return "password";
  return null;
}

const MARKETING_SITE = "https://rabaedapp.com";
const LEGAL_PAGES = ["privacy", "terms"] as const;

/** The sign-in footer's links to the marketing site (owner, 2026-10-30): Arabic at its root, English under /en. It has no Help page yet. */
export function legalLinks(locale: Locale): { key: (typeof LEGAL_PAGES)[number]; href: string }[] {
  const base = locale === "ar" ? MARKETING_SITE : `${MARKETING_SITE}/${locale}`;
  return LEGAL_PAGES.map((key) => ({ key, href: `${base}/${key}` }));
}
