import type { Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AddParticipantButton, ParticipantsVisibility, ProjectGapNotice } from "@/components/settings/project-visibility";
import { redirect } from "@/i18n/navigation";
import {
  getMe,
  getParticipantVisibility,
  getProject,
  getProjectDimensions,
  getProjectInvitations,
  getProjectParticipants,
  getProjectVisibilityGap,
} from "@/lib/session";

/**
 * Project Settings → Visibility, to the owner's reference (RP-1156): a Project Admin sees the
 * Project's Visibility Gap, grants each Participant the Trades and Locations it covers, adds a
 * Participant and withdraws a pending invitation. Each Participant's Authorized Person then
 * narrows it for its own Project Members. To anyone else this page doesn't exist (V15).
 */
export default async function VisibilitySettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectVisibility");
  const [me, project, dimensions, participants] = await Promise.all([
    getMe(),
    getProject(projectId),
    getProjectDimensions(projectId),
    getProjectParticipants(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !dimensions || !participants || !project.isProjectAdmin) notFound();

  const [gap, invitations, grants] = await Promise.all([
    getProjectVisibilityGap(project.id),
    getProjectInvitations(project.id),
    Promise.all(participants.participants.map((p) => getParticipantVisibility(p.id))),
  ]);

  return (
    <>
      <SettingsHeader title={t("title")} description={t("description")} actions={<AddParticipantButton projectId={project.id} />} />
      {gap ? (
        <ProjectGapNotice gap={gap} dimensions={dimensions} />
      ) : (
        // The page is the Project Admins' only, so a missing gap or invitations list is a failed read.
        <p role="alert" className="text-sm text-danger-fg">
          {t("unavailableGap")}
        </p>
      )}
      {!invitations && (
        <p role="alert" className="text-sm text-danger-fg">
          {t("unavailableInvitations")}
        </p>
      )}
      <ParticipantsVisibility
        projectId={project.id}
        dimensions={dimensions}
        participants={participants.participants.map((p, i) => ({
          id: p.id,
          company: p.company.legalName[locale],
          role: p.projectRole.baseRole,
          roleName: p.projectRole.name[locale],
          grant: grants[i] ?? null,
        }))}
        invitations={(invitations?.invitations ?? []).map((i) => ({
          id: i.id,
          crNumber: i.crNumber,
          role: i.projectRole.baseRole,
          roleName: i.projectRole.name[locale],
          invitedAt: i.invitedAt,
        }))}
      />
    </>
  );
}
