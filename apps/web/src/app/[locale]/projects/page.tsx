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
    <div className="flex flex-col">
      <div className="mb-[22px] flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-h4 leading-tight font-bold tracking-[-0.01em] ltr:font-extrabold">{t("title")}</h1>
          <p className="text-body text-muted">{t("subtitle")}</p>
        </div>
        {canCreate && (
          <div className="ms-auto">
            <NewProjectDialog className="h-[42px] rounded-[11px] px-4 font-semibold" />
          </div>
        )}
      </div>

      {!list ? (
        <p role="alert" className="text-danger">
          {t("unavailable")}
        </p>
      ) : (
        <ProjectCardsView
          projects={list.projects}
          submittals={list.submittals}
          locale={locale}
          emptyAction={canCreate ? <NewProjectDialog /> : undefined}
        />
      )}
    </div>
  );
}
