import type { Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { WorkflowSettingsView } from "@/components/workflow-settings";
import { redirect } from "@/i18n/navigation";
import { getMe, getProjectParticipants, getWorkflowSettings } from "@/lib/session";

/**
 * Project → Settings → Workflows (RP-441, WF-18; design `settings-workflows.html`): which
 * Workflow each Work Item Type runs and its exceptions, with the Project Admins' commands.
 * Every Project Member reads it (V20); an exception only its own Participant's Members and
 * the Project Admins do (V15), as the API gives it; the Participants an exception may name
 * are those the API lists for the viewer, every one for a Project Admin.
 */
export default async function WorkflowSettingsPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.workflows");
  const ts = await getTranslations("settings");
  const [me, settings] = await Promise.all([getMe(), getWorkflowSettings(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!settings) notFound();
  const participants = settings.canEdit ? await getProjectParticipants(projectId) : null;
  // A copy is named in both languages, whichever the Project Admin reads.
  const [en, ar] = await Promise.all([
    getTranslations({ locale: "en", namespace: "projectSettings.workflows" }),
    getTranslations({ locale: "ar", namespace: "projectSettings.workflows" }),
  ]);

  return (
    <>
      <SettingsHeader title={t("title")} description={t("intro")} readOnlyLabel={settings.canEdit ? undefined : ts("readOnly")} />
      <WorkflowSettingsView
        projectId={projectId}
        settings={settings}
        isAuthorizedPerson={me.member.isAuthorizedPerson}
        copySuffix={{ en: en("copySuffix"), ar: ar("copySuffix") }}
        participants={(participants?.participants ?? []).map((p) => ({ id: p.id, name: p.company.legalName[locale] }))}
      />
    </>
  );
}
