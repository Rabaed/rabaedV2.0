"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

export type TooltipProps = {
  /** The tip: a short hint, never the only place important information lives. */
  content: ReactNode;
  /** The element it describes; must be focusable (e.g. an IconButton). */
  children: ReactElement;
  side?: TooltipPrimitive.TooltipContentProps["side"];
};

/**
 * A short hint on hover or keyboard focus, read as the trigger's description.
 * Touch screens have no hover, so a tooltip never holds anything the user must see.
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="z-50 max-w-64 rounded-xs bg-inverse px-2 py-1 text-caption text-on-inverse shadow-sm"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
