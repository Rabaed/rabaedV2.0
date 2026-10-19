"use client";

import type { ReactNode } from "react";
import { Button } from "../button/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../overlay/dialog.tsx";

// No Signature, no Transition (RP-85, ADR 0023; workflow-engine.md §5.1 check 6): the pop-up
// a Member without a Signature gets when they open a Transition, before its Action Form, so
// nothing they would type is lost. It sends them to Profile → Add Signature, which brings them
// back to the item. It names only the Member's own missing Signature; nobody is notified.

/** The pop-up's words, from the app's messages. */
export type SignatureRequiredLabels = {
  title: string;
  body: string;
  notNow: string;
  close: string;
};

export type SignatureRequiredDialogProps = {
  labels: SignatureRequiredLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The way to Add Signature: the page's link, styled as the primary button (`buttonVariants()`). */
  addSignature: ReactNode;
};

export function SignatureRequiredDialog({ labels, open, onOpenChange, addSignature }: SignatureRequiredDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={labels.title} description={labels.body} closeLabel={labels.close}>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{labels.notNow}</Button>
          </DialogClose>
          {addSignature}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
