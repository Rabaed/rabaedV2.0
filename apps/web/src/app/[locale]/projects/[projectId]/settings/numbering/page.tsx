import { documentNumbering, formatNumber, participantSegment, rabaedDefaultNumberingPattern, type Locale } from "@rabaed/domain";
import { DocNo, SettingsHeader, SettingsSection } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { NumberingCountersSection } from "@/components/numbering-counters";
import { NumberingPatterns } from "@/components/numbering-patterns";
import { ParticipantCodesSection } from "@/components/participant-codes";
import { redirect } from "@/i18n/navigation";
import { treeOrder } from "@/lib/dimension-tree";
import {
  getMe,
  getNumberingCounters,
  getNumberingSettings,
  getProject,
  getProjectDimensions,
  getProjectParticipants,
} from "@/lib/session";

// Unicode left-to-right isolate and its closing pop, for codes inside <option> text.
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

/**
 * Project Settings → Numbering (spec RP-311), one section component per part.
 * The Numbering Pattern and its per-Type overrides (RP-313): every Project Member
 * reads them, a Project Admin changes them. The Participant Codes (RP-381): the
 * only place they are set, by a Project Admin; other Project Members read those
 * of the Participants they can see (V15). The counters and starting numbers
 * (RP-315): Project Admins only, since the API returns counters to nobody else
 * (visibility.md scenario 55), and then the section isn't shown.
 */
export default async function NumberingPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("numbering");
  const ts = await getTranslations("settings");
  const [me, project, settings] = await Promise.all([getMe(), getProject(projectId), getNumberingSettings(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !settings) notFound();

  // The Participants the API lists for the viewer, exactly as on the Project overview:
  // every one for a Project Admin, otherwise only their own Company's (V15).
  const [participants, counters, dimensions] = await Promise.all([
    getProjectParticipants(projectId),
    project.isProjectAdmin ? getNumberingCounters(projectId) : null,
    project.isProjectAdmin ? getProjectDimensions(projectId) : null,
  ]);
  const code = (value: string) => ` (${LRI}${value}${PDI})`;
  // The first number a new item gets with the Project pattern, built for the viewer's own Participant (V3).
  const projectPattern = settings.project?.pattern ?? rabaedDefaultNumberingPattern;
  const previewNumber = documentNumbering(projectPattern, { ...settings.example, typeCode: settings.types[0]?.code ?? "MAR" }).number(1);

  return (
    <>
      <SettingsHeader title={t("title")} description={t("intro")} readOnlyLabel={project.isProjectAdmin ? undefined : ts("readOnly")} />
      <SettingsSection title={ts("previewTitle")} description={ts("previewHint")} data-testid="numbering-preview">
        <p className="text-h3 font-bold break-all">
          <DocNo value={previewNumber} className="font-bold" />
        </p>
        <p className="text-sm text-muted">{ts("length", { n: formatNumber(previewNumber.length, locale) })}</p>
      </SettingsSection>
      <NumberingPatterns projectId={project.id} settings={settings} />
      {participants && <ParticipantCodesSection participants={participants.participants} canEdit={project.isProjectAdmin} />}
      {counters && participants && dimensions && (
        <NumberingCountersSection
          projectId={project.id}
          counters={counters.counters}
          workItemTypes={counters.workItemTypes}
          participants={participants.participants.map(({ id, company, code: participantCode, ordinal }) => {
            // Shown to Project Admins only, who get every Participant's order on the Project (RP-381-1).
            const printed = ordinal === null ? participantCode : participantSegment({ code: participantCode, ordinal });
            return { value: id, label: `${company.legalName[locale]}${printed === null ? "" : code(printed)}` };
          })}
          trades={dimensions.trade.map((v) => ({ value: v.id, label: `${v.name[locale]}${code(v.code)}` }))}
          locations={treeOrder(dimensions.location).map((v) => ({
            value: v.id,
            label: `${"— ".repeat(v.level)}${v.name[locale]}${code(v.code)}`,
          }))}
        />
      )}
    </>
  );
}
