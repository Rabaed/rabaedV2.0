import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { ProjectCardsView } from "@/components/project-cards-view";
import { redirect } from "@/i18n/navigation";
import { getMe, getMyProjects } from "@/lib/session";

export default async function ProjectsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");
  const [me, list] = await Promise.all([getMe(), getMyProjects()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  const canCreate = me.member.canCreateProjects;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-h4 font-bold text-text">{t("title")}</h1>
          <p className="text-body text-muted">{t("subtitle")}</p>
        </div>
        {canCreate && <NewProjectDialog />}
      </div>

      {!list ? (
        <p role="alert" className="text-danger">
          {t("unavailable")}
        </p>
      ) : (
        <ProjectCardsView projects={list.projects} locale={locale} emptyAction={canCreate ? <NewProjectDialog /> : undefined} />
      )}
    </div>
  );
}
