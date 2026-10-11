"use client";

import { moduleTabPaths, type ModuleKey } from "@rabaed/domain";
import { ProjectTabs, projectTabKeys, type ProjectTabKey } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/** Where each tab leads: a Module's tab at its Module's path (`moduleTabPaths`). */
const pathOf = (projectId: string, key: ProjectTabKey) => {
  const base = `/projects/${projectId}`;
  if (key === "dashboard") return base;
  if (key === "settings") return `${base}/settings`;
  if (key === "activity") return `${base}/activity`;
  return `${base}/${moduleTabPaths[key]}`;
};

/**
 * The Project tabs (RP-346, RP-406): Dashboard, Submittals, Activity and Settings always,
 * and a Module's tab only when the Project has a Work Item Type in it.
 */
export function ProjectTabsNav({ projectId, modules }: { projectId: string; modules: ModuleKey[] }) {
  const t = useTranslations("projectTabs");
  const pathname = usePathname();
  const current = [...projectTabKeys]
    .reverse()
    .find((key) => (key === "dashboard" ? pathname === pathOf(projectId, key) : pathname.startsWith(pathOf(projectId, key))));
  return (
    <ProjectTabs
      label={t("label")}
      labels={Object.fromEntries(projectTabKeys.map((key) => [key, t(key)])) as Record<ProjectTabKey, string>}
      modules={modules}
      href={(key) => pathOf(projectId, key)}
      current={current}
      linkAs={Link}
    />
  );
}
