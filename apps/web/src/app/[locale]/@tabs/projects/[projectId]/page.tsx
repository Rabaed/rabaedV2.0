import { ProjectTabsBand } from "@/components/project-shell";

/** A Project's module tabs on every Project page (RP-346, RP-406): see `ProjectTabsBand`. */
export default async function ProjectTabs({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectTabsBand projectId={projectId} />;
}
