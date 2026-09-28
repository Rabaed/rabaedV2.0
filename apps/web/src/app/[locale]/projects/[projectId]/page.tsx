import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AddParticipantForm } from "@/components/add-participant-form";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getProjectParticipants } from "@/lib/session";

export default async function ProjectPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");
  // A Project the Member is not on is not found, exactly like one that doesn't exist.
  const [me, project, participants] = await Promise.all([
    getMe(),
    getProject(projectId),
    getProjectParticipants(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project) notFound();
  // The Authorized Person narrows Visibility for their own Company's Project Members.
  const ownParticipant = me.member.isAuthorizedPerson ? participants?.participants.find((p) => p.isOwnCompany) : undefined;

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

      <section className="space-y-4">
        <h2 className="text-h6 font-semibold">{t("participants")}</h2>
        {participants && (
          <ul className="divide-y divide-border border-y border-border" data-testid="participants">
            {participants.participants.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-4 py-3">
                <span>
                  <span className="font-medium">{p.company.legalName[locale]}</span>{" "}
                  <span className="text-muted">· {p.projectRole.name[locale]}</span>
                </span>
                {p.isOwnCompany && (
                  <Link href={`/participants/${p.id}`} className="text-sm text-primary underline underline-offset-4">
                    {t("projectMembers")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {project.isProjectAdmin && <AddParticipantForm projectId={project.id} />}
      </section>

      <section className="space-y-2">
        <h2 className="text-h6 font-semibold">{t("settings")}</h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          <li>
            <Link href={`/projects/${project.id}/settings/trades-locations`} className="text-primary underline underline-offset-4">
              {t("tradesLocations")}
            </Link>
          </li>
          {project.isProjectAdmin && (
            <li>
              <Link href={`/projects/${project.id}/settings/visibility`} className="text-primary underline underline-offset-4">
                {t("visibility")}
              </Link>
            </li>
          )}
          {ownParticipant && (
            <li>
              <Link href={`/participants/${ownParticipant.id}`} className="text-primary underline underline-offset-4">
                {t("membersVisibility")}
              </Link>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
