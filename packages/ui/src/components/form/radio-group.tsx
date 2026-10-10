"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { useId, type ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing, touchArea } from "./control-styles.ts";
import { useFieldControl, type ChoiceOption, type FieldControlProps } from "./field.tsx";

export type RadioGroupProps = Omit<ComponentProps<typeof RadioGroupPrimitive.Root>, keyof FieldControlProps | "children"> &
  FieldControlProps & { options: ChoiceOption[] };

/**
 * One choice from a short list, all options visible. Put it in a Field with
 * `group` for its label, help and error. Arrow keys move between options.
 */
export function RadioGroup({ options, className, value, defaultValue, onValueChange, ...props }: RadioGroupProps) {
  const generated = useId();
  const { labelId, readOnly, id = generated, ...control } = useFieldControl(props);
  const state = readOnly
    ? { value: value ?? defaultValue ?? "", "aria-readonly": true }
    : { value, defaultValue, onValueChange };
  return (
    <RadioGroupPrimitive.Root
      id={id}
      aria-labelledby={labelId}
      className={cn("group flex flex-col gap-3 pointer-coarse:gap-7", className)}
      {...state}
      {...control}
    >
      {options.map((option) => {
        const itemId = `${id}-${option.value}`;
        return (
          <div key={option.value} className="flex items-center gap-2">
            <RadioGroupPrimitive.Item
              id={itemId}
              value={option.value}
              disabled={option.disabled}
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-control-border bg-surface",
                "hover:border-control-border-hover data-[state=checked]:border-primary",
                "group-aria-invalid:border-danger-fg",
                "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled",
                focusRing,
                touchArea,
              )}
            >
              <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-primary" />
            </RadioGroupPrimitive.Item>
            <label htmlFor={itemId} className={cn("text-body text-text", option.disabled && "text-muted")}>
              {option.label}
            </label>
          </div>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
