"use client";

import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";

export type SubmittalPanelRailLabels = {
  /** "Workflow" */
  workflow: string;
  /** "Workflow map": the link that opens the item's Workflow map (RP-1064). */
  map: string;
  /** "Approval log" */
  log: string;
};

/**
 * The side rail of the Wide and Full bands (RP-1067, README §4.9): "Workflow" (the route strip and
 * the vertical Step list of RP-1064, and a "Workflow map ↗" link), then the approval log. The panel
 * shows it from 880px only (`.sdp-rail`); below that, the same content is the in-flow "Workflow &
 * approval log" section (`.sdp-inflow`), so it changes live with the bands.
 */
export function SubmittalPanelRail({
  labels,
  workflow,
  onOpenMap,
  log,
}: {
  labels: SubmittalPanelRailLabels;
  /** The route strip and the Step list; none until the item's Workflow map read arrives. */
  workflow?: ReactNode;
  /** Opens the Workflow map; no link without it. */
  onOpenMap?: () => void;
  log: ReactNode;
}) {
  return (
    <>
      {(workflow || onOpenMap) && (
        <section data-rail="workflow" className="flex min-w-0 flex-col">
          <h3 className="mb-3 flex items-center gap-2 text-[11.5px] font-bold tracking-[0.04em] text-muted uppercase rtl:tracking-normal">
            <Icon name="route" size={14} />
            <span className="me-auto">{labels.workflow}</span>
            {onOpenMap && <SubmittalPanelMapLink label={labels.map} onOpen={onOpenMap} />}
          </h3>
          {workflow}
        </section>
      )}
      <section data-rail="log" className="flex min-w-0 flex-col">
        <h3 className="mb-3 flex items-center gap-2 text-[11.5px] font-bold tracking-[0.04em] text-muted uppercase rtl:tracking-normal">
          <Icon name="history" size={14} />
          {labels.log}
        </h3>
        {log}
      </section>
    </>
  );
}

/** "Workflow map ↗": opens the item's Workflow map inside the panel (never a new tab). */
export function SubmittalPanelMapLink({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("inline-flex min-h-8 items-center gap-1 rounded-[6px] px-1 text-[12px] font-semibold tracking-normal text-brand-fg normal-case hover:underline", focusRing)}
    >
      {label}
      <Icon name="arrow-up-right" size={13} className="rtl:-scale-x-100" />
    </button>
  );
}

/**
 * The in-flow "Workflow & approval log" content, for the section below 880px: the same parts as the
 * rail, one under the other.
 */
export function SubmittalPanelWorkflowAndLog({ labels, workflow, onOpenMap, log }: Parameters<typeof SubmittalPanelRail>[0]) {
  return (
    <div className="flex flex-col gap-5">
      {(workflow || onOpenMap) && (
        <div className="flex min-w-0 flex-col gap-2">
          {onOpenMap && (
            <p className="flex">
              <SubmittalPanelMapLink label={labels.map} onOpen={onOpenMap} />
            </p>
          )}
          {workflow}
        </div>
      )}
      {log}
    </div>
  );
}
