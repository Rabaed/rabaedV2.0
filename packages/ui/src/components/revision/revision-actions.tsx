"use client";

import type { Locale, RevisionRefusal } from "@rabaed/domain";
import { useState } from "react";
import { Button } from "../button/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "../overlay/dialog.tsx";

// Create Revision and Discard Revision on the item page (RP-316; workflow-engine.md
// §5.4, GLOSSARY "Revision"). "Create Revision" is offered on the latest item of
// its chain closed with Code C, to a Member of the raiser's Company whom the
// Workflow's Draft Step allows; "Discard Revision" on a Revision still in Draft.
// The API decides both (WorkItemActions.createRevision / discardRevision): this
// shows what it offers. Presentational: the page does the calls, and moves to
// the new Revision once it is created.

const copy = {
  en: {
    section: "Revision",
    createIntro: "Create a Revision of this item under the same number: it starts as a Draft with your answers and Documents.",
    create: "Create Revision",
    discard: "Discard Revision",
    discardTitle: "Discard this Revision?",
    discardIntro: "It is still a Draft, so nobody outside your company has seen it. The next Revision you create takes its Rev number.",
    cancel: "Cancel",
    close: "Close",
    refusals: {
      revision_not_allowed: "A Revision can't be created from this item now. Reload the page to see why.",
      not_discardable: "This Revision has left Draft, so it can no longer be discarded.",
      project_closed: "The Project is closed.",
      not_found: "This item is no longer available to you.",
      idempotency_key_reused: "That didn't work. Try again.",
      unavailable: "That didn't work. Try again.",
    },
  },
  ar: {
    section: "المراجعة",
    createIntro: "أنشئ مراجعة لهذا البند بالرقم نفسه: تبدأ مسودةً فيها إجاباتك ومستنداتك.",
    create: "إنشاء مراجعة",
    discard: "حذف مسودة المراجعة",
    discardTitle: "حذف مسودة هذه المراجعة؟",
    discardIntro: "ما زالت مسودة، فلم يطّلع عليها أحد خارج شركتك. تأخذ المراجعة التالية التي تنشئها رقمها.",
    cancel: "إلغاء",
    close: "إغلاق",
    refusals: {
      revision_not_allowed: "لا يمكن إنشاء مراجعة من هذا البند الآن. أعد تحميل الصفحة لمعرفة السبب.",
      not_discardable: "غادرت هذه المراجعة مرحلة المسودة، فلم يعد حذفها ممكنًا.",
      project_closed: "المشروع مغلق.",
      not_found: "لم يعد هذا البند متاحًا لك.",
      idempotency_key_reused: "لم ينجح ذلك. حاول مرة أخرى.",
      unavailable: "لم ينجح ذلك. حاول مرة أخرى.",
    },
  },
} satisfies Record<Locale, { refusals: Record<RevisionRefusal | "unavailable", string>; [text: string]: unknown }>;

export type { RevisionRefusal };
/** A Revision command as the page calls it: a refusal by the API's error code. */
export type RevisionCall = () => Promise<{ ok: true } | { ok: false; reason: string }>;

export type RevisionActionsProps = {
  locale: Locale;
  /** The API offers Create Revision to the viewer on this item. */
  canCreate: boolean;
  /** The API offers Discard Revision to the viewer on this item. */
  canDiscard: boolean;
  onCreate: RevisionCall;
  onDiscard: RevisionCall;
};

export function RevisionActions({ locale, canCreate, canDiscard, onCreate, onDiscard }: RevisionActionsProps) {
  const t = copy[locale];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run(call: RevisionCall) {
    setPending(true);
    setError(null);
    try {
      const result = await call();
      if (!result.ok) setError(t.refusals[result.reason as RevisionRefusal] ?? t.refusals.unavailable);
      return result.ok;
    } catch {
      setError(t.refusals.unavailable);
      return false;
    } finally {
      setPending(false);
    }
  }

  if (!canCreate && !canDiscard) return null;
  return (
    <section aria-label={t.section} className="space-y-3 rounded-md border border-border p-4">
      {canCreate && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body text-muted">{t.createIntro}</p>
          <Button disabled={pending} onClick={() => void run(onCreate)}>
            {t.create}
          </Button>
        </div>
      )}
      {canDiscard && (
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogTrigger asChild>
            <Button variant="secondary" disabled={pending}>
              {t.discard}
            </Button>
          </DialogTrigger>
          <DialogContent title={t.discardTitle} description={t.discardIntro} closeLabel={t.close}>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{t.cancel}</Button>
              </DialogClose>
              <Button
                variant="danger"
                disabled={pending}
                onClick={async () => {
                  if (await run(onDiscard)) setConfirming(false);
                }}
              >
                {t.discard}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {error && !confirming && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
