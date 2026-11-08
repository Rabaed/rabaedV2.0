import { formatNumber, type Locale } from "@rabaed/domain";
import { Icon, cn } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageBackLink } from "@/components/page-back-link";
import { RegisterImportBody, RegisterImportDownloads, SaveImportMapping } from "@/components/register-import-wizard";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getRaisableTypes, getRegisterImport } from "@/lib/session";

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
  const mayImport = raisable !== null && raisable.types.length > 0;
  const created = record.rowsCreated ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {/* Back (RP-1241), else to the Project's Imports. */}
        <PageBackLink parent={`/projects/${project.id}/work-items/imports`} />
        <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-[13px] text-muted">
          <Link href={`/projects/${project.id}/work-items`} className="hover:text-text hover:underline">
            {t("crumbSubmittals")}
          </Link>
          <Icon name="chevron-right" size={14} className="rtl:rotate-180" />
          <Link href={`/projects/${project.id}/work-items/imports`} className="hover:text-text hover:underline">
            {t("imports")}
          </Link>
          <Icon name="chevron-right" size={14} className="rtl:rotate-180" />
          <bdi className="truncate font-semibold text-text">{record.fileName}</bdi>
        </nav>
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
              <bdi>{t("detail.worksheetValue", { worksheet: record.sheet, row: n(record.headerRow) })}</bdi>
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <RegisterImportDownloads record={record} locale={locale} />
            {mayImport && <SaveImportMapping projectId={project.id} mapping={record.mapping} />}
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
        <Kpi value={n(created)} label={t("review.kpiCreated")} tone="success" />
        <Kpi value={n(record.rowsRejected)} label={t("review.kpiRejected")} tone={record.rowsRejected > 0 ? "danger" : "neutral"} />
        <Kpi
          value={
            record.packages.length === 0 ? (
              "—"
            ) : (
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-[15px]">
                {record.packages.map((p) => (
                  <span key={p.package?.id ?? `new:${p.newName}`} className="inline-flex items-center gap-1.5">
                    <span className={cn("rounded-xs px-1.5 py-0.5 text-[11.5px] font-bold", p.newName !== null ? "bg-success-tint text-success-fg" : "bg-info-tint text-info-fg")}>
                      {p.newName !== null ? t("review.new") : t("review.used")}
                    </span>
                    {p.package ? (
                      <Link href={`/packages/${p.package.id}`} className="text-brand-fg hover:underline">
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
            )
          }
          label={t("review.kpiPackages")}
        />
      </div>
      <RegisterImportBody record={record} locale={locale} />
    </div>
  );
}

function Kpi({ value, label, tone = "neutral" }: { value: ReactNode; label: string; tone?: "neutral" | "success" | "danger" }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-4 py-3">
      <div className={cn("text-[28px] leading-tight font-bold tabular-nums", tone === "success" && "text-success-fg", tone === "danger" && "text-danger-fg")}>{value}</div>
      <p className="text-[13px] text-muted">{label}</p>
    </div>
  );
}
