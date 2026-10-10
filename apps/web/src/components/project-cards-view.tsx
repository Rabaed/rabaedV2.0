"use client";

import type { Locale, ProjectSummary } from "@rabaed/domain";
import { ProjectsBrowser } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/** The Projects page's body: search, the All / Active / Closed chips and a card per Project, each linking to its Project. */
export function ProjectCardsView({
  projects,
  submittals,
  locale,
  emptyAction,
}: {
  projects: ProjectSummary[];
  /** Each Project's Submittals the Member sees, by Project id. */
  submittals: Record<string, number>;
  locale: Locale;
  /** Under the empty state, for someone who may create a Project. */
  emptyAction?: ReactNode;
}) {
  const t = useTranslations("projects");
  return (
    <ProjectsBrowser
      projects={projects}
      submittals={submittals}
      locale={locale}
      labels={{
        list: t("title"),
        needMyAction: (_count, n) => t("cardNeedMyAction", { n }),
        submittals: (count, n) => t("cardSubmittals", { count, n }),
        active: t("active"),
        closed: t("closed"),
        projectAdmin: t("projectAdmin"),
        search: t("search"),
        filter: t("filter"),
        all: t("all"),
        emptyTitle: t("emptyTitle"),
        empty: emptyAction ? t("emptyCreator") : t("empty"),
        noMatchesTitle: t("noMatchesTitle"),
        noMatches: t("noMatches"),
      }}
      href={(id) => `/projects/${id}`}
      linkAs={Link}
      emptyAction={emptyAction}
    />
  );
}
