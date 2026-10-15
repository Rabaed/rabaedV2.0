"use client";

import { directionOf, type Locale } from "@rabaed/domain";
import { DirectionProvider } from "@rabaed/ui";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import { strings } from "./strings.ts";
import { WorkflowEditor } from "./workflow-editor.tsx";
import { WorkflowList } from "./workflow-list.tsx";

// Rabaed Admin -> Workflows (RP-443): one page, the list of the Rabaed Default Workflows and,
// at `#/<Type code>` (or `#/<Type code>/<Workflow id>`), the builder with that Type's outcome and Stage sets. The sign-in and the
// other screens are the page at `/`; the language is the one it keeps.

const localeKey = "rabaed-admin-locale";
const storedLocale = (): Locale => {
  try {
    return localStorage.getItem(localeKey) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
};

/** `#/<Type code>` the Workflow the Type runs, `#/<Type code>/<Workflow id>` one of its other Rabaed Defaults (RP-596). */
const targetOfHash = (): string | null => {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash === "" ? null : hash;
};
const parseTarget = (target: string): { typeCode: string; workflowId: string | null } => {
  const [code = "", workflowId] = target.split("/");
  return { typeCode: decodeURIComponent(code), workflowId: workflowId ? decodeURIComponent(workflowId) : null };
};

export function App() {
  const [locale, setLocale] = useState<Locale>(storedLocale);
  const [signedIn, setSignedIn] = useState<"loading" | "out" | { email: string }>("loading");
  const [target, setTarget] = useState<string | null>(targetOfHash);
  const s = strings(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionOf(locale);
    document.title = `${s.workflows} · ${s.appName}`;
  }, [locale, s]);
  useEffect(() => {
    const onHash = () => setTarget(targetOfHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
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
  const signOut = useCallback(async () => {
    await api("DELETE", "/v1/session").catch(() => undefined);
    window.location.assign("/");
  }, []);

  return (
    <DirectionProvider dir={directionOf(locale)}>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-surface px-6 py-3">
        <strong>{s.appName}</strong>
        <nav aria-label={s.appName} className="flex gap-4 text-sm">
          <a href="/" className="text-brand underline">
            {s.home}
          </a>
          <a href="/workflows" aria-current="page" className="font-semibold text-text">
            {s.workflows}
          </a>
        </nav>
        <span className="flex-1" />
        {typeof signedIn === "object" && (
          <span dir="ltr" className="text-muted [overflow-wrap:anywhere]">
            {signedIn.email}
          </span>
        )}
        <button type="button" onClick={toggleLanguage} className="text-brand underline">
          {s.otherLanguage}
        </button>
        {typeof signedIn === "object" && (
          <button type="button" onClick={() => void signOut()} className="text-brand underline">
            {s.signOut}
          </button>
        )}
      </header>
      <main className="px-6 py-6">
        {signedIn === "loading" && <p className="text-muted">{s.loading}</p>}
        {signedIn === "out" && (
          <p>
            {s.signedOut}{" "}
            <a href="/" className="text-brand underline">
              {s.signInLink}
            </a>
          </p>
        )}
        {typeof signedIn === "object" &&
          (target === null ? (
            <WorkflowList locale={locale} />
          ) : (
            <WorkflowEditor key={target} {...parseTarget(target)} locale={locale} />
          ))}
      </main>
    </DirectionProvider>
  );
}
