import { TabsBar } from "@rabaed/ui";
import { ProjectTabsNav } from "@/components/project-tabs-nav";
import { getProject } from "@/lib/session";

/**
 * A Project's module tabs, in the band under the top bar on every Project page
 * (RP-346, RP-406). A Project the Member is not on gets no tabs; its page
 * answers not found.
 */
export default async function ProjectTabs({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return null;
  return (
    <TabsBar>
      <ProjectTabsNav projectId={project.id} modules={project.modules} />
    </TabsBar>
  );
}
