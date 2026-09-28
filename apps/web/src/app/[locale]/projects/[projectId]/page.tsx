import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getMe, getProject } from "@/lib/session";

export default async function ProjectPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");
  // A Project the Member is not on is not found, exactly like one that doesn't exist.
  const [me, project] = await Promise.all([getMe(), getProject(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-h4 font-semibold">{project.name[locale]}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        <dt className="text-muted">{t("code")}</dt>
        <dd>
          <bdi dir="ltr">{project.code}</bdi>
        </dd>
        <dt className="text-muted">{t("projectNumber")}</dt>
        <dd>{project.projectNumber}</dd>
        <dt className="text-muted">{t("yourRole")}</dt>
        <dd>
          {project.projectRole.name[locale]}
          {project.isProjectAdmin && ` · ${t("projectAdmin")}`}
        </dd>
      </dl>
    </div>
  );
}
