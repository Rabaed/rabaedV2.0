import { formatDate, isOpenStageCategory, type HomeActivityEntry, type HomeWorkItem, type Locale } from "@rabaed/domain";
import { useId, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { AgeDots } from "../status/age-dots.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { whatHappened, type ActivityEventLabels } from "./activity-feed-panel.tsx";

// Home's two cards (RP-407): what needs the Member across their Projects, and
// what happened lately. Presentational: the rows come from GET /v1/home as the
// Member may see them, and the app supplies the words and links.

/** A titled card with links at the end of its heading. */
function HomeCard({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-surface", className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3">
        <h2 id={titleId} className="py-1 text-h6 font-bold">
          {title}
        </h2>
        {actions}
      </header>
      <div className="min-w-0 px-5 py-1">{children}</div>
    </section>
  );
}

const linkClass = cn("inline-flex items-center rounded-sm text-sm font-semibold text-primary hover:underline underline-offset-4", focusRing, touchBox);

export type NeedsMyActionCardLabels = {
  title: string;
  /** When nothing waits on the Member. */
  empty: string;
  /** An item with no Document Number yet. */
  noNumber: string;
};

export type NeedsMyActionCardProps = {
  /** The items waiting on the Member, newest-waiting first, as the API sends them. */
  items: HomeWorkItem[];
  locale: Locale;
  labels: NeedsMyActionCardLabels;
  /** An item's page. */
  itemHref: (id: string) => string;
  /** "Open board" links: a Project's Kanban showing its Need My Action. */
  boards: { key: string; label: string; href: string }[];
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  className?: string;
};

/**
 * "Needs my action" across the Member's Projects: each item's Subject, its
 * Document Number (left to right) and Project, its Stage and Step Age. Never
 * a due date: age only.
 */
export function NeedsMyActionCard({ items, locale, labels, itemHref, boards, linkAs: Link = "a", className }: NeedsMyActionCardProps) {
  return (
    <HomeCard
      title={labels.title}
      className={className}
      actions={
        boards.length > 0 && (
          <nav className="flex flex-wrap gap-x-4">
            {boards.map((b) => (
              <Link key={b.key} href={b.href} className={linkClass}>
                {b.label}
              </Link>
            ))}
          </nav>
        )
      }
    >
      {items.length === 0 ? (
        <p className="py-4 text-muted">{labels.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={itemHref(item.id)} className={cn("-mx-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm px-2 py-3 hover:bg-hover", focusRing)}>
                <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-neutral-tint text-neutral-fg">
                  <Icon name="file-text" />
                </span>
                <span className="flex min-w-0 flex-1 basis-48 flex-col">
                  <span className="truncate font-semibold">{item.title}</span>
                  <span className="truncate text-sm text-muted">
                    {item.documentNumber ? <DocNo value={item.documentNumber} /> : labels.noNumber}
                    {" · "}
                    {item.project.name[locale]}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <StagePill stage={stageColour(item.stage)} label={item.stage.name[locale]} locale={locale} />
                  {isOpenStageCategory(item.stage.category) && item.stepAgeWeeks !== null && <AgeDots weeks={item.stepAgeWeeks} locale={locale} />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

export type RecentActivityCardLabels = ActivityEventLabels & {
  title: string;
  empty: string;
  noNumber: string;
  /** Only the viewer's own Company sees this entry. */
  internal: string;
};

export type RecentActivityCardProps = {
  /** The newest entries across the Member's Projects, newest first, as the API sends them. */
  entries: HomeActivityEntry[];
  locale: Locale;
  labels: RecentActivityCardLabels;
  itemHref: (id: string) => string;
  linkAs?: ElementType;
  className?: string;
};

/**
 * "Recent activity" across the Member's Projects: each entry as the Project's
 * Activity Feed words it, another Company by its name only and people only of
 * the viewer's own Company (V14), with the Project and when.
 */
export function RecentActivityCard({ entries, locale, labels, itemHref, linkAs: Link = "a", className }: RecentActivityCardProps) {
  return (
    <HomeCard title={labels.title} className={className}>
      {entries.length === 0 ? (
        <p className="py-4 text-muted">{labels.empty}</p>
      ) : (
        <ol className="divide-y divide-border">
          {entries.map((e) => {
            const company = e.by.companyName?.[locale] ?? "";
            return (
              <li key={e.id}>
                <Link href={itemHref(e.workItem.id)} className={cn("-mx-2 flex gap-3 rounded-sm px-2 py-3 hover:bg-hover", focusRing)}>
                  <Avatar name={company} kind="company" decorative className="shrink-0" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="break-words">
                      <span className="font-semibold">{company}</span>
                      {e.by.memberName && <span className="text-muted"> · {e.by.memberName[locale]}</span>} {whatHappened(e, locale, labels)}{" "}
                      {e.workItem.documentNumber ? <DocNo value={e.workItem.documentNumber} /> : <span className="text-muted">({labels.noNumber})</span>}
                      <span> · {e.workItem.title}</span>
                    </span>
                    <span className="text-sm text-muted">
                      {e.project.name[locale]} · <time dateTime={e.at}>{formatDate(new Date(e.at), locale, { dateStyle: "medium", timeStyle: "short" })}</time>
                      {e.audience === "internal" && <span> · {labels.internal}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </HomeCard>
  );
}
