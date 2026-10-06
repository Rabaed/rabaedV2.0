import { workItemSearchParams, type Locale } from "@rabaed/domain";
import { ProjectDashboard } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AddParticipantForm } from "@/components/add-participant-form";
import { ParticipantCodeForm } from "@/components/participant-code-form";
import { WithdrawInvitationButton } from "@/components/withdraw-invitation-button";
import { Link, redirect } from "@/i18n/navigation";
import { getDashboard, getMe, getProject, getProjectInvitations, getProjectParticipants } from "@/lib/session";

export default async function ProjectPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");
  // A Project the Member is not on is not found, exactly like one that doesn't exist.
  const [me, project, participants, dashboard] = await Promise.all([
    getMe(),
    getProject(projectId),
    getProjectParticipants(projectId),
    getDashboard(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project) notFound();
  const invitations = project.isProjectAdmin ? await getProjectInvitations(project.id) : null;
  // The Authorized Person narrows Visibility for their own Company's Project Members.
  const ownParticipant = me.member.isAuthorizedPerson ? participants?.participants.find((p) => p.isOwnCompany) : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-h4 font-semibold">{project.name[locale]}</h1>

      {/* The Dashboard comes first: Type cards over the items the Member can see, each number a link to the List behind it. */}
      {dashboard && (
        <section aria-label={t("dashboard")} data-testid="dashboard">
          <ProjectDashboard
            dashboard={dashboard}
            locale={locale}
            linkAs={Link}
            hrefFor={(query) => `/projects/${project.id}/work-items?${workItemSearchParams(query)}`}
          />
        </section>
      )}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        <dt className="text-muted">{t("code")}</dt>
        <dd>
          <bdi dir="ltr">{project.code}</bdi>
        </dd>
        <dt className="text-muted">{t("projectNumber")}</dt>
        <dd>{project.projectNumber}</dd>
        {participants && (
          <>
            <dt className="text-muted">{t("hostCompany")}</dt>
            <dd>{participants.hostCompany.legalName[locale]}</dd>
          </>
        )}
        <dt className="text-muted">{t("yourRole")}</dt>
        <dd>
          {project.projectRole.name[locale]}
          {project.isProjectAdmin && ` · ${t("projectAdmin")}`}
        </dd>
      </dl>

      <Link href={`/projects/${project.id}/work-items`} className="inline-block text-primary underline underline-offset-4">
        {t("submittals")}
      </Link>

      <section className="space-y-4">
        <h2 className="text-h6 font-semibold">{t("participants")}</h2>
        {/* Every Participant for a Project Admin; otherwise only your own Company's (V15). */}
        {participants && (
          <ul className="divide-y divide-border border-y border-border" data-testid="participants">
            {participants.participants.map((p) => (
              <li key={p.id} className="space-y-3 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <span>
                    <span className="font-medium">{p.company.legalName[locale]}</span>{" "}
                    <span className="text-muted">· {p.projectRole.name[locale]}</span>
                    {/* The Participant Code, as in Document Numbers: always left-to-right. */}
                    {p.code && (
                      <span className="text-muted">
                        {" "}
                        · {t("participantCode")} <bdi dir="ltr">{p.code}</bdi>
                      </span>
                    )}
                  </span>
                  {p.isOwnCompany && (
                    <Link href={`/participants/${p.id}`} className="text-sm text-primary underline underline-offset-4">
                      {t("projectMembers")}
                    </Link>
                  )}
                </div>
                {project.isProjectAdmin && <ParticipantCodeForm participantId={p.id} code={p.code} />}
              </li>
            ))}
          </ul>
        )}
        {/* Pending invitations, for the Project Admin only: by CR number, never by Company name (ADR 0009). */}
        {invitations && invitations.invitations.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("pendingInvitations")}</h3>
            <ul className="divide-y divide-border border-y border-border" data-testid="pending-invitations">
              {invitations.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-4 py-2 text-sm">
                  <span>
                    {t("crNumber")} <bdi dir="ltr">{i.crNumber}</bdi>{" "}
                    <span className="text-muted">· {i.projectRole.name[locale]}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-4">
                    <span className="text-muted">{t("awaitingAnswer")}</span>
                    <WithdrawInvitationButton projectId={project.id} invitationId={i.id} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
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
          <li>
            <Link href={`/projects/${project.id}/settings/numbering`} className="text-primary underline underline-offset-4">
              {t("numbering")}
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
