"use client";

import type { Locale, ProjectSummary } from "@rabaed/domain";
import { ProjectCards } from "@rabaed/ui";
import { Link } from "@/i18n/navigation";

/** The Projects page's cards, each linking to its Project with its Need My Action count. */
export function ProjectCardsView({ projects, locale }: { projects: ProjectSummary[]; locale: Locale }) {
  return <ProjectCards projects={projects} locale={locale} href={(id) => `/projects/${id}`} linkAs={Link} />;
}
