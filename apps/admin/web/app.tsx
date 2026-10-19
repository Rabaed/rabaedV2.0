"use client";

import { directionOf } from "@rabaed/domain";
import { DirectionProvider } from "@rabaed/ui";
import { useEffect, useState } from "react";
import { AdminHeader, SignedOutOrLoading, useAdminSession } from "./admin-header.tsx";
import { strings } from "./strings.ts";
import { WorkflowEditor } from "./workflow-editor.tsx";
import { WorkflowList } from "./workflow-list.tsx";

// Rabaed Admin -> Workflows (RP-443): one page, the list of the Rabaed Default Workflows and,
// at `#/<Type code>` (or `#/<Type code>/<Workflow id>`), the builder with that Type's outcome and Stage sets. The sign-in and the
// other screens are the page at `/`; the language is the one it keeps.

/** `#/<Type code>` the Workflow the Type runs, `#/<Type code>/<Workflow id>` one of its other Rabaed Defaults (RP-596). */
const targetOfHash = (): string | null => {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash === "" ? null : hash;
};
const parseTarget = (target: string): { typeCode: string; workflowId: string | null } => {
  const [code = "", workflowId] = target.split("/");
  return { typeCode: decodeURIComponent(code), workflowId: workflowId ? decodeURIComponent(workflowId) : null };
};
const pageTitle = (locale: "en" | "ar") => strings(locale).workflows;

export function App() {
  const { locale, signedIn, toggleLanguage } = useAdminSession(pageTitle);
  const [target, setTarget] = useState<string | null>(targetOfHash);

  useEffect(() => {
    const onHash = () => setTarget(targetOfHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <DirectionProvider dir={directionOf(locale)}>
      <AdminHeader locale={locale} signedIn={signedIn} current="workflows" onToggleLanguage={toggleLanguage} />
      <main className="px-6 py-6">
        <SignedOutOrLoading locale={locale} signedIn={signedIn} />
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
