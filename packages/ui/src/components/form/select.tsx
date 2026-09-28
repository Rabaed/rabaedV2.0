"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../icon/icon.tsx";
import { textBox } from "./control-styles.ts";
import { useFieldControl, type ChoiceOption, type FieldControlProps } from "./field.tsx";

export type SelectProps = Omit<ComponentProps<typeof SelectPrimitive.Root>, keyof FieldControlProps | "children"> &
  FieldControlProps & {
    options: ChoiceOption[];
    /** Shown until a value is chosen. */
    placeholder?: ReactNode;
    className?: string;
  };

/**
 * One choice from a longer list, in a drop-down. Put it in a Field for its
 * label, help and error. Read-only shows the value and never opens.
 */
export function Select({ options, placeholder, className, value, defaultValue, onValueChange, open, onOpenChange, ...props }: SelectProps) {
  const {
    labelId: _labelId,
    readOnly,
    id,
    disabled,
    required,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    ...root
  } = useFieldControl(props);
  const state = readOnly
    ? // Always controlled, so typeahead on the closed trigger can't change it either.
      { value: value ?? defaultValue ?? "", open: false }
    : { value, defaultValue, onValueChange, open, onOpenChange };
  return (
    <SelectPrimitive.Root disabled={disabled} required={required} {...state} {...root}>
      <SelectPrimitive.Trigger
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-required={required || undefined}
        aria-readonly={readOnly || undefined}
        className={cn(
          textBox,
          "flex h-9 items-center justify-between gap-2 text-start data-placeholder:text-muted",
          "[&>span]:truncate",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="text-muted">
          <Icon name="chevron-down" size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden",
            "rounded-sm border border-border bg-surface text-text shadow-md",
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "relative flex h-9 cursor-default items-center rounded-xs ps-8 pe-2 text-body outline-none select-none",
                  "data-highlighted:bg-hover data-[state=checked]:font-medium",
                  "data-disabled:text-on-disabled",
                  "pointer-coarse:min-h-11",
                )}
              >
                <span className="absolute start-2 flex size-4 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Icon name="check" size={16} />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
