"use client";

import { formatNumber, type Locale, type ProjectSummary } from "@rabaed/domain";
import { useId, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { Badge } from "../data/badge.tsx";
import { focusRing } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { projectTileClasses, projectTileIndex, projectTileIndexes } from "./project-tile.ts";

/** The cards' words, in the viewer's language, from the app's messages. */
export type ProjectCardsLabels = {
  /** The list's name, e.g. "Projects". */
  list: string;
  /** "3 need my action": the count in the card's footer, worded (and pluralised) for the language. `n` is the count as the language writes it. */
  needMyAction: (count: number, n: string) => string;
  /** "48 submittals": how many Submittals the Member sees on the Project. */
  submittals: (count: number, n: string) => string;
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
  /** How many Submittals the Member sees on the Project (their Submittals List's count). Left out, the card shows none. */
  submittals?: number | undefined;
  /** Which of the palette's five tile colours (`projectTileIndexes`, down a list). Left out, the Project's own. */
  tile?: number | undefined;
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
  /** Each Project's Submittals count by Project id, as the API gives them. */
  submittals?: Record<string, number>;
};

/**
 * A grid of Project cards as the design kit lays them out, one link per Project,
 * with how many items need the Member's action there (the Steps they hold and
 * the unclaimed Steps of their pool; never their own Drafts). As many 300px
 * columns as fit, 18px apart; one on a phone.
 */
export function ProjectCards({ projects, locale, labels, href, linkAs, submittals }: ProjectCardsProps) {
  const tiles = projectTileIndexes(projects.map((p) => p.id));
  return (
    <ul aria-label={labels.list} className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-[18px]">
      {projects.map((p, i) => (
        <li key={p.id} className="flex">
          <ProjectCard project={p} locale={locale} labels={labels} href={href(p.id)} linkAs={linkAs} submittals={submittals?.[p.id]} tile={tiles[i]} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One Project as a card and a link, as in the design kit: a letter tile in the
 * Project's own colour, its name and Host Company, its state (Active or
 * Closed), and below a rule how many Submittals the Member sees, how many need
 * their action and the Project code (left to right); last, on a line of its
 * own, their Company's Project Role. No progress, no date, no health chip:
 * Rabaed has no time axis.
 */
export function ProjectCard({ project: p, locale, labels, href, linkAs: Link = "a", submittals, tile }: ProjectCardProps) {
  const id = useId();
  const closed = p.status === "closed";
  const name = p.name[locale];
  return (
    <Link
      href={href}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-state ${id}-details`}
      className={cn(
        "flex w-full min-w-0 flex-col gap-[14px] rounded-[16px] border border-border bg-surface p-[18px] text-start",
        "transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-[0_8px_22px_color-mix(in_srgb,var(--shadow-colour)_9%,transparent)]",
        focusRing,
      )}
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-[12px] font-display text-[19px] font-extrabold text-on-avatar",
            projectTileClasses[tile ?? projectTileIndex(p.id)],
          )}
        >
          {Array.from(p.name.en.trim())[0] ?? ""}
        </span>
        <span className="flex min-w-0 flex-col">
          <span id={`${id}-name`} className="text-[15.5px] leading-snug font-bold text-text [overflow-wrap:anywhere]">
            {name}
          </span>
          <span className="text-[13px] text-muted [overflow-wrap:anywhere]">{p.hostCompany.legalName[locale]}</span>
        </span>
        <Badge id={`${id}-state`} dot tone={closed ? "neutral" : "success"} className="ms-auto shrink-0 gap-[5px] self-start rounded-[7px] text-[12px]">
          {closed ? labels.closed : labels.active}
        </Badge>
      </span>
      <span id={`${id}-details`} className="flex flex-col gap-2 border-t border-border-subtle pt-3">
        <span className="flex flex-wrap gap-2 text-[12.5px] text-text-secondary">
          {submittals !== undefined && (
            <span className="inline-flex items-center gap-[5px]">
              <Icon name="file-text" size={15} className="text-muted" />
              {labels.submittals(submittals, formatNumber(submittals, locale))}
            </span>
          )}
          <span className="inline-flex items-center gap-[5px]">
            {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy */}
            <Icon name="user-circle" size={15} className="text-muted" />
            {labels.needMyAction(p.needMyAction, formatNumber(p.needMyAction, locale))}
          </span>
          {/* The Project code, as in Document Numbers: always left-to-right. */}
          <span className="inline-flex items-center gap-[5px]">
            <Icon name="hash" size={15} className="text-muted" />
            <bdi dir="ltr">{p.code}</bdi>
          </span>
        </span>
        {/* Their Company's role, on its own line and never cut short. */}
        <span className="text-caption text-muted [overflow-wrap:anywhere]">
          {p.projectRole.name[locale]}
          {p.isProjectAdmin && ` · ${labels.projectAdmin}`}
        </span>
      </span>
    </Link>
  );
}
