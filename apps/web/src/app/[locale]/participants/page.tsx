import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { InvitationActions } from "@/components/invitation-actions";
import { Link, redirect } from "@/i18n/navigation";
import { getCompanyInvitations, getCompanyParticipations, getMe } from "@/lib/session";

/**
 * Company Projects: every Project the Company takes part in that the Member may
 * look into (the Authorized Person every one, any other Member those they are a
 * Project Member of), read-only but for the Authorized Person (V15). Only the
 * Authorized Person gets the Projects it is invited to: those show only the
 * Project's name, its Host Company and the offered Project Role until accepted
 * (ADR 0009).
 */
export default async function ParticipationsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("participants");
  const [me, list, invited] = await Promise.all([getMe(), getCompanyParticipations(), getCompanyInvitations()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // Any other Member reads the Projects they are on, read-only.
  const manages = me.member.isAuthorizedPerson;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
        <p className="text-muted">{t(manages ? "subtitle" : "subtitleMember", { company: me.company.legalName[locale] })}</p>
      </div>
      {invited && invited.invitations.length > 0 && (
        <section className="space-y-2" aria-labelledby="invitations-title">
          <h2 id="invitations-title" className="text-h6 font-semibold">
            {t("invitationsTitle")}
          </h2>
          <ul className="divide-y divide-border border-y border-border" data-testid="invitations">
            {invited.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                <span>
                  <span className="font-medium">{i.project.name[locale]}</span>{" "}
                  <span className="text-sm text-muted">
                    · {t("offeredRole", { role: i.projectRole.name[locale] })} ·{" "}
                    {t("hostedBy", { company: i.hostCompany.legalName[locale] })}
                  </span>
                </span>
                <InvitationActions invitationId={i.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {!list ? (
        <p role="alert" className="text-danger-fg">
          {t("unavailable")}
        </p>
      ) : list.participants.length === 0 ? (
        <p className="text-muted">{t(manages ? "empty" : "emptyMember")}</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {list.participants.map((p) => (
            <li key={p.id}>
              <Link href={`/participants/${p.id}`} className="flex items-baseline justify-between gap-4 py-3 hover:bg-hover">
                <span>
                  <span className="font-medium">{p.project.name[locale]}</span>{" "}
                  <bdi dir="ltr" className="text-muted">
                    {p.project.code}
                  </bdi>
                </span>
                <span className="text-end text-sm text-muted">
                  {p.projectRole.name[locale]} · {t("hostedBy", { company: p.hostCompany.legalName[locale] })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
