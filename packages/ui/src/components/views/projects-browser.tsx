"use client";

import type { Locale, ProjectSummary } from "@rabaed/domain";
import { useId, useMemo, useState, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing, touchArea } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { EmptyState } from "../feedback/states.tsx";
import { ProjectCards, type ProjectCardsLabels } from "./project-cards.tsx";

export type ProjectsFilter = "all" | "active" | "closed";

export type ProjectsBrowserLabels = ProjectCardsLabels & {
  /** The search box's accessible name and placeholder, e.g. "Search by name or code". */
  search: string;
  /** The chips' group name, e.g. "Show". */
  filter: string;
  all: string;
  /** Shown when the Member is on no Project. */
  empty: string;
  /** The title over `empty`. */
  emptyTitle: string;
  /** Shown when a search or chip leaves nothing. */
  noMatches: string;
  noMatchesTitle: string;
};

export type ProjectsBrowserProps = {
  projects: ProjectSummary[];
  locale: Locale;
  labels: ProjectsBrowserLabels;
  href: (projectId: string) => string;
  linkAs?: ElementType;
  /** An action under the empty state, e.g. "New project" for someone who may create one. */
  emptyAction?: ReactNode;
};

/** The Projects that match a search (name in either language, or code) and a state chip. */
export function filterProjects(projects: ProjectSummary[], search: string, filter: ProjectsFilter): ProjectSummary[] {
  const needle = search.trim().toLocaleLowerCase();
  return projects.filter((p) => {
    if (filter === "active" && p.status !== "active") return false;
    if (filter === "closed" && p.status !== "closed") return false;
    if (needle === "") return true;
    return [p.code, p.name.en, p.name.ar].some((text) => text.toLocaleLowerCase().includes(needle));
  });
}

/**
 * The Projects page's body: a search box, the All / Active / Closed chips and
 * the card grid, filtered as the Member types. An empty state when the Member
 * is on no Project, another when the search leaves none.
 */
export function ProjectsBrowser({ projects, locale, labels, href, linkAs, emptyAction }: ProjectsBrowserProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProjectsFilter>("all");
  const groupId = useId();
  const shown = useMemo(() => filterProjects(projects, search, filter), [projects, search, filter]);

  if (projects.length === 0) {
    return (
      <EmptyState title={labels.emptyTitle} action={emptyAction}>
        {labels.empty}
      </EmptyState>
    );
  }

  const chips: { value: ProjectsFilter; label: string }[] = [
    { value: "all", label: labels.all },
    { value: "active", label: labels.active },
    { value: "closed", label: labels.closed },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-60 flex-1 sm:w-80 sm:flex-none">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute inset-y-0 start-2.5 my-auto text-muted"
          />
          <input
            type="search"
            aria-label={labels.search}
            placeholder={labels.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={cn(
              "h-10 w-full rounded-md border border-control-border bg-surface ps-8 pe-3 text-body text-text",
              "placeholder:text-muted hover:border-control-border-hover",
              focusRing,
              "pointer-coarse:min-h-11",
            )}
          />
        </div>
        <div role="group" aria-labelledby={groupId} className="flex flex-wrap gap-2">
          <span id={groupId} className="sr-only">
            {labels.filter}
          </span>
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={filter === chip.value}
              onClick={() => setFilter(chip.value)}
              className={cn(
                "h-9 rounded-full border px-4 text-sm font-semibold transition-colors duration-150",
                filter === chip.value
                  ? "border-inverse bg-inverse text-on-inverse"
                  : "border-border bg-surface text-text-secondary hover:bg-hover",
                touchArea,
                focusRing,
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="search" title={labels.noMatchesTitle}>
          {labels.noMatches}
        </EmptyState>
      ) : (
        <ProjectCards projects={shown} locale={locale} labels={labels} href={href} linkAs={linkAs} />
      )}
    </div>
  );
}
