import type { Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { OutcomesEditor } from "@/components/outcomes-editor";
import { redirect } from "@/i18n/navigation";
import { getMe, getProject, getTypeOutcomes, getWorkflowSettings } from "@/lib/session";

/**
 * Project → Settings → Outcomes (RP-441, WF-6): each Work Item Type's outcome set on the
 * Project: code, names, closing, positive or negative, follow-up actions. Every Project
 * Member reads it; only Project Admins add and change outcomes (the Project's copy; the
 * Rabaed Defaults never change here).
 */
export default async function OutcomesPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.outcomes");
  const ts = await getTranslations("settings");
  const [me, project, settings] = await Promise.all([getMe(), getProject(projectId), getWorkflowSettings(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !settings) notFound();

  const sets = await Promise.all(settings.types.map(async (type) => ({ type, read: await getTypeOutcomes(projectId, type.code) })));
  const typeChoices = settings.types.map((type) => ({ code: type.code, name: type.name[locale] }));

  return (
    <>
      <SettingsHeader title={t("title")} description={t("intro")} readOnlyLabel={project.isProjectAdmin ? undefined : ts("readOnly")} />
      {sets.map(({ type, read }) =>
        read && read.outcomes.length > 0 ? (
          <OutcomesEditor key={type.id} projectId={projectId} type={read.type} outcomes={read.outcomes} canEdit={read.canEdit} typeChoices={typeChoices} />
        ) : null,
      )}
    </>
  );
}
