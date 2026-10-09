import { Fragment, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import type { NumberPart, SegmentKind } from "./numbering-model.ts";

/**
 * The Numbering page's words: the app's `numbering.page` messages, looked up by key
 * (next-intl's `useTranslations("numbering.page")`). A placeholder given as itself
 * (`{ a: "{a}" }`) comes back as written, for `rich` to put an element in its place.
 */
export type NumberingText = (key: string, values?: Record<string, string | number>) => string;

/** A message with elements in place of its placeholders, e.g. a code chip inside a sentence. */
export function rich(t: NumberingText, key: string, parts: Record<string, ReactNode>, values: Record<string, string | number> = {}): ReactNode {
  const marked = Object.fromEntries(Object.keys(parts).map((name) => [name, `{${name}}`]));
  const text = t(key, { ...values, ...marked });
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <Fragment key={i}>{name !== undefined && name in parts ? parts[name] : piece}</Fragment>;
  });
}

/** Each segment kind's colour classes: its tint, the text on it, and its solid mark. */
export const toneClasses: Record<SegmentKind | "sequence", { tint: string; fg: string; solid: string }> = {
  project: { tint: "bg-segment-project-tint", fg: "text-segment-project-fg", solid: "bg-segment-project-solid" },
  participant: { tint: "bg-segment-participant-tint", fg: "text-segment-participant-fg", solid: "bg-segment-participant-solid" },
  trade: { tint: "bg-segment-trade-tint", fg: "text-segment-trade-fg", solid: "bg-segment-trade-solid" },
  type: { tint: "bg-segment-type-tint", fg: "text-segment-type-fg", solid: "bg-segment-type-solid" },
  location: { tint: "bg-segment-location-tint", fg: "text-segment-location-fg", solid: "bg-segment-location-solid" },
  text: { tint: "bg-segment-text-tint", fg: "text-segment-text-fg", solid: "bg-segment-text-solid" },
  sequence: { tint: "bg-segment-sequence-tint", fg: "text-segment-sequence-fg", solid: "bg-segment-sequence-solid" },
};

/** A code that reads left to right inside either language, e.g. `…EL…-001`. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" translate="no" className={cn("rounded-xs bg-press px-1.5 font-semibold text-text tabular-nums", className)}>
      {children}
    </bdi>
  );
}

export type PatternNumberProps = {
  parts: NumberPart[];
  separator: string;
  /** The big preview number; otherwise it sizes with the surrounding text. */
  size?: "lg" | "md" | "inherit";
  className?: string;
};

/**
 * A Document Number with each segment on its own colour. Always left to right, the
 * whole number one isolated unit; read as one string by assistive technology.
 */
export function PatternNumber({ parts, separator, size = "inherit", className }: PatternNumberProps) {
  return (
    <bdi
      dir="ltr"
      translate="no"
      className={cn(
        "flex flex-wrap items-baseline font-bold break-all tabular-nums rtl:justify-end",
        size === "lg" && "text-[34px] leading-[1.2] tracking-[0.01em]",
        size === "md" && "text-h4 leading-[1.2]",
        className,
      )}
      data-testid="pattern-number"
    >
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="px-px text-muted">{separator}</span>}
          <span className={cn("rounded-[6px] px-[3px]", toneClasses[part.kind].tint, toneClasses[part.kind].fg)}>
            {part.text}
          </span>
        </Fragment>
      ))}
    </bdi>
  );
}
