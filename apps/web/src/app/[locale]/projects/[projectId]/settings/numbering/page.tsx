import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { NumberingCountersSection } from "@/components/numbering-counters";
import { Link, redirect } from "@/i18n/navigation";
import { treeOrder } from "@/lib/dimension-tree";
import { getMe, getNumberingCounters, getProject, getProjectDimensions, getProjectParticipants } from "@/lib/session";

// Unicode left-to-right isolate and its closing pop, for codes inside <option> text.
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

/**
 * Project Settings → Numbering. RP-315 renders the counters and starting
 * numbers here, for Project Admins only: the API returns counters to nobody
 * else (visibility.md scenario 55), and then the section isn't shown. The
 * Numbering Pattern builder (RP-313) joins this page.
 */
export default async function NumberingPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");
  const [me, project] = await Promise.all([getMe(), getProject(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project) notFound();

  const [counters, participants, dimensions] = project.isProjectAdmin
    ? await Promise.all([getNumberingCounters(projectId), getProjectParticipants(projectId), getProjectDimensions(projectId)])
    : [null, null, null];
  const code = (value: string) => ` (${LRI}${value}${PDI})`;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link href={`/projects/${project.id}`} className="text-sm text-primary underline underline-offset-4">
          {project.name[locale]}
        </Link>
        <h1 className="text-h4 font-semibold">{t("numbering")}</h1>
      </div>
      {counters && participants && dimensions && (
        <NumberingCountersSection
          projectId={project.id}
          counters={counters.counters}
          workItemTypes={counters.workItemTypes}
          participants={participants.participants.map((p) => ({
            value: p.id,
            label: `${p.company.legalName[locale]}${p.code ? code(p.code) : ""}`,
          }))}
          trades={dimensions.trade.map((v) => ({ value: v.id, label: `${v.name[locale]}${code(v.code)}` }))}
          locations={treeOrder(dimensions.location).map((v) => ({
            value: v.id,
            label: `${"— ".repeat(v.level)}${v.name[locale]}${code(v.code)}`,
          }))}
        />
      )}
    </div>
  );
}
