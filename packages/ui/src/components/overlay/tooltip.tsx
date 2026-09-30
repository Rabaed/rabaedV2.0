"use client";

import { useDirection } from "@radix-ui/react-direction";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import { physicalSide, type LogicalSide } from "../../lib/direction.ts";

export type TooltipProps = {
  /** The tip: a short hint, never the only place important information lives. */
  content: ReactNode;
  /** The element it describes; must be focusable (e.g. an IconButton). */
  children: ReactElement;
  /** `top` (default), `bottom`, or `start` / `end`, which mirror in Arabic like Sheet's. */
  side?: "top" | "bottom" | LogicalSide;
};

/**
 * A short hint on hover or keyboard focus, read as the trigger's description.
 * Touch screens have no hover, so a tooltip never holds anything the user must see.
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const dir = useDirection();
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side === "start" || side === "end" ? physicalSide(side, dir) : side}
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
