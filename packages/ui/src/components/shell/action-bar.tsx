"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Inside AppShell: its bottom action bar while it shows one (a phone), else null (a tablet or desktop, and the
 * server's render, which can't tell). Null outside AppShell, where the action always stays where it is.
 */
export const ActionBarContext = createContext<{ bar: HTMLElement | null } | null>(null);

/**
 * A page's primary action (RP-1272): where it is, on a tablet or desktop (e.g. the page header's end); on a
 * phone, in the bar stuck to the bottom of the screen, full width, above Safari's toolbar. Pages fill it;
 * AppShell owns the bar.
 */
export function PrimaryAction({ children }: { children: ReactNode }) {
  const shell = useContext(ActionBarContext);
  // Nothing to show: no bar that is filled but empty.
  if (children === null || children === undefined || children === false) return null;
  if (shell?.bar) return createPortal(<div className="flex [&>*]:flex-1">{children}</div>, shell.bar);
  // In the shell, a phone shows it only in the bar: hidden where it is until the bar takes it, so it doesn't paint
  // in place first and then jump (the server's render can't tell a phone).
  if (shell) return <span className="contents phone:hidden">{children}</span>;
  return children;
}
