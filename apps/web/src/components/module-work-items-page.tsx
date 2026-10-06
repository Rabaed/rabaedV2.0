import { workItemQueryFromSearchParams, workItemViewFromSearchParams, type Locale, type ModuleKey } from "@rabaed/domain";
import { buttonVariants } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { WorkItemListOrKanban } from "@/components/work-item-list-or-kanban";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getWorkItemBoard, getWorkItems } from "@/lib/session";

/**
 * A Module tab of a Project (RP-346): one page of the work item query over the
 * Module's Types, its filters, sort and page in the URL. Only the items the
 * Member can see are listed, and each Stage's count is of those items only.
 * With `view=kanban`, the same query as a Kanban (RP-349). A Module the Project
 * has no Type in is not found, like a Project the Member isn't on.
 */
export async function ModuleWorkItemsPage({
  locale,
  projectId,
  module,
  searchParams,
}: {
  locale: Locale;
  projectId: string;
  module: ModuleKey;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations("workItems");
  const tabs = await getTranslations("projectTabs");
  // A filter the URL holds that isn't valid is left out, so an old or edited link still opens.
  const query = workItemQueryFromSearchParams(searchParams);
  // List or Kanban, kept in the URL as `view`.
  const view = workItemViewFromSearchParams(searchParams);
  const [me, project, list, board] = await Promise.all([
    getMe(),
    getProject(projectId),
    view === "list" ? getWorkItems(projectId, module, query) : null,
    view === "kanban" ? getWorkItemBoard(projectId, module, query) : null,
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !(list ?? board)) notFound();
  const title = tabs(module);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/projects/${project.id}`} className="text-sm text-primary underline underline-offset-4">
            {project.name[locale]}
          </Link>
          <h1 className="text-h4 font-semibold">{title}</h1>
        </div>
        {/* The MAR's Draft Step is held by Contractors; the API refuses anyone else too. */}
        {module === "submittals" && project.projectRole.baseRole === "contractor" && (
          <Link href={`/projects/${project.id}/work-items/new`} className={buttonVariants()}>
            {t("newMar")}
          </Link>
        )}
      </div>

      {board ? (
        <WorkItemListOrKanban view="kanban" board={board} query={query} locale={locale} tableLabel={title} />
      ) : (
        list && <WorkItemListOrKanban view="list" list={list} query={query} locale={locale} tableLabel={title} />
      )}
    </div>
  );
}
