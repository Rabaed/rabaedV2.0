"use client";

import type { Locale, ProjectSummary, WorkItemDetail, WorkItemWorkflowMap } from "@rabaed/domain";
import { SubmittalRouteSteps, SubmittalRouteStrip, SubmittalWorkflowMap, submittalRoute, type SubmittalWorkflowMapLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/** One read for one item: what came back, or null when it couldn't be read. */
type Read<T> = { id: string; value: T | null };

/** Reads `url` again whenever `refreshKey` changes, keeping the last answer for the same url meanwhile. */
function useRead<T>(url: string | null, refreshKey?: unknown): Read<T> | null {
  const [read, setRead] = useState<Read<T> | null>(null);
  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (res) => setRead({ id: url, value: res.ok ? ((await res.json()) as T) : null }))
      .catch(() => {
        if (!controller.signal.aborted) setRead({ id: url, value: null });
      });
    return () => controller.abort();
  }, [url, refreshKey]);
  return read?.id === url ? read : null;
}

/**
 * The Submittal Panel's route strip and its Workflow map (RP-1064): from the item's Workflow map read
 * (`GET /v1/work-items/:id/workflow`, the item page's), which gives where the item is only as the
 * viewer may know it (V14), and the Project read, for whether the viewer may edit Workflows (a
 * Project Admin; V20). No new API.
 *
 * `route` goes in the panel's route slot (the strip and the map); `workflow` is the rail's Workflow
 * block and the in-flow section's (the strip again, then the vertical Step list: RP-1093, README
 * §4.9); `openMap` opens the map from anywhere else in the panel (the rail's link: RP-1067).
 */
export function useSubmittalPanelRoute(item: WorkItemDetail | null, locale: Locale, refreshKey?: unknown): { route: ReactNode; workflow: ReactNode; openMap: () => void } {
  const t = useTranslations("submittalRoute");
  const tMap = useTranslations("workflowMap");
  const tRoles = useTranslations("projects.roles");
  const [open, setOpen] = useState(false);
  // Read again with the item (after a Transition, say): where it is may have changed.
  const mapRead = useRead<WorkItemWorkflowMap>(item ? `/api/v1/work-items/${item.id}/workflow` : null, refreshKey);
  const projectRead = useRead<ProjectSummary>(item ? `/api/v1/projects/${item.projectId}` : null);
  const map = mapRead?.value ?? null;
  // The map closes when another item opens in the panel.
  const itemId = item?.id;
  useEffect(() => setOpen(false), [itemId]);

  const labels = useMemo<SubmittalWorkflowMapLabels>(
    () => ({
      role: (role) => tRoles(role),
      withCompany: (company) => tMap("withCompany", { company }),
      open: tMap("view"),
      route: t("route"),
      state: (state) => t(`states.${state}`),
      outcome: t("outcome"),
      steps: (count, n) => t("steps", { count, n }),
      title: t("title"),
      version: (name, version) => t("version", { name, version }),
      step: (n, role) => t("step", { n, role }),
      youAreHere: t("youAreHere"),
      happens: t("happens"),
      newOnly: t("newOnly"),
      openSettings: t("openSettings"),
      close: tMap("close"),
      stepsTab: t("stepsTab"),
      mapTab: t("mapTab"),
      hereNow: t("hereNow"),
      privateSteps: t("privateSteps"),
    }),
    [t, tMap, tRoles],
  );

  // The same function every render: a map asked for before its read arrives opens once it does.
  const openMap = useCallback(() => setOpen(true), []);
  if (!item || !map) return { route: null, workflow: null, openMap };
  const project = projectRead?.value ?? null;
  const route = submittalRoute({ definition: map.definition, stages: map.stages, position: map.position });
  const { stops } = route;
  return {
    openMap,
    workflow: (
      <div className="flex min-w-0 flex-col gap-4">
        <SubmittalRouteStrip locale={locale} labels={labels} stops={stops} onOpen={openMap} />
        <SubmittalRouteSteps locale={locale} labels={labels} route={route} />
      </div>
    ),
    route: (
      <div className="sdp-route-slot px-5 pb-4">
        <SubmittalRouteStrip locale={locale} labels={labels} stops={stops} onOpen={openMap} />
        <SubmittalWorkflowMap
          open={open}
          onOpenChange={setOpen}
          locale={locale}
          labels={labels}
          map={map}
          // The holder of the viewer's own Step, a Member of their own Company: the item read names them only then (V14).
          {...(map.position?.kind === "own" && item.heldBy?.memberName ? { holder: item.heldBy.memberName[locale] } : {})}
          // Only a Project Admin edits the Project's Workflows (the settings read's canEdit).
          settingsHref={project?.isProjectAdmin ? `/projects/${item.projectId}/settings/workflows` : undefined}
          linkAs={Link}
        />
      </div>
    ),
  };
}
