import { workItemListHref, type Locale } from "@rabaed/domain";
import { cn, focusRing, KeyValues, ProjectDashboard, TitledCard, touchBox } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ActivityFeedView } from "@/components/activity-feed-view";
import { AddParticipantForm } from "@/components/add-participant-form";
import { WithdrawInvitationButton } from "@/components/withdraw-invitation-button";
import { Link, redirect } from "@/i18n/navigation";
import { chainLabels } from "@/lib/chain-labels";
import { getActivityFeed, getDashboard, getMe, getProject, getProjectInvitations, getProjectParticipants } from "@/lib/session";

/** The class of a link in a card, as the kit's (`.ln`), with the shared focus ring and touch size. */
const cardLinkClass = cn("inline-flex items-center rounded-sm text-[13px] font-semibold text-brand-fg underline-offset-4 hover:underline", focusRing, touchBox);

export default async function ProjectPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");
  const tViews = await getTranslations("workItemViews");
  // A Project the Member is not on is not found, exactly like one that doesn't exist.
  const [me, project, participants, dashboard, activity] = await Promise.all([
    getMe(),
    getProject(projectId),
    getProjectParticipants(projectId),
    getDashboard(projectId),
    getActivityFeed(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project) notFound();
  const invitations = project.isProjectAdmin ? await getProjectInvitations(project.id) : null;

  return (
    <div className="flex flex-col gap-[18px]">
      {/* The shell's header already shows the Project's name (the kit draws no title here); the heading stays for screen readers. */}
      <h1 className="sr-only">{project.name[locale]}</h1>

      {/* The Dashboard comes first: Type cards over the items the Member can see, each number a link to the List behind it.
          The Activity Feed sits beside them on a wide screen, as the kit's two-to-one grid, and under them below 1101px. */}
      {dashboard && (
        <div className="grid items-start gap-[18px] min-[1101px]:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <section aria-label={t("dashboard")} data-testid="dashboard" className="min-w-0">
            <ProjectDashboard
              dashboard={dashboard}
              locale={locale}
              labels={{
                items: (count) => tViews("dashboard.items", { count }),
                inPreparation: tViews("buckets.in_preparation"),
                open: tViews("dashboard.open"),
                closed: tViews("dashboard.closed"),
                empty: tViews("dashboard.empty"),
                codeC: tViews("dashboard.codeC"),
                ...chainLabels(tViews),
                approved: {
                  review_code: tViews("dashboard.approved.review_code"),
                  inspection_result: tViews("dashboard.approved.inspection_result"),
                  approval: tViews("dashboard.approved.approval"),
                  none: tViews("dashboard.approved.none"),
                },
              }}
              linkAs={Link}
              hrefFor={(query) => workItemListHref(project.id, query)}
            />
          </section>
          {/* The Activity Feed beside the cards: the Project's events as the Member may see them (RP-353). */}
          {activity && <ActivityFeedView projectId={project.id} initial={activity} locale={locale} />}
        </div>
      )}
      {/* The Project's facts, as the kit's "Project details" card. */}
      <TitledCard title={t("projectDetails")}>
        <KeyValues
          items={[
            { key: "code", label: t("code"), value: <bdi dir="ltr">{project.code}</bdi> },
            { key: "number", label: t("projectNumber"), value: project.projectNumber },
            ...(participants ? [{ key: "host", label: t("hostCompany"), value: participants.hostCompany.legalName[locale] }] : []),
            {
              key: "role",
              label: t("yourRole"),
              value: `${project.projectRole.name[locale]}${project.isProjectAdmin ? ` · ${t("projectAdmin")}` : ""}`,
            },
          ]}
        />
      </TitledCard>

      <TitledCard
        title={t("participants")}
        bodyClassName="flex flex-col gap-[18px] px-5 py-[18px]"
        actions={
          // Participant Codes are set in one place, Project Settings → Numbering (RP-381).
          project.isProjectAdmin && (
            <Link href={`/projects/${project.id}/settings/numbering`} className={cardLinkClass}>
              {t("setParticipantCodes")}
            </Link>
          )
        }
      >
        {/* Every Participant for a Project Admin; otherwise only your own Company's (V15). A Company under its Project Role. */}
        {participants && (
          <KeyValues
            data-testid="participants"
            items={participants.participants.map((p) => ({
              key: p.id,
              label: (
                <>
                  {p.projectRole.name[locale]}
                  {/* The Participant Code, as in Document Numbers: always left-to-right. */}
                  {p.code && (
                    <>
                      {" "}
                      · {t("participantCode")} <bdi dir="ltr">{p.code}</bdi>
                    </>
                  )}
                </>
              ),
              value: (
                <span className="flex flex-col items-start gap-1">
                  {p.company.legalName[locale]}
                  {p.isOwnCompany && (
                    <Link href={`/participants/${p.id}`} className={cardLinkClass}>
                      {t("projectMembers")}
                    </Link>
                  )}
                </span>
              ),
            }))}
          />
        )}
        {/* Pending invitations, for the Project Admin only: by CR number, never by Company name (ADR 0009). */}
        {invitations && invitations.invitations.length > 0 && (
          <div className="space-y-2 border-t border-border-subtle pt-[18px]">
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
      </TitledCard>
    </div>
  );
}
