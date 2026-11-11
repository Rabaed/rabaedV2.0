"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/cn.ts";
import type { LogicalSide } from "../../lib/direction.ts";
import { ModalContent, ModalFooter, type ModalContentProps } from "./modal.tsx";

/** A side panel (drawer). Compose like Dialog: `<Sheet><SheetTrigger asChild>…</SheetTrigger><SheetContent …>…</SheetContent></Sheet>`. */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetFooter = ModalFooter;

export type SheetContentProps = ModalContentProps & {
  /** `end` (default): the right in English, the left in Arabic. `start` for navigation, which lives on the start side. */
  side?: LogicalSide;
};

/**
 * A full-height panel on the inline-end (or start) side. Up to 28rem wide;
 * the whole width on a phone.
 */
/**
 * A panel that comes up from the bottom of a phone's screen (RP-1272, RP-1273): the full width, at most 92%
 * high, rounded at the top with the kit's handle, its foot clear of the home indicator. Compose it in a
 * `Sheet` as `SheetContent`; Escape, the scrim or the close button shut it.
 */
export function BottomSheetContent({ className, children, ...props }: ModalContentProps) {
  return (
    <ModalContent
      className={cn(
        "inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-[20px] px-4 pt-3",
        // eslint-disable-next-line rabaed/no-avoid-terms -- CSS env() name
        "pb-[max(1rem,env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-2 mx-auto h-1 w-9 rounded-full bg-border-strong" />
      {children}
    </ModalContent>
  );
}

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
