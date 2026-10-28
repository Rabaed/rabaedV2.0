"use client";

import { formatNumber, type Locale } from "@rabaed/domain";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import {
  submittalPanelAvailableWidth,
  submittalPanelBandOf,
  submittalPanelDragWidth,
  submittalPanelSizeOf,
  submittalPanelSizes,
  submittalPanelToggledWidth,
  submittalPanelWidthOf,
  type SubmittalPanelSize,
  type SubmittalPanelWidth,
} from "./panel-size.ts";

/**
 * Resizing the Submittal Panel (RP-1063, README §2): the size switch in its top bar and the drag
 * edge on its inline-start side. `useSubmittalPanelSize` holds the width; the panel takes its
 * `width` and `resizing`, `SubmittalPanelGrip` as its `edge` and `SubmittalPanelSizeSwitch` in
 * its `topBarEnd`. The layout bands follow from the panel's own width (`submittal-panel.css`).
 */

export type SubmittalPanelSizeLabels = {
  /** The size switch's name, e.g. "Size". */
  group: string;
  /** Each preset's name, which is also the layout band's: "Compact", "Normal", "Wide", "Full". */
  sizes: Record<SubmittalPanelSize, string>;
  /** The edge's tooltip, e.g. "Drag to resize · double-click to switch Normal and Wide". */
  grip: string;
};

export type SubmittalPanelSizeState = {
  /** The width chosen, as it is kept: px or "full". */
  chosen: SubmittalPanelWidth;
  /** The width drawn, in px: the chosen one, fitted to the room beside the sidebar. */
  width: number;
  /** The preset the chosen width is, or null for a width in between. */
  pressed: SubmittalPanelSize | null;
  /** The edge is being dragged. */
  dragging: boolean;
  /** No width transition: while dragging, and on the first paint. */
  resizing: boolean;
  choose: (width: SubmittalPanelWidth) => void;
  /** The edge's pointerdown. */
  startDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  /** The edge's double-click: Normal ↔ Wide. */
  toggle: () => void;
};

/** Where the app shell's sidebar is, so Full ends at its edge (`Sidebar`'s `data-sidebar`). */
const sidebarSelector = "[data-sidebar]";

/** Wider than any screen: the panel's own `min(…, 100vw)` holds it until the room is measured. */
const unmeasured = 100_000;

function viewportWidth(): number {
  return document.documentElement.clientWidth || window.innerWidth;
}

function roomFor(dir: "ltr" | "rtl"): number {
  const rect = document.querySelector(sidebarSelector)?.getBoundingClientRect();
  return submittalPanelAvailableWidth({ viewport: viewportWidth(), sidebar: rect && rect.width > 0 ? rect : null, dir });
}

/** The room changes with the window and with the sidebar folding. */
function watchRoom(onChange: () => void): () => void {
  addEventListener("resize", onChange);
  const sidebar = document.querySelector(sidebarSelector);
  const observer = sidebar && typeof ResizeObserver !== "undefined" ? new ResizeObserver(onChange) : null;
  if (sidebar) observer?.observe(sidebar);
  return () => {
    removeEventListener("resize", onChange);
    observer?.disconnect();
  };
}

/**
 * The panel's width: `initial` (the viewer's kept width, or what a link sets) until the viewer
 * chooses another, by the switch, the drag or a double-click. Each choice is handed to `onKeep`
 * once (a drag when it ends); a view a link sized passes none, so it never writes (README §2).
 */
export function useSubmittalPanelSize({
  initial,
  dir,
  onKeep,
}: {
  initial: SubmittalPanelWidth;
  dir: "ltr" | "rtl";
  onKeep?: (width: SubmittalPanelWidth) => void;
}): SubmittalPanelSizeState {
  const [picked, setPicked] = useState<SubmittalPanelWidth | null>(null);
  const [dragging, setDragging] = useState(false);
  const [settled, setSettled] = useState(false);
  const room = useSyncExternalStore(
    watchRoom,
    useCallback(() => roomFor(dir), [dir]),
    () => null,
  );
  const chosen = picked ?? initial;
  const width = submittalPanelWidthOf(chosen, room ?? unmeasured);

  const keepRef = useRef(onKeep);
  useEffect(() => {
    keepRef.current = onKeep;
  });

  // The first paint (and the width read once mounted) has no transition: two frames on, it has.
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setSettled(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // A drag still going when the panel closes stops with it.
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  const choose = (next: SubmittalPanelWidth) => {
    setPicked(next);
    keepRef.current?.(next);
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // No text selection and no native drag while the edge moves.
    event.preventDefault();
    let dragged: SubmittalPanelWidth | null = null;
    const move = (e: PointerEvent) => {
      dragged = submittalPanelDragWidth({ pointerX: e.clientX, viewport: viewportWidth(), available: roomFor(dir), dir });
      setPicked(dragged);
      setDragging(true);
    };
    const stop = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      document.documentElement.style.cursor = "";
      stopDrag.current = null;
    };
    const end = () => {
      stop();
      setDragging(false);
      // A press with no move (half of a double-click) changes nothing, so keeps nothing.
      if (dragged !== null) keepRef.current?.(dragged);
    };
    stopDrag.current?.();
    stopDrag.current = stop;
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
    document.documentElement.style.cursor = "col-resize";
  };

  return {
    chosen,
    width,
    pressed: submittalPanelSizeOf(chosen),
    dragging,
    resizing: dragging || !settled,
    choose,
    startDrag,
    toggle: () => choose(submittalPanelToggledWidth(width)),
  };
}

/**
 * The drag edge (README §2): a 14px strip on the panel's inline-start edge (the left in English,
 * the right in Arabic), with a pill of 3 dots and a 2px brand line on hover. While it is dragged, a
 * tooltip says the width and its preset, or the band it falls in ("700px · Normal"). Pointer
 * only: the size switch does the same from the keyboard, so the edge is hidden from assistive
 * technology.
 */
export function SubmittalPanelGrip({ size, locale, labels }: { size: SubmittalPanelSizeState; locale: Locale; labels: SubmittalPanelSizeLabels }) {
  const name = labels.sizes[size.pressed ?? submittalPanelBandOf(size.width)];
  return (
    <div aria-hidden="true" title={labels.grip} data-dragging={size.dragging || undefined} className="sdp-grip" onPointerDown={size.startDrag} onDoubleClick={size.toggle}>
      <span className="sdp-grip-pill">
        <b />
        <b />
        <b />
      </span>
      {size.dragging && (
        <span className="sdp-grip-tip">
          <bdi dir="ltr">{formatNumber(size.width, locale)}px</bdi> · {name}
        </span>
      )}
    </div>
  );
}

/**
 * The size switch (README §2): four buttons, each pressed when the panel is at its preset, with a
 * rectangle glyph whose inline-end part is filled; from 880px up they show their names too.
 */
export function SubmittalPanelSizeSwitch({ size, labels }: { size: SubmittalPanelSizeState; labels: SubmittalPanelSizeLabels }) {
  return (
    <span role="group" aria-label={labels.group} className="sdp-sizes inline-flex shrink-0 items-center rounded-[9px] bg-surface-subtle p-0.5 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
      {submittalPanelSizes.map((option) => {
        const name = labels.sizes[option.key];
        return (
          <button
            key={option.key}
            type="button"
            aria-label={name}
            aria-pressed={size.pressed === option.key}
            title={option.width === "full" ? name : `${name} · ${option.width}px`}
            onClick={() => size.choose(option.width)}
            className={cn(
              "sdp-size inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-[7px] px-2 text-[12px] font-semibold whitespace-nowrap text-muted",
              "transition-colors duration-150 hover:text-text pointer-coarse:min-h-11 pointer-coarse:min-w-11",
              "aria-pressed:bg-surface aria-pressed:text-text aria-pressed:shadow-[0_1px_2px_color-mix(in_srgb,var(--shadow-colour)_12%,transparent),inset_0_0_0_1px_var(--border-subtle)]",
              focusRing,
            )}
          >
            <span aria-hidden="true" className="sdp-size-glyph" style={{ "--sdp-fill": `${option.fill}%` } as CSSProperties} />
            <span className="sdp-size-text">{name}</span>
          </button>
        );
      })}
    </span>
  );
}
