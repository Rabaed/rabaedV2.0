import { moduleOfTabPath, type Locale } from "@rabaed/domain";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ModuleWorkItemsPage } from "@/components/module-work-items-page";

/**
 * Any other Module's tab (Inspections, Snag List…), at its path in
 * `moduleTabPaths`: the same List or Kanban as Submittals, over that Module's
 * Types. A path that is no Module's is not found.
 */
export default async function ModuleTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; projectId: string; moduleTab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, projectId, moduleTab } = await params;
  setRequestLocale(locale);
  const moduleKey = moduleOfTabPath(moduleTab);
  if (!moduleKey) notFound();
  return <ModuleWorkItemsPage locale={locale} projectId={projectId} module={moduleKey} searchParams={await searchParams} />;
}
