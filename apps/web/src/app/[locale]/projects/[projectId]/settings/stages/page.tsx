import { moduleKeys, type Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { StagesEditor } from "@/components/stages-editor";
import { redirect } from "@/i18n/navigation";
import { getMe, getProject, getProjectStages, getWorkflowSettings } from "@/lib/session";

/**
 * Project → Settings → Stages (RP-441, WF-5): the Project's Stages per Module, renamed,
 * added, reordered and deleted when no Step uses them. Every Project Member reads them;
 * only Project Admins change them (the Stages of the Project, never the Rabaed Defaults').
 */
export default async function StagesPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.stages");
  const tm = await getTranslations("projectTabs");
  const ts = await getTranslations("settings");
  const [me, project, settings] = await Promise.all([getMe(), getProject(projectId), getWorkflowSettings(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !settings) notFound();

  // The Modules the Project has a Work Item Type in, in the Dashboard's order.
  const modules = moduleKeys.filter((m) => settings.types.some((type) => type.moduleKey === m));
  const stages = await Promise.all(modules.map(async (m) => ({ module: m, read: await getProjectStages(projectId, m) })));

  return (
    <>
      <SettingsHeader title={t("title")} description={t("intro")} readOnlyLabel={project.isProjectAdmin ? undefined : ts("readOnly")} />
      {stages.map(({ module: m, read }) =>
        read ? <StagesEditor key={m} projectId={projectId} moduleKey={m} moduleName={tm(m)} stages={read.stages} canEdit={read.canEdit} /> : null,
      )}
    </>
  );
}
