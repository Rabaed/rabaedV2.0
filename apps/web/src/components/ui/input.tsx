import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-sm border border-border bg-surface px-3 py-1 text-sm shadow-xs outline-none",
        "placeholder:text-muted focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
