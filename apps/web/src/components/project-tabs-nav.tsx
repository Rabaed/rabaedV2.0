"use client";

import { type ModuleKey } from "@rabaed/domain";
import { ProjectTabs, projectTabKeys, type ProjectTabKey } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRememberedHref } from "@/components/remembered-module-queries";
import { Link, usePathname } from "@/i18n/navigation";
import { projectTabHref, projectTabOf } from "@/lib/new-item-route";

/**
 * The Project tabs (RP-346, RP-406, RP-1142): Dashboard, Submittals and Settings always,
 * and a Module's tab only when the Project has a Work Item Type in it. The New page is under
 * the tab of the Module it raises in (`?module=`), so a New Snag is under the Snag List (RP-1179).
 */
export function ProjectTabsNav({ projectId, modules }: { projectId: string; modules: ModuleKey[] }) {
  const t = useTranslations("projectTabs");
  const pathname = usePathname();
  const current = projectTabOf(projectId, pathname, useSearchParams().get("module"), modules);
  // A Module's tab reopens with the Member's last filters, sort and view there (RP-1240).
  const remembered = useRememberedHref();
  return (
    <ProjectTabs
      label={t("label")}
      labels={Object.fromEntries(projectTabKeys.map((key) => [key, t(key)])) as Record<ProjectTabKey, string>}
      modules={modules}
      href={(key) => remembered(projectTabHref(projectId, key))}
      current={current}
      linkAs={Link}
    />
  );
}
