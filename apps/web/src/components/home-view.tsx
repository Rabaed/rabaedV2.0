"use client";

import { workItemListHref, type Home, type Locale } from "@rabaed/domain";
import { NeedsMyActionCard, ProjectCards, RecentActivityCard, StatTile, buttonVariants } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { NewProjectDialog } from "./new-project-dialog";

/** How many Project cards Home shows; "View all" opens the Projects page. */
const projectCards = 3;

/**
 * Home across the Member's Projects (RP-407): the greeting, the counts, what
 * needs them, recent activity and their Projects, all from GET /v1/home as
 * they may see it. The page works out the greeting; this lays it out.
 */
export function HomeView({ home, locale, greeting, canCreateProjects }: { home: Home; locale: Locale; greeting: string; canCreateProjects: boolean }) {
  const t = useTranslations("home");
  const tFeed = useTranslations("workItemViews.activityFeed");
  const tProjects = useTranslations("projects");

  // "Open board": each Project with an item waiting, its Kanban showing its Need My Action.
  const boardProjects = home.projects.filter((p) => home.needsMyAction.some((i) => i.project.id === p.id));
  const boards = boardProjects.map((p) => ({
    key: p.id,
    label: boardProjects.length === 1 ? t("openBoard") : t("openBoardOf", { code: p.code }),
    href: `${workItemListHref(p.id, { module: home.needsMyAction.find((i) => i.project.id === p.id)!.moduleKey, needMyAction: true })}&view=kanban`,
  }));
  const itemHref = (id: string) => `/work-items/${id}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-h4 font-bold text-text">{greeting}</h1>
          <p className="text-body text-muted">{t("intro")}</p>
        </div>
        {canCreateProjects && <NewProjectDialog />}
      </div>

      <section aria-label={t("counts")} className="grid gap-4 sm:grid-cols-3">
        <StatTile icon="buildings" tone="brand" value={home.counts.activeProjects} label={t("activeProjects")} locale={locale} />
        {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy */}
        <StatTile icon="user" tone="info" value={home.counts.needMyAction} label={t("needMyAction")} locale={locale} />
        <StatTile icon="clock" tone="warning" value={home.counts.longAtStep} label={t("longAtStep")} locale={locale} />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17.5rem,1fr)]">
        <NeedsMyActionCard
          items={home.needsMyAction}
          locale={locale}
          labels={{ title: t("needsMyAction"), empty: t("nothingWaiting"), noNumber: tFeed("noNumber") }}
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
            noNumber: tFeed("noNumber"),
            internal: tFeed("internal"),
            claimed: tFeed("claimed"),
            released: tFeed("released"),
            assigned: tFeed("assigned"),
            internalNote: tFeed("internalNote"),
            recommended: tFeed("recommended"),
            cancelled: tFeed("cancelled"),
            updated: tFeed("updated"),
          }}
          itemHref={itemHref}
          linkAs={Link}
        />
      </div>

      <section aria-labelledby="home-your-projects" className="mt-3 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="home-your-projects" className="font-display text-h6 font-bold">
            {t("yourProjects")}
          </h2>
          {home.projects.length > 0 && (
            <Link href="/projects" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              {t("viewAll")}
            </Link>
          )}
        </div>
        {home.projects.length === 0 ? (
          <p className="text-muted">{t("noProjects")}</p>
        ) : (
          <ProjectCards
            projects={home.projects.toSorted((a, b) => Number(a.status === "closed") - Number(b.status === "closed")).slice(0, projectCards)}
            locale={locale}
            labels={{
              list: t("yourProjects"),
              needMyAction: tProjects("needMyAction"),
              active: tProjects("active"),
              closed: tProjects("closed"),
              projectAdmin: tProjects("projectAdmin"),
            }}
            href={(id) => `/projects/${id}`}
            linkAs={Link}
          />
        )}
      </section>
    </div>
  );
}
