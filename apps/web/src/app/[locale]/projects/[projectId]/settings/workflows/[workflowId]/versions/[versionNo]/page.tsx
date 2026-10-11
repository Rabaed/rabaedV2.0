import { formatDate, formatNumber, type Locale } from "@rabaed/domain";
import { Badge, Icon, SettingsHeader, SettingsSection } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { WorkflowVersionMap } from "@/components/workflow-version-map";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getScreenPins, getWorkflowVersion } from "@/lib/session";

type Params = { locale: Locale; projectId: string; workflowId: string; versionNo: string };

/**
 * Project → Settings → Workflows → View versions (RP-441): each published Version of a
 * Workflow as a read-only map, with the Screen Versions it pins. Every Project Member
 * reads it (V20, ADR 0016); a Workflow of another Project, a Library's and a Version that
 * isn't published are the not-found page, as the API answers them.
 */
export default async function WorkflowVersionsPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ published?: string }> }) {
  const { locale, projectId, workflowId, versionNo: raw } = await params;
  // Just published from the builder (RP-555): say so, as the reference's toast.
  const justPublished = (await searchParams).published !== undefined;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.workflows");
  const versionNo = Number(raw);
  if (!Number.isInteger(versionNo)) notFound();
  const [me, read, pins] = await Promise.all([getMe(), getWorkflowVersion(workflowId, versionNo), getScreenPins(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!read) notFound();
  const base = `/projects/${projectId}/settings/workflows`;
  const pinned = (pins?.pins ?? []).filter((p) => p.workflowId === workflowId && p.workflowVersionNo === versionNo);

  return (
    <>
      <SettingsHeader
        title={t("versionsTitle", { name: read.name[locale], n: formatNumber(versionNo, locale) })}
        description={t("versionsIntro")}
        actions={
          <Link href={base} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-fg hover:underline">
            <Icon name="arrow-left" size={15} />
            {t("backToWorkflows")}
          </Link>
        }
      />
      {justPublished && (
        <p role="status" className="flex items-center gap-2 rounded-md bg-success-tint px-3 py-2.5 text-sm font-semibold text-success-fg">
          <Icon name="circle-check" size={16} />
          {t("historyJustPublished", { n: formatNumber(versionNo, locale) })}
        </p>
      )}
      <SettingsSection title={t("versionsList")}>
        {/* The reference's Versions & history (RP-555): newest first, each with its change note (its authors only) and the items the reader sees on it. */}
        <ol className="flex flex-col" aria-label={t("versionsList")}>
          {read.history.map((h, i) => (
            <li key={h.versionNo} className="relative flex gap-3.5 pb-4">
              {i < read.history.length - 1 && <span aria-hidden="true" className="absolute start-[13px] top-[30px] bottom-0 w-0.5 bg-border-subtle" />}
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-[11px] font-bold text-on-primary" dir="ltr">
                v{formatNumber(h.versionNo, locale)}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3">
                <div className="min-w-56 flex-1">
                  <p className="m-0 flex items-center gap-2 text-sm font-bold">
                    <Link
                      href={`${base}/${workflowId}/versions/${h.versionNo}`}
                      aria-current={h.versionNo === versionNo ? "page" : undefined}
                      className="hover:underline aria-[current=page]:text-brand-fg"
                    >
                      {t("version", { n: formatNumber(h.versionNo, locale) })}
                    </Link>
                    <Badge tone="success">{t("historyPublished")}</Badge>
                    {h.versionNo === versionNo && <span className="text-caption font-medium text-muted">{t("historyViewing")}</span>}
                  </p>
                  <p className="m-0 mt-0.5 text-caption text-muted">{formatDate(new Date(h.publishedAt), locale, { dateStyle: "medium" })}</p>
                  {h.changeNote && <p className="m-0 mt-1.5 text-sm whitespace-pre-line">{h.changeNote}</p>}
                </div>
                <span className="rounded-[5px] bg-surface-subtle px-1.5 py-px text-caption font-semibold text-muted shadow-[inset_0_0_0_1px_var(--border-subtle)]">
                  {t("historyRunning", { count: h.running, n: formatNumber(h.running, locale) })}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </SettingsSection>
      <SettingsSection title={t("versionMap", { n: formatNumber(versionNo, locale) })}>
        <WorkflowVersionMap read={read} locale={locale} />
      </SettingsSection>
      <SettingsSection title={t("pinnedScreens")} description={t("pinnedScreensIntro")}>
        {pinned.length === 0 ? (
          <p className="text-sm text-muted">{t("noPinnedScreens")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pinned.map((p) => (
              <li key={p.screenId} className="flex items-center gap-2 text-sm">
                <Link href={`/projects/${projectId}/settings/screens/${p.screenId}`} className="font-semibold text-brand-fg hover:underline">
                  {p.screenKey}
                </Link>
                <span className="text-muted">{t("version", { n: formatNumber(p.screenVersionNo, locale) })}</span>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </>
  );
}
