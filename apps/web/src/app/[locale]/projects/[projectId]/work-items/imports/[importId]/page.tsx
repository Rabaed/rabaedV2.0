import { formatNumber, type Locale } from "@rabaed/domain";
import { Icon, StatTile } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageBackLink } from "@/components/page-back-link";
import { PackageUseBadge, RegisterImportCrumbs } from "@/components/register-import-crumbs";
import { RegisterImportBody, RegisterImportDownloads, SaveImportMapping } from "@/components/register-import-wizard";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getRaisableTypes, getRegisterImport, mayImportRegister } from "@/lib/session";

/**
 * One Submittal Register Import (RP-637, spec RP-631 story 33; RP-1144: the kit's
 * import-register.html › One import): who imported which file, its counts, each row's result
 * (the Draft it created, linked where the reader sees it, or every reason it was left out) and
 * the mapping used, which a Member who may import saves for their Company. Its Company's own
 * (RP-589-1). No time anywhere: when it ran is when its Drafts were started (scenario 61).
 */
export default async function RegisterImportPage({ params }: { params: Promise<{ locale: Locale; projectId: string; importId: string }> }) {
  const { locale, projectId, importId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("registerImport");
  const [me, project, record, raisable] = await Promise.all([getMe(), getProject(projectId), getRegisterImport(importId), getRaisableTypes(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !record || record.projectId !== project.id || record.status !== "created") notFound();
  const n = (value: number) => formatNumber(value, locale);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {/* Back (RP-1241), else to the Project's Imports. */}
        <PageBackLink parent={`/projects/${project.id}/work-items/imports`} />
        <RegisterImportCrumbs
          label={t("breadcrumb")}
          parts={[
            { text: t("crumbSubmittals"), href: `/projects/${project.id}/work-items` },
            { text: t("imports"), href: `/projects/${project.id}/work-items/imports` },
            { text: record.fileName },
          ]}
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-h3 font-bold">
              <bdi>{record.fileName}</bdi>
            </h1>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-text-secondary">
              {/* A Rabaed Engineer's import reads "Rabaed", never the Engineer (RP-645, RP-589-3). */}
              {record.runBy ? (
                <span>{record.runBy.name[locale]}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Icon name="shield-check" size={16} className="text-info-fg" />
                  {t("rabaed")}
                </span>
              )}
              <span>
                <span className="text-muted">{t("detail.sheet")}: </span>
                <bdi>{t("detail.worksheetValue", { worksheet: record.sheet, row: n(record.headerRow) })}</bdi>
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <RegisterImportDownloads record={record} locale={locale} />
            {mayImportRegister(raisable) && <SaveImportMapping projectId={project.id} mapping={record.mapping} />}
          </div>
        </div>
      </div>
      {/* RP-645: the Company reads that Rabaed imported it for them; never the Engineer, nor the reason, nor a time. */}
      {!record.runBy && (
        <p className="flex items-center gap-2 rounded-md bg-info-tint px-4 py-3 text-[14px] font-medium text-info-fg">
          <Icon name="shield-check" size={16} className="shrink-0" />
          {t("review.rabaedFor", { company: me.company.legalName[locale] })}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t("review.kpiCreated")} value={record.rowsCreated ?? 0} icon="circle-check" tone="success" locale={locale} />
        <StatTile label={t("review.kpiRejected")} value={record.rowsRejected} icon="alert-triangle" tone={record.rowsRejected > 0 ? "danger" : "neutral"} locale={locale} />
        {/* The Packages it created or added to: a list, so not a count tile, but laid out as one. */}
        <section aria-label={t("review.kpiPackages")} className="flex min-w-0 flex-col items-start gap-2.5 rounded-lg border border-border bg-surface px-5 py-[18px]">
          <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-[11px] bg-neutral-tint text-text-secondary">
            <Icon name="packages" size={20} />
          </span>
          {record.packages.length === 0 ? (
            <span className="text-[15px] text-muted">—</span>
          ) : (
            <span className="flex flex-wrap gap-x-3 gap-y-1.5 text-[15px]">
              {record.packages.map((p) => (
                <span key={p.package?.id ?? `new:${p.newName}`} className="inline-flex items-center gap-1.5">
                  <PackageUseBadge created={p.newName !== null} label={p.newName !== null ? t("review.new") : t("review.used")} />
                  {p.package ? (
                    <Link href={`/packages/${p.package.id}`} className="font-semibold text-brand-fg hover:underline">
                      <bdi dir="ltr" translate="no">
                        {p.package.number}
                      </bdi>
                    </Link>
                  ) : (
                    <bdi>{p.newName}</bdi>
                  )}
                </span>
              ))}
            </span>
          )}
          <span className="text-[13.5px] text-muted">{t("review.kpiPackages")}</span>
        </section>
      </div>
      <RegisterImportBody record={record} locale={locale} />
    </div>
  );
}
