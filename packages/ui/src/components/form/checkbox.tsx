"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../icon/icon.tsx";
import { focusRing, touchArea } from "./control-styles.ts";
import { useFieldControl, type FieldControlProps } from "./field.tsx";

export type CheckboxProps = Omit<ComponentProps<typeof CheckboxPrimitive.Root>, keyof FieldControlProps> & FieldControlProps;

/**
 * A checkbox; `checked` may be `"indeterminate"`. Put it in a Field with
 * `layout="inline"` for its label, help and error. Read-only keeps its
 * value and stays focusable.
 */
export function Checkbox({ className, checked, defaultChecked, onCheckedChange, ...props }: CheckboxProps) {
  const { labelId: _labelId, readOnly, ...control } = useFieldControl(props);
  const state = readOnly
    ? { checked: checked ?? defaultChecked ?? false, "aria-readonly": true }
    : { checked, defaultChecked, onCheckedChange };
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "group inline-flex size-5 shrink-0 items-center justify-center rounded-xs border border-control-border bg-surface text-on-primary",
        "hover:border-control-border-hover",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
        "aria-invalid:border-danger",
        "aria-readonly:border-muted aria-readonly:data-[state=checked]:bg-muted aria-readonly:data-[state=indeterminate]:bg-muted",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-on-disabled",
        focusRing,
        touchArea,
        className,
      )}
      {...state}
      {...control}
    >
      <CheckboxPrimitive.Indicator className="flex">
        <Icon name="check" size={14} strokeWidth={3} className="group-data-[state=indeterminate]:hidden" />
        <Icon name="minus" size={14} strokeWidth={3} className="hidden group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
