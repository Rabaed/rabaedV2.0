import type { Locale } from "@rabaed/domain";
import { ProjectTopBar } from "@/components/project-shell";
import { getPackage } from "@/lib/session";

/**
 * A Package page sits inside its Project (RP-1164): the Project's top bar, as on the Packages view.
 * A Package the Member can't see has none; its page answers not found.
 */
export default async function PackageHeading({ params }: { params: Promise<{ locale: Locale; packageId: string }> }) {
  const { locale, packageId } = await params;
  const pkg = await getPackage(packageId);
  return pkg ? <ProjectTopBar locale={locale} projectId={pkg.projectId} /> : null;
}
