"use client";

import type { BilingualText, CreatedPackage, Locale, ModuleView, PackageSummary } from "@rabaed/domain";
import { PackagesBoard, WorkItemViewSwitch, type PackagesBoardLabels } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
// The hrefs here already carry their locale (the browser's own path, getPathname): next/link keeps navigation
// client-side without adding the locale again.
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getPathname } from "@/i18n/navigation";

/** The Packages view's words, from the app's messages. */
function usePackagesBoardLabels(): PackagesBoardLabels {
  const t = useTranslations("packages");
  const say = (key: string) => t(key);
  const keys = <K extends string>(prefix: string, list: readonly K[]) => Object.fromEntries(list.map((k) => [k, say(`${prefix}.${k}`)])) as Record<K, string>;
  return {
    board: t("board.board"),
    toolbar: t("board.toolbar"),
    status: keys("status", ["open", "in_progress", "done"] as const),
    noPackages: t("board.noPackages"),
    ownedBy: t("ownedBy"),
    code: (code) => t("code", { code }),
    stillOpen: t("stillOpen"),
    closedOf: (closed, total) => t("closedOf", { closed, total }),
    close: t("close"),
    cancel: t("cancel"),
    refusals: keys("refusals", ["unavailable", "project_closed", "invalid_name"] as const),
    create: keys("create", ["trigger", "title", "description", "nameEn", "nameAr", "required", "save"] as const),
  };
}

/**
 * The Submittals' Packages view (RP-660, spec RP-616 story 29): the Project's Packages the
 * Member sees, as the board API gives them (RP-641), with the View switch beside List and
 * Kanban. "+ New Package" (story 1) for a Member who may raise a Submittals Type; the API
 * numbers it for their own Participant, and the new Package's page opens.
 */
export function PackagesBoardView({ packages, projectId, canCreate }: { packages: PackageSummary[]; projectId: string; canCreate: boolean }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("workItemViews");
  const labels = usePackagesBoardLabels();
  const router = useRouter();
  // The path with its locale, as the browser shows it.
  const pathname = usePathname();
  const hrefFor = (v: ModuleView) => (v === "list" ? pathname : `${pathname}?view=${v}`);
  const onCreate = async (name: BilingualText) => {
    const res = await fetch(`/api/v1/projects/${projectId}/packages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false as const, reason: error ?? "unavailable" };
    }
    const created = (await res.json()) as CreatedPackage;
    router.push(getPathname({ href: `/packages/${created.id}`, locale }));
    return { ok: true as const };
  };
  return (
    <PackagesBoard
      packages={packages}
      locale={locale}
      labels={labels}
      packageHref={(id) => getPathname({ href: `/packages/${id}`, locale })}
      linkAs={NextLink}
      onCreate={canCreate ? onCreate : undefined}
      viewSwitch={
        <WorkItemViewSwitch
          view="packages"
          views={["kanban", "list", "packages"]}
          labels={{ view: t("viewSwitch.view"), list: t("viewSwitch.list"), kanban: t("viewSwitch.kanban"), packages: t("viewSwitch.packages") }}
          hrefFor={hrefFor}
          linkAs={NextLink}
        />
      }
    />
  );
}
