"use client";

import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { textBox } from "./control-styles.ts";
import { useFieldControl } from "./field.tsx";

export type InputProps = ComponentProps<"input">;

/** A single-line text box. Put it in a Field for its label, help and error. */
export function Input({ className, type = "text", ...props }: InputProps) {
  const { labelId: _labelId, ...control } = useFieldControl(props);
  return <input type={type} className={cn(textBox, "h-9", className)} {...control} />;
}
