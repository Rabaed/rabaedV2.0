import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { RegisterImportWizard } from "@/components/register-import-wizard";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getMyVisibility, getProject, getRaisableTypes, getRegisterImport } from "@/lib/session";

/**
 * The Submittals Module's "Import register" (RP-637, spec RP-631): the wizard that
 * creates Drafts from the Member's own register. Only for a Member who may raise a
 * Submittals Type; the fixed Trade offers only the Trades their Visibility covers.
 * `?preview=<id>` reopens the Member's own preview at Validate (the API answers it to
 * its importer only).
 */
export default async function ImportRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { locale, projectId } = await params;
  const { preview: previewId } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("registerImport");
  const [me, project, raisable, mine, preview] = await Promise.all([
    getMe(),
    getProject(projectId),
    getRaisableTypes(projectId),
    getMyVisibility(projectId),
    typeof previewId === "string" ? getRegisterImport(previewId) : null,
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !raisable || !mine || raisable.types.length === 0) notFound();
  if (preview && preview.projectId === project.id && preview.status === "created") {
    return redirect({ href: `/projects/${project.id}/work-items/imports/${preview.id}`, locale });
  }

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-[13px] text-muted">
        <Link href={`/projects/${project.id}/work-items/imports`} className="hover:text-text hover:underline">
          {t("imports")}
        </Link>
        <span aria-hidden>›</span>
        <span className="font-semibold text-text">{t("newImport")}</span>
      </nav>
      <header className="flex flex-col gap-1">
        <h1 className="text-h3 font-bold">{t("importRegister")}</h1>
        <p className="text-[14px] text-muted">{t("subtitle")}</p>
      </header>
      <RegisterImportWizard
        projectId={project.id}
        locale={locale}
        types={raisable.types}
        trades={mine.trade.map((v) => ({ id: v.id, code: v.code, name: v.name }))}
        initialPreview={preview && preview.projectId === project.id ? preview : null}
      />
    </div>
  );
}
