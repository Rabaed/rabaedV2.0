import { formatNumber, type Locale } from "@rabaed/domain";
import { Icon, buttonVariants } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageBackLink } from "@/components/page-back-link";
import { RegisterImportCrumbs } from "@/components/register-import-crumbs";
import { RegisterImportWizard } from "@/components/register-import-wizard";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getMyVisibility, getProject, getRaisableTypes, getRegisterImport, getRegisterImportFields, getRegisterImports } from "@/lib/session";

/**
 * The Submittals Module's "Import register" (RP-637, spec RP-631): the wizard that
 * creates Drafts from the Member's own register. Only for a Member who may raise a
 * Submittals Type; the fixed Trade offers only the Trades their Visibility covers. What a
 * register may fill (RP-639: Scopes, Location, Paper ref, Form fields, and the values to
 * match) comes from the API's register-imports/fields. `?preview=<id>` reopens the Member's own preview at Validate (the API answers it to
 * its importer only).
 */
export default async function ImportRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
  searchParams: Promise<{ preview?: string; mapping?: string }>;
}) {
  const { locale, projectId } = await params;
  const { preview: previewId, mapping: mappingId } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("registerImport");
  const [me, project, raisable, mine, fields, preview, imports] = await Promise.all([
    getMe(),
    getProject(projectId),
    getRaisableTypes(projectId),
    getMyVisibility(projectId),
    getRegisterImportFields(projectId),
    typeof previewId === "string" ? getRegisterImport(previewId) : null,
    getRegisterImports(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !raisable || !mine || !fields || raisable.types.length === 0) notFound();
  if (preview && preview.projectId === project.id && preview.status === "created") {
    return redirect({ href: `/projects/${project.id}/work-items/imports/${preview.id}`, locale });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Back (RP-1241), else to the Submittals with the Member's last filters there (RP-1240). */}
      <PageBackLink parent={`/projects/${project.id}/work-items`} />
      {/* RP-1144 (the kit's import-register.html): Submittals › Import register, and the Imports with their count. */}
      <RegisterImportCrumbs
        label={t("breadcrumb")}
        parts={[{ text: t("crumbSubmittals"), href: `/projects/${project.id}/work-items` }, { text: t("importRegister") }]}
      />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-h3 font-bold">{t("importRegister")}</h1>
          <p className="text-[14px] text-muted">{t("subtitle")}</p>
        </div>
        <Link href={`/projects/${project.id}/work-items/imports`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <Icon name="history" />
          {t("imports")}
          {imports && (
            <span className="rounded-full bg-neutral-tint px-2 text-[12px] font-bold tabular-nums text-text-secondary">
              {formatNumber(imports.imports.length, locale)}
            </span>
          )}
        </Link>
      </header>
      <RegisterImportWizard
        projectId={project.id}
        locale={locale}
        types={raisable.types}
        fields={fields}
        me={{ id: me.member.id, name: me.member.fullName }}
        trades={mine.trade.filter((v) => v.active).map((v) => ({ id: v.id, code: v.code, name: v.name }))}
        initialPreview={preview && preview.projectId === project.id ? preview : null}
        // "Use in new import" (RP-1144): a saved mapping of the Member's own Company, applied once the register is read.
        initialMapping={typeof mappingId === "string" && fields.mappings.some((m) => m.id === mappingId) ? mappingId : null}
      />
    </div>
  );
}
