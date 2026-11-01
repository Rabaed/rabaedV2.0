"use client";

import { type ModuleKey } from "@rabaed/domain";
import { ProjectTabs, projectTabKeys, type ProjectTabKey } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { projectTabHref, projectTabOf } from "@/lib/new-item-route";

/**
 * The Project tabs (RP-346, RP-406): Dashboard, Submittals, Activity and Settings always,
 * and a Module's tab only when the Project has a Work Item Type in it. The New page is under
 * the tab of the Module it raises in (`?module=`), so New WIR is under Inspections (RP-1179).
 */
export function ProjectTabsNav({ projectId, modules }: { projectId: string; modules: ModuleKey[] }) {
  const t = useTranslations("projectTabs");
  const pathname = usePathname();
  const current = projectTabOf(projectId, pathname, useSearchParams().get("module"), modules);
  return (
    <ProjectTabs
      label={t("label")}
      labels={Object.fromEntries(projectTabKeys.map((key) => [key, t(key)])) as Record<ProjectTabKey, string>}
      modules={modules}
      href={(key) => projectTabHref(projectId, key)}
      current={current}
      linkAs={Link}
    />
  );
}
