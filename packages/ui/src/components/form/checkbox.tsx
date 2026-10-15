"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../icon/icon.tsx";
import { focusRing, touchArea } from "./control-styles.ts";
import { useFieldControl, type FieldControlProps } from "./field.tsx";

export type CheckboxProps = Omit<ComponentProps<typeof CheckboxPrimitive.Root>, keyof FieldControlProps> &
  FieldControlProps & {
    /**
     * A 24 × 24px box that draws a 16px square (a table row checkbox's size), for a checkbox that other
     * targets can overlap, such as a table header cell that scrolls under a pinned button: axe's `target-size`
     * then finds 24px of its own. Every state looks as on the plain checkbox.
     */
    targetBox?: boolean;
  };

/**
 * A checkbox; `checked` may be `"indeterminate"`. Put it in a Field with
 * `layout="inline"` for its label, help and error. Read-only keeps its
 * value and stays focusable.
 */
export function Checkbox({ className, checked, defaultChecked, onCheckedChange, targetBox = false, ...props }: CheckboxProps) {
  const { labelId: _labelId, readOnly, ...control } = useFieldControl(props);
  const state = readOnly
    ? { checked: checked ?? defaultChecked ?? false, "aria-readonly": true }
    : { checked, defaultChecked, onCheckedChange };
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "group/checkbox inline-flex shrink-0 items-center justify-center text-on-primary",
        "disabled:cursor-not-allowed disabled:text-on-disabled",
        focusRing,
        // In the 24px box the ring is drawn inside its edge, so it sits 2px off the square as on the plain checkbox.
        targetBox ? "size-6 rounded-sm focus-visible:-outline-offset-2" : "size-5 rounded-xs",
        touchArea,
        className,
      )}
      {...state}
      {...control}
    >
      {/* The square: the whole control, or centred in the 24px box. */}
      <span
        className={cn(
          "flex items-center justify-center rounded-xs border border-control-border bg-surface",
          targetBox ? "size-4" : "size-full",
          "group-hover/checkbox:border-control-border-hover",
          "group-data-[state=checked]/checkbox:border-primary group-data-[state=checked]/checkbox:bg-primary",
          "group-data-[state=indeterminate]/checkbox:border-primary group-data-[state=indeterminate]/checkbox:bg-primary",
          "group-aria-invalid/checkbox:border-danger-fg",
          "group-aria-readonly/checkbox:border-muted group-aria-readonly/checkbox:group-data-[state=checked]/checkbox:bg-muted group-aria-readonly/checkbox:group-data-[state=indeterminate]/checkbox:bg-muted",
          "group-disabled/checkbox:border-border group-disabled/checkbox:bg-disabled",
        )}
      >
        <CheckboxPrimitive.Indicator className="flex">
          <Icon name="check" size={14} strokeWidth={3} className="group-data-[state=indeterminate]/checkbox:hidden" />
          <Icon name="minus" size={14} strokeWidth={3} className="hidden group-data-[state=indeterminate]/checkbox:block" />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
