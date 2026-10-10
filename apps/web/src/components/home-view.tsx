"use client";

import { formatDayMonthYear, formatNumber, relativeAge, workItemListHref, type Home, type Locale } from "@rabaed/domain";
import { NeedsMyActionCard, ProjectCard, RecentActivityCard, StatTile } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { NewProjectDialog } from "./new-project-dialog";

/** How many Project cards Home shows; "View all" opens the Projects page. */
const projectCards = 3;

/**
 * Home across the Member's Projects (RP-407), as the design kit lays it out:
 * the greeting with "New project", four counts, what needs them beside recent
 * activity, and their Projects, all from GET /v1/home as they may see it. The
 * page works out the greeting and the time; this lays it out.
 */
export function HomeView({
  home,
  locale,
  greeting,
  canCreateProjects,
  now,
}: {
  home: Home;
  locale: Locale;
  greeting: string;
  canCreateProjects: boolean;
  /** When the page was made: recent activity's "10m ago" counts from it, so the server and the browser agree. */
  now: string;
}) {
  const t = useTranslations("home");
  const tFeed = useTranslations("workItemViews.activityFeed");
  const tBoard = useTranslations("workItemViews.board");
  const tProjects = useTranslations("projects");

  const moduleOf = (projectId: string) => home.needsMyAction.find((i) => i.project.id === projectId)?.moduleKey ?? "submittals";
  // "Open board": the Project with the most waiting on the Member first, the others in its menu.
  const waiting = home.projects.filter((p) => p.status === "active" && p.needMyAction > 0).toSorted((a, b) => b.needMyAction - a.needMyAction);
  const boards = waiting.map((p, i) => ({
    key: p.id,
    label: i === 0 ? t("openBoard") : t("openBoardOf", { code: p.code }),
    href: `${workItemListHref(p.id, { module: moduleOf(p.id), needMyAction: true })}&view=kanban`,
  }));
  const at = new Date(now);
  const when = (time: string) => {
    const age = relativeAge(time, at);
    switch (age.unit) {
      case "now":
        return t("justNow");
      case "minutes":
        return t("minutesAgo", { count: age.count, n: formatNumber(age.count, locale) });
      case "hours":
        return t("hoursAgo", { count: age.count, n: formatNumber(age.count, locale) });
      case "date":
        return formatDayMonthYear(new Date(time), locale);
    }
  };
  const itemHref = (id: string) => `/work-items/${id}`;
  const shown = home.projects.toSorted((a, b) => Number(a.status === "closed") - Number(b.status === "closed")).slice(0, projectCards);

  return (
    <div className="flex flex-col">
      <div className="mb-[22px] flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-h4 leading-tight font-bold tracking-[-0.01em] ltr:font-extrabold">{greeting}</h1>
          <p className="text-body text-muted">{t("intro")}</p>
        </div>
        {canCreateProjects && (
          <div className="ms-auto">
            <NewProjectDialog className="h-[42px] rounded-[11px] px-4 font-semibold" />
          </div>
        )}
      </div>

      <section aria-label={t("counts")} className="mb-[18px] grid grid-cols-1 gap-[18px] min-[560px]:grid-cols-2 min-[1100px]:grid-cols-4">
        <StatTile icon="buildings" tone="brand" value={home.counts.activeProjects} label={t("activeProjects")} locale={locale} />
        {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy */}
        <StatTile icon="user-circle" tone="info" value={home.counts.needMyAction} label={t("needMyAction")} locale={locale} />
        <StatTile icon="clock" tone="danger" value={home.counts.longAtStep} label={t("longAtStep")} locale={locale} />
        <StatTile icon="hourglass" tone="warning" value={home.counts.waitingWithOthers} label={t("waitingWithOthers")} locale={locale} />
      </section>

      <div className="grid items-stretch gap-[18px] min-[1101px]:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <NeedsMyActionCard
          items={home.needsMyAction}
          locale={locale}
          labels={{
            title: t("needsMyAction"),
            empty: t("nothingWaiting"),
            noNumber: tFeed("noNumber"),
            revision: (n) => tBoard("revision", { n: formatNumber(n, locale) }),
            otherBoards: t("otherBoards"),
          }}
          itemHref={itemHref}
          boards={boards}
          linkAs={Link}
        />
        <RecentActivityCard
          entries={home.activity}
          locale={locale}
          labels={{
            title: t("recentActivity"),
            empty: t("noActivity"),
            verb: (verb) => t("verb", { verb }),
            code: (code) => `(${tBoard("code", { code })})`,
          }}
          when={when}
          itemHref={itemHref}
          linkAs={Link}
        />
      </div>

      <section aria-labelledby="home-your-projects" className="mt-7 flex flex-col">
        <div className="mb-3.5 flex flex-wrap items-end gap-4">
          <h2 id="home-your-projects" className="font-display text-h6 leading-tight font-bold ltr:font-extrabold">
            {t("yourProjects")}
          </h2>
          {home.projects.length > 0 && (
            <Link
              href="/projects"
              className="ms-auto inline-flex h-[34px] items-center rounded-[9px] border border-border-strong bg-surface px-3 text-[13px] font-semibold whitespace-nowrap text-text-secondary hover:bg-hover"
            >
              {t("viewAll")}
            </Link>
          )}
        </div>
        {home.projects.length === 0 ? (
          <p className="text-muted">{t("noProjects")}</p>
        ) : (
          <ul aria-label={t("yourProjects")} className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-[18px]">
            {shown.map((p) => {
              const count = home.submittals[p.id];
              return (
                <li key={p.id} className="flex">
                  <ProjectCard
                    project={p}
                    locale={locale}
                    labels={{
                      list: t("yourProjects"),
                      needMyAction: tProjects("needMyAction"),
                      active: tProjects("active"),
                      closed: tProjects("closed"),
                      projectAdmin: tProjects("projectAdmin"),
                    }}
                    href={`/projects/${p.id}`}
                    linkAs={Link}
                    {...(count === undefined ? {} : { submittals: t("submittals", { count, n: formatNumber(count, locale) }) })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
