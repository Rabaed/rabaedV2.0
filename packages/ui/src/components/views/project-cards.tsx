"use client";

import { formatNumber, type Locale, type ProjectSummary } from "@rabaed/domain";
import { useId, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { Badge } from "../data/badge.tsx";
import { focusRing } from "../form/control-styles.ts";

/** The cards' words, in the viewer's language, from the app's messages. */
export type ProjectCardsLabels = {
  /** The list's name, e.g. "Projects". */
  list: string;
  needMyAction: string;
  /** An active Project's state. */
  active: string;
  /** A closed Project's state. */
  closed: string;
  projectAdmin: string;
};

export type ProjectCardProps = {
  project: ProjectSummary;
  locale: Locale;
  labels: ProjectCardsLabels;
  /** The Project's page. */
  href: string;
  /** The link component, e.g. Next.js `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
};

export type ProjectCardsProps = {
  /** The Member's Projects, as the API lists them. */
  projects: ProjectSummary[];
  locale: Locale;
  labels: ProjectCardsLabels;
  /** A Project's page. */
  href: (projectId: string) => string;
  /** The link component, e.g. Next.js `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/**
 * A grid of Project cards, one link per Project, with how many items need the
 * Member's action there (the Steps they hold and the unclaimed Steps of their
 * pool; never their own Drafts). Three columns wide, two on a tablet, one on
 * a phone.
 */
export function ProjectCards({ projects, locale, labels, href, linkAs }: ProjectCardsProps) {
  return (
    <ul aria-label={labels.list} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => (
        <li key={p.id} className="flex">
          <ProjectCard project={p} locale={locale} labels={labels} href={href(p.id)} linkAs={linkAs} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One Project as a card and a link: its mark, name, code (left to right) and
 * Host Company, its state, and in the footer the viewer's Company's Project
 * Role and the Need My Action count. No progress, no due date: Rabaed has no
 * time axis.
 */
export function ProjectCard({ project: p, locale, labels, href, linkAs: Link = "a" }: ProjectCardProps) {
  const id = useId();
  const count = formatNumber(p.needMyAction, locale);
  const closed = p.status === "closed";
  const name = p.name[locale];
  return (
    <Link
      href={href}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-state ${id}-details`}
      className={cn(
        "flex w-full min-w-0 flex-col rounded-lg border border-border bg-surface text-start shadow-xs",
        "transition-[border-color,box-shadow,background-color] duration-150 hover:border-border-strong hover:bg-hover hover:shadow-sm",
        focusRing,
      )}
    >
      <span className="flex items-start gap-3 p-4">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary font-display text-h5 font-extrabold text-on-primary"
        >
          {Array.from(name.trim())[0] ?? ""}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={`${id}-name`} className="text-body font-bold text-text [overflow-wrap:anywhere]">
            {name}
          </span>
          {/* The Project code, as in Document Numbers: always left-to-right. */}
          <bdi dir="ltr" className="self-start text-caption text-muted">
            {p.code}
          </bdi>
          <span className="text-caption text-muted [overflow-wrap:anywhere]">{p.hostCompany.legalName[locale]}</span>
        </span>
        <Badge id={`${id}-state`} dot tone={closed ? "neutral" : "success"} className="shrink-0">
          {closed ? labels.closed : labels.active}
        </Badge>
      </span>
      <span
        id={`${id}-details`}
        className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border px-4 py-3"
      >
        <span className="text-caption text-muted">
          {p.projectRole.name[locale]}
          {p.isProjectAdmin && ` · ${labels.projectAdmin}`}
        </span>
        <span className="inline-flex items-center gap-2 text-caption">
          <span className="sr-only">{`${labels.needMyAction}: ${count}`}</span>
          <span aria-hidden="true" className="text-muted">
            {labels.needMyAction}
          </span>
          <Badge aria-hidden="true" tone={p.needMyAction > 0 ? "brand" : "neutral"}>
            {count}
          </Badge>
        </span>
      </span>
    </Link>
  );
}
