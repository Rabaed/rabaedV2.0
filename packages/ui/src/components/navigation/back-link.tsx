"use client";

import type { ElementType, MouseEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";

// The way back from an inner page (RP-1241, the owner's grill of 2026-11-07): "← Back" at the top
// start of the page, above its title. When the page before, in this tab, was inside Rabaed, it goes
// back in the tab's history (so a List comes back as it was left); otherwise (a link from an email
// or a notification, a new tab) it goes to the page's fixed parent. It is a real link to that
// parent, so middle-click, ctrl-click and the keyboard's "open in new tab" open the parent. One
// component, so a breadcrumb can replace it later in one place.

/** The parts of a click that decide where the link goes. */
export type BackClick = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };

/**
 * Where a click on the Back link goes: back in history only on a plain left-click when the page
 * before (`previous`, the tab's previous history entry, or null when there is none) has this
 * page's `origin`; the fixed parent otherwise.
 */
export function backLinkGoes(click: BackClick, previous: string | null, origin: string): "history" | "parent" {
  const plain = click.button === 0 && !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey && !click.defaultPrevented;
  if (!plain || previous === null) return "parent";
  try {
    return new URL(previous).origin === origin ? "history" : "parent";
  } catch {
    return "parent";
  }
}

/** The part of the browser's Navigation API the link reads. */
export type NavigationLike = { currentEntry: { index: number } | null; entries: () => { url: string | null }[] };

/**
 * The URL of the tab's previous history entry, or null when there is none. The Navigation API
 * lists only this origin's entries in this tab; without it (an older browser) the link goes to its
 * parent, which never leaves Rabaed.
 */
export function previousEntryOf(navigation: NavigationLike | undefined): string | null {
  const index = navigation?.currentEntry?.index ?? 0;
  return navigation && index > 0 ? (navigation.entries()[index - 1]?.url ?? null) : null;
}

/** The browser's previous history entry in this tab (see `previousEntryOf`). */
export function previousHistoryEntry(): string | null {
  return typeof window === "undefined" ? null : previousEntryOf((window as { navigation?: NavigationLike }).navigation);
}

export type BackLinkProps = {
  /** The page's fixed parent, e.g. its Project's Module List. */
  href: string;
  /** "Back". */
  label: string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  /** The tab's previous history entry. Defaults to the Navigation API's. */
  previousEntry?: () => string | null;
  /** Goes back one entry. Defaults to `history.back()`. */
  goBack?: () => void;
  /** The arrow alone, `label` its name and tooltip: a full-screen tool's bar, such as the Workflow builder's. */
  iconOnly?: boolean;
  className?: string;
};

/** "← Back" above an inner page's title: back in this tab's history inside Rabaed, else to `href`. */
export function BackLink({
  href,
  label,
  linkAs: Link = "a",
  previousEntry = previousHistoryEntry,
  goBack = () => window.history.back(),
  iconOnly = false,
  className,
}: BackLinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (backLinkGoes(event, previousEntry(), window.location.origin) !== "history") return;
    event.preventDefault();
    goBack();
  };
  return (
    <Link
      href={href}
      onClick={onClick}
      {...(iconOnly && { "aria-label": label, title: label })}
      className={cn(
        iconOnly
          ? "inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-on-ghost hover:bg-ghost-hover"
          : "inline-flex w-fit items-center gap-1 rounded-xs text-[13px] font-medium text-muted hover:text-text hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        focusRing,
        className,
      )}
    >
      {/* Points back: left in English, right in Arabic. */}
      <Icon name="arrow-left" size={iconOnly ? 16 : 14} />
      {!iconOnly && <span>{label}</span>}
    </Link>
  );
}
