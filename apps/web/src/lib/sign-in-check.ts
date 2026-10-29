import type { Locale } from "@rabaed/domain";

/**
 * The field the sign-in form flags before sending (owner's design): a malformed email first, then an
 * empty password. It never judges the password itself, so it says nothing about whether an account exists.
 */
export function signInFieldError({ email, password }: { email: string; password: string }): "email" | "password" | null {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "email";
  if (password === "") return "password";
  return null;
}

const MARKETING_SITE = "https://rabaedapp.com";

/** The sign-in footer's links to the marketing site (owner, 2026-10-30): Arabic at its root, English under /en. It has no Help page yet. */
export function legalLinks(locale: Locale): { key: "privacy" | "terms"; href: string }[] {
  const base = locale === "ar" ? MARKETING_SITE : `${MARKETING_SITE}/${locale}`;
  return (["privacy", "terms"] as const).map((key) => ({ key, href: `${base}/${key}` }));
}
