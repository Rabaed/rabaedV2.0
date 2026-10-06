import type { Locale } from "@rabaed/domain";
import { setRequestLocale } from "next-intl/server";
import { ModuleWorkItemsPage } from "@/components/module-work-items-page";

/** A Project's Submittals tab: the List or the Kanban of its Submittals. */
export default async function WorkItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  return <ModuleWorkItemsPage locale={locale} projectId={projectId} module="submittals" searchParams={await searchParams} />;
}
