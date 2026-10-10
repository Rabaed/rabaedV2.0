import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { VisibilityEditor } from "@/components/visibility-editor";
import { Link, redirect } from "@/i18n/navigation";
import { getMe, getMemberVisibility, getParticipantMembers } from "@/lib/session";

/**
 * A Project Member's Visibility. Their Company's Authorized Person narrows it,
 * choosing only among what the Participant covers (a Member never covers more).
 */
export default async function MemberVisibilityPage({
  params,
}: {
  params: Promise<{ locale: Locale; participantId: string; memberId: string }>;
}) {
  const { locale, participantId, memberId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("visibility");
  const [me, participation, data] = await Promise.all([
    getMe(),
    getParticipantMembers(participantId),
    getMemberVisibility(participantId, memberId),
  ]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // Another Company's Members are not found, exactly like ones that don't exist.
  if (!participation || !data) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href={`/participants/${participantId}`} className="text-sm text-brand-fg underline underline-offset-4">
          {participation.participant.project.name[locale]} · {participation.participant.projectRole.name[locale]}
        </Link>
        <h1 className="text-h4 font-semibold">{t("memberTitle", { name: data.member.fullName[locale] })}</h1>
        <p className="text-muted">{t("memberHint")}</p>
      </div>
      <VisibilityEditor
        options={data.participant.covered}
        visibility={data.visibility}
        endpoint={
          me.member.isAuthorizedPerson ? `/api/v1/participants/${participantId}/members/${memberId}/visibility` : null
        }
        allLabel={{ trade: t("allOfCompanyTrades"), location: t("allOfCompanyLocations") }}
      />
    </div>
  );
}
