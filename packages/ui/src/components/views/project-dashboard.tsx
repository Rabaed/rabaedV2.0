import {
  formatNumber,
  type ChainBucket,
  type CodeCFilter,
  type Dashboard,
  type DashboardCard,
  type DashboardCodeCLine,
  type DashboardFigure,
  type DashboardFigureQuery,
  type Locale,
  type ModuleKey,
  type OutcomeKind,
} from "@rabaed/domain";
import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { focusRing } from "../form/control-styles.ts";

const copy = {
  items: { en: "# items", ar: "عدد العناصر: #" },
  inPreparation: { en: "In preparation", ar: "قيد الإعداد" },
  open: { en: "Open", ar: "مفتوحة" },
  closed: { en: "Closed", ar: "مغلقة" },
  empty: { en: "No Work Item Types on this Project yet.", ar: "لا توجد أنواع عناصر عمل في هذا المشروع بعد." },
  codeC: { en: "Code C", ar: "الرمز C" },
} satisfies Record<string, Record<Locale, string>>;

/** The Code C line's sub-states (codeCState), as the line and a List filtered from it name them. */
const codeCLabels: Record<CodeCFilter, Record<Locale, string>> = {
  approvedOnRevision: { en: "approved on revision", ar: "معتمد بعد التعديل" },
  awaitingRevision: { en: "awaiting revision", ar: "بانتظار التعديل" },
  noRevisionYet: { en: "no Revision yet", ar: "لا تعديل بعد" },
  revisionInProgress: { en: "Revision in progress", ar: "التعديل جارٍ" },
  rejectedAfterC: { en: "rejected after C", ar: "مرفوض بعد C" },
};

/** A Code C sub-state's name (e.g. for a List filtered from the Code C line), in the viewer's language. */
export function codeCLabel(filter: CodeCFilter, locale: Locale): string {
  return codeCLabels[filter][locale];
}

const moduleNames: Record<ModuleKey, Record<Locale, string>> = {
  snag_list: { en: "Snag List", ar: "قائمة الملاحظات" },
  submittals: { en: "Submittals", ar: "الاعتمادات" },
  inspections: { en: "Inspections", ar: "الفحوصات" },
  site_reports: { en: "Site Reports", ar: "التقارير الموقعية" },
  drawings: { en: "Drawings", ar: "المخططات" },
};

/** Each bucket's name on a bar, and its colour: the Stage colour it ends in. Full class names, so Tailwind finds them. */
const buckets: Record<ChainBucket, { label: Record<Locale, string>; bar: string }> = {
  pending: { label: { en: "Pending", ar: "قيد الانتظار" }, bar: "bg-stage-pending-dot" },
  in_preparation: { label: copy.inPreparation, bar: "bg-stage-internal-dot" },
  C: { label: { en: "Revise (C)", ar: "للتعديل (C)" }, bar: "bg-stage-resubmitted-dot" },
  A: { label: { en: "Approved (A)", ar: "معتمد (A)" }, bar: "bg-stage-approved-dot" },
  B: { label: { en: "Approved (B)", ar: "معتمد (B)" }, bar: "bg-stage-approved-dot" },
  D: { label: { en: "Rejected (D)", ar: "مرفوض (D)" }, bar: "bg-stage-rejected-dot" },
  passed: { label: { en: "Passed", ar: "ناجح" }, bar: "bg-stage-approved-dot" },
  passed_with_comments: { label: { en: "Passed with Comments", ar: "ناجح مع ملاحظات" }, bar: "bg-stage-approved-dot" },
  failed: { label: { en: "Failed", ar: "راسب" }, bar: "bg-stage-rejected-dot" },
  approved: { label: { en: "Approved", ar: "معتمد" }, bar: "bg-stage-approved-dot" },
  rejected: { label: { en: "Rejected", ar: "مرفوض" }, bar: "bg-stage-rejected-dot" },
  cancelled: { label: { en: "Cancelled", ar: "ملغى" }, bar: "bg-stage-cancelled-dot" },
};

/** The footer's name for the approved share, by outcome kind. */
const approvedLabel: Record<OutcomeKind, Record<Locale, string>> = {
  review_code: { en: "Approved (A+B)", ar: "المعتمد (A+B)" },
  inspection_result: { en: "Passed, with or without Comments", ar: "الناجح، مع ملاحظات أو بدونها" },
  none: { en: "Approved", ar: "المعتمد" },
};

/** The bucket names (e.g. for a List filtered from a Dashboard number), in the viewer's language. */
export function chainBucketLabel(bucket: ChainBucket, locale: Locale): string {
  return buckets[bucket].label[locale];
}

export type ProjectDashboardProps = {
  dashboard: Dashboard;
  locale: Locale;
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
export function ProjectDashboard({ dashboard, locale, hrefFor, linkAs: Link = "a" }: ProjectDashboardProps) {
  if (dashboard.modules.length === 0) return <p className="text-muted">{copy.empty[locale]}</p>;
  const ctx = { locale, hrefFor, Link };
  return (
    <div className="space-y-8">
      {dashboard.modules.map((m) => (
        <section key={m.key} aria-labelledby={`dashboard-${m.key}`} className="space-y-3">
          <h2 id={`dashboard-${m.key}`} className="text-h6 font-semibold">
            {moduleNames[m.key][locale]}
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

type Ctx = { locale: Locale; hrefFor: (query: DashboardFigureQuery) => string; Link: ElementType };

const linkClass = cn("rounded-sm hover:underline underline-offset-4", focusRing);

function TypeCard({ card, ...ctx }: { card: DashboardCard } & Ctx) {
  const { locale } = ctx;
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
          {copy.items[locale].replace("#", formatNumber(card.total.count, locale))}
        </Figure>
      </header>
      {card.kind === "open_closed" ? (
        <dl className="grid grid-cols-2 gap-4">
          <BigNumber label={copy.open[locale]} figure={card.open} {...ctx} />
          <BigNumber label={copy.closed[locale]} figure={card.closed} {...ctx} />
        </dl>
      ) : (
        <>
          <ul className="space-y-1">
            {card.bars.map((bar) => (
              <li key={bar.bucket}>
                <Bar label={buckets[bar.bucket].label[locale]} colour={buckets[bar.bucket].bar} figure={bar} total={card.total.count} {...ctx} />
              </li>
            ))}
          </ul>
          {card.inPreparation && (
            <p className="text-caption">
              <Figure figure={card.inPreparation} {...ctx} className="text-muted">
                {copy.inPreparation[locale]} {formatNumber(card.inPreparation.count, locale)}
              </Figure>
            </p>
          )}
          <p className="border-t border-border pt-3 text-caption font-semibold">
            <Figure figure={card.approved} {...ctx}>
              {approvedLabel[card.outcomeKind][locale]} {formatNumber(card.approved.count, locale)} ·{" "}
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
  const { locale } = ctx;
  const n = (count: number) => formatNumber(count, locale);
  // Each figure at least 24px tall (44px on a touch screen), so the links on one line are easy to hit.
  const target = "inline-flex min-h-6 items-center pointer-coarse:min-h-11";
  const part = (filter: CodeCFilter, figure: DashboardFigure, suffix = "") => (
    <Figure figure={figure} {...ctx} className={target}>
      {codeCLabels[filter][locale]} {n(figure.count)}
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
        {copy.codeC[locale]} {n(line.total.count)}
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
    <Figure figure={figure} {...ctx} className="grid min-h-8 grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-caption pointer-coarse:min-h-11">
      <span className="truncate">{label}</span>
      <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-neutral-tint">
        <span className={cn("block h-full rounded-full", colour)} style={{ inlineSize: `${share}%` }} />
      </span>
      <span className="font-semibold tabular-nums">{formatNumber(figure.count, ctx.locale)}</span>
    </Figure>
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

/** A Module's name, in the viewer's language (e.g. for the Activity Feed's Module filter). */
export function moduleName(key: ModuleKey, locale: Locale): string {
  return moduleNames[key][locale];
}
