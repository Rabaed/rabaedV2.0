import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export type DocNoProps = Omit<ComponentProps<"bdi">, "children" | "dir" | "rev"> & {
  /** The Document Number, e.g. `TWR-TMC-EL-MAR-041`. */
  value: string;
  /** The revision, shown as `Rev n` after the number. */
  rev?: number | string;
};

/**
 * A Document Number, optionally with its revision. Always left to right and
 * isolated from the surrounding text, so it never scrambles inside an Arabic
 * sentence; tabular digits keep numbers aligned in lists.
 */
export function DocNo({ value, rev, className, ...props }: DocNoProps) {
  return (
    <bdi
      dir="ltr"
      // Browser translation would mangle an identifier.
      translate="no"
      className={cn("whitespace-nowrap font-medium tabular-nums", className)}
      {...props}
    >
      {rev === undefined ? value : `${value} Rev ${rev}`}
    </bdi>
  );
}
