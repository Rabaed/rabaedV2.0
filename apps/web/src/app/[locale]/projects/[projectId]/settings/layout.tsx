import type { Locale } from "@rabaed/domain";
import { SettingsLayout } from "@rabaed/ui";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ProjectSettingsNav } from "@/components/project-settings-nav";
import { redirect } from "@/i18n/navigation";
import { getMe, getProject, getProjectParticipants } from "@/lib/session";

/** Every Project Settings page: the settings navigation beside the page (RP-412). */
export default async function ProjectSettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale: rawLocale, projectId } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  const [me, project, participants] = await Promise.all([getMe(), getProject(projectId), getProjectParticipants(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project) notFound();
  // The Authorized Person narrows Visibility for their own Company's Project Members.
  const ownParticipant = me.member.isAuthorizedPerson ? participants?.participants.find((p) => p.isOwnCompany) : undefined;

  return (
    <SettingsLayout
      nav={<ProjectSettingsNav projectId={project.id} isProjectAdmin={project.isProjectAdmin} ownParticipantId={ownParticipant?.id} />}
    >
      {children}
    </SettingsLayout>
  );
}
