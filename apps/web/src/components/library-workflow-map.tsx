"use client";

import { formatNumber, type Locale, type WorkflowMapRead } from "@rabaed/domain";
import { Icon, SegmentedControl, WorkflowCanvas, WorkflowStepList, buttonVariants, type WorkflowLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";

type Props = { read: WorkflowMapRead; locale: Locale };

/**
 * A Library Workflow to look at (RP-442, WF-19), for a Member who is not the Company's
 * Authorized Person: its latest published Version as a map or a list, every Company's
 * Steps included (a Workflow is a description of a process, ADR 0016). Nothing to edit.
 */
export function LibraryWorkflowMap({ read, locale }: Props) {
  const t = useTranslations("library");
  const tMap = useTranslations("workflowMap");
  const tRoles = useTranslations("projects.roles");
  const [view, setView] = useState<"map" | "list">("map");
  // A phone opens on the list: the canvas needs room.
  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) setView("list");
  }, []);

  const labels = useMemo<WorkflowLabels>(
    () => ({
      canvas: tMap("canvas"),
      list: tMap("listName"),
      outcome: tMap("outcome"),
      role: (role) => tRoles(role),
      permission: (permission) => tMap(`permissions.${permission}`),
      outcomeMode: (mode) => tMap(`outcomeModes.${mode}`),
      kind: (kind) => tMap(`kinds.${kind}`),
      position: (key, role) => read.positions.find((p) => p.key === key && p.role === role)?.name[locale] ?? key,
      part: (role) => tMap("part", { role }),
      withCompany: (company) => tMap("withCompany", { company }),
      current: tMap("current"),
      to: tMap("to"),
      overview: tMap("overview"),
      zoomIn: tMap("zoomIn"),
      zoomOut: tMap("zoomOut"),
      fit: tMap("fit"),
    }),
    [tMap, tRoles, read.positions, locale],
  );
  const published = read.workflow.published;
  const shared = published ? { definition: published.definition, stages: read.stages, locale, labels } : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-h4 leading-[1.2] font-extrabold tracking-[-0.01em] text-text rtl:font-bold rtl:tracking-normal">
            {read.workflow.name[locale]}
          </h1>
          <p className="text-body text-muted">
            {published ? t("map.title", { name: read.type.name[locale], version: formatNumber(published.versionNo, locale) }) : t("map.noVersion")}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-[7px] bg-neutral-tint px-2.5 py-[5px] text-[12.5px] font-semibold text-neutral-fg">
            <Icon name="lock" size={14} />
            {t("map.readOnly")}
          </span>
          <Link href="/library" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Icon name="arrow-left" />
            {t("map.back")}
          </Link>
        </div>
      </div>
      {shared && (
        <>
          <SegmentedControl
            aria-label={t("map.showAs")}
            value={view}
            onValueChange={(v) => setView(v === "list" ? "list" : "map")}
            options={[
              { value: "map", label: t("map.map") },
              { value: "list", label: t("map.list") },
            ]}
          />
          {view === "map" ? (
            <div className="h-[calc(100dvh-16rem)] min-h-[420px]">
              <WorkflowCanvas {...shared} className="h-full" />
            </div>
          ) : (
            <WorkflowStepList {...shared} />
          )}
        </>
      )}
    </div>
  );
}
