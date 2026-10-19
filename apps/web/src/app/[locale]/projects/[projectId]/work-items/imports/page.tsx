import { formatNumber, type Locale } from "@rabaed/domain";
import { EmptyState, Icon, PackageCell, Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow, buttonVariants, cn } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getRaisableTypes, getRegisterImports } from "@/lib/session";

/**
 * The Imports page (RP-637, spec RP-631 stories 32–33; the Submittals List's pattern,
 * RP-634 has no screen for it): the Project's Submittal Register Imports of the Member's
 * own Company, by file name, each with the Packages its Drafts went to: every Member's of
 * it, one who may not import included (story 32); "Import register" only to one who may
 * (story 4). No time: when an import was confirmed is when its Drafts were started, which
 * nobody sees (visibility.md scenario 61).
 */
export default async function RegisterImportsPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("registerImport");
  const [me, project, imports, raisable] = await Promise.all([getMe(), getProject(projectId), getRegisterImports(projectId), getRaisableTypes(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !imports) notFound();
  const n = (value: number) => formatNumber(value, locale);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href={`/projects/${project.id}/work-items`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text hover:underline">
            <Icon name="arrow-left" size={14} />
            {t("backToSubmittals")}
          </Link>
          <h1 className="text-h3 font-bold">{t("imports")}</h1>
          <p className="text-[14px] text-muted">{t("importsHint")}</p>
        </div>
        {raisable && raisable.types.length > 0 && (
          <Link href={`/projects/${project.id}/work-items/import`} className={cn(buttonVariants(), "h-[34px] px-3.5")}>
            <Icon name="upload" />
            {t("importRegister")}
          </Link>
        )}
      </div>
      <TableCard>
        <Table label={t("imports")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("list.file")}</TableHead>
              <TableHead>{t("list.importedBy")}</TableHead>
              <TableHead align="end">{t("list.rows")}</TableHead>
              <TableHead align="end">{t("list.created")}</TableHead>
              <TableHead align="end">{t("list.leftOut")}</TableHead>
              <TableHead>{t("list.packages")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports.imports.length === 0 ? (
              <TableEmpty colSpan={6}>
                <EmptyState icon="upload" title={t("list.emptyTitle")}>
                  {t("list.empty")}
                </EmptyState>
              </TableEmpty>
            ) : (
              imports.imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/projects/${project.id}/work-items/imports/${i.id}`} className="inline-flex items-center gap-2 font-semibold text-brand-fg hover:underline">
                      <Icon name="table" size={16} />
                      <bdi>{i.fileName}</bdi>
                    </Link>
                  </TableCell>
                  {/* A Rabaed Engineer's import reads "Rabaed", never the Engineer (RP-645, RP-589-3). */}
                  <TableCell>{i.runBy?.name[locale] ?? t("rabaed")}</TableCell>
                  <TableCell align="end" className="tabular-nums">
                    {n(i.rowsTotal)}
                  </TableCell>
                  <TableCell align="end" className="tabular-nums text-success-fg">
                    {n(i.rowsCreated ?? 0)}
                  </TableCell>
                  <TableCell align="end" className={cn("tabular-nums", i.rowsRejected > 0 && "text-danger-fg")}>
                    {n(i.rowsRejected)}
                  </TableCell>
                  {/* The Packages its Drafts went to, created or added to (story 32): the Company's own. */}
                  <TableCell className="max-w-72">
                    {i.packages.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="flex flex-col gap-1">
                        {i.packages.map((p) => (
                          <PackageCell key={p.id} value={{ text: "", match: p, new: null }} locale={locale} newLabel={t("validate.newPackage")} />
                        ))}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
