"use client";

import type { Locale, WorkflowVersionRead } from "@rabaed/domain";
import { Icon, SegmentedControl, WorkflowCanvas, WorkflowStepList, type WorkflowLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

/**
 * One published Version of a Workflow as a read-only map or a list (RP-441, "View
 * versions"): every Company's Steps are shown, the Workflow being a description of a
 * process every Participant reads (V20, ADR 0016). The words are the item page's map.
 */
export function WorkflowVersionMap({ read, locale }: { read: WorkflowVersionRead; locale: Locale }) {
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
      position: (key, role) => read.positions.find((p) => p.key === key && p.role === role)?.name[locale] ?? key,
      part: (role) => t("part", { role }),
      withCompany: (company) => t("withCompany", { company }),
      current: t("current"),
      to: t("to"),
      overview: t("overview"),
      zoomIn: t("zoomIn"),
      zoomOut: t("zoomOut"),
      fit: t("fit"),
    }),
    [t, tRoles, read.positions, locale],
  );
  const shared = { definition: read.definition, stages: read.stages, locale, labels };

  return (
    <div className="flex flex-col gap-3">
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
        <div className="h-[28rem] min-h-[420px] overflow-hidden rounded-md border border-border">
          <WorkflowCanvas {...shared} className="h-full" />
        </div>
      ) : (
        <WorkflowStepList {...shared} />
      )}
      <p className="flex items-center gap-1.5 text-caption text-muted">
        <Icon name="info-circle" size={14} />
        {t("everyStep")}
      </p>
    </div>
  );
}
