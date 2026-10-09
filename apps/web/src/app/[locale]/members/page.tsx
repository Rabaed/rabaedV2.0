import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { MembersTable } from "@/components/members-table";
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
    <div className="space-y-5">
      <p className="text-body text-muted">{t("subtitle", { company: me.company.legalName[locale] })}</p>
      <MembersTable members={list.members} canManage={canManage} invite={canManage ? <InviteMemberDialog /> : undefined} />
    </div>
  );
}
