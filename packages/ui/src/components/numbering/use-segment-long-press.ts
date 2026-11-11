"use client";

import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

// Reordering the pattern's segments with a finger (RP-1288, Responsive Anatomy 18: "segments as vertical
// cards, long-press to reorder"). A press held still for 300 ms lifts the segment; the finger then carries
// it over the others, and it moves once the finger passes the middle of the next one. A finger that moves
// first scrolls the page as usual. Only touch: a mouse drags with the browser's own drag and drop, the
// keyboard uses the handle's arrow keys, and a tap on the handle opens its moves.

/** How long a finger rests on a segment before it lifts. */
export const LONG_PRESS_MS = 300;
/** How far a finger may move during the press and still lift the segment; further, it is scrolling. */
const SLOP = 10;

type Handlers = {
  /** The segment at `index` lifted. */
  onLift: (index: number) => void;
  /** The finger is at (x, y), over the segment card `over` (null: over none). */
  onOver: (over: { index: number; card: HTMLElement } | null, x: number, y: number) => void;
  /** The finger let go (`cancelled`: the browser took the gesture over). */
  onDrop: (cancelled: boolean) => void;
};

/** The segment card under a point, by its `data-segment-index`. */
function segmentAt(x: number, y: number) {
  const card = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-segment-index]");
  return card ? { index: Number(card.dataset.segmentIndex), card } : null;
}

/**
 * Put `listRef` on the list of segment cards and spread `pressProps(index)` on each card that may move.
 * `pressing()` says whether a finger is on one now, so the browser's own drag can be refused meanwhile.
 */
export function useSegmentLongPress(handlers: Handlers) {
  // The latest handlers, before the next paint: a finger's next move may come before a passive effect runs.
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const cleanup = useRef<(() => void) | null>(null);
  const lifted = useRef(false);
  const list = useRef<HTMLOListElement | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  // While a segment is lifted the finger carries it, so the page must not scroll under it. The browser
  // decides as a touch starts whether its moves can be stopped, so the listener is there before any press.
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const onTouchMove = (e: TouchEvent) => {
      if (lifted.current && e.cancelable) e.preventDefault();
    };
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => element.removeEventListener("touchmove", onTouchMove);
  }, []);

  const end = () => {
    cleanup.current?.();
    cleanup.current = null;
    lifted.current = false;
  };

  const pressProps = (index: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      // A press on the card's own fields and its remove button is for them; the handle may lift it.
      if ((event.target as Element).closest("input, select, button:not([data-segment-grip])")) return;
      end();
      const pointerId = event.pointerId;
      const start = { x: event.clientX, y: event.clientY };
      const timer = setTimeout(() => {
        lifted.current = true;
        latest.current.onLift(index);
      }, LONG_PRESS_MS);
      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (!lifted.current) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) end();
          return;
        }
        latest.current.onOver(segmentAt(e.clientX, e.clientY), e.clientX, e.clientY);
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (lifted.current) {
          latest.current.onDrop(false);
          swallowNextClick();
        }
        end();
      };
      const onCancel = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (lifted.current) latest.current.onDrop(true);
        end();
      };
      // A long press would otherwise open the browser's own menu.
      const onContextMenu = (e: Event) => e.preventDefault();
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      document.addEventListener("contextmenu", onContextMenu);
      cleanup.current = () => {
        clearTimeout(timer);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("contextmenu", onContextMenu);
      };
    },
  });

  return { listRef: list, pressProps, pressing: () => cleanup.current !== null };
}

/**
 * The click a finger may still send as it lets go of a carried segment is no tap: it opens no handle's menu.
 * Only that one: the next press, or 400 ms, ends the wait, so a real tap afterwards is the person's.
 */
function swallowNextClick() {
  const swallow = (click: MouseEvent) => {
    if (!(click.target instanceof Element && click.target.closest("[data-segment-index]"))) return;
    click.preventDefault();
    click.stopPropagation();
    stop();
  };
  const stop = () => {
    clearTimeout(timer);
    window.removeEventListener("click", swallow, { capture: true });
    window.removeEventListener("pointerdown", stop, { capture: true });
  };
  const timer = setTimeout(stop, 400);
  window.addEventListener("click", swallow, { capture: true });
  window.addEventListener("pointerdown", stop, { capture: true });
}
