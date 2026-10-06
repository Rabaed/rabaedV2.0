"use client";

import { workItemSearchParams, type Locale, type WorkItemList as WorkItemListData, type WorkItemQuery } from "@rabaed/domain";
import { WorkItemList } from "@rabaed/ui";
import { usePathname, useRouter } from "next/navigation";
import { getPathname } from "@/i18n/navigation";

/**
 * The List with its toolbar: every filter, sort and page is the page's own
 * URL, so a view can be bookmarked or shared and the back button undoes a filter.
 */
export function WorkItemListView({ list, query, locale }: { list: WorkItemListData; query: WorkItemQuery; locale: Locale }) {
  const router = useRouter();
  // The path with its locale, as the browser shows it.
  const pathname = usePathname();
  const hrefFor = (q: WorkItemQuery) => {
    const params = workItemSearchParams(q).toString();
    return params ? `${pathname}?${params}` : pathname;
  };
  return (
    <WorkItemList
      list={list}
      query={query}
      locale={locale}
      hrefFor={hrefFor}
      itemHref={(id) => getPathname({ href: `/work-items/${id}`, locale })}
      onQueryChange={(q) => router.push(hrefFor(q))}
    />
  );
}
