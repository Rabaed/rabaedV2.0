"use client";

import { formatNumber, type Locale, type WorkItemWorkflowMap } from "@rabaed/domain";
import { useLayoutEffect, useRef } from "react";
import { cn } from "../../lib/cn.ts";
import { buttonVariants } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { Dialog, DialogContent } from "../overlay/dialog.tsx";
import { submittalRoute } from "./route-model.ts";
import { RoleIcon, SubmittalRouteStrip, type SubmittalRouteLabels } from "./route-strip.tsx";

/** The Workflow map's words, beside the route strip's. */
export type SubmittalWorkflowMapLabels = SubmittalRouteLabels & {
  /** The heading, "Workflow" (never "template"). */
  title: string;
  /** Under it: "<the Workflow's name> · Version 3" (never "v3"). */
  version: (name: string, version: string) => string;
  /** A Step card's first line, "Step 2 · Contractor". */
  step: (n: string, role: string) => string;
  /** Where the item is: "You are here". */
  youAreHere: string;
  /** The name of a Step's list of Transitions, e.g. "What happens here". */
  happens: string;
  /** The footer: "Changes apply to new submittals only." */
  newOnly: string;
  /** "Open in Workflow settings". */
  openSettings: string;
  close: string;
};

export type SubmittalWorkflowMapProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  labels: SubmittalWorkflowMapLabels;
  /** The item's map, as `GET /v1/work-items/:id/workflow` gives it. */
  map: WorkItemWorkflowMap;
  /** Workflow settings, only for a Member who may edit Workflows (a Project Admin); left out for anyone else. */
  settingsHref?: string;
};

/**
 * The Workflow map (RP-1064, README §6, gaps A10 and A11): the Workflow Version the item is pinned
 * to, as a large route strip and one card per Step. It is shown whole, every Company's Steps
 * included (V20). Where the item is comes only from the API's position: one of the viewer's own
 * Steps is outlined "You are here"; another Company's stop is outlined as a whole, with the Company
 * the API names, never one of its Steps (V14). Nothing that happened on the item is shown, and no
 * "Time allowed", due date or count of items.
 *
 * Esc closes it before the panel: it is a dialog layer, which the panel waits for (`layerOpen`).
 */
export function SubmittalWorkflowMap({ open, onOpenChange, locale, labels, map, settingsHref }: SubmittalWorkflowMapProps) {
  const route = submittalRoute({ definition: map.definition, stages: map.stages, position: map.position });
  const n = (value: number) => formatNumber(value, locale);
  // Focus goes back to whatever opened it (the strip, the Details tab's button or the rail's link), still inside the panel.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (!opener.current?.isConnected) return;
          event.preventDefault();
          opener.current.focus();
        }}
        title={labels.title}
        description={labels.version(map.name[locale], n(map.versionNo))}
        closeLabel={labels.close}
        className="sdp-map w-[min(920px,calc(100%-2rem))] gap-0 p-0 [&>div:first-child]:border-b [&>div:first-child]:border-border-subtle [&>div:first-child]:px-[18px] [&>div:first-child]:py-4"
      >
        <div className="flex flex-col gap-4 p-[18px]">
          <SubmittalRouteStrip locale={locale} labels={labels} stops={route.stops} large />
          <ol className="flex flex-col gap-4">
            {route.stops.map((stop, i) => {
              const steps = route.steps.filter((s) => s.stop === i);
              if (steps.length === 0) return null;
              // Another Company holds the item somewhere in this stop: the stop is marked, not a Step (V14).
              const held = stop.companyName !== null;
              return (
                <li
                  key={i}
                  data-stop={i}
                  aria-current={held ? "step" : undefined}
                  className={cn("rounded-[14px]", held && "p-2 shadow-[inset_0_0_0_1.5px_var(--brand)]")}
                >
                  {held && (
                    <p className="mb-2 flex flex-wrap items-center gap-x-2 px-1 text-[12.5px] font-semibold">
                      <em className="text-[10.5px] font-bold text-brand-fg not-italic">{labels.youAreHere}</em>
                      <span className="text-muted">{labels.withCompany(stop.companyName![locale])}</span>
                    </p>
                  )}
                  <ol className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
                    {steps.map((s) => (
                      <li
                        key={s.step.key}
                        aria-current={s.current ? "step" : undefined}
                        data-step={s.step.key}
                        className={cn(
                          "flex flex-col gap-2.5 rounded-[12px] bg-surface p-3",
                          s.current ? "shadow-[inset_0_0_0_1.5px_var(--brand)]" : "shadow-[inset_0_0_0_1px_var(--border-subtle)]",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <RoleIcon role={s.role} size={30} />
                          <span className="min-w-0 flex-1">
                            <small className="block text-[11px] text-muted">{labels.step(n(s.number), labels.role(s.role))}</small>
                            <b className="block text-[13.5px] leading-tight">{s.step.name[locale]}</b>
                          </span>
                          {s.current && <em className="self-start text-[10.5px] font-bold text-brand-fg not-italic">{labels.youAreHere}</em>}
                        </div>
                        {s.happens.length > 0 && (
                          <ul aria-label={labels.happens} className="flex flex-wrap gap-1">
                            {s.happens.map((label, j) => (
                              <li key={j} className="rounded-[7px] bg-surface-subtle px-1.5 py-0.5 text-[11.5px] text-text-secondary">
                                {label[locale]}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-b-md border-t border-border-subtle bg-surface-subtle px-[18px] py-3 text-[12.5px] text-muted">
          <span className="me-auto">{labels.newOnly}</span>
          {settingsHref && (
            <a href={settingsHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Icon name="settings" />
              {labels.openSettings}
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
