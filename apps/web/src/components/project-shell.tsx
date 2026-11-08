import { projectTabModules, type Locale } from "@rabaed/domain";
import { ProjectMark, TabsBar, TopBarTitle } from "@rabaed/ui";
import { getTranslations } from "next-intl/server";
import { ProjectTabsNav } from "@/components/project-tabs-nav";
import { Link } from "@/i18n/navigation";
import { getProject } from "@/lib/session";

/**
 * The top bar inside a Project (RP-406): back to the Projects page, the
 * Project's mark, its name and its Host Company, whose name every Member of the
 * Project sees (V15). Nothing for a Project the Member is not on.
 */
export async function ProjectTopBar({ locale, projectId }: { locale: Locale; projectId: string }) {
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

/**
 * A Project's module tabs, in the band under the top bar on every Project page
 * (RP-346, RP-406), but not Inspections' while the Project shows it in Submittals (RP-652). A Project the Member is not on gets no tabs; its page
 * answers not found.
 */
export async function ProjectTabsBand({ projectId }: { projectId: string }) {
  const project = await getProject(projectId);
  if (!project) return null;
  return (
    <TabsBar>
      <ProjectTabsNav projectId={project.id} modules={projectTabModules(project)} />
    </TabsBar>
  );
}
