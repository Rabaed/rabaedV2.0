"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";

// The full screen a photo opens in (RP-656), for the viewer and the annotate
// view: dark, edge to edge, a bar with Close, the title and the screen's own
// actions, and the photo and its controls below.

/** A button on the screen's dark bar. */
export const onBar = "text-on-inverse hover:bg-on-inverse/10 active:bg-on-inverse/20 disabled:bg-transparent disabled:text-on-inverse/40";

export type PhotoScreenProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The close button's name: "Close", or "Cancel" where closing drops work. */
  closeLabel: string;
  /** While saving, the screen can't be closed. */
  locked?: boolean;
  /** At the end of the bar. */
  actions?: ReactNode;
  /**
   * Where the screen mounts: inside a modal <dialog> (the Transition pop-up) it must mount in it,
   * since in <body> it would sit under the dialog's top layer, hidden and unclickable (as Select, RP-658).
   */
  container?: HTMLElement | null;
  children: ReactNode;
};

export function PhotoScreen({ open, onOpenChange, title, closeLabel, locked = false, actions, container, children }: PhotoScreenProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !locked && onOpenChange(next)}>
      <DialogPrimitive.Portal container={container ?? undefined}>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex h-dvh flex-col bg-inverse text-on-inverse focus-visible:outline-none"
        >
          <header className="flex items-center gap-2 p-2">
            <DialogPrimitive.Close asChild>
              <IconButton label={closeLabel} disabled={locked} className={onBar}>
                <Icon name="x" />
              </IconButton>
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-body font-semibold">{title}</DialogPrimitive.Title>
            {actions}
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
