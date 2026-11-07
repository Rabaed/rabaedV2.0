import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { MemberVisibilityEditor } from "@/components/participants/member-visibility-editor";
import { ParticipantsBreadcrumb, ParticipantsHeading, ReadOnlyNotice, VisibilityGapWarning } from "@/components/participants/participants-parts";
import { redirect } from "@/i18n/navigation";
import { authorizedPersonName } from "@/lib/participants";
import { getMe, getMemberVisibility, getMembers, getParticipantMembers } from "@/lib/session";

/**
 * A Project Member's Visibility. Their Company's Authorized Person narrows it, choosing only
 * among what the Participant covers (a Member never covers more, V4); their Company's other
 * Members read it. Nothing else of the Project's Trades and Locations is shown (V16).
 */
export default async function MemberVisibilityPage({
  params,
}: {
  params: Promise<{ locale: Locale; participantId: string; memberId: string }>;
}) {
  const { locale, participantId, memberId } = await params;
  setRequestLocale(locale);
  const [t, tp] = await Promise.all([getTranslations("visibility"), getTranslations("participants")]);
  const [me, participation, data, members] = await Promise.all([
    getMe(),
    getParticipantMembers(participantId),
    getMemberVisibility(participantId, memberId),
    getMembers(),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // Another Company's Members are not found, exactly like ones that don't exist.
  if (!participation || !data) notFound();

  const manages = me.member.isAuthorizedPerson;
  const project = participation.participant.project.name[locale];
  const company = me.company.legalName[locale];
  const name = data.member.fullName[locale];

  return (
    <div className="space-y-6">
      <ParticipantsBreadcrumb
        label={tp("breadcrumb")}
        back={`/participants/${participantId}`}
        crumbs={[
          { label: tp("myCompany") },
          { label: tp("title"), href: "/participants" },
          { label: project, href: `/participants/${participantId}` },
          { label: `${name} · ${t("title")}` },
        ]}
      />
      <ParticipantsHeading title={t("memberTitle", { name })} description={t("memberPageHint", { name, project, company })} />
      {!manages && <ReadOnlyNotice>{tp("readOnly", { name: authorizedPersonName(members, locale) })}</ReadOnlyNotice>}
      {participation.gap && (
        <VisibilityGapWarning
          gap={participation.gap}
          covered={participation.covered}
          title={tp("gapTitle")}
          body={tp("gapBody", { project, company })}
          locale={locale}
        />
      )}
      <MemberVisibilityEditor
        options={data.participant.covered}
        visibility={data.visibility}
        endpoint={manages ? `/api/v1/participants/${participantId}/members/${memberId}/visibility` : null}
        memberName={name}
      />
    </div>
  );
}
