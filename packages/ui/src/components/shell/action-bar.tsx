"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The phone's bottom action bar, while AppShell shows one (a phone); null on a tablet or desktop, or outside AppShell. */
export const ActionBarContext = createContext<HTMLElement | null>(null);

/**
 * A page's primary action (RP-1272): where it is, on a tablet or desktop (e.g. the page header's end); on a
 * phone, in the bar stuck to the bottom of the screen, full width, above Safari's toolbar. Pages fill it;
 * AppShell owns the bar.
 */
export function PrimaryAction({ children }: { children: ReactNode }) {
  const bar = useContext(ActionBarContext);
  if (bar === null) return children;
  return createPortal(<div className="flex [&>*]:flex-1">{children}</div>, bar);
}
