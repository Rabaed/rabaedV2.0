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
  /** A closed Project's badge. */
  closed: string;
  projectAdmin: string;
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
 * The Projects page, the Member's home page (RP-346): one card per Project, a
 * link to it, with how many items need the Member's action there (the Steps
 * they hold and the not picked up Steps of their pool; never their own Drafts).
 * The cards stack on a phone.
 */
export function ProjectCards({ projects, locale, labels, href, linkAs }: ProjectCardsProps) {
  return (
    <ul aria-label={labels.list} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <li key={p.id} className="flex">
          <ProjectCard project={p} locale={locale} labels={labels} href={href(p.id)} linkAs={linkAs} />
        </li>
      ))}
    </ul>
  );
}

function ProjectCard({
  project: p,
  locale,
  labels,
  href,
  linkAs: Link = "a",
}: {
  project: ProjectSummary;
  locale: Locale;
  labels: ProjectCardsLabels;
  href: string;
  linkAs?: ElementType;
}) {
  const id = useId();
  const count = formatNumber(p.needMyAction, locale);
  const closed = p.status === "closed";
  return (
    <Link
      href={href}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-details`}
      className={cn(
        "flex min-h-11 w-full flex-col gap-3 rounded-md border border-border bg-surface p-4 text-start shadow-xs",
        "transition-colors duration-150 hover:border-border-strong hover:bg-hover",
        focusRing,
      )}
    >
      <span className="flex flex-col gap-1">
        {/* The Project code, as in Document Numbers: always left-to-right. */}
        <bdi dir="ltr" className="self-start text-caption text-muted">
          {p.code}
        </bdi>
        <span id={`${id}-name`} className="text-body font-semibold text-text">
          {p.name[locale]}
        </span>
      </span>
      <span id={`${id}-details`} className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <span className="text-caption text-muted">
          {p.projectRole.name[locale]}
          {p.isProjectAdmin && ` · ${labels.projectAdmin}`}
          {closed && (
            <>
              {" "}
              <Badge>{labels.closed}</Badge>
            </>
          )}
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
