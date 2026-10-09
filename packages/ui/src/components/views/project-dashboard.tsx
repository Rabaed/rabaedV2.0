import {
  formatNumber,
  outcomeLabel,
  type CodeCFilter,
  type Dashboard,
  type DashboardBar,
  type DashboardBarTone,
  type DashboardCard,
  type DashboardCodeCLine,
  type DashboardFigure,
  type DashboardFigureQuery,
  type FixedChainBucket,
  type Locale,
  type OutcomeKind,
} from "@rabaed/domain";
import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { moduleName } from "../../lib/module-name.ts";
import { focusRing, touchBox } from "../form/control-styles.ts";

/** The Dashboard's words, from the app's messages. A number is given already formatted for the locale. */
export type ProjectDashboardLabels = {
  /** A Type card's total: "12 items". */
  items: (count: string) => string;
  inPreparation: string;
  open: string;
  closed: string;
  empty: string;
  codeC: string;
  /** The name of each bucket that isn't an outcome (an outcome's bar has its own name from the Type's set). */
  buckets: Record<FixedChainBucket, string>;
  /** The Code C line's sub-states, as the line and a List filtered from it name them. */
  codeCStates: Record<CodeCFilter, string>;
  /** The footer's name for the approved share, by outcome kind. */
  approved: Record<OutcomeKind, string>;
};

/**
 * Each bar's colour, by its tone (RP-429: the outcome's polarity and follow-up
 * actions, never its code): the Stage colour it ends in. Full class names, so
 * Tailwind finds them.
 */
const barColour: Record<DashboardBarTone, string> = {
  pending: "bg-stage-pending-dot",
  revision: "bg-stage-resubmitted-dot",
  positive: "bg-stage-approved-dot",
  negative: "bg-stage-rejected-dot",
};

export type ProjectDashboardProps = {
  dashboard: Dashboard;
  locale: Locale;
  labels: ProjectDashboardLabels;
  /** The List's URL for a number's filter. */
  hrefFor: (query: DashboardFigureQuery) => string;
  /** The link component, e.g. Next.js `Link`. Defaults to `<a>`. */
  linkAs?: ElementType;
};

/**
 * A Project's Dashboard (spec RP-344, design §5): one card per Work Item Type
 * under its Module's heading, the Snag List's open/closed cards first. Counts
 * are Revision chains the viewer sees, as the API sends them; every number is a
 * link to the List of exactly those chains. Nothing is measured against time.
 */
export function ProjectDashboard({ dashboard, locale, labels, hrefFor, linkAs: Link = "a" }: ProjectDashboardProps) {
  if (dashboard.modules.length === 0) return <p className="text-muted">{labels.empty}</p>;
  const ctx = { locale, labels, hrefFor, Link };
  return (
    <div className="space-y-8">
      {dashboard.modules.map((m) => (
        <section key={m.key} aria-labelledby={`dashboard-${m.key}`} className="space-y-3">
          <h2 id={`dashboard-${m.key}`} className="text-h6 font-semibold">
            {moduleName(m.key, locale)}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {m.cards.map((card) => (
              <li key={card.type.code}>
                <TypeCard card={card} {...ctx} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

type Ctx = { locale: Locale; labels: ProjectDashboardLabels; hrefFor: (query: DashboardFigureQuery) => string; Link: ElementType };

const linkLook = cn("rounded-sm hover:underline underline-offset-4", focusRing);
const linkClass = cn(linkLook, touchBox);

function TypeCard({ card, ...ctx }: { card: DashboardCard } & Ctx) {
  const { locale, labels } = ctx;
  const headingId = `dashboard-type-${card.type.code}`;
  return (
    <article aria-labelledby={headingId} className="h-full space-y-4 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="font-semibold">
          {card.type.name[locale]}{" "}
          <span className="text-muted" translate="no">
            {card.type.code}
          </span>
        </h3>
        <Figure figure={card.total} {...ctx} className="text-muted">
          {labels.items(formatNumber(card.total.count, locale))}
        </Figure>
      </header>
      {card.kind === "open_closed" ? (
        <dl className="grid grid-cols-2 gap-4">
          <BigNumber label={labels.open} figure={card.open} {...ctx} />
          <BigNumber label={labels.closed} figure={card.closed} {...ctx} />
        </dl>
      ) : (
        <>
          <ul className="space-y-1">
            {card.bars.map((bar) => (
              <li key={bar.bucket}>
                <Bar label={barLabel(bar, locale, labels)} colour={barColour[bar.tone]} figure={bar} total={card.total.count} {...ctx} />
              </li>
            ))}
          </ul>
          {card.inPreparation && (
            <p className="text-caption">
              <Figure figure={card.inPreparation} {...ctx} className="text-muted">
                {labels.inPreparation} {formatNumber(card.inPreparation.count, locale)}
              </Figure>
            </p>
          )}
          <p className="border-t border-border pt-3 text-caption font-semibold">
            <Figure figure={card.approved} {...ctx}>
              {labels.approved[card.outcomeKind]} {formatNumber(card.approved.count, locale)} ·{" "}
              {formatNumber(card.approved.percent / 100, locale, { style: "percent" })}
            </Figure>
          </p>
          {card.codeC && <CodeCLine typeCode={card.type.code} line={card.codeC} {...ctx} />}
        </>
      )}
    </article>
  );
}

/**
 * "Code C 5 · approved on revision 3 (60%) · awaiting revision 2", awaiting
 * revision split for the raiser's own Company, and "rejected after C" when
 * there is any (RP-352). Each figure links to its List.
 */
function CodeCLine({ typeCode, line, ...ctx }: { typeCode: string; line: DashboardCodeCLine } & Ctx) {
  const { locale, labels } = ctx;
  const n = (count: number) => formatNumber(count, locale);
  // Each figure at least 24px tall (44px on a touch screen), so the links on one line are easy to hit.
  const target = "inline-flex min-h-6 items-center pointer-coarse:min-h-11";
  const part = (filter: CodeCFilter, figure: DashboardFigure, suffix = "") => (
    <Figure figure={figure} {...ctx} className={target}>
      {labels.codeCStates[filter]} {n(figure.count)}
      {suffix}
    </Figure>
  );
  const separator = (
    <span aria-hidden="true" className="text-muted">
      ·
    </span>
  );
  return (
    <p data-testid={`code-c-${typeCode}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-caption">
      <Figure figure={line.total} {...ctx} className={cn(target, "font-semibold")}>
        {labels.codeC} {n(line.total.count)}
      </Figure>
      {separator}
      {part("approvedOnRevision", line.approvedOnRevision, ` (${formatNumber(line.approvedOnRevision.percent / 100, locale, { style: "percent" })})`)}
      {separator}
      {part("awaitingRevision", line.awaitingRevision)}
      {line.split && (
        <span className="inline-flex flex-wrap items-center gap-x-1 text-muted">
          ({part("noRevisionYet", line.split.noRevisionYet)} · {part("revisionInProgress", line.split.revisionInProgress)})
        </span>
      )}
      {line.rejectedAfterC && (
        <>
          {separator}
          {part("rejectedAfterC", line.rejectedAfterC)}
        </>
      )}
    </p>
  );
}

/** A bar's name: its outcome's, from the Type's set ("Approved (A)"), or the app's word for Pending, Approved and Rejected. */
function barLabel(bar: DashboardBar, locale: Locale, labels: ProjectDashboardLabels): string {
  if (bar.name) return outcomeLabel({ code: bar.bucket, name: bar.name }, locale);
  return (labels.buckets as Record<string, string>)[bar.bucket] ?? bar.bucket;
}

/** A number as a link to its List. */
function Figure({ figure, hrefFor, Link, className, children }: { figure: DashboardFigure; className?: string; children: ReactNode } & Ctx) {
  return (
    <Link href={hrefFor(figure.query)} className={cn(linkClass, className)}>
      {children}
    </Link>
  );
}

/** One bar: its name, a bar as long as its share of the Type's chains, and its number; the whole row links to its List. */
function Bar({ label, colour, figure, total, ...ctx }: { label: string; colour: string; figure: DashboardFigure; total: number } & Ctx) {
  const share = total === 0 ? 0 : Math.round((figure.count / total) * 100);
  return (
    // A whole-width grid row, so it takes the link's look but not touchBox: it only needs the height.
    <ctx.Link href={ctx.hrefFor(figure.query)} className={cn(linkLook, "grid min-h-8 grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-caption pointer-coarse:min-h-11")}>
      <span className="truncate">{label}</span>
      <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-neutral-tint">
        <span className={cn("block h-full rounded-full", colour)} style={{ inlineSize: `${share}%` }} />
      </span>
      <span className="font-semibold tabular-nums">{formatNumber(figure.count, ctx.locale)}</span>
    </ctx.Link>
  );
}

function BigNumber({ label, figure, ...ctx }: { label: string; figure: DashboardFigure } & Ctx) {
  return (
    <div>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-h4 font-semibold">
        <Figure figure={figure} {...ctx}>
          <span className="sr-only">{label} </span>
          {formatNumber(figure.count, ctx.locale)}
        </Figure>
      </dd>
    </div>
  );
}
