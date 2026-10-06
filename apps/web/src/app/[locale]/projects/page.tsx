import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CreateProjectForm } from "@/components/create-project-form";
import { ProjectCardsView } from "@/components/project-cards-view";
import { redirect } from "@/i18n/navigation";
import { getMe, getMyProjects } from "@/lib/session";

export default async function ProjectsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");
  const [me, list] = await Promise.all([getMe(), getMyProjects()]);
  if (!me) return redirect({ href: "/sign-in", locale });

  return (
    <div className="space-y-8">
      <h1 className="text-h4 font-semibold">{t("title")}</h1>

      {me.member.canCreateProjects && <CreateProjectForm />}

      {!list ? (
        <p role="alert" className="text-danger">
          {t("unavailable")}
        </p>
      ) : list.projects.length === 0 ? (
        <p className="text-muted">{me.member.canCreateProjects ? t("emptyCreator") : t("empty")}</p>
      ) : (
        <ProjectCardsView projects={list.projects} locale={locale} />
      )}
    </div>
  );
}
