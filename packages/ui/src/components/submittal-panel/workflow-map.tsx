"use client";

import { formatNumber, type Locale, type WorkItemWorkflowMap } from "@rabaed/domain";
import { useLayoutEffect, useRef, useState, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { buttonVariants } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../navigation/tabs.tsx";
import { Sheet, SheetContent } from "../overlay/sheet.tsx";
import { submittalRoute, type RouteStep, type RouteStop, type SubmittalRoute } from "./route-model.ts";
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
  /** The drawer's tabs (RP-1188, gap table row 57): "Steps", the card list, and "Map". */
  stepsTab: string;
  mapTab: string;
  /** On the viewer's own Step holding the item: "Here now". */
  hereNow: string;
  /** Under another Company's block, which lists its Steps by name only (row 58): who works on them and where it is stay theirs. */
  privateSteps: string;
};

export type SubmittalWorkflowMapProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  labels: SubmittalWorkflowMapLabels;
  /** The item's map, as `GET /v1/work-items/:id/workflow` gives it. */
  map: WorkItemWorkflowMap;
  /**
   * Who holds the item, on the viewer's own Step holding it (`position.kind === "own"`): their own Member's
   * name, which the viewer's own Company reads (V14). Absent anywhere else, and never another Company's person.
   */
  holder?: string;
  /** Workflow settings, only for a Member who may edit Workflows (a Project Admin); left out for anyone else. */
  settingsHref?: string;
  /** The app's link component (Next's `Link`), so going to Workflow settings stays client-side; a plain `<a>` otherwise. */
  linkAs?: ElementType;
};

/**
 * The View workflow drawer (RP-1064; RP-1188, gap table rows 57–58): the Workflow Version the item is
 * pinned to, from the inline end, in two tabs. "Steps", the owner's card list: one card per Step of the
 * viewer's own Company, "Here now" on the one holding the item; another Company's Steps as one block,
 * listed by name with no people and none of them marked (V14 "the Workflow's map is shown whole", V20);
 * that block is marked as a whole while its Company holds the item, with the Company the API names.
 * "Map": the large route strip and a card per Step. Nothing that happened on the item is shown, and no
 * "Time allowed", due date or count of items.
 *
 * Esc closes it before the panel: it is a dialog layer, which the panel waits for (`layerOpen`).
 */
export function SubmittalWorkflowMap({ open, onOpenChange, locale, labels, map, holder, settingsHref, linkAs: Link = "a" }: SubmittalWorkflowMapProps) {
  const route = submittalRoute({ definition: map.definition, stages: map.stages, position: map.position });
  const n = (value: number) => formatNumber(value, locale);
  const [tab, setTab] = useState("steps");
  // Focus goes back to whatever opened it (the strip, the Details tab's button or the rail's link), still inside the panel.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        onCloseAutoFocus={(event) => {
          if (!opener.current?.isConnected) return;
          event.preventDefault();
          opener.current.focus();
        }}
        title={labels.title}
        description={labels.version(map.name[locale], n(map.versionNo))}
        closeLabel={labels.close}
        className="sdp-map max-w-[520px] gap-0 p-0 [&>div:first-child]:border-b [&>div:first-child]:border-border-subtle [&>div:first-child]:px-5 [&>div:first-child]:py-4"
      >
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList aria-label={labels.title} className="px-5">
            <TabsTrigger value="steps">{labels.stepsTab}</TabsTrigger>
            <TabsTrigger value="map">{labels.mapTab}</TabsTrigger>
          </TabsList>
          <TabsContent value="steps" className="flex-1 overflow-y-auto px-5 py-4">
            <StepCards route={route} locale={locale} labels={labels} holder={holder} viewerRole={map.viewerRole} />
          </TabsContent>
          <TabsContent value="map" className="flex-1 overflow-y-auto px-5 py-4">
            <MapView route={route} locale={locale} labels={labels} />
          </TabsContent>
        </Tabs>
        <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle bg-surface-subtle px-5 py-3 text-[12.5px] text-muted">
          <span className="me-auto">{labels.newOnly}</span>
          {settingsHref && (
            <Link href={settingsHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Icon name="settings" />
              {labels.openSettings}
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

type ViewProps = { route: SubmittalRoute; locale: Locale; labels: SubmittalWorkflowMapLabels };

/**
 * The owner's card list (row 57): down the route, a marker per card (done, here, to come) on a line
 * that turns green as the item moves on. The viewer's own Steps one by one; another Company's as one
 * dashed block (row 58).
 */
function StepCards({ route, locale, labels, holder, viewerRole }: ViewProps & { holder: string | undefined; viewerRole: WorkItemWorkflowMap["viewerRole"] }) {
  // The viewer's own stop shows its Steps one by one: its role is the viewer's, and no other Company holds the
  // item there (a second Contractor reads the raiser's stop as a block).
  const ownStop = (stop: RouteStop) => viewerRole !== null && stop.role === viewerRole && stop.companyName === null;
  const rows = route.stops.flatMap((stop, i) => {
    const steps = route.steps.filter((s) => s.stop === i);
    if (steps.length === 0) return [];
    return ownStop(stop)
      ? steps.map((s) => ({ key: s.step.key, stop, i, steps: [s], own: true }))
      : [{ key: `stop-${i}`, stop, i, steps, own: false }];
  });
  return (
    <ol aria-label={labels.route} className="flex flex-col">
      {rows.map((row, r) => {
        const last = r === rows.length - 1;
        const step = row.own ? row.steps[0]! : null;
        // A card's state: an own Step by the item's own position, a block by its stop's (V14: never one of its Steps).
        const state = step ? stepState(route, step) : row.stop.state;
        const held = !row.own && row.stop.companyName !== null;
        return (
          <li key={row.key} data-stop={row.own ? undefined : row.i} data-state={state} aria-current={held ? "step" : undefined} className={cn("relative grid grid-cols-[32px_minmax(0,1fr)] gap-3", !last && "pb-4")}>
            {!last && <span aria-hidden="true" className={cn("absolute start-[15px] top-8 bottom-0 w-0.5", state === "done" ? "bg-success" : "bg-border-subtle")} />}
            <StateDot state={state} number={step ? formatNumber(step.number, locale) : null} role={row.stop.role} own={row.own} />
            {step ? (
              <OwnStepCard step={step} labels={labels} locale={locale} holder={step.current ? holder : undefined} />
            ) : (
              <div className={cn("flex flex-col gap-1.5 rounded-[12px] border border-dashed bg-surface-subtle p-3", held ? "border-brand" : "border-border")}>
                <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  <RoleIcon role={row.stop.role} size={16} />
                  {labels.role(row.stop.role)}
                </span>
                {held && <b className="text-[14px] font-bold text-brand-fg">{labels.withCompany(row.stop.companyName![locale])}</b>}
                {/* Its Steps by name only: no people, no holder, and not which one holds it (V14). */}
                <ul className="flex flex-col gap-0.5">
                  {row.steps.map((s) => (
                    <li key={s.step.key} data-step={s.step.key} className="text-[13.5px] font-semibold">
                      {s.step.name[locale]}
                    </li>
                  ))}
                </ul>
                <p className="text-[12.5px] text-muted">{labels.privateSteps}</p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** An own Step's state from where the item is: before the Step holding it, done; it, here; after, to come. */
function stepState(route: SubmittalRoute, step: RouteStep): RouteStop["state"] {
  const stop = route.stops[step.stop]!;
  if (stop.state !== "current") return stop.state;
  const here = route.steps.find((s) => s.stop === step.stop && s.current);
  if (!here) return "current";
  return step.number < here.number ? "done" : step.number === here.number ? "current" : "upcoming";
}

function StateDot({ state, number, role, own }: { state: RouteStop["state"]; number: string | null; role: RouteStop["role"]; own: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-[1] flex size-8 items-center justify-center rounded-full text-[13px] font-bold",
        state === "done" && "bg-success text-on-inverse",
        state === "current" && "bg-surface text-brand-fg shadow-[inset_0_0_0_2px_var(--brand)]",
        state === "upcoming" && "bg-surface text-muted shadow-[inset_0_0_0_2px_var(--border-strong)]",
      )}
    >
      {state === "done" ? <Icon name="check" size={16} /> : own && number ? number : <RoleIcon role={role} size={18} />}
    </span>
  );
}

function OwnStepCard({ step, labels, locale, holder }: { step: RouteStep; labels: SubmittalWorkflowMapLabels; locale: Locale; holder: string | undefined }) {
  return (
    <div
      data-step={step.step.key}
      aria-current={step.current ? "step" : undefined}
      className={cn(
        "flex flex-col gap-1.5 rounded-[12px] bg-surface p-3",
        step.current ? "shadow-[inset_0_0_0_1.5px_var(--brand)]" : "shadow-[inset_0_0_0_1px_var(--border-subtle)]",
      )}
    >
      <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <RoleIcon role={step.role} size={16} />
        {labels.role(step.role)}
        {step.current && <em className="ms-auto text-[11px] font-bold text-brand-fg not-italic">{labels.hereNow}</em>}
      </span>
      <b className="text-[14px] font-bold">{step.step.name[locale]}</b>
      <Happens labels={step.happens} name={labels.happens} locale={locale} />
      {holder && (
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-surface-subtle px-2 py-0.5 text-[12px] font-semibold">
          {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name: a person holds the Step. */}
          <Icon name="user" size={14} />
          <bdi>{holder}</bdi>
        </span>
      )}
    </div>
  );
}

/** The Map tab: the large route strip and a card per Step, grouped by stop, as before the card list (RP-1064). */
function MapView({ route, locale, labels }: ViewProps) {
  const n = (value: number) => formatNumber(value, locale);
  return (
    <div className="flex flex-col gap-4">
      <SubmittalRouteStrip locale={locale} labels={labels} stops={route.stops} large />
      <ol className="flex flex-col gap-4">
        {route.stops.map((stop, i) => {
          const steps = route.steps.filter((s) => s.stop === i);
          if (steps.length === 0) return null;
          // Another Company holds the item somewhere in this stop: the stop is marked, not a Step (V14).
          const held = stop.companyName !== null;
          return (
            <li key={i} data-map-stop={i} aria-current={held ? "step" : undefined} className={cn("rounded-[14px]", held && "p-2 shadow-[inset_0_0_0_1.5px_var(--brand)]")}>
              {held && <p className="mb-2 px-1 text-[12.5px] font-bold text-brand-fg">{labels.withCompany(stop.companyName![locale])}</p>}
              <ol className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
                {steps.map((s) => (
                  <li
                    key={s.step.key}
                    data-map-step={s.step.key}
                    aria-current={s.current ? "step" : undefined}
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
                    <Happens labels={s.happens} name={labels.happens} locale={locale} />
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What happens at a Step: the labels of the Transitions leaving it, as small chips; nothing when none leave it. */
function Happens({ labels, name, locale }: { labels: RouteStep["happens"]; name: string; locale: Locale }) {
  if (labels.length === 0) return null;
  return (
    <ul aria-label={name} className="flex flex-wrap gap-1">
      {labels.map((label, j) => (
        <li key={j} className="rounded-[7px] bg-surface-subtle px-1.5 py-0.5 text-[11.5px] text-text-secondary">
          {label[locale]}
        </li>
      ))}
    </ul>
  );
}
