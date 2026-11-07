import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ParticipantsBreadcrumb, ParticipantsHeading, ReadOnlyNotice, VisibilityGapWarning } from "@/components/participants/participants-parts";
import { AddMemberDialog, ProjectMembersTable } from "@/components/participants/project-members-table";
import { redirect } from "@/i18n/navigation";
import { authorizedPersonName, visibilitySummary } from "@/lib/participants";
import { getMe, getMembers, getParticipantMembers } from "@/lib/session";

/**
 * One of your Company's Participants and its Project Members, with each one's Positions and
 * Visibility (V15, V16: your own Company's only). The Authorized Person adds and removes them,
 * gives Positions and sees the Visibility Gap; anyone else reads the table.
 */
export default async function ParticipantPage({ params }: { params: Promise<{ locale: Locale; participantId: string }> }) {
  const { locale, participantId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("participants");
  const [me, data, company] = await Promise.all([getMe(), getParticipantMembers(participantId), getMembers()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // Another Participant's list is not found, exactly like one that doesn't exist.
  if (!data) notFound();

  const manages = me.member.isAuthorizedPerson;
  const project = data.participant.project.name[locale];
  const companyName = me.company.legalName[locale];
  const onProject = new Set(data.members.map((m) => m.id));
  const candidates = manages
    ? (company?.members ?? [])
        .filter((m) => !onProject.has(m.id) && (m.status === "active" || m.status === "invited"))
        .map((m) => ({ id: m.id, name: m.fullName[locale], nameEn: m.fullName.en, email: m.email, isMe: m.id === me.member.id }))
    : null;
  const positions = data.positions.map((p) => ({ key: p.key, name: p.name[locale] }));
  const summaryText = { allTrades: t("allTrades"), allLocations: t("allLocations"), noTrades: t("noTrades"), noLocations: t("noLocations") };

  return (
    <div className="space-y-6">
      <ParticipantsBreadcrumb
        label={t("breadcrumb")}
        back="/participants"
        crumbs={[{ label: t("myCompany") }, { label: t("title"), href: "/participants" }, { label: project }]}
      />
      <ParticipantsHeading
        title={project}
        description={t("membersHeading", {
          company: companyName,
          role: data.participant.projectRole.name[locale],
          host: data.participant.hostCompany.legalName[locale],
        })}
        actions={candidates && <AddMemberDialog participantId={data.participant.id} project={project} positions={positions} candidates={candidates} />}
      />
      {!manages && <ReadOnlyNotice>{t("readOnly", { name: authorizedPersonName(company, locale) })}</ReadOnlyNotice>}
      {data.gap && (
        <VisibilityGapWarning
          gap={data.gap}
          covered={data.covered}
          title={t("gapTitle")}
          body={t("gapBody", { project, company: companyName })}
          locale={locale}
        />
      )}
      <ProjectMembersTable
        participantId={data.participant.id}
        project={project}
        members={data.members.map((m) => {
          const summary = visibilitySummary(m.visibility, data.covered, locale, summaryText);
          return {
            id: m.id,
            name: m.fullName[locale],
            nameEn: m.fullName.en,
            email: m.email,
            positions: m.positions,
            visibility: summary.text,
            visibilityAll: summary.all,
          };
        })}
        positions={positions}
        candidates={candidates}
      />
    </div>
  );
}
