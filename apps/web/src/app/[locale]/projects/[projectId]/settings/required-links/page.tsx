import type { Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { RequiredLinks } from "@/components/required-links";
import { redirect } from "@/i18n/navigation";
import { getMe, getRequiredFields } from "@/lib/session";

/**
 * Project → Settings → Required links (RP-82; form-engine.md §2.13): the link questions
 * of the Project's Work Item Types, and which of them an item can't leave Draft without
 * on this Project, such as the WIR's Approved submittals. Every Project Member reads it
 * (V20); a Project Admin turns each on or off.
 */
export default async function RequiredLinksPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.requiredLinks");
  const ts = await getTranslations("settings");
  const [me, settings] = await Promise.all([getMe(), getRequiredFields(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!settings) notFound();

  return (
    <>
      <SettingsHeader title={t("title")} description={t("intro")} readOnlyLabel={settings.canEdit ? undefined : ts("readOnly")} />
      <RequiredLinks projectId={projectId} canEdit={settings.canEdit} fields={settings.fields} />
    </>
  );
}
