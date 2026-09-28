import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { VisibilityEditor } from "@/components/visibility-editor";
import { Link, redirect } from "@/i18n/navigation";
import {
  getMe,
  getParticipantVisibility,
  getProject,
  getProjectDimensions,
  getProjectParticipants,
} from "@/lib/session";

/**
 * Project Settings → Visibility: a Project Admin grants each Participant the
 * Trades and Locations it covers. Each Participant's Authorized Person then
 * narrows it for their own Project Members (from the Participant's page).
 */
export default async function VisibilitySettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("visibility");
  const [me, project, dimensions, participants] = await Promise.all([
    getMe(),
    getProject(projectId),
    getProjectDimensions(projectId),
    getProjectParticipants(projectId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // Only a Project Admin sees every Participant's grant; to anyone else this page doesn't exist.
  if (!project || !dimensions || !participants || !project.isProjectAdmin) notFound();

  const grants = await Promise.all(participants.participants.map((p) => getParticipantVisibility(p.id)));

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href={`/projects/${project.id}`} className="text-sm text-primary underline underline-offset-4">
          {project.name[locale]}
        </Link>
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
        <p className="text-muted">{t("participantsHint")}</p>
      </div>
      {participants.participants.map((p, i) => {
        const grant = grants[i];
        return (
          <section key={p.id} className="space-y-3" data-testid="participant-visibility">
            <h2 className="text-h6 font-semibold">
              {p.company.legalName[locale]}{" "}
              <span className="font-normal text-muted">· {p.projectRole.name[locale]}</span>
            </h2>
            {grant ? (
              <VisibilityEditor
                options={dimensions}
                visibility={grant.visibility}
                endpoint={`/api/v1/participants/${p.id}/visibility`}
                allLabel={{ trade: t("allTrades"), location: t("allLocations") }}
              />
            ) : (
              <p role="alert" className="text-danger">
                {t("unavailable")}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
