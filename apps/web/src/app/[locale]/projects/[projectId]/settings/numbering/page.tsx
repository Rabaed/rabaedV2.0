import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { NumberingPatterns } from "@/components/numbering-patterns";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getNumberingSettings, getProject } from "@/lib/session";

/**
 * Project Settings → Numbering (spec RP-311). Every Project Member sees how the
 * Project builds its Document Numbers; a Project Admin changes it. Each part is
 * its own section component, so the Numbering Pattern (RP-313), Participant
 * Codes and counters sit side by side.
 */
export default async function NumberingPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("numbering");
  const [me, project, settings] = await Promise.all([getMe(), getProject(projectId), getNumberingSettings(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !settings) notFound();

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href={`/projects/${project.id}`} className="text-sm text-primary underline underline-offset-4">
          {project.name[locale]}
        </Link>
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
        <p className="text-muted">{t("intro")}</p>
      </div>
      <NumberingPatterns projectId={project.id} settings={settings} />
    </div>
  );
}
