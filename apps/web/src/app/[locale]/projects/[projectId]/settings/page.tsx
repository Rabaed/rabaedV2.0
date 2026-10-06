import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getProject, getProjectParticipants } from "@/lib/session";

/** The Project's Settings tab: every settings page the Member may open. */
export default async function ProjectSettingsPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");
  const [me, project, participants] = await Promise.all([getMe(), getProject(projectId), getProjectParticipants(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project) notFound();
  // The Authorized Person narrows Visibility for their own Company's Project Members.
  const ownParticipant = me.member.isAuthorizedPerson ? participants?.participants.find((p) => p.isOwnCompany) : undefined;

  return (
    <section className="space-y-4">
      <h1 className="text-h4 font-semibold">{t("settings")}</h1>
      <ul className="space-y-2">
        <li>
          <Link href={`/projects/${project.id}/settings/trades-locations`} className="text-primary underline underline-offset-4">
            {t("tradesLocations")}
          </Link>
        </li>
        <li>
          <Link href={`/projects/${project.id}/settings/numbering`} className="text-primary underline underline-offset-4">
            {t("numbering")}
          </Link>
        </li>
        {project.isProjectAdmin && (
          <li>
            <Link href={`/projects/${project.id}/settings/visibility`} className="text-primary underline underline-offset-4">
              {t("visibility")}
            </Link>
          </li>
        )}
        {ownParticipant && (
          <li>
            <Link href={`/participants/${ownParticipant.id}`} className="text-primary underline underline-offset-4">
              {t("membersVisibility")}
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
