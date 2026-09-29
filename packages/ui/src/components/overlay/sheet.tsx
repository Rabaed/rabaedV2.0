"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/cn.ts";
import { ModalContent, ModalFooter, type ModalContentProps } from "./modal.tsx";

/** A side panel (drawer). Compose like Dialog: `<Sheet><SheetTrigger asChild>…</SheetTrigger><SheetContent …>…</SheetContent></Sheet>`. */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetFooter = ModalFooter;

export type SheetContentProps = ModalContentProps & {
  /** `end` (default): the right in English, the left in Arabic. `start` for navigation, which lives on the start side. */
  side?: "start" | "end";
};

/**
 * A full-height panel on the inline-end (or start) side. Up to 28rem wide;
 * the whole width on a phone.
 */
export function SheetContent({ side = "end", className, ...props }: SheetContentProps) {
  return (
    <ModalContent
      className={cn(
        "inset-y-0 w-full max-w-md overflow-y-auto border-border",
        side === "end" ? "end-0 border-s" : "start-0 border-e",
        className,
      )}
      {...props}
    />
  );
}
