"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { ModalContent, ModalFooter, type ModalContentProps } from "./modal.tsx";

/** A modal dialog. Compose: `<Dialog><DialogTrigger asChild>…</DialogTrigger><DialogContent …>…</DialogContent></Dialog>`. */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
/** Closes the dialog; wrap a Cancel button with `asChild`. */
export const DialogClose = DialogPrimitive.Close;

export type DialogContentProps = ModalContentProps & {
  /**
   * How it opens on a phone, below 768 wide (RP-1312; the owner's Responsive Anatomy, "Modal: full-screen, sticky
   * footer"). `full`, the default: it fills the screen, and its body scrolls under a `DialogFooter` that stays at the
   * foot. `card`: the centred card, for a short confirm or cancel (Delete, Withdraw, a single yes or no), or a caller's
   * own phone layout in `className` (the Participants pages' bottom sheet). From 768 wide it is always the centred card.
   */
  phone?: "full" | "card";
};

// Full screen on a phone. Min and max sizes rather than a width and height, so they win over a caller's own width
// (`w-[min(40rem,…)]`) and the even-pixel height below. The safe areas (a notch at the top, the home indicator at the
// foot) are transparent borders, which show the panel's background and leave a caller's own padding alone (the
// Workflow pop-ups have none); a scroll container's sticky footer stops above its border. Under a footer the panel has
// no padding of its own at the foot, so the footer reaches it at the end of the scroll too.
const fullOnPhone = cn(
  "phone:min-h-dvh phone:max-h-dvh phone:min-w-full phone:max-w-full phone:overflow-x-hidden phone:rounded-none",
  // eslint-disable-next-line rabaed/no-avoid-terms -- CSS env() names
  "phone:border-transparent phone:border-t-[length:env(safe-area-inset-top)] phone:border-b-[length:env(safe-area-inset-bottom)]",
  "phone:has-[[data-dialog-footer]]:pb-0",
  // A footer inside a form (or another wrapper) still reaches the foot when the body is short: the wrapper grows and stacks.
  "phone:[&>:has(>[data-dialog-footer])]:flex phone:[&>:has(>[data-dialog-footer])]:grow phone:[&>:has(>[data-dialog-footer])]:flex-col",
);

/** A centred panel over a dimmed page; up to 32rem wide, scrolls when tall. Full screen on a phone unless `phone="card"`. */
export function DialogContent({ phone = "full", className, ...props }: DialogContentProps) {
  return (
    <ModalContent
      data-full-on-phone={phone === "full" ? "" : undefined}
      // Centred with auto margins rather than a translate, which does not flip in right-to-left.
      // Its height rounds up to an even number of pixels, so on a screen of even height it sits on
      // a whole pixel: centred at a fraction, a box inside it near a pixel edge was drawn a pixel
      // higher or lower from one render to the next (RP-660's NewPackageRefused screenshot).
      className={cn(
        "inset-0 m-auto h-fit supports-[height:calc-size(fit-content,size)]:h-[calc-size(fit-content,round(up,size,2px))] max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-md",
        phone === "full" && fullOnPhone,
        className,
      )}
      {...props}
    />
  );
}

// In a full-screen pop-up on a phone: stuck to the foot of the screen while the body scrolls, pushed there when the
// body is short, and across the whole width whatever the panel's padding (50% is its parent's width, 50vw half the
// screen's, which the panel fills). Its background and border colour are base classes, the panel's own and drawn only
// where a border has a width, so they change nothing from 768 wide and a caller's own (the Workflow pop-ups') wins.
const footerOnPhone =
  "phone:in-data-full-on-phone:sticky phone:in-data-full-on-phone:bottom-0 phone:in-data-full-on-phone:z-10 phone:in-data-full-on-phone:mt-auto phone:in-data-full-on-phone:mx-[calc(50%-50vw)] phone:in-data-full-on-phone:border-t phone:in-data-full-on-phone:px-[max(1.25rem,calc(50vw-50%))] phone:in-data-full-on-phone:py-3";

/** The action row at the bottom of a Dialog: actions at the end, primary last. On a phone, a full-screen pop-up's footer stays in view. */
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <ModalFooter data-dialog-footer="" className={cn("border-border bg-surface", footerOnPhone, className)} {...props} />;
}
