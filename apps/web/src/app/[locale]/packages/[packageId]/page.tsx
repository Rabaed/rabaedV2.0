import { workItemQuery, type Locale, type WorkItemList, type WorkItemRow } from "@rabaed/domain";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PackageView } from "@/components/package-view";
import { redirect } from "@/i18n/navigation";
import { getMe, getPackage, getWorkItems } from "@/lib/session";

/** The most pages of 50 a Package's table reads: 1,000 submittals. */
const maxPages = 20;

/**
 * One Package (RP-659, spec RP-616), at the path its notifications and emails link to
 * (RP-643). One the Member can't see is not found, exactly like one that doesn't exist
 * (visibility.md "Packages"). Its submittals are the ones they see, read as the List reads
 * them (the work item query's `packageId`, RP-647), Revisions included.
 */
export default async function PackagePage({ params }: { params: Promise<{ locale: Locale; packageId: string }> }) {
  const { locale, packageId } = await params;
  setRequestLocale(locale);
  const [me, pkg] = await Promise.all([getMe(), getPackage(packageId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!pkg) notFound();

  const rows: WorkItemRow[] = [];
  let read: WorkItemList | null = null;
  for (let page = 1; page <= maxPages; page++) {
    const query = workItemQuery.parse({ packageId: pkg.id, allRevisions: true, sort: "documentNumber", page, pageSize: 50, lang: locale });
    read = await getWorkItems(pkg.projectId, "submittals", query);
    if (!read) break;
    rows.push(...read.items);
    if (!read.page?.hasNext) break;
  }
  const filters = read?.filters ?? { outcomes: [], locations: [], trades: [] };

  return (
    <PackageView
      pkg={pkg}
      rows={rows}
      filters={{ outcomes: filters.outcomes, locations: filters.locations, trades: filters.trades }}
      locale={locale}
    />
  );
}
