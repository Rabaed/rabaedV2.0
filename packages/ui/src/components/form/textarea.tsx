"use client";

import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { textBox } from "./control-styles.ts";
import { useFieldControl } from "./field.tsx";

export type TextareaProps = ComponentProps<"textarea">;

/** A multi-line text box that grows vertically. Put it in a Field for its label, help and error. */
export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  const { labelId: _labelId, ...control } = useFieldControl(props);
  return <textarea rows={rows} className={cn(textBox, "min-h-20 resize-y py-2", className)} {...control} />;
}
