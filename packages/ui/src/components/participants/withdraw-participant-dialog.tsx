"use client";

import { formatNumber, type Locale, type ParticipantWithdrawalPreview } from "@rabaed/domain";
import { Button } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../overlay/dialog.tsx";
import { vacancyIcon } from "../views/kanban-card.tsx";

export type WithdrawParticipantDialogLabels = {
  /** The heading: "Withdraw Design Consultants LLC from Riyadh Gate Tower?". */
  title: (company: string, project: string) => string;
  /** What happens to its Members and to what it did. */
  description: string;
  /** "3 items it raised will be Cancelled by Rabaed"; `n` formatted, `count` for the plural. */
  itemsToCancel: (n: string, count: number) => string;
  /** "1 Step it holds will wait for a new Consultant". */
  stepsToVacate: (n: string, count: number, role: string) => string;
  /** The counts include items the Admin may not see, never named (the owner's Q6). */
  countsInclude: string;
  /** "This can't be undone." */
  noUndo: string;
  /** "The Company can come back only through a new invitation." */
  comeBack: string;
  /** While the counts load. */
  counting: string;
  cancel: string;
  /** The red button: "Withdraw". */
  confirm: string;
  close: string;
};

export type WithdrawParticipantDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  projectName: string;
  /** The Participant's Project Role, which its Steps wait for: "Consultant". */
  roleName: string;
  /** The counts, from the preview; null while they load. */
  preview: ParticipantWithdrawalPreview | null;
  locale: Locale;
  labels: WithdrawParticipantDialogLabels;
  /** Withdraws; the dialog stays open until the caller closes it. */
  onConfirm: () => void;
  pending?: boolean;
  /** Why the last try was refused, shown above the buttons. */
  error?: string | null;
};

/**
 * The Host Company's Project Admin confirms withdrawing a Participant (RP-952, ADR 0028): counts
 * only (items to be Cancelled, Steps to become Vacancies), which include items the Admin may not
 * see but never name one; and plainly, no undo. The look is the owner reference's Remove
 * confirmation (Rabaed Participants.html `.amd`): a red-tinted icon tile, the question, and a
 * footer band with Cancel and the red action last. A bottom sheet on a phone.
 */
export function WithdrawParticipantDialog({
  open,
  onOpenChange,
  companyName,
  projectName,
  roleName,
  preview,
  locale,
  labels,
  onConfirm,
  pending = false,
  error = null,
}: WithdrawParticipantDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={labels.close}
        title={
          <span className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-[38px] shrink-0 items-center justify-center rounded-[11px] bg-danger-tint text-danger-fg">
              <Icon name="logout" size={19} />
            </span>
            <span className="pt-2 font-sans text-[16px] leading-snug font-bold">{labels.title(companyName, projectName)}</span>
          </span>
        }
        className="w-[min(440px,calc(100%-2rem))] gap-3 rounded-[16px] pb-0 max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:mx-0 max-sm:mb-0 max-sm:w-full max-sm:max-h-[85dvh] max-sm:rounded-b-none"
      >
        <div className="space-y-3 ps-[50px] text-[13px] leading-normal text-text-secondary" data-testid="withdraw-preview">
          <p>{labels.description}</p>
          {preview === null ? (
            <p className="text-muted">{labels.counting}</p>
          ) : (
            <ul className="space-y-1.5 font-semibold text-text">
              <li className="flex items-center gap-2">
                <Icon name="circle-x" size={16} className="shrink-0 text-danger-fg" />
                {labels.itemsToCancel(formatNumber(preview.itemsToCancel, locale), preview.itemsToCancel)}
              </li>
              <li className="flex items-center gap-2">
                <Icon name={vacancyIcon} size={16} className="shrink-0 text-muted" />
                {labels.stepsToVacate(formatNumber(preview.stepsToVacate, locale), preview.stepsToVacate, roleName)}
              </li>
            </ul>
          )}
          <p className="text-muted">{labels.countsInclude}</p>
          <p>
            <strong className="text-text">{labels.noUndo}</strong> {labels.comeBack}
          </p>
          {error && (
            <p role="alert" className="text-danger-fg">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="-mx-6 mt-2 border-t border-border-subtle bg-surface-subtle px-[18px] py-[14px]">
          <DialogClose asChild>
            <Button variant="secondary">{labels.cancel}</Button>
          </DialogClose>
          <Button variant="danger" disabled={pending || preview === null} onClick={onConfirm}>
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
