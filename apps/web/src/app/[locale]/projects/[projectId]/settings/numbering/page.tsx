import { participantSegment, rabaedDefaultNumberingPattern, type Locale } from "@rabaed/domain";
import { SettingsHeader, type NumberingContext } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DocumentNumberingSettings } from "@/components/document-numbering-settings";
import { NumberingCountersSection } from "@/components/numbering-counters";
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
 * Project Settings → Document Numbering (spec RP-311, rebuilt to the kit in RP-412):
 * the live preview, the Project pattern, its sequence, the Work Item Types with
 * their Custom patterns, the revision suffix, the versions, the Participant Codes
 * and, for Project Admins, the counters. Every Project Member reads it; only a
 * Project Admin changes it.
 *
 * Visibility: the counters are fetched for Project Admins only, since the API gives
 * them to nobody else (visibility.md scenario 55); they turn the page's examples
 * into real next numbers. Anyone else gets examples from their own Participant,
 * sequence from 1 (RP-412-2). The Participants are those the API lists for the
 * viewer: every one for a Project Admin, otherwise only their own Company's (V15).
 */
export default async function NumberingPage({ params }: { params: Promise<{ locale: Locale; projectId: string }> }) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("numbering.page");
  const ts = await getTranslations("settings");
  const [me, project, settings] = await Promise.all([getMe(), getProject(projectId), getNumberingSettings(projectId)]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!project || !settings) notFound();

  const [participants, counters, dimensions] = await Promise.all([
    getProjectParticipants(projectId),
    project.isProjectAdmin ? getNumberingCounters(projectId) : null,
    getProjectDimensions(projectId),
  ]);
  const code = (value: string) => ` (${LRI}${value}${PDI})`;
  const trades = dimensions?.trade ?? [];
  const own = participants?.participants.find((p) => p.isOwnCompany);
  const ownName = own?.company.legalName[locale] ?? "";

  // The examples: the viewer's own Participant (as the API gives it to them) with the Project's Trades.
  const context = (name: string, participant: { code: string | null; ordinal: number }, trade: (typeof trades)[number] | undefined): NumberingContext => ({
    label: trade ? `${name} · ${trade.name[locale]}` : name,
    attributes: { ...settings.example, participant, tradeCode: trade?.code ?? settings.example.tradeCode },
  });
  const previewTrade = trades.find((v) => v.code === settings.example.tradeCode) ?? trades[0];
  const preview = context(ownName, settings.example.participant, previewTrade);
  const other = project.isProjectAdmin ? participants?.participants.find((p) => !p.isOwnCompany && p.ordinal !== null) : undefined;
  const samples: NumberingContext[] = project.isProjectAdmin
    ? [
        preview,
        ...(trades[1] ? [context(ownName, settings.example.participant, trades[1])] : []),
        ...(other ? [context(other.company.legalName[locale], { code: other.code, ordinal: other.ordinal! }, previewTrade)] : []),
      ]
    : [preview, ...trades.filter((v) => v !== previewTrade).slice(0, 2).map((v) => context(ownName, settings.example.participant, v))];

  return (
    <>
      <SettingsHeader title={t("title")} description={t("intro")} readOnlyLabel={settings.canEdit ? undefined : ts("readOnly")} />
      <DocumentNumberingSettings
        projectId={project.id}
        canEdit={settings.canEdit}
        projectPattern={settings.project?.pattern ?? rabaedDefaultNumberingPattern}
        isRabaedDefault={settings.project === null}
        types={settings.types.map((type) => ({ id: type.id, code: type.code, name: type.name[locale], custom: type.override?.pattern ?? null }))}
        preview={preview}
        samples={samples}
        counters={counters?.counters}
        tradeCodes={trades.slice(0, 2).map((v) => v.code)}
        versions={settings.versions}
        example={preview.attributes}
      />
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
