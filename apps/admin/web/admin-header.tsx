"use client";

import { directionOf, type Locale } from "@rabaed/domain";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import { strings } from "./strings.ts";

// Rabaed Admin's React pages (Workflows, RP-443; Imports, RP-645; Records, RP-670): one header and one session.
// The sign-in and the other screens are the page at `/`; the language is the one it keeps.

const localeKey = "rabaed-admin-locale";
const storedLocale = (): Locale => {
  try {
    return localStorage.getItem(localeKey) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
};

export type SignedIn = "loading" | "out" | { email: string };

/** The page's language (kept between Rabaed Admin's pages), and whether a Rabaed Engineer is signed in. */
export function useAdminSession(title: (locale: Locale) => string) {
  const [locale, setLocale] = useState<Locale>(storedLocale);
  const [signedIn, setSignedIn] = useState<SignedIn>("loading");

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionOf(locale);
    document.title = `${title(locale)} · ${strings(locale).appName}`;
  }, [locale, title]);
  useEffect(() => {
    api<{ engineer: { email: string } }>("GET", "/v1/me").then(
      ({ engineer }) => setSignedIn({ email: engineer.email }),
      () => setSignedIn("out"),
    );
  }, []);

  const toggleLanguage = useCallback(() => {
    const next: Locale = locale === "en" ? "ar" : "en";
    setLocale(next);
    try {
      localStorage.setItem(localeKey, next);
    } catch {
      // The choice lasts for this visit only.
    }
  }, [locale]);
  return { locale, signedIn, toggleLanguage };
}

/** Rabaed Admin's bar: its name, its pages (the current one marked), who is signed in, the language and Sign out. */
export function AdminHeader({
  locale,
  signedIn,
  current,
  onToggleLanguage,
}: {
  locale: Locale;
  signedIn: SignedIn;
  current: "workflows" | "imports" | "records";
  onToggleLanguage: () => void;
}) {
  const s = strings(locale);
  const signOut = async () => {
    await api("DELETE", "/v1/session").catch(() => undefined);
    window.location.assign("/");
  };
  const page = (href: string, key: "workflows" | "imports" | "records") =>
    key === current ? (
      <a href={href} aria-current="page" className="font-semibold text-text">
        {s[key]}
      </a>
    ) : (
      <a href={href} className="text-brand underline">
        {s[key]}
      </a>
    );
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface px-6 py-3">
      <strong>{s.appName}</strong>
      <nav aria-label={s.appName} className="flex gap-4 text-sm">
        <a href="/" className="text-brand underline">
          {s.home}
        </a>
        {page("/workflows", "workflows")}
        {page("/register-imports", "imports")}
        {page("/records", "records")}
      </nav>
      <span className="flex-1" />
      {typeof signedIn === "object" && (
        <span dir="ltr" className="text-muted [overflow-wrap:anywhere]">
          {signedIn.email}
        </span>
      )}
      <button type="button" onClick={onToggleLanguage} className="text-brand underline">
        {s.otherLanguage}
      </button>
      {typeof signedIn === "object" && (
        <button type="button" onClick={() => void signOut()} className="text-brand underline">
          {s.signOut}
        </button>
      )}
    </header>
  );
}

/** What a page shows while the session loads, or once signed out. */
export function SignedOutOrLoading({ locale, signedIn }: { locale: Locale; signedIn: SignedIn }) {
  const s = strings(locale);
  if (signedIn === "loading") return <p className="text-muted">{s.loading}</p>;
  if (signedIn === "out") {
    return (
      <p>
        {s.signedOut}{" "}
        <a href="/" className="text-brand underline">
          {s.signInLink}
        </a>
      </p>
    );
  }
  return null;
}
