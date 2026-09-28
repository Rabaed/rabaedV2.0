"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/cn.ts";
import { ModalContent, ModalFooter, type ModalContentProps } from "./modal.tsx";

/** A side panel (drawer). Compose like Dialog: `<Sheet><SheetTrigger asChild>…</SheetTrigger><SheetContent …>…</SheetContent></Sheet>`. */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetFooter = ModalFooter;

export type SheetContentProps = ModalContentProps;

/**
 * A full-height panel on the inline-end side: the right in English, the left
 * in Arabic. Up to 28rem wide; the whole width on a phone.
 */
export function SheetContent({ className, ...props }: SheetContentProps) {
  return (
    <ModalContent
      className={cn("inset-y-0 end-0 w-full max-w-md overflow-y-auto border-s border-border", className)}
      {...props}
    />
  );
}
