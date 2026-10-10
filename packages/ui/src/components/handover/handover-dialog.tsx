"use client";

import { sortedByName, type HandoverPick, type HandoverStep, type Locale } from "@rabaed/domain";
import { useState } from "react";
import { Button } from "../button/button.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { Field } from "../form/field.tsx";
import { Select } from "../form/select.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../overlay/dialog.tsx";

export type HandoverDialogLabels = {
  /** The heading, e.g. "Hand over Ali Sonour's Steps". */
  title: string;
  /** What happens, e.g. "Ali Sonour holds these. Pick who takes each one before they are deactivated." */
  description: string;
  /** Shown in place of a Draft's Document Number: "No number yet". */
  noNumber: string;
  /** An item the viewer doesn't see, by its Step and Project only: "An item at Contractor review on Riyadh Gate Tower". */
  hiddenItem: (step: string, project: string) => string;
  /** With several holders (a Participant's Visibility), each Step's: "Held by Ali Sonour"; unset for one. */
  heldBy?: (name: string) => string;
  /** The pick's label: "New holder". */
  newHolder: string;
  /** Shown in the pick until one is chosen: "Choose who takes it". */
  choose: string;
  cancel: string;
  /** The confirm button, naming the change: "Hand over and deactivate". */
  confirm: string;
  close: string;
};

export type HandoverDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Steps the change needs a new holder for, as the API listed them: the viewer's own Company's only. */
  steps: HandoverStep[];
  locale: Locale;
  labels: HandoverDialogLabels;
  /** Sends the change with its picks; the dialog stays open until the caller closes it. */
  onConfirm: (picks: HandoverPick[]) => void;
  pending?: boolean;
  /** Why the last try was refused, shown above the buttons. */
  error?: string | null;
};

/**
 * Handover (RP-108): before a Member is deactivated, removed from a Project, or
 * leaves a Step Pool through a change of Position or Visibility, each open Step
 * they hold, Drafts included, gets a new holder from its pool. Lists each one
 * (Project, Document Number or "No number yet", Subject, Step; an item the viewer
 * doesn't see by its Step and Project only, scenario RP-108-2) with a pick of who
 * takes it, ordered in the viewer's language; one candidate is filled in, and the
 * change is sent only once every Step has someone. Only ever the viewer's own
 * Company's Steps and Members (visibility.md scenario RP-108-1).
 */
export function HandoverDialog({ open, onOpenChange, steps, locale, labels, onConfirm, pending = false, error = null }: HandoverDialogProps) {
  // One candidate: filled in, and shown to check.
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(steps.flatMap((s) => (s.candidates.length === 1 ? [[s.assignmentId, s.candidates[0]!.id]] : []))),
  );
  const complete = steps.every((s) => s.candidates.some((c) => c.id === picks[s.assignmentId]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={labels.title} description={labels.description} closeLabel={labels.close} className="w-[min(40rem,calc(100%-2rem))]">
        <ul className="divide-y divide-border border-y border-border" data-testid="handover-steps">
          {steps.map((s) => (
            <li key={s.assignmentId} className="space-y-3 py-3">
              {s.item ? (
                <div className="space-y-1">
                  <p className="text-sm text-muted">
                    {s.project.name[locale]}
                    {" · "}
                    {s.item.documentNumber ? <DocNo value={s.item.documentNumber} /> : labels.noNumber}
                  </p>
                  <p className="font-medium">{s.item.title}</p>
                  <p className="text-sm">{s.step[locale]}</p>
                  {labels.heldBy && <p className="text-sm text-muted">{labels.heldBy(s.holder.fullName[locale])}</p>}
                </div>
              ) : (
                // Out of the viewer's sight (V16): its Step and Project only, nothing of the item.
                <div className="space-y-1">
                  <p className="font-medium">{labels.hiddenItem(s.step[locale], s.project.name[locale])}</p>
                  {labels.heldBy && <p className="text-sm text-muted">{labels.heldBy(s.holder.fullName[locale])}</p>}
                </div>
              )}
              <Field label={labels.newHolder} id={`handover-${s.assignmentId}`}>
                <Select
                  value={picks[s.assignmentId] ?? ""}
                  onValueChange={(memberId) => setPicks((current) => ({ ...current, [s.assignmentId]: memberId }))}
                  placeholder={labels.choose}
                  options={sortedByName(s.candidates, (c) => c.fullName[locale], locale).map((c) => ({ value: c.id, label: c.fullName[locale] }))}
                  disabled={pending}
                />
              </Field>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              {labels.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={pending || !complete}
            onClick={() => onConfirm(steps.map((s) => ({ assignmentId: s.assignmentId, toMemberId: picks[s.assignmentId]! })))}
          >
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
