"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";

export type ModalContentProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  /** Names the dialog; shown as its heading. */
  title: ReactNode;
  /** Describes the dialog; shown under the heading. */
  description?: ReactNode;
  /** The close button's accessible name, e.g. "Close" / "إغلاق". */
  closeLabel: string;
  /** Classes for the close button, e.g. its colours on a dark panel (the phone's navigation). */
  closeClassName?: string;
};

/**
 * The panel shared by Dialog and Sheet: backdrop, heading, description and
 * close button. Radix traps focus inside, closes on Escape and returns focus
 * to the trigger.
 */
export function ModalContent({
  title,
  description,
  closeLabel,
  closeClassName,
  className,
  children,
  ...props
}: ModalContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <DialogPrimitive.Content
        // Without a description, don't point aria-describedby at nothing.
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn("fixed z-50 flex flex-col gap-4 bg-surface p-6 text-text shadow-lg focus-visible:outline-none", className)}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="font-display text-h5 font-semibold">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="text-body text-muted">{description}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close asChild>
            <IconButton label={closeLabel} size="sm" className={cn("-me-2 -mt-1", closeClassName)}>
              <Icon name="x" />
            </IconButton>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** The action row at the bottom of a Dialog or Sheet: actions at the end, primary last. */
export function ModalFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-2 flex flex-wrap justify-end gap-2", className)} {...props} />;
}
