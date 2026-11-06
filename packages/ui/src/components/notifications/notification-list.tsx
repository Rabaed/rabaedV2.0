import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../icon/icon.tsx";

const card = "overflow-hidden rounded-[14px] bg-surface shadow-[0_0_0_1px_var(--border)]";

/** Notifications in one card: the page's list with Group by Project off (`.ngrp`). */
export function NotificationCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn(card, "flex flex-col", className)}>{children}</div>;
}

export type NotificationGroupProps = {
  /** The Project's code, on its tile. */
  code: string;
  name: string;
  /** How many of its notifications the list shows. */
  count: number;
  children: ReactNode;
};

/** One Project's notifications on the page (`.ngrp`, `.ngh`): its code on a tomato tile, its name and the count, then the rows. */
export function NotificationGroup({ code, name, count, children }: NotificationGroupProps) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={cn(card, "flex flex-col")}>
      <h2 id={heading} className="m-0 flex items-center gap-2.5 border-b border-border-subtle bg-surface-subtle px-[14px] py-3 text-[13px]">
        <span aria-hidden="true" className="flex h-[26px] min-w-[26px] items-center justify-center rounded-[7px] bg-primary px-1 text-[11px] font-bold text-on-primary">
          <bdi dir="ltr">{code}</bdi>
        </span>
        <b className="font-bold">{name}</b>
        <small className="text-muted tabular-nums">{count}</small>
      </h2>
      {children}
    </section>
  );
}

/** Nothing to show (`.nemp`): a bell on a tile, a title and a line. */
export function NotificationEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-5 py-[56px] text-center text-[13.5px] text-muted">
      <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-2xl bg-surface-subtle text-faint shadow-[inset_0_0_0_1px_var(--border-subtle)]">
        <Icon name="bell" size={26} />
      </span>
      <b className="text-[15px] text-text">{title}</b>
      {text}
    </div>
  );
}
