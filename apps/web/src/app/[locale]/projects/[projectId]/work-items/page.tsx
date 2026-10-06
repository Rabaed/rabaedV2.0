import { workItemQueryFromSearchParams, type Locale } from "@rabaed/domain";
import { buttonVariants } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { WorkItemListView } from "@/components/work-item-list-view";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getWorkItems } from "@/lib/session";

/**
 * A Project's Submittals List: one page of the work item query, its filters,
 * sort and page in the URL. Only the items the Member can see are listed, and
 * each Stage's count is of those items only.
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
  const t = await getTranslations("workItems");
  // A filter the URL holds that isn't valid is left out, so an old or edited link still opens.
  const query = workItemQueryFromSearchParams(await searchParams);
  const [me, project, list] = await Promise.all([getMe(), getProject(projectId), getWorkItems(projectId, query)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !list) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/projects/${project.id}`} className="text-sm text-primary underline underline-offset-4">
            {project.name[locale]}
          </Link>
          <h1 className="text-h4 font-semibold">{t("title")}</h1>
        </div>
        {/* The MAR's Draft Step is held by Contractors; the API refuses anyone else too. */}
        {project.projectRole.baseRole === "contractor" && (
          <Link href={`/projects/${project.id}/work-items/new`} className={buttonVariants()}>
            {t("newMar")}
          </Link>
        )}
      </div>

      <WorkItemListView list={list} query={query} locale={locale} />
    </div>
  );
}
