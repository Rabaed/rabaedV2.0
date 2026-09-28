"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing, touchArea } from "./control-styles.ts";
import { useFieldControl, type FieldControlProps } from "./field.tsx";

export type SwitchProps = Omit<ComponentProps<typeof SwitchPrimitive.Root>, keyof FieldControlProps> & FieldControlProps;

/**
 * An on/off switch for a setting that applies at once. Put it in a Field with
 * `layout="inline"` for its label, help and error. Read-only keeps its value
 * and stays focusable.
 */
export function Switch({ className, checked, defaultChecked, onCheckedChange, ...props }: SwitchProps) {
  const { labelId: _labelId, readOnly, ...control } = useFieldControl(props);
  const state = readOnly
    ? { checked: checked ?? defaultChecked ?? false, "aria-readonly": true }
    : { checked, defaultChecked, onCheckedChange };
  return (
    <SwitchPrimitive.Root
      className={cn(
        "group inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent bg-control-border transition-colors",
        "hover:bg-control-border-hover data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary-hover",
        "aria-invalid:border-danger",
        "aria-readonly:bg-muted aria-readonly:data-[state=checked]:bg-muted",
        "disabled:cursor-not-allowed disabled:bg-disabled disabled:data-[state=checked]:bg-disabled",
        focusRing,
        touchArea,
        className,
      )}
      {...state}
      {...control}
      // Radix sets `required` only on its hidden form input.
      aria-required={control.required || undefined}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-4 rounded-full bg-surface shadow-xs transition-transform",
          "data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4",
          "group-disabled:bg-on-disabled",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
