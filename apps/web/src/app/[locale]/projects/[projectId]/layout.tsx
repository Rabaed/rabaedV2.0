import type { ReactNode } from "react";
import { ProjectTabsNav } from "@/components/project-tabs-nav";
import { getProject } from "@/lib/session";

/**
 * The Project shell: its tabs above every Project page. A Project the Member
 * is not on gets no tabs; its page answers not found.
 */
export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  return (
    <div className="space-y-6">
      {project && <ProjectTabsNav projectId={project.id} modules={project.modules} />}
      {children}
    </div>
  );
}
