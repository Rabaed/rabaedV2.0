"use client";

import type { ReplacementRefusal } from "@rabaed/domain";
import { useState } from "react";
import { Button } from "../button/button.tsx";

// Create replacement on the item page (RP-435; workflow-engine.md §5.5, GLOSSARY
// "Outcome"). Offered on an item closed with an outcome whose follow-up actions
// offer a replacement (Code D in the Rabaed Defaults), to a Member of the raiser's
// Company whom the Workflow's Draft Step allows. The card is the Create Revision
// card's twin: the API decides (WorkItemActions.createReplacement) and this shows
// what it offers. Presentational: the page does the call, and moves to the new
// Draft once it is created.

/** The card's words, from the app's messages. */
export type ReplacementActionsLabels = {
  section: string;
  createIntro: string;
  create: string;
  refusals: Record<ReplacementRefusal | "unavailable", string>;
};

export type { ReplacementRefusal };
/** The create command as the page calls it: a refusal by the API's error code. */
export type ReplacementCall = () => Promise<{ ok: true } | { ok: false; reason: string }>;

export type ReplacementActionsProps = {
  labels: ReplacementActionsLabels;
  /** The API offers Create replacement to the viewer on this item. */
  canCreate: boolean;
  onCreate: ReplacementCall;
};

export function ReplacementActions({ labels, canCreate, onCreate }: ReplacementActionsProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    try {
      const result = await onCreate();
      if (!result.ok) setError(labels.refusals[result.reason as ReplacementRefusal] ?? labels.refusals.unavailable);
    } catch {
      setError(labels.refusals.unavailable);
    } finally {
      setPending(false);
    }
  }

  if (!canCreate) return null;
  return (
    <section aria-label={labels.section} className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted">{labels.createIntro}</p>
        <Button disabled={pending} onClick={() => void create()}>
          {labels.create}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
    </section>
  );
}
