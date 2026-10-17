import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { RegisterImportWizard } from "@/components/register-import-wizard";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getMyVisibility, getProject, getRaisableTypes } from "@/lib/session";

/**
 * The Submittals Module's "Import register" (RP-637, spec RP-631): the wizard that
 * creates Drafts from the Member's own register. Only for a Member who may raise a
 * Submittals Type; the fixed Trade offers only the Trades their Visibility covers.
 */
export default async function ImportRegisterPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("registerImport");
  const [me, project, raisable, mine] = await Promise.all([getMe(), getProject(projectId), getRaisableTypes(projectId), getMyVisibility(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !raisable || !mine || raisable.types.length === 0) notFound();

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
      />
    </div>
  );
}
