"use client";

import { formatNumber, type BaseRole, type Locale } from "@rabaed/domain";
import { useId, type CSSProperties } from "react";
import { cn } from "../../lib/cn.ts";
import { Icon, type IconName } from "../icon/icon.tsx";
import { submittalRouteStopLine, type RouteStop, type RouteStopLine, type RouteStopState, type SubmittalRoute } from "./route-model.ts";

/** The route strip's words, in the viewer's language, from the app's messages. */
export type SubmittalRouteLabels = {
  /** A Project Role, e.g. "Owner" (never "Client", gap A4). */
  role: (role: BaseRole) => string;
  /** The stop another Company holds the item at, e.g. "With Design Consultants LLC" or "With Owner review". */
  withCompany: (company: string) => string;
  /** What the strip does, e.g. "View workflow". */
  open: string;
  /** The large strip's name, e.g. "Route". */
  route: string;
  /** A stop's state for assistive technology, e.g. "done". */
  state: (state: RouteStopState) => string;
  /** The large strip's line on the last stop, where the raiser receives the outcome. */
  outcome: string;
  /** The large strip's line on any other stop, e.g. "3 Steps". */
  steps: (count: number, formatted: string) => string;
};

/** A Project Role's icon and colours (README §4.4: Contractor orange, Consultant blue, Owner green), from the DS's semantic tones. */
const roleLook: Record<BaseRole, { icon: IconName; tint: string; fg: string }> = {
  contractor: { icon: "crane", tint: "var(--trade-su-bg)", fg: "var(--trade-su-fg)" },
  consultant: { icon: "ruler", tint: "var(--info-tint)", fg: "var(--info-fg)" },
  owner: { icon: "building", tint: "var(--success-tint)", fg: "var(--success-fg)" },
  owner_representative: { icon: "buildings", tint: "var(--stage-pending-bg)", fg: "var(--stage-pending-fg)" },
};

/** A Project Role's icon tile. */
export function RoleIcon({ role, size = 24, className }: { role: BaseRole; size?: number; className?: string }) {
  const look = roleLook[role];
  return (
    <span
      aria-hidden="true"
      className={cn("sdp-role inline-flex shrink-0 items-center justify-center rounded-[7px]", className)}
      style={{ width: size, height: size, background: look.tint, color: look.fg } satisfies CSSProperties}
    >
      <Icon name={look.icon} size={Math.round(size * 0.56)} />
    </span>
  );
}

export type SubmittalRouteStripProps = {
  locale: Locale;
  labels: SubmittalRouteLabels;
  stops: readonly RouteStop[];
  /** Opens the Workflow map: the whole strip is its button. Left out on the map's own large strip. */
  onOpen?: () => void;
  /** The map's large strip: each stop with a line under it, spread across. */
  large?: boolean;
  className?: string;
};

/**
 * The route strip (RP-1064, README §4.4): the item's route by Project Role, e.g. Contractor →
 * Consultant → Owner → Contractor, each stop done, current (on a white tile with a brand outline)
 * or upcoming. Another Company's Steps are one stop, marked as a whole with the Company the API
 * names, never one of its Steps (V14).
 */
export function SubmittalRouteStrip({ locale, labels, stops, onOpen, large = false, className }: SubmittalRouteStripProps) {
  const listId = useId();
  const items = stops.map((stop, i) => {
    const line = large ? stopLine(stop, labels, locale) : stop.companyName ? labels.withCompany(stop.companyName[locale]) : null;
    return (
      <li key={i} aria-current={stop.state === "current" ? "step" : undefined} data-state={stop.state} className="flex min-w-0 items-center gap-1">
        {/* Points along the flow: the icon turns round in Arabic by itself. */}
        {i > 0 && <Icon name="chevron-right" size={13} className="shrink-0 text-faint" />}
        <span
          className={cn(
            "sdp-stop flex min-w-0 items-center gap-1.5 rounded-[9px]",
            large ? "py-1.5 ps-1.5 pe-3 text-[13.5px]" : "py-[3px] ps-[3px] pe-2 text-[12px]",
            // The design fades an upcoming stop to 55%; its text keeps the contrast it needs in the muted colour, and only its icon fades.
            stop.state === "upcoming" && "text-muted [&_.sdp-role]:opacity-55",
            stop.state === "current" && "bg-surface shadow-[0_0_0_1.5px_var(--brand),0_1px_3px_color-mix(in_srgb,var(--shadow-colour)_10%,transparent)]",
          )}
        >
          <RoleIcon role={stop.role} size={large ? 32 : 24} />
          <span className="min-w-0">
            <b className="block leading-tight font-semibold">{labels.role(stop.role)}</b>
            {line && <small className="block text-[11px] leading-tight font-medium text-muted">{line}</small>}
          </span>
          <span className="sr-only">({labels.state(stop.state)})</span>
        </span>
      </li>
    );
  });
  const list = (
    <ol id={listId} aria-label={onOpen ? undefined : labels.route} className={cn("flex w-full flex-wrap items-center", large ? "justify-between gap-2" : "gap-1")}>
      {items}
    </ol>
  );
  const frame = cn("sdp-route block w-full rounded-[12px] bg-surface-subtle text-start text-text shadow-[inset_0_0_0_1px_var(--border-subtle)]", large ? "p-3" : "p-2", className);
  if (!onOpen) return <div className={frame}>{list}</div>;
  return (
    // Named by what it does; the route is its description, read after the name.
    <button
      type="button"
      onClick={onOpen}
      title={labels.open}
      aria-label={labels.open}
      aria-describedby={listId}
      className={cn(
        frame,
        "min-h-8 cursor-pointer transition-shadow hover:shadow-[inset_0_0_0_1.5px_var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      )}
    >
      {list}
    </button>
  );
}

/**
 * The vertical Step list of the rail's Workflow block (RP-1093, README §4.9): one row a stop of the
 * route strip, in its order, each with its state (done ✓, current, upcoming), its Project Role and
 * one line: the viewer's own Step where its Participant holds the item, the Company the API names
 * where another Company does (never one of its Steps, V14), the outcome, or how many Steps it has.
 */
export function SubmittalRouteSteps({ locale, labels, route, className }: { locale: Locale; labels: SubmittalRouteLabels; route: SubmittalRoute; className?: string }) {
  return (
    <ol data-route-steps="" aria-label={labels.route} className={cn("flex flex-col", className)}>
      {route.stops.map((stop, i) => {
        const last = i === route.stops.length - 1;
        return (
          <li
            key={i}
            data-state={stop.state}
            aria-current={stop.state === "current" ? "step" : undefined}
            className={cn("relative grid grid-cols-[20px_minmax(0,1fr)] gap-2.5", !last && "pb-3.5")}
          >
            {/* The line down to the next stop: green once this one is done. */}
            {!last && (
              <span aria-hidden="true" className={cn("absolute start-[9px] top-5 bottom-0 w-0.5", stop.state === "done" ? "bg-success" : "bg-border-subtle")} />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "relative flex size-5 items-center justify-center rounded-full",
                stop.state === "done" && "bg-success text-on-inverse",
                stop.state === "current" && "bg-surface shadow-[inset_0_0_0_2px_var(--brand)]",
                stop.state === "upcoming" && "bg-surface shadow-[inset_0_0_0_2px_var(--border-strong)]",
              )}
            >
              {stop.state === "done" && <Icon name="check" size={12} />}
              {stop.state === "current" && <span className="size-2 rounded-full bg-brand" />}
            </span>
            <span className="min-w-0">
              <b className="flex items-center gap-1.5 text-[13px] leading-5 font-semibold">
                <RoleIcon role={stop.role} size={18} />
                {labels.role(stop.role)}
              </b>
              <small dir="auto" className="block text-[12px] text-muted">
                {rowLine(submittalRouteStopLine(route, i), labels, locale)}
              </small>
              <span className="sr-only">({labels.state(stop.state)})</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function rowLine(line: RouteStopLine, labels: SubmittalRouteLabels, locale: Locale): string {
  switch (line.kind) {
    case "step":
      return line.name[locale];
    case "company":
      return labels.withCompany(line.name[locale]);
    case "outcome":
      return labels.outcome;
    case "steps":
      return labels.steps(line.count, formatNumber(line.count, locale));
  }
}

/** The large strip's line under a stop: who holds it, or what it is. */
function stopLine(stop: RouteStop, labels: SubmittalRouteLabels, locale: Locale): string {
  if (stop.companyName) return labels.withCompany(stop.companyName[locale]);
  if (stop.stepKeys.length === 0) return labels.outcome;
  return labels.steps(stop.stepKeys.length, formatNumber(stop.stepKeys.length, locale));
}
