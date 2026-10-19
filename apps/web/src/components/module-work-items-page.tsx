import { moduleViewFromSearchParams, workItemQueryFromSearchParams, workItemViewFromSearchParams, type Locale, type ModuleKey } from "@rabaed/domain";
import { Icon, buttonVariants, cn } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { PackagesBoardView } from "@/components/packages-board-view";
import { SnagListView } from "@/components/snag-list-view";
import { WorkItemListOrKanban } from "@/components/work-item-list-or-kanban";
import { listQueryFromSearchParams, snagListSort } from "@/lib/list-url";
import { Link, getPathname, redirect } from "@/i18n/navigation";
import { getMe, getPackages, getProject, getRaisableTypes, getWorkItemBoard, getWorkItems } from "@/lib/session";

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
  // The Submittals' Packages view (RP-660): the Project's Packages the Member sees, as a Kanban of their status.
  if (moduleViewFromSearchParams(searchParams, module) === "packages") {
    const [me, project, packages, raisable] = await Promise.all([getMe(), getProject(projectId), getPackages(projectId), getRaisableTypes(projectId, module)]);
    if (!me) return redirect({ href: "/sign-in", locale });
    if (!project || !packages) notFound();
    return (
      <>
        <h1 className="sr-only">{tabs(module)}</h1>
        {/* "+ New Package" for a Member who may raise a Submittals Type: a Package holds their Participant's submittals (the API checks again). */}
        <PackagesBoardView packages={packages.packages} projectId={project.id} canCreate={(raisable?.types.length ?? 0) > 0} />
      </>
    );
  }
  // The filter fields' names in the other language, small after each (the owner's anatomy, RP-410).
  const other = await getTranslations({ locale: locale === "en" ? "ar" : "en", namespace: "workItemViews.list" });
  const hints = {
    stage: other("statusField"),
    ...Object.fromEntries(
      (["trade", "documentType", "owner", "role", "createdDate", "stepAge", "outcome", "submissionDate", "revisions"] as const).map((key) => [key, other(key)]),
    ),
  };
  // A filter the URL holds that isn't valid is left out, so an old or edited link still opens.
  // The tab's path names the Module, whatever the query string says.
  // List or Kanban, kept in the URL as `view`. The List pages by number, sorted by Submittal No. unless the URL says.
  const view = workItemViewFromSearchParams(searchParams);
  const snags = module === "snag_list";
  const listQuery = listQueryFromSearchParams(searchParams);
  // The Snag List's List sorts by Stage unless the URL says, so each Stage's group holds together (RP-94).
  const query = {
    ...(view === "list" ? { ...listQuery, sort: snags && searchParams.sort === undefined ? snagListSort : listQuery.sort } : workItemQueryFromSearchParams(searchParams)),
    module,
  };
  const [me, project, list, board, raisable] = await Promise.all([
    getMe(),
    getProject(projectId),
    // Names sort in the reader's language.
    view === "list" ? getWorkItems(projectId, module, { ...query, lang: locale }) : null,
    view === "kanban" ? getWorkItemBoard(projectId, module, query) : null,
    // The Snag List's "+ New" offers only the Types the viewer may raise (RP-94); the Submittals'
    // Import register only to a Member who may raise one of its Types (RP-637).
    snags || module === "submittals" ? getRaisableTypes(projectId, module) : null,
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !(list ?? board)) notFound();
  const title = tabs(module);

  if (snags) {
    const shared = { query, locale, tableLabel: title, projectId: project.id, newTypes: raisable?.types ?? [] };
    return (
      <>
        <h1 className="sr-only">{title}</h1>
        {board ? <SnagListView view="kanban" board={board} {...shared} /> : list && <SnagListView view="list" list={list} {...shared} />}
      </>
    );
  }

  // The MAR's Draft Step is held by Contractors; the API refuses anyone else too.
  const action =
    module === "submittals" && project.projectRole.baseRole === "contractor" ? (
      <Link href={`/projects/${project.id}/work-items/new`} className={cn(buttonVariants(), "h-[34px] px-3.5")}>
        <Icon name="plus" />
        {t("addSubmittal")}
      </Link>
    ) : undefined;
  // The Submittal Register Import (RP-637): offered only to a Member who may raise a Submittals Type
  // (the API refuses anyone else), with its Imports page, their Company's own.
  const imports = await getTranslations("registerImport");
  const moreActions =
    raisable && raisable.types.length > 0
      ? [
          {
            key: "import",
            label: imports("importRegister"),
            description: imports("importRegisterHint"),
            icon: "upload" as const,
            href: getPathname({ href: `/projects/${project.id}/work-items/import`, locale }),
          },
          { key: "imports", label: imports("imports"), icon: "history" as const, href: getPathname({ href: `/projects/${project.id}/work-items/imports`, locale }) },
        ]
      : undefined;

  return (
    <>
      {/* The top bar names the Project and its tabs the Module: the heading is for screen readers. */}
      <h1 className="sr-only">{title}</h1>
      {board ? (
        <WorkItemListOrKanban
          view="kanban"
          board={board}
          query={query}
          locale={locale}
          tableLabel={title}
          action={action}
          moreActions={moreActions}
          projectId={project.id}
          module={module}
          hints={hints}
        />
      ) : (
        list && (
          <WorkItemListOrKanban
            view="list"
            list={list}
            query={query}
            locale={locale}
            tableLabel={title}
            action={action}
            moreActions={moreActions}
            projectId={project.id}
            module={module}
            projectName={project.name[locale]}
            hints={hints}
          />
        )
      )}
    </>
  );
}
