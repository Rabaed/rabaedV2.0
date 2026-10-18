import type { Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ProjectModulesSettings } from "@/components/project-modules-settings";
import { redirect } from "@/i18n/navigation";
import { getMe, getProject } from "@/lib/session";

/**
 * Project → Settings → Modules (RP-652): where the Project's Modules show. Today one choice, "Show
 * Inspections in the Submittals tab". Every Project Member reads it; a Project Admin changes it.
 */
export default async function ProjectModulesSettingsPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.modules");
  const ts = await getTranslations("settings");
  const [me, project] = await Promise.all([getMe(), getProject(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project) notFound();

  return (
    <>
      <SettingsHeader title={t("title")} description={t("intro")} readOnlyLabel={project.isProjectAdmin ? undefined : ts("readOnly")} />
      <ProjectModulesSettings
        projectId={project.id}
        showInspectionsInSubmittals={project.showInspectionsInSubmittals}
        canEdit={project.isProjectAdmin && project.status === "active"}
      />
    </>
  );
}
