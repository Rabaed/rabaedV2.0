import { formatNumber, type Locale } from "@rabaed/domain";
import { Icon, SettingsHeader, SettingsSection } from "@rabaed/ui";
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
export default async function WorkflowVersionsPage({ params }: { params: Promise<Params> }) {
  const { locale, projectId, workflowId, versionNo: raw } = await params;
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
      <SettingsSection title={t("versionsList")}>
        <ul className="flex flex-wrap gap-2" aria-label={t("versionsList")}>
          {read.publishedVersions.map((n) => (
            <li key={n}>
              <Link
                href={`${base}/${workflowId}/versions/${n}`}
                aria-current={n === versionNo ? "page" : undefined}
                className={
                  n === versionNo
                    ? "inline-flex h-8 items-center rounded-sm bg-brand-tint px-3 text-sm font-semibold text-brand-fg"
                    : "inline-flex h-8 items-center rounded-sm border border-border px-3 text-sm font-medium text-text-secondary hover:bg-hover"
                }
              >
                {t("version", { n: formatNumber(n, locale) })}
              </Link>
            </li>
          ))}
        </ul>
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
