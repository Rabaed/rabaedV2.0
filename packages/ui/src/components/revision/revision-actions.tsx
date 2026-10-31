"use client";

import type { RevisionRefusal } from "@rabaed/domain";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "../overlay/dialog.tsx";

// Create Revision and Discard Revision on the item page (RP-316; workflow-engine.md
// §5.4, GLOSSARY "Revision"). "Create Revision" is offered on the latest item of
// its chain closed with Code C, to a Member of the raiser's Company whom the
// Workflow's Draft Step allows; "Discard Revision" on a Revision still in Draft.
// The API decides both (WorkItemActions.createRevision / discardRevision): this
// shows what it offers. Presentational: the page does the calls, and moves to
// the new Revision once it is created.

/** The section's words, from the app's messages. */
export type RevisionActionsLabels = {
  section: string;
  createIntro: string;
  create: string;
  discard: string;
  discardTitle: string;
  discardIntro: string;
  cancel: string;
  close: string;
  refusals: Record<RevisionRefusal | "unavailable", string>;
};

export type { RevisionRefusal };
/** A Revision command as the page calls it: a refusal by the API's error code. */
export type RevisionCall = () => Promise<{ ok: true } | { ok: false; reason: string }>;

export type RevisionActionsProps = {
  labels: RevisionActionsLabels;
  /** The API offers Create Revision to the viewer on this item. */
  canCreate: boolean;
  /** The API offers Discard Revision to the viewer on this item. */
  canDiscard: boolean;
  onCreate: RevisionCall;
  onDiscard: RevisionCall;
  /**
   * `page`: inside the Work Item page's Actions card (RP-1188, gap table row 32): no bordered section, and
   * Discard Revision the design's red text button with a bin, the card's width. It still asks first.
   */
  look?: "section" | "page";
};

export function RevisionActions({ labels, canCreate, canDiscard, onCreate, onDiscard, look = "section" }: RevisionActionsProps) {
  const page = look === "page";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run(call: RevisionCall) {
    setPending(true);
    setError(null);
    try {
      const result = await call();
      if (!result.ok) setError(labels.refusals[result.reason as RevisionRefusal] ?? labels.refusals.unavailable);
      return result.ok;
    } catch {
      setError(labels.refusals.unavailable);
      return false;
    } finally {
      setPending(false);
    }
  }

  if (!canCreate && !canDiscard) return null;
  return (
    <div {...(page ? {} : { role: "region", "aria-label": labels.section })} className={cn("space-y-3", !page && "rounded-md border border-border p-4")}>
      {canCreate && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body text-muted">{labels.createIntro}</p>
          <Button disabled={pending} onClick={() => void run(onCreate)}>
            {labels.create}
          </Button>
        </div>
      )}
      {canDiscard && (
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogTrigger asChild>
            {page ? (
              <Button variant="secondary" disabled={pending} className="w-full text-danger-fg hover:text-danger-fg">
                <Icon name="trash" />
                {labels.discard}
              </Button>
            ) : (
              <Button variant="secondary" disabled={pending}>
                {labels.discard}
              </Button>
            )}
          </DialogTrigger>
          <DialogContent title={labels.discardTitle} description={labels.discardIntro} closeLabel={labels.close}>
            {error && (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{labels.cancel}</Button>
              </DialogClose>
              <Button
                variant="danger"
                disabled={pending}
                onClick={async () => {
                  if (await run(onDiscard)) setConfirming(false);
                }}
              >
                {labels.discard}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {error && !confirming && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
