"use client";

import { cardNumber, type HomeActivityEntry, type HomeWorkItem, type Locale } from "@rabaed/domain";
import { useId, type ElementType, type ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Avatar } from "../data/avatar.tsx";
import { DocNo } from "../doc-no/doc-no.tsx";
import { focusRing, touchBox } from "../form/control-styles.ts";
import { Icon } from "../icon/icon.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../overlay/popover.tsx";
import { stageColour } from "../status/stage-colour.ts";
import { StagePill } from "../status/stage-pill.tsx";
import { whatHappened, type ActivityEventLabels } from "./activity-feed-panel.tsx";

// Home's two cards (RP-407), as the design kit draws them: what needs the
// Member across their Projects, and what happened lately. Presentational: the
// rows come from GET /v1/home as the Member may see them, and the app supplies
// the words and links.

const linkClass = cn("inline-flex items-center rounded-sm text-[13px] font-semibold text-primary hover:underline underline-offset-4", focusRing, touchBox);

/** A titled card with links at the end of its heading and, when there is more, "View all" at its foot. Fills its grid cell's height. */
function HomeCard({
  title,
  actions,
  footer,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cn("flex h-full min-w-0 flex-col rounded-lg border border-border bg-surface", className)}>
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border-subtle px-5 py-4">
        <h2 id={titleId} className="text-[16px] font-bold">
          {title}
        </h2>
        {actions && <div className="ms-auto flex items-center gap-1">{actions}</div>}
      </header>
      <div className="min-w-0 flex-1 px-5 py-1">{children}</div>
      {footer && <footer className="border-t border-border-subtle px-5 py-2.5">{footer}</footer>}
    </section>
  );
}

/** A row of a Home card: the kit's `act-it`, a line between rows. */
const rowClass = cn("-mx-2 flex items-center gap-3 rounded-sm px-2 py-3 hover:bg-hover", focusRing);

export type NeedsMyActionCardLabels = {
  title: string;
  /** When nothing waits on the Member. */
  empty: string;
  /** An item with no Document Number yet. */
  noNumber: string;
  /** A Revision after the number, e.g. "R2". */
  revision: (n: number) => string;
  /** "View all", when more items wait than the card shows. */
  viewAll: string;
  /** The menu of the other Projects' boards, when items wait on several. */
  otherBoards: string;
};

/** "Open board": a Project's Kanban showing its Need My Action. */
export type HomeBoardLink = { key: string; label: string; href: string };

export type NeedsMyActionCardProps = {
  /** The items waiting on the Member, newest-waiting first, as the API sends them (at most five). */
  items: HomeWorkItem[];
  locale: Locale;
  labels: NeedsMyActionCardLabels;
  /** An item's page. */
  itemHref: (id: string) => string;
  /** "Open board": the first is the header's link (the Project with the most waiting); any others are in its menu. */
  boards: HomeBoardLink[];
  /** "View all": set when more items wait than the card shows. */
  viewAllHref?: string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
  className?: string;
};

/**
 * "Needs my action" across the Member's Projects, as the kit's rows: each
 * item's Subject, then its Document Number (left to right), Revision and
 * Project, and its Stage at the end. One "Open board" in the header.
 */
export function NeedsMyActionCard({ items, locale, labels, itemHref, boards, viewAllHref, linkAs: Link = "a", className }: NeedsMyActionCardProps) {
  const [board, ...others] = boards;
  return (
    <HomeCard
      title={labels.title}
      className={className}
      actions={
        board && (
          <>
            <Link href={board.href} className={linkClass}>
              {board.label}
            </Link>
            {others.length > 0 && (
              <Popover>
                <PopoverTrigger className={cn("inline-flex items-center justify-center rounded-sm text-primary hover:bg-hover", focusRing, touchBox)} aria-label={labels.otherBoards}>
                  <Icon name="chevron-down" size={16} />
                </PopoverTrigger>
                <PopoverContent align="end" aria-label={labels.otherBoards} className="w-auto min-w-48 p-1.5">
                  <ul className="flex flex-col">
                    {others.map((b) => (
                      <li key={b.key}>
                        <Link href={b.href} className={cn("block rounded-sm px-3 py-2 text-sm font-medium hover:bg-hover", focusRing)}>
                          {b.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </>
        )
      }
      footer={
        viewAllHref && (
          <Link href={viewAllHref} className={linkClass}>
            {labels.viewAll}
          </Link>
        )
      }
    >
      {items.length === 0 ? (
        <p className="py-4 text-muted">{labels.empty}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {items.map((item) => {
            const number = cardNumber(item.documentNumber, item.revisionNo);
            return (
              <li key={item.id}>
                <Link href={itemHref(item.id)} className={rowClass}>
                  <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-canvas text-muted">
                    <Icon name="file-text" size={18} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body font-semibold">{item.title}</span>
                    <span className="truncate text-[12.5px] text-muted">
                      {number ? <DocNo value={number} className="font-normal" /> : labels.noNumber}
                      {item.revisionNo > 0 && ` · ${labels.revision(item.revisionNo)}`}
                      {" · "}
                      {item.project.name[locale]}
                    </span>
                  </span>
                  <StagePill stage={stageColour(item.stage)} label={item.stage.name[locale]} locale={locale} className="ms-auto shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </HomeCard>
  );
}

export type RecentActivityCardLabels = ActivityEventLabels & {
  title: string;
  empty: string;
  /** "View all", when the feeds hold more than the card shows. */
  viewAll: string;
  /** The Code an entry issued, after its Subject: "(Code B)". */
  code: (outcome: string) => string;
};

export type RecentActivityCardProps = {
  /** The newest entries across the Member's Projects, newest first, as the API sends them (at most five). */
  entries: HomeActivityEntry[];
  locale: Locale;
  labels: RecentActivityCardLabels;
  /** When it happened, as Home says it: "10m ago", "1h ago", then the date. */
  when: (at: string) => string;
  itemHref: (id: string) => string;
  /** "View all": a Project's Activity Feed, set when the feeds hold more. */
  viewAllHref?: string;
  linkAs?: ElementType;
  className?: string;
};

/**
 * An entry's words after its name: the Transition taken (a Code's Transition
 * without its " · B", which the entry gives after the Subject), as the
 * Activity Feed words it.
 */
function action(e: HomeActivityEntry, locale: Locale, labels: ActivityEventLabels): string {
  const said = whatHappened(e, locale, labels);
  const suffix = e.outcome ? ` · ${e.outcome}` : null;
  return suffix && said.endsWith(suffix) ? said.slice(0, -suffix.length) : said;
}

/**
 * "Recent activity" across the Member's Projects, as the kit's entries: who,
 * what and which item on one line, then how long ago. A person only of the
 * viewer's own Company, with their round avatar; another Company by its name
 * only, with its square one (V14).
 */
export function RecentActivityCard({ entries, locale, labels, when, itemHref, viewAllHref, linkAs: Link = "a", className }: RecentActivityCardProps) {
  return (
    <HomeCard
      title={labels.title}
      className={className}
      footer={
        viewAllHref && (
          <Link href={viewAllHref} className={linkClass}>
            {labels.viewAll}
          </Link>
        )
      }
    >
      {entries.length === 0 ? (
        <p className="py-4 text-muted">{labels.empty}</p>
      ) : (
        <ol className="divide-y divide-border-subtle">
          {entries.map((e) => {
            const person = e.by.memberName?.[locale];
            const name = person ?? e.by.companyName?.[locale] ?? "";
            return (
              <li key={e.id}>
                <Link href={itemHref(e.workItem.id)} className={rowClass}>
                  <Avatar name={name} kind={person ? "person" : "company"} decorative className="size-[34px] text-[13px]" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body font-medium break-words">
                      {name} <span className="text-muted">{action(e, locale, labels)} {e.workItem.title}</span>
                      {e.outcome && <span className="text-muted"> {labels.code(e.outcome)}</span>}
                    </span>
                    <time dateTime={e.at} className="text-[12.5px] text-muted tabular-nums">
                      {when(e.at)}
                    </time>
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
