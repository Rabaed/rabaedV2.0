"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Inside AppShell: its bottom action bar while it shows one (a phone), else null (a tablet or desktop, and the
 * server's render, which can't tell). Null outside AppShell, where the action always stays where it is.
 */
export const ActionBarContext = createContext<{ bar: HTMLElement | null } | null>(null);

// Nothing to listen to: whether this render is past hydration never changes after it.
const neverChanges = () => () => {};

/**
 * A page's primary action (RP-1272): where it is, on a tablet or desktop (e.g. the page header's end); on a
 * phone, in the bar stuck to the bottom of the screen, full width, above Safari's toolbar. Pages fill it;
 * AppShell owns the bar.
 *
 * The action is mounted once and its node moves between the two places, so crossing the phone width (a tablet
 * turned) keeps its state: a dialog it opened stays open with what was typed (RP-1290).
 */
export function PrimaryAction({ children }: { children: ReactNode }) {
  const shell = useContext(ActionBarContext);
  const bar = shell?.bar ?? null;
  // Nothing to show: no bar that is filled but empty.
  const show = children !== null && children !== undefined && children !== false;
  // False on the server and while hydrating its markup, which has the action in place; true after, and on the client.
  const hydrated = useSyncExternalStore(neverChanges, () => true, () => false);
  // The node the action is portalled into, made once in the shell: React keeps the action mounted however the node moves.
  const [box] = useState(() => (shell === null || typeof document === "undefined" ? null : document.createElement("div")));
  const place = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!box) return;
    const target = show ? (bar ?? place.current) : null;
    if (!target) return void box.remove();
    box.className = bar ? "flex [&>*]:flex-1" : "contents";
    if (box.parentNode === target) return;
    // Moving a node drops its focus: give it back where the action now is.
    const focused = box.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    target.append(box);
    focused?.focus({ preventScroll: true });
    // `hydrated` too: the place only has its ref once the portal replaces the server's markup.
  }, [box, bar, show, hydrated]);
  useLayoutEffect(() => () => box?.remove(), [box]);

  if (!show) return null;
  if (!shell) return children;
  // In the shell, a phone shows it only in the bar: hidden where it is until the bar takes it, so it doesn't paint
  // in place first and then jump (the server's render can't tell a phone).
  if (!hydrated || !box) return <span className="contents phone:hidden">{children}</span>;
  return (
    <span ref={place} className="contents phone:hidden">
      {createPortal(children, box)}
    </span>
  );
}
