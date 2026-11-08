import type { PackageItemState, PackageStatus } from "@rabaed/domain";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

// What the Packages view, its List and the Package page share (RP-1143; the kit's
// `packages/packages.js` pill(), minibar() and tic(), `packages.css` `.stp`, `.mbar`, `.tic`).

const statusLook: Record<PackageStatus, { icon: IconName; className: string }> = {
  open: { icon: "circle-dashed", className: "bg-neutral-tint text-neutral-fg" },
  in_progress: { icon: "progress", className: "bg-info-tint text-info-fg" },
  done: { icon: "circle-check", className: "bg-success-tint text-success-fg" },
};

/** A Package's status as a pill with its icon (the kit's `pill()`): Open, In Progress or Done. */
export function PackageStatusPill({ status, label, className, ...rest }: { status: PackageStatus; label: string } & HTMLAttributes<HTMLSpanElement>) {
  const look = statusLook[status];
  return (
    <span
      data-package-status={status}
      className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-[7px] px-2 text-caption font-semibold whitespace-nowrap", look.className, className)}
      {...rest}
    >
      <Icon name={look.icon} size={14} />
      {label}
    </span>
  );
}

/**
 * Each state's colour (the kit's TONE): green closed at Code A or B, red closed at Code D, orange a
 * Code C waiting for its Revision, blue still open. Full class names, so Tailwind finds them.
 */
export const stateFill: Record<PackageItemState, string> = {
  done: "bg-success",
  replace: "bg-danger",
  revise: "bg-warning-fg",
  open: "bg-info-fg",
};
/** The same colour as a row's starting edge (the kit's `.pkt tr.ok td:first-child`). */
export const stateEdge: Record<PackageItemState, string> = {
  done: "shadow-[inset_3px_0_0_var(--color-success)] rtl:shadow-[inset_-3px_0_0_var(--color-success)]",
  replace: "shadow-[inset_3px_0_0_var(--color-danger)] rtl:shadow-[inset_-3px_0_0_var(--color-danger)]",
  revise: "shadow-[inset_3px_0_0_var(--color-warning-fg)] rtl:shadow-[inset_-3px_0_0_var(--color-warning-fg)]",
  open: "",
};

/** The order a bar shows the states in: what counts towards Done first. */
export const stateOrder: readonly PackageItemState[] = ["done", "replace", "revise", "open"];

/** One segment per item, coloured by its state (the kit's `.mbar`): `counts` says how many of each. */
export function StateMiniBar({ counts, className }: { counts: Record<PackageItemState, number>; className?: string }) {
  const segments = stateOrder.flatMap((state) => Array.from({ length: counts[state] }, (_, i) => ({ state, key: `${state}-${i}` })));
  return (
    <span aria-hidden="true" className={cn("flex h-2 min-w-0 gap-0.5", className)}>
      {segments.map((s) => (
        <span key={s.key} data-state={s.state} className={cn("h-full min-w-0 flex-1 rounded-[2px]", stateFill[s.state])} />
      ))}
    </span>
  );
}

/** The states as one bar, each its share of the total (the kit's `.ovb`), for a whole Package. */
export function StateShareBar({ counts, total, className }: { counts: Record<PackageItemState, number>; total: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex h-1.5 min-w-0 gap-0.5 overflow-hidden rounded-full bg-neutral-tint", className)}>
      {total > 0 &&
        stateOrder.map((state) =>
          counts[state] > 0 ? <span key={state} data-state={state} className={cn("h-full", stateFill[state])} style={{ width: `${(counts[state] / total) * 100}%` }} /> : null,
        )}
    </span>
  );
}

const typeIcon: Record<string, IconName> = { MAR: "package", SAR: "building-factory", DAR: "file-text" };

/** A Type's icon in its tile (the kit's `tic()`): the Submittals' Types by their code, any other a file. */
export function TypeIconTile({ code, size = 24, className }: { code: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] bg-segment-type-tint text-segment-type-fg", className)}
    >
      <Icon name={typeIcon[code] ?? "file"} size={Math.round(size * 0.6)} />
    </span>
  );
}

/** Whether a Type's items need attention, and how (the kit's issue dot): a Code D first, then a Code C. */
export function issueOf(counts: Record<PackageItemState, number>): "replace" | "revise" | null {
  return counts.replace > 0 ? "replace" : counts.revise > 0 ? "revise" : null;
}
