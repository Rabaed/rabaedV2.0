import { moduleKeys, moduleTabPaths, type Locale } from "@rabaed/domain";
import { setRequestLocale } from "next-intl/server";
import { ModuleWorkItemsPage } from "@/components/module-work-items-page";
import { redirect } from "@/i18n/navigation";

/**
 * A Project's Submittals tab: the List or the Kanban of its Submittals. A link
 * that names another Module in its query string (`?module=snag_list`, as a
 * Dashboard number's once did) opens that Module's own tab, with the rest of
 * its query.
 */
export default async function WorkItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const { module: named, ...rest } = await searchParams;
  const other = moduleKeys.find((m) => m !== "submittals" && m === (Array.isArray(named) ? named[0] : named));
  if (other) {
    const query = new URLSearchParams(Object.entries(rest).flatMap(([key, v]) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((one) => [key, one]))));
    const search = query.toString();
    return redirect({ href: `/projects/${projectId}/${moduleTabPaths[other]}${search ? `?${search}` : ""}`, locale });
  }
  return <ModuleWorkItemsPage locale={locale} projectId={projectId} module="submittals" searchParams={rest} />;
}
