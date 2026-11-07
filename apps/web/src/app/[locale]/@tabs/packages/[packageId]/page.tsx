import { ProjectTabsBand } from "@/components/project-shell";
import { getPackage } from "@/lib/session";

/**
 * A Package page shows its Project's tabs, the Submittals tab marked (Packages live inside
 * Submittals; RP-1164). A Package the Member can't see has none; its page answers not found.
 */
export default async function PackageTabs({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const pkg = await getPackage(packageId);
  return pkg ? <ProjectTabsBand projectId={pkg.projectId} /> : null;
}
