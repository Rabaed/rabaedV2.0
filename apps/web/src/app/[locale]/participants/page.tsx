import type { Locale } from "@rabaed/domain";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getCompanyParticipations, getMe } from "@/lib/session";

/** The Authorized Person's view of every Project their Company takes part in. */
export default async function ParticipationsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("participants");
  const [me, list] = await Promise.all([getMe(), getCompanyParticipations()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  if (!me.member.isAuthorizedPerson) return redirect({ href: "/", locale });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h4 font-semibold">{t("title")}</h1>
        <p className="text-muted">{t("subtitle", { company: me.company.legalName[locale] })}</p>
      </div>
      {!list ? (
        <p role="alert" className="text-danger">
          {t("unavailable")}
        </p>
      ) : list.participants.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
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
