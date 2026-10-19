"use client";

import type { Locale, PackageComment } from "@rabaed/domain";
import { PackageComments, type PackageCommentsLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import NextLink from "next/link";
import { getPathname } from "@/i18n/navigation";

/**
 * The Package page's Comments (RP-662), under its submittals: the Comments raised from them that
 * the Member sees (RP-647), for information, not part of the Package.
 */
export function PackageCommentsView({ comments, locale }: { comments: PackageComment[]; locale: Locale }) {
  const t = useTranslations("packages.comments");
  const labels = Object.fromEntries((["title", "forInformation", "notPartOf", "empty", "raisedFrom", "noNumber"] as const).map((key) => [key, t(key)])) as PackageCommentsLabels;
  return (
    <div className="mt-4">
      <PackageComments
        comments={comments}
        locale={locale}
        labels={labels}
        itemHref={(id) => getPathname({ href: `/work-items/${id}`, locale })}
        // The hrefs already carry their locale (getPathname): next/link keeps navigation client-side without adding it again.
        linkAs={NextLink}
      />
    </div>
  );
}
