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
  const canManage = me.member.isAuthorizedPerson;

  return (
    <div>
      <div className="mb-5.5 flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-h4 leading-[1.2] font-extrabold tracking-[-0.01em] text-text rtl:font-bold rtl:tracking-normal">{t("title")}</h1>
          <p className="text-body text-muted">{t("subtitle")}</p>
        </div>
        {canManage && (
          <div className="ms-auto">
            <InviteMemberDialog />
          </div>
        )}
      </div>
      {list ? (
        <MembersTable members={list.members} canManage={canManage} />
      ) : (
        <p role="alert" className="text-danger">
          {t("unavailable")}
        </p>
      )}
    </div>
  );
}
