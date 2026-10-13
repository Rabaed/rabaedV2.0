import type { Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ScreensList, type ScreenRow } from "@/components/screens-list";
import { redirect } from "@/i18n/navigation";
import { getMe, getProject, getProjectScreens, getScreen, getScreenPins } from "@/lib/session";

/**
 * Project → Settings → Screens (RP-441; ADR 0019): the Project's Screens and the Rabaed
 * Default ones it may copy, each with its Versions and the Workflow Versions that pin them.
 * Every Project Member reads it (V20); only Project Admins create, copy and edit.
 */
export default async function ScreensPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.screens");
  const ts = await getTranslations("settings");
  const [me, project, list, pins] = await Promise.all([getMe(), getProject(projectId), getProjectScreens(projectId), getScreenPins(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !list) notFound();

  const rows: ScreenRow[] = await Promise.all(
    list.screens.map(async (s): Promise<ScreenRow> => {
      const read = await getScreen(s.id);
      return {
        id: s.id,
        key: s.key,
        name: s.name,
        owner: s.owner === "rabaed" ? "rabaed" : "project",
        publishedVersions: read?.publishedVersions ?? [],
        pinnedBy: (pins?.pins ?? []).filter((p) => p.screenId === s.id).length,
        copy: s.owner === "rabaed" && read?.published ? { schema: read.published.schema, internalFields: read.published.internalFields } : null,
      };
    }),
  );
  // A new Screen starts with one field, labelled in both languages whichever the author reads.
  const [en, ar] = await Promise.all([
    getTranslations({ locale: "en", namespace: "projectSettings.screens.starting" }),
    getTranslations({ locale: "ar", namespace: "projectSettings.screens.starting" }),
  ]);
  const starting = {
    schema: {
      sections: [
        {
          key: "reply",
          title: { en: en("section"), ar: ar("section") },
          fields: [{ key: "remarks", type: "textarea", label: { en: en("field"), ar: ar("field") }, required: false }],
        },
      ],
    },
  };

  return (
    <>
      <SettingsHeader title={t("title")} description={t("intro")} readOnlyLabel={project.isProjectAdmin ? undefined : ts("readOnly")} />
      <ScreensList projectId={projectId} canEdit={project.isProjectAdmin} screens={rows} starting={starting} />
    </>
  );
}
