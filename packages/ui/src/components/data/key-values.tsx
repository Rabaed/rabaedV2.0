import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export type KeyValue = { key: string; label: ReactNode; value: ReactNode };

export type KeyValuesProps = {
  items: KeyValue[];
  className?: string;
  "data-testid"?: string;
};

/**
 * The design kit's key-value grid (`.kv`): each value in bold under its small
 * muted name, as many to a row as fit at 220px or more, e.g. a Project's
 * details on its Dashboard (RP-411).
 */
export function KeyValues({ items, className, ...rest }: KeyValuesProps) {
  return (
    <dl className={cn("grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-x-7 gap-y-[18px]", className)} {...rest}>
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 flex-col gap-1">
          <dt className="text-[12.5px] text-muted">{item.label}</dt>
          <dd className="text-[14.5px] font-semibold break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
