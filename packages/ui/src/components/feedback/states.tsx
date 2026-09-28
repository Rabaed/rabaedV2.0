import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

type StateProps = {
  title: ReactNode;
  /** One or two sentences: what this means and what to do. Never deadline language. */
  children?: ReactNode;
  /** An optional button, e.g. "Create a Submittal" or "Try again". */
  action?: ReactNode;
  className?: string;
};

function State({ icon, tone, role, title, children, action, className }: StateProps & { icon: IconName; tone: "muted" | "danger"; role?: "alert" }) {
  return (
    <div role={role} className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <span className={cn("flex size-12 items-center justify-center rounded-full", tone === "danger" ? "bg-danger-tint text-danger" : "bg-surface-subtle text-muted")}>
        <Icon name={icon} size={24} />
      </span>
      <h2 className="font-display text-h6 font-semibold text-text">{title}</h2>
      {children && <p className="max-w-sm text-body text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Shown where a list or page has nothing yet: icon, heading, a sentence and an optional action. */
export function EmptyState({ icon = "clipboard-list", ...props }: StateProps & { icon?: IconName }) {
  return <State icon={icon} tone="muted" {...props} />;
}

/** Shown where something failed to load. Announced when it appears; offer a way to try again. */
export function ErrorState({ icon = "alert-triangle", ...props }: StateProps & { icon?: IconName }) {
  return <State icon={icon} tone="danger" role="alert" {...props} />;
}

/** A grey placeholder in the shape of content that is loading. Size it with classes; use inside `Loading`. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-skeleton="" className={cn("h-4 rounded-xs bg-press motion-safe:animate-pulse", className)} {...props} />;
}

/**
 * A region that is loading: screen readers hear `label` (e.g. "Loading Work
 * Items") instead of the skeletons inside, which are hidden from them.
 */
export function Loading({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={className}>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}
