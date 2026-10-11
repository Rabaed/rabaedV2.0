import { fieldKinds } from "@/lib/screen-editor";
import { itemsToCreate, type Locale } from "@rabaed/domain";
import { Icon, SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ScreenEditor } from "@/components/screen-editor";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getScreen, getScreenPins, getTypeOutcomes, getWorkflowSettings } from "@/lib/session";

type Params = { locale: Locale; projectId: string; screenId: string };

/**
 * Project → Settings → Screens → one Screen (RP-441; ADR 0019): its Versions, the Workflow
 * Versions that pin each, and for a Project Admin the editor of its fields. Everyone else on
 * the Project reads the published Version (V20); another Project's Screen, a Library's and
 * a made-up one are the not-found page, as the API answers them.
 */
export default async function ScreenPage({ params }: { params: Promise<Params> }) {
  const { locale, projectId, screenId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectSettings.screens");
  const [me, screen, pins, settings] = await Promise.all([getMe(), getScreen(screenId), getScreenPins(projectId), getWorkflowSettings(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // Only the Project's own Screens are edited here; a Rabaed Default is copied into the Project first.
  if (!screen || screen.projectId !== projectId) notFound();

  // The words a new field starts with, in both languages: a field is labelled in each.
  const [en, ar] = await Promise.all([
    getTranslations({ locale: "en", namespace: "projectSettings.screens" }),
    getTranslations({ locale: "ar", namespace: "projectSettings.screens" }),
  ]);
  const wordsOf = (tr: typeof en) => ({
    section: tr("starting.section"),
    field: tr("starting.field"),
    option: tr("starting.option"),
    column: tr("starting.column"),
    kinds: Object.fromEntries(fieldKinds.map((kind) => [kind, tr(`kinds.${kind}`)])) as Record<(typeof fieldKinds)[number], string>,
  });

  // The Types whose outcome turns the "items to create" table's rows into items (WF-11).
  const hasItemsTable = JSON.stringify(screen.draft?.schema ?? screen.published?.schema ?? {}).includes("items_to_create");
  const itemsTargets = hasItemsTable
    ? [
        ...new Set(
          (await Promise.all((settings?.types ?? []).map((type) => getTypeOutcomes(projectId, type.code)))).flatMap((o) =>
            (o?.outcomes ?? []).flatMap((outcome) => itemsToCreate(outcome) ?? []),
          ),
        ),
      ]
    : [];

  return (
    <>
      <SettingsHeader
        title={screen.name[locale]}
        description={t("editorIntro")}
        actions={
          <Link href={`/projects/${projectId}/settings/screens`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-fg hover:underline">
            <Icon name="arrow-left" size={15} />
            {t("backToScreens")}
          </Link>
        }
      />
      <ScreenEditor
        projectId={projectId}
        screen={screen}
        pins={(pins?.pins ?? []).filter((p) => p.screenId === screenId)}
        words={{ en: wordsOf(en), ar: wordsOf(ar) }}
        itemsTargets={itemsTargets}
      />
    </>
  );
}
