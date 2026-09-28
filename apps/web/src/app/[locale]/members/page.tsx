import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { InviteMemberForm } from "@/components/invite-member-form";
import { MemberActions } from "@/components/member-actions";
import { redirect } from "@/i18n/navigation";
import { getMe, getMembers } from "@/lib/session";

export default async function MembersPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("members");
  const [me, list] = await Promise.all([getMe(), getMembers()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!list) {
    return (
      <p role="alert" className="text-danger">
        {t("unavailable")}
      </p>
    );
  }
  const canManage = me.member.isAuthorizedPerson;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
        <p className="text-muted">{t("subtitle", { company: me.company.legalName[locale] })}</p>
      </div>

      {canManage && <InviteMemberForm />}

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="members">
          <thead className="text-start text-muted">
            <tr className="border-b border-border">
              <th className="py-2 pe-4 text-start font-medium">{t("name")}</th>
              <th className="py-2 pe-4 text-start font-medium">{t("status")}</th>
              <th className="py-2 pe-4 text-start font-medium">{t("projectCreator")}</th>
              {canManage && <th className="py-2 text-start font-medium">{t("actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {list.members.map((m) => (
              <tr key={m.id} className="border-b border-border align-top">
                <td className="py-3 pe-4">
                  <div className="font-medium">
                    {m.fullName[locale]}
                    {m.isAuthorizedPerson && <span className="text-muted"> · {t("authorizedPerson")}</span>}
                  </div>
                  <bdi dir="ltr" className="text-muted">
                    {m.email}
                  </bdi>
                </td>
                <td className="py-3 pe-4">{t(`statuses.${m.status}`)}</td>
                <td className="py-3 pe-4">{m.canCreateProjects ? t("yes") : t("no")}</td>
                {canManage && (
                  <td className="py-3">
                    <MemberActions member={m} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
