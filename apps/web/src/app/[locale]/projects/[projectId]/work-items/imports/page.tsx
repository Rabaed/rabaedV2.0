import { formatNumber, type Locale, type RegisterImportListed } from "@rabaed/domain";
import {
  EmptyState,
  Icon,
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  buttonVariants,
  cn,
  mappedColumns,
} from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageBackLink } from "@/components/page-back-link";
import { PackageUseBadge, RegisterImportCrumbs } from "@/components/register-import-crumbs";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getRaisableTypes, getRegisterImportFields, getRegisterImports, mayImportRegister } from "@/lib/session";

/**
 * The Imports page (RP-637, spec RP-631 stories 32–33; RP-1144: the kit's import-register.html ›
 * Imports): the Project's Submittal Register Imports of the Member's own Company, by file name,
 * each with the Packages its Drafts went to, "New" or "Used": every Member's of it, one who may
 * not import included (story 32); "Import register" only to one who may (story 4). No time: when
 * an import was confirmed is when its Drafts were started, which nobody sees (visibility.md
 * scenario 61). Beside them, the Company's saved mappings, to a Member who may import: never
 * with who saved one or when (visibility.md, Submittal Register Imports).
 */
export default async function RegisterImportsPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("registerImport");
  const [me, project, imports, raisable] = await Promise.all([getMe(), getProject(projectId), getRegisterImports(projectId), getRaisableTypes(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !imports) notFound();
  const mayImport = mayImportRegister(raisable);
  // The saved mappings come with what a register may fill: only for a Member who may import.
  const fields = mayImport ? await getRegisterImportFields(projectId) : null;
  const n = (value: number) => formatNumber(value, locale);
  const company = me.company.legalName[locale];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          {/* Back (RP-1241), else to the Submittals with the Member's last filters there (RP-1240). */}
          <PageBackLink parent={`/projects/${project.id}/work-items`} />
          <RegisterImportCrumbs
            label={t("breadcrumb")}
            parts={[{ text: t("crumbSubmittals"), href: `/projects/${project.id}/work-items` }, { text: t("imports") }]}
          />
          <h1 className="text-h3 font-bold">{t("imports")}</h1>
          <p className="text-[14px] text-muted">{t("importsHint")}</p>
        </div>
        {mayImport && (
          <Link href={`/projects/${project.id}/work-items/import`} className={cn(buttonVariants(), "h-[34px] px-3.5")}>
            <Icon name="upload" />
            {t("importRegister")}
          </Link>
        )}
      </div>
      <p className="flex items-center gap-2 rounded-md bg-surface-subtle px-4 py-2.5 text-[13px] text-text-secondary">
        <Icon name="lock" size={14} className="shrink-0" />
        {t("privacy", { company })}
      </p>
      <Tabs defaultValue="imports">
        <TabsList aria-label={t("imports")}>
          <TabsTrigger value="imports" count={n(imports.imports.length)}>
            {t("review.tabImports")}
          </TabsTrigger>
          {fields && (
            <TabsTrigger value="saved" count={n(fields.mappings.length)}>
              {t("review.tabSaved")}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="imports" className="pt-4">
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
                  <TableHead className="w-10">
                    <span className="sr-only">{t("review.open")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.imports.length === 0 ? (
                  <TableEmpty colSpan={7}>
                    <EmptyState icon="upload" title={t("list.emptyTitle")}>
                      {t("list.empty")}
                    </EmptyState>
                  </TableEmpty>
                ) : (
                  imports.imports.map((i) => <ImportRow key={i.id} projectId={project.id} item={i} locale={locale} t={t} />)
                )}
              </TableBody>
            </Table>
          </TableCard>
        </TabsContent>
        {fields && (
          <TabsContent value="saved" className="flex flex-col gap-3 pt-4">
            <TableCard>
              <Table label={t("review.tabSaved")}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("review.savedMapping")}</TableHead>
                    <TableHead align="end">{t("review.savedColumns")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("review.savedUse")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.mappings.length === 0 ? (
                    <TableEmpty colSpan={3}>
                      <EmptyState icon="template" title={t("review.tabSaved")}>
                        {t("review.savedEmpty")}
                      </EmptyState>
                    </TableEmpty>
                  ) : (
                    fields.mappings.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <span className="inline-flex items-center gap-2 font-semibold">
                            <Icon name="template" size={16} className="text-muted" />
                            <bdi>{m.name}</bdi>
                          </span>
                        </TableCell>
                        <TableCell align="end" className="tabular-nums">
                          {n(mappedColumns(m.mapping).length)}
                        </TableCell>
                        <TableCell align="end">
                          <Link href={`/projects/${project.id}/work-items/import?mapping=${m.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            {t("review.savedUse")}
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableCard>
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Icon name="info-circle" size={14} className="shrink-0" />
              {t("review.savedHelp", { company })}
            </p>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

/** One import: the whole row opens it (its file name is the link). */
function ImportRow({
  projectId,
  item,
  locale,
  t,
}: {
  projectId: string;
  item: RegisterImportListed;
  locale: Locale;
  t: Awaited<ReturnType<typeof getTranslations<"registerImport">>>;
}) {
  const n = (value: number) => formatNumber(value, locale);
  return (
    <TableRow className="relative cursor-pointer">
      <TableCell>
        <Link
          href={`/projects/${projectId}/work-items/imports/${item.id}`}
          className="inline-flex items-center gap-2 font-semibold text-brand-fg after:absolute after:inset-0 hover:underline"
        >
          <Icon name="table" size={16} />
          <bdi>{item.fileName}</bdi>
        </Link>
      </TableCell>
      {/* A Rabaed Engineer's import reads "Rabaed", never the Engineer (RP-645, RP-589-3). */}
      <TableCell>
        {item.runBy ? (
          item.runBy.name[locale]
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Icon name="shield-check" size={16} className="text-info-fg" />
            {t("rabaed")}
          </span>
        )}
      </TableCell>
      <TableCell align="end" className="tabular-nums">
        {n(item.rowsTotal)}
      </TableCell>
      <TableCell align="end" className="font-semibold tabular-nums text-success-fg">
        {n(item.rowsCreated ?? 0)}
      </TableCell>
      <TableCell align="end" className={cn("font-semibold tabular-nums", item.rowsRejected > 0 ? "text-danger-fg" : "text-muted")}>
        {n(item.rowsRejected)}
      </TableCell>
      {/* The Packages its Drafts went to (story 32), the Company's own: created ("New") or added to ("Used"), RP-1144. */}
      <TableCell className="max-w-80">
        {item.packages.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {item.packages.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 text-[13px]">
                <PackageUseBadge created={p.new} label={p.new ? t("review.new") : t("review.used")} />
                <bdi dir="ltr" translate="no" className="font-semibold">
                  {p.number}
                </bdi>
              </span>
            ))}
          </span>
        )}
      </TableCell>
      <TableCell className="text-muted">
        <Icon name="chevron-right" size={16} className="rtl:rotate-180" />
      </TableCell>
    </TableRow>
  );
}
