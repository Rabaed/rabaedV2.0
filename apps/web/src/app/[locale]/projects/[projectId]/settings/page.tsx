import type { Locale } from "@rabaed/domain";
import { redirect } from "@/i18n/navigation";

/** The Project's Settings tab lands on its first page, Document Numbering. */
export default async function ProjectSettingsPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  return redirect({ href: `/projects/${projectId}/settings/numbering`, locale });
}
