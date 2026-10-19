"use client";

import type { ReactNode } from "react";
import { Button } from "../button/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../overlay/dialog.tsx";

// No Stamp, no Transition (RP-617, ADR 0023; workflow-engine.md §5.1 check 6): the message a
// Member gets when they open a Transition while their own Company has no Stamp, before its
// Action Form, so nothing they would type is lost. It names only the Member's own Company and
// says its Authorized Person must add the Stamp; the Authorized Person themself gets the way to
// add it. Nobody is notified.

/** The message's words, from the app's messages, with the Member's own Company's name in them. */
export type StampRequiredLabels = {
  title: string;
  body: string;
  /** The button that closes it: "OK" for a Member, "Not now" beside Add Stamp for the Authorized Person. */
  dismiss: string;
  close: string;
};

export type StampRequiredDialogProps = {
  labels: StampRequiredLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** For the Authorized Person only: the way to the Company profile, styled as the primary button (`buttonVariants()`). */
  addStamp?: ReactNode;
};

export function StampRequiredDialog({ labels, open, onOpenChange, addStamp }: StampRequiredDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={labels.title} description={labels.body} closeLabel={labels.close}>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant={addStamp ? "ghost" : "primary"}>{labels.dismiss}</Button>
          </DialogClose>
          {addStamp}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
