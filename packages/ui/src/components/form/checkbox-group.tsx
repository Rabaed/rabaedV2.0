"use client";

import { useId } from "react";
import { cn } from "../../lib/cn.ts";
import { Checkbox } from "./checkbox.tsx";
import { OutsideField, useFieldControl, type ChoiceOption, type FieldControlProps } from "./field.tsx";

export type CheckboxGroupProps = FieldControlProps & {
  options: ChoiceOption[];
  /** The chosen option values, in the order they were chosen. */
  value?: readonly string[];
  onValueChange?: (value: string[]) => void;
  className?: string;
};

/**
 * Any number of choices from a short list, each a checkbox. Put it in a Field
 * with `group` for its label, help and error. Checking adds the option at the
 * end of the value; unchecking removes it. Read-only keeps the value and stays
 * focusable.
 */
export function CheckboxGroup({ options, value = [], onValueChange, className, ...props }: CheckboxGroupProps) {
  const generated = useId();
  const { labelId, readOnly, disabled, required: _required, id = generated, ...control } = useFieldControl(props);
  const toggle = (option: string, checked: boolean) =>
    onValueChange?.(checked ? [...value.filter((v) => v !== option), option] : value.filter((v) => v !== option));
  return (
    <div
      role="group"
      id={id}
      aria-labelledby={labelId}
      className={cn("flex flex-col gap-3 pointer-coarse:gap-7", className)}
      {...control}
    >
      <OutsideField>
        {options.map((option) => {
          const itemId = `${id}-${option.value}`;
          return (
            <div key={option.value} className="flex items-center gap-2">
              <Checkbox
                id={itemId}
                checked={value.includes(option.value)}
                onCheckedChange={(checked) => toggle(option.value, checked === true)}
                disabled={disabled || option.disabled}
                readOnly={readOnly}
                aria-invalid={control["aria-invalid"]}
              />
              <label htmlFor={itemId} className={cn("text-body text-text", (disabled || option.disabled) && "text-muted")}>
                {option.label}
              </label>
            </div>
          );
        })}
      </OutsideField>
    </div>
  );
}
