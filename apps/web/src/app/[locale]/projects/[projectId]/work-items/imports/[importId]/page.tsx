import { formatNumber, type Locale } from "@rabaed/domain";
import { Icon, KeyValues, TableCard } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ImportRows } from "@/components/register-import-rows";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getRegisterImport } from "@/lib/session";

/**
 * One Submittal Register Import (RP-637, spec RP-631 story 33): who imported which file,
 * how it was mapped, and each row's result: the Draft it created (linked where the
 * reader sees it) or every reason it was left out. Its Company's own (RP-589-1).
 */
export default async function RegisterImportPage({ params }: { params: Promise<{ locale: Locale; projectId: string; importId: string }> }) {
  const { locale, projectId, importId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("registerImport");
  const [me, project, record] = await Promise.all([getMe(), getProject(projectId), getRegisterImport(importId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !record || record.projectId !== project.id || record.status !== "created") notFound();
  const n = (value: number) => formatNumber(value, locale);
  const columnOf = (field: { column: number } | { value: string }, fixed: (value: string) => string) =>
    "column" in field ? (record.headers[field.column] ?? "—") : fixed(field.value);
  const fixedTrade = (id: string) => record.rows.find((r) => r.trade.match?.id === id)?.trade.match?.name[locale] ?? "—";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={`/projects/${project.id}/work-items/imports`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text hover:underline">
          <Icon name="arrow-left" size={14} />
          {t("imports")}
        </Link>
        <h1 className="text-h3 font-bold">
          <bdi>{record.fileName}</bdi>
        </h1>
      </div>
      <div className="rounded-md border border-border bg-surface px-5 py-4">
        <KeyValues
          items={[
            { key: "by", label: t("list.importedBy"), value: record.runBy.name[locale] },
            { key: "sheet", label: t("detail.sheet"), value: <bdi>{record.sheet}</bdi> },
            { key: "headerRow", label: t("detail.headerRow"), value: n(record.headerRow) },
            { key: "subject", label: t("fields.subject"), value: <bdi>{columnOf(record.mapping.subject, () => "—")}</bdi> },
            { key: "type", label: t("fields.type"), value: <bdi>{columnOf(record.mapping.type, (v) => t("detail.everyRow", { value: v }))}</bdi> },
            { key: "trade", label: t("fields.trade"), value: <bdi>{columnOf(record.mapping.trade, (v) => t("detail.everyRow", { value: fixedTrade(v) }))}</bdi> },
            { key: "rows", label: t("list.rows"), value: n(record.rowsTotal) },
            { key: "created", label: t("list.created"), value: n(record.rowsCreated ?? 0) },
            { key: "leftOut", label: t("list.leftOut"), value: n(record.rowsRejected) },
          ]}
        />
      </div>
      <TableCard>
        <ImportRows rows={record.rows} label={t("detail.rows")} locale={locale} results />
      </TableCard>
    </div>
  );
}
