import type { Locale } from "@rabaed/domain";
import { DocNo, Icon } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getWorkItemLink } from "@/lib/session";

/**
 * Where a Link opens (RP-521; visibility.md E1, the Links row), by the Link's own
 * id through the item it is linked from, never the linked item's. One the viewer
 * sees opens the item itself; one they can't is its Document Number and Subject,
 * and says only that they may not see its details: the API never gave its id, so
 * neither has the browser, and the item's own URL is still 404 to them. A Link
 * not theirs to read is not found, like one that doesn't exist.
 */
export default async function WorkItemLinkPage({ params }: { params: Promise<{ locale: Locale; workItemId: string; linkId: string }> }) {
  const { locale, workItemId, linkId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workItems.links");
  const [me, link] = await Promise.all([getMe(), getWorkItemLink(workItemId, linkId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!link) notFound();
  if (link.workItemId) return redirect({ href: `/work-items/${link.workItemId}`, locale });

  return (
    <div className="max-w-3xl space-y-6" data-testid="hidden-link">
      <Link href={`/work-items/${workItemId}`} className="text-sm text-brand-fg underline underline-offset-4">
        {t("linkPage.back")}
      </Link>
      <h1 className="text-h4 font-semibold">{t("linkPage.title")}</h1>
      <div className="flex flex-col gap-2 rounded-md border border-border p-4">
        <DocNo value={link.documentNumber} className="text-sm text-text" />
        <p className="text-body text-text">
          <bdi>{link.subject}</bdi>
        </p>
        <p role="note" className="flex items-center gap-2 text-sm text-muted">
          <Icon name="lock" size={16} className="shrink-0" />
          {t("hidden")}
        </p>
      </div>
    </div>
  );
}
