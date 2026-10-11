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
import { TitledCard } from "../data/titled-card.tsx";
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
 * Laid out as the design kit's grid of cards (RP-411): a card is never narrower
 * than its longest label needs, so a row that can't fit another card wraps it.
 */
export function ProjectDashboard({ dashboard, locale, labels, hrefFor, linkAs: Link = "a" }: ProjectDashboardProps) {
  if (dashboard.modules.length === 0) return <p className="text-muted">{labels.empty}</p>;
  const ctx = { locale, labels, hrefFor, Link };
  return (
    <div className="flex flex-col gap-7">
      {dashboard.modules.map((m) => (
        <section key={m.key} aria-labelledby={`dashboard-${m.key}`} className="flex flex-col gap-3">
          <h2 id={`dashboard-${m.key}`} className="font-display text-h6 leading-tight font-bold ltr:font-extrabold">
            {moduleName(m.key, locale)}
          </h2>
          {/* 20rem fits the longest bar and figure in English and Arabic beside a 3rem bar (the FiguresWhole stories check it). */}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-[18px]">
            {m.cards.map((card) => (
              <li key={card.type.code} className="flex min-w-0">
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
  const n = (count: number) => formatNumber(count, locale);
  return (
    <TitledCard
      as="article"
      level={3}
      className="w-full"
      title={
        <>
          {card.type.name[locale]}{" "}
          <span className="font-semibold text-muted" translate="no">
            {card.type.code}
          </span>
        </>
      }
      actions={
        <Figure figure={card.total} {...ctx} className="text-[13px] font-semibold whitespace-nowrap text-muted">
          {labels.items(n(card.total.count))}
        </Figure>
      }
    >
      {card.kind === "open_closed" ? (
        <dl className="grid grid-cols-2 gap-4">
          <BigNumber label={labels.open} figure={card.open} {...ctx} />
          <BigNumber label={labels.closed} figure={card.closed} {...ctx} />
        </dl>
      ) : (
        <div className="flex flex-col gap-3">
          {/* One grid for the card's bars, so every bar starts where the longest name ends. */}
          <ul className="grid grid-cols-[max-content_minmax(3rem,1fr)_auto] gap-x-3">
            {card.bars.map((bar) => (
              <li key={bar.bucket} className="col-span-3 grid grid-cols-subgrid">
                <Bar label={barLabel(bar, locale, labels)} colour={barColour[bar.tone]} figure={bar} total={card.total.count} {...ctx} />
              </li>
            ))}
          </ul>
          {card.inPreparation && <FigureRow label={labels.inPreparation} value={n(card.inPreparation.count)} figure={card.inPreparation} {...ctx} className="text-muted" />}
          <div className="border-t border-border-subtle pt-2">
            <FigureRow
              label={labels.approved[card.outcomeKind]}
              value={`${n(card.approved.count)} · ${formatNumber(card.approved.percent / 100, locale, { style: "percent" })}`}
              figure={card.approved}
              {...ctx}
              className="font-semibold"
            />
            {card.codeC && <CodeCRows typeCode={card.type.code} line={card.codeC} {...ctx} />}
          </div>
        </div>
      )}
    </TitledCard>
  );
}

/**
 * The Code C figures, a row each (RP-411): "Code C 5", then "approved on
 * revision 3 (60%)" and "awaiting revision 2", awaiting revision split for the
 * raiser's own Company, and "rejected after C" when there is any (RP-352). Each
 * figure links to its List.
 */
function CodeCRows({ typeCode, line, ...ctx }: { typeCode: string; line: DashboardCodeCLine } & Ctx) {
  const { locale, labels } = ctx;
  const n = (count: number) => formatNumber(count, locale);
  const row = (filter: CodeCFilter, figure: DashboardFigure, suffix = "", className?: string) => (
    <FigureRow label={labels.codeCStates[filter]} value={`${n(figure.count)}${suffix}`} figure={figure} {...ctx} className={className} />
  );
  return (
    <div data-testid={`code-c-${typeCode}`}>
      <FigureRow label={labels.codeC} value={n(line.total.count)} figure={line.total} {...ctx} className="font-semibold" />
      <div className="border-s-2 border-border-subtle ps-3">
        {row("approvedOnRevision", line.approvedOnRevision, ` (${formatNumber(line.approvedOnRevision.percent / 100, locale, { style: "percent" })})`)}
        {row("awaitingRevision", line.awaitingRevision)}
        {line.split && (
          <div className="ps-3 text-muted">
            {row("noRevisionYet", line.split.noRevisionYet)}
            {row("revisionInProgress", line.split.revisionInProgress)}
          </div>
        )}
        {line.rejectedAfterC && row("rejectedAfterC", line.rejectedAfterC)}
      </div>
    </div>
  );
}

/** One figure on a line of its own: its name, and its number at the end; the whole row links to its List. */
function FigureRow({ label, value, figure, className, ...ctx }: { label: string; value: string; figure: DashboardFigure; className?: string } & Ctx) {
  return (
    <ctx.Link
      href={ctx.hrefFor(figure.query)}
      className={cn(linkLook, "flex min-h-8 items-center justify-between gap-3 text-caption whitespace-nowrap pointer-coarse:min-h-11", className)}
    >
      <span>{label}</span> <span className="tabular-nums">{value}</span>
    </ctx.Link>
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

/**
 * One bar: its name in full, a bar as long as its share of the Type's chains,
 * and its number; the whole row links to its List. It lays out on its list's
 * grid (subgrid), so the bars of a card line up.
 */
function Bar({ label, colour, figure, total, ...ctx }: { label: string; colour: string; figure: DashboardFigure; total: number } & Ctx) {
  const share = total === 0 ? 0 : Math.round((figure.count / total) * 100);
  return (
    // A whole-width grid row, so it takes the link's look but not touchBox: it only needs the height.
    <ctx.Link
      href={ctx.hrefFor(figure.query)}
      className={cn(linkLook, "col-span-3 grid min-h-8 grid-cols-subgrid items-center text-caption whitespace-nowrap pointer-coarse:min-h-11")}
    >
      <span>{label}</span>{" "}
      <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-neutral-tint">
        <span className={cn("block h-full rounded-full", colour)} style={{ inlineSize: `${share}%` }} />
      </span>{" "}
      <span className="text-end font-semibold tabular-nums">{formatNumber(figure.count, ctx.locale)}</span>
    </ctx.Link>
  );
}

/** An open or closed count, as the kit's count tiles: its name over a large number. */
function BigNumber({ label, figure, ...ctx }: { label: string; figure: DashboardFigure } & Ctx) {
  return (
    <div className="flex flex-col gap-2.5">
      <dt className="text-[13.5px] text-muted">{label}</dt>
      <dd className="text-[28px] leading-none font-bold tabular-nums">
        <Figure figure={figure} {...ctx}>
          <span className="sr-only">{label} </span>
          {formatNumber(figure.count, ctx.locale)}
        </Figure>
      </dd>
    </div>
  );
}
