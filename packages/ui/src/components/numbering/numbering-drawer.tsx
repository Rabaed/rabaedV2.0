"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";

// The Numbering page's side drawer (kit settings/numbering.css `.drawer`): a bar
// with a Type code, title and a line under it; a scrolling body of cards on the
// canvas; a bar of actions. Radix Dialog underneath, as Sheet: focus stays inside,
// Escape closes it, and focus goes back to the button that opened it. Its own
// layout because the kit's header and footer bars differ from Sheet's.

export type NumberingDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Work Item Type's code in front of the title, when the drawer is about one Type. */
  code?: string;
  title: ReactNode;
  description?: ReactNode;
  closeLabel: string;
  /** The cards. */
  children: ReactNode;
  /** The action bar; a `flex-1` spacer splits it. */
  footer?: ReactNode;
  testId?: string;
};

/** A drawer from the inline-end side, 620px wide, the whole width on a phone. */
export function NumberingDrawer({ open, onOpenChange, code, title, description, closeLabel, children, footer, testId }: NumberingDrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <DialogPrimitive.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[620px] flex-col bg-canvas text-text shadow-lg focus-visible:outline-none"
          data-testid={testId}
        >
          <div className="flex items-center gap-3 border-b border-border bg-surface px-5 py-4">
            {code !== undefined && <TypeCode code={code} className="h-[22px] px-[7px] text-notes" />}
            <div className="flex min-w-0 flex-col gap-0.5">
              <DialogPrimitive.Title className="text-lg font-bold text-text">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="text-[12.5px] text-muted">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label={closeLabel} className="ms-auto">
                <Icon name="x" />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className="flex flex-1 flex-col gap-[14px] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export type NumberingModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  testId?: string;
};

/** The save confirmation (kit `.modal`): an amber warning tile, the heading and body, and a grey action bar. */
export function NumberingModal({ open, onOpenChange, title, description, children, footer, testId }: NumberingModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100%-2rem))] flex-col overflow-hidden rounded-lg bg-surface text-text shadow-lg focus-visible:outline-none"
          data-testid={testId}
        >
          <div className="flex flex-col gap-[14px] overflow-y-auto px-6 py-[22px]">
            <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-md bg-warning-tint text-segment-location-solid">
              <Icon name="alert-triangle" size={22} />
            </span>
            <DialogPrimitive.Title className="font-display text-h6 font-bold text-text">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[13.5px] leading-normal text-muted">{description}</DialogPrimitive.Description>
            {children}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border-subtle bg-surface-subtle px-6 py-3">{footer}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A Work Item Type's code in its outlined chip (kit `.doc`). */
export function TypeCode({ code, className }: { code: string; className?: string }) {
  return (
    <bdi
      dir="ltr"
      translate="no"
      className={cn("inline-flex h-5 shrink-0 items-center rounded-xs px-1.5 text-[10.5px] font-bold text-muted shadow-[inset_0_0_0_1px_var(--border-strong)]", className)}
    >
      {code}
    </bdi>
  );
}
