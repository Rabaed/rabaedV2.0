import type { Locale } from "@rabaed/domain";
import { ProjectTopBar } from "@/components/project-shell";

/** The top bar inside a Project (RP-406): see `ProjectTopBar`. */
export default async function ProjectHeading({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  return <ProjectTopBar locale={locale} projectId={projectId} />;
}
