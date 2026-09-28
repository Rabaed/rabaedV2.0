"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/cn.ts";
import { ModalContent, ModalFooter, type ModalContentProps } from "./modal.tsx";

/** A modal dialog. Compose: `<Dialog><DialogTrigger asChild>…</DialogTrigger><DialogContent …>…</DialogContent></Dialog>`. */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
/** Closes the dialog; wrap a Cancel button with `asChild`. */
export const DialogClose = DialogPrimitive.Close;
export const DialogFooter = ModalFooter;

export type DialogContentProps = ModalContentProps;

/** A centred panel over a dimmed page; up to 32rem wide, scrolls when tall. */
export function DialogContent({ className, ...props }: DialogContentProps) {
  return (
    <ModalContent
      // Centred with auto margins rather than a translate, which does not flip in right-to-left.
      className={cn(
        "inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-md",
        className,
      )}
      {...props}
    />
  );
}
