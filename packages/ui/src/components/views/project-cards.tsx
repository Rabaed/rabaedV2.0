import { formatNumber, type Locale, type ProjectSummary } from "@rabaed/domain";
import { useId, type ElementType } from "react";
import { cn } from "../../lib/cn.ts";
import { Badge } from "../data/badge.tsx";
import { focusRing } from "../form/control-styles.ts";

const copy = {
  list: { en: "My Projects", ar: "مشاريعي" },
  needMyAction: { en: "Need My Action", ar: "بحاجة لإجرائي" },
  closed: { en: "Closed", ar: "مغلق" },
  projectAdmin: { en: "Project Admin", ar: "مسؤول المشروع" },
} satisfies Record<string, Record<Locale, string>>;

export type ProjectCardsProps = {
  /** The Member's Projects, as the API lists them. */
  projects: ProjectSummary[];
  locale: Locale;
  /** A Project's page. */
  href: (projectId: string) => string;
  /** The link component, e.g. Next.js `Link`, so navigation stays client-side. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/**
 * The Projects page, the Member's home page (RP-346): one card per Project, a
 * link to it, with how many items need the Member's action there (the Steps
 * they hold and the unclaimed Steps of their pool; never their own Drafts).
 * The cards stack on a phone.
 */
export function ProjectCards({ projects, locale, href, linkAs }: ProjectCardsProps) {
  return (
    <ul aria-label={copy.list[locale]} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <li key={p.id} className="flex">
          <ProjectCard project={p} locale={locale} href={href(p.id)} linkAs={linkAs} />
        </li>
      ))}
    </ul>
  );
}

function ProjectCard({ project: p, locale, href, linkAs: Link = "a" }: { project: ProjectSummary; locale: Locale; href: string; linkAs?: ElementType }) {
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
          {p.isProjectAdmin && ` · ${copy.projectAdmin[locale]}`}
          {closed && (
            <>
              {" "}
              <Badge>{copy.closed[locale]}</Badge>
            </>
          )}
        </span>
        <span className="inline-flex items-center gap-2 text-caption">
          <span className="sr-only">{`${copy.needMyAction[locale]}: ${count}`}</span>
          <span aria-hidden="true" className="text-muted">
            {copy.needMyAction[locale]}
          </span>
          <Badge aria-hidden="true" tone={p.needMyAction > 0 ? "brand" : "neutral"}>
            {count}
          </Badge>
        </span>
      </span>
    </Link>
  );
}
