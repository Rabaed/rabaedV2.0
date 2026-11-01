import { moduleViewFromSearchParams, workItemQueryFromSearchParams, workItemViewFromSearchParams, type Locale, type ModuleKey } from "@rabaed/domain";
import { Icon, buttonVariants, cn } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { PackagesBoardView } from "@/components/packages-board-view";
import { SnagListView } from "@/components/snag-list-view";
import { WorkItemListOrKanban } from "@/components/work-item-list-or-kanban";
import { listQueryFromSearchParams, snagListSort } from "@/lib/list-url";
import { newItemHref } from "@/lib/new-item-route";
import { Link, getPathname, redirect } from "@/i18n/navigation";
import { ReadFailed } from "@/components/read-failed";
import { pageOutcome, valueOf } from "@/lib/api-read";
import { getMe, readPackages, getRegisterImports, getRaisableTypes, readWorkItemBoard, readWorkItems, readProject } from "@/lib/session";

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
  // A slow or failed read says so and offers Try again, under the page's heading (RP-1049).
  const readFailed = (
    <>
      <h1 className="sr-only">{tabs(module)}</h1>
      <ReadFailed />
    </>
  );
  // The Submittals' Packages view (RP-660): the Project's Packages the Member sees, as a Kanban of their status.
  if (moduleViewFromSearchParams(searchParams, module) === "packages") {
    const [me, projectRead, packagesRead, raisable, otherBoard] = await Promise.all([
      getMe(),
      readProject(projectId),
      readPackages(projectId),
      getRaisableTypes(projectId, module),
      // The filter fields' names in the other language, small after each (RP-953, as the List's).
      getTranslations({ locale: locale === "en" ? "ar" : "en", namespace: "packages.board" }),
    ]);
    if (!me) return redirect({ href: "/sign-in", locale });
    // Only the api's own "not there" is not found (RP-1049).
    const outcome = pageOutcome(projectRead, [packagesRead]);
    if (outcome === "failed") return readFailed;
    const project = valueOf(projectRead);
    const packages = valueOf(packagesRead);
    if (outcome === "not-found" || !project || !packages) notFound();
    return (
      <>
        <h1 className="sr-only">{tabs(module)}</h1>
        {/* "+ New Package" for a Member who may raise a Submittals Type: a Package holds their Participant's submittals (the API checks again). */}
        <PackagesBoardView
          packages={packages.packages}
          projectId={project.id}
          canCreate={(raisable?.types.length ?? 0) > 0}
          hints={{ trade: otherBoard("trade"), company: otherBoard("company") }}
        />
      </>
    );
  }
  // The filter fields' names in the other language, small after each (the owner's anatomy, RP-410).
  const other = await getTranslations({ locale: locale === "en" ? "ar" : "en", namespace: "workItemViews.list" });
  const hints = {
    stage: other("statusField"),
    ...Object.fromEntries(
      (["trade", "documentType", "owner", "role", "createdDate", "stepAge", "outcome", "submissionDate", "revisions", "package"] as const).map((key) => [key, other(key)]),
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
  const [me, projectRead, listRead, boardRead, raisable, packagesRead, registerImports] = await Promise.all([
    getMe(),
    readProject(projectId),
    // Names sort in the reader's language.
    view === "list" ? readWorkItems(projectId, module, { ...query, lang: locale }) : null,
    view === "kanban" ? readWorkItemBoard(projectId, module, query) : null,
    // The Snag List's "+ New" offers only the Types the viewer may raise (RP-94); the Submittals'
    // Import register only to a Member who may raise one of its Types (RP-637); the Inspections'
    // New Inspection the same (RP-1179).
    snags || module === "submittals" || module === "inspections" ? getRaisableTypes(projectId, module) : null,
    // The Submittals' Package filter (RP-662): only the Packages the Member sees.
    module === "submittals" ? readPackages(projectId) : null,
    // One import's Drafts (RP-954, "Open the Drafts"): the import named by its file name, from the
    // Imports page's list, which holds only the Member's own Company's. No time.
    query.importId ? getRegisterImports(projectId) : null,
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // A slow or failed read of the Project or its items says so and offers Try again; only the
  // api's own "not there" (a hidden Project, a Module it has no Type in) is not found (RP-1049).
  // The Package filter is extra: without it the List still shows.
  const outcome = pageOutcome(projectRead, [listRead ?? boardRead]);
  if (outcome === "failed") return readFailed;
  const project = valueOf(projectRead);
  const list = valueOf(listRead);
  const board = valueOf(boardRead);
  const packages = valueOf(packagesRead);
  if (outcome === "not-found" || !project || !(list ?? board)) notFound();
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

  // The MAR's Draft Step is held by Contractors; the API refuses anyone else too. An Inspection
  // (a WIR) is raised from its own tab, by a Member who may raise one of its Types, on the New
  // WIR page, never the Submittals' New page (RP-1179).
  const newLink = (to: "submittals" | "inspections", label: string) => (
    <Link href={newItemHref(project.id, to)} className={cn(buttonVariants(), "h-[34px] px-3.5")}>
      <Icon name="plus" />
      {label}
    </Link>
  );
  const action =
    module === "submittals" && project.projectRole.baseRole === "contractor"
      ? newLink("submittals", t("addSubmittal"))
      : module === "inspections" && (raisable?.types.length ?? 0) > 0
        ? newLink("inspections", t("newInspection"))
        : undefined;
  // The Submittal Register Import (RP-637): offered only to a Member who may raise a Submittals Type
  // (story 4; the API refuses anyone else). Its Imports page, their Company's own, to every
  // Member on the Project (story 32).
  const imports = await getTranslations("registerImport");
  const moreActions =
    module === "submittals"
      ? [
          ...(raisable && raisable.types.length > 0
            ? [
                {
                  key: "import",
                  label: imports("importRegister"),
                  description: imports("importRegisterHint"),
                  icon: "upload" as const,
                  href: getPathname({ href: `/projects/${project.id}/work-items/import`, locale }),
                },
              ]
            : []),
          { key: "imports", label: imports("imports"), icon: "history" as const, href: getPathname({ href: `/projects/${project.id}/work-items/imports`, locale }) },
        ]
      : undefined;

  // The chip naming the import the List is filtered to (RP-954); its name only where the Member reads it.
  const importFilter = query.importId
    ? { label: imports("listFilter"), name: registerImports?.imports.find((i) => i.id === query.importId)?.fileName ?? null }
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
          packages={packages?.packages}
          importFilter={importFilter}
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
            packages={packages?.packages}
            importFilter={importFilter}
          />
        )
      )}
    </>
  );
}
