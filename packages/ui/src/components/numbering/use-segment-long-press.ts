"use client";

import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

// Reordering the pattern's segments with a finger (RP-1288, Responsive Anatomy 18: "segments as vertical
// cards, long-press to reorder"). A press held still for 300 ms lifts the segment; the finger then carries
// it over the others, and it moves as it passes each one. A finger that moves first scrolls the page as
// usual. Only touch: a mouse drags with the browser's own drag and drop, and the keyboard uses the handle.

/** How long a finger rests on a segment before it lifts. */
export const LONG_PRESS_MS = 300;
/** How far a finger may move during the press and still lift the segment; further, it is scrolling. */
const SLOP = 10;

type Handlers = {
  /** The segment at `index` lifted. */
  onLift: (index: number) => void;
  /** The finger is over the segment at `index` (null: over none). */
  onOver: (index: number | null) => void;
  /** The finger let go (`cancelled`: the browser took the gesture over). */
  onDrop: (cancelled: boolean) => void;
};

/** The index of the segment card under a point, from its `data-segment-index`. */
function segmentAt(x: number, y: number): number | null {
  const card = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-segment-index]");
  return card ? Number(card.dataset.segmentIndex) : null;
}

/**
 * Spread `pressProps(index)` on each segment card that may move. `pressing()` says whether a finger is on
 * one now, so the browser's own drag can be refused meanwhile.
 */
export function useSegmentLongPress(handlers: Handlers) {
  // The latest handlers, before the next paint: a finger's next move may come before a passive effect runs.
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const end = () => {
    cleanup.current?.();
    cleanup.current = null;
  };

  const pressProps = (index: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      // A press on the card's own fields and its remove button is for them; the handle may lift it.
      if ((event.target as Element).closest("input, select, button:not([data-segment-grip])")) return;
      end();
      const pointerId = event.pointerId;
      const start = { x: event.clientX, y: event.clientY };
      let lifted = false;
      const timer = setTimeout(() => {
        lifted = true;
        latest.current.onLift(index);
      }, LONG_PRESS_MS);
      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (!lifted) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) end();
          return;
        }
        latest.current.onOver(segmentAt(e.clientX, e.clientY));
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (lifted) {
          latest.current.onDrop(false);
          // The click a finger may still send as it lets go is no tap: it opens no handle's menu.
          const swallow = (click: MouseEvent) => {
            if (!(click.target instanceof Element && click.target.closest("[data-segment-index]"))) return;
            click.preventDefault();
            click.stopPropagation();
            window.removeEventListener("click", swallow, { capture: true });
          };
          window.addEventListener("click", swallow, { capture: true });
          setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
        }
        end();
      };
      const onCancel = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (lifted) latest.current.onDrop(true);
        end();
      };
      // While a segment is lifted the finger carries it, so the page must not scroll under it.
      const onTouchMove = (e: TouchEvent) => {
        if (lifted && e.cancelable) e.preventDefault();
      };
      // A long press would otherwise open the browser's own menu.
      const onContextMenu = (e: Event) => e.preventDefault();
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("contextmenu", onContextMenu);
      cleanup.current = () => {
        clearTimeout(timer);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("contextmenu", onContextMenu);
      };
    },
  });

  return { pressProps, pressing: () => cleanup.current !== null };
}
