import type { Locale } from "@rabaed/domain";
import { ProjectMark, TopBarTitle } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getProject } from "@/lib/session";

/**
 * The top bar inside a Project (RP-406): back to the Projects page, the
 * Project's mark, its name and its Host Company, whose name every Member of the
 * Project sees (V15). Nothing for a Project the Member is not on.
 */
export default async function ProjectHeading({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  const [t, project] = await Promise.all([getTranslations("shell"), getProject(projectId)]);
  if (!project) return null;
  const name = project.name[locale];
  return (
    <TopBarTitle
      back={{ href: "/projects", label: t("backToProjects") }}
      linkAs={Link}
      mark={<ProjectMark name={name} />}
      title={name}
      subtitle={t("hostCompany", { company: project.hostCompany.legalName[locale] })}
    />
  );
}
