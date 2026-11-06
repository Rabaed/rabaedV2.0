import { formatNumber, relativeAge, type Locale } from "@rabaed/domain";
import { Badge, Icon, projectTileIndexes } from "@rabaed/ui";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { InvitationCard } from "@/components/participants/invitation-card";
import { outlined, ParticipantsBreadcrumb, ParticipantsHeading, ReadOnlyNotice, SectionHeading } from "@/components/participants/participants-parts";
import { Link, redirect } from "@/i18n/navigation";
import { authorizedPersonName } from "@/lib/participants";
import { getCompanyInvitations, getCompanyParticipations, getMe, getMembers } from "@/lib/session";

/** The Project tile's colours, as on the Projects page's cards; static so Tailwind finds them. */
const tileClasses = ["bg-project-tile-1", "bg-project-tile-2", "bg-project-tile-3", "bg-project-tile-4", "bg-project-tile-5"] as const;

/**
 * Participants (the sidebar's name for Company Projects): every Project the Company takes part
 * in that the Member may look into (the Authorized Person every one, any other Member those they
 * are a Project Member of), read-only but for the Authorized Person (V15). Only the Authorized
 * Person gets the Projects it is invited to: those show only the Project's name, its Host Company
 * and the offered Project Role until accepted (ADR 0009). No other Participant is ever named.
 */
export default async function ParticipationsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("participants");
  const [me, list, invited, members] = await Promise.all([getMe(), getCompanyParticipations(), getCompanyInvitations(), getMembers()]);
  if (!me) return redirect({ href: "/sign-in", locale });
  // Any other Member reads the Projects they are on, read-only.
  const manages = me.member.isAuthorizedPerson;
  const company = me.company.legalName[locale];
  const now = new Date();

  const ago = (at: string) => {
    const age = relativeAge(at, now);
    const n = (count: number) => formatNumber(count, locale);
    if (age.unit === "now") return t("justNow");
    if (age.unit === "minutes") return t("minutesAgo", { count: age.count, n: n(age.count) });
    if (age.unit === "hours") return t("hoursAgo", { count: age.count, n: n(age.count) });
    const days = Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000);
    return t("daysAgo", { count: days, n: n(days) });
  };
  const projects = list?.participants ?? [];
  const tiles = projectTileIndexes(projects.map((p) => p.project.id));
  const invitations = invited?.invitations ?? [];

  return (
    <div className="space-y-6">
      <ParticipantsBreadcrumb label={t("breadcrumb")} crumbs={[{ label: t("myCompany") }, { label: t("title") }]} />
      <ParticipantsHeading title={t("title")} description={t(manages ? "subtitle" : "subtitleMember", { company })} />
      {!manages && <ReadOnlyNotice>{t("readOnly", { name: authorizedPersonName(members, locale) })}</ReadOnlyNotice>}

      {invitations.length > 0 && (
        <section className="space-y-3" aria-labelledby="invitations-title">
          <SectionHeading id="invitations-title" title={t("invitationsTitle")} count={invitations.length} />
          <ul className="space-y-3" data-testid="invitations">
            {invitations.map((i) => (
              <InvitationCard
                key={i.id}
                id={i.id}
                project={i.project.name[locale]}
                host={i.hostCompany.legalName[locale]}
                company={company}
                role={i.projectRole.name[locale]}
                ago={ago(i.invitedAt)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="company-projects-title">
        <SectionHeading id="company-projects-title" title={t("companyProjects")} count={projects.length} />
        {!list ? (
          <p role="alert" className="text-danger-fg">
            {t("unavailable")}
          </p>
        ) : projects.length === 0 ? (
          <p className="text-muted">{t(manages ? "empty" : "emptyMember")}</p>
        ) : (
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))]" data-testid="company-projects">
            {projects.map((p, index) => (
              <li key={p.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-md text-[11px] font-extrabold tracking-tight text-on-avatar ${tileClasses[tiles[index]!]}`}
                    aria-hidden
                  >
                    <bdi dir="ltr">{p.project.code}</bdi>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-text">{p.project.name[locale]}</p>
                    <p className="text-sm text-muted">
                      <bdi dir="ltr">
                        {p.project.code} · {p.project.projectNumber}
                      </bdi>
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-1.5 text-sm">
                  <dt className="text-muted">{t("hostCompany")}</dt>
                  <dd className="font-semibold text-text">{p.hostCompany.legalName[locale]}</dd>
                  <dt className="text-muted">{t("ourRole")}</dt>
                  <dd>
                    <Badge tone="warning">{p.projectRole.name[locale]}</Badge>
                  </dd>
                </dl>
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
                  <span className="flex items-center gap-1.5 text-sm text-muted">
                    {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy */}
                    <Icon name="users" size={16} />
                    {t("memberCount", { count: p.memberCount, n: formatNumber(p.memberCount, locale) })}
                  </span>
                  <Link
                    href={`/participants/${p.id}`}
                    className={outlined}
                  >
                    {t("projectMembersButton")}
                    <Icon name="arrow-right" size={16} />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
