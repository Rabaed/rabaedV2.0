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
      // Its height rounds up to an even number of pixels, so on a screen of even height it sits on
      // a whole pixel: centred at a fraction, a box inside it near a pixel edge was drawn a pixel
      // higher or lower from one render to the next (RP-660's NewPackageRefused screenshot).
      className={cn(
        "inset-0 m-auto h-fit supports-[height:calc-size(fit-content,size)]:h-[calc-size(fit-content,round(up,size,2px))] max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-md",
        className,
      )}
      {...props}
    />
  );
}
