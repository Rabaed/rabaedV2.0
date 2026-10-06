"use client";

import type { Locale, ProjectSummary } from "@rabaed/domain";
import { ProjectCards } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** The Projects page's cards, each linking to its Project with its Need My Action count. */
export function ProjectCardsView({ projects, locale }: { projects: ProjectSummary[]; locale: Locale }) {
  const t = useTranslations("projects");
  return (
    <ProjectCards
      projects={projects}
      locale={locale}
      labels={{ list: t("title"), needMyAction: t("needMyAction"), closed: t("closed"), projectAdmin: t("projectAdmin") }}
      href={(id) => `/projects/${id}`}
      linkAs={Link}
    />
  );
}
