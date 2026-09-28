"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useId, type ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "./control-styles.ts";
import { useFieldControl, type FieldControlProps } from "./field.tsx";
import type { Option } from "./radio-group.tsx";

export type SegmentedControlProps = Omit<
  ComponentProps<typeof RadioGroupPrimitive.Root>,
  keyof FieldControlProps | "children" | "orientation"
> &
  FieldControlProps & { options: Option[] };

/**
 * One choice from two to five short options shown side by side, such as a
 * view switch. A radio group underneath: arrow keys follow the reading
 * direction. Put it in a Field with `group` for its label, help and error.
 */
export function SegmentedControl({ options, className, value, defaultValue, onValueChange, ...props }: SegmentedControlProps) {
  const generated = useId();
  const { labelId, readOnly, id = generated, ...control } = useFieldControl(props);
  const state = readOnly
    ? { value: value ?? defaultValue ?? "", "aria-readonly": true }
    : { value, defaultValue, onValueChange };
  return (
    <RadioGroupPrimitive.Root
      id={id}
      aria-labelledby={labelId}
      orientation="horizontal"
      className={cn(
        "inline-flex w-fit gap-0.5 rounded-sm border border-control-border bg-surface-subtle p-0.5",
        "aria-invalid:border-danger",
        className,
      )}
      {...state}
      {...control}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "inline-flex h-8 items-center justify-center rounded-xs px-3 text-sm font-medium text-muted",
            "hover:bg-hover hover:text-text",
            "data-[state=checked]:bg-surface data-[state=checked]:text-text data-[state=checked]:shadow-sm",
            "disabled:cursor-not-allowed disabled:bg-transparent disabled:text-on-disabled",
            // Touch targets of at least 44px on phones (gloved hands on site).
            "pointer-coarse:min-h-11 pointer-coarse:min-w-11",
            focusRing,
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
