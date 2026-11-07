import type { Locale } from "@rabaed/domain";
import { SettingsHeader } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { TradesLocations } from "@/components/settings/trades-locations";
import { redirect } from "@/i18n/navigation";
import { getMe, getProject, getProjectDimensions, getProjectScopes } from "@/lib/session";

/**
 * Project Settings → Trades & Locations, to the owner's reference (RP-1156). Every Project
 * Member reads it (V16); a Project Admin adds Trades, Scopes and Locations, and renames,
 * archives and restores Scopes.
 */
export default async function TradesLocationsPage({
  params,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tradesLocations");
  const [me, project, dimensions, scopes] = await Promise.all([
    getMe(),
    getProject(projectId),
    getProjectDimensions(projectId),
    getProjectScopes(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !dimensions || !scopes) notFound();

  return (
    <>
      <SettingsHeader
        title={t("title")}
        description={t("description")}
        readOnlyLabel={project.isProjectAdmin ? undefined : t("readOnly")}
      />
      <TradesLocations
        projectId={project.id}
        canEdit={project.isProjectAdmin}
        trades={dimensions.trade}
        locations={dimensions.location}
        scopes={scopes.scopes}
      />
    </>
  );
}
