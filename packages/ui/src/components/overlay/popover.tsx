"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";

/** A non-modal panel anchored to its trigger. Compose: `<Popover><PopoverTrigger asChild>…</PopoverTrigger><PopoverContent aria-label="…">…</PopoverContent></Popover>`. */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export type PopoverContentProps = ComponentProps<typeof PopoverPrimitive.Content>;

/**
 * The panel: below the trigger and aligned to its start edge by default, so it
 * mirrors in Arabic. Name it with `aria-label` or `aria-labelledby`.
 */
export function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 max-w-[calc(100vw-2rem)] rounded-sm border border-menu-border bg-surface p-4 text-text shadow-md",
          focusRing,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
