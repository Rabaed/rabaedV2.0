"use client";

import type { OutcomeLook } from "@rabaed/domain";
import { cn } from "../../lib/cn.ts";
import { codeLookColour } from "../status/code-badge.tsx";

/**
 * The Review Code tile (RP-1151), which the Submittal Panel's code menu and the Action Form's header
 * draw (RP-1237). The Work Item page's own frame and cards went when Full became the page.
 */

/**
 * A Review Code's letter on a small square tile (gap table row 27), coloured by `look`, its place in its
 * Type's outcome set (`outcomeLook`, as the Kanban and the panel colour it); grey without one. Decorative:
 * the Transition's label or the card's title already says the code.
 */
export function CodeTile({ code, look, size = "sm", className }: { code: string; look?: OutcomeLook | undefined; size?: "sm" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      translate="no"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-extrabold",
        size === "sm" ? "size-[18px] rounded-[5px] text-[11px]" : "size-[30px] rounded-[8px] text-[15px]",
        look ? codeLookColour[look] : "bg-surface-subtle text-text-secondary",
        className,
      )}
    >
      {code.toUpperCase()}
    </span>
  );
}
