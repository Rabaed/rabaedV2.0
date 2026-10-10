"use client";

import { formatNumber, stepAgeLabel, type Locale, type WorkItemWorkflowMap } from "@rabaed/domain";
import {
  AgeDots,
  Button,
  DocNo,
  Icon,
  SegmentedControl,
  Sheet,
  SheetContent,
  SheetTrigger,
  WorkflowCanvas,
  WorkflowStepList,
  type WorkflowLabels,
} from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

type Props = {
  map: WorkItemWorkflowMap;
  locale: Locale;
  documentNumber: string | null;
  /** Step Age while the item waits at a Step, aged as the viewer may see it (V14); null once closed. */
  stepAgeWeeks: number | null;
};

/**
 * "Workflow: <name> · Version n" on the item page and its "View workflow" drawer
 * (RP-438, design `workflow-view.html`): the Version the item is pinned to, as a
 * canvas or a list. The viewer's own Participant's Steps are shown one by one;
 * another Participant's are one part, marked "With <Company>" while it holds the
 * item, never one of its Steps (V14).
 */
export function WorkItemWorkflow({ map, locale, documentNumber, stepAgeWeeks }: Props) {
  const t = useTranslations("workflowMap");
  const tRoles = useTranslations("projects.roles");
  const [view, setView] = useState<"map" | "list">("map");
  // A phone opens on the list: the canvas needs room.
  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) setView("list");
  }, []);

  const labels = useMemo<WorkflowLabels>(
    () => ({
      canvas: t("canvas"),
      list: t("listName"),
      outcome: t("outcome"),
      role: (role) => tRoles(role),
      permission: (permission) => t(`permissions.${permission}`),
      outcomeMode: (mode) => t(`outcomeModes.${mode}`),
      kind: (kind) => t(`kinds.${kind}`),
      position: (key, role) => map.positions.find((p) => p.key === key && p.role === role)?.name[locale] ?? key,
      part: (role) => t("part", { role }),
      withCompany: (company) => t("withCompany", { company }),
      current: t("current"),
      to: t("to"),
      overview: t("overview"),
      zoomIn: t("zoomIn"),
      zoomOut: t("zoomOut"),
      fit: t("fit"),
    }),
    [t, tRoles, map.positions, locale],
  );
  const version = formatNumber(map.versionNo, locale);
  const name = map.name[locale];
  const folded = map.definition.steps.some((s) => s.actor && s.actor.role !== map.viewerRole);
  const shared = { definition: map.definition, stages: map.stages, locale, labels, viewerRole: map.viewerRole, position: map.position };
  const currentDetail =
    stepAgeWeeks !== null && map.position?.kind !== "closed" ? (
      <span className="inline-flex items-center gap-1.5">
        <AgeDots weeks={stepAgeWeeks} locale={locale} />
        <span aria-hidden="true">{stepAgeLabel(stepAgeWeeks, locale)}</span>
      </span>
    ) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="text-muted">{t("line", { name, version })}</span>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="secondary" size="sm">
            <Icon name="git-branch" />
            {t("view")}
          </Button>
        </SheetTrigger>
        <SheetContent
          title={t("title", { name, version })}
          description={documentNumber ? <DocNo value={documentNumber} /> : undefined}
          closeLabel={t("close")}
          className="flex max-w-none flex-col bg-canvas sm:w-[min(1100px,72vw)] sm:min-w-[640px]"
        >
          {map.latestVersionNo > map.versionNo && (
            <p role="note" className="flex items-center gap-2 rounded-md bg-stage-internal-bg px-3 py-2 text-sm font-semibold text-stage-internal-fg">
              <Icon name="info-circle" size={16} />
              {t("newerVersion", { version, latest: formatNumber(map.latestVersionNo, locale) })}
            </p>
          )}
          <SegmentedControl
            aria-label={t("showAs")}
            value={view}
            onValueChange={(v) => setView(v === "list" ? "list" : "map")}
            options={[
              { value: "map", label: t("map") },
              { value: "list", label: t("list") },
            ]}
          />
          {view === "map" ? (
            <div className="min-h-[420px] flex-1">
              <WorkflowCanvas {...shared} currentDetail={currentDetail} className="h-full" />
            </div>
          ) : (
            <WorkflowStepList {...shared} />
          )}
          {folded && (
            <p className="flex items-center gap-1.5 text-caption text-muted">
              <Icon name="info-circle" size={14} />
              {t("grouped")}
            </p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
