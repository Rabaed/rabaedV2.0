"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { forwardRef, type ComponentProps, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { useMediaQuery } from "../../lib/use-media-query.ts";
import { Button, IconButton, buttonVariants } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";

/** Under this width the bell opens a full-screen sheet instead of a dropdown (the design's phone, 402 px). */
export const notificationSheetQuery = "(max-width: 559px)";

export type NotificationMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bell's name: "Notifications", or "Notifications · 3 unread". */
  label: string;
  /** Unread notifications, on the bell's badge (99+ above 99); none at 0. */
  count: number;
  /** "Notifications", the dropdown's heading and name. */
  title: string;
  /** "3 new" beside the heading; null hides it. */
  newLabel: string | null;
  markAll: { label: string; disabled: boolean; onClick: () => void };
  settings: { href: string; label: string };
  viewAll: { href: string; label: string };
  /** The sheet's close button's name. */
  closeLabel: string;
  /** The app's link component (Next's `Link`); a plain `a` by default. */
  linkAs?: ElementType;
  /** The latest notifications (NotificationRow, layout `menu`), or NotificationEmpty. */
  children: ReactNode;
};

const BellButton = forwardRef<HTMLButtonElement, ComponentProps<"button"> & { label: string; count: number }>(function BellButton(
  { label, count, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex size-10 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-hover aria-expanded:bg-canvas pointer-coarse:size-11",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className,
      )}
      {...props}
    >
      <Icon name="bell" />
      {count > 0 && (
        <span aria-hidden="true" className="absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-semibold text-on-primary">
          <bdi dir="ltr">{count > 99 ? "99+" : count}</bdi>
        </span>
      )}
    </button>
  );
});

/**
 * The bell and what it opens (RP-1153, the owner's design `.ndd` and `.nsh`): from 560 px a
 * 420 px dropdown under it, at the end side; on a phone a full-screen sheet. Each has the
 * heading with the count of new ones, Mark all as read and the settings gear, the latest
 * notifications, and View all. Escape or a click outside closes it, and focus goes back to the bell.
 */
export function NotificationMenu(props: NotificationMenuProps) {
  const sheet = useMediaQuery(notificationSheetQuery, false);
  const { open, onOpenChange, label, count, title } = props;
  if (sheet)
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Trigger asChild>
          <BellButton label={label} count={count} />
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content aria-describedby={undefined} className="fixed inset-0 z-50 flex flex-col bg-surface text-text focus-visible:outline-none">
            <Header {...props} sheet titleAs={DialogPrimitive.Title} />
            <List>{props.children}</List>
            <div className="grid grid-cols-2 gap-2 border-t border-border-subtle bg-surface-subtle px-3 pt-3 pb-7">
              <Button variant="secondary" disabled={props.markAll.disabled} onClick={props.markAll.onClick}>
                {props.markAll.label}
              </Button>
              <ViewAll {...props} />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <BellButton label={label} count={count} />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          aria-label={title}
          align="end"
          sideOffset={10}
          className="z-50 flex max-h-[min(640px,calc(100vh-6rem))] w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[14px] border border-menu-border bg-surface text-text shadow-lg focus-visible:outline-none"
        >
          <Header {...props} sheet={false} titleAs="b" />
          <List>{props.children}</List>
          <div className="flex items-center justify-end border-t border-border-subtle bg-surface-subtle px-3 py-2.5">
            <ViewAll {...props} small />
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function Header({ title, newLabel, markAll, settings, closeLabel, linkAs: Link = "a", sheet, titleAs: Title }: NotificationMenuProps & { sheet: boolean; titleAs: ElementType }) {
  return (
    <div className={cn("flex items-center gap-2", sheet ? "border-b border-border-subtle px-3 pt-4 pb-3" : "px-4 pt-[14px] pb-2.5")}>
      <Title className={cn("m-0 font-bold", sheet ? "text-[20px]" : "text-[15px]")}>{title}</Title>
      {newLabel && <span className="rounded-lg bg-brand-tint px-[7px] py-0.5 text-[11.5px] font-bold text-brand-fg">{newLabel}</span>}
      <span className="flex-1" />
      {!sheet && (
        <Button variant="ghost" size="sm" disabled={markAll.disabled} onClick={markAll.onClick}>
          {markAll.label}
        </Button>
      )}
      <Link href={settings.href} aria-label={settings.label} title={settings.label} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-8 px-0 pointer-coarse:min-w-11")}>
        <Icon name="settings" />
      </Link>
      {sheet && (
        <DialogPrimitive.Close asChild>
          <IconButton label={closeLabel} size="sm">
            <Icon name="x" />
          </IconButton>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function List({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-auto border-t border-border-subtle">{children}</div>;
}

function ViewAll({ viewAll, linkAs: Link = "a", small = false }: NotificationMenuProps & { small?: boolean }) {
  return (
    <Link href={viewAll.href} className={buttonVariants({ variant: "primary", size: small ? "sm" : "md" })}>
      {viewAll.label}
      <Icon name="arrow-right" />
    </Link>
  );
}
