import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon, type IconName } from "../icon/icon.tsx";

export type StateProps = {
  title: ReactNode;
  /** One or two sentences: what this means and what to do. Never deadline language. */
  children?: ReactNode;
  /** An optional button, e.g. "Create a Submittal" or "Try again". */
  action?: ReactNode;
  className?: string;
};

type StateLayoutProps = StateProps & { icon: IconName; tone: "muted" | "danger"; role?: "alert" };

function State({ icon, tone, role, title, children, action, className }: StateLayoutProps) {
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

export type EmptyStateProps = StateProps & { icon?: IconName };

/** Shown where a list or page has nothing yet: icon, heading, a sentence and an optional action. */
export function EmptyState({ icon = "clipboard-list", ...props }: EmptyStateProps) {
  return <State icon={icon} tone="muted" {...props} />;
}

export type ErrorStateProps = StateProps & { icon?: IconName };

/**
 * Shown where something failed to load, in place of the content (or its
 * Loading state); `role="alert"` makes screen readers read it as it appears.
 * Offer a way to try again.
 */
export function ErrorState({ icon = "alert-triangle", ...props }: ErrorStateProps) {
  return <State icon={icon} tone="danger" role="alert" {...props} />;
}

/** A grey placeholder in the shape of content that is loading. Size it with classes; use inside `Loading`. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-skeleton="" className={cn("h-4 rounded-xs bg-press motion-safe:animate-pulse", className)} {...props} />;
}

export type LoadingProps = {
  /** What is loading, e.g. "Loading Work Items"; read by screen readers. */
  label: string;
  className?: string;
  /** Skeletons in the shape of the content; hidden from screen readers. */
  children: ReactNode;
};

/** A region that is loading: screen readers get `label` (as the status text and name) instead of the skeletons. */
export function Loading({ label, className, children }: LoadingProps) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}
