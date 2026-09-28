import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ProjectMembersEditor } from "@/components/project-members-editor";
import { redirect } from "@/i18n/navigation";
import { getMe, getMembers, getParticipantMembers } from "@/lib/session";

/** One of your Company's Participants and its Project Members; the Authorized Person adds and removes them. */
export default async function ParticipantPage({
  params,
}: {
  params: Promise<{ locale: Locale; participantId: string }>;
}) {
  const { locale, participantId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("participants");
  const [me, data, company] = await Promise.all([getMe(), getParticipantMembers(participantId), getMembers()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // Another Participant's list is not found, exactly like one that doesn't exist.
  if (!data) notFound();

  const onProject = new Set(data.members.map((m) => m.id));
  const candidates = me.member.isAuthorizedPerson
    ? (company?.members ?? [])
        .filter((m) => !onProject.has(m.id) && (m.status === "active" || m.status === "invited"))
        .map((m) => ({ id: m.id, name: m.fullName[locale] }))
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h4 font-semibold">{t("membersTitle")}</h1>
        <p className="text-muted">
          {data.participant.project.name[locale]} · {data.participant.projectRole.name[locale]}
        </p>
      </div>
      <ProjectMembersEditor
        participantId={data.participant.id}
        members={data.members.map((m) => ({ id: m.id, name: m.fullName[locale], email: m.email, positions: m.positions }))}
        positions={data.positions.map((p) => ({ key: p.key, name: p.name[locale] }))}
        candidates={candidates}
      />
    </div>
  );
}
