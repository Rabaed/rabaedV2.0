import type { Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ProjectRecordSettings } from "@/components/project-record-settings";
import { redirect } from "@/i18n/navigation";
import { getMe, getProject } from "@/lib/session";

/**
 * Project → Settings → Documental Record (RP-151): the language its records are printed in and
 * whether they show Hijri dates, and the Working Copy's watermark (RP-621). Every Project Member reads it; a Project Admin changes it, and a
 * change applies to records made afterwards.
 */
export default async function ProjectRecordSettingsPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.record");
  const ts = await getTranslations("settings");
  const [me, project] = await Promise.all([getMe(), getProject(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project) notFound();

  return (
    <>
      <SettingsHeader title={t("title")} description={t("intro")} readOnlyLabel={project.isProjectAdmin ? undefined : ts("readOnly")} />
      <ProjectRecordSettings
        projectId={project.id}
        recordLanguage={project.recordLanguage}
        recordHijriDates={project.recordHijriDates}
        workingCopyWatermark={project.workingCopyWatermark}
        canEdit={project.isProjectAdmin && project.status === "active"}
      />
    </>
  );
}
