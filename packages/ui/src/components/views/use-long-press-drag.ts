"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

// Dragging a card with a finger (RP-1274, RP-1158 row 53, the owner's (a)): a press held still for
// 300 ms lifts the card; the finger then carries it, and the board scrolls sideways while the finger is
// within 64 px of its edge. A finger that moves first scrolls as usual, and a tap opens the card. Only
// touch: a mouse drags with the browser's own drag and drop. The rest of touch drag waits for its design.

/** How long a finger rests on a card before it lifts. */
export const LONG_PRESS_MS = 300;
/** How far a finger may move during the press and still lift the card; further, it is scrolling. */
const SLOP = 10;
/** The band along the board's start and end edges where a lifted card scrolls the board. */
const EDGE = 64;
/** The board's fastest scroll, at the very edge, in px a frame. */
const SPEED = 14;

export type LongPressDragOptions<T> = {
  /** The board's region, scrolled at its edges. */
  region: RefObject<HTMLElement | null>;
  /** The card lifted. */
  onLift: (payload: T) => void;
  /** The finger moved over another element; the board finds the column under it. */
  onOver: (under: Element | null) => void;
  /** The finger lifted over `under` (null: the drag was cut off). */
  onDrop: (under: Element | null) => void;
};

type Press<T> = {
  payload: T;
  pointerId: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  lifted: boolean;
  frame: number | undefined;
  /** Sideways speed while the finger is in an edge band, px a frame. */
  speed: number;
  cleanup: () => void;
};

/**
 * Lifts a card on a long touch press. Spread `pressProps(payload)` on each card that may move; `lifted()`
 * says whether a finger is carrying one now (so the browser's own drag can be refused meanwhile).
 */
export function useLongPressDrag<T>({ region, onLift, onOver, onDrop }: LongPressDragOptions<T>) {
  const press = useRef<Press<T> | null>(null);
  // The latest handlers, so a press that started before a render still calls the current ones.
  const handlers = useRef({ onLift, onOver, onDrop });
  useEffect(() => {
    handlers.current = { onLift, onOver, onDrop };
  });

  useEffect(() => () => press.current?.cleanup(), []);

  const end = () => {
    const current = press.current;
    press.current = null;
    current?.cleanup();
  };

  const scrollAtEdges = (p: Press<T>) => {
    const step = () => {
      const board = region.current;
      if (!board || p.speed === 0 || press.current !== p) {
        p.frame = undefined;
        return;
      }
      board.scrollBy({ left: p.speed, behavior: "instant" });
      handlers.current.onOver(document.elementFromPoint(p.x, p.y));
      p.frame = requestAnimationFrame(step);
    };
    if (p.frame === undefined && p.speed !== 0) p.frame = requestAnimationFrame(step);
  };

  const edgeSpeed = (x: number) => {
    const board = region.current?.getBoundingClientRect();
    if (!board) return 0;
    const fromStart = x - board.left;
    const fromEnd = board.right - x;
    if (fromStart < EDGE) return -Math.ceil(((EDGE - Math.max(fromStart, 0)) / EDGE) * SPEED);
    if (fromEnd < EDGE) return Math.ceil(((EDGE - Math.max(fromEnd, 0)) / EDGE) * SPEED);
    return 0;
  };

  const pressProps = (payload: T) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      // A press on the card's own controls (its ✥ button, its Package chip) is for them, not a drag.
      if ((event.target as Element).closest("button, [data-package-chip]")) return;
      const card = event.currentTarget;
      end();
      const p: Press<T> = {
        payload,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: undefined,
        lifted: false,
        frame: undefined,
        speed: 0,
        cleanup: () => undefined,
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== p.pointerId) return;
        if (!p.lifted) {
          // Moved before the press lifted the card: the finger is scrolling.
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) end();
          return;
        }
        p.x = e.clientX;
        p.y = e.clientY;
        handlers.current.onOver(document.elementFromPoint(p.x, p.y));
        p.speed = edgeSpeed(p.x);
        scrollAtEdges(p);
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== p.pointerId) return;
        if (p.lifted) {
          handlers.current.onDrop(document.elementFromPoint(e.clientX, e.clientY));
          // The click a lifted finger may still send on the card opens nothing; a tap elsewhere is the person's.
          const swallow = (click: MouseEvent) => {
            if (!(click.target instanceof Node && card.contains(click.target))) return;
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
        if (e.pointerId !== p.pointerId) return;
        if (p.lifted) handlers.current.onDrop(null);
        end();
      };
      // While the card is lifted the finger carries it, so the page must not scroll under it.
      const onTouchMove = (e: TouchEvent) => {
        if (p.lifted && e.cancelable) e.preventDefault();
      };
      // A long press would otherwise open the link's menu.
      const onContextMenu = (e: Event) => e.preventDefault();
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("contextmenu", onContextMenu);
      p.cleanup = () => {
        clearTimeout(p.timer);
        if (p.frame !== undefined) cancelAnimationFrame(p.frame);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("contextmenu", onContextMenu);
      };
      p.timer = setTimeout(() => {
        p.lifted = true;
        handlers.current.onLift(payload);
        handlers.current.onOver(document.elementFromPoint(p.x, p.y));
      }, LONG_PRESS_MS);
      press.current = p;
    },
  });

  return { pressProps, lifted: () => press.current?.lifted === true };
}
